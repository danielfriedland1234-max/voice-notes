// Service worker: lets the app open offline, install on the home screen,
// and update itself. Changing version.js changes this worker, which tells
// every phone that a new version is out.
importScripts('version.js');

const SHELL_CACHE = 'voice-notes-shell-' + self.APP_VERSION;
const LIB_CACHE = 'voice-notes-libs'; // speech library from the CDN (versioned URLs, never change)
const SHELL = [
  './', 'index.html', 'style.css', 'version.js', 'db.js', 'app.js', 'whisper-worker.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
];

// Adds two security headers that let the speech engine use all of the
// phone's processor cores (several times faster). GitHub Pages can't send
// these headers itself, so the service worker adds them.
function isolate(res) {
  if (res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('voice-notes-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: always try the network first so you get the newest version,
  // and fall back to the saved copy when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, copy));
          }
          return isolate(res);
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : null))
          .then(r => (r ? isolate(r) : Response.error())))
    );
    return;
  }

  // Speech library files: download once, then reuse (works offline).
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.open(LIB_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      })))
    );
  }
  // Everything else (e.g. the model files from Hugging Face) is cached by the speech library itself.
});
