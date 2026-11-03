// Resumen de la persona: todo lo que se sabe de un lead en Instagram (reporte
// del Radar), la web (visitas, fichas, cotizaciones) y WhatsApp (chat del
// setter/Kapso), con una síntesis de Claude que los cruza.
//
// GET  /api/lead-resumen/:id → fuentes + último resumen + si quedó viejo.
// POST /api/lead-resumen/:id → rehace la síntesis con Claude.
//
// "Viejo" = cambió alguna fuente desde que se hizo (huella distinta). El panel
// lo rehace solo al abrir el lead.

import { rolDe, json } from '../../_lib/auth.js';
import { claudeJson } from '../../_lib/claude.js';
import { enPeru } from '../../_lib/radar.js';

const S = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ESQUEMA = obj({
  sintesis: { ...S, description: '3 o 4 líneas: quién es, qué quiere, en qué punto está, cruzando los canales.' },
  proxima_accion: { ...S, description: 'Qué conviene hacer ahora y por qué canal.' },
  temperatura: { type: 'string', enum: ['caliente', 'tibio', 'frio', 'sin_datos'] },
  canal_activo: { type: 'string', enum: ['instagram', 'whatsapp', 'web', 'ninguno'], description: 'Dónde está conversando ahora.' },
  viaje: obj({ destinos: S, fechas: S, personas: S, presupuesto: S }),
  contradicciones: {
    type: 'array',
    items: obj({ dato: S, instagram: S, whatsapp: S, web: S }),
    description: 'Datos que no coinciden entre canales (fechas, personas, destinos, presupuesto). Vacío si todo coincide. En el canal que no lo dice, "".',
  },
});

const AUTOR = { lead: 'Persona', ia: 'Setter IA', asesora_app: 'Asesora', asesora_web: 'Asesora', sistema: 'Sistema' };

async function fuentes(db, lead) {
  const radar = lead.manychat_id
    ? await db.prepare('SELECT texto, datos_json, actualizado_en FROM radar_reportes WHERE manychat_id = ? OR lead_id = ? ORDER BY actualizado_en DESC LIMIT 1').bind(lead.manychat_id, lead.id).first()
    : await db.prepare('SELECT texto, datos_json, actualizado_en FROM radar_reportes WHERE lead_id = ? ORDER BY actualizado_en DESC LIMIT 1').bind(lead.id).first();

  const conv = await db.prepare('SELECT id, creado_en, ultimo_en, abierta_por FROM wa_conversaciones WHERE lead_id = ? ORDER BY ultimo_en DESC LIMIT 1').bind(lead.id).first();
  const mensajes = conv
    ? (await db.prepare(
        `SELECT * FROM (SELECT autor, tipo, texto, transcripcion, creado_en FROM wa_mensajes WHERE conversacion_id = ? ORDER BY creado_en DESC LIMIT 80) ORDER BY creado_en`
      ).bind(conv.id).all()).results
    : [];
  const waAnalisis = conv ? await db.prepare('SELECT * FROM wa_analisis WHERE conversacion_id = ?').bind(conv.id).first() : null;
  const waCuenta = conv ? await db.prepare('SELECT count(*) AS n, sum(direccion = \'in\') AS entrantes FROM wa_mensajes WHERE conversacion_id = ?').bind(conv.id).first() : null;

  const sesiones = (lead.codigo_web || lead.manychat_id)
    ? (await db.prepare(
        `SELECT sesion_id, primer_evento, ultimo_evento, canal, utm_campaign, landing, leads, cotizar_abierto
           FROM sesiones_web WHERE interno = 0 AND ((?1 IS NOT NULL AND codigo = ?1) OR (?2 IS NOT NULL AND manychat_id = ?2))
          ORDER BY primer_evento`
      ).bind(lead.codigo_web || null, lead.manychat_id || null).all()).results
    : [];
  const fichas = sesiones.length
    ? (await db.prepare(
        `SELECT coalesce(json_extract(e.datos_json, '$.nombre'), e.ruta) AS nombre, count(*) AS vistas
           FROM eventos_web e WHERE e.tipo = 'page_view' AND json_extract(e.datos_json, '$.paquete') IS NOT NULL
            AND e.sesion_id IN (${sesiones.map(() => '?').join(',')})
          GROUP BY 1 ORDER BY vistas DESC LIMIT 8`
      ).bind(...sesiones.map((s) => s.sesion_id)).all()).results
    : [];

  const huella = [radar?.actualizado_en || '-', conv?.ultimo_en || '-', sesiones.length ? sesiones[sesiones.length - 1].ultimo_evento : '-'].join('|');

  // Línea de tiempo de todos los canales.
  const linea = [];
  let embudoIg = [];
  try { embudoIg = JSON.parse(radar?.datos_json || '{}').embudo || []; } catch { /* reporte viejo */ }
  embudoIg.filter((e) => !/web|WhatsApp/i.test(e.nombre)).forEach((e) => linea.push({ fecha: e.fecha, canal: 'instagram', texto: e.nombre }));
  sesiones.forEach((s, i) => linea.push({
    fecha: enPeru(s.primer_evento), canal: 'web',
    texto: `${i === 0 ? 'Primera visita' : 'Volvió'} a la web${s.canal ? ` (desde ${s.canal}${s.utm_campaign ? ' · ' + s.utm_campaign : ''})` : ''}${s.leads > 0 ? ' y cotizó' : s.cotizar_abierto > 0 ? ', abrió el cotizador' : ''}`,
  }));
  if (conv) linea.push({ fecha: enPeru(conv.creado_en), canal: 'whatsapp', texto: conv.abierta_por === 'nosotros' ? 'Le escribimos por WhatsApp' : 'Escribió por WhatsApp' });
  if (conv?.ultimo_en && conv.ultimo_en !== conv.creado_en) linea.push({ fecha: enPeru(conv.ultimo_en), canal: 'whatsapp', texto: 'Último mensaje de WhatsApp' });
  linea.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));

  return { radar, conv, mensajes, waAnalisis, waCuenta, sesiones, fichas, huella, linea };
}

