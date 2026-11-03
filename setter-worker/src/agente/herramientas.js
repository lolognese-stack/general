// Herramientas del agente. Cada una deja su efecto en D1 y devuelve un texto
// corto para Claude. Nada de lo que hacen sale al lead salvo los recursos,
// que se encolan y se mandan después del mensaje del turno.

import { CAMPOS_LEAD, IA_ESTADOS } from './contexto.js';

const ENTEROS = new Set(['personas', 'dias']);
const FECHAS = new Set(['llegada', 'salida']);

export function definiciones(agente, especialistas, { puedeTraspasar = true } = {}) {
  const props = Object.fromEntries(Object.entries(CAMPOS_LEAD).map(([k, d]) => [k, { type: ENTEROS.has(k) ? 'integer' : 'string', description: d }]));
  const tools = [
    {
      name: 'completar_lead',
      description: 'Guarda en la ficha del lead lo que la persona dijo. Manda solo los campos que averiguaste en este mensaje. Los campos que ya tienen valor no se pisan.',
      input_schema: { type: 'object', properties: props, additionalProperties: false },
    },
    {
      name: 'cambiar_estado',
      description: 'Cambia el estado del lead en el embudo del setter.',
      input_schema: { type: 'object', properties: { ia_estado: { type: 'string', enum: IA_ESTADOS } }, required: ['ia_estado'], additionalProperties: false },
    },
    {
      name: 'calificar',
      description: 'Califica al lead cuando tengas datos suficientes: si (viaja seguro, fecha y presupuesto acordes), masomenos (interés real pero le falta algo), curioso (solo mira).',
      input_schema: {
        type: 'object',
        properties: {
          calificacion: { type: 'string', enum: ['si', 'masomenos', 'curioso'] },
          score: { type: 'integer', minimum: 1, maximum: 10 },
          motivo: { type: 'string', description: 'Una o dos frases con el porqué.' },
        },
        required: ['calificacion', 'score', 'motivo'],
        additionalProperties: false,
      },
    },
    {
      name: 'enviar_recurso',
      description: 'Manda un recurso de la lista (link, archivo o audio) después de tu mensaje.',
      input_schema: { type: 'object', properties: { etiqueta: { type: 'string', description: 'Etiqueta del recurso, sin @.' } }, required: ['etiqueta'], additionalProperties: false },
    },
    {
      name: 'derivar_a_asesora',
      description: 'Pasa el chat a una persona del equipo para que arme la cotización (después la IA solo lee una respuesta más). Úsalo cuando el lead está calificado, pide una persona o algo se sale de lo que puedes resolver. Después de usarla, despídete como indica tu prompt.',
      input_schema: {
        type: 'object',
        properties: { motivo: { type: 'string' }, resumen: { type: 'string', description: 'Resumen para la asesora: quién es, qué quiere, qué falta.' } },
        required: ['motivo', 'resumen'],
        additionalProperties: false,
      },
    },
    {
      name: 'consultar_al_equipo',
      description: 'Úsala cuando la persona pregunta algo que no está en la base de conocimiento ni en el catálogo. Avisa al equipo para que lo confirme; tú sigues atendiendo el resto de la charla. Después dile algo como "No sabría decirle con exactitud, lo consulto con el equipo y le confirmo".',
      input_schema: { type: 'object', properties: { pregunta: { type: 'string', description: 'Lo que hay que confirmar, en una frase.' } }, required: ['pregunta'], additionalProperties: false },
    },
    {
      name: 'descartar',
      description: 'Marca que no es un lead (spam, proveedor, equivocado) o que no califica. La IA deja de responder en este chat.',
      input_schema: {
        type: 'object',
        properties: { tipo: { type: 'string', enum: ['no_es_lead', 'no_calificado'] }, motivo: { type: 'string' } },
        required: ['tipo', 'motivo'],
        additionalProperties: false,
      },
    },
    {
      name: 'guardar_codigo_web',
      description: 'Guarda el código de la web (formato LL-123456) si la persona lo menciona.',
      input_schema: { type: 'object', properties: { ref: { type: 'string', pattern: '^LL-\\d{6}$' } }, required: ['ref'], additionalProperties: false },
    },
  ];
  if (puedeTraspasar && especialistas.length) {
    tools.push({
      name: 'traspasar',
      description: 'Pasa la conversación a un especialista. Responde él, en este mismo turno.',
      input_schema: {
        type: 'object',
        properties: { clave: { type: 'string', enum: especialistas.map((a) => a.clave) }, motivo: { type: 'string' } },
        required: ['clave', 'motivo'],
        additionalProperties: false,
      },
    });
  }
  if (puedeTraspasar && agente.rol === 'especialista') {
    tools.push({
      name: 'devolver',
      description: 'Devuelve la conversación al agente principal. Responde él, en este mismo turno.',
      input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'], additionalProperties: false },
    });
  }
  if (agente.guion_por_pasos) {
    tools.push({
      name: 'marcar_paso',
      description: 'Registra en qué paso del guion está la conversación.',
      input_schema: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'], additionalProperties: false },
    });
  }
  return tools;
}

