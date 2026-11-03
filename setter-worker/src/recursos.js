// Cómo se manda un recurso por WhatsApp.
//   link            → mensaje de texto con la URL
//   archivo/audio   → si tiene archivo en D1 (setter_archivos), se sube a
//                     WhatsApp una vez y se reusa el media_id; si solo tiene
//                     URL, Meta lo baja de ahí.

const VIGENCIA_MS = 25 * 864e5;   // Meta guarda los medios 30 días

const tipoMedia = (rec, mime) => {
  if (rec.tipo === 'audio' || mime?.startsWith('audio/')) return 'audio';
  if (mime?.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(rec.url || '')) return 'image';
  if (mime?.startsWith('video/')) return 'video';
  return 'document';
};

function bytesDe(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Devuelve lo que va en el pedido de enviar(): { texto } o { media }.
export async function salidaDeRecurso(env, canal, rec, ahora = new Date()) {
  if (rec.tipo === 'link') return { texto: rec.url || rec.descripcion };
  const arch = await env.DB.prepare('SELECT * FROM setter_archivos WHERE recurso_id = ?').bind(rec.id).first();
  if (!arch) {
    if (!rec.url) return { texto: rec.descripcion };
    return { media: { tipo: tipoMedia(rec), link: rec.url, filename: rec.etiqueta } };
  }
  if (canal.simulado) return { texto: `[archivo: ${arch.nombre}]` };   // chat de prueba: no se sube nada
  let id = arch.meta_media_id;
  if (!id || !arch.meta_media_hasta || arch.meta_media_hasta <= ahora.toISOString()) {
    id = await canal.uploadMedia(bytesDe(arch.datos_b64), arch.mime, arch.nombre);
    await env.DB.prepare('UPDATE setter_archivos SET meta_media_id = ?, meta_media_hasta = ? WHERE recurso_id = ?')
      .bind(id, new Date(ahora.getTime() + VIGENCIA_MS).toISOString(), rec.id).run();
  }
  return { media: { tipo: tipoMedia(rec, arch.mime), id, filename: arch.nombre } };
}