async function cargar(db, id) {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first();
  if (!lead) return null;
  const f = await fuentes(db, lead);
  const guardado = await db.prepare('SELECT datos_json, huella, modelo, actualizado_en FROM lead_resumenes WHERE lead_id = ?').bind(id).first();
  return { lead, f, guardado };
}

function respuesta({ lead, f, guardado }) {
  let resumen = null;
  try { resumen = guardado ? JSON.parse(guardado.datos_json) : null; } catch { /* nada */ }
  const hay = { instagram: !!f.radar, web: f.sesiones.length > 0, whatsapp: !!f.conv };
  return {
    lead_id: lead.id,
    hay,
    linea: f.linea,
    instagram: f.radar ? { texto: f.radar.texto, actualizado_en: f.radar.actualizado_en } : null,
    web: { visitas: f.sesiones.length, fichas: f.fichas },
    whatsapp: f.conv ? { conversacion_id: f.conv.id, mensajes: f.waCuenta?.n || 0, entrantes: f.waCuenta?.entrantes || 0, ultimo_en: f.conv.ultimo_en } : null,
    resumen,
    resumen_en: guardado?.actualizado_en || null,
    viejo: (hay.instagram || hay.whatsapp || hay.web) && (!guardado || guardado.huella !== f.huella),
  };
}

export async function onRequestGet({ request, env, params }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const c = await cargar(env.DB, Number(params.id));
  if (!c) return json({ error: 'no existe' }, 404);
  return json(respuesta(c));
}

export async function onRequestPost({ request, env, params }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const db = env.DB;
  const c = await cargar(db, Number(params.id));
  if (!c) return json({ error: 'no existe' }, 404);
  const { lead, f } = c;
  if (!f.radar && !f.conv && !f.sesiones.length) return json({ error: 'Todavía no hay nada de Instagram, la web ni WhatsApp para resumir.' }, 400);

  const crm = {
    nombre: lead.nombre, etapa: lead.etapa, fuente: lead.fuente, destinos: lead.destinos, fecha_viaje: lead.fecha_viaje,
    personas: lead.personas, presupuesto_pp: lead.presupuesto_pp, notas: lead.notas ? String(lead.notas).slice(0, 1500) : null,
  };
  const chatWa = f.mensajes.map((m) => `[${enPeru(m.creado_en)}] ${AUTOR[m.autor] || m.autor}: ${m.tipo === 'audio' ? '[nota de voz] ' + (m.transcripcion || '') : m.texto || '[' + m.tipo + ']'}`).join('\n');
  const user = [
    `=== CRM ===\n${JSON.stringify(crm)}`,
    `=== LÍNEA DE TIEMPO ===\n${f.linea.map((l) => `${l.fecha} · ${l.canal} · ${l.texto}`).join('\n') || '(vacía)'}`,
    `=== INSTAGRAM (reporte del Radar) ===\n${f.radar ? f.radar.texto : '(sin reporte)'}`,
    `=== WEB ===\n${f.sesiones.length ? `${f.sesiones.length} visitas. Fichas vistas: ${f.fichas.map((x) => `${x.nombre} (${x.vistas})`).join(', ') || 'ninguna'}` : '(no entró a la web identificado)'}`,
    `=== WHATSAPP ===\n${chatWa || '(sin chat)'}${f.waAnalisis ? `\nAnálisis previo: intención "${f.waAnalisis.intencion_inicial || ''}", tipo ${f.waAnalisis.tipo_lead || '?'}, próxima acción "${f.waAnalisis.proxima_accion || ''}"` : ''}`,
  ].join('\n\n');

  let d, modelo;
  try {
    ({ datos: d, modelo } = await claudeJson(env, {
      system: `Eres analista comercial de Luna Llena Travel (agencia de viajes en Perú). Te paso todo lo que se sabe de una persona en tres canales: Instagram (reporte de su chat de ManyChat), la web y WhatsApp. Cruza la información y resume para quien le va a escribir. Español neutro, breve y concreto. Si un canal no tiene datos, no lo inventes. Lo más reciente manda sobre lo viejo, pero si un dato cambió entre canales, márcalo en contradicciones.`,
      user,
      schema: ESQUEMA,
      maxTokens: 2000,
    }));
  } catch (e) {
    return json({ error: e.message }, 502);
  }

  const ahora = new Date().toISOString();
  await db.prepare(
    `INSERT INTO lead_resumenes (lead_id, datos_json, huella, modelo, actualizado_en) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lead_id) DO UPDATE SET datos_json = excluded.datos_json, huella = excluded.huella, modelo = excluded.modelo, actualizado_en = excluded.actualizado_en`
  ).bind(lead.id, JSON.stringify(d), f.huella, modelo, ahora).run();

  return json(respuesta({ lead, f, guardado: { datos_json: JSON.stringify(d), huella: f.huella, actualizado_en: ahora } }));
}
