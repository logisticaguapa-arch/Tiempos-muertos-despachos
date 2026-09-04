/*
  FASE N1 — FUNDACIONES. Base de datos local (IndexedDB vía Dexie).

  Esta es la ÚNICA base de datos de la aplicación — no hay backend, no hay servidor, no hay ninguna
  llamada de red en el flujo operativo (ver PROPUESTA_ARQUITECTURA_PILOTO_SIMPLE.md, sección 3 y 12).
  Todo lo que la app necesita vive en el celular donde se abre.

  Los catálogos (clientes, destinos, categorías, responsables, tipos de tiempo, causas de parada,
  ítems de checklist) se siembran UNA SOLA VEZ, con los mismos valores reales ya confirmados en
  `backend/prisma/seed.ts` del proyecto anterior (verificados contra CHECK LIST DESPACHOS.xlsx y
  SEGUIMIENTOS TIEMPOS MUERTOS DESPACHOS.xlsx) — no se inventó ni se cambió ningún nombre aquí. Vehículos
  y conductores NO se siembran (tampoco se sembraban en el proyecto anterior): se agregan desde la app,
  en el flujo de creación de cargue (Fase N2). No existe catálogo de "auxiliares" — con un solo supervisor
  no hace falta identificar un auxiliar aparte del conductor (decisión explícita del usuario).
*/

const db = new Dexie('piloto_guapa');

// v1 — esquema completo previsto por la propuesta (sección 8). Los índices (los campos listados aquí)
// son solo los que hace falta poder buscar rápido; el resto de columnas de cada objeto no necesitan
// declararse, Dexie las guarda igual.
db.version(1).stores({
  // Catálogos de referencia — editables desde "Configuración/Catálogos" (Fase N2 en adelante).
  clientes: '++id, nombre',
  destinos: '++id, clienteId, ciudad',
  vehiculos: '++id, placa',
  conductores: '++id, nombreCompleto',
  // Sin catálogo de "auxiliares" — con un solo supervisor no hace falta identificar un auxiliar aparte
  // del conductor (decisión explícita, ver PROPUESTA_ARQUITECTURA_PILOTO_SIMPLE.md).
  categoriasParada: '++id, nombre',
  responsables: '++id, nombre',
  tiposTiempo: '++id, nombre',
  causasParada: '++id, categoriaId, nombre',
  checklistItems: '++id, orden',

  // Datos operativos reales del piloto.
  cargues: '++id, estado, fecha',
  paradas: '++id, cargueId, horaFin', // horaFin indexado para poder listar rápido "paradas abiertas".
  checklistRespuestas: '++id, cargueId',

  // Config de la app (clave/valor): estado de sesión, fecha del último respaldo, versión de datos, etc.
  config: 'clave',
});

// v2 (Fase N11 — ajustes reales del piloto) — se agrega la tabla de "descargues de canastas", un
// registro operativo nuevo y separado de los cargues. Dexie no exige repetir las tablas de v1 que no
// cambiaron: siguen existiendo tal cual. Los campos nuevos de `cargues` (canastillasEncajables,
// canastillasGrandes, canastillasPequenas) tampoco necesitan declararse aquí — igual que el resto de
// columnas de cada tabla, Dexie las guarda sin que hagan parte del índice.
db.version(2).stores({
  descargues: '++id, fecha',
});

// ---------------------------------------------------------------------------------------------------
// FASE N19 — "idGlobal": identificador ÚNICO ENTRE TODOS LOS DISPOSITIVOS para cargues, paradas,
// respuestas de checklist y descargues.
//
// Por qué hace falta: el "id" de arriba (++id) lo genera Dexie EN CADA CELULAR, empezando en 1 —
// así que el primer cargue que registre el celular A y el primer cargue que registre el celular B
// tienen AMBOS id=1, cada uno en su propia base de datos local. Eso nunca fue un problema mientras
// Google Sheets solo recibía datos (Fase N10/N11): pero para FASE N18/N19 (leer lo que subieron los
// demás dispositivos y mezclarlo en pantalla) ese "id" repetido es un problema serio — Code.gs hace
// upsert por "id" en la hoja, así que sin esto, el cargue #1 del celular B pisaría silenciosamente
// la fila del cargue #1 del celular A la próxima vez que B sincronice.
//
// La solución: además del "id" local (++id, el que usa Dexie internamente y el que usan las relaciones
// dentro de ESTE MISMO celular, como paradas.cargueId), cada registro que se sube a Sheets guarda un
// "idGlobal" propio, generado con hora + un número al azar — con esa combinación, dos celulares
// generando un idGlobal en el mismo milisegundo tendrían que además coincidir en la parte al azar para
// chocar (prácticamente imposible). Es lo mismo que se subirá como "id" a Google Sheets (ver
// sync-sheets.js) de ahora en adelante, en vez del "id" local.
function generarIdGlobal() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// Le pone "idGlobal" a los registros que ya existían ANTES de este cambio (cargues/paradas/respuestas de
// checklist/descargues creados con versiones anteriores de la app, que todavía no tienen ese campo).
// Corre una sola vez por celular de forma efectiva: solo toca los registros que de verdad les falta el
// campo, así que en cualquier arranque posterior no encuentra nada que migrar y no hace ninguna escritura.
async function migrarIdsGlobalesSiHaceFalta() {
  const tablas = [db.cargues, db.paradas, db.checklistRespuestas, db.descargues];
  for (const tabla of tablas) {
    await tabla
      .filter((registro) => !registro.idGlobal)
      .modify((registro) => {
        registro.idGlobal = generarIdGlobal();
      });
  }
}

