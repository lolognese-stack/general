import { esAdmin, json } from '../../../_lib/auth.js';

const NOTAS = ['porque', 'que_hacemos', 'nota_interna'];

// PATCH: notas de una semana (solo admin). Se puede escribir aunque la
// semana esté cerrada: lo que se congela son los números, no el texto.
export async function onRequestPatch({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1) return json({ error: 'semana inválida' }, 400);
  const body = await request.json();
  const now = new Date().toISOString();
  const vals = NOTAS.map((k) => (body[k] === undefined ? null : (body[k] === '' ? null : String(body[k]))));
  const sets = NOTAS.filter((k) => body[k] !== undefined);
  if (!sets.length) return json({ error: 'nada para cambiar' }, 400);

  await env.DB.prepare(
    `INSERT INTO semanas (numero, porque, que_hacemos, nota_interna, actualizado_en)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(numero) DO UPDATE SET
       ${sets.map((k) => `${k} = excluded.${k}`).join(', ')}, actualizado_en = excluded.actualizado_en`
  ).bind(n, ...vals, now).run();
  const row = await env.DB.prepare('SELECT * FROM semanas WHERE numero = ?').bind(n).first();
  return json(row);
}
