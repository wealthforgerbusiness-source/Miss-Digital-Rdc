"use strict";

const {
  HttpError, json, wrap, getSupabase, verifyWebhookSignature, reconcileOrder, mapLimit
} = require("./lib/shared");

const LOOKBACK_MS = 48 * 3600 * 1000;

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== "POST") throw new HttpError(405, "Méthode non autorisée.");

  /* Corps BRUT : la signature est calculée dessus, jamais sur une re-sérialisation */
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");

  const h = {};
  Object.keys(event.headers || {}).forEach((k) => { h[k.toLowerCase()] = event.headers[k]; });

  const secret = process.env.SASPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] SASPAY_WEBHOOK_SECRET manquant");
    throw new HttpError(500, "Webhook non configuré.");
  }

  if (!verifyWebhookSignature(raw, h["x-webhook-signature"], h["x-webhook-timestamp"], secret)) {
    console.warn("[webhook] signature invalide ou horodatage trop ancien — rejeté");
    throw new HttpError(403, "Signature invalide.");
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { throw new HttpError(400, "Corps invalide."); }

  const type = payload.event || h["x-webhook-event"] || "";
  const data = payload.data || {};

  /* Événement de test : tout va bien */
  if (type === "webhook.test") {
    console.log("[webhook] test reçu et validé");
    return json(200, { received: true, test: true });
  }

  /* Seul "transaction.success" déclenche une action.
     (Les échecs sont retentables par le client sur la page SasPay :
      on ne ferme donc pas la commande sur un simple échec.) */
  if (type !== "transaction.success") {
    return json(200, { received: true, ignored: type });
  }

  /* Le webhook ne contient pas nos métadonnées : on retrouve la commande
     par le montant, puis on la confirme auprès de SasPay (source de vérité). */
  const amount = Number(data.amount);
  const currency = String(data.currency || "CDF").toUpperCase();
  if (!Number.isFinite(amount) || currency !== "CDF") {
    console.warn("[webhook] transaction ignorée (montant/devise inattendus)", data.id, data.amount, data.currency);
    return json(200, { received: true, ignored: "currency_or_amount" });
  }

  const sb = getSupabase();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: rows, error } = await sb
    .from("vote_orders")
    .select("id, status, amount_cdf, saspay_session_id, created_at")
    .in("status", ["pending", "failed"])
    .not("saspay_session_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) { console.error("[webhook] lecture commandes :", error.message); throw new HttpError(500, "Erreur temporaire."); }

  const candidates = (rows || []).filter((o) => Number(o.amount_cdf) === amount).slice(0, 12);

  if (!candidates.length) {
    console.warn("[webhook] aucune commande correspondante pour la transaction", data.id, "montant", amount);
    return json(200, { received: true, matched: 0 });
  }

  const results = await mapLimit(candidates, 6, (o) => reconcileOrder(sb, o));
  const paid = results.filter((r) => r.ok && r.value.status === "paid").length;
  const failures = results.filter((r) => !r.ok);

  if (failures.length) {
    failures.forEach((f) => console.error("[webhook] réconciliation :", f.error && f.error.message ? f.error.message : f.error));
    /* Erreur temporaire : on répond 500 pour que SasPay réessaie (5 tentatives) */
    throw new HttpError(500, "Erreur temporaire, nouvelle tentative attendue.");
  }

  console.log("[webhook] transaction", data.id, "→ commandes examinées :", candidates.length, "| confirmées :", paid);
  return json(200, { received: true, matched: candidates.length, paid });
});
