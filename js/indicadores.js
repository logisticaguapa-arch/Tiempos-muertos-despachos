/*
  FASE N6 — INDICADORES / DASHBOARD SIMPLE.

  Resumen agregado de los cargues ya FINALIZADOS — son los únicos con tiempos calculados (ver
  finalizarCargue() en tiempos.js); un cargue Pendiente/En cargue/Rechazado todavía no tiene esos
  números o nunca los tendrá. Se filtra por la fecha del cargue (el mismo campo `fecha` que ya se ve en
  la lista y en el historial), no por la hora exacta de inicio/fin, para que "Hoy" signifique lo mismo
  en toda la app.

  FASE N23 — el Tablero operativo NO sumaba lo registrado en otros celulares (solo leía db.cargues local),
  algo que el supervisor de cosecha señaló directamente. Las cinco funciones de este archivo ya NO
  consultan Dexie por su cuenta: reciben como parámetro el arreglo YA COMBINADO (local + lo que llegó de
  Google Sheets, ver combinarCarguesFinalizadosTablero/combinarParadasCerradasTablero/
  combinarDescarguesTablero en consolidado.js) y calculan sobre ese arreglo único. Los comparativos por
  vehículo/cliente además cambiaron de agrupar por id de catálogo local (vehiculoId/clienteId, que no
  significa nada en un registro que vino de otro celular) a agrupar por TEXTO (placa/clienteNombre), que
  es lo único que tiene el mismo significado en cualquier celular.
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

// `carguesFinalizadosCombinados`/`paradasCerradasCombinadas`: arreglos YA COMBINADOS (local + remoto, ver
// combinarCarguesFinalizadosTablero/combinarParadasCerradasTablero en consolidado.js) — este cálculo ya
// no distingue de qué celular vino cada uno, solo filtra por fecha dentro del arreglo recibido.
async function calcularIndicadores(filtro, carguesFinalizadosCombinados, paradasCerradasCombinadas) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const enRango = carguesFinalizadosCombinados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));

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
  const idsCargueEnRango = new Set(enRango.map((c) => c.idGlobal));
  const paradasEnRango = paradasCerradasCombinadas.filter((p) => idsCargueEnRango.has(p.cargueIdGlobal));

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
async function calcularIndicadoresDescargue(filtro, descarguesCombinados) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const enRango = descarguesCombinados.filter((d) => (!desde || d.fecha >= desde) && (!hasta || d.fecha <= hasta));

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
async function calcularSerieDiariaCargues(filtro, carguesFinalizadosCombinados) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  let enRango = carguesFinalizadosCombinados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));
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
//
// FASE N23 — se agrupa por la PLACA (texto), no por `vehiculoId` (un id del catálogo local que no
// significa nada en un cargue combinado que vino de otro celular): la placa es lo único que identifica
// al mismo vehículo sin importar en qué celular se registró cada cargue.
async function calcularComparativoPorVehiculo(filtro, carguesFinalizadosCombinados) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const enRango = carguesFinalizadosCombinados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));
  if (enRango.length === 0) return [];

  const acumulado = {};
  for (const c of enRango) {
    const clave = c.placa || '(vehículo eliminado)';
    if (!acumulado[clave]) {
      acumulado[clave] = { placa: clave, cantidad: 0, tiempoTotal: 0, tiempoDetenido: 0 };
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

// Igual que el comparativo por vehículo, pero agrupado por cliente (EXITO/ARA/PDV) — también por TEXTO
// (clienteNombre) en vez de `clienteId`, por la misma razón (Fase N23).
async function calcularComparativoPorCliente(filtro, carguesFinalizadosCombinados) {
  const { desde, hasta } = rangoDeFiltroIndicadores(filtro);
  const enRango = carguesFinalizadosCombinados.filter((c) => (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta));
  if (enRango.length === 0) return [];

  const acumulado = {};
  for (const c of enRango) {
    const clave = c.clienteNombre || '(cliente eliminado)';
    if (!acumulado[clave]) {
      acumulado[clave] = { clienteNombre: clave, cantidad: 0, tiempoTotal: 0 };
    }
    acumulado[clave].cantidad += 1;
    acumulado[clave].tiempoTotal += c.tiempoTotalCargue || 0;
  }

  return Object.values(acumulado)
    .map((c) => ({ ...c, tiempoTotalPromedio: Math.round(c.tiempoTotal / c.cantidad) }))
    .sort((a, b) => b.cantidad - a.cantidad);
}
