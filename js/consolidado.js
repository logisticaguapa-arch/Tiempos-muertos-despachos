/*
  FASE N19 — "EN OTROS DISPOSITIVOS": mezcla, directo en las pantallas normales (Cargues activos e
  Historial), lo que TODOS los demás dispositivos ya subieron a Google Sheets — sin pantalla aparte, sin
  botón especial que haya que ir a buscar. Es exactamente lo que se pidió: que cualquiera que abra el
  enlace vea de una vez lo que los demás están registrando. Usa lo mismo que ya existía (la hoja de
  cálculo con el código de Apps Script, este archivo index.html y el enlace de GitHub) — sin Firebase, sin
  cuenta ni servidor nuevo (ver obtenerDatosCompartidos() en sync-sheets.js y Code.gs, doGet).

  Por qué se hace una MEZCLA y no simplemente "mostrar todo tal cual llegó de Sheets": cada celular sigue
  siendo dueño de SUS PROPIOS cargues y descargues — esos ya se ven, completos y EDITABLES, en la lista
  local de siempre (Dexie/IndexedDB, ver db.js). Lo que faltaba era ver los de los DEMÁS dispositivos. Por
  eso estas funciones toman lo que llegó de la hoja y le QUITAN lo que ya es de este dispositivo
  (comparando por "idGlobal" — ver la migración en db.js), para no mostrar la misma tarjeta duplicada. Lo
  que queda son cargues/descargues de OTROS dispositivos, y se muestran aparte, de SOLO LECTURA (no se
  puede editar desde aquí lo que otro dispositivo registró — eso se sigue haciendo desde SU celular).

  Importante — qué tan "en línea" es esto en la práctica: no es instantáneo al segundo (Google Apps
  Script no tiene forma de avisar cuando algo cambia en la hoja). Se trae de nuevo cada vez que se abre
  "Cargues activos" o "Historial", al tocar "Actualizar", y cada minuto mientras cualquiera de esas dos
  pantallas siga abierta (ver AUTO_REFRESCO_COMPARTIDO_MS en app.js). Sigue haciendo falta señal.
*/

const ETIQUETAS_ESTADO_TERMINAL_COMPARTIDO = ['Rechazado', 'Finalizado', 'Cerrado'];

function esEstadoActivoCompartido(etiqueta) {
  return !ETIQUETAS_ESTADO_TERMINAL_COMPARTIDO.includes(etiqueta);
}

// Igual criterio que claseEstado() en app.js, pero a partir de la ETIQUETA en español (así viene el
// campo "estado" en las filas que ya sincronizó sync-sheets.js), no del código interno (p.ej. 'EN_CARGUE').
function claseEstadoConsolidado(etiqueta) {
  if (etiqueta === 'En cargue') return 'en-cargue';
  if (etiqueta === 'En parada') return 'en-parada';
  if (etiqueta === 'Rechazado') return 'rechazado';
  if (etiqueta === 'Finalizado' || etiqueta === 'Cerrado') return 'finalizado';
  return '';
}

// Cargues ACTIVOS (no terminales) que llegaron de Sheets y NO son de este dispositivo — para "Cargues
// activos". Más reciente primero.
function carguesActivosDeOtrosDispositivos(datosCompartidos, idsGlobalesCarguesLocales) {
  return (datosCompartidos.cargues || [])
    .filter((c) => esEstadoActivoCompartido(c.estado))
    .filter((c) => !idsGlobalesCarguesLocales.has(c.id))
    .sort((a, b) => String(b.actualizado_en || b.fecha || '').localeCompare(String(a.actualizado_en || a.fecha || '')));
}

// Cargues TERMINALES (Finalizado/Rechazado/Cerrado) que llegaron de Sheets y no son de este dispositivo —
// para "Historial". Limitado a los 30 más recientes, igual criterio que el resto de listas de historial.
function carguesHistorialDeOtrosDispositivos(datosCompartidos, idsGlobalesCarguesLocales) {
  return (datosCompartidos.cargues || [])
    .filter((c) => !esEstadoActivoCompartido(c.estado))
    .filter((c) => !idsGlobalesCarguesLocales.has(c.id))
    .sort((a, b) => String(b.actualizado_en || b.fecha || '').localeCompare(String(a.actualizado_en || a.fecha || '')))
    .slice(0, 30);
}

// Descargues que llegaron de Sheets y no son de este dispositivo — para "Historial".
function descarguesDeOtrosDispositivos(datosCompartidos, idsGlobalesDescarguesLocales) {
  return (datosCompartidos.descargues || [])
    .filter((d) => !idsGlobalesDescarguesLocales.has(d.id))
    .sort((a, b) => String(b.hora_fin || b.fecha || '').localeCompare(String(a.hora_fin || a.fecha || '')))
    .slice(0, 30);
}
