// Armador de viaje (quiz) de la web: lunallenatravel.vercel.app/armador.
// Lo llama el servidor del armador (Next.js en Vercel), no el navegador.
//
//   POST { tipo: 'lead', ref, contacto{nombre,email,ig}, viaje{...}, score{...}, itinerario_url, ... }
//        crea o completa el lead (fuente 'Armador web'). Pide mail, no WhatsApp:
//        el WhatsApp llega después, desde el mail con el itinerario.
//   POST { tipo: 'evento', ref, evento: 'click_whatsapp' | 'mail_enviado' | 'mail_abierto' | 'mail_rebotado', detalle? }
//        anota el evento en el lead (tabla eventos).
//
// Como /api/cotizar-web, no pide CRM_TOKEN: solo sabe crear o completar un lead
// y anotar eventos de ese lead.

import { canalDesdeReferer } from '../_lib/canal.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const limpio = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const entero = (v, min = 0, max = 999) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const FUENTE = 'Armador web';
const REF = /^[A-Za-z0-9_-]{10}$/;   // el slug del itinerario
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const TIER = {
  caliente: { calificado: 'si', etiqueta: 'CALIENTE' },
  tibio: { calificado: 'masomenos', etiqueta: 'TIBIO' },
  frio: { calificado: 'curioso', etiqueta: 'FRÍO' },
};
const EVENTOS = new Set(['click_whatsapp', 'mail_enviado', 'mail_abierto', 'mail_clic', 'mail_rebotado']);

