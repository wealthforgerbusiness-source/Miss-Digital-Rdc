/* =========================================================
   MISS DIGITAL RDC — reconcile-pending.js
   Fonction planifiée : toutes les 10 minutes, revérifie les
   paiements restés "en attente" auprès de SasPay.
   ========================================================= */
"use strict";

const { schedule } = require("@netlify/functions");
const { getSupabase, reconcileOrder, mapLimit } = require("./lib/shared");

const LOOKBACK_MS = 48 * 3600 * 1000;

const run = async () => {
  try {
    const sb = getSupabase();
    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const { data, error } = await sb
      .from("vote_orders")
      .select("id, status, amount_cdf, saspay_session_id, created_at")
      .eq("status", "pending")
      .not("saspay_session_id", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(40);
    if (error) throw new Error(error.message);

    const results = await mapLimit(data || [], 6, (o) => reconcileOrder(sb, o));
    const paid = results.filter((r) => r.ok && r.value.status === "paid").length;
    const failed = results.filter((r) => r.ok && r.value.status === "failed").length;
    const errors = results.filter((r) => !r.ok).length;
    console.log(`[reconcile] examinées : ${(data || []).length} | confirmées : ${paid} | échouées : ${failed} | erreurs : ${errors}`);
  } catch (err) {
    console.error("[reconcile] erreur :", err && err.message ? err.message : err);
  }
  return { statusCode: 200 };
};

exports.handler = schedule("*/10 * * * *", run);
