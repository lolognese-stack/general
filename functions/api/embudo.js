// GET /api/embudo?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (sin parámetros = todo)
// Embudo de prospección y recorrido de contenido: el cálculo vive en
// functions/_lib/embudo.js (lo comparte con el reporte).

import { rolDe, json } from '../_lib/auth.js';
import { calcularEmbudo } from '../_lib/embudo.js';

export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const u = new URL(request.url);
  const { _porManychat, ...datos } = await calcularEmbudo(env.DB, u.searchParams.get('desde'), u.searchParams.get('hasta'));
  return json(datos);
}
