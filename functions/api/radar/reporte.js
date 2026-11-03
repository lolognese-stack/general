// POST /api/radar/reporte — Radar de Instagram (extensión radar-luna-llena).
//
// La extensión manda el chat de ManyChat leído de la pantalla y el contacto
// (subscriber id). Acá se piden etiquetas y campos a ManyChat (con la API key
// que se carga en la extensión, header x-manychat-key; si no viene, el secret
// MANYCHAT_TOKEN), se cruza con el lead, la web y WhatsApp, se le pide a
// Claude (secret ANTHROPIC_API_KEY) que extraiga los datos y se guarda:
//   - radar_reportes (uno por contacto, el nuevo pisa al anterior),
//   - el lead: si no existe, se crea con fuente Instagram; si existe, se
//     completan solo los campos vacíos.
// Devuelve el texto del reporte y la fila para el Sheets "Radar Luna Llena"
// (la manda la extensión: el secreto del Apps Script vive en la extensión).

import { rolDe, json } from '../../_lib/auth.js';
import { claudeJson } from '../../_lib/claude.js';
import {
  ESQUEMA, promptSistema, mensajeUsuario, nombresDeEtiquetas, clasificarEtiquetas,
  seguidorDesde, armarReporte, enPeru,
} from '../../_lib/radar.js';

const MAX_CHAT = 120000;

