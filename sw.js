/* WeRef · service worker
   Objetivo: que la app abra casi al instante desde la segunda vez y no vuelva a descargar todo.
   Reglas (pensadas para que NUNCA se quede una versión vieja):
   - Páginas (HTML): primero la red; si no hay red o tarda más de 4 s, la copia guardada.
   - Archivos con ?v=... (cambian de dirección al publicar una versión nueva): primero la copia guardada.
   - Otros archivos propios: primero la red; si falla, la copia guardada.
   - Fuentes y librerías con versión fija (Google Fonts, unpkg, cdnjs): copia guardada y se refresca por detrás.
   - Supabase, hCaptcha y todo lo demás: no se toca, pasa directo a internet. */

const CACHE = 'weref-v1';
const MAX_ENTRIES = 150;
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cache){
  const keys = await cache.keys();
  if(keys.length <= MAX_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map(k => cache.delete(k)));
}
async function put(request, response){
  if(!response || !(response.ok || response.type === 'opaque')) return;
  const copy = response.clone();          // se copia antes de cualquier espera: si no, la página ya habría gastado la respuesta
  try{
    const cache = await caches.open(CACHE);
    await cache.put(request, copy);
    trim(cache);
  }catch(e){ /* sin espacio o respuesta no guardable: se ignora */ }
}
function timeout(ms){ return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function networkFirst(request, ms){
  try{
    const res = await (ms ? Promise.race([fetch(request), timeout(ms)]) : fetch(request));
    put(request, res);
    return res;
  }catch(e){
    const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
    if(cached) return cached;
    throw e;
  }
}
async function cacheFirst(request){
  const cached = await caches.match(request);
  if(cached) return cached;
  const res = await fetch(request);
  put(request, res);
  return res;
}
async function staleWhileRevalidate(request){
  const cached = await caches.match(request);
  const refresh = fetch(request).then(res => { put(request, res); return res; }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(url.origin === self.location.origin){
    if(url.pathname === '/sw.js') return;                      // el propio service worker siempre desde la red
    if(req.mode === 'navigate' || /\.html?$/.test(url.pathname) || url.pathname === '/'){
      event.respondWith(networkFirst(req, 4000));
    } else if(url.searchParams.has('v')){
      event.respondWith(cacheFirst(req));
    } else {
      event.respondWith(networkFirst(req, 0));
    }
    return;
  }
  if(CDN_HOSTS.includes(url.hostname)){
    event.respondWith(staleWhileRevalidate(req));
  }
});
