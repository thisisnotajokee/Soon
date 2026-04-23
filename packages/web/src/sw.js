"use strict";
// @ts-nocheck
/// <reference lib="es2020" />
/// <reference lib="webworker" />
const CACHE_NAME = 'soon-cache-v1';
const STATIC_ASSETS = ['/', '/index.html'];
// Stale-while-revalidate for API calls
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    // Only handle same-origin GET requests
    if (url.origin !== self.location.origin || request.method !== 'GET') {
        return;
    }
    // Cache-first for tracking list
    if (url.pathname === '/trackings' || url.pathname.startsWith('/api/trackings/')) {
        event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(request);
            const fetchPromise = fetch(request).then((response) => {
                if (response.ok)
                    cache.put(request, response.clone());
                return response;
            });
            return cached || fetchPromise;
        }));
        return;
    }
    // Stale-while-revalidate for product details
    if (url.pathname.startsWith('/products/') && url.pathname.endsWith('/detail')) {
        event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(request);
            const networkPromise = fetch(request)
                .then((response) => {
                if (response.ok)
                    cache.put(request, response.clone());
                return response;
            })
                .catch(() => {
                // Return cached if network fails
                return cached || new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
            });
            return networkPromise;
        }));
        return;
    }
});
self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
    self.skipWaiting();
});
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
    self.clients.claim();
});
