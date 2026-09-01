/*
  FASE N3 — CHECKLIST SIMPLIFICADO.

  8 ítems de checklist por cargue, respondidos CUMPLE / NO_CUMPLE / NO_APLICA. Si un ítem se marca
  NO_CUMPLE y el ítem exige observación (requiereObservacionSnapshot), la observación es obligatoria
  para poder finalizar. El resultado se calcula automáticamente al finalizar:
    - Si algún ítem NO_CUMPLE es "crítico" (criticoSnapshot) → checklistResultado = 'RECHAZADO',
      cargue.estado = 'RECHAZADO' (estado terminal: el cargue sale de la lista de activos).
    - Si algún ítem NO_CUMPLE no es crítico → checklistResultado = 'APROBADO_CON_OBSERVACION',
      cargue.estado = 'APROBADO'.
    - Si no hay ningún NO_CUMPLE → checklistResultado = 'APROBADO', cargue.estado = 'APROBADO'.

  Cada respuesta guarda una "foto" (snapshot) del ítem de catálogo en el momento de crearse (texto,
  orden, crítico, si exige observación) — igual que el resto del proyecto: si el catálogo cambia
  después, los cargues ya hechos no se alteran.
*/

// Crea las respuestas de checklist (una por ítem activo del catálogo) la primera vez que se abre el
// checklist de un cargue, y avanza el estado PENDIENTE -> CHECKLIST. Es idempotente: si ya existen
// respuestas para este cargue, no crea nada de nuevo — así se puede llamar cada vez que se entra al
// detalle del cargue sin riesgo de duplicar filas.
async function asegurarChecklistCreado(cargueId) {
  const existentes = await db.checklistRespuestas.where('cargueId').equals(cargueId).count();
  if (existentes > 0) return;

  // 'activo' no está indexado (ver db.js) — se filtra en memoria, no con .where().
  const todos = await db.checklistItems.orderBy('orden').toArray();
  const items = todos.filter((i) => i.activo);

  await db.transaction('rw', [db.checklistRespuestas, db.cargues], async () => {
    for (const item of items) {
      await db.checklistRespuestas.add({
        cargueId,
        itemId: item.id,
        textoSnapshot: item.texto,
        ordenSnapshot: item.orden,
        criticoSnapshot: !!item.critico,
        requiereObservacionSnapshot: !!item.requiereObservacion,
        respuesta: null, // 'CUMPLE' | 'NO_CUMPLE' | 'NO_APLICA' | null (todavía sin responder)
        observacion: '',
      });
    }

    const cargue = await db.cargues.get(cargueId);
    if (esTransicionValida(cargue.estado, 'CHECKLIST')) {
      await db.cargues.update(cargueId, { estado: 'CHECKLIST', actualizadoEn: new Date().toISOString() });
    }
  });
}

async function obtenerChecklistDeCargue(cargueId) {
  return db.checklistRespuestas.where('cargueId').equals(cargueId).sortBy('ordenSnapshot');
}

async function responderItemChecklist(respuestaId, respuesta, observacion) {
  if (!['CUMPLE', 'NO_CUMPLE', 'NO_APLICA'].includes(respuesta)) {
    throw new Error('Respuesta inválida.');
  }
  await db.checklistRespuestas.update(respuestaId, {
    respuesta,
    observacion: (observacion || '').trim(),
  });
}

// Valida que todos los ítems estén respondidos (y que haya observación donde se exige), calcula el
// resultado y actualiza el cargue. Lanza un Error con un mensaje claro si falta algo — la pantalla lo
// muestra tal cual.
async function finalizarChecklist(cargueId) {
  const respuestas = await obtenerChecklistDeCargue(cargueId);

  const sinResponder = respuestas.find((r) => !r.respuesta);
  if (sinResponder) {
    throw new Error(`Falta responder: "${sinResponder.textoSnapshot}".`);
  }

  const faltaObservacion = respuestas.find(
    (r) => r.respuesta === 'NO_CUMPLE' && r.requiereObservacionSnapshot && !r.observacion,
  );
  if (faltaObservacion) {
    throw new Error(`"${faltaObservacion.textoSnapshot}" está marcado como No cumple: escribe una observación.`);
  }

  const noCumpleCritico = respuestas.some((r) => r.respuesta === 'NO_CUMPLE' && r.criticoSnapshot);
  const noCumpleNoCritico = respuestas.some((r) => r.respuesta === 'NO_CUMPLE' && !r.criticoSnapshot);

  let checklistResultado;
  let nuevoEstado;
  if (noCumpleCritico) {
    checklistResultado = 'RECHAZADO';
    nuevoEstado = 'RECHAZADO';
  } else if (noCumpleNoCritico) {
    checklistResultado = 'APROBADO_CON_OBSERVACION';
    nuevoEstado = 'APROBADO';
  } else {
    checklistResultado = 'APROBADO';
    nuevoEstado = 'APROBADO';
  }

  const cargue = await db.cargues.get(cargueId);
  if (!esTransicionValida(cargue.estado, nuevoEstado)) {
    throw new Error(`No se puede pasar de "${ETIQUETA_ESTADO[cargue.estado]}" a "${ETIQUETA_ESTADO[nuevoEstado]}".`);
  }

  const ahora = new Date().toISOString();
  await db.cargues.update(cargueId, {
    estado: nuevoEstado,
    checklistResultado,
    checklistFinalizadoEn: ahora,
    actualizadoEn: ahora,
  });

  return { checklistResultado, nuevoEstado };
}
