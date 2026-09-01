/*
  FASE N11 — GESTIÓN DE CAUSAS DE TIEMPOS MUERTOS.

  El catálogo de causas (ver CAUSAS_V2 y migrarCatalogoCausasV2SiHaceFalta() en db.js) ya no es fijo:
  desde "Gestionar causas" el supervisor puede corregir la categoría/responsable/tipo de una causa
  existente, desactivarla (sin borrarla — las paradas ya registradas guardan su propia "foto" del
  nombre, ver snapshot en tiempos.js) o agregar una causa nueva, todo sin tocar código.
*/

async function listarCategoriasParadaTodas() {
  return db.categoriasParada.orderBy('nombre').toArray();
}

async function listarResponsablesTodos() {
  return db.responsables.orderBy('nombre').toArray();
}

async function listarTiposTiempoTodos() {
  return db.tiposTiempo.toArray();
}

// A diferencia de listarCausasParadaConDetalle() (tiempos.js), que solo trae las ACTIVAS para los
// formularios de registrar/editar parada, esta trae TODAS (activas e inactivas) para la pantalla de
// gestión, donde precisamente se necesita ver y poder reactivar las desactivadas.
async function listarTodasLasCausasConDetalle() {
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
    .map((c) => ({
      ...c,
      categoriaNombre: categoriaPorId[c.categoriaId]?.nombre ?? '(sin categoría)',
      responsableNombre: responsablePorId[c.responsableId]?.nombre ?? '(sin responsable)',
      tipoTiempoNombre: tipoTiempoPorId[c.tipoTiempoId]?.nombre ?? '(sin tipo)',
    }))
    .sort((a, b) => a.categoriaNombre.localeCompare(b.categoriaNombre) || a.nombre.localeCompare(b.nombre));
}

function _validarDatosCausa({ nombre, categoriaId, responsableId, tipoTiempoId }) {
  if (!(nombre || '').trim()) throw new Error('El nombre de la causa no puede estar vacío.');
  if (!categoriaId) throw new Error('Selecciona una categoría.');
  if (!responsableId) throw new Error('Selecciona un responsable.');
  if (!tipoTiempoId) throw new Error('Selecciona un tipo de tiempo.');
}

async function agregarCausa({ nombre, categoriaId, responsableId, tipoTiempoId, requiereDescripcion }) {
  _validarDatosCausa({ nombre, categoriaId, responsableId, tipoTiempoId });
  return db.causasParada.add({
    nombre: nombre.trim(),
    categoriaId: Number(categoriaId),
    responsableId: Number(responsableId),
    tipoTiempoId: Number(tipoTiempoId),
    requiereDescripcion: !!requiereDescripcion,
    activo: true,
  });
}

async function editarCausa(causaId, { nombre, categoriaId, responsableId, tipoTiempoId, requiereDescripcion, activo }) {
  _validarDatosCausa({ nombre, categoriaId, responsableId, tipoTiempoId });
  await db.causasParada.update(causaId, {
    nombre: nombre.trim(),
    categoriaId: Number(categoriaId),
    responsableId: Number(responsableId),
    tipoTiempoId: Number(tipoTiempoId),
    requiereDescripcion: !!requiereDescripcion,
    activo: !!activo,
  });
}
