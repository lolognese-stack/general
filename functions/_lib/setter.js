// Comunes del setter de WhatsApp (Inbox). Solo Luna Llena: sin el Service
// Binding SETTER (wrangler.toml) y el secret SETTER_INTERNAL_SECRET, todo
// /api/setter/* responde "inactivo" y el panel no muestra la sección.

export function setterActivo(env) {
  return Boolean(env.SETTER && env.SETTER_INTERNAL_SECRET);
}

// Llama al Worker por el Service Binding. El host no importa: el binding
// no sale a internet.
export function alWorker(env, ruta, init = {}) {
  return env.SETTER.fetch('https://setter-worker/' + ruta, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-setter-secret': env.SETTER_INTERNAL_SECRET, ...(init.headers || {}) },
  });
}

export async function evento(db, conv, tipo, detalle) {
  await db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
    .bind(conv.id, conv.lead_id, tipo, detalle ?? null, new Date().toISOString()).run();
}

// Llamada al editor del Worker (playground, puntuar, asistente): devuelve la
// Response tal cual para que el panel vea el error si lo hay.
export async function editorWorker(env, nombre, cuerpo) {
  const r = await alWorker(env, 'interno/' + nombre, { method: 'POST', body: JSON.stringify(cuerpo) });
  return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
}

export async function cuerpo(request) {
  try { return await request.json(); } catch { return null; }
}
