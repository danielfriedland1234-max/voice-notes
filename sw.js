// Service worker: lets the app open offline, install on the home screen,
// and update itself. Changing version.js changes this worker, which tells
// every phone that a new version is out.
importScripts('version.js');

const SHELL_CACHE = 'voice-notes-shell-' + self.APP_VERSION;
const FONT_CACHE = 'voice-notes-fonts'; // Google Fonts: download once, then reuse (works offline)
const SHELL = [
  './', 'index.html', 'style.css', 'version.js', 'db.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Delete older versions' files (and the old speech-model library cache).
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('voice-notes-') && k !== SHELL_CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: always try the network first so you get the newest version,
// and fall back to the saved copy when offline.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
