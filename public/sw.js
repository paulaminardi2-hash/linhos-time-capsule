self.addEventListener('install', e => {
  e.waitUntil(caches.open('linho-static-v1').then(c => c.addAll([
    '/', '/manifest.webmanifest', '/logo.png'
  ])));
});
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
