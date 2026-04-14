const APP_VERSION = 'v3';
const APP_CACHE = `bentinho-app-${APP_VERSION}`;
const APP_SHELL = [
    '/index.html',
    '/manifest.webmanifest',
    '/icons/papa.png'
];

globalThis.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
    );
    globalThis.skipWaiting();
});

globalThis.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys
            .filter((key) => key !== APP_CACHE)
            .map((key) => caches.delete(key))))
    );
    globalThis.clients.claim();
});

globalThis.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === globalThis.location.origin;
    const isNavigation = event.request.mode === 'navigate';

    if (!isSameOrigin) {
        return;
    }

    if (isNavigation) {
        event.respondWith(
            fetch(event.request).catch(() => caches.match('/index.html', { ignoreSearch: true }))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                return cached;
            }

            return fetch(event.request).then((response) => {
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(APP_CACHE).then((cache) => cache.put(event.request, responseClone));
                }
                return response;
            }).catch(() => cached);
        })
    );
});
