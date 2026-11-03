import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo } from '../../_lib/setter.js';
// ¿Este CRM tiene el setter de WhatsApp? El panel muestra el Inbox solo si sí.

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  return json({ activo: setterActivo(env) });
}
