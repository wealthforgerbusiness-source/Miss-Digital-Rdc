/* =====================================================================
   MISS DIGITAL RDC — SCRIPT.JS
   ===================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Année de copyright automatique ---------- */
  const yearEl = document.getElementById('copyrightYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Header : rétrécit + s'assombrit au scroll ---------- */
  const header = document.getElementById('siteHeader');
  const onScroll = () => {
    if (window.scrollY > 40) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Menu hamburger mobile ---------- */
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');

  const closeMenu = () => {
    navMenu.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  };

  navToggle.addEventListener('click', () => {
    const isOpen = navMenu.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navMenu.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  /* ---------- Révélation au scroll (IntersectionObserver) ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

    revealEls.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 6, 5) * 0.08}s`;
      io.observe(el);
    });
  } else {
    // Fallback : navigateurs très anciens sans IntersectionObserver
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* =====================================================================
     SYSTÈME DE CONTRÔLE DES ADRESSES IP — COUCHE ANTI-FRAUDE
     =====================================================================
     ⚠️ LIRE ATTENTIVEMENT — LIMITATION TECHNIQUE IMPORTANTE ⚠️

     Ce site est un site STATIQUE hébergé sur GitHub Pages. Il n'y a donc
     AUCUN serveur, AUCUNE base de données et AUCUN moyen sécurisé pour
     un site 100% statique de :
       1) connaître de façon fiable l'adresse IP publique d'un votant
          (cela nécessite un serveur / une fonction backend),
       2) stocker cette IP quelque part de manière persistante et partagée
          entre tous les visiteurs (un fichier "texte" ne peut pas être
          écrit depuis le navigateur d'un visiteur — le navigateur n'a
          pas accès au système de fichiers du serveur),
       3) empêcher réellement un second vote depuis la même IP, puisque
          n'importe quel utilisateur peut vider son cache, utiliser un
          autre navigateur, le mode navigation privée, ou changer de
          réseau (4G, VPN, etc.) pour contourner un contrôle purement
          côté client.

     CE QUI EST TECHNIQUEMENT FAISABLE ICI (et qui est implémenté
     ci-dessous, à titre indicatif) :
       - Récupérer l'IP publique du visiteur via un service tiers gratuit
         (ipify.org) uniquement pour AFFICHAGE/INFORMATION.
       - Faire un contrôle FAIBLE et NON FIABLE via localStorage, qui
         bloque uniquement le MÊME navigateur sur le MÊME appareil —
         ce n'est PAS une protection anti-fraude réelle.

     CE QU'IL FAUT FAIRE POUR UNE VRAIE PROTECTION ANTI-FRAUDE :
       Il faut brancher un petit backend (API), par exemple :
         - une Google Cloud Function / Google Apps Script liée au même
           Google Sheet que le formulaire de vote,
         - ou un service serverless (Vercel, Netlify Functions, Firebase),
       qui reçoit chaque soumission, lit l'IP réelle et fiable côté
       serveur (req.headers['x-forwarded-for'] ou équivalent), la
       compare à une base de données/Sheet des IP déjà utilisées, et
       rejette ou accepte le vote en conséquence.

     👉 L'EMPLACEMENT prévu pour brancher ce futur backend est la
        fonction `checkVoteEligibility()` ci-dessous : remplacez le
        corps de cette fonction par un appel fetch() vers votre API
        une fois celle-ci développée.
     ===================================================================== */

  const VOTE_STORAGE_KEY = 'mdrdc_vote_ip_softcheck';

  /**
   * Récupère l'IP publique du visiteur (à titre informatif uniquement).
   * Utilise l'API gratuite ipify — aucune clé requise.
   */
  async function fetchPublicIp() {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      if (!res.ok) throw new Error('ipify indisponible');
      const data = await res.json();
      return data.ip || null;
    } catch (err) {
      console.warn('[Anti-fraude] Impossible de récupérer l\'IP publique :', err);
      return null;
    }
  }

  /**
   * ⚠️ Contrôle FAIBLE côté client (localStorage), à but purement indicatif.
   * Ne constitue PAS une protection anti-fraude fiable — voir commentaire
   * ci-dessus. Bloque uniquement le même navigateur / même appareil.
   *
   * BRANCHEMENT BACKEND : remplacez le contenu de cette fonction par un
   * appel à votre API (ex: fetch('https://votre-backend.example.com/check-vote', {...}))
   * qui fera la vraie vérification serveur de l'IP.
   */
  async function checkVoteEligibility() {
    const ip = await fetchPublicIp();
    const already = localStorage.getItem(VOTE_STORAGE_KEY);

    if (already) {
      return {
        allowed: false,
        ip,
        message: "Erreur de vote : plusieurs votes provenant de la même connexion Internet ne sont pas autorisés.",
      };
    }

    return { allowed: true, ip, message: null };
  }

  /**
   * Affiche un bandeau d'avertissement au-dessus du formulaire de vote
   * si le contrôle (faible, côté client) détecte une tentative de
   * second vote sur le même appareil/navigateur.
   */
  function renderVoteWarning(message) {
    const wrap = document.querySelector('.vote-frame-wrap');
    if (!wrap || document.getElementById('voteWarning')) return;

    const warning = document.createElement('div');
    warning.id = 'voteWarning';
    warning.setAttribute('role', 'alert');
    warning.style.cssText = `
      background: rgba(220, 53, 69, 0.15);
      border: 1px solid rgba(220, 53, 69, 0.5);
      color: #ffd7db;
      padding: 14px 18px;
      border-radius: 12px;
      font-size: 0.88rem;
      margin-bottom: 16px;
      text-align: center;
    `;
    warning.textContent = message;
    wrap.parentElement.insertBefore(warning, wrap);
  }

  (async () => {
    const voteSection = document.getElementById('candidates');
    if (!voteSection) return;

    const result = await checkVoteEligibility();

    if (!result.allowed) {
      renderVoteWarning(result.message);
    } else {
      // Marque ce navigateur comme "ayant voté" seulement une fois que
      // l'utilisateur interagit avec le formulaire (best-effort, non fiable).
      const iframe = voteSection.querySelector('.vote-frame');
      if (iframe) {
        iframe.addEventListener('load', () => {
          localStorage.setItem(VOTE_STORAGE_KEY, '1');
        }, { once: true });
      }
    }
  })();

});
