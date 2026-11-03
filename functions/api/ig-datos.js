import { checkToken, json } from '../_lib/auth.js';
import { portadaIg, datosIg, aBase64 } from '../_lib/ig-foto.js';
// Vista previa de un post antes de guardarlo como idea (la usa la extensión
// de Chrome): portada como data URL + likes, comentarios, creador y caption.
// No escribe nada; al guardar, la extensión manda la misma imagen a
// /api/foto-idea/:id para no volver a pedírsela a Instagram.

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const { url } = await request.json().catch(() => ({}));
  const [foto, datos] = await Promise.allSettled([portadaIg(url), datosIg(url)]);
  const ok = foto.status === 'fulfilled' || datos.status === 'fulfilled';
  return json({
    ok,
    image: foto.status === 'fulfilled' ? `data:${foto.value.mime};base64,${aBase64(foto.value.bytes)}` : null,
    audio: foto.status === 'fulfilled' ? foto.value.audio : null,
    ...(datos.status === 'fulfilled' ? datos.value : { likes: null, comentarios: null, creador: null, caption: '' }),
  });
}
