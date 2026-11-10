// Guarda en D1 lo que llega por el webhook. Idempotente: Meta reintenta los
// webhooks, y wa_mensajes.provider_id es UNIQUE, así que un mensaje repetido
// no se guarda dos veces ni vuelve a tocar contadores.

import { buscarOCrearLead, codigoWebDe, variantes } from './leads.js';

const VENTANA_MS = 24 * 3600 * 1000;
// Un estado nunca retrocede: un 'delivered' que llega después del 'read' se ignora.
const RANGO = `CASE estado WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END`;
const RANGO_NUEVO = { sent: 1, delivered: 2, read: 3 };

// Copia el último mensaje a la conversación (la lista del Inbox lee solo eso).
// Un mensaje viejo que llega tarde no pisa uno más nuevo.
export function ultimoSql(db, convId, { autor, texto, tipo, en }, ahora, extra = '') {
  return db.prepare(
    `UPDATE wa_conversaciones
        SET ultimo_texto = CASE WHEN ?1 >= coalesce(ultimo_en, '') THEN ?2 ELSE ultimo_texto END,
            ultimo_autor = CASE WHEN ?1 >= coalesce(ultimo_en, '') THEN ?3 ELSE ultimo_autor END,
            ultimo_en = max(coalesce(ultimo_en, ''), ?1), actualizado_en = ?4 ${extra}
      WHERE id = ?5`
  ).bind(en, texto ?? `[${tipo}]`, autor, ahora, convId);
}

function origenDe(ev, codigoWeb) {
  if (ev.referral) return 'anuncio';
  if (codigoWeb) return 'web_ref';
  return 'directo';
}

// "Responde siempre" del agente que atiende el chat (o del jefe).
export async function respondeSiempre(db, conv) {
  const a = await db.prepare(
    `SELECT responde_siempre FROM setter_agentes WHERE activo = 1 AND (clave = ?1 OR rol = 'jefe') ORDER BY clave = ?1 DESC LIMIT 1`
  ).bind(conv.agente_activo ?? '').first();
  return !!a?.responde_siempre;
}

