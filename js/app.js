/*
  Arranque de la app y navegación entre pantallas.
  Fase N1: login + shell. Fase N2: lista de cargues activos + creación de cargue.
*/

function el(id) {
  return document.getElementById(id);
}

// ---------------------------------------------------------------------------------------------------
// FECHA + HORA "fácil de digitar" (Fase N11) — reemplaza el <input type="datetime-local"> único (que en
// varios celulares Android se ve como un solo control desplegable, incómodo de tocar) por DOS campos
// nativos separados (fecha y hora), igual que cualquier selector de calendario/reloj del celular. Por
// dentro se siguen combinando en el mismo string "YYYY-MM-DDTHH:MM" que ya esperan las funciones de
// negocio (fechaDeDatetimeLocal en tiempos.js) — así este cambio queda contenido en la capa de pantalla,
// sin tocar la lógica ya probada.
// ---------------------------------------------------------------------------------------------------

function separarFechaHora(datetimeLocal) {
  const [fecha, hora] = (datetimeLocal || '').split('T');
  return { fecha: fecha || '', hora: hora || '' };
}

function campoFechaHoraHTML(idPrefix, datetimeLocalInicial) {
  const { fecha, hora } = separarFechaHora(datetimeLocalInicial);
  return `
    <div class="fila-fecha-hora">
      <div class="campo-fecha">
        <label for="${idPrefix}-fecha">Fecha</label>
        <input id="${idPrefix}-fecha" type="date" value="${fecha}" />
      </div>
      <div class="campo-hora">
        <label for="${idPrefix}-hora">Hora</label>
        <input id="${idPrefix}-hora" type="time" value="${hora}" />
      </div>
    </div>
    <button type="button" class="boton-secundario boton-ahora-fecha-hora" data-prefix="${idPrefix}">Ahora</button>`;
}

function leerFechaHora(idPrefix) {
  const campoFecha = el(`${idPrefix}-fecha`);
  const campoHora = el(`${idPrefix}-hora`);
  if (!campoFecha || !campoHora || !campoFecha.value || !campoHora.value) return '';
  return `${campoFecha.value}T${campoHora.value}`;
}

function wireBotonesAhoraFechaHora(contenedor) {
  contenedor.querySelectorAll('.boton-ahora-fecha-hora').forEach((boton) => {
    boton.addEventListener('click', () => {
      const prefix = boton.dataset.prefix;
      const { fecha, hora } = separarFechaHora(datetimeLocalDeAhora());
      el(`${prefix}-fecha`).value = fecha;
      el(`${prefix}-hora`).value = hora;
    });
  });
}

// Dispara una sincronización con Google Sheets SIN esperar su resultado ni mostrar nada mientras corre
// (Fase N11 — ya no hay botón manual "Subir a Google Sheets"). Se llama después de cada acción que
// guarda algo importante; si falla (sin señal, enlace no configurado) queda registrado el error para
// que "Herramientas" lo pueda mostrar, pero nunca bloquea ni interrumpe al supervisor.
function dispararSincronizacionSheets() {
  intentarSincronizarSheetsSilencioso();
}

// Texto de estado que se ve en Herramientas → Google Sheets: última subida exitosa, el último error, o
// que todavía falta configurar el enlace — para que el supervisor sepa si está funcionando sin tener
// que abrir la hoja de cálculo a comprobar.
async function mostrarEstadoSheets() {
  const nota = el('estado-sheets');
  if (!nota) return;
  const [url, ultimoExito, ultimoError] = await Promise.all([
    obtenerUrlSheets(),
    obtenerUltimaSincronizacionSheets(),
    obtenerUltimoErrorSheets(),
  ]);

  if (!url) {
    nota.textContent = 'Todavía no configuras el enlace de Google Sheets.';
    return;
  }
  if (ultimoError) {
    nota.textContent = `Última sincronización falló: ${ultimoError}`;
    return;
  }
  if (ultimoExito) {
    nota.textContent = `Última subida a Google Sheets: ${new Date(ultimoExito).toLocaleString('es-CO')}`;
    return;
  }
  nota.textContent = 'Enlace configurado. Se sincroniza solo con cada acción guardada.';
}

function mostrarPantalla(idPantalla) {
  document.querySelectorAll('.pantalla').forEach((p) => p.setAttribute('hidden', ''));
  el(idPantalla).removeAttribute('hidden');
}

