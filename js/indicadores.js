/*
  FASE N6 — INDICADORES / DASHBOARD SIMPLE.

  Resumen agregado de los cargues ya FINALIZADOS — son los únicos con tiempos calculados (ver
  finalizarCargue() en tiempos.js); un cargue Pendiente/En cargue/Rechazado todavía no tiene esos
  números o nunca los tendrá. Se filtra por la fecha del cargue (el mismo campo `fecha` que ya se ve en
  la lista y en el historial), no por la hora exacta de inicio/fin, para que "Hoy" signifique lo mismo
  en toda la app.
*/

function rangoDeFiltroIndicadores(filtro) {
  const hoy = fechaLocalHoyISO(); // 'YYYY-MM-DD', hora local — ver cargues.js
  const comoISO = (fecha) =>
    `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;

  if (filtro === 'hoy') return { desde: hoy, hasta: hoy };
  if (filtro === '7dias') {
    const desde = new Date();
    desde.setDate(desde.getDate() - 6);
    return { desde: comoISO(desde), hasta: hoy };
  }
  if (filtro === 'mes') {
    const desde = new Date();
    desde.setDate(1);
    return { desde: comoISO(desde), hasta: hoy };
  }
  return { desde: null, hasta: null }; // 'todo'
}

async function calcularIndicadores(filtro) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  // Incluye también 'CERRADO' (estado terminal alcanzable desde FINALIZADO, ver estado.js) — hoy no hay
  // ningún botón que lo dispare, pero si en el futuro lo hay, estos indicadores no deben "perder" esos
  // cargues silenciosamente.
  const finalizados = await db.cargues.where('estado').anyOf('FINALIZADO', 'CERRADO').toArray();
  const enRango = finalizados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));

  if (enRango.length === 0) {
    return { cantidadCargues: 0, promedioTiempoTotal: 0, promedioTiempoDetenido: 0, promedioPorcentajeProductivo: 0, ranking: [] };
  }

  const cantidadCargues = enRango.length;
  const sumaTotal = enRango.reduce((suma, c) => suma + (c.tiempoTotalCargue || 0), 0);
  const sumaDetenido = enRango.reduce((suma, c) => suma + (c.tiempoDetenidoTotal || 0), 0);
  const promedioTiempoTotal = Math.round(sumaTotal / cantidadCargues);
  const promedioTiempoDetenido = Math.round(sumaDetenido / cantidadCargues);

  const porcentajesProductivos = enRango
    .filter((c) => c.tiempoTotalCargue > 0)
    .map((c) => (c.tiempoProductivoCargue / c.tiempoTotalCargue) * 100);
  const promedioPorcentajeProductivo = porcentajesProductivos.length
    ? Math.round(porcentajesProductivos.reduce((suma, p) => suma + p, 0) / porcentajesProductivos.length)
    : 0;

  // Ranking de causas por tiempo acumulado — se recorren las paradas cerradas de los cargues del rango.
  const idsCargueEnRango = new Set(enRango.map((c) => c.id));
  const todasLasParadas = await db.paradas.toArray();
  const paradasEnRango = todasLasParadas.filter((p) => idsCargueEnRango.has(p.cargueId) && p.horaFin);

  const acumuladoPorCausa = {};
  for (const p of paradasEnRango) {
    const clave = p.causaNombreSnapshot;
    if (!acumuladoPorCausa[clave]) acumuladoPorCausa[clave] = { causa: clave, duracionTotal: 0, cantidad: 0 };
    acumuladoPorCausa[clave].duracionTotal += p.duracionSegundos || 0;
    acumuladoPorCausa[clave].cantidad += 1;
  }
  const ranking = Object.values(acumuladoPorCausa)
    .sort((a, b) => b.duracionTotal - a.duracionTotal)
    .slice(0, 6);

  return { cantidadCargues, promedioTiempoTotal, promedioTiempoDetenido, promedioPorcentajeProductivo, ranking };
}

// FASE N11 — tiempo total empleado en descargue de canastas dentro del periodo, más el total de
// canastillas descargadas por tipo. A diferencia de los cargues, un descargue no tiene estado
// "finalizado" — se cuenta apenas se guarda (ver crearDescargue en descargues.js), por eso se filtra
// solo por fecha, no por estado.
async function calcularIndicadoresDescargue(filtro) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const todos = await db.descargues.toArray();
  const enRango = todos.filter((d) => (!desde || d.fecha >= desde) && (!hasta || d.fecha <= hasta));

  const tiempoTotalSegundos = enRango.reduce((suma, d) => suma + (d.duracionSegundos || 0), 0);
  const canastillasEncajables = enRango.reduce((suma, d) => suma + (d.canastillasEncajables || 0), 0);
  const canastillasGrandes = enRango.reduce((suma, d) => suma + (d.canastillasGrandes || 0), 0);
  const canastillasPequenas = enRango.reduce((suma, d) => suma + (d.canastillasPequenas || 0), 0);

  return {
    cantidadDescargues: enRango.length,
    tiempoTotalSegundos,
    canastillasEncajables,
    canastillasGrandes,
    canastillasPequenas,
  };
}

// ---------------------------------------------------------------------------------------------------
// FASE N12 — TABLERO OPERATIVO: gráfica de tendencia por día + comparativos por vehículo y por cliente.
// La pantalla de "Indicadores" (Fase N6) solo mostraba números sueltos y el ranking de causas; esto la
// completa con una vista más parecida a un tablero real (ver feedback del piloto real).
// ---------------------------------------------------------------------------------------------------

function _fechaISO(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

// Límite razonable de días a graficar cuando el filtro es "Todo" (si no, con años de historial la
// gráfica de barras por día se volvería interminable e ilegible).
const MAX_DIAS_SERIE_TODO = 30;

// Cargues finalizados por día, en el rango del filtro — con TODOS los días del rango presentes (incluso
// en cero), para que la gráfica no salte fechas sin datos.
async function calcularSerieDiariaCargues(filtro) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const finalizados = await db.cargues.where('estado').anyOf('FINALIZADO', 'CERRADO').toArray();
  let enRango = finalizados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));
  if (enRango.length === 0) return [];

  let fechaDesde = desde;
  let fechaHasta = hasta;
  if (!fechaDesde || !fechaHasta) {
    const fechasOrdenadas = [...new Set(enRango.map((c) => c.fecha))].sort();
    fechaHasta = fechasOrdenadas[fechasOrdenadas.length - 1];
    const idx = Math.max(0, fechasOrdenadas.length - MAX_DIAS_SERIE_TODO);
    fechaDesde = fechasOrdenadas[idx];
    enRango = enRango.filter((c) => c.fecha >= fechaDesde);
  }

  const acumuladoPorFecha = {};
  for (const c of enRango) {
    if (!acumuladoPorFecha[c.fecha]) acumuladoPorFecha[c.fecha] = { cantidad: 0, tiempoProductivo: 0 };
    acumuladoPorFecha[c.fecha].cantidad += 1;
    acumuladoPorFecha[c.fecha].tiempoProductivo += c.tiempoProductivoCargue || 0;
  }

  const serie = [];
  const cursor = new Date(fechaDesde + 'T00:00:00');
  const fin = new Date(fechaHasta + 'T00:00:00');
  while (cursor <= fin) {
    const iso = _fechaISO(cursor);
    const entrada = acumuladoPorFecha[iso];
    serie.push({ fecha: iso, cantidad: entrada?.cantidad || 0, tiempoProductivo: entrada?.tiempoProductivo || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return serie;
}

// Compara el desempeño entre vehículos dentro del periodo: cantidad de cargues y tiempo total/detenido
// promedio. Se muestran como máximo los 8 vehículos con más cargues, para que la barra siga siendo
// legible en pantallas pequeñas.
async function calcularComparativoPorVehiculo(filtro) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const finalizados = await db.cargues.where('estado').anyOf('FINALIZADO', 'CERRADO').toArray();
  const enRango = finalizados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));
  if (enRango.length === 0) return [];

  const vehiculos = await db.vehiculos.toArray();
  const vehiculoPorId = Object.fromEntries(vehiculos.map((v) => [v.id, v]));

  const acumulado = {};
  for (const c of enRango) {
    const clave = c.vehiculoId;
    if (!acumulado[clave]) {
      acumulado[clave] = {
        placa: vehiculoPorId[clave]?.placa ?? '(vehículo eliminado)',
        cantidad: 0,
        tiempoTotal: 0,
        tiempoDetenido: 0,
      };
    }
    acumulado[clave].cantidad += 1;
    acumulado[clave].tiempoTotal += c.tiempoTotalCargue || 0;
    acumulado[clave].tiempoDetenido += c.tiempoDetenidoTotal || 0;
  }

  return Object.values(acumulado)
    .map((v) => ({ ...v, tiempoTotalPromedio: Math.round(v.tiempoTotal / v.cantidad) }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 8);
}

// Igual que el comparativo por vehículo, pero agrupado por cliente (EXITO/ARA/PDV).
async function calcularComparativoPorCliente(filtro) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const finalizados = await db.cargues.where('estado').anyOf('FINALIZADO', 'CERRADO').toArray();
  const enRango = finalizados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));
  if (enRango.length === 0) return [];

  const clientes = await db.clientes.toArray();
  const clientePorId = Object.fromEntries(clientes.map((c) => [c.id, c]));

  const acumulado = {};
  for (const c of enRango) {
    const clave = c.clienteId;
    if (!acumulado[clave]) {
      acumulado[clave] = {
        clienteNombre: clientePorId[clave]?.nombre ?? '(cliente eliminado)',
        cantidad: 0,
        tiempoTotal: 0,
      };
    }
    acumulado[clave].cantidad += 1;
    acumulado[clave].tiempoTotal += c.tiempoTotalCargue || 0;
  }

  return Object.values(acumulado)
    .map((c) => ({ ...c, tiempoTotalPromedio: Math.round(c.tiempoTotal / c.cantidad) }))
    .sort((a, b) => b.cantidad - a.cantidad);
}
