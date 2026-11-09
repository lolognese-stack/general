// Formulario "Cuéntanos sobre tu viaje" de la web de Luna Llena
// (lunallenatravel-web/cotizar/, Vercel lo reenvía acá desde /api/cotizar-web/).
//
// Reemplaza al formulario que vivía en luna-llena-viaje.vercel.app (proyecto
// ajeno, mandaba a /api/leads con token). Mismo formato de lead: score de
// calificación (migración 035), notas con el desglose y fuente 'Formulario viaje'.
//
// Como /api/cotizacion-web, NO pide CRM_TOKEN: lo llama el JavaScript del
// sitio. Solo sabe crear o completar un lead y anotar el clic a WhatsApp.
//
// El formulario manda dos veces el mismo submission_id: al pasar el paso del
// WhatsApp (parcial: true, así no se pierde el contacto si abandona) y al
// terminar. La segunda completa el mismo lead.

import { canalDesdeReferer } from '../_lib/canal.js';
import { sincronizarManychat } from '../_lib/manychat.js';
import { enviarAvisoLead } from '../_lib/aviso-lead.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const limpio = (v, max = 500) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const entero = (v, min = 0, max = 999) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const soloFecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const CODIGO = /^LL-\d{6}$/;
const FUENTE = 'Formulario viaje';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const TIER = {
  caliente: { calificado: 'si', etiqueta: 'CALIENTE' },
  tibio: { calificado: 'masomenos', etiqueta: 'TIBIO' },
  frio: { calificado: 'curioso', etiqueta: 'FRÍO' },
};
const RAMA = { itinerario: 'con_itinerario', a_medida: 'sin_itinerario' };

