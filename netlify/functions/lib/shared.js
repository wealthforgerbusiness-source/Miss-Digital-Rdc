/* =========================================================
   MISS DIGITAL RDC — netlify/functions/lib/shared.js
   Outils partagés par toutes les fonctions.
   ⚠️ Ce fichier tourne côté SERVEUR uniquement.
   ========================================================= */
"use strict";

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SASPAY_BASE = process.env.SASPAY_API_BASE || "https://api.saspay.me/api/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ABANDON_AFTER_MS = 24 * 3600 * 1000; // une commande jamais payée après 24 h passe en "échoué"

/* ---------- Erreurs et réponses HTTP ---------- */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

/** Enveloppe : transforme toute erreur en réponse propre, sans fuite d'informations. */
function wrap(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error("[function] erreur inattendue :", err && err.stack ? err.stack : err);
      return json(500, { error: "Erreur interne. Réessayez dans un instant." });
    }
  };
}

/* ---------- Configuration ---------- */
function cfg() {
  const num = (v, d) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);
  return {
    votePriceCDF: num(process.env.VOTE_PRICE_CDF, 2250),
    minVotes: num(process.env.MIN_VOTES, 1),
    maxVotes: num(process.env.MAX_VOTES, 10000),
    votingStart: process.env.VOTING_START || "",
    votingEnd: process.env.VOTING_END || "",
    feeMode: process.env.SASPAY_FEE_MODE === "ADD_ON" ? "ADD_ON" : "DEDUCTED",
    siteUrl: String(process.env.SITE_URL || process.env.URL || "").replace(/\/+$/, "")
  };
}

function assertVotingOpen() {
  const c = cfg();
  const now = Date.now();
  if (c.votingStart && now < Date.parse(c.votingStart)) throw new HttpError(403, "Les votes ne sont pas encore ouverts.");
  if (c.votingEnd && now > Date.parse(c.votingEnd)) throw new HttpError(403, "Les votes sont clôturés. Merci pour votre soutien !");
}

/* ---------- Supabase (clé service_role : serveur uniquement) ---------- */
let _sb = null;
function getSupabase() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[config] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant");
    throw new HttpError(500, "Service temporairement indisponible.");
  }
  _sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _sb;
}

/* ---------- SasPay ---------- */
class SaspayError extends Error {
  constructor(status, payload) {
    super("SasPay " + status);
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Appel à l'API SasPay. Gère les deux formats de réponse possibles :
 * enveloppe {success, data, code} ou objet direct.
 */
async function saspay(method, path, body) {
  const key = process.env.SASPAY_SECRET_KEY;
  if (!key) {
    console.error("[config] SASPAY_SECRET_KEY manquant");
    throw new HttpError(500, "Service de paiement non configuré.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(SASPAY_BASE + path, {
      method,
      headers: {
        Authorization: "Bearer " + key,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
  } catch (e) {
    throw new SaspayError(0, { message: e && e.name === "AbortError" ? "timeout" : String(e && e.message) });
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }

  if (!res.ok || (payload && payload.success === false)) {
    throw new SaspayError(res.status, payload);
  }
  if (payload && typeof payload === "object" && payload.success === true && payload.data !== undefined) {
    return payload.data;
  }
  return payload || {};
}

/* ---------- Validation du webhook ---------- */
function verifyWebhookSignature(rawBody, signature, timestamp, secret) {
  if (!secret || !signature || !timestamp) return false;
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false; // rejet au-delà de 5 min
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(String(signature).trim().toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Réconciliation d'une commande ---------- */
async function markFailed(sb, orderId) {
  await sb.from("vote_orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending");
}

async function confirmOrder(sb, orderId, txId) {
  const { data, error } = await sb.rpc("confirm_vote_order", {
    p_order_id: orderId,
    p_transaction_id: String(txId)
  });
  if (error) throw new Error("confirm_vote_order : " + error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    qty: row && row.qty != null ? Number(row.qty) : null,
    candidate_name: (row && row.candidate_name) || "",
    newly_confirmed: !!(row && row.newly_confirmed)
  };
}

/**
 * Interroge SasPay (source de vérité) et met à jour la commande.
 * Idempotent : peut être appelée autant de fois que nécessaire.
 * Retourne { status: "paid" | "failed" | "pending", qty?, candidate_name? }
 */
async function reconcileOrder(sb, order) {
  if (order.status === "paid") return { status: "paid" };
  if (!order.saspay_session_id) return { status: order.status || "pending" };

  const session = await saspay("GET", `/checkout-sessions/${encodeURIComponent(order.saspay_session_id)}/status/`);
  const txId = session.transaction_id || null;

  if (txId) {
    /* Jamais confiance au statut mémorisé : on revérifie la transaction elle-même */
    const tx = await saspay("GET", `/payments/${encodeURIComponent(txId)}/verify/`);
    const txStatus = String(tx.status || "").toUpperCase();

    if (txStatus === "SUCCESS") {
      const paid = Number(tx.requested_amount);
      const currency = String(tx.currency || "CDF").toUpperCase();
      if (paid !== Number(order.amount_cdf) || currency !== "CDF") {
        console.error("[reconcile] MONTANT INCOHÉRENT — aucun vote crédité", {
          order: order.id, attendu: order.amount_cdf, recu: tx.requested_amount, devise: currency
        });
        return { status: order.status || "pending", mismatch: true };
      }
      const confirmed = await confirmOrder(sb, order.id, txId);
      return { status: "paid", qty: confirmed.qty, candidate_name: confirmed.candidate_name };
    }

    if (txStatus === "FAILED" || txStatus === "CANCELLED") {
      await markFailed(sb, order.id);
      return { status: "failed" };
    }
  }

  const sStatus = String(session.status || "").toUpperCase();
  if (["EXPIRED", "CANCELLED", "CANCELED"].includes(sStatus)) {
    await markFailed(sb, order.id);
    return { status: "failed" };
  }

  if (Date.now() - new Date(order.created_at).getTime() > ABANDON_AFTER_MS) {
    await markFailed(sb, order.id);
    return { status: "failed" };
  }
  return { status: "pending" };
}

/* ---------- Concurrence limitée ---------- */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = { ok: true, value: await fn(items[idx]) }; }
      catch (error) { results[idx] = { ok: false, error }; }
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  HttpError, SaspayError, json, wrap, cfg, assertVotingOpen,
  getSupabase, saspay, verifyWebhookSignature,
  reconcileOrder, mapLimit, UUID_RE
};
