/*
  FASE N10/N11 — SINCRONIZACIÓN AUTOMÁTICA CON GOOGLE SHEETS (además del respaldo .json de Fase N8).

  Por qué existe: el respaldo .json (Fase N8) protege contra perder los datos, pero un archivo .json no
  lo puede abrir ni leer nadie en gerencia/BI directamente — para eso sirve esta sincronización: sube
  una COPIA de lectura de cargues, paradas, checklist y descargues de canastas a una hoja de Google
  Sheets, en filas normales que cualquiera puede filtrar, sumar o graficar sin tocar la app.

  Decisiones de diseño (confirmadas con el usuario):
    - AUTOMÁTICA y silenciosa (Fase N11 — ya no hay botón "Subir a Google Sheets"): cada acción que
      guarda algo importante (crear/finalizar cargue, registrar/editar/eliminar parada, finalizar
      checklist, guardar un descargue de canastas) llama a intentarSincronizarSheetsSilencioso() al
      terminar. Si en ese momento no hay señal, o el enlace todavía no está configurado, el intento
      simplemente falla en silencio — no interrumpe al supervisor con un error — y la PRÓXIMA acción
      (o la siguiente apertura de la app) vuelve a intentar con los datos más recientes, así que nunca
      queda "atascado": basta con que en algún momento haya señal para que se ponga al día solo.
    - Detalle completo: se suben CUATRO pestañas — "Cargues" (resumen, una fila por cargue, con el
      resultado general del checklist y las canastillas cargadas), "Paradas" (una fila por cada parada
      individual), "Checklist" (una fila por cada uno de los 8 ítems respondidos de cada cargue) y
      "Descargues" (una fila por cada descargue de canastas registrado).
    - Se reenvía TODO el histórico local en cada sincronización (no solo lo nuevo) y del lado de Google
      Sheets se hace "upsert" por el campo `id` (actualiza la fila si ya existe, la agrega si no). Esto
      es deliberadamente simple y a este volumen de datos no tiene ningún costo real — y evita llevar un
      estado de "qué ya se sincronizó" en el celular, una fuente clásica de bugs (sincronizaciones a
      medias, duplicados). Si el supervisor editó o eliminó algo DESPUÉS de haber sincronizado antes, la
      próxima sincronización corrige la fila en Sheets sola.
    - Sin backend propio: el destino es un Google Apps Script publicado como "aplicación web" desde la
      propia hoja de cálculo (ver docs/GUIA_GOOGLE_SHEETS.md) — Google aloja ese script gratis.

  Las horas se envían ya formateadas como texto local ("YYYY-MM-DD HH:MM"), NUNCA como ISO/UTC crudo:
  si se mandara el ISO tal cual, Google Apps Script las volvería a interpretar con la zona horaria de
  Google (normalmente no es la de Colombia) y las horas se verían corridas en la hoja.
*/

// ---- Configuración (guardada en db.config, la misma tabla clave/valor de Fase N1) ---------------------

async function obtenerUrlSheets() {
  const fila = await db.config.get('urlSheetsWebApp');
  return fila?.valor || '';
}

async function guardarUrlSheets(url) {
  const limpia = (url || '').trim();
  if (!/^https:\/\/.+/i.test(limpia)) {
    throw new Error('El enlace debe empezar con https:// — copia la URL completa que te dio Google al implementar el script.');
  }
  await db.config.put({ clave: 'urlSheetsWebApp', valor: limpia });
}

async function obtenerUltimaSincronizacionSheets() {
  const fila = await db.config.get('ultimaSincronizacionSheets');
  return fila?.valor || null;
}

async function _registrarUltimaSincronizacionSheets(iso) {
  await db.config.put({ clave: 'ultimaSincronizacionSheets', valor: iso });
  await db.config.put({ clave: 'ultimoErrorSheets', valor: null }); // un envío exitoso limpia el error anterior
}

async function obtenerUltimoErrorSheets() {
  const fila = await db.config.get('ultimoErrorSheets');
  return fila?.valor || null;
}

// ---- Fecha/hora en texto local — mismo criterio que formatearHora()/fechaLocalHoyISO() (nunca UTC) -----