export function onRequest({ request, next }) {
  if (request.method === 'POST') return next();
  return json({ error: 'metodo no permitido' }, 405);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body invalido' }, 400); }
  const ref = REF.test(body.ref || '') ? body.ref : null;
  if (!ref) return json({ error: 'falta ref' }, 400);
  const submissionId = 'armador-' + ref;

  if (body.tipo === 'evento') {
    const evento = EVENTOS.has(body.evento) ? body.evento : null;
    if (!evento) return json({ error: 'evento desconocido' }, 400);
    const lead = await env.DB.prepare('SELECT id FROM leads WHERE submission_id = ? LIMIT 1').bind(submissionId).first();
    if (!lead) return json({ ok: true, sin_lead: true });
    await env.DB.prepare(
      "INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, NULL, ?, 'armador', ?)"
    ).bind(lead.id, evento, new Date().toISOString()).run();
    return json({ ok: true });
  }

  if (limpio(body.apellido_2)) return json({ ok: true });   // honeypot

  const c = body.contacto || {}, v = body.viaje || {}, s = body.score || {};
  const nombre = limpio(c.nombre, 120);
  const email = limpio(c.email, 254);
  if (!nombre) return json({ error: 'falta el nombre' }, 400);
  if (!email || !EMAIL.test(email)) return json({ error: 'email invalido' }, 400);
  const ig = limpio(c.ig, 60) ? limpio(c.ig, 60).replace(/^@+/, '').toLowerCase() : null;

  const score = entero(s.score10, 1, 10);
  const tier = TIER[s.categoria] || null;
  const total = entero(s.total, 0, 100);
  const desglose = s.desglose && typeof s.desglose === 'object'
    ? Object.entries(s.desglose).filter(([, n]) => Number.isFinite(n)).map(([k, n]) => `${k} ${n}`).join(' · ') : '';
  const mes = entero(v.mes, 1, 12);
  const viajeros = entero(v.viajeros, 1, 30) ?? 1;
  const dias = entero(v.dias, 1, 60);
  const destinos = (Array.isArray(v.destinos) ? v.destinos : []).map((d) => limpio(d, 60)).filter(Boolean);
  const cuenta = limpio(v.cuenta, 2000);
  const url = limpio(body.itinerario_url, 300);

  const notas = [
    score && tier ? `★ SCORE ${score}/10 · ${tier.etiqueta}` : null,
    body.prueba === true ? 'PRUEBA (armador en modo prueba)' : null,
    'Armador web · armó su itinerario en el quiz',
    url ? `Itinerario: ${url}` : null,
    destinos.length ? `Ruta: ${destinos.join(' → ')}` : null,
    dias ? `Duración: ${dias} días` : null,
    `Viajan ${viajeros}`,
    limpio(v.presupuesto_etiqueta, 60) ? `Presupuesto por persona: ${limpio(v.presupuesto_etiqueta, 60)} (sin vuelos internacionales)` : null,
    limpio(v.ocasion_etiqueta, 60) ? `Ocasión: ${limpio(v.ocasion_etiqueta, 60)}` : null,
    limpio(v.vuelos_etiqueta, 60) ? `Vuelos: ${limpio(v.vuelos_etiqueta, 60)}` : null,
    limpio(v.estilo_etiqueta, 60) ? `Estilo: ${limpio(v.estilo_etiqueta, 60)} · Hotel: ${limpio(v.hotel_etiqueta, 60) || '—'}` : null,
    Number.isFinite(v.precio_desde_usd) ? `Precio desde del itinerario: USD ${Math.round(v.precio_desde_usd)} por persona` : null,
    cuenta ? `Lo que nos contó: ${cuenta}` : 'Lo que nos contó: (no escribió nada)',
    tier ? `Acción sugerida: ${limpio(s.accion, 200) || ''}` : null,
    desglose ? `Desglose (sobre ${total}/100): ${desglose}` : null,
    `Ref: ${submissionId}`,
  ].filter(Boolean).join('\n');

  const referer = limpio(body.referer, 300);
  const datos = {
    nombre, email, ig_username: ig,
    personas: viajeros,
    destinos: destinos.join(', ') || null,
    fecha_viaje: mes ? MESES[mes - 1] : null,
    dias,
    pasajes: limpio(v.vuelos_etiqueta, 60),
    presupuesto_pp: limpio(v.presupuesto_etiqueta, 60),
    notas,
    score,
    score_detalle: score ? `${score}/10 (${total ?? '?'}/100)${desglose ? ' · ' + desglose : ''}` : null,
    calificado: tier ? tier.calificado : null,
    rama: 'sin_itinerario',
    tipo_cotizacion: 'Personalizada',
    duracion_segundos: entero(body.duracion_segundos, 0, 100000),
    utm_source: (limpio(body.utm_source, 120) || canalDesdeReferer(referer) || 'directo').toLowerCase(),
    utm_campaign: limpio(body.utm_campaign, 160),
    meta_json: JSON.stringify({
      formulario: 'armador',
      completo: true,
      itinerario_url: url || undefined,
      dias, mes, viajeros, destinos,
      estilo: limpio(v.estilo, 20) || undefined,
      hotel: limpio(v.hotel, 20) || undefined,
      presupuesto_rango: limpio(v.presupuesto, 20) || undefined,
      ocasion: limpio(v.ocasion, 20) || undefined,
      vuelos: limpio(v.vuelos, 20) || undefined,
      precio_desde_usd: Number.isFinite(v.precio_desde_usd) ? Math.round(v.precio_desde_usd) : undefined,
      cuenta_largo: cuenta ? cuenta.length : 0,
      score: score ? { score10: score, total, categoria: limpio(s.categoria, 20), accion: limpio(s.accion, 200), desglose: s.desglose || undefined } : undefined,
      utm_source: limpio(body.utm_source, 120) || undefined,
      utm_campaign: limpio(body.utm_campaign, 160) || undefined,
      referer: referer || undefined,
      prueba: body.prueba === true || undefined,
    }),
  };
  const now = new Date().toISOString();

  const mismo = await env.DB.prepare('SELECT id FROM leads WHERE submission_id = ? LIMIT 1').bind(submissionId).first();
  if (mismo) {
    const cols = Object.keys(datos).filter((k) => datos[k] !== null && datos[k] !== undefined);
    await env.DB.prepare(`UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
      .bind(...cols.map((k) => datos[k]), now, mismo.id).run();
    return json({ ok: true, crm_id: mismo.id, actualizado: true });
  }
  const cols = Object.keys(datos);
  const res = await env.DB.prepare(
    `INSERT INTO leads (${cols.join(', ')}, submission_id, fuente, etapa, fecha_alta, creado_en, actualizado_en)
     VALUES (${cols.map(() => '?').join(', ')}, ?, ?, 'lead_nuevo', ?, ?, ?)`
  ).bind(...cols.map((k) => datos[k]), submissionId, FUENTE, now, now, now).run();
  return json({ ok: true, crm_id: res.meta.last_row_id }, 201);
}
