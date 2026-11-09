// Portada de un post de Instagram, sin login. Lo usan /api/foto-pieza y
// scripts/fotos-piezas.mjs.
//
// Primero la página embed (/p/CODE/embed/captioned/): trae la primera slide
// con su proporción real (4:5, 1:1...) en un srcset de varios anchos. El
// og:image de los /p/ viene recortado cuadrado, sirve solo de respaldo (y
// para reels, donde la embed no trae <img> y el og:image ya es el 9:16).
// Las dos piden con el UA del crawler de Facebook, igual que el ideador.

const UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const ANCHO = 750; // suficiente para el panel; la original pesa >1 MB

export function codigoIg(url) {
  return String(url || '').match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/)?.[1] || null;
}

const sinAmp = (s) => s.replace(/&amp;/g, '&');

async function html(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
  return r.ok ? r.text() : '';
}

// Devuelve { bytes: Uint8Array, mime, tipo } o tira error. tipo: 'carrusel' |
// 'video' | 'imagen' | null según lo que diga la embed.
export async function portadaIg(link) {
  const code = codigoIg(link);
  if (!code) throw new Error('link de Instagram inválido');

  let src = null, tipo = null;
  const emb = await html(`https://www.instagram.com/p/${code}/embed/captioned/`);
  if (emb) {
    tipo = /GraphSidecar/.test(emb) ? 'carrusel' : /GraphVideo|"is_video\\?":true/.test(emb) ? 'video' : /GraphImage/.test(emb) ? 'imagen' : null;
    const tag = emb.match(/<img[^>]+class="EmbeddedMediaImage"[^>]*>/)?.[0];
    const srcset = tag?.match(/srcset="([^"]*)"/)?.[1];
    if (srcset) {
      const cands = sinAmp(srcset).split(/,(?=https?:)/).map((c) => {
        const [u, w] = c.trim().split(/\s+/);
        return { u, w: parseInt(w) || 0 };
      // El srcset mezcla dos tandas: "p720x720" (encajada, proporción real)
      // y "c0.411..._s750x750" (recorte cuadrado). Solo sirven las primeras.
      }).filter((c) => c.u && c.w && !/stp=c[\d.]+/.test(c.u) && !/_s\d+x\d+/.test(c.u));
      const ok = cands.filter((c) => c.w <= ANCHO).sort((a, b) => b.w - a.w)[0] || cands.sort((a, b) => a.w - b.w)[0];
      src = ok?.u || null;
    }
    if (!src && tag) src = sinAmp(tag.match(/src="([^"]*)"/)?.[1] || '') || null;
  }
  if (!src) {
    const pag = await html(`https://www.instagram.com/p/${code}/`);
    const m = pag.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i)
           || pag.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:image"/i);
    if (m) src = sinAmp(m[1]);
  }
  if (!src) throw new Error('Instagram no devolvió imagen');

  const img = await fetch(src, { headers: { 'User-Agent': UA } });
  if (!img.ok) throw new Error(`CDN respondió ${img.status}`);
  return { bytes: new Uint8Array(await img.arrayBuffer()), mime: img.headers.get('content-type') || 'image/jpeg', tipo, audio: audioDeEmbed(emb) };
}

// Audio de un reel, de la embed: clips_music_attribution_info trae canción y
// artista (o "audio original" del creador). Va escapado dos veces dentro de un
// string de JS: artist_name\":\"napsea\",\"song_name\":\"Life Feels So Good\"
export function audioDeEmbed(html) {
  const i = String(html || '').indexOf('clips_music_attribution_info');
  if (i === -1) return null;
  const tramo = html.slice(i, i + 600);
  const campo = (k) => {
    const m = tramo.match(new RegExp(`${k}\\\\*":\\\\*"((?:[^"\\\\]|\\\\(?!"))*)\\\\*"`));
    if (!m) return null;
    try { return JSON.parse('"' + m[1].replace(/\\\\/g, '\\') + '"').trim() || null; } catch { return m[1]; }
  };
  const original = /uses_original_audio\\*":true/.test(tramo);
  const nombre = campo('song_name');
  const artista = campo('artist_name');
  if (!nombre && !artista) return null;
  return { nombre: nombre || (original ? 'Audio original' : null), artista, original };
}