async function mostrarDiagnosticoCatalogos() {
  const panel = el('panel-catalogos');
  const [clientes, destinos, categorias, responsables, tiposTiempo, causas, checklistItems, vehiculos, conductores] =
    await Promise.all([
      db.clientes.count(),
      db.destinos.count(),
      db.categoriasParada.count(),
      db.responsables.count(),
      db.tiposTiempo.count(),
      db.causasParada.count(),
      db.checklistItems.count(),
      db.vehiculos.count(),
      db.conductores.count(),
    ]);
  panel.innerHTML = `<ul>
    <li>Clientes: ${clientes}</li>
    <li>Destinos: ${destinos}</li>
    <li>Categorías de parada: ${categorias}</li>
    <li>Responsables: ${responsables}</li>
    <li>Tipos de tiempo: ${tiposTiempo}</li>
    <li>Causas de parada: ${causas}</li>
    <li>Ítems de checklist: ${checklistItems}</li>
    <li>Vehículos registrados: ${vehiculos}</li>
    <li>Conductores registrados: ${conductores}</li>
  </ul>`;
  panel.removeAttribute('hidden');
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA PRINCIPAL — lista de cargues activos.
// ---------------------------------------------------------------------------------------------------

function claseEstado(estado) {
  if (estado === 'EN_CARGUE') return 'en-cargue';
  if (estado === 'EN_PARADA') return 'en-parada';
  if (estado === 'RECHAZADO') return 'rechazado';
  if (estado === 'FINALIZADO' || estado === 'CERRADO') return 'finalizado';
  return '';
}

async function renderizarListaCargues() {
  const activos = await listarCarguesActivosConDetalle();
  const lista = el('lista-cargues');
  const avisoVacio = el('lista-cargues-vacio');

  if (activos.length === 0) {
    lista.innerHTML = '';
    avisoVacio.removeAttribute('hidden');
    return;
  }
  avisoVacio.setAttribute('hidden', '');

  lista.innerHTML = activos
    .map(
      (c) => `
    <li>
      <button class="tarjeta-cargue" data-cargue-id="${c.id}">
        <div class="fila-superior">
          <span class="placa">${c.placa}</span>
          <span class="etiqueta-estado ${claseEstado(c.estado)}">${ETIQUETA_ESTADO[c.estado] || c.estado}</span>
        </div>
        <div class="cliente-destino">${c.clienteNombre} — ${c.destinoCiudad}</div>
      </button>
    </li>`,
    )
    .join('');

  lista.querySelectorAll('.tarjeta-cargue').forEach((boton) => {
    boton.addEventListener('click', () => abrirDetalleCargue(Number(boton.dataset.cargueId), 'principal'));
  });
}

async function iniciarPantallaPrincipal() {
  mostrarPantalla('pantalla-principal');
  await renderizarListaCargues();
  dispararSincronizacionSheets(); // intento silencioso al abrir/volver a la pantalla principal (Fase N11)
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA: HISTORIAL (Fase N5) — cargues Finalizados, Rechazados o Cerrados.
// ---------------------------------------------------------------------------------------------------

async function renderizarListaHistorial() {
  const finalizados = await listarCarguesFinalizadosConDetalle();
  const lista = el('lista-historial');
  const avisoVacio = el('historial-vacio');

  if (finalizados.length === 0) {
    lista.innerHTML = '';
    avisoVacio.removeAttribute('hidden');
    return;
  }
  avisoVacio.setAttribute('hidden', '');

  lista.innerHTML = finalizados
    .map(
      (c) => `
    <li>
      <button class="tarjeta-cargue" data-cargue-id="${c.id}">
        <div class="fila-superior">
          <span class="placa">${c.placa}</span>
          <span class="etiqueta-estado ${claseEstado(c.estado)}">${ETIQUETA_ESTADO[c.estado] || c.estado}</span>
        </div>
        <div class="cliente-destino">${c.clienteNombre} — ${c.destinoCiudad} · ${c.fecha}</div>
      </button>
    </li>`,
    )
    .join('');

  lista.querySelectorAll('.tarjeta-cargue').forEach((boton) => {
    boton.addEventListener('click', () => abrirDetalleCargue(Number(boton.dataset.cargueId), 'historial'));
  });
}

// FASE N11/N12 — lista de los descargues de canastas, con opción de editar cualquiera de ellos (los
// errores casi siempre se notan después de guardar, igual que con las paradas de un cargue).
function renderizarFilaDescargueHistorial(d) {
  return `
    <li>
      <div class="tarjeta-cargue" data-descargue-id="${d.id}">
        <div class="fila-superior">
          <span class="placa">${d.placa}</span>
          <span class="etiqueta-estado">${formatearDuracion(d.duracionSegundos)}</span>
        </div>
        <div class="cliente-destino">${d.clienteNombre} — ${d.destinoCiudad} · ${d.conductorNombre} · ${d.fecha}${d.remision ? ' · Rem. ' + d.remision : ''}</div>
        <div class="cliente-destino">Encajables: ${d.canastillasEncajables || 0} · Grandes: ${d.canastillasGrandes || 0} · Pequeñas: ${d.canastillasPequenas || 0}</div>
        <div class="acciones-fila-parada">
          <button type="button" class="boton-enlace boton-editar-descargue" data-descargue-id="${d.id}">Editar</button>
        </div>
      </div>
    </li>`;
}

async function renderizarListaDescarguesHistorial() {
  const descargues = await listarDescarguesConDetalle();
  const lista = el('lista-descargues-historial');
  const avisoVacio = el('descargues-vacio');

  if (descargues.length === 0) {
    lista.innerHTML = '';
    avisoVacio.removeAttribute('hidden');
    return;
  }
  avisoVacio.setAttribute('hidden', '');

  lista.innerHTML = descargues.map(renderizarFilaDescargueHistorial).join('');

  lista.querySelectorAll('.boton-editar-descargue').forEach((boton) => {
    boton.addEventListener('click', () => mostrarFormularioEdicionDescargue(Number(boton.dataset.descargueId)));
  });
}

// Reemplaza SOLO esa tarjeta por un formulario de edición — mismo patrón que
// mostrarFormularioEdicionParada en tiempos.js. No se ofrece "agregar vehículo/conductor nuevo" aquí
// (para eso ya existe el formulario de creación) — solo corregir con los datos que ya existen.
async function mostrarFormularioEdicionDescargue(descargueId) {
  const [descargue, clientes, vehiculos, conductores] = await Promise.all([
    db.descargues.get(descargueId),
    db.clientes.orderBy('nombre').toArray(),
    db.vehiculos.orderBy('placa').toArray(),
    db.conductores.orderBy('nombreCompleto').toArray(),
  ]);
  const tarjeta = document.querySelector(`.tarjeta-cargue[data-descargue-id="${descargueId}"]`);
  if (!descargue || !tarjeta) return;

  const destinos = await db.destinos.where('clienteId').equals(descargue.clienteId).sortBy('ciudad');

  tarjeta.innerHTML = `
    <h3>Editar descargue</h3>
    <label for="editar-descargue-fecha-${descargueId}">Fecha</label>
    <input id="editar-descargue-fecha-${descargueId}" type="date" value="${descargue.fecha}" />

    <label for="editar-descargue-remision-${descargueId}">Número de remisión</label>
    <input id="editar-descargue-remision-${descargueId}" type="text" value="${descargue.remision || ''}" />

    <label for="editar-descargue-cliente-${descargueId}">Cliente / PDV de origen</label>
    <select id="editar-descargue-cliente-${descargueId}">
      ${clientes.map((c) => `<option value="${c.id}" ${c.id === descargue.clienteId ? 'selected' : ''}>${c.nombre}</option>`).join('')}
    </select>

    <label for="editar-descargue-destino-${descargueId}">Destino (ciudad) de origen</label>
    <select id="editar-descargue-destino-${descargueId}">
      ${destinos.map((d) => `<option value="${d.id}" ${d.id === descargue.destinoId ? 'selected' : ''}>${d.ciudad}</option>`).join('')}
    </select>

    <label for="editar-descargue-vehiculo-${descargueId}">Vehículo (placa)</label>
    <select id="editar-descargue-vehiculo-${descargueId}">
      ${vehiculos.map((v) => `<option value="${v.id}" ${v.id === descargue.vehiculoId ? 'selected' : ''}>${v.placa}</option>`).join('')}
    </select>

    <label for="editar-descargue-conductor-${descargueId}">Conductor</label>
    <select id="editar-descargue-conductor-${descargueId}">
      ${conductores.map((c) => `<option value="${c.id}" ${c.id === descargue.conductorId ? 'selected' : ''}>${c.nombreCompleto}</option>`).join('')}
    </select>

    <label>Hora de inicio</label>
    ${campoFechaHoraHTML(`editar-descargue-inicio-${descargueId}`, datetimeLocalDeISO(descargue.horaInicio))}
    <label>Hora de fin</label>
    ${campoFechaHoraHTML(`editar-descargue-fin-${descargueId}`, datetimeLocalDeISO(descargue.horaFin))}

    <label for="editar-descargue-encajables-${descargueId}">Canastillas encajables</label>
    <input id="editar-descargue-encajables-${descargueId}" type="number" inputmode="numeric" min="0" value="${descargue.canastillasEncajables || 0}" />
    <label for="editar-descargue-grandes-${descargueId}">Canastillas grandes</label>
    <input id="editar-descargue-grandes-${descargueId}" type="number" inputmode="numeric" min="0" value="${descargue.canastillasGrandes || 0}" />
    <label for="editar-descargue-pequenas-${descargueId}">Canastillas pequeñas</label>
    <input id="editar-descargue-pequenas-${descargueId}" type="number" inputmode="numeric" min="0" value="${descargue.canastillasPequenas || 0}" />

    <div class="acciones-fila-parada">
      <button type="button" class="boton-secundario" id="editar-descargue-guardar-${descargueId}">Guardar cambios</button>
      <button type="button" class="boton-enlace" id="editar-descargue-cancelar-${descargueId}">Cancelar</button>
    </div>
    <p id="editar-descargue-error-${descargueId}" class="mensaje-error" hidden></p>
  `;

  wireBotonesAhoraFechaHora(tarjeta);

  el(`editar-descargue-cliente-${descargueId}`).addEventListener('change', async (evento) => {
    const nuevosDestinos = await db.destinos.where('clienteId').equals(Number(evento.target.value)).sortBy('ciudad');
    el(`editar-descargue-destino-${descargueId}`).innerHTML = nuevosDestinos
      .map((d) => `<option value="${d.id}">${d.ciudad}</option>`)
      .join('');
  });

  el(`editar-descargue-cancelar-${descargueId}`).addEventListener('click', renderizarListaDescarguesHistorial);

  el(`editar-descargue-guardar-${descargueId}`).addEventListener('click', async () => {
    const mensajeError = el(`editar-descargue-error-${descargueId}`);
    mensajeError.hidden = true;
    try {
      await editarDescargue(descargueId, {
        fecha: el(`editar-descargue-fecha-${descargueId}`).value,
        remision: el(`editar-descargue-remision-${descargueId}`).value,
        clienteId: el(`editar-descargue-cliente-${descargueId}`).value,
        destinoId: el(`editar-descargue-destino-${descargueId}`).value,
        vehiculoId: el(`editar-descargue-vehiculo-${descargueId}`).value,
        conductorId: el(`editar-descargue-conductor-${descargueId}`).value,
        horaInicioLocalStr: leerFechaHora(`editar-descargue-inicio-${descargueId}`),
        horaFinLocalStr: leerFechaHora(`editar-descargue-fin-${descargueId}`),
        canastillasEncajables: el(`editar-descargue-encajables-${descargueId}`).value,
        canastillasGrandes: el(`editar-descargue-grandes-${descargueId}`).value,
        canastillasPequenas: el(`editar-descargue-pequenas-${descargueId}`).value,
      });
      dispararSincronizacionSheets();
      await renderizarListaDescarguesHistorial();
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar el cambio.';
      mensajeError.hidden = false;
    }
  });
}

async function abrirPantallaHistorial() {
  mostrarPantalla('pantalla-historial');
  await renderizarListaHistorial();
  await renderizarListaDescarguesHistorial();
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA: INDICADORES (Fase N6) — resumen agregado de los cargues ya Finalizados.
// ---------------------------------------------------------------------------------------------------

// Ancho mínimo del 4% para que una causa con poco tiempo siga teniendo una barra visible (no cero).
function anchoBarraRanking(valor, maximo) {
  if (!maximo) return 0;
  return Math.max(4, Math.round((valor / maximo) * 100));
}

function renderizarFilaRanking(item, maximo) {
  const ancho = anchoBarraRanking(item.duracionTotal, maximo);
  return `
    <div class="fila-ranking">
      <div class="fila-ranking-encabezado">
        <span class="causa-ranking">${item.causa}</span>
        <span class="valor-ranking">${formatearDuracion(item.duracionTotal)} · ${item.cantidad}×</span>
      </div>
      <div class="barra-fondo"><div class="barra-relleno" style="width: ${ancho}%"></div></div>
    </div>`;
}

function renderizarBloqueDescargueIndicadores(datosDescargue) {
  if (datosDescargue.cantidadDescargues === 0) {
    return `<div class="formulario-parada">
      <h2>Descargue de canastas</h2>
      <p class="aviso-vacio-inline">Ningún descargue de canastas registrado en este periodo.</p>
    </div>`;
  }
  return `
    <div class="formulario-parada">
      <h2>Descargue de canastas</h2>
      <div class="fila-kpis">
        <div class="tarjeta-kpi">
          <span class="valor-kpi">${datosDescargue.cantidadDescargues}</span>
          <span class="etiqueta-kpi">Descargues registrados</span>
        </div>
        <div class="tarjeta-kpi">
          <span class="valor-kpi">${formatearDuracion(datosDescargue.tiempoTotalSegundos)}</span>
          <span class="etiqueta-kpi">Tiempo empleado en el periodo</span>
        </div>
      </div>
      <div class="fila"><span>Canastillas encajables</span><span>${datosDescargue.canastillasEncajables}</span></div>
      <div class="fila"><span>Canastillas grandes</span><span>${datosDescargue.canastillasGrandes}</span></div>
      <div class="fila"><span>Canastillas pequeñas</span><span>${datosDescargue.canastillasPequenas}</span></div>
    </div>`;
}

// FASE N12 — gráfica de barras verticales de cargues finalizados por día (tendencia), sin depender de
// ninguna librería externa (la app tiene que poder abrirse sin internet) — mismo espíritu que las barras
// horizontales del ranking de causas, solo que en columnas para leer la evolución día a día.
function renderizarGraficaDiaria(serie) {
  if (!serie.length) return '';
  const maximo = Math.max(...serie.map((d) => d.cantidad), 1);
  return `
    <div class="formulario-parada">
      <h2>Cargues finalizados por día</h2>
      <div class="grafica-barras-dias">
        ${serie
          .map((d) => {
            const alto = d.cantidad ? Math.max(6, Math.round((d.cantidad / maximo) * 100)) : 0;
            const etiquetaFecha = d.fecha.slice(5).replace('-', '/'); // "MM/DD", más compacto en el eje
            return `
          <div class="barra-dia" title="${d.fecha}: ${d.cantidad} cargues · ${formatearDuracion(d.tiempoProductivo)} productivo">
            <span class="barra-dia-valor">${d.cantidad || ''}</span>
            <div class="barra-dia-columna"><div class="barra-dia-relleno" style="height: ${alto}%"></div></div>
            <span class="barra-dia-etiqueta">${etiquetaFecha}</span>
          </div>`;
          })
          .join('')}
      </div>
    </div>`;
}

// Comparativos por vehículo/cliente: mismas barras horizontales del ranking de causas (fila-ranking /
// barra-fondo / barra-relleno), reutilizadas aquí para no inventar un componente nuevo.
function renderizarFilaComparativo(etiqueta, item) {
  return `
    <div class="fila-ranking">
      <div class="fila-ranking-encabezado">
        <span class="causa-ranking">${etiqueta}</span>
        <span class="valor-ranking">${item.cantidad} cargues · prom. ${formatearDuracion(item.tiempoTotalPromedio)}</span>
      </div>
      <div class="barra-fondo"><div class="barra-relleno" style="width: ${anchoBarraRanking(item.cantidad, item._maximo)}%"></div></div>
    </div>`;
}

function renderizarBloqueComparativoVehiculos(lista) {
  if (!lista.length) return '';
  const maximo = lista[0].cantidad;
  return `<div class="formulario-parada">
    <h2>Comparativo por vehículo</h2>
    ${lista.map((v) => renderizarFilaComparativo(v.placa, { ...v, _maximo: maximo })).join('')}
  </div>`;
}

function renderizarBloqueComparativoClientes(lista) {
  if (!lista.length) return '';
  const maximo = lista[0].cantidad;
  return `<div class="formulario-parada">
    <h2>Comparativo por cliente</h2>
    ${lista.map((c) => renderizarFilaComparativo(c.clienteNombre, { ...c, _maximo: maximo })).join('')}
  </div>`;
}

const ETIQUETA_PERIODO_TABLERO = { hoy: 'Hoy', '7dias': 'Últimos 7 días', mes: 'Este mes', todo: 'Todo el histórico' };

async function renderizarIndicadores(filtro) {
  const [datos, datosDescargue, serieDiaria, porVehiculo, porCliente] = await Promise.all([
    calcularIndicadores(filtro),
    calcularIndicadoresDescargue(filtro),
    calcularSerieDiariaCargues(filtro),
    calcularComparativoPorVehiculo(filtro),
    calcularComparativoPorCliente(filtro),
  ]);
  const contenedor = el('contenido-indicadores');

  // Encabezado que solo se ve al imprimir/generar el PDF (ver @media print en estilos.css) — así el
  // informe queda identificado con la fecha en que se generó, sin ensuciar la pantalla normal.
  const encabezadoImpresion = el('encabezado-impresion-tablero');
  if (encabezadoImpresion) {
    encabezadoImpresion.innerHTML = `
      <h1>Agrícola Guapa — Tablero operativo</h1>
      <p>Periodo: ${ETIQUETA_PERIODO_TABLERO[filtro] || filtro} · Generado el ${new Date().toLocaleString('es-CO')}</p>`;
  }

  if (datos.cantidadCargues === 0) {
    contenedor.innerHTML =
      '<p class="aviso-vacio-inline">No hay cargues finalizados en este periodo todavía.</p>' +
      renderizarBloqueDescargueIndicadores(datosDescargue);
    return;
  }

  const maximo = datos.ranking.length ? datos.ranking[0].duracionTotal : 0;

  contenedor.innerHTML = `
    <div class="fila-kpis">
      <div class="tarjeta-kpi">
        <span class="valor-kpi">${datos.cantidadCargues}</span>
        <span class="etiqueta-kpi">Cargues finalizados</span>
      </div>
      <div class="tarjeta-kpi">
        <span class="valor-kpi">${formatearDuracion(datos.promedioTiempoTotal)}</span>
        <span class="etiqueta-kpi">Tiempo total promedio</span>
      </div>
      <div class="tarjeta-kpi">
        <span class="valor-kpi">${formatearDuracion(datos.promedioTiempoDetenido)}</span>
        <span class="etiqueta-kpi">Tiempo detenido promedio</span>
      </div>
      <div class="tarjeta-kpi">
        <span class="valor-kpi">${datos.promedioPorcentajeProductivo}%</span>
        <span class="etiqueta-kpi">Tiempo productivo promedio</span>
      </div>
    </div>
    ${renderizarGraficaDiaria(serieDiaria)}
    ${renderizarBloqueComparativoVehiculos(porVehiculo)}
    ${renderizarBloqueComparativoClientes(porCliente)}
    ${
      datos.ranking.length
        ? `<div class="formulario-parada">
            <h2>Causas de parada con más tiempo</h2>
            ${datos.ranking.map((item) => renderizarFilaRanking(item, maximo)).join('')}
          </div>`
        : '<p class="aviso-vacio-inline">Ningún cargue de este periodo tuvo paradas.</p>'
    }
    ${renderizarBloqueDescargueIndicadores(datosDescargue)}
  `;
}

async function abrirPantallaIndicadores() {
  mostrarPantalla('pantalla-indicadores');
  await renderizarIndicadores(el('campo-filtro-periodo').value);
}

// FASE N12 — "enviar informes del tablero en PDF": la app no tiene servidor propio (todo vive en el
// celular, ver arquitectura general), así que en vez de mandar un correo desde la nada, se apoya en la
// función de "Imprimir" que ya trae Chrome — con destino "Guardar como PDF" genera exactamente el
// archivo, listo para compartir por WhatsApp/correo/Drive como cualquier otro archivo del celular. El
// CSS de impresión (@media print en estilos.css) oculta todo lo que no sea el tablero mismo.
function generarPdfTablero() {
  window.print();
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA: NUEVO CARGUE.
// ---------------------------------------------------------------------------------------------------

async function poblarSelectClientes() {
  const clientes = await db.clientes.orderBy('nombre').toArray();
  const select = el('campo-cliente');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un cliente</option>' +
    clientes.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('');
}

async function poblarSelectDestinos(clienteId) {
  const select = el('campo-destino');
  if (!clienteId) {
    select.innerHTML = '<option value="" disabled selected>Primero elige el cliente</option>';
    select.disabled = true;
    return;
  }
  const destinos = await db.destinos.where('clienteId').equals(Number(clienteId)).sortBy('ciudad');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un destino</option>' +
    destinos.map((d) => `<option value="${d.id}">${d.ciudad}</option>`).join('');
  select.disabled = false;
}

async function poblarSelectVehiculos(idAutoSeleccionar) {
  const vehiculos = await db.vehiculos.orderBy('placa').toArray();
  const select = el('campo-vehiculo');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un vehículo</option>' +
    vehiculos.map((v) => `<option value="${v.id}">${v.placa}</option>`).join('') +
    '<option value="__nuevo__">➕ Agregar vehículo nuevo…</option>';
  if (idAutoSeleccionar) select.value = String(idAutoSeleccionar);
}

async function poblarSelectConductores(idAutoSeleccionar) {
  const conductores = await db.conductores.orderBy('nombreCompleto').toArray();
  const select = el('campo-conductor');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un conductor</option>' +
    conductores.map((c) => `<option value="${c.id}">${c.nombreCompleto}</option>`).join('') +
    '<option value="__nuevo__">➕ Agregar conductor nuevo…</option>';
  if (idAutoSeleccionar) select.value = String(idAutoSeleccionar);
}

async function abrirPantallaNuevoCargue() {
  el('form-nuevo-cargue').reset();
  el('mensaje-error-cargue').hidden = true;
  el('bloque-nuevo-vehiculo').hidden = true;
  el('bloque-nuevo-conductor').hidden = true;
  el('campo-fecha').value = fechaLocalHoyISO();
  await poblarSelectClientes();
  await poblarSelectDestinos(null);
  await poblarSelectVehiculos();
  await poblarSelectConductores();
  mostrarPantalla('pantalla-nuevo-cargue');
}

function manejarSeleccionConOpcionNueva(selectId, bloqueId) {
  el(selectId).addEventListener('change', (evento) => {
    const bloque = el(bloqueId);
    if (evento.target.value === '__nuevo__') {
      bloque.removeAttribute('hidden');
    } else {
      bloque.setAttribute('hidden', '');
    }
  });
}

async function manejarEnvioNuevoCargue(evento) {
  evento.preventDefault();
  const mensajeError = el('mensaje-error-cargue');
  mensajeError.hidden = true;

  try {
    let vehiculoId = el('campo-vehiculo').value;
    if (vehiculoId === '__nuevo__') {
      vehiculoId = await agregarVehiculoRapido(el('campo-nueva-placa').value);
      await poblarSelectVehiculos(vehiculoId);
      el('bloque-nuevo-vehiculo').hidden = true;
    }

    let conductorId = el('campo-conductor').value;
    if (conductorId === '__nuevo__') {
      conductorId = await agregarConductorRapido(el('campo-nuevo-conductor').value);
      await poblarSelectConductores(conductorId);
      el('bloque-nuevo-conductor').hidden = true;
    }

    await crearCargue({
      fecha: el('campo-fecha').value,
      clienteId: el('campo-cliente').value,
      destinoId: el('campo-destino').value,
      vehiculoId,
      conductorId,
    });

    dispararSincronizacionSheets();
    await iniciarPantallaPrincipal();
  } catch (error) {
    mensajeError.textContent = error.message || 'No se pudo crear el cargue.';
    mensajeError.hidden = false;
  }
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA: DETALLE DE CARGUE — datos generales (solo lectura) + checklist interactivo (Fase N3).
// Registro de tiempos/paradas llega en la Fase N4.
// ---------------------------------------------------------------------------------------------------

const ETIQUETA_RESPUESTA_CHECKLIST = { CUMPLE: 'Cumple', NO_CUMPLE: 'No cumple', NO_APLICA: 'No aplica' };
const ETIQUETA_RESULTADO_CHECKLIST = {
  APROBADO: 'Aprobado',
  APROBADO_CON_OBSERVACION: 'Aprobado con observación',
  RECHAZADO: 'Rechazado',
};

function claseBotonOpcion(valor, actual) {
  return valor === actual ? 'boton-opcion seleccionada' : 'boton-opcion';
}

function renderizarItemChecklist(r) {
  return `
    <div class="item-checklist" data-respuesta-id="${r.id}">
      <p class="texto-item">${r.ordenSnapshot}. ${r.textoSnapshot}</p>
      <div class="opciones-respuesta">
        <button type="button" class="${claseBotonOpcion('CUMPLE', r.respuesta)}" data-valor="CUMPLE">Cumple</button>
        <button type="button" class="${claseBotonOpcion('NO_CUMPLE', r.respuesta)}" data-valor="NO_CUMPLE">No cumple</button>
        <button type="button" class="${claseBotonOpcion('NO_APLICA', r.respuesta)}" data-valor="NO_APLICA">No aplica</button>
      </div>
      <textarea class="campo-observacion-item" placeholder="Observación (obligatoria si no cumple)" ${r.respuesta === 'NO_CUMPLE' ? '' : 'hidden'}>${r.observacion || ''}</textarea>
    </div>`;
}

function renderizarChecklistSoloLectura(respuestas, resultado) {
  return `
    <div class="seccion-checklist checklist-solo-lectura">
      <h2>Checklist — ${ETIQUETA_RESULTADO_CHECKLIST[resultado] || resultado}</h2>
      ${respuestas
        .map(
          (r) => `
        <div class="item-checklist-lectura">
          <span>${r.ordenSnapshot}. ${r.textoSnapshot}</span>
          <span class="valor-respuesta">${ETIQUETA_RESPUESTA_CHECKLIST[r.respuesta] || r.respuesta}</span>
          ${r.observacion ? `<p class="observacion-lectura">${r.observacion}</p>` : ''}
        </div>`,
        )
        .join('')}
    </div>`;
}

async function renderizarSeccionChecklist(cargue) {
  const contenedor = el('seccion-checklist');
  const respuestas = await obtenerChecklistDeCargue(cargue.id);
  const puedeEditar = cargue.estado === 'CHECKLIST';

  if (!puedeEditar) {
    contenedor.innerHTML = cargue.checklistResultado
      ? renderizarChecklistSoloLectura(respuestas, cargue.checklistResultado)
      : '';
    return;
  }

  contenedor.innerHTML = `
    <div class="seccion-checklist">
      <h2>Checklist de recepción</h2>
      <div id="items-checklist">${respuestas.map(renderizarItemChecklist).join('')}</div>
      <button type="button" id="boton-finalizar-checklist" class="boton-primario">Finalizar checklist</button>
      <p id="mensaje-error-checklist" class="mensaje-error" hidden></p>
    </div>
  `;

  contenedor.querySelectorAll('.item-checklist').forEach((itemDiv) => {
    const respuestaId = Number(itemDiv.dataset.respuestaId);
    const textarea = itemDiv.querySelector('.campo-observacion-item');

    itemDiv.querySelectorAll('.boton-opcion').forEach((boton) => {
      boton.addEventListener('click', async () => {
        const valor = boton.dataset.valor;

        itemDiv.querySelectorAll('.boton-opcion').forEach((b) => b.classList.remove('seleccionada'));
        boton.classList.add('seleccionada');

        if (valor === 'NO_CUMPLE') {
          textarea.removeAttribute('hidden');
        } else {
          textarea.setAttribute('hidden', '');
        }

        await responderItemChecklist(respuestaId, valor, textarea.value);
      });
    });

    textarea.addEventListener('change', async () => {
      await db.checklistRespuestas.update(respuestaId, { observacion: textarea.value.trim() });
    });
  });

  el('boton-finalizar-checklist').addEventListener('click', async () => {
    const mensajeError = el('mensaje-error-checklist');
    mensajeError.hidden = true;
    try {
      await finalizarChecklist(cargue.id);
      dispararSincronizacionSheets();
      await abrirDetalleCargue(cargue.id); // vuelve a pintar ya con el resultado guardado
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo finalizar el checklist.';
      mensajeError.hidden = false;
    }
  });
}

// ---------------------------------------------------------------------------------------------------
// SECCIÓN: TIEMPOS Y PARADAS (Fase N4) — entrada manual de horas, sin cronómetro en vivo.
// ---------------------------------------------------------------------------------------------------

function opcionesCausasAgrupadas(causas, idSeleccionado) {
  const porCategoria = {};
  causas.forEach((c) => {
    if (!porCategoria[c.categoriaNombre]) porCategoria[c.categoriaNombre] = [];
    porCategoria[c.categoriaNombre].push(c);
  });
  return Object.entries(porCategoria)
    .map(
      ([categoria, items]) => `
    <optgroup label="${categoria}">
      ${items
        .map(
          (c) =>
            `<option value="${c.id}" data-requiere-descripcion="${c.requiereDescripcion ? '1' : '0'}" ${Number(idSeleccionado) === c.id ? 'selected' : ''}>${c.nombre}</option>`,
        )
        .join('')}
    </optgroup>`,
    )
    .join('');
}

// Mensaje de confirmación que se muestra UNA sola vez, justo después de la próxima renderización de esta
// sección — así el supervisor ve "Parada 1 guardada" apenas la pantalla cambia, sin necesidad de ir a
// revisar la lista para confirmar que sí se guardó (ver feedback del piloto real).
let mensajeConfirmacionTiempos = null;

function bannerConfirmacionTiempos() {
  if (!mensajeConfirmacionTiempos) return '';
  const texto = mensajeConfirmacionTiempos;
  mensajeConfirmacionTiempos = null;
  return `<p class="mensaje-ok mensaje-confirmacion">✓ ${texto}</p>`;
}

// `numero` es la posición cronológica de esta parada dentro del cargue (1, 2, 3…) — se recalcula cada vez
// que se pinta la lista, así que si se elimina la parada 2, la que era la 3 pasa a llamarse "Parada 2".
function renderizarFilaParadaHistorial(p, numero) {
  return `
    <div class="fila-parada" data-parada-id="${p.id}">
      <div class="fila-parada-encabezado">
        <span class="causa-parada">Parada ${numero} — ${p.causaNombreSnapshot}</span>
        <span class="duracion-parada">${p.horaFin ? formatearDuracion(p.duracionSegundos) : 'en curso'}</span>
      </div>
      <div class="detalle-parada">${p.categoriaNombreSnapshot} · ${p.responsableNombreSnapshot} · ${formatearHora(p.horaInicio)}${p.horaFin ? ' – ' + formatearHora(p.horaFin) : ''}</div>
      ${p.observaciones ? `<p class="observacion-parada">${p.observaciones}</p>` : ''}
      ${p.descripcionOtros ? `<p class="observacion-parada">${p.descripcionOtros}</p>` : ''}
      <div class="acciones-fila-parada">
        <button type="button" class="boton-enlace boton-editar-parada" data-parada-id="${p.id}">Editar</button>
        <button type="button" class="boton-enlace boton-enlace-peligro boton-eliminar-parada" data-parada-id="${p.id}">Eliminar</button>
      </div>
    </div>`;
}

// Reemplaza SOLO esa fila por un formulario de edición — no repinta toda la sección, para no perder de
// vista en qué parada se estaba trabajando. "Guardar cambios"/"Cancelar" vuelven a pintar el detalle
// completo (abrirDetalleCargue), que ya de por sí refresca esa fila con los datos nuevos.
async function mostrarFormularioEdicionParada(paradaId, cargueId) {
  const parada = await db.paradas.get(paradaId);
  const causas = await listarCausasParadaConDetalle();
  const fila = document.querySelector(`.fila-parada[data-parada-id="${paradaId}"]`);
  if (!parada || !fila) return;

  fila.innerHTML = `
    <h3>Editar parada</h3>
    <label for="editar-causa-${paradaId}">Causa</label>
    <select id="editar-causa-${paradaId}">${opcionesCausasAgrupadas(causas, parada.causaId)}</select>
    <div id="editar-bloque-desc-${paradaId}" ${parada.descripcionOtros ? '' : 'hidden'}>
      <label for="editar-desc-${paradaId}">Descripción</label>
      <textarea id="editar-desc-${paradaId}">${parada.descripcionOtros || ''}</textarea>
    </div>
    <label>Hora de inicio</label>
    ${campoFechaHoraHTML(`editar-inicio-${paradaId}`, datetimeLocalDeISO(parada.horaInicio))}
    ${
      parada.horaFin
        ? `<label>Hora de fin</label>
           ${campoFechaHoraHTML(`editar-fin-${paradaId}`, datetimeLocalDeISO(parada.horaFin))}`
        : ''
    }
    <label for="editar-obs-${paradaId}">Observación</label>
    <textarea id="editar-obs-${paradaId}">${parada.observaciones || ''}</textarea>
    <div class="acciones-fila-parada">
      <button type="button" class="boton-secundario" id="editar-guardar-${paradaId}">Guardar cambios</button>
      <button type="button" class="boton-enlace" id="editar-cancelar-${paradaId}">Cancelar</button>
    </div>
    <p id="editar-error-${paradaId}" class="mensaje-error" hidden></p>
  `;

  wireBotonesAhoraFechaHora(fila);

  el(`editar-causa-${paradaId}`).addEventListener('change', (evento) => {
    const opcion = evento.target.selectedOptions[0];
    const requiere = opcion && opcion.dataset.requiereDescripcion === '1';
    el(`editar-bloque-desc-${paradaId}`).hidden = !requiere;
  });

  el(`editar-cancelar-${paradaId}`).addEventListener('click', () => abrirDetalleCargue(cargueId));

  el(`editar-guardar-${paradaId}`).addEventListener('click', async () => {
    const mensajeError = el(`editar-error-${paradaId}`);
    mensajeError.hidden = true;
    try {
      await editarParada(paradaId, {
        causaId: el(`editar-causa-${paradaId}`).value,
        horaInicioLocalStr: leerFechaHora(`editar-inicio-${paradaId}`),
        horaFinLocalStr: parada.horaFin ? leerFechaHora(`editar-fin-${paradaId}`) : null,
        observaciones: el(`editar-obs-${paradaId}`).value,
        descripcionOtros: el(`editar-desc-${paradaId}`).value,
      });
      mensajeConfirmacionTiempos = 'Cambios guardados.';
      dispararSincronizacionSheets();
      await abrirDetalleCargue(cargueId);
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar el cambio.';
      mensajeError.hidden = false;
    }
  });
}

// Compartido entre la vista "en curso" y el resumen de solo lectura del Historial — en ambas se puede
// editar o eliminar cualquier parada ya cerrada (ver feedback del piloto real).
function wireAccionesParadas(contenedor, cargueId) {
  contenedor.querySelectorAll('.boton-eliminar-parada').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const paradaId = Number(boton.dataset.paradaId);
      if (!window.confirm('¿Eliminar esta parada? Esta acción no se puede deshacer.')) return;
      try {
        await eliminarParada(paradaId);
        mensajeConfirmacionTiempos = 'Parada eliminada.';
        dispararSincronizacionSheets();
        await abrirDetalleCargue(cargueId);
      } catch (error) {
        window.alert(error.message || 'No se pudo eliminar la parada.');
      }
    });
  });

  contenedor.querySelectorAll('.boton-editar-parada').forEach((boton) => {
    boton.addEventListener('click', () => {
      mostrarFormularioEdicionParada(Number(boton.dataset.paradaId), cargueId);
    });
  });
}

// Pestaña activa dentro de "Cargue en curso" (Fase N11 — antes todo iba mezclado en una sola pantalla).
// Se reinicia a 'paradas' cada vez que se abre un detalle de cargue distinto (ver abrirDetalleCargue).
let vistaTiempos = 'paradas';

function renderizarResumenCanastillas(cargue) {
  if (cargue.canastillasEncajables == null && cargue.canastillasGrandes == null && cargue.canastillasPequenas == null) {
    return '';
  }
  return `
    <div class="fila"><span>Canastillas encajables</span><span>${cargue.canastillasEncajables ?? 0}</span></div>
    <div class="fila"><span>Canastillas grandes</span><span>${cargue.canastillasGrandes ?? 0}</span></div>
    <div class="fila"><span>Canastillas pequeñas</span><span>${cargue.canastillasPequenas ?? 0}</span></div>`;
}

async function renderizarSeccionTiempos(cargue) {
  const contenedor = el('seccion-tiempos');

  // Cargue ya finalizado (o cerrado más adelante) -> resumen de solo lectura: tiempos totales + el
  // detalle de paradas que ya se veía mientras estaba en curso. Es lo que se ve al abrir un cargue
  // desde el Historial (Fase N5) — y desde aquí también se puede editar/eliminar una parada mal
  // registrada, o corregir las horas de inicio/fin del cargue completo (Fase N11), aunque el cargue ya
  // haya terminado (los tiempos se recalculan solos).
  if (['FINALIZADO', 'CERRADO'].includes(cargue.estado) && cargue.horaInicioCargue) {
    const paradas = await listarParadasDeCargue(cargue.id);
    const paradasCerradas = paradas.filter((p) => p.horaFin);
    contenedor.innerHTML = `
      <div class="seccion-tiempos">
        ${bannerConfirmacionTiempos()}
        <div class="formulario-parada" id="tarjeta-resumen-cargue">
          <div class="fila-superior-resumen">
            <h2>Resumen del cargue</h2>
            <button type="button" id="boton-editar-horas-cargue" class="boton-enlace">Editar horas</button>
          </div>
          <div class="fila"><span>Inicio</span><span>${formatearHora(cargue.horaInicioCargue)}</span></div>
          <div class="fila"><span>Fin</span><span>${formatearHora(cargue.horaFinCargue)}</span></div>
          <div class="fila"><span>Tiempo total</span><span>${formatearDuracion(cargue.tiempoTotalCargue)}</span></div>
          <div class="fila"><span>Tiempo detenido</span><span>${formatearDuracion(cargue.tiempoDetenidoTotal)}</span></div>
          <div class="fila"><span>Tiempo productivo</span><span>${formatearDuracion(cargue.tiempoProductivoCargue)}</span></div>
          <div class="fila"><span>Paradas registradas</span><span>${cargue.cantidadParadas || 0}</span></div>
          ${renderizarResumenCanastillas(cargue)}
        </div>
        ${
          paradasCerradas.length
            ? `<div class="historial-paradas"><h3>Detalle de paradas</h3>${paradasCerradas.map((p, i) => renderizarFilaParadaHistorial(p, i + 1)).join('')}</div>`
            : ''
        }
      </div>`;
    wireAccionesParadas(contenedor, cargue.id);

    el('boton-editar-horas-cargue').addEventListener('click', () => mostrarFormularioEdicionHorasCargue(cargue));
    return;
  }

  if (!['APROBADO', 'EN_CARGUE', 'EN_PARADA'].includes(cargue.estado)) {
    contenedor.innerHTML = '';
    return;
  }

  if (cargue.estado === 'APROBADO') {
    contenedor.innerHTML = `
      ${bannerConfirmacionTiempos()}
      <div class="formulario-parada">
        <h2>Iniciar cargue</h2>
        <label>Hora de inicio</label>
        ${campoFechaHoraHTML('hora-inicio-cargue', datetimeLocalDeAhora())}
        <button type="button" id="boton-iniciar-cargue" class="boton-primario">Iniciar cargue</button>
        <p id="mensaje-error-tiempos" class="mensaje-error" hidden></p>
      </div>`;

    wireBotonesAhoraFechaHora(contenedor);
    el('boton-iniciar-cargue').addEventListener('click', async () => {
      const mensajeError = el('mensaje-error-tiempos');
      mensajeError.hidden = true;
      try {
        await iniciarCargue(cargue.id, leerFechaHora('hora-inicio-cargue'));
        mensajeConfirmacionTiempos = 'Cargue iniciado.';
        dispararSincronizacionSheets();
        await abrirDetalleCargue(cargue.id);
      } catch (error) {
        mensajeError.textContent = error.message || 'No se pudo iniciar el cargue.';
        mensajeError.hidden = false;
      }
    });
    return;
  }

  // EN_CARGUE o EN_PARADA: dos pestañas separadas (Fase N11 — antes iba todo junto en una sola vista) —
  // "Cargue" (iniciar ya pasó; aquí solo se finaliza) y "Paradas" (registrar una nueva o cerrar la que
  // está abierta, más el historial). Mientras hay una parada abierta no tiene sentido poder finalizar el
  // cargue (la máquina de estados tampoco lo permite), así que la pestaña "Cargue" solo muestra un aviso.
  if (cargue.estado === 'EN_PARADA') vistaTiempos = 'paradas'; // fuerza la pestaña útil en ese momento

  const paradas = await listarParadasDeCargue(cargue.id);
  const paradasCerradas = paradas.filter((p) => p.horaFin);
  const numeroParada = paradasCerradas.length + 1;
  const historialHTML = paradasCerradas.length
    ? `<div class="historial-paradas">
        <h3>Paradas registradas (${paradasCerradas.length})</h3>
        ${paradasCerradas.map((p, i) => renderizarFilaParadaHistorial(p, i + 1)).join('')}
      </div>`
    : '<p class="aviso-sin-paradas">Todavía no hay paradas registradas en este cargue.</p>';

  let panelCargueHTML = '';
  if (cargue.estado === 'EN_PARADA') {
    panelCargueHTML = `<p class="aviso-sin-paradas">Termina la parada en curso (pestaña "Paradas") para poder finalizar el cargue.</p>`;
  } else {
    panelCargueHTML = `
      <div class="formulario-parada">
        <h2>Finalizar cargue</h2>
        <label>Hora de fin</label>
        ${campoFechaHoraHTML('hora-fin-cargue', datetimeLocalDeAhora())}
        <label for="campo-canastillas-encajables">Canastillas encajables cargadas</label>
        <input id="campo-canastillas-encajables" type="number" inputmode="numeric" min="0" value="0" />
        <label for="campo-canastillas-grandes">Canastillas grandes cargadas</label>
        <input id="campo-canastillas-grandes" type="number" inputmode="numeric" min="0" value="0" />
        <label for="campo-canastillas-pequenas">Canastillas pequeñas cargadas</label>
        <input id="campo-canastillas-pequenas" type="number" inputmode="numeric" min="0" value="0" />
        <button type="button" id="boton-finalizar-cargue" class="boton-primario">Finalizar cargue</button>
        <p id="mensaje-error-finalizar-cargue" class="mensaje-error" hidden></p>
      </div>`;
  }

  let panelParadasHTML = '';
  if (cargue.estado === 'EN_CARGUE') {
    const causas = await listarCausasParadaConDetalle();
    panelParadasHTML = `
      <div class="formulario-parada">
        <h2>Registrar parada ${numeroParada}</h2>
        <label for="campo-causa-parada">Causa</label>
        <select id="campo-causa-parada">
          <option value="" disabled selected>Selecciona una causa</option>
          ${opcionesCausasAgrupadas(causas)}
        </select>
        <div id="bloque-descripcion-otros" hidden>
          <label for="campo-descripcion-otros">Descripción</label>
          <textarea id="campo-descripcion-otros" placeholder="Obligatoria para esta causa"></textarea>
        </div>
        <label>Hora de inicio de la parada</label>
        ${campoFechaHoraHTML('hora-inicio-parada', datetimeLocalDeAhora())}
        <label for="campo-observaciones-parada">Observación (opcional)</label>
        <textarea id="campo-observaciones-parada" placeholder="Observación rápida (opcional)"></textarea>
        <button type="button" id="boton-registrar-parada" class="boton-primario">Registrar parada</button>
        <p id="mensaje-error-tiempos" class="mensaje-error" hidden></p>
      </div>
      ${historialHTML}`;
  } else {
    const abierta = await obtenerParadaAbierta(cargue.id);
    panelParadasHTML = `
      <div class="formulario-parada">
        <h2>Parada ${numeroParada} en curso</h2>
        <div class="fila-parada fila-parada-abierta">
          <div class="fila-parada-encabezado">
            <span class="causa-parada">${abierta.causaNombreSnapshot}</span>
          </div>
          <div class="detalle-parada">${abierta.categoriaNombreSnapshot} · ${abierta.responsableNombreSnapshot} · desde ${formatearHora(abierta.horaInicio)}</div>
          ${abierta.observaciones ? `<p class="observacion-parada">${abierta.observaciones}</p>` : ''}
          ${abierta.descripcionOtros ? `<p class="observacion-parada">${abierta.descripcionOtros}</p>` : ''}
        </div>
        <label>Hora de fin de la parada</label>
        ${campoFechaHoraHTML('hora-fin-parada', datetimeLocalDeAhora())}
        <button type="button" id="boton-finalizar-parada" class="boton-primario">Finalizar parada</button>
        <button type="button" id="boton-cancelar-parada" class="boton-enlace boton-enlace-peligro">Esta parada no debió registrarse — cancelarla</button>
        <p id="mensaje-error-tiempos" class="mensaje-error" hidden></p>
      </div>
      ${historialHTML}`;
  }

  contenedor.innerHTML = `
    ${bannerConfirmacionTiempos()}
    <div class="tabs-tiempos">
      <button type="button" class="tab-tiempos ${vistaTiempos === 'cargue' ? 'activa' : ''}" data-tab="cargue">Cargue</button>
      <button type="button" class="tab-tiempos ${vistaTiempos === 'paradas' ? 'activa' : ''}" data-tab="paradas">Paradas</button>
    </div>
    <div class="seccion-tiempos" id="panel-tiempos-cargue" ${vistaTiempos !== 'cargue' ? 'hidden' : ''}>${panelCargueHTML}</div>
    <div class="seccion-tiempos" id="panel-tiempos-paradas" ${vistaTiempos !== 'paradas' ? 'hidden' : ''}>${panelParadasHTML}</div>`;

  contenedor.querySelectorAll('.tab-tiempos').forEach((boton) => {
    boton.addEventListener('click', () => {
      vistaTiempos = boton.dataset.tab;
      contenedor.querySelectorAll('.tab-tiempos').forEach((b) => b.classList.toggle('activa', b === boton));
      el('panel-tiempos-cargue').hidden = vistaTiempos !== 'cargue';
      el('panel-tiempos-paradas').hidden = vistaTiempos !== 'paradas';
    });
  });

  wireBotonesAhoraFechaHora(contenedor);
  wireAccionesParadas(contenedor, cargue.id);

  if (cargue.estado === 'EN_CARGUE') {
    const selectCausa = el('campo-causa-parada');
    selectCausa.addEventListener('change', () => {
      const opcion = selectCausa.selectedOptions[0];
      const requiere = opcion && opcion.dataset.requiereDescripcion === '1';
      el('bloque-descripcion-otros').hidden = !requiere;
    });
    el('boton-registrar-parada').addEventListener('click', async () => {
      const mensajeError = el('mensaje-error-tiempos');
      mensajeError.hidden = true;
      try {
        await registrarParada(cargue.id, {
          causaId: el('campo-causa-parada').value,
          horaInicioLocalStr: leerFechaHora('hora-inicio-parada'),
          observaciones: el('campo-observaciones-parada').value,
          descripcionOtros: el('campo-descripcion-otros').value,
        });
        mensajeConfirmacionTiempos = `Parada ${numeroParada} guardada.`;
        dispararSincronizacionSheets();
        await abrirDetalleCargue(cargue.id);
      } catch (error) {
        mensajeError.textContent = error.message || 'No se pudo registrar la parada.';
        mensajeError.hidden = false;
      }
    });

    el('boton-finalizar-cargue').addEventListener('click', async () => {
      const mensajeErrorFinal = el('mensaje-error-finalizar-cargue');
      mensajeErrorFinal.hidden = true;
      try {
        await finalizarCargue(cargue.id, leerFechaHora('hora-fin-cargue'), {
          encajables: el('campo-canastillas-encajables').value,
          grandes: el('campo-canastillas-grandes').value,
          pequenas: el('campo-canastillas-pequenas').value,
        });
        mensajeConfirmacionTiempos = 'Cargue finalizado.';
        dispararSincronizacionSheets();
        await abrirDetalleCargue(cargue.id);
      } catch (error) {
        mensajeErrorFinal.textContent = error.message || 'No se pudo finalizar el cargue.';
        mensajeErrorFinal.hidden = false;
      }
    });
  } else {
    el('boton-finalizar-parada').addEventListener('click', async () => {
      const mensajeError = el('mensaje-error-tiempos');
      mensajeError.hidden = true;
      try {
        const abierta = await obtenerParadaAbierta(cargue.id);
        const resultado = await finalizarParada(abierta.id, leerFechaHora('hora-fin-parada'));
        mensajeConfirmacionTiempos = `Parada ${numeroParada} finalizada (duración: ${formatearDuracion(resultado.duracionSegundos)}).`;
        dispararSincronizacionSheets();
        await abrirDetalleCargue(cargue.id);
      } catch (error) {
        mensajeError.textContent = error.message || 'No se pudo finalizar la parada.';
        mensajeError.hidden = false;
      }
    });
    el('boton-cancelar-parada').addEventListener('click', async () => {
      if (!window.confirm(`¿Cancelar la parada ${numeroParada}? Se borrará por completo, como si nunca se hubiera registrado.`)) return;
      try {
        const abierta = await obtenerParadaAbierta(cargue.id);
        await eliminarParada(abierta.id);
        mensajeConfirmacionTiempos = `Parada ${numeroParada} cancelada.`;
        dispararSincronizacionSheets();
        await abrirDetalleCargue(cargue.id);
      } catch (error) {
        window.alert(error.message || 'No se pudo cancelar la parada.');
      }
    });
  }
}

// Edición de las horas de un cargue YA finalizado (Fase N11), desde el Historial — reemplaza la
// tarjeta de resumen por un formulario inline, igual que mostrarFormularioEdicionParada.
async function mostrarFormularioEdicionHorasCargue(cargue) {
  const tarjeta = el('tarjeta-resumen-cargue');
  if (!tarjeta) return;

  tarjeta.innerHTML = `
    <h2>Editar horas del cargue</h2>
    <label>Hora de inicio</label>
    ${campoFechaHoraHTML('editar-cargue-inicio', datetimeLocalDeISO(cargue.horaInicioCargue))}
    <label>Hora de fin</label>
    ${campoFechaHoraHTML('editar-cargue-fin', datetimeLocalDeISO(cargue.horaFinCargue))}
    <div class="acciones-fila-parada">
      <button type="button" class="boton-secundario" id="boton-guardar-horas-cargue">Guardar cambios</button>
      <button type="button" class="boton-enlace" id="boton-cancelar-horas-cargue">Cancelar</button>
    </div>
    <p id="mensaje-error-horas-cargue" class="mensaje-error" hidden></p>`;

  wireBotonesAhoraFechaHora(tarjeta);
  el('boton-cancelar-horas-cargue').addEventListener('click', () => abrirDetalleCargue(cargue.id));
  el('boton-guardar-horas-cargue').addEventListener('click', async () => {
    const mensajeError = el('mensaje-error-horas-cargue');
    mensajeError.hidden = true;
    try {
      await editarHorasCargue(cargue.id, {
        horaInicioLocalStr: leerFechaHora('editar-cargue-inicio'),
        horaFinLocalStr: leerFechaHora('editar-cargue-fin'),
      });
      mensajeConfirmacionTiempos = 'Horas del cargue actualizadas.';
      dispararSincronizacionSheets();
      await abrirDetalleCargue(cargue.id);
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar el cambio.';
      mensajeError.hidden = false;
    }
  });
}

// Recuerda desde dónde se abrió el detalle (lista principal o historial) para que "‹ Volver" regrese
// al lugar correcto — se actualiza solo cuando se indica explícitamente un origen; las re-renderizaciones
// del propio detalle (tras responder el checklist, registrar una parada, etc.) no lo cambian.
let origenDetalleCargue = 'principal';

let _ultimoCargueIdAbierto = null;

async function abrirDetalleCargue(cargueId, origen) {
  if (origen) origenDetalleCargue = origen;
  if (_ultimoCargueIdAbierto !== cargueId) vistaTiempos = 'paradas'; // pestaña por defecto al entrar a otro cargue
  _ultimoCargueIdAbierto = cargueId;

  await asegurarChecklistCreado(cargueId);
  const cargue = await db.cargues.get(cargueId);
  const [cliente, destino, vehiculo, conductor] = await Promise.all([
    db.clientes.get(cargue.clienteId),
    db.destinos.get(cargue.destinoId),
    db.vehiculos.get(cargue.vehiculoId),
    db.conductores.get(cargue.conductorId),
  ]);

  el('contenido-detalle-cargue').innerHTML = `
    <div class="fila"><span>Estado</span><span>${ETIQUETA_ESTADO[cargue.estado] || cargue.estado}</span></div>
    <div class="fila"><span>Fecha</span><span>${cargue.fecha}</span></div>
    <div class="fila"><span>Cliente</span><span>${cliente?.nombre ?? '—'}</span></div>
    <div class="fila"><span>Destino</span><span>${destino?.ciudad ?? '—'}</span></div>
    <div class="fila"><span>Vehículo</span><span>${vehiculo?.placa ?? '—'}</span></div>
    <div class="fila"><span>Conductor</span><span>${conductor?.nombreCompleto ?? '—'}</span></div>
    ${
      cargue.horaInicioCargue && ['EN_CARGUE', 'EN_PARADA'].includes(cargue.estado)
        ? `<div class="fila"><span>Inicio cargue</span><span>${formatearHora(cargue.horaInicioCargue)}</span></div>`
        : ''
    }
  `;

  await renderizarSeccionChecklist(cargue);
  await renderizarSeccionTiempos(cargue);
  mostrarPantalla('pantalla-detalle-cargue');
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA: DESCARGUE DE CANASTAS (Fase N11) — registro operativo separado del cargue.
// ---------------------------------------------------------------------------------------------------

async function poblarSelectClientesDescargue() {
  const clientes = await db.clientes.orderBy('nombre').toArray();
  const select = el('campo-descargue-cliente');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona el cliente</option>' +
    clientes.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('');
}

// FASE N12 — el destino (ciudad) es el mismo dato que ya se pide al crear un cargue (poblarSelectDestinos
// arriba): un cliente como "PDV" reparte a varias ciudades distintas, así que con solo el cliente no
// queda claro de qué punto exacto vienen las canastas (ver feedback del piloto real).
async function poblarSelectDestinosDescargue(clienteId) {
  const select = el('campo-descargue-destino');
  if (!clienteId) {
    select.innerHTML = '<option value="" disabled selected>Primero elige el cliente</option>';
    select.disabled = true;
    return;
  }
  const destinos = await db.destinos.where('clienteId').equals(Number(clienteId)).sortBy('ciudad');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un destino</option>' +
    destinos.map((d) => `<option value="${d.id}">${d.ciudad}</option>`).join('');
  select.disabled = false;
}

async function poblarSelectVehiculosDescargue(idAutoSeleccionar) {
  const vehiculos = await db.vehiculos.orderBy('placa').toArray();
  const select = el('campo-descargue-vehiculo');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un vehículo</option>' +
    vehiculos.map((v) => `<option value="${v.id}">${v.placa}</option>`).join('') +
    '<option value="__nuevo__">➕ Agregar vehículo nuevo…</option>';
  if (idAutoSeleccionar) select.value = String(idAutoSeleccionar);
}

async function poblarSelectConductoresDescargue(idAutoSeleccionar) {
  const conductores = await db.conductores.orderBy('nombreCompleto').toArray();
  const select = el('campo-descargue-conductor');
  select.innerHTML =
    '<option value="" disabled selected>Selecciona un conductor</option>' +
    conductores.map((c) => `<option value="${c.id}">${c.nombreCompleto}</option>`).join('') +
    '<option value="__nuevo__">➕ Agregar conductor nuevo…</option>';
  if (idAutoSeleccionar) select.value = String(idAutoSeleccionar);
}

async function abrirPantallaNuevoDescargue() {
  el('form-nuevo-descargue').reset();
  el('form-nuevo-descargue').hidden = false;
  el('confirmacion-descargue').hidden = true;
  el('mensaje-error-descargue').hidden = true;
  el('bloque-descargue-nuevo-vehiculo').hidden = true;
  el('bloque-descargue-nuevo-conductor').hidden = true;
  el('campo-descargue-fecha').value = fechaLocalHoyISO();
  await poblarSelectDestinosDescargue(null);
  el('campo-descargue-inicio-contenedor').innerHTML = campoFechaHoraHTML('descargue-inicio', datetimeLocalDeAhora());
  el('campo-descargue-fin-contenedor').innerHTML = campoFechaHoraHTML('descargue-fin', datetimeLocalDeAhora());
  wireBotonesAhoraFechaHora(el('campo-descargue-inicio-contenedor'));
  wireBotonesAhoraFechaHora(el('campo-descargue-fin-contenedor'));
  await poblarSelectClientesDescargue();
  await poblarSelectVehiculosDescargue();
  await poblarSelectConductoresDescargue();
  mostrarPantalla('pantalla-nuevo-descargue');
}

async function manejarEnvioNuevoDescargue(evento) {
  evento.preventDefault();
  const mensajeError = el('mensaje-error-descargue');
  mensajeError.hidden = true;

  try {
    let vehiculoId = el('campo-descargue-vehiculo').value;
    if (vehiculoId === '__nuevo__') {
      vehiculoId = await agregarVehiculoRapido(el('campo-descargue-nueva-placa').value);
      await poblarSelectVehiculosDescargue(vehiculoId);
      el('bloque-descargue-nuevo-vehiculo').hidden = true;
    }

    let conductorId = el('campo-descargue-conductor').value;
    if (conductorId === '__nuevo__') {
      conductorId = await agregarConductorRapido(el('campo-descargue-nuevo-conductor').value);
      await poblarSelectConductoresDescargue(conductorId);
      el('bloque-descargue-nuevo-conductor').hidden = true;
    }

    await crearDescargue({
      fecha: el('campo-descargue-fecha').value,
      remision: el('campo-descargue-remision').value,
      clienteId: el('campo-descargue-cliente').value,
      destinoId: el('campo-descargue-destino').value,
      vehiculoId,
      conductorId,
      horaInicioLocalStr: leerFechaHora('descargue-inicio'),
      horaFinLocalStr: leerFechaHora('descargue-fin'),
      canastillasEncajables: el('campo-descargue-encajables').value,
      canastillasGrandes: el('campo-descargue-grandes').value,
      canastillasPequenas: el('campo-descargue-pequenas').value,
    });

    dispararSincronizacionSheets();
    // FASE N12 — se queda en esta misma pantalla mostrando la confirmación (en vez de regresar sola al
    // inicio), con la opción de registrar otro descargue seguido o volver cuando el supervisor decida.
    el('form-nuevo-descargue').hidden = true;
    el('confirmacion-descargue').hidden = false;
  } catch (error) {
    mensajeError.textContent = error.message || 'No se pudo guardar el descargue.';
    mensajeError.hidden = false;
  }
}

// ---------------------------------------------------------------------------------------------------
// PANTALLA: GESTIÓN DE CAUSAS DE TIEMPOS MUERTOS (Fase N11).
// ---------------------------------------------------------------------------------------------------

function renderizarFilaCausa(c) {
  return `
    <div class="fila-parada" data-causa-id="${c.id}">
      <div class="fila-parada-encabezado">
        <span class="causa-parada">${c.nombre}</span>
        <span class="etiqueta-estado ${c.activo ? 'en-cargue' : 'rechazado'}">${c.activo ? 'Activa' : 'Inactiva'}</span>
      </div>
      <div class="detalle-parada">${c.categoriaNombre} · ${c.responsableNombre} · ${c.tipoTiempoNombre}</div>
      <div class="acciones-fila-parada">
        <button type="button" class="boton-enlace boton-editar-causa" data-causa-id="${c.id}">Editar</button>
      </div>
    </div>`;
}

async function renderizarListaCausas() {
  const causas = await listarTodasLasCausasConDetalle();
  el('lista-causas').innerHTML = causas.map(renderizarFilaCausa).join('');
  el('lista-causas').querySelectorAll('.boton-editar-causa').forEach((boton) => {
    boton.addEventListener('click', () => mostrarFormularioEdicionCausa(Number(boton.dataset.causaId)));
  });
}

function opcionesSelectSimple(items, idSeleccionado) {
  return items.map((i) => `<option value="${i.id}" ${Number(idSeleccionado) === i.id ? 'selected' : ''}>${i.nombre}</option>`).join('');
}

const ETIQUETA_TIPO_TIEMPO = {
  TIEMPO_MUERTO: 'Tiempo muerto',
  ESPERA: 'Espera',
  REPROCESO: 'Reproceso',
  ACTIVIDAD_OPERATIVA: 'Actividad operativa',
};

async function mostrarFormularioEdicionCausa(causaId) {
  const [causa, categorias, responsables, tiposTiempo] = await Promise.all([
    db.causasParada.get(causaId),
    listarCategoriasParadaTodas(),
    listarResponsablesTodos(),
    listarTiposTiempoTodos(),
  ]);
  const fila = document.querySelector(`#lista-causas [data-causa-id="${causaId}"]`);
  if (!causa || !fila) return;

  fila.innerHTML = `
    <h3>Editar causa</h3>
    <label for="editar-causa-nombre-${causaId}">Nombre</label>
    <input id="editar-causa-nombre-${causaId}" type="text" value="${causa.nombre}" />
    <label for="editar-causa-categoria-${causaId}">Categoría</label>
    <select id="editar-causa-categoria-${causaId}">${opcionesSelectSimple(categorias, causa.categoriaId)}</select>
    <label for="editar-causa-responsable-${causaId}">Responsable</label>
    <select id="editar-causa-responsable-${causaId}">${opcionesSelectSimple(responsables, causa.responsableId)}</select>
    <label for="editar-causa-tipo-${causaId}">Tipo de tiempo</label>
    <select id="editar-causa-tipo-${causaId}">
      ${tiposTiempo.map((t) => `<option value="${t.id}" ${Number(causa.tipoTiempoId) === t.id ? 'selected' : ''}>${ETIQUETA_TIPO_TIEMPO[t.nombre] || t.nombre}</option>`).join('')}
    </select>
    <label class="etiqueta-checkbox">
      <input type="checkbox" id="editar-causa-requiere-desc-${causaId}" ${causa.requiereDescripcion ? 'checked' : ''} /> Exige descripción obligatoria
    </label>
    <label class="etiqueta-checkbox">
      <input type="checkbox" id="editar-causa-activo-${causaId}" ${causa.activo ? 'checked' : ''} /> Activa (aparece para elegir en las paradas)
    </label>
    <div class="acciones-fila-parada">
      <button type="button" class="boton-secundario" id="editar-causa-guardar-${causaId}">Guardar cambios</button>
      <button type="button" class="boton-enlace" id="editar-causa-cancelar-${causaId}">Cancelar</button>
    </div>
    <p id="editar-causa-error-${causaId}" class="mensaje-error" hidden></p>`;

  el(`editar-causa-cancelar-${causaId}`).addEventListener('click', renderizarListaCausas);
  el(`editar-causa-guardar-${causaId}`).addEventListener('click', async () => {
    const mensajeError = el(`editar-causa-error-${causaId}`);
    mensajeError.hidden = true;
    try {
      await editarCausa(causaId, {
        nombre: el(`editar-causa-nombre-${causaId}`).value,
        categoriaId: el(`editar-causa-categoria-${causaId}`).value,
        responsableId: el(`editar-causa-responsable-${causaId}`).value,
        tipoTiempoId: el(`editar-causa-tipo-${causaId}`).value,
        requiereDescripcion: el(`editar-causa-requiere-desc-${causaId}`).checked,
        activo: el(`editar-causa-activo-${causaId}`).checked,
      });
      await renderizarListaCausas();
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar el cambio.';
      mensajeError.hidden = false;
    }
  });
}

async function poblarFormularioNuevaCausa() {
  const [categorias, responsables, tiposTiempo] = await Promise.all([
    listarCategoriasParadaTodas(),
    listarResponsablesTodos(),
    listarTiposTiempoTodos(),
  ]);
  el('campo-nueva-causa-categoria').innerHTML = opcionesSelectSimple(categorias);
  el('campo-nueva-causa-responsable').innerHTML = opcionesSelectSimple(responsables);
  el('campo-nueva-causa-tipo').innerHTML = tiposTiempo
    .map((t) => `<option value="${t.id}">${ETIQUETA_TIPO_TIEMPO[t.nombre] || t.nombre}</option>`)
    .join('');
}

async function abrirPantallaGestionCausas() {
  el('panel-herramientas').hidden = true; // cierra el panel para no dejarlo abierto de fondo
  await renderizarListaCausas();
  await poblarFormularioNuevaCausa();
  el('campo-nueva-causa-nombre').value = '';
  el('campo-nueva-causa-requiere-desc').checked = false;
  el('mensaje-error-causas').hidden = true;
  el('mensaje-ok-causas').hidden = true;
  mostrarPantalla('pantalla-gestion-causas');
}

// ---------------------------------------------------------------------------------------------------
// ARRANQUE.
// ---------------------------------------------------------------------------------------------------

async function iniciar() {
  // El formulario de acceso queda con su listener conectado DESDE YA, antes de esperar el sembrado de
  // catálogos / migración de causas (que solo tardan un poco la primerísima vez que se abre la app en un
  // celular). Si no se hiciera así, alguien que escriba su usuario/contraseña y toque "Ingresar" muy
  // rápido en ese primer instante encontraría el <form> sin su listener todavía — y el navegador haría
  // el envío nativo (GET a la misma página), que se ve como si la pantalla de acceso se hubiera
  // reiniciado sola, borrando lo que se había escrito.
  el('form-login').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const usuario = el('campo-usuario').value.trim();
    const password = el('campo-password').value;
    const ok = await intentarIngresar(usuario, password);
    if (ok) {
      el('mensaje-error-login').hidden = true;
      el('campo-password').value = '';
      await iniciarPantallaPrincipal();
    } else {
      el('mensaje-error-login').hidden = false;
    }
  });

  await sembrarCatalogosSiHaceFalta();
  await migrarCatalogoCausasV2SiHaceFalta();

  if (await haySesionActiva()) {
    await iniciarPantallaPrincipal();
  } else {
    mostrarPantalla('pantalla-login');
  }

  el('boton-cerrar-sesion').addEventListener('click', async () => {
    await cerrarSesion();
    mostrarPantalla('pantalla-login');
  });

  // ---- Panel "Herramientas" (Fase N11 — antes estas acciones estaban sueltas en la pantalla principal) ----
  el('boton-herramientas').addEventListener('click', () => {
    const panel = el('panel-herramientas');
    panel.hidden = !panel.hidden;
  });

  el('boton-ver-catalogos').addEventListener('click', mostrarDiagnosticoCatalogos);
  el('boton-gestionar-causas').addEventListener('click', abrirPantallaGestionCausas);

  // ---- Respaldo / restauración (Fase N8) ----
  el('boton-respaldar-datos').addEventListener('click', async () => {
    const mensajeError = el('mensaje-respaldo');
    const mensajeOk = el('mensaje-respaldo-ok');
    mensajeError.hidden = true;
    mensajeOk.hidden = true;
    try {
      await descargarRespaldoComoArchivo();
      mensajeOk.textContent = 'Respaldo descargado. Ya puedes compartirlo por WhatsApp, correo o guardarlo en Drive.';
      mensajeOk.hidden = false;
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo generar el respaldo.';
      mensajeError.hidden = false;
    }
  });

  el('boton-restaurar-datos').addEventListener('click', () => {
    el('campo-archivo-restaurar').value = ''; // para poder volver a elegir el mismo archivo si hace falta
    el('campo-archivo-restaurar').click();
  });

  el('campo-archivo-restaurar').addEventListener('change', async (evento) => {
    const mensajeError = el('mensaje-respaldo');
    const mensajeOk = el('mensaje-respaldo-ok');
    mensajeError.hidden = true;
    mensajeOk.hidden = true;

    const archivo = evento.target.files[0];
    if (!archivo) return;

    try {
      const objeto = await leerArchivoComoJSON(archivo);
      validarFormatoRespaldo(objeto); // se valida ANTES de preguntar — un archivo inválido nunca llega a la advertencia de "esto borra todo"
      const fechaRespaldo = objeto?.fechaRespaldo ? new Date(objeto.fechaRespaldo).toLocaleString('es-CO') : 'fecha desconocida';
      const confirmado = window.confirm(
        `Esto va a REEMPLAZAR todos los datos actuales (cargues, catálogos, checklist) por los del respaldo del ${fechaRespaldo}. Esta acción no se puede deshacer. ¿Continuar?`,
      );
      if (!confirmado) return;

      await restaurarDesdeArchivo(objeto);
      mensajeOk.textContent = 'Datos restaurados correctamente. Recargando la aplicación...';
      mensajeOk.hidden = false;
      setTimeout(() => location.reload(), 1200);
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo restaurar el respaldo.';
      mensajeError.hidden = false;
    }
  });

  // ---- Google Sheets: ahora se sincroniza SOLO tras cada acción (Fase N11) — aquí solo queda
  // configurar el enlace y, para cuando algo falló, un botón de reintento manual dentro de Herramientas.
  await mostrarEstadoSheets();

  el('boton-configurar-sheets').addEventListener('click', async () => {
    const panel = el('panel-configurar-sheets');
    const abriendo = panel.hidden;
    panel.hidden = !abriendo;
    if (abriendo) {
      el('campo-url-sheets').value = await obtenerUrlSheets();
    }
  });

  el('boton-guardar-url-sheets').addEventListener('click', async () => {
    const mensajeError = el('mensaje-sheets');
    const mensajeOk = el('mensaje-sheets-ok');
    mensajeError.hidden = true;
    mensajeOk.hidden = true;
    try {
      await guardarUrlSheets(el('campo-url-sheets').value);
      el('panel-configurar-sheets').hidden = true;
      mensajeOk.textContent = 'Enlace guardado. Se sincronizará solo con cada acción que guardes.';
      mensajeOk.hidden = false;
      // Limpia cualquier error viejo guardado de CUANDO TODAVÍA NO HABÍA enlace configurado (p.ej.
      // "Todavía no configuras el enlace...") — si no se limpia aquí, ese mensaje viejo se seguiría
      // mostrando como si el enlace recién guardado ya hubiera fallado, aunque nunca se haya intentado.
      await db.config.put({ clave: 'ultimoErrorSheets', valor: null });
      await mostrarEstadoSheets();
      dispararSincronizacionSheets(); // intenta sincronizar de una vez con el enlace recién guardado
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo guardar el enlace.';
      mensajeError.hidden = false;
    }
  });

  el('boton-reintentar-sheets').addEventListener('click', async () => {
    const boton = el('boton-reintentar-sheets');
    const mensajeError = el('mensaje-sheets');
    const mensajeOk = el('mensaje-sheets-ok');
    mensajeError.hidden = true;
    mensajeOk.hidden = true;
    boton.disabled = true;
    const textoOriginal = boton.textContent;
    boton.textContent = 'Sincronizando...';
    try {
      const resultado = await sincronizarConSheets();
      mensajeOk.textContent = `Listo: ${resultado.cantidadCargues} cargues, ${resultado.cantidadParadas} paradas, ${resultado.cantidadChecklist} respuestas de checklist y ${resultado.cantidadDescargues} descargues subidos a Google Sheets.`;
      mensajeOk.hidden = false;
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo sincronizar con Google Sheets.';
      mensajeError.hidden = false;
      if (!(await obtenerUrlSheets())) {
        el('panel-configurar-sheets').hidden = false;
      }
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
      await mostrarEstadoSheets();
    }
  });

  // ---- Selector "+": Cargue o Descargue de canastas (Fase N11) ----
  el('boton-nuevo-cargue').addEventListener('click', () => {
    el('selector-tipo-nuevo').hidden = false;
  });
  el('boton-cancelar-selector').addEventListener('click', () => {
    el('selector-tipo-nuevo').hidden = true;
  });
  el('boton-elegir-cargue').addEventListener('click', async () => {
    el('selector-tipo-nuevo').hidden = true;
    await abrirPantallaNuevoCargue();
  });
  el('boton-elegir-descargue').addEventListener('click', async () => {
    el('selector-tipo-nuevo').hidden = true;
    await abrirPantallaNuevoDescargue();
  });

  el('boton-volver-desde-nuevo').addEventListener('click', iniciarPantallaPrincipal);
  el('boton-volver-desde-detalle').addEventListener('click', () => {
    if (origenDetalleCargue === 'historial') {
      abrirPantallaHistorial();
    } else {
      iniciarPantallaPrincipal();
    }
  });

  el('boton-ver-historial').addEventListener('click', abrirPantallaHistorial);
  el('boton-volver-desde-historial').addEventListener('click', iniciarPantallaPrincipal);

  el('boton-ver-indicadores').addEventListener('click', abrirPantallaIndicadores);
  el('boton-volver-desde-indicadores').addEventListener('click', iniciarPantallaPrincipal);
  el('campo-filtro-periodo').addEventListener('change', () => renderizarIndicadores(el('campo-filtro-periodo').value));
  el('boton-generar-pdf-tablero').addEventListener('click', generarPdfTablero);

  el('campo-cliente').addEventListener('change', (e) => poblarSelectDestinos(e.target.value));
  manejarSeleccionConOpcionNueva('campo-vehiculo', 'bloque-nuevo-vehiculo');
  manejarSeleccionConOpcionNueva('campo-conductor', 'bloque-nuevo-conductor');

  el('boton-guardar-vehiculo').addEventListener('click', async () => {
    const id = await agregarVehiculoRapido(el('campo-nueva-placa').value);
    await poblarSelectVehiculos(id);
    el('bloque-nuevo-vehiculo').hidden = true;
    el('campo-nueva-placa').value = '';
  });
  el('boton-guardar-conductor').addEventListener('click', async () => {
    const id = await agregarConductorRapido(el('campo-nuevo-conductor').value);
    await poblarSelectConductores(id);
    el('bloque-nuevo-conductor').hidden = true;
    el('campo-nuevo-conductor').value = '';
  });

  el('form-nuevo-cargue').addEventListener('submit', manejarEnvioNuevoCargue);

  // ---- Descargue de canastas (Fase N11/N12) ----
  el('boton-volver-desde-descargue').addEventListener('click', iniciarPantallaPrincipal);
  el('boton-volver-tras-descargue').addEventListener('click', iniciarPantallaPrincipal);
  el('boton-otro-descargue').addEventListener('click', abrirPantallaNuevoDescargue);
  el('campo-descargue-cliente').addEventListener('change', (evento) => poblarSelectDestinosDescargue(evento.target.value));
  el('campo-descargue-vehiculo').addEventListener('change', (evento) => {
    el('bloque-descargue-nuevo-vehiculo').hidden = evento.target.value !== '__nuevo__';
  });
  el('campo-descargue-conductor').addEventListener('change', (evento) => {
    el('bloque-descargue-nuevo-conductor').hidden = evento.target.value !== '__nuevo__';
  });
  el('boton-descargue-guardar-vehiculo').addEventListener('click', async () => {
    const id = await agregarVehiculoRapido(el('campo-descargue-nueva-placa').value);
    await poblarSelectVehiculosDescargue(id);
    el('bloque-descargue-nuevo-vehiculo').hidden = true;
    el('campo-descargue-nueva-placa').value = '';
  });
  el('boton-descargue-guardar-conductor').addEventListener('click', async () => {
    const id = await agregarConductorRapido(el('campo-descargue-nuevo-conductor').value);
    await poblarSelectConductoresDescargue(id);
    el('bloque-descargue-nuevo-conductor').hidden = true;
    el('campo-descargue-nuevo-conductor').value = '';
  });
  el('form-nuevo-descargue').addEventListener('submit', manejarEnvioNuevoDescargue);

  // ---- Gestión de causas (Fase N11) ----
  el('boton-volver-desde-causas').addEventListener('click', iniciarPantallaPrincipal);
  el('boton-agregar-causa').addEventListener('click', async () => {
    const mensajeError = el('mensaje-error-causas');
    const mensajeOk = el('mensaje-ok-causas');
    mensajeError.hidden = true;
    mensajeOk.hidden = true;
    try {
      await agregarCausa({
        nombre: el('campo-nueva-causa-nombre').value,
        categoriaId: el('campo-nueva-causa-categoria').value,
        responsableId: el('campo-nueva-causa-responsable').value,
        tipoTiempoId: el('campo-nueva-causa-tipo').value,
        requiereDescripcion: el('campo-nueva-causa-requiere-desc').checked,
      });
      el('campo-nueva-causa-nombre').value = '';
      el('campo-nueva-causa-requiere-desc').checked = false;
      mensajeOk.textContent = 'Causa agregada.';
      mensajeOk.hidden = false;
      await renderizarListaCausas();
    } catch (error) {
      mensajeError.textContent = error.message || 'No se pudo agregar la causa.';
      mensajeError.hidden = false;
    }
  });
}

iniciar();
