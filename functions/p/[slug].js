// Página de propuesta pública de una cotización del Cotizador (solo Luna Llena).
//
// Se ve en https://lunallenatravel.vercel.app/p/<slug>/ (la web reescribe /p/* acá).
// Sin login: el slug es al azar (18 caracteres). noindex y sin caché compartida.
// El HTML lo armó el cotizador al guardar (migración 049); acá solo se sirve.

export async function onRequestGet({ env, params }) {
  const slug = String(params.slug || '');
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(slug)) return noEncontrada();
  const fila = await env.DB.prepare('SELECT propuesta_html FROM cotizador_cotizaciones WHERE slug = ?').bind(slug).first();
  if (!fila || !fila.propuesta_html) return noEncontrada();
  return new Response(fila.propuesta_html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'referrer-policy': 'no-referrer',
      'cache-control': 'private, max-age=300',
    },
  });
}

function noEncontrada() {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Propuesta no encontrada · Luna Llena Travel</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#161616;line-height:1.5">
<h1 style="font-size:22px">Esta propuesta no está disponible</h1>
<p>Escríbenos por WhatsApp y te la enviamos de nuevo.</p>
<p><a href="https://wa.me/51982360927" style="color:#FF7A00;font-weight:600">WhatsApp +51 982 360 927</a></p></body></html>`, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' },
  });
}
