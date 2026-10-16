/* =========================================================
   MISS DIGITAL RDC — sw.js (Service Worker)
   - Pages, CSS, JS : réseau d'abord, cache si le réseau est lent/absent
   - Images, polices : cache d'abord, mise à jour en arrière-plan
   - JAMAIS en cache : paiements, fonctions Netlify, Supabase, admin
   ========================================================= */

/* ⚠️ Change ce numéro à chaque grosse mise à jour pour vider l'ancien cache */
const VERSION = "mdr-v1";
const SHELL_CACHE = VERSION + "-shell";
const RUNTIME_CACHE = VERSION + "-runtime";
const MAX_RUNTIME_ENTRIES = 80;
const NETWORK_TIMEOUT = 3500; // ms avant de basculer sur le cache

const OFFLINE_URL = "/offline.html";

const SHELL_FILES = [
  "/",
  OFFLINE_URL,
  "/style.css",
  "/config.js",
  "/app.js",
  "/manifest.webmanifest",
  "/assets/logo.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/favicon-48.png"
];

/* Domaines externes autorisés en cache (polices + bibliothèque Supabase) */
const CACHEABLE_ORIGINS = [
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdn.jsdelivr.net"
];

/* Chemins qu'on ne touche jamais */
const NEVER_CACHE_PREFIXES = ["/.netlify/", "/admin"];

/* ---------- Installation : pré-cache de la coque de l'app ---------- */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      /* On ajoute fichier par fichier : un fichier manquant ne bloque pas l'installation */
      return Promise.all(
        SHELL_FILES.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {
            console.warn("[SW] Non mis en cache :", url);
          });
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

/* ---------- Activation : nettoyage des anciens caches ---------- */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k.indexOf("mdr-") === 0 && k !== SHELL_CACHE && k !== RUNTIME_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

/* ---------- Outils ---------- */
function fetchWithTimeout(request, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
    fetch(request).then(
      function (res) { clearTimeout(timer); resolve(res); },
      function (err) { clearTimeout(timer); reject(err); }
    );
  });
}

function trimCache(cache, max) {
  return cache.keys().then(function (keys) {
    if (keys.length <= max) return;
    return cache.delete(keys[0]).then(function () { return trimCache(cache, max); });
  });
}

function isCacheable(res) {
  return res && res.ok && (res.type === "basic" || res.type === "cors");
}

/* Réseau d'abord, cache en secours */
function networkFirst(request, key) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetchWithTimeout(request, NETWORK_TIMEOUT).then(
      function (res) {
        if (isCacheable(res)) cache.put(key || request, res.clone());
        return res;
      },
      function (err) {
        return cache.match(key || request, { ignoreSearch: !key }).then(function (cached) {
          if (cached) return cached;
          throw err;
        });
      }
    );
  });
}

/* Cache d'abord, mise à jour en arrière-plan */
function staleWhileRevalidate(event, request) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (res) {
        if (isCacheable(res)) {
          cache.put(request, res.clone()).then(function () { trimCache(cache, MAX_RUNTIME_ENTRIES); });
        }
        return res;
      }).catch(function () { return null; });

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network.then(function (res) { return res || Response.error(); });
    });
  });
}

/* ---------- Interception des requêtes ---------- */
self.addEventListener("fetch", function (event) {
  var request = event.request;

  /* On ne gère que les GET (jamais les paiements/POST) */
  if (request.method !== "GET") return;
  if (request.headers.has("range")) return;

  var url = new URL(request.url);

  /* ----- Domaines externes ----- */
  if (url.origin !== self.location.origin) {
    if (CACHEABLE_ORIGINS.indexOf(url.origin) !== -1) {
      event.respondWith(staleWhileRevalidate(event, request));
    }
    /* Supabase, SasPay, images distantes... : réseau direct, rien en cache */
    return;
  }

  /* ----- Chemins interdits de cache ----- */
  for (var i = 0; i < NEVER_CACHE_PREFIXES.length; i++) {
    if (url.pathname.indexOf(NEVER_CACHE_PREFIXES[i]) === 0) return;
  }

  /* ----- Navigation (pages) ----- */
  if (request.mode === "navigate") {
    var key = url.pathname === "/" ? "/" : null; /* ?c=ID et ?order=ID partagent la page d'accueil en cache */
    event.respondWith(
      networkFirst(request, key).catch(function () {
        return caches.match(OFFLINE_URL).then(function (r) { return r || Response.error(); });
      })
    );
    return;
  }

  /* ----- Fichiers de l'app : CSS, JS, manifest ----- */
  var isCode = /\.(?:css|js|webmanifest|json)$/i.test(url.pathname);
  if (isCode) {
    event.respondWith(networkFirst(request).catch(function () { return Response.error(); }));
    return;
  }

  /* ----- Images, icônes, polices locales ----- */
  event.respondWith(staleWhileRevalidate(event, request));
});

/* ---------- Messages (mise à jour immédiate si demandée) ---------- */
self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
