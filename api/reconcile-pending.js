/* =========================================================
   MISS DIGITAL RDC — api/reconcile-pending.js (version Vercel)
   Tâche planifiée (voir vercel.json) : revérifie auprès de SasPay
   les paiements restés "en attente". Protégée par CRON_SECRET.
   ========================================================= */
"use strict";

const { HttpError, json, vercel, getSupabase, reconcileOrder, mapLimit } = require("./_lib/shared");
const crypto = require("crypto");

const LOOKBACK_MS = 48 * 3600 * 1000;

function authorized(headers) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(String(headers.authorization || ""), "utf8");
  const want = Buffer.from("Bearer " + secret, "utf8");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const core = async (event) => {
  if (event.httpMethod !== "GET") throw new HttpError(405, "Méthode non autorisée.");
  if (!authorized(event.headers || {})) throw new HttpError(401, "Non autorisé.");

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
  return json(200, { examined: (data || []).length, paid, failed, errors });
};

module.exports = vercel(core);
