// Armador de itinerario de la web de Luna Llena (lunallenatravel-web/armar/, Vercel lo reenvía acá desde /api/armar-web/).
//
// Público, sin token (como /api/cotizar-web). NUNCA devuelve precios: el armado sale de _lib/armado-publico.js por lista
// blanca. El score lo calcula solo el servidor (_lib/score-armador.js); al navegador le llega el tier.
//
// GET  ?accion=opciones                         destinos, paquetes y actividades por ciudad (para el editor)
// POST { accion: 'armar', destinos, dias, ritmo, desde }        base sin guardar
// POST { accion: 'validar', dias:[...] }                         rehace los días editados y devuelve avisos
// POST { accion: 'score', viaje }                               { tier, extra } (¿hacer las 2 preguntas extra?)
// POST { accion: 'contacto', submission_id, contacto, viaje, itinerario, ... }   crea/actualiza el lead + guarda (slug)
// POST { accion: 'enviar', submission_id, slug, dias, comentario }               guarda lo editado + score final
// POST { accion: 'click_whatsapp', slug }

import { indexarReglas } from '../_lib/ct-armado.js';
import { cargarWeb } from '../_lib/ct-cotizaciones.js';
import {
  armarBase, componer, candidatosPublicos, indiceCandidatos, destinosDisponibles, leerDestinos, leerSeq, hidratarPaquetes,
  paquetesPublicos, itinerarioLead, excursionesDe, RITMOS,
} from '../_lib/armado-publico.js';
import { scoreArmador, pideExtra, RANGOS_PRESUPUESTO, RESERVA } from '../_lib/score-armador.js';
import { guardarLeadWeb, actualizarLead } from '../_lib/lead-web.js';
import { canalDesdeReferer } from '../_lib/canal.js';
import { sincronizarManychat } from '../_lib/manychat.js';

const FUENTE = 'Armador web';
const CODIGO = /^LL-\d{6}$/;
const MAX_ALTAS_HORA = 8;
const TIER = { caliente: { calificado: 'si', etiqueta: 'CALIENTE' }, tibio: { calificado: 'masomenos', etiqueta: 'TIBIO' }, frio: { calificado: 'curioso', etiqueta: 'FRÍO' } };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const HOTEL = { economico: 'Económico', confort: 'Confort', superior: 'Superior' };
const RITMO_TXT = { tranquilo: 'Tranquilo', equilibrado: 'Equilibrado', a_full: 'A full' };
// Mails de un solo uso o de prueba: no sirven para seguir al cliente.
const DESCARTABLES = /@(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop|throwawaymail|fakeinbox|mintemail|emailondeck|moakt|mohmal|tempr|discard|spamgourmet|mailnesia|burnermail|1secmail|minuteinbox)\./i;
const MAIL_PRUEBA = /^(test|prueba|asd|asdf|qwe|qwerty|aaa+|xxx+|no|nada|ninguno|fake|correo|email|mail)\d*@|@(test|prueba|example|ejemplo|correo|email|mail)\.(com|net|org)$/i;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
}
const limpio = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const entero = (v, min = 0, max = 999) => { const n = typeof v === 'number' ? v : parseInt(v, 10); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

// Web + reglas: se leen de D1 a lo sumo cada 10 minutos por instancia (cada consulta del editor sería ~200 filas).
let cache = { t: 0, data: null };
async function datos(env) {
  if (cache.data && Date.now() - cache.t < 600e3) return cache.data;
  const [web, reglasFilas] = await Promise.all([cargarWeb(env), env.DB.prepare('SELECT * FROM ct_reglas').all()]);
  const reglas = indexarReglas(reglasFilas.results || []);
  const porCiudad = candidatosPublicos(web);
  cache = { t: Date.now(), data: { web, reglas, porCiudad, idx: indiceCandidatos(porCiudad) } };
  return cache.data;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('accion') !== 'opciones') return json({ error: 'accion desconocida' }, 400);
  const d = await datos(env);
  const actividades = {};
  for (const [k, lista] of d.porCiudad) actividades[k] = lista.map((c) => ({ clave: c.clave, ciudad: c.ciudad, nombre: c.nombre, dias: c.dias, resumen: c.resumen, foto: c.foto, url: c.url }));
  return json({
    destinos: destinosDisponibles(d.porCiudad), paquetes: paquetesPublicos(d.web), actividades,
    rangos: RANGOS_PRESUPUESTO.map(({ valor, etiqueta }) => ({ valor, etiqueta })), reserva: RESERVA.map(({ valor, etiqueta }) => ({ valor, etiqueta })),
  }, 200, { 'cache-control': 'public, max-age=300' });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body invalido' }, 400); }
  try {
    switch (body.accion) {
      case 'armar': return await armar(env, body);
      case 'validar': return await validar(env, body);
      case 'score': return json({ tier: scoreArmador(leerViaje(body.viaje)).tier, extra: pideExtra(leerViaje(body.viaje)) });
      case 'contacto': return await contacto(ctx, body);
      case 'enviar': return await enviar(ctx, body);
      case 'click_whatsapp': return await clickWhatsapp(env, body);
      default: return json({ error: 'accion desconocida' }, 400);
    }
  } catch (e) {
    return json({ error: 'error interno', detalle: String(e.message || e).slice(0, 120) }, 500);
  }
}