export async function conversacionDe(db, { waId, nombre, abiertaPor, codigoWeb, origen }, ahora) {
  const vars = variantes(waId);
  const conv = await db.prepare(`SELECT * FROM wa_conversaciones WHERE wa_id IN (${vars.map(() => '?').join(',')}) ORDER BY wa_id = ? DESC LIMIT 1`).bind(...vars, waId).first();
  if (conv) return conv;
  const { leadId } = await buscarOCrearLead(db, { waId, nombre, codigoWeb, origen }, ahora);
  // OR IGNORE: dos webhooks del mismo número a la vez no crean dos conversaciones.
  await db.prepare(
    `INSERT OR IGNORE INTO wa_conversaciones (lead_id, wa_id, nombre_perfil, abierta_por, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(leadId, waId, nombre, abiertaPor, ahora, ahora).run();
  return db.prepare('SELECT * FROM wa_conversaciones WHERE wa_id = ?').bind(waId).first();
}

export async function insertarMensaje(db, m) {
  const r = await db.prepare(
    `INSERT OR IGNORE INTO wa_mensajes
       (conversacion_id, direccion, autor, agente_clave, tipo, texto, media_key, recurso_id, provider_id, estado, es_followup, intento_followup, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    m.conversacionId, m.direccion, m.autor, m.agenteClave ?? null, m.tipo, m.texto ?? null,
    m.mediaKey ?? null, m.recursoId ?? null, m.providerId ?? null, m.estado ?? null,
    m.esFollowup ? 1 : 0, m.intentoFollowup ?? null, m.creadoEn
  ).run();
  return r.meta.changes > 0;
}

async function guardarMensaje(db, ev, ahora) {
  const codigoWeb = codigoWebDe(ev.texto);
  const conv = await conversacionDe(db, {
    waId: ev.waId, nombre: ev.nombre, abiertaPor: 'lead', codigoWeb, origen: origenDe(ev, codigoWeb),
  }, ahora);
  const nuevo = await insertarMensaje(db, {
    conversacionId: conv.id, direccion: 'in', autor: 'lead', tipo: ev.msgTipo, texto: ev.texto,
    mediaKey: ev.mediaId ? 'meta:' + ev.mediaId : null, providerId: ev.providerId, creadoEn: ev.en,
  });
  if (!nuevo) return null;
  const ventana = new Date(new Date(ev.en).getTime() + VENTANA_MS).toISOString();
  await db.prepare(
    `UPDATE wa_conversaciones
        SET ultimo_in_en = max(coalesce(ultimo_in_en, ''), ?), ventana_hasta = max(coalesce(ventana_hasta, ''), ?),
            no_leidos = no_leidos + 1, visto_por_lead = 'contesto',
            nombre_perfil = coalesce(?, nombre_perfil), actualizado_en = ?
      WHERE id = ?`
  ).bind(ev.en, ventana, ev.nombre, ahora, conv.id).run();
  await ultimoSql(db, conv.id, { autor: 'lead', texto: ev.texto, tipo: ev.msgTipo, en: ev.en }, ahora).run();
  if (codigoWeb && conv.lead_id) {
    await db.prepare('UPDATE leads SET codigo_web = coalesce(codigo_web, ?) WHERE id = ?').bind(codigoWeb, conv.lead_id).run();
  }
  return conv;
}

async function guardarEcho(db, ev, ahora) {
  const conv = await conversacionDe(db, { waId: ev.waId, nombre: null, abiertaPor: 'nosotros', codigoWeb: null, origen: null }, ahora);
  const nuevo = await insertarMensaje(db, {
    conversacionId: conv.id, direccion: 'out', autor: 'asesora_app', tipo: ev.msgTipo, texto: ev.texto,
    mediaKey: ev.mediaId ? 'meta:' + ev.mediaId : null, providerId: ev.providerId, estado: 'sent', creadoEn: ev.en,
  });
  if (!nuevo) return;
  // La asesora contestó desde el celular: el chat deja de esperar a una
  // persona y la IA se calla, salvo que el agente tenga "Responde siempre".
  await ultimoSql(db, conv.id, { autor: 'asesora_app', texto: ev.texto, tipo: ev.msgTipo, en: ev.en }, ahora,
    `, ultimo_out_en = max(coalesce(ultimo_out_en, ''), ?1), espera_persona = 0`).run();
  if (conv.ia_activa && !(await respondeSiempre(db, conv))) {
    await db.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'asesora_respondio' WHERE id = ?`).bind(conv.id).run();
    await db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
      .bind(conv.id, conv.lead_id, 'pausa', 'la asesora respondió desde el celular', ahora).run();
  }
}

async function guardarEstado(db, ev, ahora) {
  if (ev.estado === 'failed') {
    await db.prepare(`UPDATE wa_mensajes SET estado = 'failed', error = ? WHERE provider_id = ? AND coalesce(estado, '') <> 'read'`)
      .bind(ev.error, ev.providerId).run();
    return;
  }
  const rango = RANGO_NUEVO[ev.estado];
  if (!rango) return;
  const r = await db.prepare(
    `UPDATE wa_mensajes SET estado = ?, leido_en = CASE WHEN ? = 'read' THEN ? ELSE leido_en END
      WHERE provider_id = ? AND ${RANGO} < ?`
  ).bind(ev.estado, ev.estado, ev.en, ev.providerId, rango).run();
  if (!r.meta.changes || ev.estado === 'sent') return;
  // "Visto por el lead": solo cuenta si lo último de la conversación es nuestro.
  await db.prepare(
    `UPDATE wa_conversaciones SET visto_por_lead = ?, actualizado_en = ?
      WHERE id = (SELECT conversacion_id FROM wa_mensajes WHERE provider_id = ?)
        AND coalesce(ultimo_in_en, '') < coalesce(ultimo_out_en, '')`
  ).bind(ev.estado === 'read' ? 'vio_no_contesto' : 'no_abrio', ahora, ev.providerId).run();
}

// Devuelve las conversaciones con mensajes nuevos del lead (para avisar al DO).
export async function guardarEventos(db, eventos, ahora = new Date().toISOString()) {
  const conLead = new Map();
  for (const ev of eventos) {
    if (ev.tipo === 'mensaje') {
      const conv = await guardarMensaje(db, ev, ahora);
      if (conv) conLead.set(conv.id, conv);
    } else if (ev.tipo === 'echo') {
      await guardarEcho(db, ev, ahora);
    } else if (ev.tipo === 'estado') {
      await guardarEstado(db, ev, ahora);
    }
  }
  return [...conLead.values()];
}