async function infoManychat(key, subId) {
  const res = await fetch(`https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subId}`, {
    headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') throw new Error(data.message || `HTTP ${res.status}`);
  return data.data || null;
}

// Hitos de la persona que están en la base (web y WhatsApp).
async function hitosDeLaBase(db, subId, lead) {
  const web = await db.prepare(
    `SELECT min(primer_evento) AS primera,
            min(CASE WHEN leads > 0 THEN ultimo_evento END) AS cotizo
       FROM sesiones_web
      WHERE interno = 0 AND (manychat_id = ?1 OR (?2 IS NOT NULL AND codigo = ?2))`
  ).bind(subId, lead?.codigo_web || null).first();
  const wa = lead
    ? await db.prepare('SELECT min(creado_en) AS primero FROM wa_conversaciones WHERE lead_id = ?').bind(lead.id).first()
    : null;
  // Un lead que entró por la web cotizó cuando se creó, aunque la sesión no lo marque.
  const cotizoLead = lead && (lead.codigo_web || lead.fuente === 'Página web') ? lead.creado_en : null;
  return {
    primeraWeb: web?.primera ? enPeru(web.primera) : null,
    cotizo: web?.cotizo ? enPeru(web.cotizo) : cotizoLead ? enPeru(cotizoLead) : null,
    primerWa: wa?.primero ? enPeru(wa.primero) : null,
  };
}

export async function onRequestPost({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body invalido' }, 400); }

  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (transcript.length < 20) return json({ error: 'No hay transcripción del chat.' }, 400);
  const subId = /^\d{1,20}$/.test(String(body.manychat_id || '')) ? String(body.manychat_id) : null;
  if (!subId) return json({ error: 'Falta el Subscriber ID de ManyChat.' }, 400);

  const db = env.DB;
  const avisos = [];
  const mcKey = (request.headers.get('x-manychat-key') || '').trim() || env.MANYCHAT_TOKEN;

  const [sub, piezasCrm, lead] = await Promise.all([
    mcKey
      ? infoManychat(mcKey, subId).catch((e) => { avisos.push(`No se pudieron leer etiquetas y campos de ManyChat (${e.message}).`); return null; })
      : (avisos.push('Sin API key de ManyChat (se carga en el ícono de la extensión): el reporte sale sin etiquetas, sin "empezó a seguir" y sin fecha de entrada a ManyChat.'), null),
    db.prepare('SELECT etiqueta_manychat FROM piezas WHERE etiqueta_manychat IS NOT NULL').all().then((r) => r.results.map((x) => x.etiqueta_manychat)),
    db.prepare('SELECT * FROM leads WHERE manychat_id = ? ORDER BY id DESC LIMIT 1').bind(subId).first(),
  ]);

  const etiquetas = nombresDeEtiquetas(sub);
  const cls = clasificarEtiquetas(etiquetas, piezasCrm);
  const hoy = enPeru(new Date().toISOString()).slice(0, 10);

  let d, modelo;
  try {
    ({ datos: d, modelo } = await claudeJson(env, {
      system: promptSistema(hoy),
      user: mensajeUsuario(transcript.slice(-MAX_CHAT), sub, etiquetas, cls.piezas),
      schema: ESQUEMA,
    }));
  } catch (e) {
    return json({ error: e.message }, 502);
  }

  const base = await hitosDeLaBase(db, subId, lead);
  const hitos = {
    seguidor: seguidorDesde(sub),
    subscribed: sub?.subscribed ? enPeru(sub.subscribed) : null,
    primerMensaje: d.primera_interaccion || null,
    ...base,
  };
  const r = armarReporte({ d, sub, subId, cls, lead, hitos, modelo });

  const ahora = new Date().toISOString();
  const ig = r.fila.ig || null;
  let leadId = lead?.id || null;
  let creado = false;

  if (lead) {
    // Solo se completa lo vacío: lo que cargó una persona o el formulario manda.
    await db.prepare(
      `UPDATE leads SET
         ig_username = coalesce(nullif(ig_username, ''), ?),
         seguidor_desde = coalesce(nullif(seguidor_desde, ''), ?),
         primer_contacto_ig = coalesce(nullif(primer_contacto_ig, ''), ?),
         destinos = coalesce(nullif(destinos, ''), ?),
         personas = coalesce(personas, ?),
         fecha_viaje = coalesce(nullif(fecha_viaje, ''), ?),
         dias = coalesce(dias, ?),
         tipo_cotizacion = coalesce(nullif(tipo_cotizacion, ''), ?),
         etiqueta_manychat = coalesce(nullif(etiqueta_manychat, ''), ?),
         actualizado_en = ?
       WHERE id = ?`
    ).bind(ig, hitos.seguidor, hitos.subscribed, r.paraLead.destinos, r.paraLead.personas, r.paraLead.fecha_viaje,
      r.paraLead.dias, r.paraLead.tipo_cotizacion, r.paraLead.etiqueta_manychat, ahora, lead.id).run();
  } else {
    const ins = await db.prepare(
      `INSERT INTO leads (nombre, manychat_id, ig_username, seguidor_desde, primer_contacto_ig, destinos, personas,
                          fecha_viaje, dias, tipo_cotizacion, etiqueta_manychat, fuente, etapa, fecha_alta, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Instagram', 'lead_nuevo', ?, ?, ?)`
    ).bind(r.fila.nombre, subId, ig, hitos.seguidor, hitos.subscribed, r.paraLead.destinos, r.paraLead.personas,
      r.paraLead.fecha_viaje, r.paraLead.dias, r.paraLead.tipo_cotizacion, r.paraLead.etiqueta_manychat, ahora, ahora, ahora).run();
    leadId = ins.meta.last_row_id;
    creado = true;
    await db.prepare(
      `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, NULL, 'lead_nuevo', 'radar', ?)`
    ).bind(leadId, ahora).run().catch(() => {});
    r.fila.lead_crm = leadId;
  }

  await db.prepare(
    `INSERT INTO radar_reportes (manychat_id, lead_id, texto, datos_json, modelo, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(manychat_id) DO UPDATE SET lead_id = excluded.lead_id, texto = excluded.texto,
       datos_json = excluded.datos_json, modelo = excluded.modelo, actualizado_en = excluded.actualizado_en`
  ).bind(subId, leadId, r.texto, JSON.stringify({ fila: r.fila, recorrido: r.recorrido, embudo: r.embudo }), modelo, ahora, ahora).run();

  return json({
    ok: true, texto: r.texto, fila: r.fila, lead_id: leadId, lead_creado: creado, avisos,
  });
}
