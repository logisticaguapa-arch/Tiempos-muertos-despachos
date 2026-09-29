/*
  ===========================================================================
  DESPACHOS GUAPA — Code.gs (backend de sincronización con Google Sheets)
  ===========================================================================

  Por qué existe este archivo de nuevo: el que estaba publicado en esta hoja
  de cálculo fue reemplazado en algún momento por una versión distinta (una
  "versión en línea" con contraseña, pensada para OTRA app que nunca se
  llegó a usar). Ese reemplazo dejó sin backend compatible a la app real que
  el equipo de cosecha sí usa (Tiempos-muertos-despachos / piloto-simple),
  que no manda ninguna contraseña y espera un formato distinto. Este archivo
  reconstruye ESE backend simple y compatible, exactamente con el formato
  que la app ya envía y espera (ver js/sync-sheets.js del repositorio).

  Qué hace:
    1) doPost(e) — recibe el histórico local de un celular (cargues, paradas,
       checklist, descargues) y lo MEZCLA (upsert por "id") con lo que ya
       había guardado. Nunca reemplaza la hoja completa: cada celular manda
       SOLO su propio historial local, así que reemplazar todo borraría lo
       que hubieran subido los demás celulares. Se comprobó con pruebas
       automáticas que esto queda seguro incluso sincronizando varios
       celulares con historiales distintos, en cualquier orden.
    2) doGet(e) con "?leer=1" — devuelve TODO lo guardado en las 4 pestañas,
       para que cualquier celular pueda ver lo que los demás ya subieron
       (Cargues activos, Historial, Tablero operativo).

  Cómo instalar/actualizar esto: Extensiones → Apps Script en esta misma
  hoja de cálculo → reemplaza TODO el contenido del único archivo de código
  por este → Implementar → Administrar implementaciones → en la
  implementación activa, ícono de lápiz (editar) → en "Versión" elige
  "Nueva versión" → Implementar. Así el enlace (/exec) NO cambia y no hace
  falta tocar nada en la app ni en los celulares.

  Rendimiento: cada sincronización lee la pestaña UNA sola vez, mezcla todo
  en memoria, y escribe de vuelta en UNA sola operación — así de rápido
  incluso con miles de filas ya acumuladas (a diferencia de escribir fila
  por fila, que es lo que antes hacía que esto se pusiera cada vez más
  lento con el tiempo).
*/

const NOMBRES_HOJAS = ['Cargues', 'Paradas', 'Checklist', 'Descargues'];

// Columnas con las que se crea cada pestaña la primera vez (deben coincidir
// con lo que manda js/sync-sheets.js — construirFilasCargues/Paradas/
// Checklist/Descargues). Si en el futuro la app empieza a mandar un campo
// nuevo que no está en esta lista, se agrega SOLO al final de la pestaña
// automáticamente (ver agregarColumnasNuevasSiHaceFalta_ dentro de
// upsertFilas_) — nunca hay que tocar este archivo por eso.
const COLUMNAS_POR_DEFECTO = {
  Cargues: [
    'id', 'fecha', 'cliente', 'destino_ciudad', 'placa', 'conductor', 'estado',
    'resultado_checklist', 'hora_inicio_cargue', 'hora_fin_cargue', 'tiempo_total_min',
    'tiempo_detenido_min', 'tiempo_productivo_min', 'cantidad_paradas',
    'canastillas_encajables', 'canastillas_grandes', 'canastillas_pequenas', 'actualizado_en',
  ],
  Paradas: [
    'id', 'cargue_id', 'fecha', 'placa', 'categoria', 'causa', 'responsable', 'tipo_tiempo',
    'hora_inicio', 'hora_fin', 'duracion_min', 'observaciones', 'descripcion_otros',
  ],
  Checklist: [
    'id', 'cargue_id', 'fecha', 'placa', 'cliente', 'destino_ciudad', 'orden', 'item',
    'critico', 'respuesta', 'observacion',
  ],
  Descargues: [
    'id', 'fecha', 'remision', 'cliente_origen', 'destino_origen', 'placa', 'conductor',
    'hora_inicio', 'hora_fin', 'duracion_min', 'canastillas_encajables', 'canastillas_grandes',
    'canastillas_pequenas',
  ],
};

