// Cron del aviso diario de seguimientos: llama al CRM, que decide si hay algo que avisar
// (y avisa una sola vez por día, aunque esto corra dos veces).
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(avisar(env));
  },
  // GET / devuelve 404: este Worker no tiene nada público.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

async function avisar(env) {
  if (!env.AVISO_SECRET) throw new Error('falta el secret AVISO_SECRET');
  const r = await fetch(`${env.CRM_URL.replace(/\/$/, '')}/api/seguimientos-aviso`, {
    method: 'POST',
    headers: { 'x-aviso-secret': env.AVISO_SECRET, 'content-type': 'application/json' },
    body: '{}',
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`el CRM respondió ${r.status}: ${t.slice(0, 200)}`);
  console.log('aviso de seguimientos:', t);
}
