// Cross-Origin Isolation polyfill for hosts that can't set COOP/COEP headers
// (e.g. GitHub Pages). The page registers this worker once, reloads, and from
// then on every response is re-served with the headers required to unlock
// SharedArrayBuffer / crossOriginIsolated.
//
// Based on https://github.com/gzuidhof/coi-serviceworker (MIT).

let coepCredentialless = false;

if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'deregister') {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)));
    } else if (ev.data.type === 'coepCredentialless') {
      coepCredentialless = ev.data.value;
    }
  });

  // Web Share Target (Android PWAs): the manifest posts the shared file here.
  // A static host can't process the POST, so the worker stashes the file in the
  // Cache and redirects to the app, which reads it back out on load.
  async function handleShareTarget(request) {
    try {
      const formData = await request.formData();
      const file = formData.get('audio');
      if (file && typeof file !== 'string') {
        const headers = new Headers();
        headers.set('content-type', file.type || 'application/octet-stream');
        headers.set('x-share-filename', encodeURIComponent(file.name || 'shared-audio'));
        const cache = await caches.open('paulstretch-share');
        await cache.put('shared-file', new Response(file, { headers }));
      }
    } catch (e) {
      console.error('[share-target]', e);
    }
    return Response.redirect(new URL('./?share-target=1', self.registration.scope).toString(), 303);
  }

  self.addEventListener('fetch', (event) => {
    const r = event.request;

    if (r.method === 'POST' && new URL(r.url).pathname.endsWith('/share-target')) {
      event.respondWith(handleShareTarget(r));
      return;
    }

    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

    const request = coepCredentialless && r.mode === 'no-cors'
      ? new Request(r, { credentials: 'omit' })
      : r;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response;

          const headers = new Headers(response.headers);
          headers.set(
            'Cross-Origin-Embedder-Policy',
            coepCredentialless ? 'credentialless' : 'require-corp',
          );
          if (!coepCredentialless) {
            headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
          }
          headers.set('Cross-Origin-Opener-Policy', 'same-origin');

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((e) => console.error(e)),
    );
  });
} else {
  (() => {
    if (window.crossOriginIsolated !== false) return;
    if (!window.isSecureContext) {
      console.warn('[coi] secure context required, not registering');
      return;
    }

    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          console.log('[coi] update found, reloading');
          window.location.reload();
        });
        if (registration.active && !navigator.serviceWorker.controller) {
          console.log('[coi] activating, reloading');
          window.location.reload();
        }
      })
      .catch((err) => console.error('[coi] register failed', err));
  })();
}
