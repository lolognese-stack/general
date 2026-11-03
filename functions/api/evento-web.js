// Recibe los eventos de uso de la web de Luna Llena que manda assets/ll-t.js
// y los guarda: `eventos_web` crudo + `sesiones_web` resumida (migración 037).
// Port de visite-web/functions/api/evento-web.js.
//
// Llega en lotes (cada pocos segundos, y el último con sendBeacon al cerrar)
// por el rewrite de Vercel (lunallenatravel.vercel.app/api/evento-web).
// Sin token: es superficie pública como /api/lead-web, así que se limita el
// tamaño, se valida todo contra TIPOS y nada de acá toca `leads` ni manda mails.

import { canalDesdeReferer } from '../_lib/canal.js';
import { sincronizarManychat } from '../_lib/manychat.js';

// Tiene que coincidir con EV en assets/ll-t.js de la web.
const TIPOS = new Set([
  'page_view',        // {titulo, paquete?, nombre?}
  'scroll',           // {pct: 25|50|75|100}
  'click_whatsapp',   // {ubicacion, texto, codigo}
  'click_cta',        // {ubicacion, texto, destino?}
  'salida',           // {destino, ubicacion} link a otro dominio
  'cotizar_abierto',  // {paquete}
  'lead_enviado',     // {paquete, codigo}
  'vitals',           // {lcp, cls, inp, ttfb}
  'error_js',         // {mensaje, origen, linea}
]);

const MAX_EVENTOS_POR_LOTE = 40;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp\//i;
const CODIGO = /^LL-\d{6}$/;

const texto = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const entero = (v, max = 100_000_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null;
};

const NOMBRES_REGION = (() => {
  try { return new Intl.DisplayNames(['es'], { type: 'region' }); } catch { return null; }
})();

// Detrás de Vercel (rewrite de /api/*), `cf.country` es el país del servidor
// de Vercel, no el de la persona. En la práctica el rewrite no pasa
// x-vercel-ip-country, así que el respaldo es la zona horaria del navegador.
function paisDesdeRequest(request) {
  const viaVercel = request.headers.has('x-vercel-id') || request.headers.has('x-vercel-ip-country');
  const codigo = viaVercel
    ? request.headers.get('x-vercel-ip-country')
    : request.cf?.country ?? request.headers.get('cf-ipcountry');
  if (!codigo || codigo === 'XX' || codigo === 'T1') return null;
  try { return NOMBRES_REGION?.of(codigo) ?? codigo; } catch { return codigo; }
}

const PAIS_POR_ZONA = {
  'America/Lima': 'PE', 'America/Argentina': 'AR', 'America/Buenos_Aires': 'AR', 'America/Cordoba': 'AR',
  'America/Mendoza': 'AR', 'America/Montevideo': 'UY', 'America/Santiago': 'CL', 'America/Asuncion': 'PY',
  'America/La_Paz': 'BO', 'America/Bogota': 'CO', 'America/Caracas': 'VE', 'America/Guayaquil': 'EC',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Cancun': 'MX', 'America/Merida': 'MX',
  'America/Tijuana': 'MX', 'America/Chihuahua': 'MX', 'America/Hermosillo': 'MX', 'America/Mazatlan': 'MX',
  'America/Guatemala': 'GT', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI',
  'America/Costa_Rica': 'CR', 'America/Panama': 'PA', 'America/Havana': 'CU', 'America/Santo_Domingo': 'DO',
  'America/Puerto_Rico': 'PR', 'America/Sao_Paulo': 'BR', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES',
  'Africa/Ceuta': 'ES', 'Europe/Lisbon': 'PT', 'Europe/Paris': 'FR', 'Europe/Rome': 'IT', 'Europe/Berlin': 'DE',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/London': 'GB',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Phoenix': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'Australia/Sydney': 'AU',
};
function paisDesdeZona(zona) {
  if (!zona) return null;
  const codigo = PAIS_POR_ZONA[zona] || (zona.startsWith('America/Argentina/') ? 'AR' : null);
  if (!codigo) return null;
  try { return NOMBRES_REGION?.of(codigo) ?? codigo; } catch { return codigo; }
}