async function armar(env, body) {
  const d = await datos(env);
  const destinos = leerDestinos(body.destinos);
  const ritmo = RITMOS.includes(body.ritmo) ? body.ritmo : 'equilibrado';
  const desde = typeof body.desde === 'string' ? body.desde.slice(0, 80) : null;
  if (!destinos.length && !desde) return json({ error: 'elige al menos un destino' }, 400);
  return json(armarBase({ destinos, dias: entero(body.dias, 1, 40), ritmo, desde, web: d.web, reglas: d.reglas }));
}

async function validar(env, body) {
  const d = await datos(env);
  const seq = hidratarPaquetes(leerSeq(body.dias), d.web);
  if (!seq.length) return json({ error: 'sin días' }, 400);
  return json(componer(seq, { idx: d.idx, reglas: d.reglas, porCiudad: d.porCiudad }));
}

// Respuestas del visitante, solo campos conocidos.
function leerViaje(v = {}) {
  const fecha_tipo = ['exacta', 'mes', 'nose'].includes(v.fecha_tipo) ? v.fecha_tipo : 'nose';
  const fecha = fecha_tipo === 'exacta' && /^\d{4}-\d{2}-\d{2}$/.test(v.fecha || '') ? v.fecha : fecha_tipo === 'mes' && /^\d{4}-\d{2}$/.test(v.fecha || '') ? v.fecha : null;
  const ninos = entero(v.ninos, 0, 30) ?? 0;
  return {
    fecha_tipo: fecha ? fecha_tipo : 'nose', fecha,
    pasajes: v.pasajes === 'comprados' || v.pasajes === 'pendientes' ? v.pasajes : null,
    adultos: entero(v.adultos, 1, 30) ?? 1, ninos,
    edades: Array.isArray(v.edades) ? v.edades.slice(0, ninos).map((x) => entero(x, 0, 17)).filter((x) => x !== null) : [],
    tiene_presupuesto: v.tiene_presupuesto === true,
    presupuesto_rango: RANGOS_PRESUPUESTO.some((r) => r.valor === v.presupuesto_rango) ? v.presupuesto_rango : null,
    reserva: RESERVA.some((r) => r.valor === v.reserva) ? v.reserva : null,
    dias: entero(v.dias, 1, 60), destinos: entero(v.destinos, 0, 20),
    ritmo: RITMOS.includes(v.ritmo) ? v.ritmo : null,
    categoria_hotel: HOTEL[v.categoria_hotel] ? v.categoria_hotel : null,
    comentario: limpio(v.comentario, 1500),
  };
}

function mailValido(m) {
  return /^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(m) && !DESCARTABLES.test(m) && !MAIL_PRUEBA.test(m);
}

