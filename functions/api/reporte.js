// /api/reporte — sección Reporte del panel (ver functions/_lib/reporte.js).
//
//   GET  /api/reporte                         lista de reportes guardados
//   GET  /api/reporte?id=N                    un reporte completo
//   GET  /api/reporte?insumos=1&desde&hasta   solo los insumos (sin Claude):
//                                             para revisar los datos antes
//   POST /api/reporte { desde, hasta, ticket } genera uno con Claude. La
//        respuesta es el markdown en streaming (texto plano, se va escribiendo)
//        y al terminar queda guardado en reportes_ia (migración 048).

import { rolDe, json } from '../_lib/auth.js';
import { armarInsumos, promptReporte, MODELO_REPORTE, TICKET_X_USD } from '../_lib/reporte-ia.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const rango = (desde, hasta) => {
  const h = FECHA.test(hasta || '') ? hasta : new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const d = FECHA.test(desde || '') ? desde : new Date(new Date(h + 'T12:00:00Z').getTime() - 29 * 86400000).toISOString().slice(0, 10);
  return d <= h ? { desde: d, hasta: h } : { desde: h, hasta: d };
};
const ticketDe = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 50 && n <= 100000 ? n : TICKET_X_USD; };

export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const u = new URL(request.url);
  if (u.searchParams.get('insumos')) {
    const r = rango(u.searchParams.get('desde'), u.searchParams.get('hasta'));
    return json(await armarInsumos(env.DB, { ...r, ticketUsd: ticketDe(u.searchParams.get('ticket')) }));
  }
  const id = parseInt(u.searchParams.get('id') || '', 10);
  if (id) {
    const fila = await env.DB.prepare('SELECT * FROM reportes_ia WHERE id = ?').bind(id).first();
    if (!fila) return json({ error: 'no existe' }, 404);
    return json({ ...fila, insumos: JSON.parse(fila.insumos_json), insumos_json: undefined });
  }
  const { results } = await env.DB.prepare(
    `SELECT id, desde, hasta, ticket_usd, estado, modelo, error, creado_en, terminado_en,
            json_extract(insumos_json, '$.resumen') AS resumen
       FROM reportes_ia ORDER BY id DESC LIMIT 50`).all();
  return json(results.map((r) => ({ ...r, resumen: r.resumen ? JSON.parse(r.resumen) : null })));
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Falta el secret ANTHROPIC_API_KEY en el CRM.' }, 500);
  const body = await request.json().catch(() => ({}));
  const r = rango(body.desde, body.hasta);
  const ticketUsd = ticketDe(body.ticket);
  const insumos = await armarInsumos(env.DB, { ...r, ticketUsd });
  const ahora = new Date().toISOString();
  const ins = await env.DB.prepare(
    `INSERT INTO reportes_ia (desde, hasta, ticket_usd, estado, modelo, insumos_json, creado_en) VALUES (?, ?, ?, 'generando', ?, ?, ?)`
  ).bind(r.desde, r.hasta, ticketUsd, MODELO_REPORTE, JSON.stringify(insumos), ahora).run();
  const reporteId = ins.meta.last_row_id;

  // Streaming: el informe es largo y Opus piensa antes de escribir; así la
  // conexión no queda muda y el panel lo muestra mientras se escribe.
  // fallbacks "default": si el modelo declina, la API reintenta en otro.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO_REPORTE,
      max_tokens: 32000,
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'high' },
      system: promptReporte(ticketUsd),
      messages: [{ role: 'user', content:
        `Período ${r.desde} a ${r.hasta}. Ticket objetivo: USD ${ticketUsd}.\n` +
        `Estos son los insumos del CRM en JSON. Arma el reporte con el formato indicado.\n\n` +
        '```json\n' + JSON.stringify(insumos) + '\n```' }],
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => '');
    await env.DB.prepare(`UPDATE reportes_ia SET estado = 'error', error = ?, terminado_en = ? WHERE id = ?`)
      .bind(`Claude ${res.status}: ${err.slice(0, 300)}`, new Date().toISOString(), reporteId).run();
    return json({ error: `Claude ${res.status}`, detalle: err.slice(0, 300), id: reporteId }, 502);
  }

  const enc = new TextEncoder(), dec = new TextDecoder();
  const { readable, writable } = new TransformStream();
  const out = writable.getWriter();
  const trabajo = (async () => {
    let texto = '', resto = '', parada = null, modelo = MODELO_REPORTE, error = null;
    try {
      const lector = res.body.getReader();
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const lineas = resto.split('\n');
        resto = lineas.pop();
        for (const l of lineas) {
          if (!l.startsWith('data: ')) continue;
          let ev; try { ev = JSON.parse(l.slice(6)); } catch { continue; }
          if (ev.type === 'message_start' && ev.message?.model) modelo = ev.message.model;
          else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            texto += ev.delta.text;
            await out.write(enc.encode(ev.delta.text));
          } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) parada = ev.delta.stop_reason;
          else if (ev.type === 'error') error = ev.error?.message || 'error de Claude';
        }
      }
      if (parada === 'refusal') error = 'Claude no quiso generar el reporte.';
      if (parada === 'max_tokens') error = 'El reporte quedó cortado (límite de largo).';
    } catch (e) {
      error = e.message;
    }
    if (error) await out.write(enc.encode(`\n\n> ⚠ ${error}`)).catch(() => {});
    await env.DB.prepare(`UPDATE reportes_ia SET estado = ?, modelo = ?, texto = ?, error = ?, terminado_en = ? WHERE id = ?`)
      .bind(error && !texto ? 'error' : 'listo', modelo, texto || null, error, new Date().toISOString(), reporteId).run();
    await out.close().catch(() => {});
  })();
  if (waitUntil) waitUntil(trabajo);

  return new Response(readable, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-reporte-id': String(reporteId) },
  });
}
