/* =========================================================
   MISS DIGITAL RDC — admin.js
   Dashboard administrateur : classement, revenus, validation.
   Dépend de : config.js (window.MDR) + Supabase JS (CDN)
   ========================================================= */
(function () {
  "use strict";

  var MDR = window.MDR;
  if (!MDR) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">config.js introuvable.</p>';
    return;
  }
  var cfg = MDR.cfg;
  var fmt = MDR.fmt;

  /* Noms Supabase (doivent correspondre au prompt Supabase) */
  var DB = {
    candidates: (cfg.db && cfg.db.candidatesTable) || "candidates",
    orders: "vote_orders",
    isAdminRpc: "is_admin",
    summaryRpc: "admin_summary",
    dailyRpc: "admin_daily_revenue",
    photosBucket: (cfg.db && cfg.db.photosBucket) || "candidate-photos"
  };
  var ORDERS_LIMIT = 300;
  var REFRESH_MS = 20000;

  /* =========================================================
     1. OUTILS
     ========================================================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function icon(id, cls) { return '<svg class="icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function svgUri(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  function plural(n, one, many) { return n > 1 ? many : one; }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function setErr(id, msg) { var el = document.getElementById(id); if (!el) return; el.textContent = msg || ""; el.hidden = !msg; }
  function usd(cdf) { return fmt.usd(cdf / cfg.votePriceCDF * cfg.votePriceUSD); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function compact(n) {
    n = Math.round(n);
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + " M";
    if (n >= 1e3) return Math.round(n / 1e3) + " k";
    return String(n);
  }
  function dayKey(d) {
    return new Date(d).toLocaleDateString("en-CA", { timeZone: "Africa/Kinshasa" });
  }
  function dayLabel(key) { return key.slice(8, 10) + "/" + key.slice(5, 7); }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" }).format(new Date(iso));
    } catch (e) { return "—"; }
  }
  function ago(iso) {
    if (!iso) return "";
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return "il y a " + Math.floor(s / 60) + " min";
    if (s < 86400) return "il y a " + Math.floor(s / 3600) + " h";
    return "il y a " + Math.floor(s / 86400) + " j";
  }
  function cmpTime(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return new Date(a) - new Date(b);
  }

  function toast(msg, type, ms) {
    var box = $("#toasts");
    var t = document.createElement("div");
    t.className = "toast" + (type ? " toast--" + type : "");
    t.setAttribute("role", type === "error" ? "alert" : "status");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.classList.add("is-leaving"); setTimeout(function () { t.remove(); }, 320); }, ms || 4000);
  }

  /* CSV (compatible Excel FR : séparateur ; + BOM) */
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* anti-injection de formules */
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function downloadCsv(filename, headers, rows) {
    var lines = [headers.map(csvCell).join(";")].concat(rows.map(function (r) { return r.map(csvCell).join(";"); }));
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* =========================================================
     2. SUPABASE / MODE DÉMO
     ========================================================= */
  var DEMO = !cfg.supabase || !cfg.supabase.url || !cfg.supabase.anonKey ||
    /VOTRE-PROJET/i.test(cfg.supabase.url) || /VOTRE_CLE/i.test(cfg.supabase.anonKey);
  var sb = null;
  if (!DEMO && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  var PLACEHOLDER = svgUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#e7ebf8"/>' +
    '<circle cx="300" cy="330" r="110" fill="#f4a7c3"/><path d="M110 760c10-170 90-250 190-250s180 80 190 250z" fill="#182b5f"/></svg>'
  );
  function photoUrl(path) {
    if (!path) return PLACEHOLDER;
    if (/^(data:|https?:|blob:)/.test(path)) return path;
    if (!sb) return PLACEHOLDER;
    return sb.storage.from(DB.photosBucket).getPublicUrl(path).data.publicUrl;
  }
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && t.dataset.fb !== "1") { t.dataset.fb = "1"; t.src = PLACEHOLDER; }
  }, true);

  /* =========================================================
     3. ÉTAT
     ========================================================= */
  var state = {
    candidates: [], orders: [], summary: null, daily: [],
    appFilter: "pending", appQuery: "", orderFilter: "all",
    tab: "overview", loading: false, lastUpdate: null, fallbackWarned: false,
    rejectId: null, rejectMode: "reject", timer: null
  };

  var TAB_TITLES = {
    overview: "Vue d'ensemble",
    applications: "Candidatures",
    orders: "Paiements",
    earnings: "Gains et répartition"
  };
  var CAND_STATUS = {
    pending:   { label: "À examiner", cls: "" },
    approved:  { label: "Validée", cls: "badge--ok" },
    rejected:  { label: "Refusée", cls: "badge--bad" },
    suspended: { label: "Suspendue", cls: "badge--bad" }
  };
  var ORDER_STATUS = {
    paid:    { label: "Payé", cls: "badge--ok" },
    pending: { label: "En attente", cls: "" },
    failed:  { label: "Échoué", cls: "badge--bad" }
  };

  /* =========================================================
     4. DONNÉES
     ========================================================= */
  function normCandidate(r) {
    var name = ((r.first_name || "") + " " + (r.last_name || "")).trim() || "Candidate";
    return {
      id: r.id, name: name, status: r.status || "pending",
      age: r.age, city: r.city || "", commune: r.commune || "",
      phone: r.phone || "", email: r.email || "", social: r.social || "", bio: r.bio || "",
      photo: photoUrl(r.photo_path || r.photo_url),
      votes: Number(r.votes_count || 0),
      created: r.created_at, lastVote: r.last_vote_at,
      reason: r.rejection_reason || ""
    };
  }
  function normOrder(r) {
    var cand = r.candidates || {};
    return {
      id: r.id,
      candidateId: r.candidate_id,
      candidateName: ((cand.first_name || "") + " " + (cand.last_name || "")).trim() || "—",
      qty: Number(r.qty || 0),
      amount: Number(r.amount_cdf || 0),
      voterName: r.voter_name || "", voterEmail: r.voter_email || "", voterPhone: r.voter_phone || "",
      status: r.status || "pending",
      ref: r.saspay_transaction_id || r.saspay_session_id || r.id || "",
      created: r.created_at, paidAt: r.paid_at
    };
  }
  function normSummary(d) {
    if (Array.isArray(d)) d = d[0];
    if (!d) return null;
    return {
      gross: Number(d.gross_cdf || 0),
      paid: Number(d.paid_orders || 0),
      pending: Number(d.pending_orders || 0),
      failed: Number(d.failed_orders || 0),
      votes: Number(d.votes_total || 0)
    };
  }
  function normDaily(rows) {
    return (rows || []).map(function (r) {
      return { day: String(r.day).slice(0, 10), amount: Number(r.amount_cdf || 0), votes: Number(r.votes || 0) };
    });
  }
  function summaryFromOrders() {
    var s = { gross: 0, paid: 0, pending: 0, failed: 0, votes: 0 };
    state.orders.forEach(function (o) {
      if (o.status === "paid") { s.gross += o.amount; s.paid++; s.votes += o.qty; }
      else if (o.status === "failed") s.failed++;
      else s.pending++;
    });
    return s;
  }
  function dailyFromOrders() {
    var map = {};
    state.orders.forEach(function (o) {
      if (o.status !== "paid") return;
      var k = dayKey(o.paidAt || o.created);
      map[k] = map[k] || { day: k, amount: 0, votes: 0 };
      map[k].amount += o.amount; map[k].votes += o.qty;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /* ---------- Démo ---------- */
  function demoAvatar(name, i) {
    var pals = [["#182b5f", "#f4a7c3"], ["#2a4194", "#e2709b"], ["#0f1c42", "#f4a7c3"], ["#e2709b", "#182b5f"], ["#2a4194", "#f4a7c3"]];
    var p = pals[i % pals.length];
    var ini = name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
    return svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + p[0] + '"/><stop offset="1" stop-color="' + p[1] + '"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/><circle cx="300" cy="320" r="120" fill="rgba(255,255,255,.28)"/><path d="M100 800c10-180 90-270 200-270s190 90 200 270z" fill="rgba(255,255,255,.28)"/><text x="300" y="360" text-anchor="middle" font-family="Arial,sans-serif" font-size="110" font-weight="700" fill="#fff">' + ini + "</text></svg>");
  }
  function seedDemo() {
    var rows = [
      ["Aimée Kabongo", "Kinshasa", "Gombe", 23, 1840, "approved"],
      ["Grâce Mbuyi", "Lubumbashi", "Kenya", 25, 1522, "approved"],
      ["Nadège Tshimanga", "Goma", "Himbi", 22, 1310, "approved"],
      ["Dorcas Ilunga", "Kinshasa", "Limete", 24, 965, "approved"],
      ["Esther Mukendi", "Mbuji-Mayi", "Diulu", 21, 842, "approved"],
      ["Prisca Kalala", "Kisangani", "Makiso", 26, 611, "approved"],
      ["Merveille Lumbu", "Matadi", "Mvuzi", 20, 455, "approved"],
      ["Sarah Banza", "Kinshasa", "Ngaliema", 22, 0, "pending"],
      ["Lydia Kasongo", "Bukavu", "Ibanda", 24, 0, "pending"],
      ["Rachel Mutombo", "Kananga", "Katoka", 27, 0, "pending"],
      ["Joëlle Ngoy", "Kinshasa", "Lemba", 19, 0, "rejected"]
    ];
    state.candidates = rows.map(function (r, i) {
      return {
        id: "demo-" + (i + 1), name: r[0], status: r[5], age: r[3], city: r[1], commune: r[2],
        phone: "24399" + (1000000 + i * 137531), email: r[0].split(" ")[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + "@exemple.com",
        social: "@" + r[0].split(" ")[0].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        bio: "Passionnée de mode et de technologie. Candidate de démonstration.",
        photo: demoAvatar(r[0], i), votes: r[4],
        created: new Date(Date.now() - i * 5.5 * 3600000).toISOString(), lastVote: null,
        reason: r[5] === "rejected" ? "Photo non conforme (portrait clair et personnel requis)" : ""
      };
    });

    var approved = state.candidates.filter(function (c) { return c.status === "approved"; });
    var voters = ["Jean Mukendi", "Patrick Lukusa", "Mireille Tshala", "Joël Kazadi", "Christelle Bope", "Fiston Mbiya"];
    var stat = ["paid", "paid", "paid", "paid", "paid", "pending", "paid", "paid", "failed", "paid"];
    var qtys = [1, 5, 10, 30, 50, 100, 5, 10, 30, 1];
    state.orders = [];
    for (var i = 0; i < 28; i++) {
      var cand = approved[(i * 3) % approved.length];
      var q = qtys[i % qtys.length];
      state.orders.push({
        id: "demo-order-" + (i + 1), candidateId: cand.id, candidateName: cand.name, qty: q, amount: q * cfg.votePriceCDF,
        voterName: voters[i % voters.length], voterEmail: "votant" + i + "@exemple.com", voterPhone: "",
        status: stat[i % stat.length], ref: "TXN-2026-" + (100400 + i * 7),
        created: new Date(Date.now() - i * 2.7 * 3600000).toISOString(),
        paidAt: new Date(Date.now() - i * 2.7 * 3600000).toISOString()
      });
    }
    var votesTotal = approved.reduce(function (a, c) { return a + c.votes; }, 0);
    state.summary = { gross: votesTotal * cfg.votePriceCDF, paid: 214, pending: 2, failed: 1, votes: votesTotal };

    var w = [3, 4, 3, 5, 6, 5, 7, 8, 9, 8, 10, 12, 14, 16], sw = w.reduce(function (a, b) { return a + b; }, 0);
    var keys = lastDays(14);
    state.daily = keys.map(function (k, idx) {
      var amt = Math.round((state.summary.gross * w[idx] / sw) / cfg.votePriceCDF) * cfg.votePriceCDF;
      return { day: k, amount: amt, votes: amt / cfg.votePriceCDF };
    });
  }

  function lastDays(n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * 86400000));
    return out;
  }

  async function loadAll() {
    if (state.loading) return;
    state.loading = true;
    var btn = $("#refreshBtn");
    btn.classList.add("spin");
    try {
      if (DEMO) {
        if (!state.candidates.length) seedDemo();
      } else {
        var r = await Promise.all([
          sb.from(DB.candidates).select("*").order("created_at", { ascending: false }).limit(2000),
          sb.from(DB.orders).select("*, candidates(first_name,last_name)").order("created_at", { ascending: false }).limit(ORDERS_LIMIT),
          sb.rpc(DB.summaryRpc),
          sb.rpc(DB.dailyRpc, { p_days: 14 })
        ]);
        if (r[0].error) throw r[0].error;
        if (r[1].error) throw r[1].error;
        state.candidates = (r[0].data || []).map(normCandidate);
        state.orders = (r[1].data || []).map(normOrder);

        var fallback = false;
        var sum = !r[2].error ? normSummary(r[2].data) : null;
        if (!sum) { sum = summaryFromOrders(); fallback = true; }
        state.summary = sum;
        state.daily = !r[3].error ? normDaily(r[3].data) : (fallback = true, dailyFromOrders());

        $("#fallbackBanner").hidden = !fallback;
        if (fallback && !state.fallbackWarned) {
          state.fallbackWarned = true;
          console.warn("[admin] RPC manquante :", r[2].error || r[3].error);
        }
      }
      state.lastUpdate = new Date();
      renderAll();
    } catch (err) {
      console.error(err);
      toast("Chargement impossible : " + (err.message || "erreur réseau"), "error", 6000);
    } finally {
      state.loading = false;
      btn.classList.remove("spin");
    }
  }

  /* =========================================================
     5. CALCULS
     ========================================================= */
  function ranking() {
    var list = state.candidates.filter(function (c) { return c.status === "approved"; });
    list.sort(function (a, b) {
      return (b.votes - a.votes) || cmpTime(a.lastVote, b.lastVote) || cmpTime(a.created, b.created);
    });
    return list;
  }
  function counts() {
    var c = { pending: 0, approved: 0, rejected: 0, suspended: 0, all: state.candidates.length };
    state.candidates.forEach(function (x) { if (c[x.status] != null) c[x.status]++; });
    return c;
  }

  /* =========================================================
     6. RENDU : VUE D'ENSEMBLE
     ========================================================= */
  function renderPhase() {
    var phase = MDR.votingPhase();
    var end = new Date(cfg.votingEnd).getTime();
    var txt;
    if (phase === "before") txt = "Les votes ouvrent le " + fmt.date(cfg.votingStart);
    else if (phase === "closed") txt = "Votes clôturés le " + fmt.date(cfg.votingEnd) + ". Résultats définitifs.";
    else {
      var days = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
      txt = "Votes ouverts · clôture le " + fmt.date(cfg.votingEnd) + " (dans " + days + " " + plural(days, "jour", "jours") + ")";
    }
    setText("phaseInfo", txt);
  }

  function renderLeader() {
    var box = $("#leaderCard");
    var rank = ranking();
    var top = rank[0];
    if (!top) {
      box.className = "card leader leader--empty";
      box.innerHTML = "<div><p><b>Aucune candidate validée pour le moment</b></p><p>Validez des candidatures pour lancer le classement.</p></div>";
      return;
    }
    box.className = "card leader";
    var lead = rank[1] ? top.votes - rank[1].votes : top.votes;
    box.innerHTML =
      '<img class="leader__photo" src="' + esc(top.photo) + '" alt="' + esc(top.name) + '" data-zoom="' + esc(top.photo) + '" width="112" height="112">' +
      '<div class="leader__body">' +
        '<span class="leader__tag">' + icon("crown", "icon--fill") + " En tête actuellement</span>" +
        "<h2>" + esc(top.name) + "</h2>" +
        "<p>" + esc(top.city) + (top.age ? " · " + esc(top.age) + " ans" : "") + "</p>" +
        '<div class="leader__votes"><strong>' + fmt.number(top.votes) + "</strong><span>" + plural(top.votes, "vote", "votes") + "</span>" +
        (rank[1] ? '<span class="leader__lead">+' + fmt.number(lead) + " d'avance</span>" : "") + "</div>" +
      "</div>";
  }

  function renderKpis() {
    var s = state.summary || { gross: 0, paid: 0, pending: 0, failed: 0, votes: 0 };
    var e = MDR.computeEarnings(s.gross);
    var c = counts();
    setText("kpiGross", fmt.cdf(s.gross));
    setText("kpiGrossUsd", "≈ " + usd(s.gross));
    setText("kpiOrders", fmt.number(s.paid));
    setText("kpiOrdersPending", fmt.number(s.pending));
    setText("kpiOrdersFailed", fmt.number(s.failed));
    setText("kpiFee", "− " + fmt.cdf(e.fee));
    setText("kpiNet", fmt.cdf(e.net));
    setText("kpiOrganizer", fmt.cdf(e.organizer));
    setText("kpiPool", fmt.cdf(e.pool));
    setText("kpiVotes", fmt.number(s.votes));
    setText("kpiApproved", fmt.number(c.approved));
    setText("kpiPending", fmt.number(c.pending));
    setText("kpiPrice", fmt.cdf(cfg.votePriceCDF));
  }

  function renderChart() {
    var box = $("#chart");
    var keys = lastDays(14);
    var map = {};
    state.daily.forEach(function (d) { map[d.day] = d; });
    var vals = keys.map(function (k) { return map[k] ? map[k].amount : 0; });
    var max = Math.max.apply(null, vals.concat([1]));
    if (!vals.some(function (v) { return v > 0; })) {
      box.innerHTML = '<p class="chart__empty">Aucun encaissement sur les 14 derniers jours.</p>';
      return;
    }
    var W = 700, H = 230, padT = 22, padB = 30, padX = 6;
    var n = keys.length, bw = (W - padX * 2) / n;
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet">';
    svg += '<line class="axis" x1="' + padX + '" x2="' + (W - padX) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '"/>';
    keys.forEach(function (k, i) {
      var v = vals[i];
      var h = (v / max) * (H - padT - padB);
      var x = padX + i * bw + bw * 0.16;
      var w = bw * 0.68;
      var y = H - padB - h;
      var today = i === n - 1;
      svg += '<g><title>' + esc(dayLabel(k) + " : " + fmt.cdf(v) + " · " + (map[k] ? map[k].votes : 0) + " votes") + "</title>" +
        (v > 0 ? '<rect class="bar' + (today ? " bar--today" : "") + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, 2).toFixed(1) + '" rx="5"/>' : "") +
        (v > 0 ? '<text class="val" x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + compact(v) + "</text>" : "") +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + dayLabel(k) + "</text></g>";
    });
    box.innerHTML = svg + "</svg>";
  }

  function renderTop3() {
    var list = ranking().slice(0, 3);
    var e = MDR.computeEarnings((state.summary || {}).gross || 0);
    var box = $("#top3");
    if (!list.length) { box.innerHTML = '<li class="muted">Aucune candidate validée.</li>'; return; }
    box.innerHTML = list.map(function (c, i) {
      return '<li><span class="medal">' + (i + 1) + "</span>" +
        '<img src="' + esc(c.photo) + '" alt="" data-zoom="' + esc(c.photo) + '" width="48" height="48">' +
        '<div class="who"><b>' + esc(c.name) + "</b><small>" + fmt.number(c.votes) + " " + plural(c.votes, "vote", "votes") + "</small></div>" +
        '<div class="gain">' + fmt.cdf(e.prizes[i]) + "<small>" + usd(e.prizes[i]) + "</small></div></li>";
    }).join("");
  }

  function renderRank() {
    var list = ranking();
    var total = list.reduce(function (a, c) { return a + c.votes; }, 0);
    var max = list.length ? Math.max(list[0].votes, 1) : 1;
    setText("rankCount", list.length + " " + plural(list.length, "candidate", "candidates"));
    var box = $("#rankList");
    if (!list.length) { box.innerHTML = '<li class="empty">Le classement apparaîtra après la validation des premières candidates.</li>'; return; }
    box.innerHTML = list.map(function (c, i) {
      var pct = total ? (c.votes / total * 100) : 0;
      return "<li>" +
        '<span class="rank__n">' + (i === 0 ? icon("crown", "icon--fill") : i + 1) + "</span>" +
        '<img src="' + esc(c.photo) + '" alt="" loading="lazy" data-zoom="' + esc(c.photo) + '" width="46" height="46">' +
        '<div class="rank__who"><b>' + esc(c.name) + "</b><small>" + esc(c.city) + "</small></div>" +
        '<div class="rank__bar" aria-hidden="true"><span style="width:' + (c.votes / max * 100).toFixed(1) + '%"></span></div>' +
        '<div class="rank__votes">' + fmt.number(c.votes) + "<small>" + pct.toFixed(1).replace(".", ",") + " %</small></div></li>";
    }).join("");
  }

  /* =========================================================
     7. RENDU : CANDIDATURES
     ========================================================= */
  function renderBadges() {
    var c = counts();
    $$("[data-count]").forEach(function (el) { el.textContent = c[el.getAttribute("data-count")] || 0; });
    $$("[data-pending-badge]").forEach(function (el) {
      el.hidden = c.pending === 0;
      if (el.classList.contains("count")) el.textContent = c.pending;
    });
  }

  function appCard(c, idx) {
    var st = CAND_STATUS[c.status] || CAND_STATUS.pending;
    var phone = digits(c.phone);
    var actions = "";
    if (c.status === "pending") {
      actions =
        '<button class="btn btn--ok btn--sm" data-act="approve" data-id="' + esc(c.id) + '">' + icon("check") + " Valider</button>" +
        '<button class="btn btn--danger btn--sm" data-act="reject" data-id="' + esc(c.id) + '">' + icon("x") + " Refuser</button>";
    } else if (c.status === "approved") {
      actions = '<button class="btn btn--warn btn--sm" data-act="suspend" data-id="' + esc(c.id) + '">Suspendre</button>';
    } else {
      actions =
        '<button class="btn btn--ok btn--sm" data-act="approve" data-id="' + esc(c.id) + '">' + icon("check") + " Valider</button>" +
        '<button class="btn btn--ghost btn--sm" data-act="restore" data-id="' + esc(c.id) + '">Remettre en attente</button>';
    }
    return '<article class="app" style="animation-delay:' + Math.min(idx, 10) * 40 + 'ms">' +
      '<button class="app__photo" type="button" data-zoom="' + esc(c.photo) + '" aria-label="Agrandir la photo de ' + esc(c.name) + '">' +
        '<img src="' + esc(c.photo) + '" alt="Photo de ' + esc(c.name) + '" loading="lazy" width="150" height="200"></button>' +
      '<div class="app__body">' +
        '<div class="app__head"><h3>' + esc(c.name) + '</h3><span class="badge ' + st.cls + '">' + st.label + "</span></div>" +
        "<dl>" +
          "<dt>Âge</dt><dd>" + esc(c.age || "—") + " ans</dd>" +
          "<dt>Ville</dt><dd>" + esc(c.city) + (c.commune ? " · " + esc(c.commune) : "") + "</dd>" +
          "<dt>Téléphone</dt><dd>" + (phone ? '<a href="tel:+' + phone + '">' + esc(c.phone) + '</a> · <a href="https://wa.me/' + phone + '" target="_blank" rel="noopener">WhatsApp</a>' : "—") + "</dd>" +
          "<dt>Email</dt><dd>" + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "—") + "</dd>" +
          (c.social ? "<dt>Réseau</dt><dd>" + esc(c.social) + "</dd>" : "") +
          "<dt>Inscrite</dt><dd>" + fmtDateTime(c.created) + " · " + ago(c.created) + "</dd>" +
          (c.status === "approved" ? "<dt>Votes</dt><dd><b>" + fmt.number(c.votes) + "</b></dd>" : "") +
        "</dl>" +
        (c.bio ? '<p class="app__bio">' + esc(c.bio) + "</p>" : "") +
        ((c.status === "rejected" || c.status === "suspended") && c.reason ? '<p class="app__reason">Motif : ' + esc(c.reason) + "</p>" : "") +
        '<div class="app__actions">' + actions + "</div>" +
      "</div></article>";
  }

  function renderApps() {
    var q = norm(state.appQuery.trim());
    var list = state.candidates.filter(function (c) {
      if (state.appFilter !== "all" && c.status !== state.appFilter) return false;
      if (!q) return true;
      return norm([c.name, c.city, c.commune, c.phone, c.email, c.social].join(" ")).indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      /* Les plus anciennes en attente d'abord, sinon les plus récentes */
      return state.appFilter === "pending" ? cmpTime(a.created, b.created) : cmpTime(b.created, a.created);
    });
    var box = $("#appList");
    if (!list.length) {
      var msg = state.appFilter === "pending" ? "Aucune candidature à examiner. Tout est à jour !" : "Aucune candidate dans cette catégorie.";
      box.innerHTML = '<div class="empty" style="grid-column:1/-1">' + msg + "</div>";
      return;
    }
    box.innerHTML = list.map(appCard).join("");
  }

  async function updateStatus(id, status, reason, btn) {
    var c = state.candidates.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    if (btn) btn.classList.add("is-loading");
    try {
      if (DEMO) {
        await sleep(300);
        c.status = status; c.reason = reason || "";
      } else {
        var patch = {
          status: status,
          rejection_reason: reason || null,
          validated_at: status === "approved" ? new Date().toISOString() : null
        };
        var r = await sb.from(DB.candidates).update(patch).eq("id", id);
        if (r.error) throw r.error;
        c.status = status; c.reason = reason || "";
      }
      var labels = { approved: "validée", rejected: "refusée", suspended: "suspendue", pending: "remise en attente" };
      toast(c.name + " : candidature " + labels[status] + ".", status === "approved" ? "success" : null);
      renderAll();
      if (!DEMO) loadAll();
    } catch (err) {
      console.error(err);
      toast("Action impossible : " + (err.message || "erreur"), "error", 6000);
      if (btn) btn.classList.remove("is-loading");
    }
  }

  /* ----- Fenêtre de refus / suspension ----- */
  function openReject(id, mode) {
    var c = state.candidates.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    state.rejectId = id; state.rejectMode = mode;
    setText("rejectTitle", mode === "suspend" ? "Suspendre la candidate" : "Refuser la candidature");
    setText("rejectName", c.name + " · " + c.city);
    $("#rejectReason").value = "";
    $("#rejectNote").value = "";
    setErr("rejectError", "");
    openModal("rejectModal");
  }
  function confirmReject() {
    var reason = $("#rejectReason").value;
    var note = $("#rejectNote").value.trim();
    if (!reason && !note) return setErr("rejectError", "Choisissez un motif ou écrivez une précision.");
    var full = [reason, note].filter(Boolean).join(" — ");
    var btn = $("#rejectConfirm");
    closeModal("rejectModal");
    updateStatus(state.rejectId, state.rejectMode === "suspend" ? "suspended" : "rejected", full, null);
    btn.classList.remove("is-loading");
  }

  /* =========================================================
     8. RENDU : PAIEMENTS
     ========================================================= */
  function renderOrders() {
    var all = state.orders;
    var cnt = { all: all.length, paid: 0, pending: 0, failed: 0 };
    all.forEach(function (o) { if (cnt[o.status] != null) cnt[o.status]++; });
    $$("[data-ocount]").forEach(function (el) { el.textContent = cnt[el.getAttribute("data-ocount")] || 0; });

    var list = all.filter(function (o) { return state.orderFilter === "all" || o.status === state.orderFilter; });
    var body = $("#ordersBody");
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:34px;color:var(--muted)">Aucun paiement dans cette catégorie.</td></tr>';
    } else {
      body.innerHTML = list.map(function (o) {
        var st = ORDER_STATUS[o.status] || ORDER_STATUS.pending;
        return "<tr>" +
          "<td>" + fmtDateTime(o.created) + "<small>" + ago(o.created) + "</small></td>" +
          "<td>" + esc(o.voterName || "—") + "<small>" + esc(o.voterEmail) + "</small></td>" +
          "<td>" + esc(o.candidateName) + "</td>" +
          '<td class="num">' + fmt.number(o.qty) + "</td>" +
          '<td class="num"><b>' + fmt.cdf(o.amount) + "</b></td>" +
          '<td><span class="badge ' + st.cls + '">' + st.label + "</span></td>" +
          '<td class="ref">' + esc(String(o.ref).slice(0, 14)) + "</td>" +
          "<td>" + (o.status === "pending" && !DEMO ? '<button class="btn btn--ghost btn--sm" data-recheck="' + esc(o.id) + '">Revérifier</button>' : "") + "</td></tr>";
      }).join("");
    }
    var total = state.summary ? state.summary.paid + state.summary.pending + state.summary.failed : all.length;
    setText("ordersNote", "Affichage des " + all.length + " derniers paiements" + (total > all.length ? " sur " + fmt.number(total) + " au total. Utilisez l'export CSV pour l'historique complet côté Supabase." : "."));
  }

  async function recheckOrder(id, btn) {
    btn.classList.add("is-loading");
    try {
      var r = await fetch(cfg.api.checkPayment + "?order=" + encodeURIComponent(id), { headers: { Accept: "application/json" } });
      var j = await r.json();
      if (j.status === "paid") toast("Paiement confirmé : votes ajoutés.", "success");
      else if (j.status === "failed") toast("Ce paiement a échoué.", "error");
      else toast("Toujours en attente côté opérateur.");
      await loadAll();
    } catch (e) {
      toast("Vérification impossible pour le moment.", "error");
    } finally {
      btn.classList.remove("is-loading");
    }
  }

  /* =========================================================
     9. RENDU : GAINS
     ========================================================= */
  function renderEarnings() {
    var s = state.summary || { gross: 0 };
    var e = MDR.computeEarnings(s.gross);
    var rank = ranking();
    var shares = cfg.prizeShares;

    var html =
      '<article class="earn earn--me"><span class="earn__tag">Moi</span>' +
        '<div class="earn__avatar-empty" style="background:rgba(255,255,255,.12);color:#fff">' + icon("award") + "</div>" +
        "<h3>Organisation</h3>" +
        '<div class="earn__amount">' + fmt.cdf(e.organizer) + "</div>" +
        '<div class="earn__usd">≈ ' + usd(e.organizer) + "</div>" +
        '<span class="earn__pct">' + fmt.percent(cfg.organizerShare) + " des recettes nettes</span></article>";

    for (var i = 0; i < 3; i++) {
      var c = rank[i];
      var ph = c ? digits(c.phone) : "";
      var rk = ["1re", "2e", "3e"][i];
      html += '<article class="earn earn--' + (i + 1) + '"><span class="earn__tag">' + rk + " place</span>" +
        (c ? '<img src="' + esc(c.photo) + '" alt="" data-zoom="' + esc(c.photo) + '" width="76" height="76">' : '<div class="earn__avatar-empty">?</div>') +
        "<h3>" + (c ? esc(c.name) : "Place vacante") + "</h3>" +
        '<div class="earn__amount">' + fmt.cdf(e.prizes[i]) + "</div>" +
        '<div class="earn__usd">≈ ' + usd(e.prizes[i]) + "</div>" +
        '<span class="earn__pct">' + fmt.percent(shares[i]) + " de la cagnotte</span>" +
        (c ? '<div class="earn__contact"><span class="muted">' + fmt.number(c.votes) + " " + plural(c.votes, "vote", "votes") + "</span>" +
          (ph ? '<a class="btn btn--wa btn--sm" href="https://wa.me/' + ph + '" target="_blank" rel="noopener">' + icon("chat") + " WhatsApp</a>" : "") + "</div>" : "") +
        "</article>";
    }
    $("#earnCards").innerHTML = html;

    var rows = [
      ["", "Total encaissé (votes payés)", fmt.cdf(e.gross)],
      ["minus", "Frais mobile money (" + fmt.percent(cfg.feePercent) + ")", "− " + fmt.cdf(e.fee)],
      ["sep", "Recettes nettes", fmt.cdf(e.net)],
      ["plus", "Ma part (" + fmt.percent(cfg.organizerShare) + ")", fmt.cdf(e.organizer)],
      ["sep", "Cagnotte des gagnantes (" + fmt.percent(cfg.poolShare) + ")", fmt.cdf(e.pool)],
      ["", "· 1re place (" + fmt.percent(shares[0]) + " de la cagnotte)", fmt.cdf(e.prizes[0])],
      ["", "· 2e place (" + fmt.percent(shares[1]) + " de la cagnotte)", fmt.cdf(e.prizes[1])],
      ["", "· 3e place (" + fmt.percent(shares[2]) + " de la cagnotte)", fmt.cdf(e.prizes[2])]
    ];
    $("#calcBody").innerHTML = rows.map(function (r) {
      return '<tr class="' + r[0] + '"><td>' + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>";
    }).join("");
  }

  /* ----- Exports ----- */
  function exportWinners() {
    var e = MDR.computeEarnings((state.summary || {}).gross || 0);
    var rank = ranking().slice(0, 3);
    if (!rank.length) return toast("Aucune gagnante à exporter.", "error");
    downloadCsv("gagnantes-miss-digital-rdc.csv",
      ["Rang", "Nom", "Âge", "Ville", "Téléphone", "Email", "Votes", "Gain (CDF)", "Gain (USD)"],
      rank.map(function (c, i) {
        return [i + 1, c.name, c.age, c.city, c.phone, c.email, c.votes, e.prizes[i], (e.prizes[i] / cfg.votePriceCDF * cfg.votePriceUSD).toFixed(2)];
      }));
  }
  function exportCandidates() {
    if (!state.candidates.length) return toast("Aucune candidate.", "error");
    downloadCsv("candidates-miss-digital-rdc.csv",
      ["Nom", "Statut", "Âge", "Ville", "Commune", "Téléphone", "Email", "Réseau social", "Votes", "Inscrite le"],
      state.candidates.map(function (c) {
        return [c.name, (CAND_STATUS[c.status] || {}).label, c.age, c.city, c.commune, c.phone, c.email, c.social, c.votes, c.created];
      }));
  }
  function exportOrders() {
    if (!state.orders.length) return toast("Aucun paiement.", "error");
    downloadCsv("paiements-miss-digital-rdc.csv",
      ["Date", "Statut", "Votant", "Email", "Téléphone", "Candidate", "Votes", "Montant (CDF)", "Référence"],
      state.orders.map(function (o) {
        return [o.created, (ORDER_STATUS[o.status] || {}).label, o.voterName, o.voterEmail, o.voterPhone, o.candidateName, o.qty, o.amount, o.ref];
      }));
  }

  /* =========================================================
     10. RENDU GLOBAL
     ========================================================= */
  function renderAll() {
    renderPhase();
    renderBadges();
    renderLeader();
    renderKpis();
    renderChart();
    renderTop3();
    renderRank();
    renderApps();
    renderOrders();
    renderEarnings();
    MDR.applyTokens(document);
    if (state.lastUpdate) {
      setText("lastUpdate", "Mis à jour à " + state.lastUpdate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" }));
    }
  }

  function switchTab(tab) {
    if (!TAB_TITLES[tab]) tab = "overview";
    state.tab = tab;
    $$("[data-tab]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-tab") === tab); });
    $$("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== tab; });
    setText("pageTitle", TAB_TITLES[tab]);
    document.title = TAB_TITLES[tab] + " – Admin Miss Digital RDC";
    if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* =========================================================
     11. MODALES
     ========================================================= */
  function openModal(id) {
    var m = document.getElementById(id);
    m.hidden = false;
    document.body.classList.add("modal-open");
    var f = $(".modal__close", m);
    if (f) f.focus({ preventScroll: true });
  }
  function closeModal(id) {
    var m = typeof id === "string" ? document.getElementById(id) : id;
    if (!m) return;
    m.hidden = true;
    if (!$$(".modal").some(function (x) { return !x.hidden; })) document.body.classList.remove("modal-open");
  }
  function zoomPhoto(src) {
    $("#photoBig").src = src;
    openModal("photoModal");
  }

  /* =========================================================
     12. AUTHENTIFICATION
     ========================================================= */
  async function verifyAdmin() {
    var r = await sb.rpc(DB.isAdminRpc);
    return !r.error && r.data === true;
  }

  function showLogin(msg) {
    $("#loginView").hidden = false;
    $("#appView").hidden = true;
    if (msg) setErr("adminLoginError", msg);
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  async function enterApp(email) {
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    setText("adminUser", email || "");
    $("#demoBadge").hidden = !DEMO;
    switchTab((location.hash || "").replace("#", "") || "overview");
    await loadAll();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (document.visibilityState === "visible" && !$("#appView").hidden) loadAll();
    }, REFRESH_MS);
  }

  async function submitLogin(e) {
    e.preventDefault();
    setErr("adminLoginError", "");
    var email = $("#adminEmail").value.trim().toLowerCase();
    var pass = $("#adminPassword").value;
    if (!isEmail(email) || !pass) return setErr("adminLoginError", "Entrez votre email et votre mot de passe.");
    var btn = $("#adminLoginBtn");
    btn.classList.add("is-loading");
    try {
      if (!sb) throw new Error("Connexion au serveur impossible. Rechargez la page.");
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw new Error(/invalid login/i.test(r.error.message) ? "Email ou mot de passe incorrect." : r.error.message);
      if (!(await verifyAdmin())) {
        await sb.auth.signOut();
        throw new Error("Ce compte n'a pas les droits d'administrateur.");
      }
      $("#adminPassword").value = "";
      await enterApp(email);
    } catch (err) {
      setErr("adminLoginError", err.message || "Connexion impossible.");
    } finally {
      btn.classList.remove("is-loading");
    }
  }

  async function logout() {
    if (sb) await sb.auth.signOut();
    state.candidates = []; state.orders = []; state.summary = null;
    showLogin();
    if (DEMO) enterApp("demo@missdigitalrdc.com");
  }

  /* =========================================================
     13. ÉVÉNEMENTS
     ========================================================= */
  function bind() {
    document.addEventListener("click", function (e) {
      var t = e.target;

      var tab = t.closest("[data-tab]");
      if (tab) { switchTab(tab.getAttribute("data-tab")); return; }

      var af = t.closest("[data-appfilter]");
      if (af) {
        state.appFilter = af.getAttribute("data-appfilter");
        $$("[data-appfilter]").forEach(function (b) { b.classList.toggle("is-active", b === af); });
        renderApps();
        return;
      }

      var of = t.closest("[data-orderfilter]");
      if (of) {
        state.orderFilter = of.getAttribute("data-orderfilter");
        $$("[data-orderfilter]").forEach(function (b) { b.classList.toggle("is-active", b === of); });
        renderOrders();
        return;
      }

      var act = t.closest("[data-act]");
      if (act) {
        var id = act.getAttribute("data-id");
        var a = act.getAttribute("data-act");
        if (a === "approve") updateStatus(id, "approved", "", act);
        else if (a === "restore") updateStatus(id, "pending", "", act);
        else if (a === "reject") openReject(id, "reject");
        else if (a === "suspend") openReject(id, "suspend");
        return;
      }

      var rc = t.closest("[data-recheck]");
      if (rc) { recheckOrder(rc.getAttribute("data-recheck"), rc); return; }

      var z = t.closest("[data-zoom]");
      if (z) { zoomPhoto(z.getAttribute("data-zoom")); return; }

      var cl = t.closest("[data-close]");
      if (cl) { closeModal(cl.closest(".modal")); return; }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") $$(".modal").forEach(function (m) { if (!m.hidden) closeModal(m); });
    });

    var timer;
    $("#appSearch").addEventListener("input", function () {
      var v = this.value;
      clearTimeout(timer);
      timer = setTimeout(function () { state.appQuery = v; renderApps(); }, 180);
    });

    $("#adminLoginForm").addEventListener("submit", submitLogin);
    $("#logoutBtn").addEventListener("click", logout);
    $("#refreshBtn").addEventListener("click", function () { loadAll().then(function () { toast("Données actualisées.", "success", 1800); }); });
    $("#rejectConfirm").addEventListener("click", confirmReject);
    $("#exportWinners").addEventListener("click", exportWinners);
    $("#exportCandidates").addEventListener("click", exportCandidates);
    $("#exportOrders").addEventListener("click", exportOrders);
    $("#exportOrders2").addEventListener("click", exportOrders);

    window.addEventListener("hashchange", function () {
      var h = (location.hash || "").replace("#", "");
      if (h && h !== state.tab && TAB_TITLES[h]) switchTab(h);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !$("#appView").hidden) loadAll();
    });
  }

  /* =========================================================
     14. DÉMARRAGE
     ========================================================= */
  async function boot() {
    bind();
    MDR.applyTokens(document);

    if (DEMO) {
      /* Mode démo : accès direct pour tester l'interface */
      await enterApp("demo@missdigitalrdc.com");
      return;
    }
    if (!sb) { showLogin("La bibliothèque Supabase n'a pas pu se charger. Vérifiez votre connexion."); return; }
    try {
      var s = await sb.auth.getSession();
      if (s.data && s.data.session) {
        if (await verifyAdmin()) { await enterApp(s.data.session.user.email); return; }
        await sb.auth.signOut();
        showLogin("Ce compte n'a pas les droits d'administrateur.");
        return;
      }
    } catch (e) { console.error(e); }
    showLogin();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
