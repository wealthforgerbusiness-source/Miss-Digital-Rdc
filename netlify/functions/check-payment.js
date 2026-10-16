/* =========================================================
   MISS DIGITAL RDC — check-payment.js
   GET ?order=UUID → { status: "paid"|"pending"|"failed", qty, candidate_name }
   ========================================================= */
"use strict";

const { HttpError, json, wrap, getSupabase, reconcileOrder, UUID_RE } = require("./lib/shared");

exports.handler = wrap(async (event) => {
  if (event.httpMethod !== "GET") throw new HttpError(405, "Méthode non autorisée.");

  const orderId = String((event.queryStringParameters || {}).order || "");
  if (!UUID_RE.test(orderId)) throw new HttpError(400, "Référence invalide.");

  const sb = getSupabase();
  const { data: order, error } = await sb
    .from("vote_orders")
    .select("id, status, qty, amount_cdf, saspay_session_id, created_at, candidates(first_name, last_name)")
    .eq("id", orderId)
    .maybeSingle();

  if (error) { console.error("[check-payment] lecture :", error.message); throw new HttpError(500, "Service temporairement indisponible."); }
  if (!order) throw new HttpError(404, "Commande introuvable.");

  const candName = order.candidates
    ? (order.candidates.first_name + " " + order.candidates.last_name).trim()
    : "";

  /* Déjà confirmée : réponse immédiate */
  if (order.status === "paid") {
    return json(200, { status: "paid", qty: order.qty, candidate_name: candName });
  }

  /* Sinon on interroge SasPay (source de vérité) */
  let result;
  try {
    result = await reconcileOrder(sb, order);
  } catch (err) {
    console.error("[check-payment] réconciliation :", err && err.message ? err.message : err);
    /* SasPay momentanément injoignable : le client réessaiera */
    return json(200, { status: order.status === "failed" ? "failed" : "pending", qty: order.qty, candidate_name: candName });
  }

  return json(200, {
    status: result.status,
    qty: result.qty != null ? result.qty : order.qty,
    candidate_name: result.candidate_name || candName
  });
});
