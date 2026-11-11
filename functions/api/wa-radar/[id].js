// Análisis de WhatsApp (el "Radar" de los chats de WhatsApp).
//
// GET  /api/wa-radar/:conversacion_id → último análisis + si quedó viejo (hay mensajes nuevos).
// POST /api/wa-radar/:conversacion_id → lee el chat con Claude, lo compara con lo que
//   ya se sabía (CRM, formulario, reporte de Instagram) y guarda el reporte. En el lead
//   solo completa lo que estaba vacío; los cambios se pasan con el botón "Actualizar
//   el lead" (/api/wa-radar/:id/aplicar), porque lo cargado por una persona manda.
//
// Ver functions/_lib/wa-radar.js.

import { rolDe, json } from '../../_lib/auth.js';
import { claudeJson } from '../../_lib/claude.js';
import { enPeru } from '../../_lib/radar.js';
import { ESQUEMA, promptSistema, mensajeUsuario, chatComoTexto, armarReporteWa } from '../../_lib/wa-radar.js';

const MAX_MENSAJES = 250;
const MAX_CHAT = 100000;

function respuesta(fila, conv) {
  if (!fila) return { reporte: null, viejo: false };
  let datos = null;
  try { datos = JSON.parse(fila.datos_json); } catch { /* reporte roto */ }
  return {
    reporte: { texto: fila.texto, datos, actualizado_en: fila.actualizado_en, aplicado_en: fila.aplicado_en, mensajes: fila.mensajes_n },
    viejo: !!(conv && conv.ultimo_en && fila.ultimo_msg_en && conv.ultimo_en > fila.ultimo_msg_en),
  };
}

export async function onRequestGet({ request, env, params }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const id = Number(params.id);
  const conv = await env.DB.prepare('SELECT id, lead_id, ultimo_en FROM wa_conversaciones WHERE id = ?').bind(id).first();
  if (!conv) return json({ error: 'no existe el chat' }, 404);
  const fila = await env.DB.prepare('SELECT * FROM wa_reportes WHERE conversacion_id = ?').bind(id).first();
  return json({ lead_id: conv.lead_id, ...respuesta(fila, conv) });
}

export async function onRequestPost({ request, env, params }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const db = env.DB;
  const id = Number(params.id);
  const conv = await db.prepare('SELECT * FROM wa_conversaciones WHERE id = ?').bind(id).first();
  if (!conv) return json({ error: 'no existe el chat' }, 404);

  const mensajes = (await db.prepare(
    `SELECT * FROM (SELECT autor, tipo, texto, transcripcion, creado_en FROM wa_mensajes
                     WHERE conversacion_id = ? AND tipo <> 'nota' ORDER BY creado_en DESC LIMIT ?) ORDER BY creado_en`
  ).bind(id, MAX_MENSAJES).all()).results;
  if (!mensajes.some((m) => m.autor === 'lead')) return json({ error: 'La persona todavía no escribió por WhatsApp: no hay nada para analizar.' }, 400);

  const lead = conv.lead_id ? await db.prepare('SELECT * FROM leads WHERE id = ?').bind(conv.lead_id).first() : null;
  const radar = lead
    ? await db.prepare('SELECT texto FROM radar_reportes WHERE lead_id = ?1 OR (?2 IS NOT NULL AND manychat_id = ?2) ORDER BY actualizado_en DESC LIMIT 1')
      .bind(lead.id, lead.manychat_id || null).first()
    : null;

  const hoy = enPeru(new Date().toISOString()).slice(0, 10);
  let d, modelo;
  try {
    ({ datos: d, modelo } = await claudeJson(env, {
      system: promptSistema(hoy),
      user: mensajeUsuario({ chat: chatComoTexto(mensajes).slice(-MAX_CHAT), lead, radar, nombrePerfil: conv.nombre_perfil }),
      schema: ESQUEMA,
      maxTokens: 4000,
    }));
  } catch (e) {
    return json({ error: e.message }, 502);
  }

  const r = armarReporteWa({ d, lead, conv, mensajesN: mensajes.length, modelo });
  const ahora = new Date().toISOString();

  // En el lead solo se completa lo vacío. Los cambios se aplican con el botón.
  if (lead) {
    await db.prepare(
      `UPDATE leads SET
         destinos = coalesce(nullif(destinos, ''), ?),
         personas = coalesce(personas, ?),
         fecha_viaje = coalesce(nullif(fecha_viaje, ''), ?),
         dias = coalesce(dias, ?),
         actualizado_en = ?
       WHERE id = ?`
    ).bind(r.paraLead.destinos, r.paraLead.personas, r.paraLead.fecha_viaje, r.paraLead.dias, ahora, lead.id).run();
  }

  await db.prepare(
    `INSERT INTO wa_reportes (conversacion_id, lead_id, texto, datos_json, mensajes_n, ultimo_msg_en, modelo, aplicado_en, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(conversacion_id) DO UPDATE SET lead_id = excluded.lead_id, texto = excluded.texto, datos_json = excluded.datos_json,
       mensajes_n = excluded.mensajes_n, ultimo_msg_en = excluded.ultimo_msg_en, modelo = excluded.modelo,
       aplicado_en = NULL, actualizado_en = excluded.actualizado_en`
  ).bind(id, conv.lead_id || null, r.texto, JSON.stringify(r.datos), mensajes.length, conv.ultimo_en || null, modelo, ahora, ahora).run();

  const fila = await db.prepare('SELECT * FROM wa_reportes WHERE conversacion_id = ?').bind(id).first();
  return json({ lead_id: conv.lead_id, ...respuesta(fila, conv) });
}
