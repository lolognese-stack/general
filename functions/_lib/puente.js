// Puente WhatsApp Web (repo/wa-puente): el número de Luna Llena vinculado como un dispositivo más.
// Escribe como una persona, sin la ventana de 24 h de la API oficial. Lo que manda vuelve al CRM
// como eco de Kapso (coexistencia), así que acá no se guarda el mensaje: aparece solo en el chat.
//
// Corre en la PC de Luna Llena detrás de un túnel de Cloudflare cuya dirección cambia en cada
// arranque: el puente la registra sola (POST /api/setter/puente) y queda en setter_config.puente_url.
// PUENTE_URL (secret) la fija a mano si algún día tiene dirección estable. Sin PUENTE_SECRET, apagado.

export async function puenteUrl(env) {
  if (!env.PUENTE_SECRET) return null;
  if (env.PUENTE_URL) return env.PUENTE_URL.replace(/\/+$/, '');
  const f = await env.DB.prepare(`SELECT valor FROM setter_config WHERE clave = 'puente_url'`).first().catch(() => null);
  return f && f.valor ? f.valor : null;
}

export async function puenteActivo(env) {
  return Boolean(await puenteUrl(env));
}

export function esElPuente(request, env) {
  const s = request.headers.get('x-puente-secret') || '';
  const t = env.PUENTE_SECRET || '';
  if (!t || s.length !== t.length) return false;
  let d = 0;
  for (let i = 0; i < s.length; i++) d |= s.charCodeAt(i) ^ t.charCodeAt(i);
  return d === 0;
}

async function llamar(env, ruta, init = {}) {
  const base = await puenteUrl(env);
  if (!base) throw Object.assign(new Error('el puente no está conectado (¿la PC de Luna Llena está prendida?)'), { status: 503 });
  let r;
  try {
    r = await fetch(base + ruta, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-puente-secret': env.PUENTE_SECRET, ...(init.headers || {}) },
      signal: AbortSignal.timeout(init.timeout || 25000),
    });
  } catch (e) {
    throw Object.assign(new Error('no responde la PC del puente (¿está prendida?): ' + e.message), { status: 503 });
  }
  const d = await r.json().catch(() => ({ error: `el puente respondió ${r.status} (¿la PC está prendida?)` }));
  if (!r.ok) throw Object.assign(new Error(d.error || `el puente respondió ${r.status}`), { status: r.status });
  return d;
}

export async function enviarPorPuente(env, numero, texto) {
  return llamar(env, '/enviar', { method: 'POST', body: JSON.stringify({ numero, texto }), timeout: 45000 });
}

export async function estadoPuente(env) {
  if (!(await puenteActivo(env))) return { activo: false };
  try { return { activo: true, ...(await llamar(env, '/estado', { timeout: 8000 })) }; }
  catch (e) { return { activo: true, conectado: false, error: e.message }; }
}

// Mensaje de bienvenida a quien completa el formulario de viaje. {nombre} = primer nombre.
export const BIENVENIDA_DEFECTO = 'Hola {nombre}! 👋 Te escribimos de Luna Llena Travel. Recibimos tu formulario para tu viaje a Perú y ya lo estamos revisando. Te escribimos por aquí con tu propuesta. Si quieres contarnos algo más, respóndenos este mensaje.';
