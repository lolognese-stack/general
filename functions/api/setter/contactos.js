import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo, alWorker, cuerpo } from '../../_lib/setter.js';
// Agregar un contacto a mano desde el Inbox. El Worker cruza el número con los
// leads (no duplica) y abre la conversación vacía con la IA pausada.

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  const r = await alWorker(env, 'interno/contacto', {
    method: 'POST',
    body: JSON.stringify({ nombre: b.nombre, whatsapp: b.whatsapp }),
  });
  const data = await r.json().catch(() => ({ error: 'el Worker no respondió bien' }));
  return json(data, r.status);
}