async function ipHash(request, env) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('cf-connecting-ip') || '';
  if (!ip) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${env.CRM_TOKEN || 'luna'}`));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nuevoSlug() {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(14))].map((b) => a[b % a.length]).join('');
}

const fechaTexto = (v) => (v.fecha_tipo === 'exacta' ? v.fecha.split('-').reverse().join('/') : v.fecha_tipo === 'mes' ? `${MESES[Number(v.fecha.slice(5)) - 1]} ${v.fecha.slice(0, 4)}` : null);

// Lo que va al lead (mismas columnas que /api/cotizar-web) + itinerario en el formato de la ficha (migración 048).
function datosLead({ body, v, sc, dias, avisos, slug, contacto, pais, final }) {
  const tier = TIER[sc.tier];
  const ciudades = [...new Set(dias.map((x) => x.ciudad))];
  const rango = RANGOS_PRESUPUESTO.find((r) => r.valor === v.presupuesto_rango);
  const res = RESERVA.find((r) => r.valor === v.reserva);
  const viajan = `${v.adultos} adulto${v.adultos > 1 ? 's' : ''}${v.ninos ? ` y ${v.ninos} menor${v.ninos > 1 ? 'es' : ''}${v.edades.length ? ` (${v.edades.join(', ')} años)` : ''}` : ''}`;
  const desglose = Object.entries(sc.desglose).map(([k, n]) => `${k} ${n}`).join(' · ');
  const notas = [
    `★ SCORE ${sc.score10}/10 · ${tier.etiqueta}`,
    body.interno === true ? 'PRUEBA INTERNA (navegador del equipo)' : null,
    `Armador web · ${final ? 'armó y envió su itinerario' : 'dejó sus datos para ver la base (todavía no envió)'}`,
    `Itinerario: ${dias.length} días · ${ciudades.join(' → ')} · https://lunallenatravel.vercel.app/i/${slug}/`,
    v.ritmo ? `Ritmo: ${RITMO_TXT[v.ritmo]}` : null,
    v.categoria_hotel ? `Hotel: ${HOTEL[v.categoria_hotel]}` : null,
    `Viajan ${viajan}`,
    fechaTexto(v) ? `Fecha: ${fechaTexto(v)}` : 'Fecha: todavía no sabe',
    v.pasajes ? `Pasajes internacionales: ${v.pasajes === 'comprados' ? 'ya comprados' : 'todavía no'}` : null,
    rango ? `Presupuesto por persona: ${rango.etiqueta} (sin vuelos internacionales)` : 'Presupuesto: no lo tiene definido',
    res ? `Pensaba reservar: ${res.etiqueta}` : null,
    v.comentario ? `Comentario: ${v.comentario}` : null,
    avisos.length ? `Avisos del armador (no bloquean): ${avisos.map((a) => a.texto).join(' / ')}` : null,
    `Acción sugerida: ${sc.accion}`,
    `Desglose (sobre ${sc.total}): ${desglose}`,
    body.codigo && CODIGO.test(body.codigo) ? `Visita web: ref ${body.codigo}` : null,
  ].filter(Boolean).join('\n');
  const referer = limpio(body.referer, 300);
  return {
    nombre: contacto.nombre, whatsapp: contacto.whatsapp, email: contacto.email, pais,
    personas: v.adultos + v.ninos, edades_menores: v.edades.length ? v.edades.join(', ') : null,
    destinos: ciudades.join(', '), fecha_viaje: fechaTexto(v), llegada: v.fecha_tipo === 'exacta' ? v.fecha : null, dias: dias.length,
    pasajes: v.pasajes === 'comprados' ? 'Sí, ya los compré' : v.pasajes === 'pendientes' ? 'Todavía no' : null,
    presupuesto_pp: rango ? rango.etiqueta : null, categoria_hotel: v.categoria_hotel ? HOTEL[v.categoria_hotel] : null,
    notas, score: sc.score10, score_detalle: `${sc.score10}/10 (${sc.total}) · ${desglose}`, calificado: tier.calificado,
    rama: 'armador', tipo_cotizacion: 'Itinerario web',
    itinerario: JSON.stringify(itinerarioLead(dias, v.fecha_tipo === 'exacta' ? v.fecha : null)),
    utm_source: (limpio(body.utm_source, 120) || canalDesdeReferer(referer) || 'directo').toLowerCase(),
    utm_campaign: limpio(body.utm_campaign, 160),
    codigo_web: CODIGO.test(body.codigo || '') ? body.codigo : null,
    manychat_id: /^\d{1,20}$/.test(body.manychat_id || '') ? body.manychat_id : null,
    meta_json: JSON.stringify({
      formulario: 'armador', parcial: !final || undefined, completo: final,
      ...v, itinerario_url: `https://lunallenatravel.vercel.app/i/${slug}/`, excursiones: excursionesDe(dias),
      score: { score10: sc.score10, total: sc.total, categoria: sc.tier, accion: sc.accion, desglose: sc.desglose },
      pais_iso: limpio(contacto.pais_iso, 2) || undefined, sesion_web: limpio(body.sesion_id, 80) || undefined, referer: referer || undefined,
      interno: body.interno === true || undefined,
    }),
  };
}