async function evento(ctx, tipo, detalle) {
  await ctx.db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
    .bind(ctx.conv.id, ctx.lead.id, tipo, detalle ?? null, ctx.ahora).run();
}

function normalizarCampo(k, v) {
  if (v === null || v === undefined) return null;
  if (ENTEROS.has(k)) { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 1000 ? n : null; }
  const s = String(v).trim().slice(0, 300);
  if (!s) return null;
  if (FECHAS.has(k) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function cambiarEstado(ctx, nuevo) {
  if (!IA_ESTADOS.includes(nuevo) || ctx.lead.ia_estado === nuevo) return;
  await ctx.db.prepare('UPDATE leads SET ia_estado = ?, actualizado_en = ? WHERE id = ?').bind(nuevo, ctx.ahora, ctx.lead.id).run();
  await evento(ctx, 'estado', `${ctx.lead.ia_estado || '—'} → ${nuevo}`);
  ctx.lead.ia_estado = nuevo;
}

// Etiqueta comercial del Inbox. La IA no pisa lo que eligió una persona.
const ETIQUETA_DE = { si: 'interesado', masomenos: 'interesado', curioso: 'curioso' };
async function etiquetar(ctx, valor) {
  if (!valor || ctx.lead.ia_calificacion_por === 'persona' || ctx.lead.ia_calificacion === valor) return;
  await ctx.db.prepare(`UPDATE leads SET ia_calificacion = ?, ia_calificacion_por = 'ia', actualizado_en = ? WHERE id = ?`)
    .bind(valor, ctx.ahora, ctx.lead.id).run();
  ctx.lead.ia_calificacion = valor;
}

async function pausar(ctx, motivo, extra = '') {
  await ctx.db.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = ?${extra}, actualizado_en = ? WHERE id = ?`)
    .bind(motivo, ctx.ahora, ctx.conv.id).run();
  ctx.conv.ia_activa = 0;
}

const EJECUTAR = {
  async completar_lead(ctx, input) {
    const guardados = [], diferencias = [];
    for (const [k, crudo] of Object.entries(input || {})) {
      if (!(k in CAMPOS_LEAD)) continue;
      const v = normalizarCampo(k, crudo);
      if (v === null) continue;
      const actual = ctx.lead[k];
      // El nombre provisorio de un lead nuevo es su número (+51…): ese sí se reemplaza.
      const vacio = actual === null || actual === undefined || actual === '' || (k === 'nombre' && String(actual).startsWith('+'));
      if (vacio) {
        await ctx.db.prepare(`UPDATE leads SET ${k} = ?, actualizado_en = ? WHERE id = ?`).bind(v, ctx.ahora, ctx.lead.id).run();
        ctx.lead[k] = v;
        guardados.push(k);
      } else if (String(actual) !== String(v)) {
        diferencias.push(`${k}: el lead dijo "${v}" (en la ficha: "${actual}")`);
      }
    }
    if (diferencias.length) {
      const nota = `[IA ${ctx.ahora.slice(0, 10)}] ${diferencias.join('; ')}`;
      const resumen = ctx.lead.ia_resumen ? ctx.lead.ia_resumen + '\n' + nota : nota;
      await ctx.db.prepare('UPDATE leads SET ia_resumen = ? WHERE id = ?').bind(resumen, ctx.lead.id).run();
      ctx.lead.ia_resumen = resumen;
    }
    return `Guardado: ${guardados.join(', ') || 'nada nuevo'}.${diferencias.length ? ' No se pisaron datos ya cargados; las diferencias quedaron anotadas para la asesora.' : ''}`;
  },

  async cambiar_estado(ctx, { ia_estado }) {
    if (!IA_ESTADOS.includes(ia_estado)) return 'Estado inválido.';
    await cambiarEstado(ctx, ia_estado);
    return `Estado: ${ia_estado}.`;
  },

  async calificar(ctx, { calificacion, score, motivo }) {
    if (!['si', 'masomenos', 'curioso'].includes(calificacion)) return 'Calificación inválida.';
    const n = Number.isInteger(score) && score >= 1 && score <= 10 ? score : null;
    // Calificación y score: la IA propone, no pisa lo que cargó la asesora o el formulario.
    await ctx.db.prepare(
      `UPDATE leads SET calificado = coalesce(nullif(calificado, ''), ?), score = coalesce(score, ?), ia_score_motivo = ?, actualizado_en = ? WHERE id = ?`
    ).bind(calificacion, n, String(motivo || '').slice(0, 500), ctx.ahora, ctx.lead.id).run();
    await evento(ctx, 'calificacion', `${calificacion} ${n ?? ''} · ${motivo || ''}`.trim());
    await etiquetar(ctx, ETIQUETA_DE[calificacion]);
    if (calificacion === 'si' && !['cotizador_enviado', 'derivado'].includes(ctx.lead.ia_estado)) await cambiarEstado(ctx, 'calificado');
    return `Calificado como ${calificacion}.`;
  },

  async enviar_recurso(ctx, { etiqueta }) {
    const r = ctx.recursos.find((x) => x.etiqueta === String(etiqueta || '').replace(/^@/, ''));
    if (!r) return `No existe el recurso "${etiqueta}". Recursos disponibles: ${ctx.recursos.map((x) => x.etiqueta).join(', ') || 'ninguno'}.`;
    if (ctx.salidas.some((s) => s.recurso?.id === r.id)) return 'Ese recurso ya está en cola para este turno.';
    ctx.salidas.push({ recurso: r });
    if (r.id === ctx.agente.recurso_conversion_id && ctx.lead.ia_estado !== 'derivado') await cambiarEstado(ctx, 'cotizador_enviado');
    return `Se manda @${r.etiqueta} después de tu mensaje.`;
  },

  // El chat pasa a esperar a una persona, pero la IA lee una respuesta más:
  // la de "¿tiene alguna consulta sobre el servicio?" (ver turno.js).
  async derivar_a_asesora(ctx, { motivo, resumen }) {
    if (ctx.lead.ia_estado === 'derivado') return 'Ya está derivado: no hace falta volver a derivar.';
    await ctx.db.prepare('UPDATE wa_conversaciones SET espera_persona = 1, actualizado_en = ? WHERE id = ?').bind(ctx.ahora, ctx.conv.id).run();
    await ctx.db.prepare(
      `UPDATE leads SET ia_resumen = ?, etapa = CASE WHEN etapa = 'lead_nuevo' THEN 'contactado' ELSE etapa END, actualizado_en = ? WHERE id = ?`
    ).bind(String(resumen || '').slice(0, 2000), ctx.ahora, ctx.lead.id).run();
    ctx.lead.ia_resumen = resumen;
    await cambiarEstado(ctx, 'derivado');
    await evento(ctx, 'derivacion', motivo);
    ctx.estado.derivado = true;
    return 'Derivado. Despídete como indica tu prompt.';
  },

  async consultar_al_equipo(ctx, { pregunta }) {
    const p = String(pregunta || '').trim().slice(0, 500);
    if (!p) return 'Falta la pregunta.';
    await ctx.db.prepare('UPDATE wa_conversaciones SET espera_persona = 1, actualizado_en = ? WHERE id = ?').bind(ctx.ahora, ctx.conv.id).run();
    await evento(ctx, 'consulta_equipo', p);
    ctx.estado.consulta = p;
    return 'Avisado al equipo. Dile que lo consultas y le confirmas; no adivines la respuesta.';
  },

  async descartar(ctx, { tipo, motivo }) {
    if (!['no_es_lead', 'no_calificado'].includes(tipo)) return 'Tipo inválido.';
    await pausar(ctx, 'descartado');
    await cambiarEstado(ctx, tipo);
    if (tipo === 'no_calificado') await etiquetar(ctx, 'no_califica');
    await evento(ctx, 'descarte', motivo);
    ctx.estado.descartado = true;
    return 'Descartado. Si corresponde, despídete con amabilidad en un mensaje corto; si es spam, no escribas nada.';
  },

  async guardar_codigo_web(ctx, { ref }) {
    const r = String(ref || '').toUpperCase();
    if (!/^LL-\d{6}$/.test(r)) return 'Código inválido.';
    await ctx.db.prepare('UPDATE leads SET codigo_web = coalesce(codigo_web, ?) WHERE id = ?').bind(r, ctx.lead.id).run();
    ctx.lead.codigo_web = ctx.lead.codigo_web || r;
    return 'Código guardado.';
  },

  async traspasar(ctx, { clave, motivo }) {
    const destino = ctx.agentes.find((a) => a.clave === clave && a.activo && a.rol === 'especialista');
    if (!destino) return `No hay un especialista activo con la clave "${clave}".`;
    ctx.estado.traspasoA = destino.clave;
    await evento(ctx, 'traspaso', `${ctx.agente.clave} → ${clave}: ${motivo || ''}`);
    return `Traspasado a ${clave}. No escribas nada más.`;
  },

  async devolver(ctx, { motivo }) {
    const jefe = ctx.agentes.find((a) => a.rol === 'jefe' && a.activo);
    if (!jefe) return 'No hay agente principal activo.';
    ctx.estado.traspasoA = jefe.clave;
    await evento(ctx, 'traspaso', `${ctx.agente.clave} → ${jefe.clave} (devuelto): ${motivo || ''}`);
    return 'Devuelto al agente principal. No escribas nada más.';
  },

  async marcar_paso(ctx, { n }) {
    if (!Number.isInteger(n) || n < 1) return 'Paso inválido.';
    await ctx.db.prepare('UPDATE wa_conversaciones SET paso_guion = ? WHERE id = ?').bind(n, ctx.conv.id).run();
    return `Paso ${n}.`;
  },
};

export async function ejecutar(ctx, nombre, input) {
  const f = EJECUTAR[nombre];
  if (!f) return { texto: `Herramienta desconocida: ${nombre}`, error: true };
  try {
    return { texto: await f(ctx, input || {}) };
  } catch (e) {
    await evento(ctx, 'error_herramienta', `${nombre}: ${String(e.message || e).slice(0, 300)}`);
    return { texto: `Error al ejecutar ${nombre}.`, error: true };
  }
}