// ---------------------------------------------------------------------------------------------------
// CATÁLOGOS SEMILLA — mismos valores reales del proyecto anterior, sin inventar ni corregir nada.
// ---------------------------------------------------------------------------------------------------

// Las 11 combinaciones cliente + ciudad confirmadas en CHECK LIST DESPACHOS.xlsx (idénticas a
// backend/prisma/seed.ts, DESTINOS_CONFIRMADOS).
const DESTINOS_CONFIRMADOS = [
  { cliente: 'EXITO', ciudad: 'BARRANQUILLA', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'EXITO', ciudad: 'MEDELLIN', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'ARA', ciudad: 'MEDELLIN', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'ARA', ciudad: 'BOGOTA', reglaCarpaDelantera: 'DESTAPADA' },
  { cliente: 'ARA', ciudad: 'CERETE', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'PDV', ciudad: 'APARTADO', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'PDV', ciudad: 'MEDELLIN', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'PDV', ciudad: 'BOGOTA', reglaCarpaDelantera: 'DESTAPADA' },
  { cliente: 'PDV', ciudad: 'CARTAGENA', reglaCarpaDelantera: 'DESTAPADA' },
  { cliente: 'PDV', ciudad: 'MONTERIA', reglaCarpaDelantera: 'TAPADA' },
  { cliente: 'PDV', ciudad: 'SINCELEJO', reglaCarpaDelantera: 'TAPADA' },
];

const CATEGORIAS_PARADA = [
  'Fruta',
  'Canastas y empaque',
  'Equipos de planta',
  'Documentación y autorizaciones',
  'Vehículos y personal',
  'Operación y calidad',
  'Otros',
];

const RESPONSABLES = [
  'Producción / Cosecha',
  'Despachos',
  'Mantenimiento / Taller',
  'Operaciones / Taller',
  'Sistemas / BI',
  'Comercial / Administración',
  'Gerencia / Administración',
  'Transporte',
  'Transporte / Mantenimiento',
  'Despachos / Postcosecha',
  'Postcosecha / Calidad',
  'Sin asignar',
];

const TIPOS_TIEMPO = ['TIEMPO_MUERTO', 'ESPERA', 'REPROCESO', 'ACTIVIDAD_OPERATIVA'];

