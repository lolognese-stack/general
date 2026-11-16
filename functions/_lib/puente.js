// Puente WhatsApp Web (repo/wa-puente): el número de Luna Llena vinculado como un dispositivo más.
// Escribe como una persona, sin la ventana de 24 h de la API oficial. Lo que manda vuelve al CRM
// como eco de Kapso (coexistencia), así que acá no se guarda el mensaje: aparece solo en el chat.
// Sin PUENTE_URL + PUENTE_SECRET (secrets de Pages) todo sigue como antes (API oficial + plantillas).

export function puenteActivo(env) {
  return Boolean(env.PUENTE_URL && env.PUENTE_SECRET);
}

async function llamar(env, ruta, init = {}) {
  const r = await fetch(env.PUENTE_URL.replace(/\/+$/, '') + ruta, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-puente-secret': env.PUENTE_SECRET, ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeout || 25000),
  });
  const d = await r.json().catch(() => ({ error: `el puente respondió ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(d.error || `el puente respondió ${r.status}`), { status: r.status });
  return d;
}

export async function enviarPorPuente(env, numero, texto) {
  return llamar(env, '/enviar', { method: 'POST', body: JSON.stringify({ numero, texto }), timeout: 45000 });
}

export async function estadoPuente(env) {
  if (!puenteActivo(env)) return { activo: false };
  try { return { activo: true, ...(await llamar(env, '/estado', { timeout: 8000 })) }; }
  catch (e) { return { activo: true, conectado: false, error: e.message }; }
}
