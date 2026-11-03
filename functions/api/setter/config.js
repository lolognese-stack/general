import { checkToken, esAdmin, json } from '../../_lib/auth.js';
import { setterActivo, cuerpo } from '../../_lib/setter.js';
// Ajustes globales del setter. El kill switch lo puede tocar cualquiera con
// acceso al CRM (apagar la IA es una emergencia); el resto, solo el admin.

const MODELOS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

export async function onRequestPatch({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const b = await cuerpo(request);
  if (!b) return json({ error: 'body no es json' }, 400);
  const cambios = {};
  if (b.kill_switch !== undefined) cambios.kill_switch = b.kill_switch ? '1' : '0';
  for (const k of ['modelo_respuesta', 'modelo_asistente', 'tope_mensual']) {
    if (b[k] === undefined) continue;
    if (!esAdmin(request, env)) return json({ error: 'solo el admin cambia modelos y tope' }, 403);
    if (k === 'tope_mensual') {
      const n = Number(b[k]);
      if (!Number.isInteger(n) || n < 0) return json({ error: 'tope: entero >= 0 (0 = sin tope)' }, 400);
      cambios[k] = n ? String(n) : '';
    } else {
      if (b[k] && !MODELOS.includes(b[k])) return json({ error: `modelo: ${MODELOS.join(', ')}` }, 400);
      cambios[k] = b[k] || '';
    }
  }
  if (!Object.keys(cambios).length) return json({ error: 'nada para cambiar' }, 400);
  const ahora = new Date().toISOString();
  await env.DB.batch(Object.entries(cambios).map(([k, v]) => env.DB.prepare(
    `INSERT INTO setter_config (clave, valor, actualizado_en) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`
  ).bind(k, v, ahora)));
  return json({ ok: true, ...cambios });
}
