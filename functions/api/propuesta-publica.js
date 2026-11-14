// Página pública de una propuesta armada en el CRM. Sin login: el slug es al azar (<nombre>-<6 hex>) y la página es noindex.
// La ve el cliente en https://luna-llena-propuestas.vercel.app/<slug>/ (el vercel.json de luna-llena-propuestas reescribe
// /<slug>/ a esta ruta; las carpetas estáticas, como la de Ulises, ganan y no pasan por acá).
import { servirPropuesta } from '../_lib/ct-propuestas.js';

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  return servirPropuesta(env, String(q.get('slug') || ''), { reservar: q.get('reservar') === '1', origen: new URL(request.url).origin });
}
