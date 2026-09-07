/*
  FASE N23 — REDISEÑO: UN SOLO SISTEMA, no "lo mío" vs "lo de otros dispositivos".

  Hasta la Fase N19, esta pieza armaba una sección APARTE ("🌐 En otros dispositivos") con botón de
  "Actualizar" manual. El supervisor de cosecha pidió explícitamente lo contrario: nada de botón (debe
  ser automático), y nada de secciones separadas — un solo Cargues activos, un solo Historial, un solo
  Tablero operativo, sin importar en qué celular se registró cada cosa.

  Este archivo ahora se dedica a NORMALIZAR y COMBINAR: convierte lo que llega de Google Sheets (texto
  plano, minutos, ids globales) a la MISMA forma que ya usan las funciones locales (segundos, nombres ya
  resueltos), y lo mezcla con lo local sin duplicar lo que este mismo celular ya subió — así el resto de
  la app (app.js, indicadores.js) puede tratar todo como una sola fuente de datos, ordenada junta.

  Sigue siendo de SOLO LECTURA del lado remoto: nada de lo que llega de otro celular se puede editar
  desde aquí — lo que un supervisor registra se sigue guardando únicamente en su propio celular y solo se
  ve reflejado en los demás cuando ese celular sincroniza.
*/

const ETIQUETAS_ESTADO_TERMINAL_COMPARTIDO = ['Rechazado', 'Finalizado', 'Cerrado'];
// Sin "Rechazado" — igual criterio que ESTADOS_TERMINALES-menos-rechazo en indicadores.js
// (db.cargues.where('estado').anyOf('FINALIZADO', 'CERRADO')): un cargue rechazado no tiene tiempos.
const ETIQUETAS_ESTADO_FINALIZADO_COMPARTIDO = ['Finalizado', 'Cerrado'];

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

// ---------------------------------------------------------------------------------------------------
// NORMALIZACIÓN PARA LISTAS (Cargues activos / Historial) — un mismo objeto "de vitrina" para pintar una
// tarjeta, venga de donde venga. El origen ('local'/'remoto') es un detalle INTERNO para saber cómo
// enrutar el click (a la pantalla de detalle editable, o a la de solo lectura) — nunca se muestra en
// pantalla, tal como pidió el supervisor ("un solo historial, no sectorizada").
// ---------------------------------------------------------------------------------------------------

function normalizarCargueListaLocal(c) {
  return {
    origen: 'local',
    idLocal: c.id,
    idGlobal: c.idGlobal || null,
    placa: c.placa,
    clienteNombre: c.clienteNombre,
    destinoCiudad: c.destinoCiudad,
    fecha: c.fecha,
    estadoTexto: ETIQUETA_ESTADO[c.estado] || c.estado,
    claseEstado: claseEstado(c.estado),
    ordenClave: c.actualizadoEn || c.creadoEn || '',
  };
}

function normalizarCargueListaRemoto(c) {
  return {
    origen: 'remoto',
    idLocal: null,
    idGlobal: c.id,
    placa: c.placa || '(vehículo eliminado)',
    clienteNombre: c.cliente || '(cliente eliminado)',
    destinoCiudad: c.destino_ciudad || '—',
    fecha: c.fecha || '',
    estadoTexto: c.estado || '—',
    claseEstado: claseEstadoConsolidado(c.estado),
    // "YYYY-MM-DD HH:MM" (formatearFechaHoraLocal en sync-sheets.js) -> "YYYY-MM-DDTHH:MM", comparable
    // como texto con el ISO que usan los registros locales (actualizadoEn/creadoEn).
    ordenClave: (c.actualizado_en || c.fecha || '').replace(' ', 'T'),
  };
}

function normalizarDescargueListaLocal(d) {
  return {
    origen: 'local',
    idLocal: d.id,
    idGlobal: d.idGlobal || null,
    placa: d.placa,
    clienteNombre: d.clienteNombre,
    destinoCiudad: d.destinoCiudad,
    conductorNombre: d.conductorNombre,
    fecha: d.fecha,
    remision: d.remision || '',
    duracionSegundos: d.duracionSegundos || 0,
    canastillasEncajables: d.canastillasEncajables || 0,
    canastillasGrandes: d.canastillasGrandes || 0,
    canastillasPequenas: d.canastillasPequenas || 0,
    ordenClave: d.horaInicio || d.creadoEn || '',
  };
}

