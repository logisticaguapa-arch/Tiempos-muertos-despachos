/*
  FASE N11 — DESCARGUE DE CANASTAS.

  Un registro operativo SEPARADO del cargue (no una parada, no un cargue): el vehículo que llega
  devolviendo canastas de un cliente (EXITO/ARA/PDV) se descarga en un momento propio, con su propio
  número de remisión y sus propias horas — nada de esto tiene que ver con si el cargue de fruta de ese
  mismo vehículo ya empezó o terminó. Por eso vive en su tabla (`descargues`, ver db.js v2) y se registra
  desde una opción separada del botón "+", no dentro del flujo de un cargue.

  Reutiliza los catálogos de clientes/destinos/vehículos/conductores que ya existen (mismo cruce que
  _cargesConDetalle en cargues.js) — "de qué PDV vienen" es, en la práctica, el mismo par cliente+destino
  que ya se usa para los cargues (p.ej. cliente PDV, destino APARTADO), no un catálogo nuevo.

  FASE N12 — ajuste real del piloto: al principio solo se pedía el cliente (EXITO/ARA/PDV), pero un
  mismo cliente tiene varios destinos/ciudades — igual que en el cargue, hace falta el par completo
  cliente + destino para saber exactamente de qué punto viene. También se agregó editarDescargue() para
  poder corregir un descargue ya guardado (antes solo se podían corregir paradas y horas de cargue).
*/

function _validarDatosDescargue({ fecha, clienteId, destinoId, vehiculoId, conductorId, horaInicioLocalStr, horaFinLocalStr }) {
  if (!fecha) throw new Error('Indica la fecha.');
  if (!clienteId) throw new Error('Selecciona de qué cliente/PDV vienen las canastas.');
  if (!destinoId) throw new Error('Selecciona de qué destino (ciudad) vienen las canastas.');
  if (!vehiculoId) throw new Error('Selecciona el vehículo.');
  if (!conductorId) throw new Error('Selecciona el conductor.');

  const horaInicio = fechaDeDatetimeLocal(horaInicioLocalStr);
  if (!horaInicio) throw new Error('Indica la hora de inicio.');
  const horaFin = fechaDeDatetimeLocal(horaFinLocalStr);
  if (!horaFin) throw new Error('Indica la hora de fin.');

  const duracionSegundos = Math.round((horaFin - horaInicio) / 1000);
  if (duracionSegundos <= 0) {
    throw new Error('La hora de fin debe ser posterior a la hora de inicio.');
  }

  return { horaInicio, horaFin, duracionSegundos };
}

async function crearDescargue({
  fecha,
  remision,
  clienteId,
  destinoId,
  vehiculoId,
  conductorId,
  horaInicioLocalStr,
  horaFinLocalStr,
  canastillasEncajables,
  canastillasGrandes,
  canastillasPequenas,
}) {
  const { horaInicio, horaFin, duracionSegundos } = _validarDatosDescargue({
    fecha,
    clienteId,
    destinoId,
    vehiculoId,
    conductorId,
    horaInicioLocalStr,
    horaFinLocalStr,
  });

  const ahora = new Date().toISOString();
  return db.descargues.add({
    fecha,
    remision: (remision || '').trim(),
    clienteId: Number(clienteId),
    destinoId: Number(destinoId),
    vehiculoId: Number(vehiculoId),
    conductorId: Number(conductorId),
    horaInicio: horaInicio.toISOString(),
    horaFin: horaFin.toISOString(),
    duracionSegundos,
    canastillasEncajables: Math.max(0, Number(canastillasEncajables) || 0),
    canastillasGrandes: Math.max(0, Number(canastillasGrandes) || 0),
    canastillasPequenas: Math.max(0, Number(canastillasPequenas) || 0),
    creadoEn: ahora,
    actualizadoEn: ahora,
  });
}

// FASE N12 — corregir un descargue ya guardado (remisión, destino, vehículo, conductor, horas o
// canastillas mal digitadas) — mismo espíritu que editarParada/editarHorasCargue en tiempos.js: los
// errores casi siempre se notan después de guardar, no en el momento.
async function editarDescargue(descargueId, {
  fecha,
  remision,
  clienteId,
  destinoId,
  vehiculoId,
  conductorId,
  horaInicioLocalStr,
  horaFinLocalStr,
  canastillasEncajables,
  canastillasGrandes,
  canastillasPequenas,
}) {
  const existente = await db.descargues.get(descargueId);
  if (!existente) throw new Error('El descargue no existe.');

  const { horaInicio, horaFin, duracionSegundos } = _validarDatosDescargue({
    fecha,
    clienteId,
    destinoId,
    vehiculoId,
    conductorId,
    horaInicioLocalStr,
    horaFinLocalStr,
  });

  await db.descargues.update(descargueId, {
    fecha,
    remision: (remision || '').trim(),
    clienteId: Number(clienteId),
    destinoId: Number(destinoId),
    vehiculoId: Number(vehiculoId),
    conductorId: Number(conductorId),
    horaInicio: horaInicio.toISOString(),
    horaFin: horaFin.toISOString(),
    duracionSegundos,
    canastillasEncajables: Math.max(0, Number(canastillasEncajables) || 0),
    canastillasGrandes: Math.max(0, Number(canastillasGrandes) || 0),
    canastillasPequenas: Math.max(0, Number(canastillasPequenas) || 0),
    actualizadoEn: new Date().toISOString(),
  });
}

async function listarDescarguesConDetalle() {
  const descargues = await db.descargues.toArray();
  descargues.sort((a, b) => new Date(b.horaInicio) - new Date(a.horaInicio));

  const [clientes, destinos, vehiculos, conductores] = await Promise.all([
    db.clientes.toArray(),
    db.destinos.toArray(),
    db.vehiculos.toArray(),
    db.conductores.toArray(),
  ]);
  const clientePorId = Object.fromEntries(clientes.map((c) => [c.id, c]));
  const destinoPorId = Object.fromEntries(destinos.map((d) => [d.id, d]));
  const vehiculoPorId = Object.fromEntries(vehiculos.map((v) => [v.id, v]));
  const conductorPorId = Object.fromEntries(conductores.map((c) => [c.id, c]));

  return descargues.map((d) => ({
    ...d,
    clienteNombre: clientePorId[d.clienteId]?.nombre ?? '(cliente eliminado)',
    destinoCiudad: destinoPorId[d.destinoId]?.ciudad ?? (d.destinoId ? '(destino eliminado)' : '—'),
    placa: vehiculoPorId[d.vehiculoId]?.placa ?? '(vehículo eliminado)',
    conductorNombre: conductorPorId[d.conductorId]?.nombreCompleto ?? '(conductor eliminado)',
  }));
}
