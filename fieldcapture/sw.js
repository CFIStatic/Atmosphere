/**
 * Field Capture service worker — the app must OPEN at a site with no signal.
 *
 * The shell (page + scripts) is cached on first visit and served from this
 * device ever after, refreshing in the background when the network allows.
 * API calls and uploads are never intercepted or served stale: live data
 * comes from the network or fails honestly, and the app layer's own queue
 * (capture-core.js) handles offline days.
 */
var CACHE = 'fieldcapture-shell-v1';
var SHELL = ['./index.html', './js/capture-core.js', './js/app.js'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.addAll(SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key !== CACHE;
            })
            .map(function (key) {
              return caches.delete(key);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') !== -1) return;

  // ignoreSearch: the share link carries ?token=… but the cached shell is one
  // document for every token.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (hit) {
      var refresh = fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(CACHE).then(function (cache) {
              cache.put(request, copy);
            });
          }
          return response;
        })
        .catch(function () {
          return hit;
        });
      return hit || refresh;
    }),
  );
});
