// Recibe los eventos de las propuestas publicadas (luna-llena-propuestas.vercel.app/<slug>/), que manda
// _venta/venta.js por el rewrite de Vercel /api/propuesta-evento/. Sin token: es superficie pública como
// /api/evento-web, así que se limita el tamaño, se valida todo y solo se aceptan slugs verificados.
// Guarda slug, evento, detalle, dispositivo y hora. Nada de IP, cookies ni datos de la persona.
//
// Body: { slug, eventos: [{ e: 'apertura'|'seccion'|'cta'|'pdf'|'tiempo', d?: string }] }
// Un body { slug, interno: true } solo registra la propuesta (lo manda la agencia al abrirla con ?preview=1).
import { SLUG, propuestaVerificada, avisar } from '../_lib/propuestas.js';

const EVENTOS = new Set(['apertura', 'seccion', 'cta', 'pdf', 'tiempo']);
const SECCIONES = new Set(['recorrido', 'inversion', 'reserva']);
const DETALLE = /^[a-z0-9-]{1,30}$/;
const MAX = 20;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp\//i;

function dispositivoDesdeUA(ua) {
  if (!ua) return 'desconocido';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'movil';
  return 'desktop';
}

const vacio = () => new Response(null, { status: 204 });

export async function onRequestPost({ request, env, waitUntil }) {
  const ua = request.headers.get('user-agent') || '';
  if (BOT.test(ua)) return vacio();
  const texto = await request.text();
  if (texto.length > 4000) return vacio();
  let body;
  try { body = JSON.parse(texto); } catch { return vacio(); }
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!SLUG.test(slug) || slug.startsWith('_')) return vacio();

  const prop = await propuestaVerificada(env, slug);
  if (!prop || body.interno) return vacio();

  const eventos = (Array.isArray(body.eventos) ? body.eventos : []).slice(0, MAX).map((x) => {
    if (!x || !EVENTOS.has(x.e)) return null;
    let d = typeof x.d === 'string' || typeof x.d === 'number' ? String(x.d) : null;
    if (x.e === 'seccion' && !SECCIONES.has(d)) return null;
    if (x.e === 'tiempo') { const s = Math.round(Number(d)); if (!(s > 0)) return null; d = String(Math.min(s, 4 * 3600)); }
    if (d && !DETALLE.test(d)) d = null;
    return { e: x.e, d };
  }).filter(Boolean);
  if (!eventos.length) return vacio();

  const dispositivo = dispositivoDesdeUA(ua);
  const previa = eventos.some((x) => x.e === 'apertura')
    ? (await env.DB.prepare(`SELECT max(creado_en) AS t FROM propuesta_eventos WHERE slug = ? AND evento = 'apertura'`).bind(slug).first())?.t || null
    : null;
  const ins = env.DB.prepare('INSERT INTO propuesta_eventos (slug, evento, detalle, dispositivo) VALUES (?, ?, ?, ?)');
  await env.DB.batch(eventos.map((x) => ins.bind(slug, x.e, x.d, dispositivo)));

  const p = avisar(env, prop, eventos, dispositivo, previa);
  if (waitUntil) waitUntil(p); else await p;
  return vacio();
}
