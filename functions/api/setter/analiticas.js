import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo } from '../../_lib/setter.js';
import { cargarDatos, calcular } from '../../_lib/setter-analiticas.js';
// Analíticas del setter: GET ?dias=7|30|90 (por defecto 30).

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const dias = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get('dias'))) ? Number(new URL(request.url).searchParams.get('dias')) : 30;
  const hasta = new Date().toISOString();
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  return json(calcular(await cargarDatos(env.DB, desde), { desde, hasta }));
}