const decodificar = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// "71K likes" / "1,804 comments" -> número entero.
function contar(texto, palabra) {
  const m = texto.match(new RegExp(`([\\d.,]+)\\s*([KMB])?\\s+${palabra}`, 'i'));
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  const n = mult > 1 ? parseFloat(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

// Datos de la página embed, que viaja como JSON escapado dos veces dentro de un
// <script>: \"video_view_count\":70099, \"edge_liked_by\":{\"count\":12218}.
// Es la única fuente que trae las views de un reel (video_view_count) y no
// depende del og:description, que Instagram a veces no manda. Solo los reels
// tienen views: en carruseles y fotos queda null.
export function datosDeEmbed(emb) {
  if (!emb) return null;
  const num = (re) => { const m = emb.match(re); return m ? Number(m[1]) : null; };
  let caption = '';
  const c = emb.match(/edge_media_to_caption\\*":\{\\*"edges\\*":\[\{\\*"node\\*":\{\\*"text\\*":\\*"((?:[^"\\]|\\(?!"))*)\\*"/);
  if (c) {
    try { caption = JSON.parse('"' + c[1].replace(/\\\\/g, '\\') + '"'); } catch { caption = c[1]; }
  }
  const datos = {
    views: num(/video_view_count\\*":(\d+)/) ?? num(/video_play_count\\*":(\d+)/),
    likes: num(/edge_liked_by\\*":\{\\*"count\\*":(\d+)/),
    comentarios: num(/edge_media_to_comment\\*":\{\\*"count\\*":(\d+)/),
    creador: emb.match(/username=([\w.]+)[&"]/)?.[1] || null,
    caption: caption.trim(),
  };
  return datos.views == null && datos.likes == null && datos.comentarios == null && !datos.creador && !datos.caption ? null : datos;
}

// Views, likes, comentarios, creador y caption de un post público. Primero la
// embed (trae views y números exactos); lo que falte se completa del
// og:description de la página ("71K likes, 1,804 comments - usuario on
// fecha: "caption""), que redondea los miles ("12K").
export async function datosIg(link) {
  const code = codigoIg(link);
  if (!code) throw new Error('link de Instagram inválido');
  let emb = datosDeEmbed(await html(`https://www.instagram.com/p/${code}/embed/captioned/`).catch(() => ''));
  // A veces Instagram no sirve la embed (y sin ella no hay views): un segundo
  // intento por la ruta de reel antes de caer al og:description.
  if (!emb) emb = datosDeEmbed(await html(`https://www.instagram.com/reel/${code}/embed/captioned/`).catch(() => ''));
  let og = null;
  if (!emb || emb.likes == null || emb.comentarios == null || !emb.creador) {
    const pag = await html(`https://www.instagram.com/p/${code}/`);
    const m = pag.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)
           || pag.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i);
    if (m) {
      const desc = decodificar(m[1]);
      og = {
        likes: contar(desc, 'likes?'),
        comentarios: contar(desc, 'comments?'),
        creador: desc.match(/ - ([\w.]+) on /)?.[1] || null,
        caption: (desc.match(/:\s*"([\s\S]*)$/)?.[1] || '').replace(/"\.?\s*$/, ''),
      };
    }
  }
  if (!emb && !og) throw new Error('Instagram no devolvió datos');
  return {
    views: emb?.views ?? null,
    likes: emb?.likes ?? og?.likes ?? null,
    comentarios: emb?.comentarios ?? og?.comentarios ?? null,
    creador: emb?.creador || og?.creador || null,
    caption: emb?.caption || og?.caption || '',
  };
}

// Video de un reel (para transcribirlo). La página embed trae el mp4 en un
// JSON escapado dos veces: video_url\":\"https:\\\/\\\/...mp4?...\"
// Los carruseles y las fotos no tienen video_url. Devuelve la Response del CDN
// sin leerla: el cuerpo se pasa como stream a Whisper (un reel pesa hasta 30+
// MB y pasarlo a base64 en la Function se come el límite de CPU).
export async function videoIg(link) {
  const code = codigoIg(link);
  if (!code) throw new Error('link de Instagram inválido');
  const emb = await html(`https://www.instagram.com/p/${code}/embed/captioned/`);
  const m = emb.match(/video_url\\*"\s*:\s*\\*"(.*?)\\*"/);
  if (!m) throw new Error('no es un video (carrusel o foto): no hay audio para transcribir');
  const src = m[1].replace(/\\+\//g, '/').replace(/\\+u0026/g, '&').replace(/&amp;/g, '&');
  const r = await fetch(src, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`CDN del video respondió ${r.status}`);
  return r;
}

export function aBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
