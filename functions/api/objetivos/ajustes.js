import { esAdmin, json } from '../../_lib/auth.js';
import { METRICAS } from '../../_lib/programa.js';

// POST: corrección manual de un número (solo admin). Guarda al lado el
// valor que daba el cálculo automático en ese momento, para no perderlo.
// Body: { semana, metrica, valor_manual, motivo?, valor_original? }
export async function onRequestPost({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const b = await request.json();
  const semana = Number(b.semana);
  if (!Number.isInteger(semana) || semana < 1) return json({ error: 'semana inválida' }, 400);
  if (!METRICAS.includes(b.metrica)) return json({ error: 'métrica inválida' }, 400);
  const v = Number(b.valor_manual);
  if (!Number.isFinite(v)) return json({ error: 'valor_manual tiene que ser un número' }, 400);

  const r = await env.DB.prepare(
    `INSERT INTO ajustes (semana, metrica, valor_original, valor_manual, motivo, creado_en) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(semana, b.metrica, b.valor_original == null ? null : Number(b.valor_original), v, b.motivo || null, new Date().toISOString()).run();
  return json({ id: r.meta.last_row_id }, 201);
}
