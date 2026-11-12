import { rolDe, json } from '../_lib/auth.js';
import { webhookDiscord, mandarDiscord } from '../_lib/propuestas.js';
import { hoyLima, ZONA } from '../_lib/seguimientos.js';
import { listaHoy } from './seguimientos.js';

// Aviso diario de seguimientos: "Hoy: N seguimientos, X calientes, Y atrasados", una vez por día desde las 9:00 (Lima).
// Queda en los avisos del CRM (página Propuestas) y, si hay webhook, también va a Discord.
//
//   POST /api/seguimientos-aviso   header x-aviso-secret = AVISO_SECRET   lo llama el Worker seguimientos-aviso (cron 9:00 Lima)
//   POST /api/seguimientos-aviso   con el token del CRM                    lo llama el panel al abrir el Inbox (por si el cron no corrió)
//
// Es idempotente: si ya se avisó hoy, no hace nada. ?forzar=1 (solo admin) lo manda igual, para probar.

const HORA = 9;
const CRM_URL = (env) => (env.CRM_URL || 'https://crm-plantilla.pages.dev').replace(/\/$/, '');

function horaLima(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', hour12: false }).format(d)) % 24;
}
function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const rol = rolDe(request, env);
  const porCron = Boolean(env.AVISO_SECRET) && iguales(request.headers.get('x-aviso-secret') || '', env.AVISO_SECRET);
  if (!rol && !porCron) return json({ error: 'unauthorized' }, 401);
  const forzar = rol === 'admin' && new URL(request.url).searchParams.get('forzar') === '1';

  const hoy = hoyLima();
  if (!forzar && horaLima() < HORA) return json({ ok: true, enviado: false, motivo: 'antes de las 9 (Lima)' });
  // Reservar el día antes de calcular: si el cron y el panel llegan juntos, avisa uno solo.
  if (!forzar) {
    const r = await env.DB.prepare(`INSERT INTO propuestas_config (clave, valor) VALUES ('aviso_seguimientos_dia', ?)
      ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor WHERE propuestas_config.valor IS NOT excluded.valor`).bind(hoy).run();
    if (!r.meta || !r.meta.changes) return json({ ok: true, enviado: false, motivo: 'ya se avisó hoy' });
  }

  const l = await listaHoy(env, hoy);
  if (!l.total) return json({ ok: true, enviado: false, motivo: 'no hay seguimientos hoy' });

  const partes = [`${l.total} seguimiento${l.total > 1 ? 's' : ''}`];
  if (l.calientes) partes.push(`${l.calientes} caliente${l.calientes > 1 ? 's' : ''} 🔥`);
  if (l.atrasados) partes.push(`${l.atrasados} atrasado${l.atrasados > 1 ? 's' : ''}`);
  const nombres = l.items.slice(0, 8).map((i) => `${i.caliente ? '🔥 ' : ''}${i.nombre || i.cliente} (Día ${i.toque.dia} · ${i.toque.titulo}${i.atraso ? `, atrasado ${i.atraso} d` : ''})`);
  const texto = `Hoy: ${partes.join(', ')}`;
  await env.DB.prepare('INSERT INTO propuesta_alertas (slug, tipo, texto, dispositivo) VALUES (?, ?, ?, ?)')
    .bind('-', 'seguimientos_hoy', `${texto}: ${nombres.join(' · ')}${l.items.length > 8 ? '…' : ''}`, null).run();

  let discord = false;
  const webhook = await webhookDiscord(env);
  if (webhook) {
    const contenido = `**${texto}**\n${nombres.map((n) => '• ' + n).join('\n')}${l.items.length > 8 ? `\n… y ${l.items.length - 8} más` : ''}\n<${CRM_URL(env)}/panel-4c1f6a#/inbox>`;
    try { discord = await mandarDiscord(webhook, contenido); } catch { /* el aviso queda igual en el CRM */ }
  }
  return json({ ok: true, enviado: true, total: l.total, discord });
}
