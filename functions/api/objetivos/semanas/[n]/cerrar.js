import { esAdmin, json } from '../../../../_lib/auth.js';
import { leerPrograma, resolverSemanas } from '../../../../_lib/programa.js';
import { calcularVivo } from '../../../../_lib/vivo.js';

// POST: cierra la semana -- congela objetivo, real, estado y fuente tal
// como están ahora. Se usa después de cada weekly. Una vez cerrada, los
// ajustes nuevos no la tocan (quedan como nota) y el historial no cambia.
export async function onRequestPost({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 1) return json({ error: 'semana inválida' }, 400);

  const programa = await leerPrograma(env.DB);
  const vivo = await calcularVivo(env.DB, programa);
  const { semanas } = await resolverSemanas(env.DB, programa, 'admin', vivo);
  const sem = semanas.find((s) => s.numero === n);
  if (!sem) return json({ error: 'la semana no está en la curva' }, 404);
  if (sem.cerrada_en) return json({ error: 'ya estaba cerrada', cerrada_en: sem.cerrada_en }, 409);
  if (sem.fase === 'pendiente') return json({ error: 'todavía no empezó' }, 400);
  if (sem.fase === 'sin_programa') return json({ error: 'el programa no tiene fecha de primera publicación' }, 400);

  const now = new Date().toISOString();
  const foto = { objetivo: sem.objetivo, real: sem.real, estado: sem.estado, fuente: sem.fuente, estado_semana: sem.estado_semana, cerrada_en: now };
  await env.DB.prepare(
    `INSERT INTO semanas (numero, cerrada_en, metricas_json, actualizado_en) VALUES (?, ?, ?, ?)
     ON CONFLICT(numero) DO UPDATE SET cerrada_en = excluded.cerrada_en, metricas_json = excluded.metricas_json, actualizado_en = excluded.actualizado_en`
  ).bind(n, now, JSON.stringify(foto), now).run();
  return json({ numero: n, cerrada_en: now });
}

// DELETE: reabre. Solo para deshacer un cierre por error; el número vuelve
// a calcularse en vivo.
export async function onRequestDelete({ request, env, params }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const n = Number(params.n);
  await env.DB.prepare('UPDATE semanas SET cerrada_en = NULL, metricas_json = NULL, actualizado_en = ? WHERE numero = ?')
    .bind(new Date().toISOString(), n).run();
  return json({ numero: n, cerrada_en: null });
}