function normalizarDescargueListaRemoto(d) {
  return {
    origen: 'remoto',
    idLocal: null,
    idGlobal: d.id,
    placa: d.placa || '(vehículo eliminado)',
    clienteNombre: d.cliente_origen || '(cliente eliminado)',
    destinoCiudad: d.destino_origen || '—',
    conductorNombre: d.conductor || '—',
    fecha: d.fecha || '',
    remision: d.remision || '',
    duracionSegundos: Math.round((Number(d.duracion_min) || 0) * 60),
    canastillasEncajables: Number(d.canastillas_encajables) || 0,
    canastillasGrandes: Number(d.canastillas_grandes) || 0,
    canastillasPequenas: Number(d.canastillas_pequenas) || 0,
    ordenClave: (d.hora_inicio || d.fecha || '').replace(' ', 'T'),
  };
}

// COMBINACIÓN — une lo local con lo remoto SIN DUPLICAR: si este mismo celular ya subió un cargue, ese
// mismo cargue vuelve a llegar en la lectura de Sheets (con el mismo idGlobal) — se descarta la copia
// remota y se deja la local (es la editable / la más al día en este celular). El resultado es UN SOLO
// arreglo, ordenado por más reciente, listo para pintarse como una sola lista, sin secciones.
function combinarListaCargues(localesConDetalle, carguesRemotos, filtroEstadoRemoto) {
  const idsGlobalesLocales = new Set(localesConDetalle.map((c) => c.idGlobal).filter(Boolean));
  const locales = localesConDetalle.map(normalizarCargueListaLocal);
  const remotos = (carguesRemotos || [])
    .filter((c) => filtroEstadoRemoto(c.estado))
    .filter((c) => !idsGlobalesLocales.has(c.id))
    .map(normalizarCargueListaRemoto);
  return [...locales, ...remotos].sort((a, b) => String(b.ordenClave).localeCompare(String(a.ordenClave)));
}

function combinarListaDescargues(localesConDetalle, descarguesRemotos) {
  const idsGlobalesLocales = new Set(localesConDetalle.map((d) => d.idGlobal).filter(Boolean));
  const locales = localesConDetalle.map(normalizarDescargueListaLocal);
  const remotos = (descarguesRemotos || [])
    .filter((d) => !idsGlobalesLocales.has(d.id))
    .map(normalizarDescargueListaRemoto);
  return [...locales, ...remotos].sort((a, b) => String(b.ordenClave).localeCompare(String(a.ordenClave)));
}

// ---------------------------------------------------------------------------------------------------
// PARA EL TABLERO OPERATIVO (indicadores.js) — mismo espíritu, pero con la forma de datos que necesitan
// los cálculos de KPIs: cargues FINALIZADOS/CERRADOS (nunca Rechazados, igual que antes) y paradas
// cerradas, agrupables por TEXTO (placa/cliente/causa) en vez de por id local — un id de catálogo local
// (vehiculoId, clienteId) no significa nada en un registro que vino de OTRO celular.
// ---------------------------------------------------------------------------------------------------

function normalizarCargueTableroLocal(c) {
  return {
    idGlobal: c.idGlobal || `local-${c.id}`,
    fecha: c.fecha,
    placa: c.placa,
    clienteNombre: c.clienteNombre,
    tiempoTotalCargue: c.tiempoTotalCargue || 0,
    tiempoDetenidoTotal: c.tiempoDetenidoTotal || 0,
    tiempoProductivoCargue: c.tiempoProductivoCargue || 0,
    cantidadParadas: c.cantidadParadas || 0,
  };
}

function normalizarCargueTableroRemoto(c) {
  return {
    idGlobal: c.id,
    fecha: c.fecha || '',
    placa: c.placa || '(vehículo eliminado)',
    clienteNombre: c.cliente || '(cliente eliminado)',
    tiempoTotalCargue: Math.round((Number(c.tiempo_total_min) || 0) * 60),
    tiempoDetenidoTotal: Math.round((Number(c.tiempo_detenido_min) || 0) * 60),
    tiempoProductivoCargue: Math.round((Number(c.tiempo_productivo_min) || 0) * 60),
    cantidadParadas: Number(c.cantidad_paradas) || 0,
  };
}

