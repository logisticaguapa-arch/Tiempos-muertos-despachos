/*
  FASE N2 — CREAR CARGUE. Lógica de negocio (sin backend: todo contra IndexedDB local).
*/

// Fecha local (no UTC) en formato YYYY-MM-DD, para que el selector de fecha empiece siempre en "hoy"
// según la hora real del celular — usar toISOString() aquí sería un error, porque convierte a UTC y
// puede mostrar el día equivocado cerca de la medianoche.
function fechaLocalHoyISO() {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}

// Agrega a cada cargue el nombre de cliente/destino/vehículo/conductor ya resuelto — usado tanto por
// la lista de activos como por el historial (Fase N5), para no repetir el mismo cruce dos veces.
async function _cargesConDetalle(cargues) {
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

  return cargues.map((c) => ({
    ...c,
    clienteNombre: clientePorId[c.clienteId]?.nombre ?? '(cliente eliminado)',
    destinoCiudad: destinoPorId[c.destinoId]?.ciudad ?? '(destino eliminado)',
    placa: vehiculoPorId[c.vehiculoId]?.placa ?? '(vehículo eliminado)',
    conductorNombre: conductorPorId[c.conductorId]?.nombreCompleto ?? '(conductor eliminado)',
  }));
}

async function listarCarguesActivosConDetalle() {
  const cargues = await db.cargues.toArray();
  const activos = cargues.filter((c) => esCargueActivo(c.estado));
  activos.sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn)); // más reciente primero
  return _cargesConDetalle(activos);
}

// FASE N5 — historial: cargues en estado terminal (Finalizado, Cerrado o Rechazado), más recientes
// primero por fecha de última actualización (cuándo se finalizó/rechazó, no cuándo se creó).
async function listarCarguesFinalizadosConDetalle() {
  const cargues = await db.cargues.toArray();
  const finalizados = cargues.filter((c) => !esCargueActivo(c.estado));
  finalizados.sort((a, b) => new Date(b.actualizadoEn) - new Date(a.actualizadoEn));
  return _cargesConDetalle(finalizados);
}

async function crearCargue({ clienteId, destinoId, vehiculoId, conductorId, fecha }) {
  if (!clienteId || !destinoId || !vehiculoId || !conductorId || !fecha) {
    throw new Error('Faltan datos obligatorios para crear el cargue.');
  }
  const ahora = new Date().toISOString();
  const id = await db.cargues.add({
    idGlobal: generarIdGlobal(), // FASE N19 — ver db.js: único entre todos los celulares, no solo en este
    fecha,
    clienteId: Number(clienteId),
    destinoId: Number(destinoId),
    vehiculoId: Number(vehiculoId),
    conductorId: Number(conductorId),
    estado: 'PENDIENTE',
    horaInicioCargue: null,
    horaFinCargue: null,
    tiempoTotalCargue: null,
    tiempoDetenidoTotal: null,
    tiempoProductivoCargue: null,
    cantidadParadas: 0,
    creadoEn: ahora,
    actualizadoEn: ahora,
  });
  return id;
}

// "Agregar nuevo" rápido de vehículo/conductor desde el propio formulario de creación de cargue — los
// catálogos de vehículos y conductores empiezan vacíos (igual que en el proyecto anterior, ver db.js) y
// se van completando así, sin necesidad de una pantalla de administración aparte.
async function agregarVehiculoRapido(placa) {
  const placaLimpia = (placa || '').trim().toUpperCase();
  if (!placaLimpia) throw new Error('La placa no puede estar vacía.');
  const yaExiste = await db.vehiculos.where('placa').equalsIgnoreCase(placaLimpia).first();
  if (yaExiste) return yaExiste.id;
  return db.vehiculos.add({ placa: placaLimpia, estado: 'ACTIVO' });
}

async function agregarConductorRapido(nombreCompleto) {
  const nombreLimpio = (nombreCompleto || '').trim();
  if (!nombreLimpio) throw new Error('El nombre no puede estar vacío.');
  return db.conductores.add({ nombreCompleto: nombreLimpio, estado: 'ACTIVO' });
}
