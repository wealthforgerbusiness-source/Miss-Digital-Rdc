(function () {
  "use strict";

  /* ---------------------------------------------------------
     1. RÉGLAGES MODIFIABLES
     --------------------------------------------------------- */
  var SETTINGS = {
    siteName: "Miss Digital RDC",
    siteUrl: "https://miss-digital-rdc.netlify.app", // ← remplace par ton vrai domaine

    /* ----- Prix du vote ----- */
    votePriceCDF: 2250,   // 1 vote = 2 250 CDF (le paiement est TOUJOURS en CDF)
    votePriceUSD: 1,      // équivalent affiché : 1 vote = 1 $ (taux fixe du concours)
    minVotes: 1,
    maxVotes: 10000,

    /* ----- Packs de votes (le prix est calculé : qty × prix du vote) ----- */
    packs: [
      { id: "p1",   qty: 1,   label: "Un petit coup de cœur", popular: false },
      { id: "p5",   qty: 5,   label: "Pack Soutien",          popular: false },
      { id: "p10",  qty: 10,  label: "Pack Fan",              popular: false },
      { id: "p30",  qty: 30,  label: "Pack Super Fan",        popular: true  },
      { id: "p50",  qty: 50,  label: "Pack Champion",         popular: false },
      { id: "p100", qty: 100, label: "Pack Légende",          popular: false }
    ],

    /* ----- Frais mobile money (en %) retirés des recettes dans le dashboard admin ----- */
    feePercent: 2.5,

    /* ----- Répartition des recettes NETTES (après frais) ----- */
    organizerShare: 50,   // % pour toi
    poolShare: 50,        // % pour la cagnotte des gagnantes   (organizerShare + poolShare = 100)

    /* ----- Répartition de la cagnotte entre les 3 gagnantes (total = 100) ----- */
    prizeShares: [50, 30, 20], // 1re, 2e, 3e

    /* ----- Règles de candidature ----- */
    minAge: 18,
    maxAge: 60,
    photoMaxWidth: 900,        // largeur max de la photo envoyée (px)
    photoQuality: 0.85,        // qualité JPEG (0 à 1)

    /* ----- Dates (heure de Kinshasa, UTC+1) ----- */
    votingStart: "2026-11-01T00:00:00+01:00",
    registrationDeadline: "2026-12-15T23:59:59+01:00",
    votingEnd: "2027-01-31T23:59:59+01:00",

    /* ----- Affichage public de la cagnotte (true = visible sur le site) ----- */
    showPrizePool: false,

    /* ----- Contact ----- */
    contactEmail: "contact@missdigitalrdc.com", // ← à remplacer
    contactWhatsapp: "243900000000",            // ← format international, sans + ni espaces

    /* ----- Supabase (clés PUBLIQUES, à remplir à la fin) ----- */
    supabase: {
      url: "https://jeqcmhpezqocecqxjsny.supabase.co",
      anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplcWNtaHBlenFvY2VjcXhqc255Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNjcyODksImV4cCI6MjEwNzc0MzI4OX0.y3HRbm2c0pN7O4qFyi7__H5yY05PLRwmuS7hXz1Azc4"
    },

    /* ----- Noms côté base de données (doivent correspondre au prompt Supabase) ----- */
    db: {
      publicCandidatesView: "public_candidates", // vue : uniquement les candidates validées
      candidatesTable: "candidates",
      statsRpc: "get_public_stats",              // fonction : total votes, candidates, villes, cagnotte
      photosBucket: "candidate-photos"
    },

    /* ----- Fonctions Netlify (backend sécurisé SasPay) ----- */
    api: {
      createCheckout: "/.netlify/functions/create-checkout",
      checkPayment: "/.netlify/functions/check-payment"
    },

    /* ----- Réseaux de paiement acceptés par SasPay en RDC ----- */
    networks: ["Orange Money", "M-Pesa (Vodacom)", "Airtel Money"]
  };

  /* ---------------------------------------------------------
     2. OUTILS DE FORMATAGE
     --------------------------------------------------------- */
  var NBSP = "\u00a0";

  function fmtNumber(n) {
    return Number(n || 0).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, NBSP);
  }
  function formatCDF(n) { return fmtNumber(Math.round(n)) + NBSP + "CDF"; }
  function formatUSD(n) {
    var v = Number(n || 0);
    var txt = (v % 1 === 0) ? fmtNumber(v) : v.toFixed(2).replace(".", ",");
    return txt + NBSP + "$";
  }
  function formatPercent(n) {
    return String(n).replace(".", ",") + NBSP + "%";
  }
  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat("fr-FR", {
        day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Kinshasa"
      }).format(new Date(iso));
    } catch (e) { return iso; }
  }

  /* ---------------------------------------------------------
     3. CALCULS
     --------------------------------------------------------- */

  /** Prix d'une commande de votes. Le montant réellement débité est amountCDF. */
  function computeOrder(qty) {
    var q = Math.floor(Number(qty));
    if (!isFinite(q) || q < SETTINGS.minVotes || q > SETTINGS.maxVotes) return null;
    return {
      qty: q,
      amountCDF: q * SETTINGS.votePriceCDF,
      displayUSD: q * SETTINGS.votePriceUSD
    };
  }

  /** Prix affiché selon la devise choisie pour l'affichage ("CDF" ou "USD"). */
  function formatPrice(qty, currency) {
    var o = computeOrder(qty);
    if (!o) return "—";
    return currency === "USD" ? formatUSD(o.displayUSD) : formatCDF(o.amountCDF);
  }

  /**
   * Revenus à partir du total encaissé (en CDF).
   * - fee      : frais mobile money (feePercent %)
   * - net      : recettes nettes après frais
   * - organizer: ta part
   * - pool     : cagnotte des gagnantes
   * - prizes   : [1re, 2e, 3e]
   */
  function computeEarnings(grossCDF) {
    var gross = Math.max(0, Number(grossCDF) || 0);
    var fee = Math.round(gross * SETTINGS.feePercent / 100);
    var net = gross - fee;
    var organizer = Math.round(net * SETTINGS.organizerShare / 100);
    var pool = Math.round(net * SETTINGS.poolShare / 100);
    var prizes = SETTINGS.prizeShares.map(function (s) { return Math.floor(pool * s / 100); });
    return { gross: gross, fee: fee, net: net, organizer: organizer, pool: pool, prizes: prizes };
  }

  /** Phase du concours : "before" | "open" | "closed". */
  function votingPhase(now) {
    var t = (now ? new Date(now) : new Date()).getTime();
    if (t < new Date(SETTINGS.votingStart).getTime()) return "before";
    if (t > new Date(SETTINGS.votingEnd).getTime()) return "closed";
    return "open";
  }
  function registrationOpen(now) {
    var t = (now ? new Date(now) : new Date()).getTime();
    return t <= new Date(SETTINGS.registrationDeadline).getTime();
  }

  /* ---------------------------------------------------------
     4. TEXTES AUTOMATIQUES (balises data-cfg="..." dans index.html)
     --------------------------------------------------------- */
  function tokens() {
    var s = SETTINGS;
    var shares = s.prizeShares;
    return {
      votePriceCDF: formatCDF(s.votePriceCDF),
      votePriceUSD: s.votePriceUSD + NBSP + "USD",
      feePercent: formatPercent(s.feePercent),
      organizerShare: formatPercent(s.organizerShare),
      poolShare: formatPercent(s.poolShare),
      share1: formatPercent(shares[0]),
      share2: formatPercent(shares[1]),
      share3: formatPercent(shares[2]),
      prizePct1: formatPercent(+(s.poolShare * shares[0] / 100).toFixed(2)),
      prizePct2: formatPercent(+(s.poolShare * shares[1] / 100).toFixed(2)),
      prizePct3: formatPercent(+(s.poolShare * shares[2] / 100).toFixed(2)),
      minAge: String(s.minAge),
      registrationDeadline: formatDate(s.registrationDeadline),
      votingEnd: formatDate(s.votingEnd),
      contactEmail: s.contactEmail
    };
  }

  /** Remplace le contenu de tous les éléments [data-cfg] de la page (ou d'un bloc donné). */
  function applyTokens(root) {
    var t = tokens();
    (root || document).querySelectorAll("[data-cfg]").forEach(function (el) {
      var key = el.getAttribute("data-cfg");
      if (Object.prototype.hasOwnProperty.call(t, key)) el.textContent = t[key];
    });
  }

  /* ---------------------------------------------------------
     5. VÉRIFICATION DE COHÉRENCE (alerte dans la console)
     --------------------------------------------------------- */
  (function check() {
    var sum = SETTINGS.prizeShares.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== 100) console.warn("[config] prizeShares doit totaliser 100 (actuel : " + sum + ")");
    if (SETTINGS.organizerShare + SETTINGS.poolShare !== 100) {
      console.warn("[config] organizerShare + poolShare doit totaliser 100");
    }
    if (SETTINGS.prizeShares.length !== 3) console.warn("[config] prizeShares doit contenir 3 valeurs");
  })();

  /* ---------------------------------------------------------
     6. EXPORT
     --------------------------------------------------------- */
  window.MDR = {
    cfg: SETTINGS,
    fmt: {
      number: fmtNumber,
      cdf: formatCDF,
      usd: formatUSD,
      percent: formatPercent,
      date: formatDate,
      price: formatPrice
    },
    computeOrder: computeOrder,
    computeEarnings: computeEarnings,
    votingPhase: votingPhase,
    registrationOpen: registrationOpen,
    tokens: tokens,
    applyTokens: applyTokens
  };
})();