export function onRequest({ request, next }) {
  if (request.method === 'POST') return next();
  return json({ error: 'metodo no permitido' }, 405);
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body invalido' }, 400);
  }

  const submissionId = limpio(body.submission_id, 80);
  if (!submissionId) return json({ error: 'falta submission_id' }, 400);

  if (body.tipo === 'click_whatsapp') return clickWhatsapp(env, submissionId);

  // Honeypot: un bot que completa todo recibe ok y no se guarda nada.
  if (limpio(body.apellido_2)) return json({ ok: true });

  const c = body.contacto || {};
  const v = body.viaje || {};
  const s = body.lead_score || {};
  const nombre = limpio(c.nombre, 120);
  const whatsapp = limpio(c.whatsapp, 40);
  if (!nombre) return json({ error: 'falta el nombre' }, 400);
  if (!whatsapp || (whatsapp.match(/\d/g) || []).length < 8) return json({ error: 'whatsapp invalido' }, 400);

  const tipo = v.tipo === 'itinerario' ? 'itinerario' : 'a_medida';
  const adultos = entero(v.adultos, 1, 30) ?? 1;
  const ninos = entero(v.ninos, 0, 30) ?? 0;
  const llegada = soloFecha(v.fecha_llegada);
  const mes = typeof v.mes_aproximado === 'string' && /^\d{4}-\d{2}$/.test(v.mes_aproximado) ? v.mes_aproximado : null;
  const fechaViaje = llegada
    ? llegada.split('-').reverse().join('/')
    : mes ? `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}` : null;
  const dias = tipo === 'itinerario' ? entero(v.dias_total, 1, 365) : entero(v.dias_min, 1, 90);
  const diasMax = tipo === 'a_medida' ? entero(v.dias_max, 1, 90) : null;
  const pasajes = v.pasajes === 'comprados' ? 'Sí, ya los compré' : v.pasajes === 'pendientes' ? 'Todavía no' : null;
  const presupuesto = v.tiene_presupuesto ? limpio(v.presupuesto_etiqueta, 60) : null;

  const tramos = Array.isArray(v.orden) && v.orden.length ? v.orden : null;
  const destinos = (tramos || (Array.isArray(v.destinos) ? v.destinos : []))
    .map((d) => limpio(d && d.nombre, 60))
    .filter(Boolean);
  const otros = limpio(v.otros_destinos, 300);
  if (otros) destinos.push(...otros.split(',').map((x) => x.trim()).filter(Boolean));
  const destinosUnicos = [...new Set(destinos)];
  const edades = Array.isArray(v.edades) ? v.edades.slice(0, ninos).map((x) => entero(x, 0, 17)).filter((x) => x !== null) : [];

  const score = entero(s.score10, 1, 10);
  const tier = TIER[s.categoria] || null;
  const desglose = s.desglose && typeof s.desglose === 'object'
    ? Object.entries(s.desglose).filter(([, n]) => Number.isFinite(n)).map(([k, n]) => `${k} ${n}`).join(' · ')
    : '';
  const total = entero(s.total, 0, 100);
  const scoreDetalle = score ? `${score}/10 (${total ?? '?'}/100)${desglose ? ' · ' + desglose : ''}` : null;

  const edadTxt = (a) => (a === 0 ? 'menos de 1 año' : `${a} año${a === 1 ? '' : 's'}`);
  const viajan = `${adultos} adulto${adultos > 1 ? 's' : ''}` +
    (ninos ? ` y ${ninos} menor${ninos > 1 ? 'es' : ''}${edades.length ? ` (${edades.map(edadTxt).join(', ')})` : ''}` : '');
  const itinerarioTxt = tipo === 'itinerario' && tramos
    ? tramos.map((t) => `${limpio(t.nombre, 60)} (${t.desde === t.hasta ? `día ${t.desde}` : `días ${t.desde}–${t.hasta}`})`).join(' → ')
    : null;
  const notas = [
    score && tier ? `★ SCORE ${score}/10 · ${tier.etiqueta}` : null,
    body.interno === true ? 'PRUEBA INTERNA (navegador del equipo)' : null,
    tipo === 'itinerario'
      ? 'Formulario web · YA tiene itinerario armado'
      : 'Formulario web · NO tiene itinerario (pide ayuda para armarlo)',
    itinerarioTxt ? `Itinerario: ${itinerarioTxt}` : null,
    limpio(v.nota_orden, 500) ? `Comentario del itinerario: ${limpio(v.nota_orden, 500)}` : null,
    dias ? `Duración: ${dias}${diasMax ? '–' + diasMax : ''} días` : null,
    `Viajan ${viajan}`,
    v.tiene_presupuesto
      ? `Presupuesto por persona: ${presupuesto || 'sí tiene'} (sin vuelos internacionales)`
      : 'Presupuesto: todavía no lo tiene definido',
    limpio(v.notas, 2000) ? `Lo que nos contó: ${limpio(v.notas, 2000)}` : null,
    tier ? `Acción sugerida: ${limpio(s.accion_sugerida, 200) || ''}` : null,
    desglose ? `Desglose (sobre ${total}/100): ${desglose}` : null,
    body.codigo && CODIGO.test(body.codigo) ? `Visita web: ref ${body.codigo}` : null,
    `Ref: ${submissionId}`,
  ].filter(Boolean).join('\n');

  const referer = limpio(body.referer, 300);
  const codigo = CODIGO.test(body.codigo || '') ? body.codigo : null;
  const manychatId = /^\d{1,20}$/.test(body.manychat_id || '') ? body.manychat_id : null;
  // Detrás del rewrite de Vercel, cf.country es el de Vercel: manda el que
  // detecta el formulario (/api/pais de la web).
  const iso = /^[A-Z]{2}$/.test(body.pais_iso || '') ? body.pais_iso : null;
  let pais = null;
  try { pais = iso ? new Intl.DisplayNames(['es'], { type: 'region' }).of(iso) : null; } catch { pais = iso || null; }

  const datos = {
    nombre,
    whatsapp,
    pais,
    personas: adultos + ninos,
    edades_menores: edades.length ? edades.join(', ') : null,
    destinos: destinosUnicos.join(', ') || null,
    fecha_viaje: fechaViaje,
    llegada,
    dias,
    pasajes,
    presupuesto_pp: presupuesto,
    notas,
    score,
    score_detalle: scoreDetalle,
    calificado: tier ? tier.calificado : null,
    rama: RAMA[tipo],
    tipo_cotizacion: 'Personalizada',
    duracion_segundos: entero(body.duracion_segundos, 0, 100000),
    utm_source: (limpio(body.utm_source, 120) || canalDesdeReferer(referer) || 'directo').toLowerCase(),
    utm_campaign: limpio(body.utm_campaign, 160),
    codigo_web: codigo,
    manychat_id: manychatId,
    // Todo lo que respondió, estructurado, para la sección Formulario del panel
    // (functions/api/formulario.js). `completo` distingue el envío final del
    // parcial (el que sale al pasar el paso del WhatsApp).
    meta_json: JSON.stringify({
      formulario: 'cotizar-web',
      parcial: body.parcial === true || undefined,
      completo: body.parcial !== true,
      tipo,
      adultos, ninos, edades,
      dias_total: tipo === 'itinerario' ? dias : undefined,
      dias_min: tipo === 'a_medida' ? dias : undefined,
      dias_max: diasMax || undefined,
      fecha_llegada: llegada || undefined,
      mes_aproximado: mes || undefined,
      destinos: destinosUnicos,
      destinos_ids: (tramos || (Array.isArray(v.destinos) ? v.destinos : [])).map((d) => limpio(d && d.id, 40)).filter(Boolean),
      orden: tramos ? tramos.map((t) => ({ id: limpio(t.id, 40), nombre: limpio(t.nombre, 60), dias: entero(t.dias, 1, 90), desde: entero(t.desde, 1, 365), hasta: entero(t.hasta, 1, 365) })) : undefined,
      nota_orden: limpio(v.nota_orden, 500) || undefined,
      otros_destinos: otros || undefined,
      pasajes: v.pasajes === 'comprados' || v.pasajes === 'pendientes' ? v.pasajes : undefined,
      tiene_presupuesto: v.tiene_presupuesto === true,
      presupuesto_rango: limpio(v.presupuesto_pp_usd, 20) || undefined,
      presupuesto_etiqueta: presupuesto || undefined,
      notas_largo: limpio(v.notas, 2000) ? limpio(v.notas, 2000).length : 0,
      score: score ? { score10: score, total, categoria: limpio(s.categoria, 20), accion: limpio(s.accion_sugerida, 200), desglose: s.desglose && typeof s.desglose === 'object' ? s.desglose : undefined } : undefined,
      duracion_segundos: entero(body.duracion_segundos, 0, 100000) ?? undefined,
      pais_iso: iso || undefined,
      origen: limpio(body.origen, 80) || undefined,
      utm_source: limpio(body.utm_source, 120) || undefined,
      utm_campaign: limpio(body.utm_campaign, 160) || undefined,
      sesion_web: limpio(body.sesion_id, 80) || undefined,
      codigo_web: codigo || undefined,
      referer: referer || undefined,
      interno: body.interno === true || undefined,
    }),
  };
  const now = new Date().toISOString();

  // Mismo envío (parcial y después el final): se completa ese lead.
  const mismo = await env.DB.prepare('SELECT id, meta_json FROM leads WHERE submission_id = ? LIMIT 1').bind(submissionId).first();
  if (mismo) {
    // Un reintento del envío final no vuelve a mandar el mail.
    let yaCompleto = false;
    try { yaCompleto = JSON.parse(mismo.meta_json || '{}').completo === true; } catch {}
    await actualizar(env, mismo.id, datos, now);
    sincronizar(env, manychatId, waitUntil, body.interno === true);
    if (!yaCompleto) avisar(env, mismo.id, waitUntil, body);
    return json({ ok: true, crm_id: mismo.id, actualizado: true });
  }

  // Ya escribió por Instagram o WhatsApp (ManyChat) o cotizó una ficha en
  // esta visita: se completa ese lead en vez de duplicarlo.
  const previo = manychatId
    ? await env.DB.prepare('SELECT id FROM leads WHERE manychat_id = ? ORDER BY id DESC LIMIT 1').bind(manychatId).first()
    : codigo
      ? await env.DB.prepare(`SELECT id FROM leads WHERE codigo_web = ? AND creado_en > datetime('now', '-1 day') LIMIT 1`).bind(codigo).first()
      : null;
  if (previo) {
    await env.DB.prepare(
      `UPDATE leads SET submission_id = coalesce(submission_id, ?),
              notas = coalesce(notas || char(10) || char(10), '') || ?, actualizado_en = ?
        WHERE id = ?`
    ).bind(submissionId, `[${now.slice(0, 10)}] ` + notas, now, previo.id).run();
    const { notas: _n, nombre: _nombre, ...resto } = datos;
    await actualizar(env, previo.id, resto, now);
    sincronizar(env, manychatId, waitUntil, body.interno === true);
    avisar(env, previo.id, waitUntil, body);
    return json({ ok: true, crm_id: previo.id, actualizado: true });
  }

  const cols = Object.keys(datos);
  const res = await env.DB.prepare(
    `INSERT INTO leads (${cols.join(', ')}, submission_id, fuente, etapa, fecha_alta, creado_en, actualizado_en)
     VALUES (${cols.map(() => '?').join(', ')}, ?, ?, 'lead_nuevo', ?, ?, ?)`
  ).bind(...cols.map((k) => datos[k]), submissionId, FUENTE, now, now, now).run();
  sincronizar(env, manychatId, waitUntil, body.interno === true);
  avisar(env, res.meta.last_row_id, waitUntil, body);
  return json({ ok: true, crm_id: res.meta.last_row_id }, 201);
}

