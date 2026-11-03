// POST /api/evento-form/ — avance paso a paso del formulario de la web
// (lunallenatravel.vercel.app/cotizar/; Vercel lo reenvía acá). Sin token,
// como /api/evento-web: lo llama el JavaScript del sitio, y solo escribe
// sesiones_form y eventos_form (migración 032). Nunca toca leads.
//
// Cuerpo: { sesion_id, formulario: 'cotizar-web', ctx: {...}, eventos: [...] }
//   ctx:     dispositivo, pais, origen, utm_source, utm_campaign, manychat_id,
//            referer, restaurado, pasos_total, rama, interno
//   eventos: [{ tipo, paso, indice, t_ms, dur_ms, datos, cliente_en }]
//   tipo:    abierto | paso_visto | paso_completado | paso_atras |
//            error_validacion | salida | enviado | click_whatsapp
// `datos` lleva solo respuestas sin datos personales (del nombre y el
// WhatsApp, solo el largo): lo completo llega con el lead (/api/cotizar-web).
// Las sesiones del equipo (interno) no se guardan.

const TIPOS = new Set(['abierto', 'paso_visto', 'paso_completado', 'paso_atras', 'error_validacion', 'salida', 'enviado', 'click_whatsapp']);
const FORMULARIOS = new Set(['cotizar-web', 'personalizado', 'paquete']);
const MAX_EVENTOS = 40;
const RE_SESION = /^[A-Za-z0-9_-]{8,80}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
const txt = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const ent = (v, min = 0, max = 1e9) => { const n = typeof v === 'number' ? v : parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null; };

export function onRequest({ request, next }) {
  if (request.method === 'POST') return next();
  return json({ error: 'metodo no permitido' }, 405);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: 'body invalido' }, 400); }
  const sesion = txt(body.sesion_id, 80);
  if (!sesion || !RE_SESION.test(sesion)) return json({ error: 'sesion_id invalido' }, 400);
  const formulario = FORMULARIOS.has(body.formulario) ? body.formulario : 'cotizar-web';
  const ctx = body.ctx && typeof body.ctx === 'object' ? body.ctx : {};
  if (ctx.interno === true) return json({ ok: true, interno: true });
  if (!Array.isArray(body.eventos) || !body.eventos.length) return json({ error: 'eventos vacio' }, 400);

  const ahora = new Date().toISOString();
  const evs = body.eventos.slice(0, MAX_EVENTOS)
    .filter((e) => e && TIPOS.has(e.tipo))
    .map((e) => {
      let datos = null;
      if (e.datos && typeof e.datos === 'object') { const s = JSON.stringify(e.datos); if (s.length <= 2000) datos = s; }
      return { tipo: e.tipo, paso: txt(e.paso, 40), indice: ent(e.indice, 0, 100), t_ms: ent(e.t_ms, 0, 864e5),
        dur_ms: ent(e.dur_ms, 0, 864e5), datos, cliente_en: txt(e.cliente_en, 40) };
    });
  if (!evs.length) return json({ error: 'ningun evento valido' }, 400);

  const db = env.DB;
  const pais = (txt(ctx.pais, 2) || request.headers.get('cf-ipcountry') || '').toUpperCase().slice(0, 2) || null;
  const disp = ['movil', 'tablet', 'desktop'].includes(ctx.dispositivo) ? ctx.dispositivo : null;
  const manychat = /^\d{1,20}$/.test(ctx.manychat_id || '') ? ctx.manychat_id : null;
  const stmts = [db.prepare(
    `INSERT INTO sesiones_form (sesion_id, formulario, rama, dispositivo, pais, origen, utm_source, utm_campaign, manychat_id,
                                referer, restaurado, primer_evento, ultimo_evento, pasos_total)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)
     ON CONFLICT(sesion_id) DO UPDATE SET
       rama = coalesce(excluded.rama, rama), manychat_id = coalesce(manychat_id, excluded.manychat_id),
       pasos_total = coalesce(excluded.pasos_total, pasos_total), ultimo_evento = excluded.ultimo_evento`
  ).bind(sesion, formulario, txt(ctx.rama, 20), disp, pais, txt(ctx.origen, 80), txt(ctx.utm_source, 120)?.toLowerCase() ?? null,
    txt(ctx.utm_campaign, 160), manychat, txt(ctx.referer, 300), ctx.restaurado ? 1 : 0, ahora, ent(ctx.pasos_total, 1, 50))];

  for (const e of evs) {
    stmts.push(db.prepare(
      `INSERT INTO eventos_form (sesion_id, formulario, tipo, paso, indice, rama, t_ms, dur_ms, datos_json, creado_en, cliente_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(sesion, formulario, e.tipo, e.paso, e.indice, txt(ctx.rama, 20), e.t_ms, e.dur_ms, e.datos, ahora, e.cliente_en));
  }

  // Resumen de la sesión, recalculado con lo que ya hay.
  const maxIdx = Math.max(...evs.map((e) => (e.tipo === 'paso_visto' || e.tipo === 'paso_completado') && e.indice != null ? e.indice + (e.tipo === 'paso_completado' ? 1 : 0) : 0));
  const ultimoPaso = [...evs].reverse().find((e) => e.paso && (e.tipo === 'paso_visto' || e.tipo === 'paso_completado'))?.paso || null;
  const tMax = Math.max(0, ...evs.map((e) => e.t_ms || 0));
  const cuenta = (t) => evs.filter((e) => e.tipo === t).length;
  stmts.push(db.prepare(
    `UPDATE sesiones_form SET
       max_indice = max(max_indice, ?2),
       ultimo_paso = coalesce(?3, ultimo_paso),
       errores = errores + ?4, atras = atras + ?5, eventos = eventos + ?6,
       t_total_ms = max(coalesce(t_total_ms, 0), ?7),
       enviado_en = coalesce(enviado_en, ?8), whatsapp_en = coalesce(whatsapp_en, ?9)
     WHERE sesion_id = ?1`
  ).bind(sesion, maxIdx, ultimoPaso, cuenta('error_validacion'), cuenta('paso_atras'), evs.length, tMax,
    cuenta('enviado') ? ahora : null, cuenta('click_whatsapp') ? ahora : null));

  await db.batch(stmts);
  return json({ ok: true, guardados: evs.length });
}