function dispositivoDesdeUA(ua) {
  if (!ua) return 'desconocido';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'movil';
  return 'desktop';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function onRequest({ request, next }) {
  if (request.method === 'POST') return next();
  return json({ error: 'metodo no permitido' }, 405);
}

export async function onRequestPost({ request, env, waitUntil }) {
  const ua = request.headers.get('user-agent');
  if (!ua || BOT.test(ua)) return new Response(null, { status: 204 });

  let body;
  try {
    // sendBeacon manda text/plain; request.json() no mira el content-type.
    body = await request.json();
  } catch {
    return json({ error: 'body invalido' }, 400);
  }

  const sesionId = texto(body.sesion_id, 80);
  if (!sesionId || !/^[\w-]+$/.test(sesionId)) return json({ error: 'sesion invalida' }, 400);

  const crudos = Array.isArray(body.eventos) ? body.eventos.slice(0, MAX_EVENTOS_POR_LOTE) : [];
  const filas = crudos
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      tipo: texto(e.tipo, 40),
      ruta: texto(e.ruta, 200),
      t_ms: entero(e.t_ms),
      datos: e.datos && typeof e.datos === 'object' ? e.datos : null,
    }))
    .filter((e) => e.tipo && TIPOS.has(e.tipo));
  if (filas.length === 0) return json({ error: 'sin eventos validos' }, 400);

  const c = body.contexto && typeof body.contexto === 'object' ? body.contexto : {};
  const ahora = new Date().toISOString();
  const referrer = texto(c.referrer, 300);
  const utmSource = texto(c.utm_source, 120);
  const canal = (utmSource || canalDesdeReferer(referrer) || 'directo').toLowerCase();
  const codigo = CODIGO.test(c.codigo || '') ? c.codigo : null;
  const manychatId = /^\d{1,20}$/.test(c.manychat_id || '') ? c.manychat_id : null;

  const inserts = filas.map((f) =>
    env.DB.prepare(
      `INSERT INTO eventos_web (sesion_id, tipo, ruta, datos_json, t_ms, creado_en) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sesionId, f.tipo, f.ruta, f.datos ? JSON.stringify(f.datos).slice(0, 1000) : null, f.t_ms, ahora)
  );

  const cuenta = (tipo) => filas.filter((f) => f.tipo === tipo).length;
  const maxDe = (tipo, campo) =>
    Math.max(0, ...filas.filter((f) => f.tipo === tipo).map((f) => entero(f.datos?.[campo], 100) ?? 0));
  const vistasPaquete = filas.filter((f) => f.tipo === 'page_view' && f.datos?.paquete).length;
  const duracion = Math.max(0, ...filas.map((f) => f.t_ms ?? 0));

  // Resumen de la sesión. Los datos de entrada (landing, canal, utm...) solo
  // se fijan en el primer lote: los siguientes suman contadores.
  const resumen = env.DB.prepare(
    `INSERT INTO sesiones_web
       (sesion_id, codigo, manychat_id, visitante_id, host, landing, referrer, utm_source, utm_medium, utm_campaign, utm_content,
        canal, dispositivo, pais, idioma, interno, primer_evento, ultimo_evento, duracion_ms,
        paginas, vistas_paquete, max_scroll, clicks_whatsapp, clicks_cta, cotizar_abierto, leads, errores_js)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sesion_id) DO UPDATE SET
       codigo          = coalesce(codigo, excluded.codigo),
       manychat_id     = coalesce(excluded.manychat_id, manychat_id),
       ultimo_evento   = excluded.ultimo_evento,
       duracion_ms     = max(duracion_ms, excluded.duracion_ms),
       interno         = max(interno, excluded.interno),
       paginas         = paginas + excluded.paginas,
       vistas_paquete  = vistas_paquete + excluded.vistas_paquete,
       max_scroll      = max(max_scroll, excluded.max_scroll),
       clicks_whatsapp = clicks_whatsapp + excluded.clicks_whatsapp,
       clicks_cta      = clicks_cta + excluded.clicks_cta,
       cotizar_abierto = cotizar_abierto + excluded.cotizar_abierto,
       leads           = leads + excluded.leads,
       errores_js      = errores_js + excluded.errores_js`
  ).bind(
    sesionId,
    codigo,
    manychatId,
    texto(c.visitante_id, 80),
    texto(c.host, 80),
    texto(c.landing, 200),
    referrer,
    utmSource && utmSource.toLowerCase(),
    texto(c.utm_medium, 120),
    texto(c.utm_campaign, 160),
    texto(c.utm_content, 160),
    canal.slice(0, 120),
    dispositivoDesdeUA(ua),
    paisDesdeRequest(request) || paisDesdeZona(texto(c.zona, 60)),
    texto(c.idioma, 20),
    c.interno === true ? 1 : 0,
    ahora,
    ahora,
    duracion,
    cuenta('page_view'),
    vistasPaquete,
    maxDe('scroll', 'pct'),
    cuenta('click_whatsapp'),
    cuenta('click_cta'),
    cuenta('cotizar_abierto'),
    cuenta('lead_enviado'),
    cuenta('error_js')
  );

  await env.DB.batch([...inserts, resumen]);
  // Tags y campos en ManyChat, sin demorar la respuesta. Solo eventos que cambian algo.
  const importa = filas.some((f) => ['page_view', 'cotizar_abierto', 'lead_enviado'].includes(f.tipo));
  if (manychatId && c.interno !== true && importa && env.MANYCHAT_TOKEN) {
    const p = sincronizarManychat(env, manychatId);
    if (waitUntil) waitUntil(p); else await p;
  }
  return json({ ok: true, n: filas.length });
}
