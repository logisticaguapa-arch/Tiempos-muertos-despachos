/*
  FASE N1 — Acceso simple, un solo usuario.

  Esto NO es un sistema de autenticación con roles ni JWT (esa complejidad se eliminó a propósito, ver
  PROPUESTA_ARQUITECTURA_PILOTO_SIMPLE.md, sección 7 y 11) — es solo una contraseña de acceso local para
  que no cualquiera que tome el celular pueda abrir la app. El usuario ("auxiliar1") no representa una
  persona con nombre asignado, es simplemente el identificador de la única cuenta que existe.

  La contraseña no se guarda en texto plano en el código: se compara el hash SHA-256 de lo que se digita
  contra un hash fijo, calculado una sola vez para "GuapaSYOP2026". Esto no pretende ser seguridad de
  nivel empresarial (cualquiera con el código fuente puede ver el hash y, con tiempo, revertirlo) — es
  exactamente el nivel de protección que se pidió: "sencilla, no un sistema complejo".
*/

const USUARIO_UNICO = 'auxiliar1';
const HASH_PASSWORD_ESPERADO =
  '4bf818fb49270e2ed539f563ba1ef948eefc689c9930c85b29c2ca83a7b890d2'; // SHA-256 de "GuapaSYOP2026"

async function sha256Hex(texto) {
  const datos = new TextEncoder().encode(texto);
  const hashBuffer = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function intentarIngresar(usuario, password) {
  const hashIngresado = await sha256Hex(password || '');
  const credencialesValidas = usuario === USUARIO_UNICO && hashIngresado === HASH_PASSWORD_ESPERADO;
  if (!credencialesValidas) return false;

  await db.config.put({ clave: 'sesionActiva', valor: true });
  return true;
}

async function haySesionActiva() {
  const registro = await db.config.get('sesionActiva');
  return !!(registro && registro.valor);
}

async function cerrarSesion() {
  await db.config.put({ clave: 'sesionActiva', valor: false });
}