async function contacto({ request, env, waitUntil }, body) {
  const submissionId = limpio(body.submission_id, 80);
  if (!submissionId) return json({ error: 'falta submission_id' }, 400);
  if (limpio(body.apellido_2)) return json({ ok: true, slug: null, tier: 'frio' });   // honeypot
  const c = body.contacto || {};
  const nombre = limpio(c.nombre, 120), email = limpio(c.email, 160)?.toLowerCase() || null, whatsapp = limpio(c.whatsapp, 40);
  if (!nombre || nombre.length < 2) return json({ error: 'Escribe tu nombre.' }, 400);
  if (!email || !mailValido(email)) return json({ error: 'Revisa tu correo: necesitamos uno real para enviarte el itinerario.' }, 400);
  const dig = (whatsapp || '').replace(/\D/g, '');
  if (dig.length < 8 || dig.length > 15) return json({ error: 'Revisa tu WhatsApp (con código de país).' }, 400);

  const d = await datos(env);
  const seq = hidratarPaquetes(leerSeq(body.dias), d.web);
  if (!seq.length) return json({ error: 'sin itinerario' }, 400);
  const it = componer(seq, { idx: d.idx, reglas: d.reglas, porCiudad: d.porCiudad });
  const v = leerViaje({ ...body.viaje, dias: it.dias.length, destinos: it.resumen.ciudades.length });
  const sc = scoreArmador(v);
  const iso = /^[A-Z]{2}$/.test(c.pais_iso || '') ? c.pais_iso : null;
  let pais = null;
  try { pais = iso ? new Intl.DisplayNames(['es'], { type: 'region' }).of(iso) : null; } catch { pais = iso; }
  const contactoOk = { nombre, email, whatsapp: `+${dig}`, pais_iso: iso };

  const ya = await env.DB.prepare('SELECT id, slug FROM web_itinerarios WHERE submission_id = ?').bind(submissionId).first();
  const hash = await ipHash(request, env);
  if (!ya && hash && body.interno !== true) {
    const n = await env.DB.prepare(`SELECT count(*) n FROM web_itinerarios WHERE ip_hash = ? AND creado_en > datetime('now', '-1 hour')`).bind(hash).first();
    if ((n?.n || 0) >= MAX_ALTAS_HORA) return json({ error: 'Recibimos muchos itinerarios desde tu conexión. Escríbenos por WhatsApp.' }, 429);
  }
  const slug = ya ? ya.slug : nuevoSlug();
  const now = new Date().toISOString();
  const lead = datosLead({ body, v, sc, dias: it.dias, avisos: it.avisos, slug, contacto: contactoOk, pais, final: false });
  const manychatId = lead.manychat_id, codigo = lead.codigo_web;
  const r = await guardarLeadWeb(env, { submissionId, datos: lead, manychatId, codigo, fuente: FUENTE, now });
  const titulo = limpio(body.titulo, 160);
  const desde = typeof body.desde === 'string' ? body.desde.slice(0, 80) : null;
  if (ya) {
    await env.DB.prepare(`UPDATE web_itinerarios SET lead_id = ?, viaje_json = ?, dias_json = ?, avisos_json = ?, score = ?, tier = ?, actualizado_en = datetime('now') WHERE id = ?`)
      .bind(r.id, JSON.stringify(v), JSON.stringify(it.dias), JSON.stringify(it.avisos), sc.score10, sc.tier, ya.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO web_itinerarios (slug, submission_id, lead_id, codigo_web, ip_hash, titulo, desde_paquete, ritmo, categoria_hotel, viaje_json, base_json, dias_json, avisos_json, score, tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(slug, submissionId, r.id, codigo, hash, titulo, desde, v.ritmo, v.categoria_hotel, JSON.stringify(v), JSON.stringify(it.dias), JSON.stringify(it.dias), JSON.stringify(it.avisos), sc.score10, sc.tier).run();
  }
  if (manychatId && body.interno !== true && env.MANYCHAT_TOKEN && waitUntil) waitUntil(sincronizarManychat(env, manychatId));
  return json({ ok: true, slug, tier: sc.tier, ...it });
}

async function enviar({ env }, body) {
  const submissionId = limpio(body.submission_id, 80);
  const fila = submissionId ? await env.DB.prepare('SELECT * FROM web_itinerarios WHERE submission_id = ?').bind(submissionId).first() : null;
  if (!fila) return json({ error: 'no encontramos tu itinerario: vuelve a dejar tus datos' }, 404);
  const d = await datos(env);
  const seq = hidratarPaquetes(leerSeq(body.dias), d.web);
  if (!seq.length) return json({ error: 'sin itinerario' }, 400);
  const it = componer(seq, { idx: d.idx, reglas: d.reglas, porCiudad: d.porCiudad });
  let viaje = {};
  try { viaje = JSON.parse(fila.viaje_json || '{}'); } catch {}
  const v = leerViaje({ ...viaje, comentario: body.comentario, dias: it.dias.length, destinos: it.resumen.ciudades.length });
  const sc = scoreArmador(v);
  await env.DB.prepare(`UPDATE web_itinerarios SET dias_json = ?, avisos_json = ?, comentario = ?, viaje_json = ?, score = ?, tier = ?, enviado_en = coalesce(enviado_en, datetime('now')), actualizado_en = datetime('now') WHERE id = ?`)
    .bind(JSON.stringify(it.dias), JSON.stringify(it.avisos), v.comentario, JSON.stringify(v), sc.score10, sc.tier, fila.id).run();
  if (fila.lead_id) {
    const l = await env.DB.prepare('SELECT nombre, email, whatsapp, pais, meta_json FROM leads WHERE id = ?').bind(fila.lead_id).first();
    let meta = {};
    try { meta = JSON.parse(l?.meta_json || '{}'); } catch {}
    const contacto = { nombre: l?.nombre, email: l?.email, whatsapp: l?.whatsapp, pais_iso: meta.pais_iso };
    const datosNuevos = datosLead({ body: { ...body, codigo: fila.codigo_web, interno: meta.interno, sesion_id: meta.sesion_web, referer: meta.referer }, v, sc, dias: it.dias, avisos: it.avisos, slug: fila.slug, contacto, pais: l?.pais, final: true });
    // utm y códigos ya quedaron en el alta: no se pisan con vacíos.
    const { utm_source: _u, utm_campaign: _c, codigo_web: _w, manychat_id: _m, nombre: _n, email: _e, whatsapp: _wa, pais: _p, ...resto } = datosNuevos;
    await actualizarLead(env, fila.lead_id, resto);
  }
  return json({ ok: true, slug: fila.slug, tier: sc.tier, ...it });
}

async function clickWhatsapp(env, body) {
  const slug = limpio(body.slug, 40);
  const fila = slug ? await env.DB.prepare('SELECT id, lead_id FROM web_itinerarios WHERE slug = ?').bind(slug).first() : null;
  if (!fila) return json({ ok: true, sin_itinerario: true });
  await env.DB.prepare(`UPDATE web_itinerarios SET wa_click_en = coalesce(wa_click_en, datetime('now')) WHERE id = ?`).bind(fila.id).run();
  if (fila.lead_id) {
    await env.DB.prepare("INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, NULL, 'click_whatsapp', 'armador-web', ?)")
      .bind(fila.lead_id, new Date().toISOString()).run();
  }
  return json({ ok: true });
}
