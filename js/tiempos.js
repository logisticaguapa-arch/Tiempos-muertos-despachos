/*
  FASE N4 — REGISTRO DE TIEMPOS Y PARADAS (entrada manual, sin cronómetro en vivo).

  El supervisor no vive pegado al reloj de la app: cada hora (inicio de cargue, inicio/fin de parada)
  se DIGITA — con un botón [ Ahora ] que rellena la hora actual del celular como ayuda, pero que se puede
  editar libremente. Esto permite registrar lo que pasó incluso si el supervisor no estaba físicamente
  presente en el momento exacto (ver PROPUESTA_ARQUITECTURA_PILOTO_SIMPLE.md, sección 11 — "actualizado:
  registro manual de horas, no cronómetro en vivo").

  Se usa <input type="datetime-local"> (fecha + hora juntas) en vez de solo hora, porque una parada
  digitada después puede cruzar la medianoche o registrarse en un momento distinto al de creación del
  cargue — así nunca hay ambigüedad de a qué día pertenece cada marca de tiempo.
*/

// ---- Utilidades de fecha/hora locales (nunca UTC — mismo criterio que fechaLocalHoyISO() en cargues.js) ----

function datetimeLocalDeAhora() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}T${pad(ahora.getHours())}:${pad(ahora.getMinutes())}`;
}

// El valor de un <input type="datetime-local"> ("YYYY-MM-DDTHH:MM", sin zona horaria) lo interpreta
// `new Date(...)` como hora LOCAL del celular — es justo el comportamiento que se necesita aquí.
function fechaDeDatetimeLocal(valor) {
  if (!valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha;
}

// Igual que datetimeLocalDeAhora(), pero a partir de una fecha ISO ya guardada — se usa para precargar
// los formularios de edición con la hora que ya tiene la parada.
function datetimeLocalDeISO(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

function formatearHora(iso) {
  if (!iso) return '—';
  const fecha = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

function formatearDuracion(segundosTotales) {
  if (segundosTotales == null || segundosTotales < 0) return '—';
  const horas = Math.floor(segundosTotales / 3600);
  const minutos = Math.floor((segundosTotales % 3600) / 60);
  if (horas > 0) return `${horas}h ${minutos}m`;
  return `${minutos}m`;
}

// ---- Iniciar cargue (APROBADO -> EN_CARGUE) ----------------------------------------------------------

async function iniciarCargue(cargueId, horaInicioLocalStr) {
  const horaInicio = fechaDeDatetimeLocal(horaInicioLocalStr);
  if (!horaInicio) throw new Error('Indica la hora de inicio del cargue.');

  const cargue = await db.cargues.get(cargueId);
  if (!esTransicionValida(cargue.estado, 'EN_CARGUE')) {
    throw new Error(`No se puede iniciar el cargue desde el estado "${ETIQUETA_ESTADO[cargue.estado]}".`);
  }

  await db.cargues.update(cargueId, {
    estado: 'EN_CARGUE',
    horaInicioCargue: horaInicio.toISOString(),
    actualizadoEn: new Date().toISOString(),
  });
}

// ---- Catálogo de causas, con nombre de categoría/responsable/tipo de tiempo ya resueltos -------------

async function listarCausasParadaConDetalle() {
  const [causas, categorias, responsables, tiposTiempo] = await Promise.all([
    db.causasParada.toArray(),
    db.categoriasParada.toArray(),
    db.responsables.toArray(),
    db.tiposTiempo.toArray(),
  ]);
  const categoriaPorId = Object.fromEntries(categorias.map((c) => [c.id, c]));
  const responsablePorId = Object.fromEntries(responsables.map((r) => [r.id, r]));
  const tipoTiempoPorId = Object.fromEntries(tiposTiempo.map((t) => [t.id, t]));

  return causas
    .filter((c) => c.activo)
    .map((c) => ({
      ...c,
      categoriaNombre: categoriaPorId[c.categoriaId]?.nombre ?? '(sin categoría)',
      responsableNombre: responsablePorId[c.responsableId]?.nombre ?? '(sin responsable)',
      tipoTiempoNombre: tipoTiempoPorId[c.tipoTiempoId]?.nombre ?? '(sin tipo)',
    }))
    .sort((a, b) => a.categoriaNombre.localeCompare(b.categoriaNombre) || a.nombre.localeCompare(b.nombre));
}

// ---- Consultas de paradas de un cargue -----------------------------------------------------------------

// `horaFin` no sirve para filtrar "abiertas" vía índice (IndexedDB no indexa valores null), así que se
// trae todo el cargue y se filtra en memoria — con 2-3 cargues simultáneos y pocas paradas cada uno esto
// es trivial en volumen.
async function obtenerParadaAbierta(cargueId) {
  const paradas = await db.paradas.where('cargueId').equals(cargueId).toArray();
  return paradas.find((p) => !p.horaFin) ?? null;
}

async function listarParadasDeCargue(cargueId) {
  const paradas = await db.paradas.where('cargueId').equals(cargueId).toArray();
  paradas.sort((a, b) => new Date(a.horaInicio) - new Date(b.horaInicio));
  return paradas;
}

// ---- Registrar parada (EN_CARGUE -> EN_PARADA) ---------------------------------------------------------

async function registrarParada(cargueId, { causaId, horaInicioLocalStr, observaciones, descripcionOtros }) {
  const horaInicio = fechaDeDatetimeLocal(horaInicioLocalStr);
  if (!horaInicio) throw new Error('Indica la hora de inicio de la parada.');
  if (!causaId) throw new Error('Selecciona una causa.');

  const causa = await db.causasParada.get(Number(causaId));
  if (!causa) throw new Error('La causa seleccionada ya no existe.');
  if (causa.requiereDescripcion && !(descripcionOtros || '').trim()) {
    throw new Error('Esta causa exige una descripción.');
  }

  const cargue = await db.cargues.get(cargueId);
  if (!esTransicionValida(cargue.estado, 'EN_PARADA')) {
    throw new Error(`No se puede registrar una parada desde el estado "${ETIQUETA_ESTADO[cargue.estado]}".`);
  }

  const [categoria, responsable, tipoTiempo] = await Promise.all([
    db.categoriasParada.get(causa.categoriaId),
    db.responsables.get(causa.responsableId),
    db.tiposTiempo.get(causa.tipoTiempoId),
  ]);

  await db.transaction('rw', [db.paradas, db.cargues], async () => {
    await db.paradas.add({
      cargueId,
      causaId: causa.id,
      causaNombreSnapshot: causa.nombre,
      categoriaNombreSnapshot: categoria?.nombre ?? '(sin categoría)',
      responsableNombreSnapshot: responsable?.nombre ?? '(sin responsable)',
      tipoTiempoNombreSnapshot: tipoTiempo?.nombre ?? '(sin tipo)',
      horaInicio: horaInicio.toISOString(),
      horaFin: null,
      duracionSegundos: null,
      observaciones: (observaciones || '').trim(),
      descripcionOtros: (descripcionOtros || '').trim(),
    });
    await db.cargues.update(cargueId, { estado: 'EN_PARADA', actualizadoEn: new Date().toISOString() });
  });
}

// ---- Finalizar parada (EN_PARADA -> EN_CARGUE) ---------------------------------------------------------

async function finalizarParada(paradaId, horaFinLocalStr) {
  const horaFin = fechaDeDatetimeLocal(horaFinLocalStr);
  if (!horaFin) throw new Error('Indica la hora de fin de la parada.');

  const parada = await db.paradas.get(paradaId);
  if (!parada) throw new Error('La parada no existe.');
  if (parada.horaFin) throw new Error('Esta parada ya fue finalizada.');

  const horaInicio = new Date(parada.horaInicio);
  const duracionSegundos = Math.round((horaFin - horaInicio) / 1000);
  if (duracionSegundos <= 0) {
    throw new Error('La hora de fin debe ser posterior a la hora de inicio de la parada.');
  }

  const cargue = await db.cargues.get(parada.cargueId);
  if (!esTransicionValida(cargue.estado, 'EN_CARGUE')) {
    throw new Error(`No se puede cerrar la parada desde el estado "${ETIQUETA_ESTADO[cargue.estado]}".`);
  }

  await db.transaction('rw', [db.paradas, db.cargues], async () => {
    await db.paradas.update(paradaId, { horaFin: horaFin.toISOString(), duracionSegundos });
    await db.cargues.update(parada.cargueId, {
      estado: 'EN_CARGUE',
      cantidadParadas: (cargue.cantidadParadas || 0) + 1,
      actualizadoEn: new Date().toISOString(),
    });
  });

  return { duracionSegundos };
}

// ---- Editar y eliminar una parada (Fase N9 — ajustes del piloto real) -----------------------------------
//
// El supervisor digita todo a mano, así que los errores son normales: una causa equivocada, una hora mal
// escrita, o una parada que ni siquiera debió registrarse. Estas dos funciones corrigen eso desde CUALQUIER
// parada — esté el cargue todavía en curso o ya Finalizado (revisado desde el Historial) — porque los
// errores casi siempre se notan después, no en el momento.
//
// Como tiempoDetenidoTotal/tiempoProductivoCargue del cargue solo se calculan una vez, al finalizar (ver
// finalizarCargue arriba), si el cargue YA está finalizado hay que recalcularlos aquí mismo para que no
// queden desactualizados frente a las paradas reales.

async function _recalcularTiemposSiYaFinalizado(cargueId) {
  const cargue = await db.cargues.get(cargueId);
  if (!['FINALIZADO', 'CERRADO'].includes(cargue.estado) || cargue.tiempoTotalCargue == null) return;

  const paradas = await db.paradas.where('cargueId').equals(cargueId).toArray();
  const tiempoDetenidoTotal = paradas.filter((p) => p.horaFin).reduce((total, p) => total + (p.duracionSegundos || 0), 0);
  await db.cargues.update(cargueId, {
    tiempoDetenidoTotal,
    tiempoProductivoCargue: cargue.tiempoTotalCargue - tiempoDetenidoTotal,
    actualizadoEn: new Date().toISOString(),
  });
}

async function editarParada(paradaId, { causaId, horaInicioLocalStr, horaFinLocalStr, observaciones, descripcionOtros }) {
  const parada = await db.paradas.get(paradaId);
  if (!parada) throw new Error('La parada no existe.');

  const horaInicio = fechaDeDatetimeLocal(horaInicioLocalStr);
  if (!horaInicio) throw new Error('Indica la hora de inicio de la parada.');

  // Solo se pide/edita la hora de fin si la parada ya estaba cerrada — una parada todavía abierta se
  // sigue cerrando desde el botón "Finalizar parada", no desde este formulario de edición.
  let horaFin = null;
  let duracionSegundos = null;
  if (parada.horaFin) {
    horaFin = fechaDeDatetimeLocal(horaFinLocalStr);
    if (!horaFin) throw new Error('Indica la hora de fin de la parada.');
    duracionSegundos = Math.round((horaFin - horaInicio) / 1000);
    if (duracionSegundos <= 0) {
      throw new Error('La hora de fin debe ser posterior a la hora de inicio.');
    }
  }

  const causa = await db.causasParada.get(Number(causaId));
  if (!causa) throw new Error('La causa seleccionada ya no existe.');
  if (causa.requiereDescripcion && !(descripcionOtros || '').trim()) {
    throw new Error('Esta causa exige una descripción.');
  }

  const [categoria, responsable, tipoTiempo] = await Promise.all([
    db.categoriasParada.get(causa.categoriaId),
    db.responsables.get(causa.responsableId),
    db.tiposTiempo.get(causa.tipoTiempoId),
  ]);

  const cambios = {
    causaId: causa.id,
    causaNombreSnapshot: causa.nombre,
    categoriaNombreSnapshot: categoria?.nombre ?? '(sin categoría)',
    responsableNombreSnapshot: responsable?.nombre ?? '(sin responsable)',
    tipoTiempoNombreSnapshot: tipoTiempo?.nombre ?? '(sin tipo)',
    horaInicio: horaInicio.toISOString(),
    observaciones: (observaciones || '').trim(),
    descripcionOtros: (descripcionOtros || '').trim(),
  };
  if (parada.horaFin) {
    cambios.horaFin = horaFin.toISOString();
    cambios.duracionSegundos = duracionSegundos;
  }

  await db.paradas.update(paradaId, cambios);
  await _recalcularTiemposSiYaFinalizado(parada.cargueId);
}

async function eliminarParada(paradaId) {
  const parada = await db.paradas.get(paradaId);
  if (!parada) throw new Error('La parada no existe.');

  const cargue = await db.cargues.get(parada.cargueId);
  const eraLaAbierta = !parada.horaFin;

  await db.transaction('rw', [db.paradas, db.cargues], async () => {
    await db.paradas.delete(paradaId);

    const restantes = await db.paradas.where('cargueId').equals(parada.cargueId).toArray();
    const cantidadParadas = restantes.filter((p) => p.horaFin).length;

    const cambios = { cantidadParadas, actualizadoEn: new Date().toISOString() };
    // Si se borra la parada que estaba EN CURSO, se cancela por completo — el cargue vuelve a "En cargue"
    // como si esa parada nunca se hubiera abierto (era exactamente el caso de "borrar una parada mal
    // ingresada" que motivó este ajuste).
    if (eraLaAbierta && cargue.estado === 'EN_PARADA') {
      cambios.estado = 'EN_CARGUE';
    }

    await db.cargues.update(parada.cargueId, cambios);
  });

  await _recalcularTiemposSiYaFinalizado(parada.cargueId);
}

// ---- Finalizar cargue (EN_CARGUE -> FINALIZADO) — Fase N5 -------------------------------------------
// Solo se puede finalizar desde EN_CARGUE (no desde EN_PARADA: primero hay que cerrar la parada abierta,
// lo cual ya lo exige la máquina de estados). Al finalizar se calculan y guardan los tres tiempos que
// alimentan el historial y, más adelante, los indicadores (Fase N6): total, detenido y productivo.
async function finalizarCargue(cargueId, horaFinLocalStr, canastillas) {
  const horaFin = fechaDeDatetimeLocal(horaFinLocalStr);
  if (!horaFin) throw new Error('Indica la hora de fin del cargue.');

  const cargue = await db.cargues.get(cargueId);
  if (!esTransicionValida(cargue.estado, 'FINALIZADO')) {
    throw new Error(`No se puede finalizar el cargue desde el estado "${ETIQUETA_ESTADO[cargue.estado]}".`);
  }

  const horaInicio = new Date(cargue.horaInicioCargue);
  const tiempoTotalCargue = Math.round((horaFin - horaInicio) / 1000);
  if (tiempoTotalCargue <= 0) {
    throw new Error('La hora de fin debe ser posterior a la hora de inicio del cargue.');
  }

  const paradas = await listarParadasDeCargue(cargueId);
  const tiempoDetenidoTotal = paradas.filter((p) => p.horaFin).reduce((total, p) => total + (p.duracionSegundos || 0), 0);
  const tiempoProductivoCargue = tiempoTotalCargue - tiempoDetenidoTotal;

  await db.cargues.update(cargueId, {
    estado: 'FINALIZADO',
    horaFinCargue: horaFin.toISOString(),
    tiempoTotalCargue,
    tiempoDetenidoTotal,
    tiempoProductivoCargue,
    // Canastillas cargadas al vehículo (Fase N11) — enteros no negativos, 0 si no se digitó nada.
    canastillasEncajables: Math.max(0, Number(canastillas?.encajables) || 0),
    canastillasGrandes: Math.max(0, Number(canastillas?.grandes) || 0),
    canastillasPequenas: Math.max(0, Number(canastillas?.pequenas) || 0),
    actualizadoEn: new Date().toISOString(),
  });
}

// ---- Editar horas de un cargue YA finalizado (Fase N11 — ajustes reales del piloto) ------------------
//
// tiempoDetenidoTotal NO cambia aquí (depende solo de las paradas, que se editan aparte) — pero
// tiempoTotalCargue y tiempoProductivoCargue sí, porque dependen directamente de estas dos horas.
async function editarHorasCargue(cargueId, { horaInicioLocalStr, horaFinLocalStr }) {
  const horaInicio = fechaDeDatetimeLocal(horaInicioLocalStr);
  if (!horaInicio) throw new Error('Indica la hora de inicio del cargue.');
  const horaFin = fechaDeDatetimeLocal(horaFinLocalStr);
  if (!horaFin) throw new Error('Indica la hora de fin del cargue.');

  const tiempoTotalCargue = Math.round((horaFin - horaInicio) / 1000);
  if (tiempoTotalCargue <= 0) {
    throw new Error('La hora de fin debe ser posterior a la hora de inicio.');
  }

  const cargue = await db.cargues.get(cargueId);
  const tiempoDetenidoTotal = cargue.tiempoDetenidoTotal || 0;
  if (tiempoTotalCargue < tiempoDetenidoTotal) {
    throw new Error('El tiempo total no puede ser menor que el tiempo ya registrado en las paradas de este cargue.');
  }

  await db.cargues.update(cargueId, {
    horaInicioCargue: horaInicio.toISOString(),
    horaFinCargue: horaFin.toISOString(),
    tiempoTotalCargue,
    tiempoProductivoCargue: tiempoTotalCargue - tiempoDetenidoTotal,
    actualizadoEn: new Date().toISOString(),
  });
}
