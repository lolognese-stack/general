import { rolDe, esAdmin, json } from '../_lib/auth.js';
import { leerPrograma, hidratar, resolverSemanas } from '../_lib/programa.js';
import { calcularVivo } from '../_lib/vivo.js';

const EDITABLES = [
  'fecha_dia_0', 'dias_pausa', 'fecha_primera_publicacion', 'objetivo_total_consultas',
  'seguidores_inicio', 'objetivo_seguidores', 'texto_objetivo',
  'email_reporte', 'nombre_cliente',
];

// GET: programa + semanas resueltas (objetivo, real, estado, notas). Los
// números en vivo (fase 4) entran por el tercer parámetro de resolverSemanas.
export async function onRequestGet({ request, env }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const programa = await leerPrograma(env.DB);
  const vivo = await calcularVivo(env.DB, programa);
  const r = await resolverSemanas(env.DB, programa, rol, vivo);
  return json({ rol, programa, ...r });
}

// PATCH: solo admin. Cambia campos sueltos del programa; curva y umbrales
// van enteros (se reemplazan, no se mezclan).
export async function onRequestPatch({ request, env }) {
  if (!esAdmin(request, env)) return json({ error: 'forbidden' }, 403);
  const body = await request.json();
  const sets = []; const vals = [];

  for (const c of EDITABLES) {
    if (body[c] === undefined) continue;
    sets.push(`${c} = ?`); vals.push(body[c] === '' ? null : body[c]);
  }
  if (Array.isArray(body.curva)) {
    for (const w of body.curva) {
      if (!Number.isInteger(w.semana) || w.semana < 1) return json({ error: 'curva: semana inválida' }, 400);
    }
    sets.push('curva_json = ?'); vals.push(JSON.stringify(body.curva));
  }
  if (body.umbrales && typeof body.umbrales === 'object') {
    const u = body.umbrales;
    if (!(u.superado > u.cumplido && u.cumplido > u.cerca && u.cerca > 0)) {
      return json({ error: 'umbrales: tiene que ser superado > cumplido > cerca > 0' }, 400);
    }
    sets.push('umbrales_json = ?'); vals.push(JSON.stringify(u));
  }
  if (!sets.length) return json({ error: 'nada para cambiar' }, 400);

  await leerPrograma(env.DB); // garantiza la fila
  sets.push('actualizado_en = ?'); vals.push(new Date().toISOString());
  await env.DB.prepare(`UPDATE programa SET ${sets.join(', ')} WHERE id = 1`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM programa WHERE id = 1').first();
  return json(hidratar(row));
}