// Solo pisa con valores no vacíos: el envío final no borra lo del parcial.
async function actualizar(env, id, datos, now) {
  const cols = Object.keys(datos).filter((k) => datos[k] !== null && datos[k] !== undefined);
  if (!cols.length) return;
  await env.DB.prepare(`UPDATE leads SET ${cols.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
    .bind(...cols.map((k) => datos[k]), now, id).run();
}

async function clickWhatsapp(env, submissionId) {
  const lead = await env.DB.prepare('SELECT id FROM leads WHERE submission_id = ? LIMIT 1').bind(submissionId).first();
  if (!lead) return json({ ok: true, sin_lead: true });
  await env.DB.prepare(
    "INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, NULL, 'click_whatsapp', 'formulario-viaje', ?)"
  ).bind(lead.id, new Date().toISOString()).run();
  return json({ ok: true });
}

// Mail con los datos y el botón de WhatsApp cuando entra un formulario completo
// (no el parcial ni las pruebas del equipo). Si Resend no está configurado, no pasa nada.
function avisar(env, leadId, waitUntil, body) {
  if (body.parcial === true || body.interno === true || !env.RESEND_API_KEY) return;
  const p = (async () => {
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
    if (lead) await enviarAvisoLead(env, lead);
  })().catch(() => {});
  if (waitUntil) waitUntil(p);
}

function sincronizar(env, manychatId, waitUntil, interno) {
  if (!manychatId || interno || !env.MANYCHAT_TOKEN) return;
  const p = sincronizarManychat(env, manychatId);
  if (waitUntil) waitUntil(p);
}
