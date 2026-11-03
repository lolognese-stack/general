import { rolDe, json } from '../../../_lib/auth.js';
import { cargar, evento, autorDe, SQL_VIAJERO_COMPLETO } from '../../../_lib/ventas.js';

const CAMPOS = ['nombre_completo', 'nacionalidad', 'doc_tipo', 'doc_numero', 'fecha_nacimiento', 'sexo'];

// PUT /api/ventas/:id/viajeros  { viajeros: [{ orden, nombre_completo, ... }] }
// Upsert por (venta_id, orden), igual que el formulario de pasaportes de la web.
export async function onRequestPut({ request, env, params }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const v = await cargar(env, params.id);
  if (!v) return json({ error: 'No existe esa venta' }, 404);
  const b = await request.json().catch(() => ({}));
  const lista = Array.isArray(b.viajeros) ? b.viajeros : [];
  if (!lista.length) return json({ error: 'No hay viajeros para guardar' }, 400);

  const ahora = new Date().toISOString();
  const st = [];
  for (const w of lista) {
    const orden = Number(w.orden);
    if (!Number.isInteger(orden) || orden < 1 || orden > v.viajeros_total) {
      return json({ error: `Viajero ${w.orden}: el orden va de 1 a ${v.viajeros_total}` }, 400);
    }
    if (w.fecha_nacimiento && !/^\d{4}-\d{2}-\d{2}$/.test(w.fecha_nacimiento)) return json({ error: `Viajero ${orden}: fecha de nacimiento YYYY-MM-DD` }, 400);
    if (w.sexo && !['F', 'M', 'X'].includes(w.sexo)) return json({ error: `Viajero ${orden}: sexo F, M o X` }, 400);
    if (w.doc_tipo && !['pasaporte', 'dni', 'ce', 'otro'].includes(w.doc_tipo)) return json({ error: `Viajero ${orden}: tipo de documento inválido` }, 400);
    const vals = CAMPOS.map((c) => (typeof w[c] === 'string' ? w[c].trim() : w[c]) || null);
    st.push(env.DB.prepare(
      `INSERT INTO venta_viajeros (venta_id, orden, ${CAMPOS.join(', ')}, es_menor, creado_en, actualizado_en)
       VALUES (?, ?, ${CAMPOS.map(() => '?').join(', ')}, ?, ?, ?)
       ON CONFLICT(venta_id, orden) DO UPDATE SET ${CAMPOS.map((c) => `${c} = excluded.${c}`).join(', ')},
         es_menor = excluded.es_menor, actualizado_en = excluded.actualizado_en`
    ).bind(v.id, orden, ...vals, w.es_menor ? 1 : 0, ahora, ahora));
  }
  await env.DB.batch(st);

  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM venta_viajeros WHERE venta_id = ? AND ${SQL_VIAJERO_COMPLETO}`).bind(v.id).first();
  await env.DB.batch([
    evento(env, v.id, 'viajeros', `${r.n} de ${v.viajeros_total} completos`, autorDe(rol), ahora),
    env.DB.prepare('UPDATE ventas SET actualizado_en = ? WHERE id = ?').bind(ahora, v.id),
  ]);
  const { results } = await env.DB.prepare('SELECT * FROM venta_viajeros WHERE venta_id = ? ORDER BY orden').bind(v.id).all();
  return json({ viajeros: results, viajeros_completos: r.n, viajeros_total: v.viajeros_total });
}
