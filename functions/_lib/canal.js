// Canal de una visita deducido del referrer, para cuando el link no trae
// utm_source (casi todo lo que llega de ManyChat o de la bio). Lo usan
// evento-web.js y cotizacion-web.js. Copia de visite-web/functions/_lib/canal.js
// con los dominios propios de Luna Llena.
export function canalDesdeReferer(referer) {
  if (!referer) return null;
  let host;
  try {
    host = new URL(referer).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host.endsWith('manychat.com')) return 'manychat';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('facebook.com') || host === 'fb.me') return 'facebook';
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (host.includes('google.')) return 'google';
  if (host.includes('tripadvisor.')) return 'tripadvisor';
  if (host.endsWith('whatsapp.com') || host === 'wa.me') return 'whatsapp';
  // Navegación dentro del propio sitio: no es un canal.
  if (host.endsWith('lunallenatravel.com') || host.startsWith('lunallenatravel.')) return null;
  return host.slice(0, 120);
}
