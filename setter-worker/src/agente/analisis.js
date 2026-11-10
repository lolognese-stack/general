// Análisis de cada chat con Haiku (salida estructurada) para las analíticas
// del setter. Lo corre el cron: chats con movimiento desde su último
// análisis y quietos hace 30 min (para no analizar a mitad de charla).

import { clienteClaude } from './loop.js';

export const MODELO_ANALISIS = 'claude-haiku-5-5';
const QUIETO_MS = 30 * 60e3;
const POR_CORRIDA = 10;

const lista = { type: 'array', items: { type: 'string' } };
const ESQUEMA = {
  type: 'object',
  properties: {
    intencion_inicial: { type: 'string', description: 'Qué quería en su primer mensaje, en pocas palabras.' },
    objeciones: { type: 'array', items: { type: 'object', properties: { objecion: { type: 'string', description: 'Categoría corta: precio, fechas, desconfianza, lo va a pensar, ya tiene agencia…' }, frase: { type: 'string', description: 'Frase típica, textual del lead.' } }, required: ['objecion', 'frase'], additionalProperties: false } },
    dolores: lista, pedidos: lista, senales_compra: lista,
    preguntas_sin_respuesta: { ...lista, description: 'Preguntas del lead que el setter no supo o no pudo contestar.' },
    motivo_perdida: { type: 'string', description: 'Si se enfrió o se perdió, por qué. Vacío si sigue abierto.' },
    etapa_corte: { type: 'string', enum: ['', 'saludo', 'calificacion', 'cotizador', 'derivacion', 'seguimiento'] },
    tipo_lead: { type: 'string', enum: ['decidido', 'comparando', 'explorando', 'curioso', 'no_es_lead'] },
    proxima_accion: { type: 'string' },
    prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['intencion_inicial', 'objeciones', 'dolores', 'pedidos', 'senales_compra', 'preguntas_sin_respuesta', 'motivo_perdida', 'etapa_corte', 'tipo_lead', 'proxima_accion', 'prioridad'],
  additionalProperties: false,
};

const AUTOR = { lead: 'Lead', ia: 'Setter IA', asesora_app: 'Asesora', asesora_web: 'Asesora', sistema: 'Sistema' };

export async function analizarConversacion(env, convId, { claude = null, ahora = new Date() } = {}) {
  const db = env.DB;
  const conv = await db.prepare('SELECT * FROM wa_conversaciones WHERE id = ?').bind(convId).first();
  if (!conv) return null;
  const lead = conv.lead_id ? await db.prepare('SELECT nombre, etapa, calificado, ia_estado, destinos, fecha_viaje, personas FROM leads WHERE id = ?').bind(conv.lead_id).first() : null;
  const mensajes = (await db.prepare(
    `SELECT * FROM (SELECT autor, tipo, texto, transcripcion, creado_en FROM wa_mensajes WHERE conversacion_id = ? AND tipo <> 'nota' ORDER BY creado_en DESC LIMIT 80) ORDER BY creado_en`
  ).bind(convId).all()).results;
  if (!mensajes.length) return null;
  const chat = mensajes.map((m) => `${AUTOR[m.autor] || m.autor}: ${m.tipo === 'audio' ? '[nota de voz] ' + (m.transcripcion || '') : m.texto || '[' + m.tipo + ']'}`).join('\n');
  const r = await (claude || clienteClaude(env)).messages.create({
    model: MODELO_ANALISIS,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
    system: 'Analizas chats de WhatsApp entre leads y el setter de una agencia de viajes en Perú (Luna Llena Travel). Responde en español, breve y concreto. Listas de máximo 5 ítems; frases de objeción textuales del lead.',
    messages: [{ role: 'user', content: `Estado en el CRM: ${JSON.stringify(lead || {})}\n\n<chat>\n${chat}\n</chat>` }],
  });
  if (r.stop_reason === 'refusal') return null;
  const d = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const iso = ahora.toISOString();
  await db.prepare(
    `INSERT INTO wa_analisis (conversacion_id, intencion_inicial, objeciones_json, dolores_json, pedidos_json, senales_compra_json,
       preguntas_sin_respuesta_json, motivo_perdida, etapa_corte, tipo_lead, proxima_accion, prioridad, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversacion_id) DO UPDATE SET intencion_inicial = excluded.intencion_inicial, objeciones_json = excluded.objeciones_json,
       dolores_json = excluded.dolores_json, pedidos_json = excluded.pedidos_json, senales_compra_json = excluded.senales_compra_json,
       preguntas_sin_respuesta_json = excluded.preguntas_sin_respuesta_json, motivo_perdida = excluded.motivo_perdida,
       etapa_corte = excluded.etapa_corte, tipo_lead = excluded.tipo_lead, proxima_accion = excluded.proxima_accion,
       prioridad = excluded.prioridad, actualizado_en = excluded.actualizado_en`
  ).bind(convId, d.intencion_inicial, JSON.stringify(d.objeciones.slice(0, 5)), JSON.stringify(d.dolores.slice(0, 5)), JSON.stringify(d.pedidos.slice(0, 5)),
    JSON.stringify(d.senales_compra.slice(0, 5)), JSON.stringify(d.preguntas_sin_respuesta.slice(0, 5)), d.motivo_perdida || null,
    d.etapa_corte || null, d.tipo_lead, d.proxima_accion, d.prioridad, iso).run();
  if (conv.lead_id && d.intencion_inicial) {
    await db.prepare(`UPDATE leads SET ia_primera_intencion = coalesce(nullif(ia_primera_intencion, ''), ?) WHERE id = ?`).bind(d.intencion_inicial.slice(0, 300), conv.lead_id).run();
  }
  return d;
}

// Para el cron: chats con mensajes nuevos desde el último análisis y quietos.
export async function analizarPendientes(env, { claude = null, ahora = new Date() } = {}) {
  const quieto = new Date(ahora.getTime() - QUIETO_MS).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM wa_conversaciones c LEFT JOIN wa_analisis a ON a.conversacion_id = c.id
      WHERE c.ultimo_en IS NOT NULL AND c.ultimo_en <= ? AND (a.actualizado_en IS NULL OR a.actualizado_en < c.ultimo_en)
      ORDER BY c.ultimo_en DESC LIMIT ?`
  ).bind(quieto, POR_CORRIDA).all();
  let hechos = 0;
  for (const { id } of results) {
    try { if (await analizarConversacion(env, id, { claude, ahora })) hechos++; }
    catch (e) {
      await env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?)')
        .bind(id, 'error_analisis', String(e.message || e).slice(0, 300), ahora.toISOString()).run();
    }
  }
  return { pendientes: results.length, hechos };
}