function formatearFechaHoraLocal(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())} ${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

function minutosDeSegundos(segundos) {
  if (segundos == null) return '';
  return Math.round((segundos / 60) * 10) / 10; // un decimal, p.ej. 12.5 minutos
}

// ---- Construcción de filas — mismo orden de columnas siempre, para que la hoja tenga encabezados fijos --

// FASE N16 — se calcula UNA sola vez por sincronización y se reutiliza en Paradas y Checklist (además
// de Cargues) para que esas dos pestañas lleven "fecha" y "placa" del cargue al que pertenecen — sin
// esto, una parada o una respuesta de checklist en la hoja solo traía el `cargue_id`, un número que no
// dice nada por sí solo a quien revisa la hoja desde un computador sin abrir la app.
async function _obtenerCarguesConDetalle() {
  const cargues = await db.cargues.toArray();
  return _cargesConDetalle(cargues); // reutiliza el mismo cruce de cargues.js
}

async function construirFilasCargues(carguesConDetalle) {
  return carguesConDetalle.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    cliente: c.clienteNombre,
    destino_ciudad: c.destinoCiudad,
    placa: c.placa,
    conductor: c.conductorNombre,
    estado: ETIQUETA_ESTADO[c.estado] || c.estado,
    resultado_checklist: c.checklistResultado || '',
    hora_inicio_cargue: formatearFechaHoraLocal(c.horaInicioCargue),
    hora_fin_cargue: formatearFechaHoraLocal(c.horaFinCargue),
    tiempo_total_min: minutosDeSegundos(c.tiempoTotalCargue),
    tiempo_detenido_min: minutosDeSegundos(c.tiempoDetenidoTotal),
    tiempo_productivo_min: minutosDeSegundos(c.tiempoProductivoCargue),
    cantidad_paradas: c.cantidadParadas || 0,
    canastillas_encajables: c.canastillasEncajables ?? '',
    canastillas_grandes: c.canastillasGrandes ?? '',
    canastillas_pequenas: c.canastillasPequenas ?? '',
    actualizado_en: formatearFechaHoraLocal(c.actualizadoEn),
  }));
}

async function construirFilasParadas(carguesConDetalle) {
  const carguePorId = Object.fromEntries(carguesConDetalle.map((c) => [c.id, c]));
  const paradas = await db.paradas.toArray();
  paradas.sort((a, b) => new Date(a.horaInicio) - new Date(b.horaInicio));

  return paradas.map((p) => {
    const cargue = carguePorId[p.cargueId];
    return {
      id: p.id,
      cargue_id: p.cargueId,
      fecha: cargue?.fecha || '',
      placa: cargue?.placa || '',
      categoria: p.categoriaNombreSnapshot,
      causa: p.causaNombreSnapshot,
      responsable: p.responsableNombreSnapshot,
      tipo_tiempo: p.tipoTiempoNombreSnapshot,
      hora_inicio: formatearFechaHoraLocal(p.horaInicio),
      hora_fin: formatearFechaHoraLocal(p.horaFin),
      duracion_min: minutosDeSegundos(p.duracionSegundos),
      observaciones: p.observaciones || '',
      descripcion_otros: p.descripcionOtros || '',
    };
  });
}

async function construirFilasChecklist(carguesConDetalle) {
  const carguePorId = Object.fromEntries(carguesConDetalle.map((c) => [c.id, c]));
  const respuestas = await db.checklistRespuestas.toArray();
  respuestas.sort((a, b) => a.cargueId - b.cargueId || a.ordenSnapshot - b.ordenSnapshot);

  return respuestas.map((r) => {
    const cargue = carguePorId[r.cargueId];
    return {
      id: r.id,
      cargue_id: r.cargueId,
      fecha: cargue?.fecha || '',
      placa: cargue?.placa || '',
      orden: r.ordenSnapshot,
      item: r.textoSnapshot,
      critico: r.criticoSnapshot ? 'Sí' : 'No',
      respuesta: ETIQUETA_RESPUESTA_CHECKLIST[r.respuesta] || r.respuesta || '',
      observacion: r.observacion || '',
    };
  });
}

