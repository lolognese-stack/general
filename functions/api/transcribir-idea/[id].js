import { checkToken, json } from '../../_lib/auth.js';
import { videoIg } from '../../_lib/ig-foto.js';
// Transcribe el audio de un reel guardado como idea, con Whisper de Workers AI
// (binding AI en wrangler.toml; entra en la cuota gratis diaria de la cuenta,
// sin API key aparte). Guarda el texto en ideas.transcripcion.
//
// El mp4 va del CDN de Instagram a Whisper como stream, sin leerlo acá: un
// reel pesa 5-30 MB y pasarlo a base64 dentro de la Function excede los 10 ms
// de CPU del plan gratis.

export async function onRequestPost({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.AI) return json({ error: 'falta el binding AI de Workers AI' }, 503);
  const idea = await env.DB.prepare('SELECT url FROM ideas WHERE id = ?').bind(params.id).first();
  if (!idea) return json({ error: 'no existe la idea' }, 404);

  let video;
  try { video = await videoIg(idea.url); }
  catch (e) { return json({ error: e.message }, 422); }

  let texto;
  try {
    const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      // 'audio/mp4' y no el 'video/mp4' del CDN: con video/* Whisper responde
      // "8001: Invalid input", aunque el contenedor es el mismo.
      audio: { body: video.body, contentType: 'audio/mp4' },
    });
    texto = String(r.text || '').trim();
  } catch (e) {
    return json({ error: 'Whisper no pudo: ' + (e.message || e) }, 502);
  }
  if (!texto) return json({ error: 'el reel no tiene voz (solo música)' }, 422);

  await env.DB.prepare('UPDATE ideas SET transcripcion = ?, actualizado_en = ? WHERE id = ?')
    .bind(texto, new Date().toISOString(), params.id).run();
  return json({ ok: true, transcripcion: texto });
}
