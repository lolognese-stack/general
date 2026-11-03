// Tags y campos de ManyChat que usa la web (functions/_lib/manychat.js).
// GET: qué falta. POST (solo admin): los crea en la cuenta de ManyChat.
import { rolDe, json } from '../_lib/auth.js';
import { prepararManychat } from '../_lib/manychat.js';

export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.MANYCHAT_TOKEN) return json({ activo: false });
  try {
    return json({ activo: true, ...(await prepararManychat(env, false)) });
  } catch (e) {
    return json({ activo: true, error: e.message });
  }
}

export async function onRequestPost({ request, env }) {
  if (rolDe(request, env) !== 'admin') return json({ error: 'solo admin' }, 403);
  if (!env.MANYCHAT_TOKEN) return json({ error: 'falta MANYCHAT_TOKEN' }, 400);
  try {
    return json({ activo: true, ...(await prepararManychat(env, true)) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