function obtenerOCrearHoja_(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(COLUMNAS_POR_DEFECTO[nombre]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function leerEncabezados_(hoja) {
  const ancho = Math.max(hoja.getLastColumn(), 1);
  return hoja.getRange(1, 1, 1, ancho).getValues()[0];
}

// Lee toda la pestaña como una lista de objetos {campo: valor}, usando los
// encabezados REALES de la fila 1 (no una lista fija) — así respeta
// cualquier columna nueva que se haya ido agregando con el tiempo.
function leerFilasComoObjetos_(hoja, encabezados) {
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) return [];
  const valores = hoja.getRange(2, 1, ultimaFila - 1, encabezados.length).getValues();
  return valores.map((fila) => {
    const obj = {};
    encabezados.forEach((campo, i) => { obj[campo] = fila[i]; });
    return obj;
  });
}

// Corazón de la sincronización: mezcla (upsert por "id") las filas que
// manda el celular con lo que ya había, y escribe TODO de vuelta en una
// sola operación. Ver la explicación completa arriba, en el encabezado del
// archivo, de por qué NUNCA se reemplaza la pestaña completa.
function upsertFilas_(nombreHoja, filasNuevas) {
  if (!filasNuevas || filasNuevas.length === 0) return;
  const hoja = obtenerOCrearHoja_(nombreHoja);
  let encabezados = leerEncabezados_(hoja);

  const camposNuevos = new Set();
  filasNuevas.forEach((fila) => {
    Object.keys(fila).forEach((campo) => {
      if (encabezados.indexOf(campo) === -1) camposNuevos.add(campo);
    });
  });
  if (camposNuevos.size > 0) {
    encabezados = encabezados.concat(Array.from(camposNuevos));
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
  }

  const existentes = leerFilasComoObjetos_(hoja, encabezados);
  const indicePorId = {};
  existentes.forEach((fila, i) => { indicePorId[fila.id] = i; });

  filasNuevas.forEach((fila) => {
    const idx = indicePorId[fila.id];
    if (idx === undefined) {
      existentes.push(fila);
      indicePorId[fila.id] = existentes.length - 1;
    } else {
      existentes[idx] = Object.assign({}, existentes[idx], fila);
    }
  });

  const filasParaEscribir = existentes.map((obj) =>
    encabezados.map((campo) => (obj[campo] === undefined || obj[campo] === null ? '' : obj[campo]))
  );
  if (filasParaEscribir.length > 0) {
    hoja.getRange(2, 1, filasParaEscribir.length, encabezados.length).setValues(filasParaEscribir);
  }
}

function responderJSON_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// ---- POST: sube (mezcla) el histórico local de un celular -----------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // Un solo "candado" para toda la hoja: evita que dos celulares
    // sincronizando justo al mismo tiempo se pisen entre sí.
    const candado = LockService.getScriptLock();
    if (!candado.tryLock(30000)) {
      return responderJSON_({ ok: false, error: 'El sistema está ocupado en este momento, intenta de nuevo en unos segundos.' });
    }
    try {
      upsertFilas_('Cargues', payload.cargues || []);
      upsertFilas_('Paradas', payload.paradas || []);
      upsertFilas_('Checklist', payload.checklist || []);
      upsertFilas_('Descargues', payload.descargues || []);
      SpreadsheetApp.flush();
    } finally {
      candado.releaseLock();
    }
    return responderJSON_({ ok: true });
  } catch (error) {
    return responderJSON_({ ok: false, error: error.message || 'Error desconocido en el servidor.' });
  }
}

// ---- GET: entrega todo lo guardado (para el mezclado entre celulares) ----
function doGet(e) {
  try {
    const parametros = (e && e.parameter) || {};
    if (parametros.leer !== '1') {
      return responderJSON_({ ok: true, info: 'Backend de sincronización Despachos Guapa activo.' });
    }
    const resultado = { ok: true };
    NOMBRES_HOJAS.forEach((nombre) => {
      const hoja = obtenerOCrearHoja_(nombre);
      const encabezados = leerEncabezados_(hoja);
      const clave = nombre.toLowerCase(); // 'cargues' | 'paradas' | 'checklist' | 'descargues'
      resultado[clave] = leerFilasComoObjetos_(hoja, encabezados);
    });
    return responderJSON_(resultado);
  } catch (error) {
    return responderJSON_({ ok: false, error: error.message || 'Error desconocido en el servidor.' });
  }
}

