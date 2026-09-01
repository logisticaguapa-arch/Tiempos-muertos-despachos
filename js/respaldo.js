/*
  FASE N8 — RESPALDO Y RESTAURACIÓN.

  Como toda la información vive solo en el celular del supervisor (ver PROPUESTA_ARQUITECTURA_PILOTO_SIMPLE.md,
  secciones 13 y 14 — la contraparte honesta de no tener servidor), esta es la única red de seguridad real:
  un botón que exporta TODO lo que hay en la base de datos local a un único archivo .json con fecha, que el
  supervisor puede enviarse a sí mismo por WhatsApp, correo o guardarlo en Drive. Restaurar REEMPLAZA todos
  los datos actuales por los del archivo — no los combina — así que la pantalla pide confirmación explícita
  antes de hacerlo (ver app.js).
*/

const NOMBRES_TABLAS_RESPALDO = [
  'clientes',
  'destinos',
  'vehiculos',
  'conductores',
  'categoriasParada',
  'responsables',
  'tiposTiempo',
  'causasParada',
  'checklistItems',
  'cargues',
  'paradas',
  'checklistRespuestas',
  'descargues', // FASE N15 — corrección: esta tabla existe desde la Fase N11 pero nunca se agregó aquí,
  // así que ningún respaldo generado hasta ahora incluía los descargues de canastas. Se corrige acá.
  'config',
];

function nombreArchivoRespaldo() {
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fecha = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const hora = `${pad(ahora.getHours())}${pad(ahora.getMinutes())}`;
  return `respaldo-piloto-guapa-${fecha}-${hora}.json`;
}

async function generarRespaldoCompleto() {
  const datos = {};
  for (const nombre of NOMBRES_TABLAS_RESPALDO) {
    datos[nombre] = await db[nombre].toArray();
  }
  return {
    app: 'piloto-guapa',
    versionRespaldo: 1,
    fechaRespaldo: new Date().toISOString(),
    datos,
  };
}

// Dispara la descarga del respaldo como archivo .json — sin backend, es solo un Blob local convertido en
// un enlace de descarga que se hace clic solo. El navegador lo guarda en la carpeta de descargas del
// celular, desde donde el supervisor puede compartirlo (WhatsApp, correo, Drive, etc.).
async function descargarRespaldoComoArchivo() {
  const respaldo = await generarRespaldoCompleto();
  const contenido = JSON.stringify(respaldo, null, 2);
  const blob = new Blob([contenido], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivoRespaldo();
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function leerArchivoComoJSON(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      try {
        resolve(JSON.parse(lector.result));
      } catch (error) {
        reject(new Error('El archivo seleccionado no es un respaldo JSON válido.'));
      }
    };
    lector.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    lector.readAsText(archivo);
  });
}

// Se valida el formato ANTES de preguntar "¿estás seguro?" — así el supervisor nunca ve la advertencia
// de "esto borra todo" por un archivo que ni siquiera es un respaldo válido (se descarta antes).
function validarFormatoRespaldo(objeto) {
  if (!objeto || typeof objeto !== 'object' || !objeto.datos || objeto.app !== 'piloto-guapa') {
    throw new Error('El archivo no tiene el formato de un respaldo de esta aplicación.');
  }
}

// Reemplazo TOTAL: vacía cada tabla y la vuelve a llenar con lo que traiga el respaldo. Los ids se
// conservan tal cual venían en el archivo (Dexie los respeta si el objeto ya trae la clave primaria),
// así que las relaciones entre tablas (por ejemplo destinos.clienteId -> clientes.id) siguen siendo
// válidas después de restaurar.
async function restaurarDesdeArchivo(objeto) {
  validarFormatoRespaldo(objeto);

  const tablas = NOMBRES_TABLAS_RESPALDO.map((nombre) => db[nombre]);
  await db.transaction('rw', tablas, async () => {
    for (const nombre of NOMBRES_TABLAS_RESPALDO) {
      const filas = objeto.datos[nombre];
      // FASE N15 — si el respaldo es de ANTES de que existiera esta tabla (p.ej. uno viejo, de antes de
      // agregar "descargues" en la Fase N11, o de antes de esta misma corrección), la llave ni siquiera
      // existe en el archivo. En ese caso no se toca la tabla — antes esto la vaciaba igual y la dejaba
      // vacía para siempre, borrando datos que el respaldo nunca tuvo la intención de tocar.
      if (!Array.isArray(filas)) continue;
      await db[nombre].clear();
      if (filas.length) {
        await db[nombre].bulkAdd(filas);
      }
    }
  });
}

// ---- FASE N15 — Borrar datos operativos de prueba (antes de arrancar producción) ----------------------
//
// Deliberadamente NO toca los catálogos (clientes, destinos, vehículos, conductores, causas, etc.) ni
// `config` (que guarda el enlace de Google Sheets y la sesión) — esos se conservan. Solo borra el
// HISTORIAL operativo: cargues, paradas, checklist respondido y descargues de canastas. No borra nada de
// lo que ya se subió a Google Sheets (eso se limpia aparte, directamente en la hoja).
const NOMBRES_TABLAS_DATOS_OPERATIVOS = ['cargues', 'paradas', 'checklistRespuestas', 'descargues'];

async function contarDatosOperativos() {
  const cantidades = await Promise.all(NOMBRES_TABLAS_DATOS_OPERATIVOS.map((nombre) => db[nombre].count()));
  return cantidades.reduce((total, n) => total + n, 0);
}

async function borrarDatosOperativos() {
  const tablas = NOMBRES_TABLAS_DATOS_OPERATIVOS.map((nombre) => db[nombre]);
  await db.transaction('rw', tablas, async () => {
    for (const nombre of NOMBRES_TABLAS_DATOS_OPERATIVOS) {
      await db[nombre].clear();
    }
  });
}
