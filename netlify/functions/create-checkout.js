/* =========================================================
   MISS DIGITAL RDC — create-checkout.js
   POST { candidate_id, qty, voter_name, voter_email, voter_phone }
   → { checkout_url, order_id }
   ========================================================= */
"use strict";

const {
  HttpError, SaspayError, json, wrap, cfg, assertVotingOpen,
  getSupabase, saspay, UUID_RE
} = require("./lib/shared");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizePhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10 && d[0] === "0") d = "243" + d.slice(1);
  if (d.length === 9) d = "243" + d;
  return d.length >= 11 && d.length <= 13 ? d : "";
}

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") throw new HttpError(405, "Méthode non autorisée.");
  if ((event.body || "").length > 5000) throw new HttpError(413, "Requête trop volumineuse.");

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { throw new HttpError(400, "Requête invalide."); }

  const c = cfg();
  assertVotingOpen();

  /* ----- Validation des données ----- */
  const candidateId = String(body.candidate_id || "");
  if (!UUID_RE.test(candidateId)) throw new HttpError(400, "Candidate invalide.");

  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty < c.minVotes || qty > c.maxVotes) {
    throw new HttpError(400, `Choisissez entre ${c.minVotes} et ${c.maxVotes} votes.`);
  }

  const voterName = String(body.voter_name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (voterName.length < 2) throw new HttpError(400, "Entrez votre nom.");

  const voterEmail = String(body.voter_email || "").trim().toLowerCase().slice(0, 120);
  if (!EMAIL_RE.test(voterEmail)) throw new HttpError(400, "Entrez un email valide.");

  const voterPhone = normalizePhone(body.voter_phone);

  /* ----- Prix calculé côté serveur ----- */
  const amountCDF = qty * c.votePriceCDF;

  const sb = getSupabase();

  /* ----- La candidate doit exister et être validée ----- */
  const { data: cand, error: candErr } = await sb
    .from("candidates")
    .select("id, first_name, last_name, status")
    .eq("id", candidateId)
    .maybeSingle();
  if (candErr) { console.error("[create-checkout] candidates :", candErr.message); throw new HttpError(500, "Service temporairement indisponible."); }
  if (!cand || cand.status !== "approved") throw new HttpError(404, "Cette candidate n'est pas disponible pour le vote.");
  const candName = (cand.first_name + " " + cand.last_name).trim();

  /* ----- Anti-abus : trop de commandes en attente pour le même email ----- */
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await sb
    .from("vote_orders")
    .select("id", { count: "exact", head: true })
    .eq("voter_email", voterEmail)
    .eq("status", "pending")
    .gte("created_at", since);
  if ((count || 0) >= 5) throw new HttpError(429, "Trop de tentatives. Patientez quelques minutes avant de réessayer.");

  /* ----- Création de la commande (statut "pending") ----- */
  const { data: order, error: orderErr } = await sb
    .from("vote_orders")
    .insert({
      candidate_id: cand.id,
      qty,
      amount_cdf: amountCDF,
      voter_name: voterName,
      voter_email: voterEmail,
      voter_phone: voterPhone || null,
      status: "pending"
    })
    .select("id")
    .single();
  if (orderErr || !order) {
    console.error("[create-checkout] insert commande :", orderErr && orderErr.message);
    throw new HttpError(500, "Impossible d'enregistrer votre commande. Réessayez.");
  }

  /* ----- Session de paiement SasPay ----- */
  let session;
  try {
    session = await saspay("POST", "/checkout-sessions/", {
      amount: amountCDF.toFixed(2),
      currency: "CDF",
      country: "CD",
      description: `Miss Digital RDC : ${qty} ${qty > 1 ? "votes" : "vote"} pour ${candName}`.slice(0, 120),
      customer_name: voterName,
      customer_email: voterEmail,
      ...(voterPhone ? { customer_phone: voterPhone } : {}),
      return_url: `${c.siteUrl}/?order=${order.id}`,
      fee_charge_mode: c.feeMode,
      metadata: { order_id: order.id, candidate_id: cand.id, qty }
    });
  } catch (err) {
    await sb.from("vote_orders").update({ status: "failed" }).eq("id", order.id);
    if (err instanceof SaspayError) {
      console.error("[create-checkout] SasPay a refusé la session :", err.status, JSON.stringify(err.payload));
    } else {
      console.error("[create-checkout] SasPay :", err);
    }
    throw new HttpError(502, "Le service de paiement est momentanément indisponible. Réessayez dans un instant.");
  }

  /* ----- On ne redirige que vers un domaine SasPay ----- */
  let checkoutUrl = "";
  try {
    const u = new URL(session.checkout_url);
    if (u.protocol === "https:" && (u.hostname === "saspay.me" || u.hostname.endsWith(".saspay.me"))) {
      checkoutUrl = u.toString();
    }
  } catch (e) { /* URL invalide */ }
  if (!checkoutUrl || !session.id) {
    await sb.from("vote_orders").update({ status: "failed" }).eq("id", order.id);
    console.error("[create-checkout] réponse SasPay inattendue :", JSON.stringify(session));
    throw new HttpError(502, "Réponse inattendue du service de paiement. Réessayez.");
  }

  await sb.from("vote_orders").update({ saspay_session_id: String(session.id) }).eq("id", order.id);

  return json(200, { checkout_url: checkoutUrl, order_id: order.id });
});