function combinarCarguesFinalizadosTablero(finalizadosLocalesConDetalle, carguesRemotos) {
  const idsGlobalesLocales = new Set(finalizadosLocalesConDetalle.map((c) => c.idGlobal).filter(Boolean));
  const locales = finalizadosLocalesConDetalle.map(normalizarCargueTableroLocal);
  const remotos = (carguesRemotos || [])
    .filter((c) => ETIQUETAS_ESTADO_FINALIZADO_COMPARTIDO.includes(c.estado))
    .filter((c) => !idsGlobalesLocales.has(c.id))
    .map(normalizarCargueTableroRemoto);
  return [...locales, ...remotos];
}

// `paradasLocalesTodas`/`carguesLocalesTodos`: TODOS los registros locales (sin filtrar por rango de
// fecha — el filtro por rango lo sigue haciendo indicadores.js sobre el arreglo de cargues combinados).
function combinarParadasCerradasTablero(paradasLocalesTodas, carguesLocalesTodos, paradasRemotas) {
  const idGlobalPorCargueLocalId = Object.fromEntries(carguesLocalesTodos.map((c) => [c.id, c.idGlobal]));
  const idsGlobalesLocales = new Set(paradasLocalesTodas.map((p) => p.idGlobal).filter(Boolean));

  const locales = paradasLocalesTodas
    .filter((p) => p.horaFin)
    .map((p) => ({
      cargueIdGlobal: idGlobalPorCargueLocalId[p.cargueId] || `local-${p.cargueId}`,
      causaNombreSnapshot: p.causaNombreSnapshot,
      duracionSegundos: p.duracionSegundos || 0,
    }));

  const remotas = (paradasRemotas || [])
    .filter((p) => p.hora_fin && !idsGlobalesLocales.has(p.id))
    .map((p) => ({
      cargueIdGlobal: p.cargue_id,
      causaNombreSnapshot: p.causa || 'Sin causa',
      duracionSegundos: Math.round((Number(p.duracion_min) || 0) * 60),
    }));

  return [...locales, ...remotas];
}

function normalizarDescargueTableroLocal(d) {
  return {
    idGlobal: d.idGlobal || `local-${d.id}`,
    fecha: d.fecha,
    duracionSegundos: d.duracionSegundos || 0,
    canastillasEncajables: d.canastillasEncajables || 0,
    canastillasGrandes: d.canastillasGrandes || 0,
    canastillasPequenas: d.canastillasPequenas || 0,
  };
}

function normalizarDescargueTableroRemoto(d) {
  return {
    idGlobal: d.id,
    fecha: d.fecha || '',
    duracionSegundos: Math.round((Number(d.duracion_min) || 0) * 60),
    canastillasEncajables: Number(d.canastillas_encajables) || 0,
    canastillasGrandes: Number(d.canastillas_grandes) || 0,
    canastillasPequenas: Number(d.canastillas_pequenas) || 0,
  };
}

function combinarDescarguesTablero(descarguesLocalesConDetalle, descarguesRemotos) {
  const idsGlobalesLocales = new Set(descarguesLocalesConDetalle.map((d) => d.idGlobal).filter(Boolean));
  const locales = descarguesLocalesConDetalle.map(normalizarDescargueTableroLocal);
  const remotos = (descarguesRemotos || [])
    .filter((d) => !idsGlobalesLocales.has(d.id))
    .map(normalizarDescargueTableroRemoto);
  return [...locales, ...remotos];
}

// ---------------------------------------------------------------------------------------------------
// PUNTO ÚNICO DE ENTRADA — trae lo compartido UNA vez desde Google Sheets. Si no responde (sin señal, o
// el enlace todavía no está configurado), se resuelve con arreglos vacíos y un texto de error — NUNCA
// lanza el error hacia arriba, para que la pantalla local siga funcionando igual de bien sin internet, y
// para que nunca haga falta un botón de "Actualizar": cada pantalla llama esto sola al abrirse y cada
// minuto mientras siga abierta (ver app.js).
// ---------------------------------------------------------------------------------------------------
async function obtenerDatosCompartidosSeguro() {
  try {
    const datos = await obtenerDatosCompartidos();
    return { datos, error: null };
  } catch (error) {
    return {
      datos: { cargues: [], paradas: [], checklist: [], descargues: [] },
      error: error.message || 'No se pudo traer lo de los demás celulares.',
    };
  }
}
