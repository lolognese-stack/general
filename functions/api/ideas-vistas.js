import { checkToken, json } from '../_lib/auth.js';
// Vistas guardadas del Ideador (pestañas con un filtro). Ver migración 029.

export const aCliente = (row) => {
  let filtro = {};
  try { filtro = JSON.parse(row.filtro || '{}'); } catch {}
  return { ...row, filtro };
};

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { results } = await env.DB.prepare('SELECT * FROM ideas_vistas ORDER BY orden, id').all();
  return json(results.map(aCliente));
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { nombre, filtro } = await request.json();
  if (!String(nombre || '').trim()) return json({ error: 'falta el nombre' }, 400);
  const max = await env.DB.prepare('SELECT COALESCE(MAX(orden), 0) m FROM ideas_vistas').first();
  const r = await env.DB.prepare('INSERT INTO ideas_vistas (nombre, filtro, orden, creado_en) VALUES (?, ?, ?, ?)')
    .bind(String(nombre).trim().slice(0, 40), JSON.stringify(filtro || {}), max.m + 1, new Date().toISOString()).run();
  const row = await env.DB.prepare('SELECT * FROM ideas_vistas WHERE id = ?').bind(r.meta.last_row_id).first();
  return json(aCliente(row), 201);
}
