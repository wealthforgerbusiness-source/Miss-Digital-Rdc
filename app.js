/* =========================================================
   MISS DIGITAL RDC — app.js
   Dépend de : config.js (window.MDR) + Supabase JS (CDN)
   ========================================================= */
(function () {
  "use strict";

  var MDR = window.MDR;
  if (!MDR) { console.error("config.js introuvable"); return; }
  var cfg = MDR.cfg;
  var fmt = MDR.fmt;

  document.documentElement.classList.add("js");

  /* =========================================================
     1. OUTILS
     ========================================================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function icon(id, cls) {
    return '<svg class="icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
  }
  function svgUri(svg) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); }
  function plural(n, one, many) { return n > 1 ? many : one; }
  function reducedMotion() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function setErr(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function mark(el, bad) { if (el) el.classList.toggle("is-invalid", !!bad); return !bad; }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim()); }
  function digits(v) { return String(v || "").replace(/\D/g, ""); }
  function cmpTime(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return new Date(a) - new Date(b);
  }

  /* Effets cœurs (styles injectés pour ne pas toucher style.css) */
  (function injectFx() {
    var st = document.createElement("style");
    st.textContent =
      ".fx-heart{position:fixed;z-index:600;pointer-events:none;color:#e2709b;font-size:var(--s,22px);line-height:1;animation:fxUp var(--t,1.1s) ease-out forwards;will-change:transform,opacity}" +
      "@keyframes fxUp{0%{opacity:0;transform:translate(0,0) scale(.4)}15%{opacity:1}100%{opacity:0;transform:translate(var(--x,0),-170px) scale(1.2) rotate(var(--r,0deg))}}";
    document.head.appendChild(st);
  })();

  function heartBurst(x, y, n) {
    if (reducedMotion()) return;
    n = n || 9;
    var colors = ["#e2709b", "#f4a7c3", "#182b5f", "#2a4194"];
    for (var i = 0; i < n; i++) {
      var h = document.createElement("span");
      h.className = "fx-heart";
      h.textContent = "\u2665";
      h.style.left = x + "px";
      h.style.top = y + "px";
      h.style.color = colors[i % colors.length];
      h.style.setProperty("--x", (Math.random() * 120 - 60) + "px");
      h.style.setProperty("--r", (Math.random() * 60 - 30) + "deg");
      h.style.setProperty("--s", (16 + Math.random() * 20) + "px");
      h.style.setProperty("--t", (0.9 + Math.random() * 0.7) + "s");
      document.body.appendChild(h);
      setTimeout((function (el) { return function () { el.remove(); }; })(h), 1800);
    }
  }

  function toast(msg, type, ms) {
    var box = $("#toasts");
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast" + (type && type !== "info" ? " toast--" + type : "");
    t.setAttribute("role", type === "error" ? "alert" : "status");
    t.innerHTML = "<span>" + esc(msg) + "</span>";
    box.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-leaving");
      setTimeout(function () { t.remove(); }, 320);
    }, ms || 4500);
  }

  /* =========================================================
     2. SUPABASE + MODE DÉMO
     ========================================================= */
  var isPlaceholder =
    !cfg.supabase || !cfg.supabase.url || !cfg.supabase.anonKey ||
    /VOTRE-PROJET/i.test(cfg.supabase.url) || /VOTRE_CLE/i.test(cfg.supabase.anonKey);
  var DEMO = isPlaceholder;
  var sb = null;
  if (!DEMO && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  var PLACEHOLDER = svgUri(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><rect width="600" height="800" fill="#e7ebf8"/>' +
    '<circle cx="300" cy="330" r="110" fill="#f4a7c3"/><path d="M110 760c10-170 90-250 190-250s180 80 190 250z" fill="#182b5f"/></svg>'
  );

  var photoCache = {};
  function photoUrl(path) {
    if (!path) return PLACEHOLDER;
    if (/^(data:|https?:|blob:)/.test(path)) return path;
    if (photoCache[path]) return photoCache[path];
    if (!sb) return PLACEHOLDER;
    var u = sb.storage.from(cfg.db.photosBucket).getPublicUrl(path).data.publicUrl;
    photoCache[path] = u;
    return u;
  }

  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && t.dataset.fb !== "1" &&
        t.matches(".cand-card__img,.podium__avatar img,.vote-candidate__img,.profile__img,#spacePhoto,.recap__photo")) {
      t.dataset.fb = "1";
      t.src = PLACEHOLDER;
    }
  }, true);

  /* =========================================================
     3. ÉTAT
     ========================================================= */
  var state = {
    candidates: [],
    stats: null,
    currency: "CDF",
    loaded: false,
    demoSeeded: false,
    cameraStream: null,
    facing: "user",
    photoBlob: null,
    photoObjectUrl: null,
    regStep: 1,
    mySpaceRow: null
  };
  try {
    var savedCur = localStorage.getItem("mdr_currency");
    if (savedCur === "USD" || savedCur === "CDF") state.currency = savedCur;
  } catch (e) {}

  function normalize(r) {
    var first = r.first_name || "";
    var last = r.last_name || "";
    return {
      id: r.id,
      name: (r.name || (first + " " + last)).trim() || "Candidate",
      age: r.age,
      city: r.city || "",
      commune: r.commune || "",
      bio: r.bio || "",
      social: r.social || "",
      photo: photoUrl(r.photo_path || r.photo_url),
      votes: Number(r.votes_count != null ? r.votes_count : (r.votes || 0)),
      created: r.created_at,
      lastVote: r.last_vote_at,
      rank: 0
    };
  }
  function rankList(list) {
    list.sort(function (a, b) {
      return (b.votes - a.votes) || cmpTime(a.lastVote, b.lastVote) || cmpTime(a.created, b.created);
    });
    list.forEach(function (c, i) { c.rank = i + 1; });
  }
  function findCandidate(id) {
    for (var i = 0; i < state.candidates.length; i++) {
      if (String(state.candidates[i].id) === String(id)) return state.candidates[i];
    }
    return null;
  }

  /* ---------- Données de démonstration ---------- */
  function demoAvatar(name, i) {
    var pals = [["#182b5f", "#f4a7c3"], ["#2a4194", "#e2709b"], ["#0f1c42", "#f4a7c3"], ["#e2709b", "#182b5f"], ["#2a4194", "#f4a7c3"]];
    var pal = pals[i % pals.length];
    var ini = name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
    return svgUri(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + pal[0] + '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>' +
      '<rect width="600" height="800" fill="url(#g)"/><circle cx="300" cy="320" r="120" fill="rgba(255,255,255,.28)"/>' +
      '<path d="M100 800c10-180 90-270 200-270s190 90 200 270z" fill="rgba(255,255,255,.28)"/>' +
      '<text x="300" y="360" text-anchor="middle" font-family="Arial,sans-serif" font-size="110" font-weight="700" fill="#fff">' + ini + "</text></svg>"
    );
  }
  function seedDemo() {
    var rows = [
      ["Aimée Kabongo", "Kinshasa", "Gombe", 23, 1840],
      ["Grâce Mbuyi", "Lubumbashi", "Kenya", 25, 1522],
      ["Nadège Tshimanga", "Goma", "Himbi", 22, 1310],
      ["Dorcas Ilunga", "Kinshasa", "Limete", 24, 965],
      ["Esther Mukendi", "Mbuji-Mayi", "Diulu", 21, 842],
      ["Prisca Kalala", "Kisangani", "Makiso", 26, 611],
      ["Merveille Lumbu", "Matadi", "Mvuzi", 20, 455],
      ["Chancelle Mwamba", "Kolwezi", "Manika", 27, 302],
      ["Divine Ngoy", "Kinshasa", "Ngaliema", 22, 188]
    ];
    state.candidates = rows.map(function (r, i) {
      return {
        id: "demo-" + (i + 1), name: r[0], city: r[1], commune: r[2], age: r[3], votes: r[4],
        bio: "Passionnée de mode, de technologie et de culture congolaise. Candidate de démonstration.",
        social: "@" + r[0].split(" ")[0].toLowerCase(),
        photo: demoAvatar(r[0], i), created: new Date(Date.now() - i * 86400000).toISOString(), lastVote: null, rank: 0
      };
    });
    rankList(state.candidates);
    state.demoSeeded = true;
  }

  /* =========================================================
     4. CHARGEMENT DES DONNÉES
     ========================================================= */
  function normalizeStats(d) {
    if (Array.isArray(d)) d = d[0];
    if (!d) return null;
    return {
      candidates: Number(d.candidates || 0),
      votes: Number(d.votes || 0),
      cities: Number(d.cities || 0),
      totalCDF: Number(d.total_cdf || 0)
    };
  }
  function computeLocalStats() {
    var cities = {};
    var votes = 0;
    state.candidates.forEach(function (c) { votes += c.votes; if (c.city) cities[norm(c.city)] = 1; });
    return {
      candidates: state.candidates.length,
      votes: votes,
      cities: Object.keys(cities).length,
      totalCDF: votes * cfg.votePriceCDF
    };
  }

  async function loadData() {
    if (DEMO) {
      if (!state.demoSeeded) seedDemo();
      state.stats = computeLocalStats();
      return;
    }
    if (!sb) throw new Error("Bibliothèque Supabase non chargée");
    var res = await Promise.all([
      sb.from(cfg.db.publicCandidatesView).select("*").limit(1000),
      sb.rpc(cfg.db.statsRpc)
    ]);
    if (res[0].error) throw res[0].error;
    state.candidates = (res[0].data || []).map(normalize);
    rankList(state.candidates);
    state.stats = (!res[1].error && normalizeStats(res[1].data)) || computeLocalStats();
  }

  async function refreshAll(opts) {
    opts = opts || {};
    try {
      await loadData();
      state.loaded = true;
      renderAll();
      if (!$("#modal-space").hidden) refreshSpace();
    } catch (err) {
      console.error(err);
      if (!state.loaded) {
        state.loaded = true;
        state.candidates = [];
        renderAll();
      }
      if (!opts.silent) toast("Impossible de charger les candidates. Vérifiez votre connexion.", "error");
    }
  }

  /* =========================================================
     5. AFFICHAGE : stats, hero, podium, grille, packs
     ========================================================= */
  function countTo(el, to) {
    if (!el) return;
    to = Math.max(0, Math.round(to));
    var from = el._v || 0;
    el._v = to;
    if (from === to || reducedMotion()) { el.textContent = fmt.number(to); return; }
    var t0 = performance.now(), d = 900;
    function step(t) {
      var p = Math.min(1, (t - t0) / d);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt.number(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function renderStats() {
    var s = state.stats || computeLocalStats();
    countTo($('[data-stat="candidates"]'), s.candidates);
    countTo($('[data-stat="votes"]'), s.votes);
    countTo($('[data-stat="cities"]'), s.cities);

    var box = $("#poolBox");
    if (box) {
      if (cfg.showPrizePool) {
        box.hidden = false;
        $("#poolAmount").textContent = fmt.cdf(MDR.computeEarnings(s.totalCDF).pool);
      } else {
        box.hidden = true;
      }
    }
  }

  function renderHeroLeader() {
    var box = $("#heroLeader");
    var top = state.candidates[0];
    if (!box) return;
    if (!top || top.votes < 1) { box.hidden = true; return; }
    $("#heroLeaderName").textContent = top.name;
    $("#heroLeaderVotes").textContent = fmt.number(top.votes);
    box.hidden = false;
  }

  function renderPodium() {
    var box = $("#podium");
    if (!box) return;
    var top = state.candidates.slice(0, 3);
    if (!top.length) {
      box.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center">Le classement apparaîtra dès les premières candidatures validées.</p>';
      return;
    }
    box.innerHTML = top.map(function (c, i) {
      var r = i + 1;
      return '<div class="podium__slot podium__slot--' + r + '">' +
        (r === 1 ? icon("crown", "icon--fill podium__crown") : "") +
        '<div class="podium__avatar" role="button" tabindex="0" data-profile="' + esc(c.id) + '" aria-label="Voir le profil de ' + esc(c.name) + '">' +
          '<img src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" width="164" height="164">' +
          '<span class="podium__medal">' + r + "</span></div>" +
        '<strong class="podium__name">' + esc(c.name) + "</strong>" +
        '<span class="podium__votes">' + fmt.number(c.votes) + " " + plural(c.votes, "vote", "votes") + "</span>" +
        '<div class="podium__bar"></div></div>';
    }).join("");
  }

  function renderCityFilter() {
    var sel = $("#cityFilter");
    if (!sel) return;
    var cur = sel.value;
    var cities = {};
    state.candidates.forEach(function (c) { if (c.city) cities[c.city] = 1; });
    var names = Object.keys(cities).sort(function (a, b) { return a.localeCompare(b, "fr"); });
    sel.innerHTML = '<option value="">Toutes les villes</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    if (names.indexOf(cur) !== -1) sel.value = cur;
  }

  function filteredList() {
    var q = norm($("#searchInput").value.trim());
    var city = $("#cityFilter").value;
    var sort = $("#sortSelect").value;
    var list = state.candidates.filter(function (c) {
      return (!city || c.city === city) && (!q || norm(c.name + " " + c.city + " " + c.commune).indexOf(q) !== -1);
    });
    if (sort === "recent") list.sort(function (a, b) { return new Date(b.created || 0) - new Date(a.created || 0); });
    else if (sort === "name") list.sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function cardHtml(c, i) {
    return '<article class="cand-card" style="animation-delay:' + (Math.min(i, 12) * 50) + 'ms">' +
      '<div class="cand-card__media" role="button" tabindex="0" data-profile="' + esc(c.id) + '" aria-label="Voir le profil de ' + esc(c.name) + '">' +
        '<img class="cand-card__img" src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" loading="lazy" width="300" height="400">' +
        '<span class="cand-card__rank' + (c.rank === 1 ? " cand-card__rank--1" : "") + '">#' + c.rank + "</span>" +
        '<span class="cand-card__votes">' + icon("heart", "icon--fill") + " " + fmt.number(c.votes) + "</span>" +
        '<button class="cand-card__heart" type="button" data-vote-for="' + esc(c.id) + '" data-heart aria-label="Voter pour ' + esc(c.name) + '">' + icon("heart") + "</button>" +
      "</div>" +
      '<div class="cand-card__body">' +
        '<h3 class="cand-card__name">' + esc(c.name) + "</h3>" +
        '<p class="cand-card__meta">' + icon("pin") + " " + esc(c.city) + (c.age ? " · " + esc(c.age) + " ans" : "") + "</p>" +
        '<button class="btn btn--primary cand-card__vote" type="button" data-vote-for="' + esc(c.id) + '">' + icon("heart", "icon--fill") + " Voter</button>" +
      "</div></article>";
  }

  function renderGrid() {
    var grid = $("#candidatesGrid");
    var empty = $("#candidatesEmpty");
    var count = $("#candidatesCount");
    if (!state.candidates.length) {
      grid.hidden = true;
      empty.hidden = false;
      count.textContent = "";
      return;
    }
    grid.hidden = false;
    empty.hidden = true;
    var list = filteredList();
    count.textContent = list.length + " " + plural(list.length, "candidate", "candidates") + " affichée" + (list.length > 1 ? "s" : "");
    if (!list.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Aucun résultat</h3><p>Essayez un autre nom ou une autre ville.</p></div>';
      return;
    }
    grid.innerHTML = list.map(cardHtml).join("");
  }

  function packPriceLabels(qty) {
    var main = fmt.price(qty, state.currency);
    var other = state.currency === "CDF" ? fmt.price(qty, "USD") : fmt.price(qty, "CDF");
    return { main: main, other: other };
  }

  function renderPacks() {
    var box = $("#packsGrid");
    if (!box) return;
    box.innerHTML = cfg.packs.map(function (p, i) {
      var pr = packPriceLabels(p.qty);
      return '<article class="pack' + (p.popular ? " pack--popular" : "") + '" data-reveal style="--d:' + (i * 0.07) + 's">' +
        (p.popular ? '<span class="pack__badge">Le plus choisi</span>' : "") +
        '<div class="pack__qty">' + p.qty + "</div>" +
        '<div class="pack__label">' + esc(p.label) + "</div>" +
        '<div class="pack__price">' + pr.main + "</div>" +
        '<div class="pack__sub">≈ ' + pr.other + "</div>" +
        '<button class="btn" type="button" data-pack="' + p.qty + '">Choisir ce pack</button></article>';
    }).join("");
    observeReveals(box);
  }

  function renderAll() {
    renderStats();
    renderHeroLeader();
    renderPodium();
    renderCityFilter();
    renderGrid();
    renderVoteSelect();
  }

  /* =========================================================
     6. DEVISE D'AFFICHAGE
     ========================================================= */
  function setCurrency(cur) {
    state.currency = cur;
    try { localStorage.setItem("mdr_currency", cur); } catch (e) {}
    $$("[data-currency]").forEach(function (b) {
      var on = b.getAttribute("data-currency") === cur;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderPacks();
    renderVotePacks();
    updateVoteTotal();
  }

  /* =========================================================
     7. MODALES
     ========================================================= */
  var modals = {
    vote: $("#modal-vote"),
    register: $("#modal-register"),
    space: $("#modal-space"),
    candidate: $("#modal-candidate"),
    rules: $("#modal-rules")
  };
  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  function openModals() { return $$(".modal").filter(function (m) { return !m.hidden; }); }
  function topModal() { var o = openModals(); return o.length ? o[o.length - 1] : null; }

  function openModal(name, opts) {
    var el = modals[name];
    if (!el) return;
    var stack = opts && opts.stack;
    var opener = document.activeElement;
    if (!stack) openModals().forEach(function (m) { if (m !== el) closeModalEl(m, true); });
    el._opener = opener;
    el.hidden = false;
    document.body.classList.add("modal-open");
    if (name === "register") onRegisterOpen();
    if (name === "space") refreshSpace();
    if (name === "rules") {
      $("#rulesBox").scrollTop = 0;
    }
    requestAnimationFrame(function () {
      var f = $(FOCUSABLE, $(".modal__panel", el));
      var close = $(".modal__close", el);
      (close || f) && (close || f).focus({ preventScroll: true });
    });
  }

  function closeModalEl(el, silent) {
    if (!el || el.hidden) return;
    el.hidden = true;
    if (el.id === "modal-register") stopCamera();
    if (!openModals().length) document.body.classList.remove("modal-open");
    if (!silent && el._opener && document.contains(el._opener)) {
      try { el._opener.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  document.addEventListener("keydown", function (e) {
    var top = topModal();
    if (!top) return;
    if (e.key === "Escape") { closeModalEl(top); return; }
    if (e.key === "Tab") {
      var items = $$(FOCUSABLE, top).filter(function (n) { return n.offsetParent !== null; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* =========================================================
     8. VOTE
     ========================================================= */
  function sortedByName() {
    return state.candidates.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "fr"); });
  }

  function renderVoteSelect() {
    var sel = $("#voteCandidateSelect");
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">Choisissez une candidate…</option>' +
      sortedByName().map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + " — " + esc(c.city) + "</option>";
      }).join("");
    if (cur && findCandidate(cur)) sel.value = cur;
    renderVoteCandidate();
  }

  function renderVoteCandidate() {
    var box = $("#voteCandidate");
    var c = findCandidate($("#voteCandidateSelect").value);
    if (!c) { box.innerHTML = ""; return; }
    box.innerHTML = '<img class="vote-candidate__img" src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" width="64" height="64">' +
      "<div><strong>" + esc(c.name) + "</strong><small>" + esc(c.city) + " · " + fmt.number(c.votes) + " " + plural(c.votes, "vote", "votes") +
      " · #" + c.rank + "</small></div>";
  }

  function renderVotePacks() {
    var box = $("#votePacks");
    if (!box) return;
    var checked = $('input[name="votePack"]:checked', box);
    var cur = checked ? checked.value : null;
    box.innerHTML = cfg.packs.map(function (p) {
      return '<label class="pack-opt">' +
        '<input type="radio" name="votePack" value="' + p.qty + '"' + (String(p.qty) === String(cur) ? " checked" : "") + ">" +
        '<span class="pack-opt__inner"><b>' + p.qty + "</b><span>" + plural(p.qty, "vote", "votes") + "</span><em>" + fmt.price(p.qty, state.currency) + "</em></span>" +
        (p.popular ? '<span class="pack-opt__tag">Populaire</span>' : "") + "</label>";
    }).join("");
  }

  function currentQty() {
    var custom = $("#voteCustom").value.trim();
    if (custom !== "") return Math.floor(Number(custom));
    var r = $('input[name="votePack"]:checked');
    return r ? Number(r.value) : 0;
  }

  function updateVoteTotal() {
    var qty = currentQty();
    var order = MDR.computeOrder(qty);
    var c = findCandidate($("#voteCandidateSelect").value);
    var sum = $("#voteSummary");
    var tot = $("#voteTotal");
    if (!order) {
      sum.textContent = "Sélectionnez un pack";
      tot.textContent = "—";
      return;
    }
    tot.textContent = fmt.price(order.qty, state.currency);
    var base = order.qty + " " + plural(order.qty, "vote", "votes") + (c ? " pour " + c.name : "");
    sum.textContent = state.currency === "USD" ? base + " · débité en " + fmt.cdf(order.amountCDF) : base;
  }

  function votingBlockedMessage() {
    if (DEMO) return "";
    var phase = MDR.votingPhase();
    if (phase === "before") return "Les votes ouvrent le " + fmt.date(cfg.votingStart) + ".";
    if (phase === "closed") return "Les votes sont clôturés. Merci pour votre soutien !";
    return "";
  }

  function openVote(o) {
    o = o || {};
    var blocked = votingBlockedMessage();
    if (blocked) { toast(blocked, "info", 6000); return; }
    if (!state.candidates.length) { toast("Aucune candidate pour le moment.", "info"); return; }
    renderVoteSelect();
    renderVotePacks();
    if (o.candidateId) $("#voteCandidateSelect").value = String(o.candidateId);
    renderVoteCandidate();
    if (o.qty) {
      $("#voteCustom").value = "";
      var r = $('input[name="votePack"][value="' + o.qty + '"]');
      if (r) r.checked = true;
      else $("#voteCustom").value = o.qty;
    }
    setErr("voteError", "");
    updateVoteTotal();
    openModal("vote");
  }

  async function submitVote(e) {
    e.preventDefault();
    setErr("voteError", "");
    var blocked = votingBlockedMessage();
    if (blocked) return setErr("voteError", blocked);

    var selEl = $("#voteCandidateSelect");
    var nameEl = $("#voterName");
    var mailEl = $("#voterEmail");
    var accEl = $("#voteAccept");
    var qty = currentQty();
    var order = MDR.computeOrder(qty);
    var cand = findCandidate(selEl.value);

    var ok = true;
    ok = mark(selEl, !cand) && ok;
    ok = mark(nameEl, nameEl.value.trim().length < 2) && ok;
    ok = mark(mailEl, !isEmail(mailEl.value)) && ok;
    if (!ok) return setErr("voteError", "Vérifiez les champs en rouge.");
    if (!order) return setErr("voteError", "Choisissez un pack ou une quantité valide (" + cfg.minVotes + " à " + fmt.number(cfg.maxVotes) + " votes).");
    if (!accEl.checked) return setErr("voteError", "Vous devez accepter le règlement pour continuer.");

    var btn = $("#votePay");
    btn.classList.add("is-loading");

    try {
      if (DEMO) {
        await sleep(800);
        cand.votes += order.qty;
        rankList(state.candidates);
        state.stats = computeLocalStats();
        renderAll();
        var r = btn.getBoundingClientRect();
        heartBurst(r.left + r.width / 2, r.top, 14);
        closeModalEl(modals.vote, true);
        document.body.classList.remove("modal-open");
        toast("Mode démo : " + order.qty + " " + plural(order.qty, "vote ajouté", "votes ajoutés") + " à " + cand.name + ". Le vrai paiement sera actif après connexion à SasPay.", "success", 7000);
        return;
      }

      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 25000);
      var res = await fetch(cfg.api.createCheckout, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          candidate_id: cand.id,
          qty: order.qty,
          voter_name: nameEl.value.trim(),
          voter_email: mailEl.value.trim(),
          voter_phone: digits($("#voterPhone").value)
        }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      var json = {};
      try { json = await res.json(); } catch (x) {}
      if (!res.ok || !json.checkout_url) {
        throw new Error(json.error || "Impossible de lancer le paiement. Réessayez dans un instant.");
      }
      toast("Redirection vers le paiement sécurisé…", "info", 4000);
      window.location.href = json.checkout_url;
    } catch (err) {
      var msg = err && err.name === "AbortError"
        ? "Le serveur met trop de temps à répondre. Réessayez."
        : (err && err.message ? err.message : "Une erreur est survenue.");
      setErr("voteError", msg);
    } finally {
      btn.classList.remove("is-loading");
    }
  }

  /* Retour de paiement : ?order=ID */
  async function handleReturn(orderId) {
    toast("Vérification de votre paiement…", "info", 5000);
    for (var i = 0; i < 10; i++) {
      try {
        var r = await fetch(cfg.api.checkPayment + "?order=" + encodeURIComponent(orderId), { headers: { "Accept": "application/json" } });
        var j = await r.json();
        if (j.status === "paid") {
          heartBurst(window.innerWidth / 2, window.innerHeight / 2, 22);
          toast("Merci ! " + j.qty + " " + plural(j.qty, "vote ajouté", "votes ajoutés") + (j.candidate_name ? " à " + j.candidate_name : "") + ".", "success", 8000);
          refreshAll({ silent: true });
          return;
        }
        if (j.status === "failed") {
          toast("Le paiement n'a pas abouti. Aucun vote n'a été ajouté.", "error", 8000);
          return;
        }
      } catch (e) { /* on réessaie */ }
      await sleep(3000);
    }
    toast("Paiement en cours de confirmation. Vos votes apparaîtront dans quelques instants.", "info", 9000);
    refreshAll({ silent: true });
  }

  /* =========================================================
     9. PROFIL D'UNE CANDIDATE + PARTAGE
     ========================================================= */
  function shareLink(id) { return location.origin + "/?c=" + encodeURIComponent(id); }

  function openProfile(id) {
    var c = findCandidate(id);
    if (!c) return;
    $("#candidateDetail").innerHTML =
      '<img class="profile__img" src="' + esc(c.photo) + '" alt="' + esc(c.name) + '" width="460" height="506">' +
      '<div class="profile__body">' +
        '<h2 id="candName">' + esc(c.name) + "</h2>" +
        '<div class="profile__meta">' +
          "<span>" + icon("pin") + " " + esc(c.city) + (c.commune ? " · " + esc(c.commune) : "") + "</span>" +
          (c.age ? "<span>" + esc(c.age) + " ans</span>" : "") +
          (c.social ? "<span>" + esc(c.social) + "</span>" : "") +
        "</div>" +
        (c.bio ? '<p class="profile__bio">' + esc(c.bio) + "</p>" : "") +
        '<div class="profile__stats">' +
          "<div><strong>" + fmt.number(c.votes) + "</strong><span>" + plural(c.votes, "vote", "votes") + "</span></div>" +
          "<div><strong>#" + c.rank + "</strong><span>au classement</span></div>" +
        "</div>" +
        '<div class="profile__actions">' +
          '<button class="btn btn--primary btn--lg btn--block" type="button" data-vote-for="' + esc(c.id) + '">' + icon("heart", "icon--fill") + " Voter pour " + esc(c.name.split(" ")[0]) + "</button>" +
          '<button class="btn btn--ghost btn--block" type="button" data-share-for="' + esc(c.id) + '">' + icon("share") + " Partager ce profil</button>" +
        "</div></div>";
    openModal("candidate");
  }

  async function shareCandidate(id) {
    var c = findCandidate(id);
    if (!c) return;
    var url = shareLink(id);
    var text = "Votez pour " + c.name + " au concours Miss Digital RDC !";
    if (navigator.share) {
      try { await navigator.share({ title: "Miss Digital RDC", text: text, url: url }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    copyText(url, "Lien copié. Partagez-le sur WhatsApp, Facebook, TikTok…");
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || "Copié !", "success");
    } catch (e) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(okMsg || "Copié !", "success"); }
      catch (x) { toast("Copiez le lien manuellement.", "error"); }
      ta.remove();
    }
  }

  /* =========================================================
     10. INSCRIPTION : étapes, caméra, envoi
     ========================================================= */
  function onRegisterOpen() {
    if (!$("#regSuccess").hidden) resetRegistration();
    setTimeout(checkRulesScroll, 60);
    goStep(state.regStep);
  }

  function checkRulesScroll() {
    var box = $("#regRules");
    var acc = $("#regAccept");
    if (!box || !acc) return;
    var atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 12;
    if (atEnd || box.scrollHeight <= box.clientHeight + 4) acc.disabled = false;
  }

  function goStep(n) {
    state.regStep = n;
    $$(".reg-step").forEach(function (s) {
      var on = Number(s.getAttribute("data-step")) === n;
      s.hidden = !on;
      s.classList.toggle("is-active", on);
    });
    $$("#regProgress .stepper__item").forEach(function (d) {
      var i = Number(d.getAttribute("data-dot"));
      d.classList.toggle("is-active", i === n);
      d.classList.toggle("is-done", i < n);
    });
    $("#regPrev").hidden = n === 1;
    $("#regNext").hidden = n === 4;
    $("#regSubmit").hidden = n !== 4;
    setErr("regError", "");
    if (n !== 2) stopCamera();
    if (n === 4) buildRecap();
    var panel = $(".modal__panel", modals.register);
    if (panel) panel.scrollTop = 0;
  }

  function validateStep(n) {
    setErr("regError", "");
    if (n === 1) {
      if (!$("#regAccept").checked) { setErr("regError", "Lisez le règlement jusqu'en bas puis cochez la case pour continuer."); return false; }
      return true;
    }
    if (n === 2) {
      if (!state.photoBlob) { setErr("regError", "Prenez votre photo en direct pour continuer."); return false; }
      return true;
    }
    if (n === 3) {
      var ok = true;
      ok = mark($("#regFirstName"), $("#regFirstName").value.trim().length < 2) && ok;
      ok = mark($("#regLastName"), $("#regLastName").value.trim().length < 2) && ok;
      var age = Number($("#regAge").value);
      ok = mark($("#regAge"), !(age >= cfg.minAge && age <= cfg.maxAge)) && ok;
      ok = mark($("#regCity"), $("#regCity").value.trim().length < 2) && ok;
      var ph = digits($("#regPhone").value);
      ok = mark($("#regPhone"), ph.length < 9 || ph.length > 13) && ok;
      if (!ok) {
        var ageBad = !(age >= cfg.minAge && age <= cfg.maxAge);
        setErr("regError", ageBad && $("#regAge").value
          ? "Le concours est réservé aux candidates de " + cfg.minAge + " à " + cfg.maxAge + " ans."
          : "Vérifiez les champs en rouge.");
      }
      return ok;
    }
    if (n === 4) {
      var good = true;
      good = mark($("#regEmail"), !isEmail($("#regEmail").value)) && good;
      var p1 = $("#regPassword").value, p2 = $("#regPassword2").value;
      good = mark($("#regPassword"), p1.length < 8) && good;
      good = mark($("#regPassword2"), p1 !== p2 || !p2) && good;
      if (!good) {
        setErr("regError", p1.length < 8 ? "Le mot de passe doit contenir au moins 8 caractères."
          : (p1 !== p2 ? "Les deux mots de passe ne sont pas identiques." : "Vérifiez les champs en rouge."));
      }
      return good;
    }
    return true;
  }

  function collectRegistration() {
    return {
      first: $("#regFirstName").value.trim(),
      last: $("#regLastName").value.trim(),
      age: Number($("#regAge").value),
      city: $("#regCity").value.trim(),
      commune: $("#regCommune").value.trim(),
      phone: digits($("#regPhone").value),
      social: $("#regSocial").value.trim().slice(0, 60),
      bio: $("#regBio").value.trim().slice(0, 240),
      email: $("#regEmail").value.trim().toLowerCase(),
      password: $("#regPassword").value
    };
  }

  function buildRecap() {
    var d = collectRegistration();
    $("#regRecap").innerHTML =
      (state.photoObjectUrl ? '<img class="recap__photo" src="' + esc(state.photoObjectUrl) + '" alt="Votre photo">' : "") +
      '<div class="recap__row"><span>Nom</span><b>' + esc(d.first + " " + d.last) + "</b></div>" +
      '<div class="recap__row"><span>Âge</span><b>' + esc(d.age) + " ans</b></div>" +
      '<div class="recap__row"><span>Ville</span><b>' + esc(d.city) + (d.commune ? " · " + esc(d.commune) : "") + "</b></div>" +
      '<div class="recap__row"><span>WhatsApp</span><b>' + esc(d.phone) + "</b></div>";
  }

  /* ----- Caméra (photo en direct uniquement) ----- */
  function setCamUI(mode) {
    var box = $("#camBox");
    $("#camStart").hidden = mode !== "idle";
    $("#camCapture").hidden = mode !== "live";
    $("#camRetake").hidden = mode !== "captured";
    $("#camFlip").hidden = mode !== "live" || !state.multiCam;
    $("#camVideo").hidden = mode !== "live";
    $("#camPreview").hidden = mode !== "captured";
    $("#camPlaceholder").hidden = mode !== "idle";
    box.classList.toggle("has-photo", mode === "captured");
  }

  async function startCamera() {
    setErr("camError", "");
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return setErr("camError", "Votre navigateur ne permet pas d'utiliser la caméra. Utilisez Chrome ou Safari à jour.");
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: state.facing }, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false
      });
      state.cameraStream = stream;
      var video = $("#camVideo");
      video.srcObject = stream;
      video.classList.toggle("is-mirrored", state.facing === "user");
      await video.play();
      try {
        var devs = await navigator.mediaDevices.enumerateDevices();
        state.multiCam = devs.filter(function (d) { return d.kind === "videoinput"; }).length > 1;
      } catch (x) { state.multiCam = false; }
      setCamUI("live");
    } catch (err) {
      var m = "Impossible d'activer la caméra.";
      if (err && err.name === "NotAllowedError") m = "Accès à la caméra refusé. Autorisez-la dans les réglages de votre navigateur, puis réessayez.";
      else if (err && err.name === "NotFoundError") m = "Aucune caméra détectée sur cet appareil.";
      else if (err && err.name === "NotReadableError") m = "La caméra est utilisée par une autre application. Fermez-la puis réessayez.";
      setErr("camError", m);
      setCamUI("idle");
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(function (t) { t.stop(); });
      state.cameraStream = null;
    }
    var v = $("#camVideo");
    if (v) { v.pause(); v.srcObject = null; }
    if (state.photoBlob) setCamUI("captured");
    else if ($("#camBox")) setCamUI("idle");
  }

  function capturePhoto() {
    var video = $("#camVideo");
    var vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return setErr("camError", "La caméra n'est pas encore prête. Patientez une seconde.");
    var ratio = 3 / 4;
    var sw, sh, sx, sy;
    if (vw / vh > ratio) { sh = vh; sw = vh * ratio; sx = (vw - sw) / 2; sy = 0; }
    else { sw = vw; sh = vw / ratio; sx = 0; sy = (vh - sh) / 2; }
    var outW = Math.min(cfg.photoMaxWidth, Math.round(sw));
    var outH = Math.round(outW / ratio);
    var canvas = $("#camCanvas");
    canvas.width = outW; canvas.height = outH;
    canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
    canvas.toBlob(function (blob) {
      if (!blob) return setErr("camError", "La capture a échoué. Réessayez.");
      if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
      state.photoBlob = blob;
      state.photoObjectUrl = URL.createObjectURL(blob);
      $("#camPreview").src = state.photoObjectUrl;
      stopCamera();
      setCamUI("captured");
      setErr("regError", "");
    }, "image/jpeg", cfg.photoQuality);
  }

  function retakePhoto() {
    if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
    state.photoBlob = null;
    state.photoObjectUrl = null;
    startCamera();
  }

  function flipCamera() {
    state.facing = state.facing === "user" ? "environment" : "user";
    startCamera();
  }

  function friendlyError(e) {
    var m = (e && (e.message || e.error_description)) || "";
    var code = e && e.code;
    if (m === "EMAIL_CONFIRM") return "Compte créé. Confirmez votre email, puis connectez-vous dans « Mon espace » pour terminer votre candidature.";
    if (/already registered|already been registered|ALREADY_EXISTS/i.test(m)) return "Un compte existe déjà avec cet email. Connectez-vous dans « Mon espace ».";
    if (code === "23505" || /duplicate key/i.test(m)) return "Une candidature existe déjà pour ce compte.";
    if (/password/i.test(m)) return "Mot de passe refusé : choisissez-en un plus solide (8 caractères minimum).";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Réessayez dans quelques minutes.";
    if (/failed to fetch|networkerror|load failed/i.test(m)) return "Problème de connexion. Vérifiez votre internet puis réessayez.";
    if (/row-level security|violates/i.test(m)) return "Action non autorisée. Reconnectez-vous puis réessayez.";
    return "Une erreur est survenue" + (m ? " (" + m + ")" : "") + ". Réessayez.";
  }

  function resetRegistration() {
    $("#registerForm").reset();
    $("#registerForm").hidden = false;
    $("#regProgress").hidden = false;
    $("#regSuccess").hidden = true;
    $("#regAccept").disabled = true;
    $("#regBioCount").textContent = "0";
    if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
    state.photoBlob = null; state.photoObjectUrl = null;
    setCamUI("idle");
    state.regStep = 1;
  }

  function finishRegistration() {
    stopCamera();
    $("#registerForm").hidden = true;
    $("#regProgress").hidden = true;
    $("#regSuccess").hidden = false;
    heartBurst(window.innerWidth / 2, window.innerHeight / 2, 16);
  }

  async function submitRegistration(e) {
    e.preventDefault();
    setErr("regError", "");
    if (!MDR.registrationOpen()) return setErr("regError", "Les inscriptions sont closes depuis le " + fmt.date(cfg.registrationDeadline) + ".");
    for (var s = 1; s <= 4; s++) { if (!validateStep(s)) { goStep(s); validateStep(s); return; } }

    var btn = $("#regSubmit");
    btn.classList.add("is-loading");
    var d = collectRegistration();
    var uploadedPath = null;

    try {
      if (DEMO) { await sleep(1000); finishRegistration(); return; }
      if (!sb) throw new Error("Connexion au serveur impossible. Rechargez la page.");

      var su = await sb.auth.signUp({
        email: d.email, password: d.password,
        options: { data: { full_name: d.first + " " + d.last } }
      });
      if (su.error) throw su.error;
      var user = su.data.user;
      var session = su.data.session;
      if (user && user.identities && user.identities.length === 0) throw new Error("ALREADY_EXISTS");

      if (!session) {
        var si = await sb.auth.signInWithPassword({ email: d.email, password: d.password });
        if (si.error) throw new Error("EMAIL_CONFIRM");
        session = si.data.session; user = si.data.user;
      }

      uploadedPath = user.id + "/profile-" + Date.now() + ".jpg";
      var up = await sb.storage.from(cfg.db.photosBucket).upload(uploadedPath, state.photoBlob, {
        contentType: "image/jpeg", upsert: false, cacheControl: "3600"
      });
      if (up.error) throw up.error;

      var ins = await sb.from(cfg.db.candidatesTable).insert({
        user_id: user.id,
        email: d.email,
        first_name: d.first,
        last_name: d.last,
        age: d.age,
        city: d.city,
        commune: d.commune || null,
        phone: d.phone,
        social: d.social || null,
        bio: d.bio || null,
        photo_path: uploadedPath,
        accepted_rules: true,
        accepted_rules_at: new Date().toISOString()
      });
      if (ins.error) {
        sb.storage.from(cfg.db.photosBucket).remove([uploadedPath]).catch(function () {});
        throw ins.error;
      }
      finishRegistration();
    } catch (err) {
      console.error(err);
      setErr("regError", friendlyError(err));
    } finally {
      btn.classList.remove("is-loading");
    }
  }

  /* =========================================================
     11. MON ESPACE CANDIDATE
     ========================================================= */
  var STATUS = {
    pending:   { label: "En attente de validation", cls: "" },
    approved:  { label: "Candidature validée", cls: "badge--ok" },
    rejected:  { label: "Candidature refusée", cls: "badge--rejected" },
    suspended: { label: "Candidature suspendue", cls: "badge--rejected" }
  };

  function showLogin() {
    $("#loginForm").hidden = false;
    $("#spaceDashboard").hidden = true;
    setErr("loginError", "");
  }

  async function refreshSpace() {
    if (DEMO || !sb) { showLogin(); return; }
    try {
      var s = await sb.auth.getSession();
      var session = s.data && s.data.session;
      if (!session) { showLogin(); return; }
      var r = await sb.from(cfg.db.candidatesTable).select("*").eq("user_id", session.user.id).maybeSingle();
      if (r.error) throw r.error;
      renderSpace(r.data, session);
    } catch (err) {
      console.error(err);
      showLogin();
    }
  }

  function renderSpace(row, session) {
    $("#loginForm").hidden = true;
    $("#spaceDashboard").hidden = false;
    var stats = $(".space-stats");
    var shareBox = $("#spaceShareBox");
    var notice = $("#spaceNotice");
    var badge = $("#spaceStatus");

    if (!row) {
      $("#spacePhoto").src = PLACEHOLDER;
      $("#spaceName").textContent = session.user.email;
      $("#spaceMeta").textContent = "Aucune candidature liée à ce compte";
      badge.textContent = "Pas de candidature";
      badge.className = "badge";
      stats.hidden = true; shareBox.hidden = true;
      notice.hidden = false; notice.className = "notice";
      notice.textContent = "Vous n'avez pas encore envoyé de candidature. Fermez cette fenêtre et cliquez sur « Participer ».";
      return;
    }

    state.mySpaceRow = row;
    var st = STATUS[row.status] || STATUS.pending;
    $("#spacePhoto").src = photoUrl(row.photo_path);
    $("#spaceName").textContent = row.first_name + " " + row.last_name;
    $("#spaceMeta").textContent = row.city + (row.age ? " · " + row.age + " ans" : "");
    badge.textContent = st.label;
    badge.className = "badge " + st.cls;

    notice.hidden = false;
    if (row.status === "approved") {
      notice.className = "notice notice--ok";
      notice.textContent = "Félicitations ! Votre profil est visible sur le site et peut recevoir des votes. Partagez votre lien !";
    } else if (row.status === "rejected" || row.status === "suspended") {
      notice.className = "notice notice--error";
      notice.textContent = row.rejection_reason
        ? "Motif : " + row.rejection_reason
        : "Votre candidature n'a pas été retenue. Contactez-nous pour plus d'informations.";
    } else {
      notice.className = "notice";
      notice.textContent = "Votre candidature est en cours d'examen par l'équipe. Vous serez visible sur le site dès sa validation.";
    }

    var approved = row.status === "approved";
    stats.hidden = !approved;
    shareBox.hidden = !approved;
    if (approved) {
      var mine = findCandidate(row.id);
      var votes = mine ? mine.votes : Number(row.votes_count || 0);
      $("#spaceVotes").textContent = fmt.number(votes);
      $("#spaceRank").textContent = mine ? "#" + mine.rank : "—";
      var link = shareLink(row.id);
      $("#spaceLink").value = link;
      $("#spaceWhatsapp").href = "https://wa.me/?text=" + encodeURIComponent(
        "Votez pour " + row.first_name + " " + row.last_name + " au concours Miss Digital RDC ! \uD83D\uDC96 " + link
      );
    }
  }

  async function submitLogin(e) {
    e.preventDefault();
    setErr("loginError", "");
    if (DEMO || !sb) return setErr("loginError", "Mode démo : la connexion sera disponible après la connexion à Supabase.");
    var email = $("#loginEmail").value.trim().toLowerCase();
    var pass = $("#loginPassword").value;
    if (!isEmail(email) || !pass) return setErr("loginError", "Entrez votre email et votre mot de passe.");
    var btn = $("#loginForm button[type=submit]");
    btn.classList.add("is-loading");
    try {
      var r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) {
        throw new Error(/invalid login/i.test(r.error.message) ? "Email ou mot de passe incorrect." : r.error.message);
      }
      $("#loginPassword").value = "";
      await refreshSpace();
    } catch (err) {
      setErr("loginError", err.message || "Connexion impossible.");
    } finally {
      btn.classList.remove("is-loading");
    }
  }

  async function forgotPassword() {
    if (DEMO || !sb) return toast("Mode démo : indisponible pour le moment.", "info");
    var email = $("#loginEmail").value.trim().toLowerCase();
    if (!isEmail(email)) return setErr("loginError", "Entrez d'abord votre email ci-dessus, puis cliquez sur « Mot de passe oublié ».");
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (r.error) return setErr("loginError", friendlyError(r.error));
    setErr("loginError", "");
    toast("Si un compte existe, un email de réinitialisation vient d'être envoyé.", "success", 7000);
  }

  async function logout() {
    if (sb) await sb.auth.signOut();
    state.mySpaceRow = null;
    showLogin();
    toast("Vous êtes déconnectée.", "info");
  }

  /* =========================================================
     12. INTERFACE GÉNÉRALE : nav, scroll, apparitions, PWA
     ========================================================= */
  function closeNav() {
    $("#mainNav").classList.remove("is-open");
    $("#navToggle").setAttribute("aria-expanded", "false");
  }

  var revealObserver = null;
  function observeReveals(root) {
    var els = $$("[data-reveal]:not(.is-visible)", root || document);
    if (!("IntersectionObserver" in window)) { els.forEach(function (el) { el.classList.add("is-visible"); }); return; }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("is-visible"); revealObserver.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    }
    els.forEach(function (el) { revealObserver.observe(el); });
  }

  function setupScroll() {
    var header = $("#siteHeader");
    var bar = $("#scrollBar");
    var ticking = false;
    function update() {
      var y = window.scrollY || document.documentElement.scrollTop;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      header.classList.toggle("is-scrolled", y > 8);
      bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, y / max) : 0) + ")";
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();

    if ("IntersectionObserver" in window) {
      var links = {};
      $$(".nav__link").forEach(function (a) { links[a.getAttribute("href")] = a; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            Object.keys(links).forEach(function (k) { links[k].classList.remove("is-active"); });
            var a = links["#" + en.target.id];
            if (a) a.classList.add("is-active");
          }
        });
      }, { rootMargin: "-45% 0px -50% 0px" });
      ["candidates", "classement", "packs", "gains", "faq"].forEach(function (id) {
        var s = document.getElementById(id);
        if (s) io.observe(s);
      });
    }
  }

  function applyPhaseUi() {
    var eb = $(".hero .eyebrow");
    if (!eb || DEMO) return;
    var phase = MDR.votingPhase();
    var txt = "Édition 2026 · Votes ouverts";
    if (phase === "before") txt = "Votes ouverts le " + fmt.date(cfg.votingStart);
    if (phase === "closed") txt = "Votes clôturés · Merci à tous";
    eb.innerHTML = '<span class="pulse"></span> ' + esc(txt);
  }

  var deferredInstall = null;
  function setupInstall() {
    var bar = $("#installBar");
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredInstall = e;
      var dismissed = false;
      try { dismissed = localStorage.getItem("mdr_install_dismissed") === "1"; } catch (x) {}
      if (!dismissed) setTimeout(function () { bar.hidden = false; }, 4000);
    });
    $("#installBtn").addEventListener("click", async function () {
      if (!deferredInstall) return;
      bar.hidden = true;
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (x) {}
      deferredInstall = null;
    });
    $("#installClose").addEventListener("click", function () {
      bar.hidden = true;
      try { localStorage.setItem("mdr_install_dismissed", "1"); } catch (x) {}
    });
    window.addEventListener("appinstalled", function () { bar.hidden = true; toast("Application installée !", "success"); });
  }

  function registerSW() {
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("/sw.js").catch(function (e) { console.warn("SW:", e); });
      });
    }
  }

  var splashHidden = false;
  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    var s = $("#splash");
    if (s) { s.classList.add("is-hidden"); setTimeout(function () { s.remove(); }, 700); }
  }

  /* =========================================================
     13. ÉVÉNEMENTS
     ========================================================= */
  function bindEvents() {
    /* --- Clics délégués --- */
    document.addEventListener("click", function (e) {
      var t = e.target;

      var op = t.closest("[data-open]");
      if (op) {
        e.preventDefault();
        var name = op.getAttribute("data-open");
        closeNav();
        if (name === "vote") openVote();
        else if (name === "register") {
          if (!MDR.registrationOpen()) toast("Les inscriptions sont closes.", "info", 5000);
          else openModal("register");
        }
        else if (name === "space") openModal("space");
        else if (name === "rules") openModal("rules", { stack: true });
        return;
      }

      var cl = t.closest("[data-close]");
      if (cl) { closeModalEl(cl.closest(".modal")); return; }

      var vf = t.closest("[data-vote-for]");
      if (vf) {
        var id = vf.getAttribute("data-vote-for");
        if (vf.hasAttribute("data-heart")) {
          var r = vf.getBoundingClientRect();
          vf.classList.add("is-pop");
          heartBurst(r.left + r.width / 2, r.top + r.height / 2, 8);
          setTimeout(function () { vf.classList.remove("is-pop"); }, 650);
          setTimeout(function () { openVote({ candidateId: id }); }, 280);
        } else {
          openVote({ candidateId: id });
        }
        return;
      }

      var sh = t.closest("[data-share-for]");
      if (sh) { shareCandidate(sh.getAttribute("data-share-for")); return; }

      var pf = t.closest("[data-profile]");
      if (pf) { openProfile(pf.getAttribute("data-profile")); return; }

      var pk = t.closest("[data-pack]");
      if (pk) { openVote({ qty: Number(pk.getAttribute("data-pack")) }); return; }

      var cur = t.closest("[data-currency]");
      if (cur) { setCurrency(cur.getAttribute("data-currency")); return; }

      if (t.closest(".nav__link")) closeNav();
      if (!t.closest("#mainNav") && !t.closest("#navToggle")) closeNav();
    });

    /* Activation clavier des zones cliquables */
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"][data-profile]')) {
        e.preventDefault();
        openProfile(e.target.getAttribute("data-profile"));
      }
    });

    /* --- Navigation mobile --- */
    $("#navToggle").addEventListener("click", function () {
      var nav = $("#mainNav");
      var open = nav.classList.toggle("is-open");
      this.setAttribute("aria-expanded", open ? "true" : "false");
    });

    /* --- Filtres candidates --- */
    var searchTimer;
    $("#searchInput").addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderGrid, 160);
    });
    $("#cityFilter").addEventListener("change", renderGrid);
    $("#sortSelect").addEventListener("change", renderGrid);

    /* --- Vote --- */
    $("#voteCandidateSelect").addEventListener("change", function () { renderVoteCandidate(); updateVoteTotal(); mark(this, false); });
    $("#votePacks").addEventListener("change", function () { $("#voteCustom").value = ""; updateVoteTotal(); });
    $("#voteCustom").addEventListener("input", function () {
      $$('input[name="votePack"]').forEach(function (r) { r.checked = false; });
      updateVoteTotal();
    });
    $("#voteForm").addEventListener("submit", submitVote);

    /* --- Retire le rouge des champs quand on corrige --- */
    document.addEventListener("input", function (e) {
      if (e.target.classList && e.target.classList.contains("is-invalid")) e.target.classList.remove("is-invalid");
    });

    /* --- Inscription --- */
    $("#regRules").addEventListener("scroll", checkRulesScroll, { passive: true });
    $("#regBio").addEventListener("input", function () { $("#regBioCount").textContent = this.value.length; });
    $("#regNext").addEventListener("click", function () {
      if (validateStep(state.regStep)) goStep(state.regStep + 1);
    });
    $("#regPrev").addEventListener("click", function () { goStep(Math.max(1, state.regStep - 1)); });
    $("#registerForm").addEventListener("submit", submitRegistration);
    $("#camStart").addEventListener("click", startCamera);
    $("#camCapture").addEventListener("click", capturePhoto);
    $("#camRetake").addEventListener("click", retakePhoto);
    $("#camFlip").addEventListener("click", flipCamera);

    /* --- Espace candidate --- */
    $("#loginForm").addEventListener("submit", submitLogin);
    $("#forgotBtn").addEventListener("click", forgotPassword);
    $("#logoutBtn").addEventListener("click", logout);
    $("#spaceCopy").addEventListener("click", function () { copyText($("#spaceLink").value, "Lien copié !"); });
    $("#spaceShare").addEventListener("click", function () {
      var row = state.mySpaceRow;
      if (row) shareCandidate(row.id);
    });

    /* --- Réseau --- */
    function net() { $("#offlineBar").hidden = navigator.onLine; }
    window.addEventListener("online", function () { net(); refreshAll({ silent: true }); });
    window.addEventListener("offline", net);
    net();

    /* --- Récupération de mot de passe --- */
    if (sb) {
      sb.auth.onAuthStateChange(function (event) {
        if (event === "PASSWORD_RECOVERY") {
          var np = window.prompt("Choisissez un nouveau mot de passe (8 caractères minimum) :");
          if (np && np.length >= 8) {
            sb.auth.updateUser({ password: np }).then(function (r) {
              if (r.error) toast(friendlyError(r.error), "error");
              else toast("Mot de passe mis à jour.", "success");
            });
          } else if (np) {
            toast("Mot de passe trop court (8 caractères minimum).", "error");
          }
        }
      });
    }

    /* --- Actualisation automatique du classement --- */
    if (!DEMO) {
      setInterval(function () {
        if (document.visibilityState === "visible" && navigator.onLine) refreshAll({ silent: true });
      }, 30000);
    }
  }

  /* =========================================================
     14. INITIALISATION
     ========================================================= */
  function populateStatic() {
    var tpl = $("#rulesTemplate");
    if (tpl) {
      [$("#regRules"), $("#rulesBox")].forEach(function (box) {
        if (!box) return;
        box.innerHTML = "";
        box.appendChild(tpl.content.cloneNode(true));
      });
    }
    MDR.applyTokens(document);

    var wa = $("#contactWhatsapp");
    if (wa) wa.href = "https://wa.me/" + digits(cfg.contactWhatsapp);
    var em = $("#contactEmail");
    if (em) em.href = "mailto:" + cfg.contactEmail;
    var yr = $("#year");
    if (yr) yr.textContent = new Date().getFullYear();

    var age = $("#regAge");
    if (age) { age.min = cfg.minAge; age.max = cfg.maxAge; }
    var custom = $("#voteCustom");
    if (custom) { custom.min = cfg.minVotes; custom.max = cfg.maxVotes; }
  }

  async function init() {
    populateStatic();
    bindEvents();
    setupScroll();
    setupInstall();
    registerSW();
    applyPhaseUi();
    setCamUI("idle");
    setCurrency(state.currency);   // rend aussi les packs
    observeReveals(document);

    await refreshAll();

    /* Liens profonds : ?c=ID (profil) et ?order=ID (retour de paiement) */
    var params = new URLSearchParams(location.search);
    var cid = params.get("c");
    if (cid) {
      var cand = findCandidate(cid);
      if (cand) { setTimeout(function () { openProfile(cid); }, 400); }
    }
    var order = params.get("order");
    if (order) {
      params.delete("order");
      var qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      handleReturn(order);
    }

    if (DEMO) {
      setTimeout(function () {
        toast("Mode démo : candidates fictives. Connectez Supabase pour passer en réel.", "info", 6500);
      }, 1500);
    }
    hideSplash();
  }

  window.addEventListener("load", function () { setTimeout(hideSplash, 900); });
  setTimeout(hideSplash, 4000);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
