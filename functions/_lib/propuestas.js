// Seguimiento de las propuestas publicadas: verificación de slugs y avisos por Discord.
// Lo usan /api/propuesta-evento (público) y /api/propuestas-resumen (con token).

export const PROPUESTAS_URL = (env) => (env.PROPUESTAS_URL || 'https://luna-llena-propuestas.vercel.app').replace(/\/$/, '');
export const SLUG = /^[a-z0-9][a-z0-9-]{2,60}$/;

// La primera vez que llega un slug se pide la página publicada: si no existe, se descartan sus eventos.
// De la página salen el número, el cliente y el vencimiento (script#venta-datos y <title>).
export async function propuestaVerificada(env, slug) {
  const ya = await env.DB.prepare('SELECT slug, numero, cliente FROM propuestas WHERE slug = ?').bind(slug).first();
  if (ya) return ya;
  let html;
  try {
    const r = await fetch(`${PROPUESTAS_URL(env)}/${slug}/`, { redirect: 'manual', headers: { 'user-agent': 'crm-luna-llena-verificador' } });
    if (r.status !== 200) return null;
    html = await r.text();
  } catch { return null; }
  const m = html.match(/<script id="venta-datos" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let datos = {};
  try { datos = JSON.parse(m[1]); } catch { return null; }
  if (datos.slug !== slug) return null;
  const cliente = (html.match(/<title>Propuesta para ([^—<]+?)\s+—/) || [])[1] || null;
  const fila = { slug, numero: datos.numero || null, cliente, valid_until: datos.validUntil || null };
  await env.DB.prepare('INSERT OR IGNORE INTO propuestas (slug, numero, cliente, valid_until) VALUES (?, ?, ?, ?)')
    .bind(fila.slug, fila.numero, fila.cliente, fila.valid_until).run();
  return fila;
}

const SEIS_HORAS = 6 * 3600 * 1000;
const horaPeru = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const DISP = { movil: 'teléfono', tablet: 'tablet', desktop: 'computadora', desconocido: 'dispositivo desconocido' };
const CTA = { duda: '"Tengo una duda"', llamada: '"Agendar llamada"', reservar: '"Quiero reservar"', 'ver-reserva': '"Ver cómo reservar"', 'barra-reserva': '"Reservar" (barra de abajo)', vencida: '"Escríbenos para actualizarla" (propuesta vencida)' };

export const WEBHOOK_DISCORD = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// El webhook se carga desde la página Propuestas del CRM (tabla propuestas_config).
// Si no hay, se usa el secret DISCORD_WEBHOOK_URL de Pages. Sin ninguno, los avisos quedan solo en el CRM.
export async function webhookDiscord(env) {
  const fila = await env.DB.prepare(`SELECT valor FROM propuestas_config WHERE clave = 'discord_webhook'`).first();
  return (fila && fila.valor) || env.DISCORD_WEBHOOK_URL || null;
}

export async function mandarDiscord(url, contenido) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: contenido, username: 'Propuestas Luna Llena', allowed_mentions: { parse: [] } }) });
  return r.ok;
}

// Decide qué avisos corresponden a un lote ya guardado (máximo 1 por tipo cada 6 h): siempre quedan en
// propuesta_alertas (se ven en el CRM) y, si hay webhook, también van a Discord.
// `previaApertura` = hora de la apertura anterior a este lote (null si es la primera).
export async function avisar(env, prop, eventos, dispositivo, previaApertura) {
  const quien = `${prop.cliente || prop.slug}${prop.numero ? ` (N° ${prop.numero})` : ''}`;
  const pend = [];
  for (const ev of eventos) {
    if (ev.e === 'apertura') {
      if (!previaApertura) pend.push(['primera_apertura', `${quien} abrió la propuesta por primera vez`]);
      else if (Date.now() - Date.parse(previaApertura + 'Z') > 24 * 3600 * 1000) pend.push(['reapertura', `${quien} volvió a abrir la propuesta (la vez anterior fue el ${previaApertura.slice(8, 10)}/${previaApertura.slice(5, 7)})`]);
    }
    if (ev.e === 'seccion' && ev.d === 'inversion') pend.push(['vio_inversion', `${quien} está viendo la tarifa`]);
    if (ev.e === 'cta') pend.push(['cta', `${quien} hizo clic en ${CTA[ev.d] || `"${ev.d}"`}`]);
  }
  const vistos = new Set();
  let webhook;
  for (const [tipo, texto] of pend) {
    if (vistos.has(tipo)) continue;
    vistos.add(tipo);
    const prev = await env.DB.prepare('SELECT ultimo_en FROM propuesta_avisos WHERE slug = ? AND tipo = ?').bind(prop.slug, tipo).first();
    if (prev && Date.now() - Date.parse(prev.ultimo_en + 'Z') < SEIS_HORAS) continue;
    await env.DB.prepare(`INSERT INTO propuesta_avisos (slug, tipo, ultimo_en) VALUES (?, ?, datetime('now'))
      ON CONFLICT (slug, tipo) DO UPDATE SET ultimo_en = excluded.ultimo_en`).bind(prop.slug, tipo).run();
    await env.DB.prepare('INSERT INTO propuesta_alertas (slug, tipo, texto, dispositivo) VALUES (?, ?, ?, ?)')
      .bind(prop.slug, tipo, texto, dispositivo).run();
    if (webhook === undefined) webhook = await webhookDiscord(env);
    if (!webhook) continue;
    const contenido = `**${texto}** · ${DISP[dispositivo] || dispositivo} · ${horaPeru()} (hora de Perú)\n<${PROPUESTAS_URL(env)}/${prop.slug}/>`;
    try { await mandarDiscord(webhook, contenido); } catch { /* un aviso perdido no debe romper el registro de eventos */ }
  }
}
