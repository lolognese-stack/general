import { esAdmin, json } from '../../_lib/auth.js';
import { armarReporte, enviarMail } from '../../_lib/reporte.js';

function panelUrl(request) {
  const u = new URL(request.url);
  return `${u.origin}/panel-4c1f6a#/objetivos`;
}

// GET (admin): vista previa del mail, HTML tal cual se manda. ?semana=N
// para una semana puntual; sin eso, la última que terminó.
export async function onRequestGet({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const u = new URL(request.url);
  const semana = u.searchParams.get('semana') ? Number(u.searchParams.get('semana')) : undefined;
  const r = await armarReporte(env.DB, { semana, panelUrl: panelUrl(request) });
  if (r.error) return json({ error: r.error }, 400);
  if (u.searchParams.get('formato') === 'json') return json({ semana: r.semana, asunto: r.asunto, destinatarios: r.destinatarios, texto: r.texto });
  return new Response(r.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// POST (admin): manda el reporte. Body opcional: { semana, a, forzar }.
// `a` pisa los destinatarios configurados (para probar). Sin `forzar`, no
// vuelve a mandar la misma semana dos veces -- así el cron es idempotente.
export async function onRequestPost({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const body = await request.json().catch(() => ({}));
  const r = await armarReporte(env.DB, { semana: body.semana, panelUrl: panelUrl(request) });
  if (r.error) return json({ error: r.error }, 400);

  const a = body.a ? String(body.a).split(',').map((x) => x.trim()).filter(Boolean) : r.destinatarios;
  if (!a.length) return json({ error: 'no hay mail configurado' }, 400);
  if (!body.forzar && !body.a && r.programa.reporte_ultima_semana === r.semana) {
    return json({ ok: false, repetido: true, semana: r.semana, enviado: r.programa.reporte_ultimo_envio });
  }

  const env_ = await enviarMail(env, { a, asunto: r.asunto, html: r.html, texto: r.texto });
  if (!env_.ok) return json({ error: env_.error }, 502);

  if (!body.a) {
    await env.DB.prepare('UPDATE programa SET reporte_ultimo_envio = ?, reporte_ultima_semana = ? WHERE id = 1')
      .bind(new Date().toISOString(), r.semana).run();
  }
  return json({ ok: true, semana: r.semana, a, id: env_.id, asunto: r.asunto });
}
