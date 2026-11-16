import { checkInbox, json } from '../../_lib/auth.js';
import { estadoPuente } from '../../_lib/puente.js';
// GET /api/setter/puente → si el puente WhatsApp Web está configurado y conectado (para el aviso del Inbox).

export async function onRequestGet({ request, env }) {
  if (!checkInbox(request, env)) return json({ error: 'unauthorized' }, 401);
  return json(await estadoPuente(env));
}