// Las 21 causas reconciliadas (idénticas a backend/prisma/seed.ts, CAUSAS).
const CAUSAS = [
  { categoria: 'Fruta', nombre: 'Falta de fruta disponible', responsable: 'Producción / Cosecha', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Fruta', nombre: 'Búsqueda / localización de fruta', responsable: 'Producción / Cosecha', tipoTiempo: 'ESPERA' },
  { categoria: 'Canastas y empaque', nombre: 'Falta de canastas disponibles', responsable: 'Despachos', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Canastas y empaque', nombre: 'Descargue de canastas', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Canastas y empaque', nombre: 'Reempaque de bines', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Canastas y empaque', nombre: 'Reempaque de canastas IFCO', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Canastas y empaque', nombre: 'Reempaque a canastas propias del cliente', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Canastas y empaque', nombre: 'Limpieza y lavado de canastas C-IFCO', responsable: 'Despachos / Postcosecha', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Equipos de planta', nombre: 'Falla o reparación de báscula', responsable: 'Mantenimiento / Taller', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Equipos de planta', nombre: 'Espera de disponibilidad de montacarga', responsable: 'Operaciones / Taller', tipoTiempo: 'ESPERA' },
  { categoria: 'Equipos de planta', nombre: 'Falla de montacarga', responsable: 'Mantenimiento / Taller', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Equipos de planta', nombre: 'Falla de sistema o aplicativo', responsable: 'Sistemas / BI', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Documentación y autorizaciones', nombre: 'Falta / espera de orden de compra (OC)', responsable: 'Comercial / Administración', tipoTiempo: 'ESPERA' },
  { categoria: 'Documentación y autorizaciones', nombre: 'Falta o error en documentación', responsable: 'Comercial / Administración', tipoTiempo: 'ESPERA' },
  { categoria: 'Documentación y autorizaciones', nombre: 'Espera de autorización', responsable: 'Gerencia / Administración', tipoTiempo: 'ESPERA' },
  { categoria: 'Vehículos y personal', nombre: 'Falta / espera de vehículo', responsable: 'Transporte', tipoTiempo: 'ESPERA' },
  { categoria: 'Vehículos y personal', nombre: 'Falla o daño del vehículo', responsable: 'Transporte / Mantenimiento', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Vehículos y personal', nombre: 'Espera de personal', responsable: 'Despachos', tipoTiempo: 'ESPERA' },
  { categoria: 'Operación y calidad', nombre: 'Limpieza / adecuación general del vehículo o zona', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Operación y calidad', nombre: 'Reproceso de producto o carga', responsable: 'Postcosecha / Calidad', tipoTiempo: 'REPROCESO' },
  { categoria: 'Otros', nombre: 'Otra (descripción obligatoria)', responsable: 'Sin asignar', tipoTiempo: 'TIEMPO_MUERTO', requiereDescripcion: true },
];

// Los 8 ítems confirmados en CHECK LIST DESPACHOS.xlsx (texto exacto, sin corregir ortografía).
const CHECKLIST_ITEMS = [
  'Superficie interna del vehiculo',
  'Desinfeccion interna',
  'El furgón/carrocería está limpio, seco',
  'No presenta residuos de cargas anteriores',
  'Ausencia de olores fuertes, moho, plagas o suciedad',
  'Paredes, techos y piso en buen estado (sin grietas)',
  'Vehiculo cuenta con rache para sugecion de carga',
  'La carga no toca el techo y permite la circulación de aire (aprox. 10 cm libres)',
];

// ---------------------------------------------------------------------------------------------------
// CATÁLOGO DE CAUSAS — FASE N11: reemplazo por la lista real que confirmó el supervisor de cosecha.
// ---------------------------------------------------------------------------------------------------
//
// Las 16 causas reales entregadas por el usuario, reconciliadas con las categorías/responsables/tipos
// de tiempo ya existentes (se agrega una categoría nueva, "Personal", para Alimentación y Capacitación,
// que no encajaban en ninguna de las 7 anteriores). La categorización (responsable/tipo de tiempo) es
// una propuesta razonable de esta migración — se puede corregir en cualquier momento desde "Gestionar
// causas" sin tocar código.
const CAUSAS_V2 = [
  { categoria: 'Canastas y empaque', nombre: 'Limpieza de canastas IFCO', responsable: 'Despachos / Postcosecha', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Canastas y empaque', nombre: 'Reempaque de bines', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Canastas y empaque', nombre: 'Reempaque de canastas IFCO', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Equipos de planta', nombre: 'Falta montacarga', responsable: 'Operaciones / Taller', tipoTiempo: 'ESPERA' },
  { categoria: 'Canastas y empaque', nombre: 'Descargue de canastas', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Equipos de planta', nombre: 'Reparación de báscula', responsable: 'Mantenimiento / Taller', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Fruta', nombre: 'Búsqueda de fruta', responsable: 'Producción / Cosecha', tipoTiempo: 'ESPERA' },
  { categoria: 'Operación y calidad', nombre: 'Intervención de calidad', responsable: 'Postcosecha / Calidad', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Operación y calidad', nombre: 'Descarte de fruta manual', responsable: 'Postcosecha / Calidad', tipoTiempo: 'REPROCESO' },
  { categoria: 'Vehículos y personal', nombre: 'Espera de vehículos', responsable: 'Transporte', tipoTiempo: 'ESPERA' },
  { categoria: 'Canastas y empaque', nombre: 'Reempaque canastas cliente', responsable: 'Despachos', tipoTiempo: 'ACTIVIDAD_OPERATIVA' },
  { categoria: 'Documentación y autorizaciones', nombre: 'Espera de OC', responsable: 'Comercial / Administración', tipoTiempo: 'ESPERA' },
  { categoria: 'Personal', nombre: 'Alimentación', responsable: 'Despachos', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Equipos de planta', nombre: 'Falta de energía', responsable: 'Mantenimiento / Taller', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Equipos de planta', nombre: 'Montacarga varado', responsable: 'Mantenimiento / Taller', tipoTiempo: 'TIEMPO_MUERTO' },
  { categoria: 'Personal', nombre: 'Capacitación', responsable: 'Despachos', tipoTiempo: 'TIEMPO_MUERTO' },
];

// Corre UNA sola vez por celular (marcada con config.causasReemplazadasV2): desactiva TODAS las causas
// que hubiera antes (no las borra — las paradas ya registradas guardan su propia "foto" del nombre, así
// que desactivar es seguro y no rompe el historial) y siembra las 16 nuevas como el catálogo activo.
// Se corre tanto en instalaciones nuevas como en las que ya tenían el catálogo viejo de 21 causas.
async function migrarCatalogoCausasV2SiHaceFalta() {
  const yaMigrado = await db.config.get('causasReemplazadasV2');
  if (yaMigrado?.valor) return;

  await db.transaction(
    'rw',
    [db.categoriasParada, db.responsables, db.tiposTiempo, db.causasParada, db.config],
    async () => {
      const actuales = await db.causasParada.toArray();
      for (const c of actuales) {
        if (c.activo) await db.causasParada.update(c.id, { activo: false });
      }

      async function idPorNombreOCrear(tabla, nombre) {
        const existente = await tabla.where('nombre').equals(nombre).first();
        if (existente) return existente.id;
        return tabla.add({ nombre });
      }

      for (const c of CAUSAS_V2) {
        const categoriaId = await idPorNombreOCrear(db.categoriasParada, c.categoria);
        const responsableId = await idPorNombreOCrear(db.responsables, c.responsable);
        const tipoTiempoId = await idPorNombreOCrear(db.tiposTiempo, c.tipoTiempo);
        await db.causasParada.add({
          categoriaId,
          nombre: c.nombre,
          responsableId,
          tipoTiempoId,
          requiereDescripcion: false,
          activo: true,
        });
      }

      await db.config.put({ clave: 'causasReemplazadasV2', valor: true });
    },
  );
}

// Idempotente: solo siembra si la tabla de clientes está vacía (primera vez que se abre la app en ese
// celular). Nunca sobrescribe datos ya existentes — así es seguro llamarla en cada arranque.
async function sembrarCatalogosSiHaceFalta() {
  const yaHaySemillas = (await db.clientes.count()) > 0;
  if (yaHaySemillas) return;

  await db.transaction(
    'rw',
    [db.clientes, db.destinos, db.categoriasParada, db.responsables, db.tiposTiempo, db.causasParada, db.checklistItems],
    async () => {
      const idPorNombreCliente = {};
      for (const nombre of [...new Set(DESTINOS_CONFIRMADOS.map((d) => d.cliente))]) {
        idPorNombreCliente[nombre] = await db.clientes.add({ nombre, estado: 'ACTIVO' });
      }
      for (const d of DESTINOS_CONFIRMADOS) {
        await db.destinos.add({
          clienteId: idPorNombreCliente[d.cliente],
          ciudad: d.ciudad,
          reglaCarpaDelantera: d.reglaCarpaDelantera,
          estado: 'ACTIVO',
        });
      }

      const idPorCategoria = {};
      for (const nombre of CATEGORIAS_PARADA) {
        idPorCategoria[nombre] = await db.categoriasParada.add({ nombre });
      }
      const idPorResponsable = {};
      for (const nombre of RESPONSABLES) {
        idPorResponsable[nombre] = await db.responsables.add({ nombre });
      }
      const idPorTipoTiempo = {};
      for (const nombre of TIPOS_TIEMPO) {
        idPorTipoTiempo[nombre] = await db.tiposTiempo.add({ nombre });
      }
      for (const c of CAUSAS) {
        await db.causasParada.add({
          categoriaId: idPorCategoria[c.categoria],
          nombre: c.nombre,
          responsableId: idPorResponsable[c.responsable],
          tipoTiempoId: idPorTipoTiempo[c.tipoTiempo],
          requiereDescripcion: !!c.requiereDescripcion,
          activo: true,
        });
      }
      for (let i = 0; i < CHECKLIST_ITEMS.length; i++) {
        await db.checklistItems.add({
          orden: i + 1,
          texto: CHECKLIST_ITEMS[i],
          critico: false, // Igual que en el proyecto anterior: pendiente de confirmar cuáles son críticos.
          requiereObservacion: true,
          activo: true,
        });
      }
    },
  );
}
