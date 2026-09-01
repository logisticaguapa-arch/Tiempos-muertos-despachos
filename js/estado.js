/*
  FASE N2 — Máquina de estados del cargue.

  Se conserva tal cual la del proyecto anterior (backend/src/catalogos/cargues/estado-cargue.ts) — el
  diseño del flujo de negocio no cambió, solo dónde se ejecuta (ver PROPUESTA_ARQUITECTURA_PILOTO_SIMPLE.md,
  sección 9). Esta fase (N2) solo alcanza PENDIENTE; CHECKLIST llega en la Fase N3, EN_CARGUE/EN_PARADA en
  la N4, FINALIZADO/CERRADO en la N5 — igual que en el proyecto anterior, cada fase avanza un tramo.
*/

const ESTADOS_CARGUE = [
  'PENDIENTE',
  'CHECKLIST',
  'APROBADO',
  'RECHAZADO',
  'EN_CARGUE',
  'EN_PARADA',
  'FINALIZADO',
  'CERRADO',
];

const ESTADOS_TERMINALES = ['FINALIZADO', 'CERRADO', 'RECHAZADO'];

function esCargueActivo(estado) {
  return !ESTADOS_TERMINALES.includes(estado);
}

const TRANSICIONES_PERMITIDAS = {
  PENDIENTE: ['CHECKLIST'],
  CHECKLIST: ['APROBADO', 'RECHAZADO'],
  APROBADO: ['EN_CARGUE'],
  RECHAZADO: ['CERRADO'],
  EN_CARGUE: ['EN_PARADA', 'FINALIZADO'],
  EN_PARADA: ['EN_CARGUE'],
  FINALIZADO: ['CERRADO'],
  CERRADO: [],
};

function esTransicionValida(actual, siguiente) {
  return (TRANSICIONES_PERMITIDAS[actual] || []).includes(siguiente);
}

// Etiquetas en español para mostrar en pantalla — el valor guardado en la base sigue siendo el de
// ESTADOS_CARGUE (para no romper nada si se compara/filtra por código en fases futuras).
const ETIQUETA_ESTADO = {
  PENDIENTE: 'Pendiente',
  CHECKLIST: 'En checklist',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
  EN_CARGUE: 'En cargue',
  EN_PARADA: 'En parada',
  FINALIZADO: 'Finalizado',
  CERRADO: 'Cerrado',
};
