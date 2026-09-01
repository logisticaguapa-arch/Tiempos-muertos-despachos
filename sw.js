/*
  FASE N13 — SERVICE WORKER: hace que la app se pueda instalar (PWA) y siga abriendo sin internet
  después de la primera visita. Guarda una copia de los archivos propios de la app ("app shell": html,
  css, js, íconos) la primera vez que hay conexión, y de ahí en adelante los sirve desde esa copia.

  IMPORTANTE — cómo actualizar: cada vez que se suba una versión nueva de la app a GitHub, hay que subir
  también este archivo con el número de CACHE_NOMBRE aumentado en 1 (v1 -> v2 -> v3…). Si no se cambia,
  los celulares que ya instalaron la app pueden seguir viendo la versión vieja guardada en caché.

  Esto es independiente de los datos de la app (que viven en IndexedDB, ver db.js) — borrar esta caché
  nunca borra un cargue ni una parada ya guardados.
*/

const CACHE_NOMBRE = 'piloto-guapa-v1';

const ARCHIVOS_APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/estilos.css',
  './vendor/dexie.min.js',
  './js/db.js',
  './js/auth.js',
  './js/estado.js',
  './js/cargues.js',
  './js/checklist.js',
  './js/causas.js',
  './js/tiempos.js',
  './js/descargues.js',
  './js/indicadores.js',
  './js/respaldo.js',
  './js/sync-sheets.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_NOMBRE)
      .then((cache) => cache.addAll(ARCHIVOS_APP_SHELL))
      .catch((error) => {
        // Si un archivo del listado no existe (p.ej. se editó esta lista y quedó desactualizada),
        // no se debe romper la instalación completa del service worker por eso.
        console.warn('No se pudo precargar todo el app shell:', error);
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== CACHE_NOMBRE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  // Solo se cachean peticiones GET al propio origen — nunca las llamadas a Google Sheets (que son
  // opcionales y ya manejan sus propios errores/reintentos, ver sync-sheets.js).
  if (evento.request.method !== 'GET' || !evento.request.url.startsWith(self.location.origin)) return;

  evento.respondWith(
    caches.match(evento.request).then((enCache) => {
      const enRed = fetch(evento.request)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(CACHE_NOMBRE).then((cache) => cache.put(evento.request, copia));
          return respuesta;
        })
        .catch(() => enCache);
      // Responde con la copia guardada de una vez si existe (rápido y funciona sin señal); si no hay
      // copia todavía, espera la respuesta de la red.
      return enCache || enRed;
    }),
  );
});