async function construirFilasDescargues() {
  const descargues = await listarDescarguesConDetalle(); // reutiliza el mismo cruce de descargues.js

  return descargues.map((d) => ({
    id: d.id,
    fecha: d.fecha,
    remision: d.remision || '',
    cliente_origen: d.clienteNombre,
    destino_origen: d.destinoCiudad,
    placa: d.placa,
    conductor: d.conductorNombre,
    hora_inicio: formatearFechaHoraLocal(d.horaInicio),
    hora_fin: formatearFechaHoraLocal(d.horaFin),
    duracion_min: minutosDeSegundos(d.duracionSegundos),
    canastillas_encajables: d.canastillasEncajables || 0,
    canastillas_grandes: d.canastillasGrandes || 0,
    canastillas_pequenas: d.canastillasPequenas || 0,
  }));
}

// ---- Envío ------------------------------------------------------------------------------------------

// Content-Type 'text/plain' (en vez de 'application/json') a propósito: así el navegador NO manda un
// preflight OPTIONS antes del POST, que Google Apps Script no responde por defecto y haría fallar la
// sincronización con un error de red confuso. Apps Script igual puede leer el body como JSON del lado
// del servidor (ver docs/GUIA_GOOGLE_SHEETS.md, Code.gs).
async function sincronizarConSheets() {
  const url = await obtenerUrlSheets();
  if (!url) {
    throw new Error('Todavía no configuras el enlace de Google Sheets. Usa "Configurar enlace" primero.');
  }

  const carguesConDetalle = await _obtenerCarguesConDetalle();
  const [cargues, paradas, checklist, descargues] = await Promise.all([
    construirFilasCargues(carguesConDetalle),
    construirFilasParadas(carguesConDetalle),
    construirFilasChecklist(carguesConDetalle),
    construirFilasDescargues(),
  ]);
  const payload = { app: 'piloto-guapa', enviadoEn: new Date().toISOString(), cargues, paradas, checklist, descargues };

  // Tiempo máximo de espera (Fase N11): la sincronización ahora es automática y silenciosa, así que si
  // la señal es muy mala no puede quedarse "colgada" indefinidamente en segundo plano — a los 15
  // segundos se da por fallida (igual que si no hubiera señal) y la próxima acción del supervisor lo
  // vuelve a intentar solo.
  const control = new AbortController();
  const timeoutId = setTimeout(() => control.abort(), 15000);

  let respuestaCruda;
  try {
    respuestaCruda = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: control.signal,
    });
  } catch (error) {
    throw new Error('No hay conexión a internet en este momento. Se volverá a intentar más adelante.');
  } finally {
    clearTimeout(timeoutId);
  }

  let respuesta;
  try {
    respuesta = await respuestaCruda.json();
  } catch (error) {
    throw new Error('El enlace configurado no respondió como se esperaba. Revisa que sea la URL de "implementación" del script (termina en /exec).');
  }

  if (!respuesta.ok) {
    throw new Error(respuesta.error || 'Google Sheets rechazó los datos enviados.');
  }

  const ahoraIso = new Date().toISOString();
  await _registrarUltimaSincronizacionSheets(ahoraIso);

  return {
    cantidadCargues: cargues.length,
    cantidadParadas: paradas.length,
    cantidadChecklist: checklist.length,
    cantidadDescargues: descargues.length,
    sincronizadoEn: ahoraIso,
  };
}

// ---- Sincronización automática y silenciosa (Fase N11) -----------------------------------------------
//
// La llaman, sin esperar su resultado ni mostrar nada mientras corre, todas las acciones que guardan
// algo importante. Si falla (sin señal, o el enlace aún no está configurado), el error se guarda en
// config.ultimoErrorSheets para que el panel de "Google Sheets" en Herramientas lo pueda mostrar si el
// supervisor quiere revisar por qué — pero nunca interrumpe el flujo del trabajo con una alerta.
async function intentarSincronizarSheetsSilencioso() {
  try {
    await sincronizarConSheets();
  } catch (error) {
    await db.config.put({ clave: 'ultimoErrorSheets', valor: error.message || 'Error desconocido.' });
  }
}
