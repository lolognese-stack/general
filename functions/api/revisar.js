import { checkToken, json } from '../_lib/auth.js';
import { codigoIg } from '../_lib/ig-foto.js';
// Ideas > Revisar: cola de posts subidos desde un CSV de Instagram
// (ver crm/migracion-057-revisar.sql).
//
// GET  lo que falta filtrar (pendiente) o clasificar (pasa), más likes primero,
//      y cuántos hay en cada estado.
//      Los posts que ya están en Ideas (mismo código) no se muestran.
// POST { filas:[{url, usuario, publicado_en, likes, comentarios, reposts, views, caption}], lote }
//      agrega a la cola; un post que ya estaba (en cualquier estado) se ignora.

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.round(n) : null;
};

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const [{ results: cola }, { results: conteo }] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM revisar_cola r
       WHERE r.estado IN ('pendiente', 'pasa')
         AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.codigo = r.codigo)
       ORDER BY COALESCE(r.likes, -1) DESC, r.codigo`
    ).all(),
    env.DB.prepare(`SELECT estado, count(*) n FROM revisar_cola GROUP BY estado`).all(),
  ]);
  return json({ cola, conteo: Object.fromEntries(conteo.map((c) => [c.estado, c.n])) });
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { filas = [], lote = '' } = await request.json();
  if (!Array.isArray(filas) || !filas.length) return json({ error: 'sin filas' }, 400);
  const now = new Date().toISOString();
  const stmts = [];
  const vistos = new Set();
  for (const f of filas) {
    const codigo = codigoIg(f.url);
    if (!codigo || vistos.has(codigo)) continue;
    vistos.add(codigo);
    const tipo = /\/reels?\//.test(f.url) ? 'reel' : 'p';
    stmts.push(env.DB.prepare(
      `INSERT OR IGNORE INTO revisar_cola
       (codigo, url, usuario, publicado_en, likes, comentarios, reposts, views, caption, lote, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      codigo, `https://www.instagram.com/${tipo}/${codigo}/`, String(f.usuario || '').replace(/^@/, '') || null,
      f.publicado_en || null, num(f.likes), num(f.comentarios), num(f.reposts), num(f.views),
      f.caption || null, String(lote).slice(0, 120) || null, now, now,
    ));
  }
  let nuevos = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const rs = await env.DB.batch(stmts.slice(i, i + 50));
    nuevos += rs.reduce((s, r) => s + (r.meta?.changes || 0), 0);
  }
  return json({ ok: true, filas: vistos.size, nuevos, repetidos: vistos.size - nuevos });
}
