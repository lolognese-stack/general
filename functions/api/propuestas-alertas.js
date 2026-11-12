// Marca como leídos los avisos de propuestas (página Propuestas del CRM). Con el token del CRM.
import { rolDe, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('UPDATE propuesta_alertas SET leida = 1 WHERE leida = 0').run();
  return json({ ok: true });
}
