import { rolDe, json } from '../_lib/auth.js';

// Le dice al front qué rol tiene el token guardado. Solo para mostrar u
// ocultar botones: cada endpoint vuelve a validar por su cuenta.
export async function onRequestGet({ request, env }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  return json({ rol });
}
