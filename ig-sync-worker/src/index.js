// Sync automático de Instagram (@lunallenatours) -> D1 crm-plantilla.
// Corre solo por cron (5am ART) y expone POST /sync para disparo manual.
// Copia de visite-web/sync-worker (mismo pipeline, mismas tablas); lo que
// cambia es la cuenta, la base y que acá no va el reporte semanal por mail.
// Si se arregla algo en uno, pasarlo al otro.

const WINDSOR_BASE = 'https://connectors.windsor.ai/instagram';
// Id de @lunallenatours en Windsor. Con select_accounts, si la key llega a
// tener otra cuenta conectada, esta no se mezcla.
const WINDSOR_CUENTA = '17841418494319693';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': 'https://crm-plantilla.pages.dev',
    'access-control-allow-headers': 'x-crm-token, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function checkToken(request, env) {
  const token = request.headers.get('x-crm-token');
  return token && env.CRM_TOKEN && token === env.CRM_TOKEN;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp0(v) {
  const n = num(v);
  return n === null ? null : Math.max(0, n);
}

// Idéntica a ig_import.mjs -- el shortcode de Instagram es case-sensitive,
// bajarlo rompe el link. Pisa el segmento de usuario opcional para que el
// permalink canónico sea siempre el mismo (con o sin /visite.ar/ en el medio),
// si no el upsert por video_url deja de matchear piezas ya cargadas.
function normalizarPermalink(url) {
  return String(url).trim()
    .replace(/\/?(\?.*)?$/, '/')
    .replace(/^https?:\/\/(www\.)?/, 'https://')
    .replace(/^(https:\/\/instagram\.com\/)[^/]+\/(reel|p)\//, '$1$2/');
}

const FORMATO_POR_TIPO = { CAROUSEL_ALBUM: 'Carrusel', IMAGE: 'Foto con copy' };

function tiempoProm(ms) {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ayer() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function diasAtras(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function windsorFetch(env, fields, extra = '') {
  if (!env.WINDSOR_API_KEY) throw new Error('Windsor sin la cuenta de ' + IG_USUARIO);
  const url = `${WINDSOR_BASE}?api_key=${env.WINDSOR_API_KEY}&select_accounts=${WINDSOR_CUENTA}&fields=${fields}${extra}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(`Windsor ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return Array.isArray(body) ? body : (body.data || []);
}

// == piezas (posts) ==========================================================
// Mismo patrón que ig_import.mjs: si el permalink ya existe, pisa SOLO
// campos de Performance + formato (nunca tema/hook/descripcion/cta/
// angulo_id/etiqueta_manychat/recurso_id/inspiracion). Si no existe, crea
// con estado=Subido y tema "(importado, sin clasificar)".
// Techo de la ventana histórica. Los comentarios y las views de un post
// siguen creciendo meses después de publicado, así que refrescar solo lo
// reciente deja el resto congelado para siempre.
const POSTS_MAX_DIAS = 400;

async function syncPosts(env, warnings) {
  // La ventana arranca en la primera pieza publicada, no en "hace 14 días".
  // Con ventana móvil por fecha de publicación pasaban dos cosas: las piezas
  // viejas nunca se volvían a mirar, y si pasabas 14 días sin publicar la
  // ventana quedaba vacía y no se actualizaba absolutamente nada.
  const piso = diasAtras(POSTS_MAX_DIAS);
  let primera = null;
  try {
    const row = await env.DB.prepare(
      `SELECT MIN(fecha) AS f FROM piezas WHERE estado='Subido' AND fecha IS NOT NULL`
    ).first();
    primera = row && row.f ? row.f : null;
  } catch (e) {
    warnings.push(`posts: no se pudo leer la fecha mínima (${e.message})`);
  }
  const desde = primera && primera > piso ? primera : piso;
  const hasta = ayer();
  // La foto lleva la fecha de la corrida: es "cuánto llevaba acumulado este
  // post hoy", no una métrica del día `hasta`.
  const hoy = new Date().toISOString().slice(0, 10);
  let rows;
  try {
    rows = await windsorFetch(
      env,
      // media_views faltaba: sin pedirlo llegaba undefined y el UPDATE lo
      // escribía como NULL, borrando las views que había cargado el import.
      'media_id,media_type,timestamp,media_permalink,media_views,media_reach,media_engagement,' +
      'media_like_count,media_comments_count,media_saved,media_shares,media_follows,' +
      'media_reel_avg_watch_time',
      `&date_from=${desde}&date_to=${hasta}`
    );
  } catch (e) {
    warnings.push(`posts: ${e.message}`);
    // Sin Windsor (se desconecta la cuenta o se cae el plan), plan B:
    // lo público de Instagram, igual que el "Traer datos" del Ideador.
    return syncPostsLibre(env, warnings);
  }

  // Si Windsor deja de mandar un campo, el COALESCE evita que se borre pero
  // el dato queda congelado sin aviso. Esto lo deja anotado en sync_runs.
  if (rows.length) {
    const conViews = rows.filter(r => r.media_views !== null && r.media_views !== undefined && r.media_views !== '').length;
    if (!conViews) warnings.push(`posts: Windsor no devolvió media_views en ninguna de las ${rows.length} filas -- las views quedan como estaban`);
  }

  let nuevos = 0, actualizados = 0;
  const now = new Date().toISOString();

  for (const r of rows) {
    if (!r.media_permalink) continue;
    const permalink = normalizarPermalink(r.media_permalink);
    const fecha = String(r.timestamp || '').slice(0, 10) || hasta;
    const formato = FORMATO_POR_TIPO[r.media_type] ?? null;
    const views = num(r.media_views ?? null);
    const reach = num(r.media_reach);
    const engagement = num(r.media_engagement);
    const likes = num(r.media_like_count);
    const comentarios = num(r.media_comments_count);
    const guardados = clamp0(r.media_saved);
    const compartidos = num(r.media_shares);
    const seguimientos = num(r.media_follows);
    const tiempo = tiempoProm(num(r.media_reel_avg_watch_time));

    const existente = await env.DB.prepare('SELECT id FROM piezas WHERE video_url = ?')
      .bind(permalink).first();

    // Foto del día para la serie por pieza. `piezas` sólo guarda el último
    // valor, así que sin esto la evolución de un post no se puede reconstruir:
    // Meta entrega las métricas de media como totales de vida, sin corte
    // diario, y lo que se pisa no vuelve.
    const snapshot = async (piezaId) => {
      if (!piezaId) return;
      try {
        await env.DB.prepare(
          `INSERT INTO piezas_metricas_dia
             (pieza_id, fecha, views, alcance, engagement, likes, comentarios,
              guardados, compartidos, seguimientos, tiempo_prom, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(pieza_id, fecha) DO UPDATE SET
             views=COALESCE(excluded.views, piezas_metricas_dia.views),
             alcance=COALESCE(excluded.alcance, piezas_metricas_dia.alcance),
             engagement=COALESCE(excluded.engagement, piezas_metricas_dia.engagement),
             likes=COALESCE(excluded.likes, piezas_metricas_dia.likes),
             comentarios=COALESCE(excluded.comentarios, piezas_metricas_dia.comentarios),
             guardados=COALESCE(excluded.guardados, piezas_metricas_dia.guardados),
             compartidos=COALESCE(excluded.compartidos, piezas_metricas_dia.compartidos),
             seguimientos=COALESCE(excluded.seguimientos, piezas_metricas_dia.seguimientos),
             tiempo_prom=COALESCE(excluded.tiempo_prom, piezas_metricas_dia.tiempo_prom),
             actualizado_en=excluded.actualizado_en`
        ).bind(piezaId, hoy, views, reach, engagement, likes, comentarios,
               guardados, compartidos, seguimientos, tiempo, now).run();
      } catch (e) {
        // Un fallo acá no puede tumbar el sync: la serie es un extra, las
        // métricas de la pieza ya quedaron guardadas.
        if (warnings.length < 6) warnings.push(`serie/${piezaId}: ${e.message}`);
      }
    };

    if (existente) {
      await env.DB.prepare(
        // COALESCE en todas las métricas: si la API no manda un campo, se
        // conserva lo que ya había. Sin esto un hueco de Windsor borra datos
        // buenos, que es justo lo que pasó con views.
        `UPDATE piezas SET estado='Subido',
           formato=COALESCE(?, formato),
           views=COALESCE(?, views),
           alcance=COALESCE(?, alcance),
           engagement=COALESCE(?, engagement),
           likes=COALESCE(?, likes),
           comentarios=COALESCE(?, comentarios),
           guardados=COALESCE(?, guardados),
           compartidos=COALESCE(?, compartidos),
           seguimientos=COALESCE(?, seguimientos),
           tiempo_prom=COALESCE(?, tiempo_prom), actualizado_en=?
         WHERE video_url = ?`
      ).bind(formato, views, reach, engagement, likes, comentarios, guardados, compartidos,
             seguimientos, tiempo, now, permalink).run();
      await snapshot(existente.id);
      actualizados++;
    } else {
      const creada = await env.DB.prepare(
        `INSERT INTO piezas
           (tema, fecha, estado, formato, video_url, views, alcance, engagement, likes,
            comentarios, guardados, compartidos, seguimientos, tiempo_prom, creado_en, actualizado_en)
         VALUES ('(importado, sin clasificar)', ?, 'Subido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(fecha, formato, permalink, views, reach, engagement, likes, comentarios,
             guardados, compartidos, seguimientos, tiempo, now, now).run();
      await snapshot(creada.meta && creada.meta.last_row_id);
      nuevos++;
    }
  }
  return { nuevos, actualizados };
}

// == metricas_cuenta_dia ======================================================
// Ventana de la serie diaria. Pedir sólo "ayer" dejaba un agujero permanente
// cada vez que una corrida fallaba: al día siguiente esa fecha ya no se volvía
// a mirar nunca. Con 30 días la corrida se auto-repara sola. El techo es de
// Meta, no una elección: follower_count_1d sólo responde los últimos 30 días.
const DAILY_DIAS = 30;
// Los días recientes todavía se mueven (Meta consolida con retraso), así que
// ahí el dato fresco pisa. Más atrás sólo se rellenan huecos: la historia
// vieja vino del import CSV de Instagram y no se toca.
const DAILY_DIAS_PISAR = 3;

const DAILY_COLS = [
  ['reach', 'reach_1d'],
  ['accounts_engaged', 'accounts_engaged'],
  ['total_interactions', 'total_interactions'],
  ['views', 'views'],
  ['likes', 'likes'],
  ['comments', 'comments'],
  ['saves', 'saves'],
  ['shares', 'shares'],
  ['new_followers', 'follower_count_1d'],
  ['profile_links_taps', 'profile_links_taps'],
  ['follows_unfollows', 'follows_and_unfollows'],
  ['replies', 'replies'],
  ['reposts', 'reposts'],
  ['profile_views', 'profile_views_1d'],
  ['website_clicks', 'website_clicks_1d'],
];

// Cada grupo va en su propio request. Son tablas distintas de Windsor
// (user_insights_day, ..._day_total_value, ..._breakdown) y pedirlas juntas
// devuelve un cruce con ceros; además, si un campo deprecado tira 400, se
// cae ese grupo solo y no la serie entera.
const DAILY_GRUPOS = [
  { nombre: 'core', campos: 'date,reach_1d,views,likes,comments,saves,shares,accounts_engaged,total_interactions', critico: true },
  { nombre: 'followers', campos: 'date,follower_count_1d', critico: true },
  { nombre: 'perfil', campos: 'date,profile_links_taps,replies,reposts', critico: false },
  { nombre: 'follows', campos: 'date,follows_and_unfollows', critico: false },
  // Deprecados por Meta: se piden igual porque algunas cuentas los siguen
  // devolviendo, y si no vienen quedan en NULL sin romper nada.
  { nombre: 'legacy', campos: 'date,profile_views_1d,website_clicks_1d', critico: false },
];

async function syncDaily(env, warnings) {
  const desde = diasAtras(DAILY_DIAS);
  const hasta = ayer();
  const pisarDesde = diasAtras(DAILY_DIAS_PISAR);
  const rango = `&date_from=${desde}&date_to=${hasta}`;

  // fecha -> fila combinada de todos los grupos.
  const porFecha = new Map();
  for (const g of DAILY_GRUPOS) {
    let rows;
    try {
      rows = await windsorFetch(env, g.campos, rango);
    } catch (e) {
      warnings.push(`daily/${g.nombre}: ${e.message}`);
      if (g.critico) return 0;
      continue;
    }
    for (const r of rows) {
      const fecha = String(r.date || '').slice(0, 10);
      if (!fecha) continue;
      if (!porFecha.has(fecha)) porFecha.set(fecha, {});
      Object.assign(porFecha.get(fecha), r);
    }
  }

  if (!porFecha.size) { warnings.push(`daily: sin datos entre ${desde} y ${hasta}`); return 0; }

  const cols = DAILY_COLS.map(([c]) => c);
  const now = new Date().toISOString();
  let upserted = 0;

  for (const [fecha, r] of porFecha) {
    const reciente = fecha >= pisarDesde;
    // Reciente: el valor nuevo gana pero un NULL no borra (COALESCE del lado
    // de excluded). Histórico: sólo se completan los NULL que ya estaban.
    const set = cols.map((c) => reciente
      ? `${c}=COALESCE(excluded.${c}, metricas_cuenta_dia.${c})`
      : `${c}=COALESCE(metricas_cuenta_dia.${c}, excluded.${c})`).join(', ');

    const valores = DAILY_COLS.map(([col, campo]) =>
      col === 'saves' ? clamp0(r[campo]) : num(r[campo]));

    await env.DB.prepare(
      `INSERT INTO metricas_cuenta_dia (fecha, ${cols.join(', ')}, actualizado_en)
       VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
       ON CONFLICT(fecha) DO UPDATE SET ${set}, actualizado_en=excluded.actualizado_en`
    ).bind(fecha, ...valores, now).run();
    upserted++;
  }

  // Igual que con media_views: si un campo deja de venir, el COALESCE evita
  // que se borre pero el dato queda congelado sin que nadie se entere.
  // profile_views_1d no va: Meta lo deprecó y para @lunallenatours no viene
  // nunca, así que el aviso dejaba el botón de sync siempre "(con errores)".
  ['profile_links_taps', 'follows_and_unfollows'].forEach((campo) => {
    const con = [...porFecha.values()].filter((r) => r[campo] !== null && r[campo] !== undefined && r[campo] !== '').length;
    if (!con) warnings.push(`daily: Windsor no devolvió ${campo} en ninguno de los ${porFecha.size} días`);
  });

  return upserted;
}

// == demografia_ig (snapshot único -- decisión ya tomada, no versionar) =====
async function syncDemografia(env, warnings) {
  let account;
  try {
    const rows = await windsorFetch(env, 'username,followers_count,follows_count,media_count,website');
    account = rows[0] || {};
  } catch (e) {
    warnings.push(`demografia/account: ${e.message}`);
    return false;
  }

  const fetchSeccion = async (fields) => {
    try { return await windsorFetch(env, fields); }
    catch (e) { warnings.push(`demografia/${fields}: ${e.message}`); return []; }
  };

  const edadRaw = await fetchSeccion('audience_age_name,audience_age_size');
  const generoRaw = await fetchSeccion('audience_gender_name,audience_gender_size');
  const generoEdadRaw = await fetchSeccion('audience_gender_age_name,audience_gender_age_size');
  const paisesRaw = await fetchSeccion('audience_country_name,audience_country_size');
  const ciudadesRaw = await fetchSeccion('city,audience_city_size'); // conocido: a veces 500, ya cubierto por fetchSeccion

  const edad = edadRaw.map((r) => ({ age_group: r.audience_age_name, followers: num(r.audience_age_size) }));
  const genero = generoRaw.map((r) => ({ gender: r.audience_gender_name, followers: num(r.audience_gender_size) }));
  const generoEdad = generoEdadRaw.map((r) => ({ gender_age: r.audience_gender_age_name, followers: num(r.audience_gender_age_size) }));
  const paises = paisesRaw.map((r) => ({ country_code: r.audience_country_name, followers: num(r.audience_country_size) }));
  const ciudades = ciudadesRaw.map((r) => ({ city: r.city, followers: num(r.audience_city_size) }));

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO demografia_ig
       (id, username, followers_count, follows_count, media_count, website,
        edad_json, genero_json, genero_edad_json, paises_json, ciudades_json, actualizado_en)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       username=excluded.username, followers_count=excluded.followers_count,
       follows_count=excluded.follows_count, media_count=excluded.media_count,
       website=excluded.website, edad_json=excluded.edad_json, genero_json=excluded.genero_json,
       genero_edad_json=excluded.genero_edad_json, paises_json=excluded.paises_json,
       ciudades_json=excluded.ciudades_json, actualizado_en=excluded.actualizado_en`
  ).bind(account.username ?? null, num(account.followers_count), num(account.follows_count),
         num(account.media_count), account.website ?? null,
         JSON.stringify(edad), JSON.stringify(genero), JSON.stringify(generoEdad),
         JSON.stringify(paises), JSON.stringify(ciudades), now).run();
  return true;
}

// == Plan B: posts desde lo público de Instagram ===============================
// Sin login ni API: el crawler de Facebook ve la embed del perfil (los últimos
// 6 posteos, con fecha, tipo, likes, comentarios y caption) y la página de
// embed de cada post (likes, comentarios y, en reels, views). NO trae
// alcance, guardados ni compartidos (ni views de carruseles): eso es privado
// y solo sale de la API oficial; esos campos quedan como estaban (COALESCE).
//
// Límites del plan gratis de Workers: 50 subrequests por corrida (por eso
// MAX_REFRESCOS) y 10 ms de CPU (por eso de cada post se lee solo hasta los
// números y se corta).

const IG_USUARIO = 'lunallenatours';
const UA_FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MAX_REFRESCOS = 15;
const TIPO_EMBED = { GraphSidecar: 'Carrusel', GraphImage: 'Foto con copy' }; // GraphVideo (reel): sin clasificar

function contarIg(texto, palabra) {
  const m = texto.match(new RegExp(`([\\d.,]+)\\s*([KMB])?\\s+${palabra}`, 'i'));
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1;
  const n = mult > 1 ? parseFloat(m[1].replace(',', '.')) : Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

// Lee la respuesta hasta encontrar `marca` (y `hasta` bytes de margen) y corta.
async function leerHasta(res, marca, maxBytes) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let txt = '';
  while (txt.length < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    txt += dec.decode(value, { stream: true });
    if (marca && txt.indexOf(marca) !== -1 && txt.indexOf('>', txt.indexOf(marca)) !== -1) break;
  }
  try { await reader.cancel(); } catch {}
  return txt;
}

async function postsDelPerfil() {
  const res = await fetch(`https://www.instagram.com/${IG_USUARIO}/embed/`, { headers: { 'User-Agent': UA_FB } });
  if (!res.ok) throw new Error(`embed del perfil respondió ${res.status}`);
  const h = await res.text();
  const ini = h.indexOf('"contextJSON":"');
  if (ini === -1) throw new Error('la embed del perfil no trae contextJSON');
  let j = ini + 15;
  while (j < h.length && h[j] !== '"') j += h[j] === '\\' ? 2 : 1;
  const ctx = JSON.parse(JSON.parse('"' + h.slice(ini + 15, j) + '"'));
  const lista = (ctx.context && ctx.context.graphql_media) || [];
  return lista.map((x) => x.shortcode_media).filter((n) => n && n.shortcode && n.taken_at_timestamp);
}

// Likes, comentarios y (en reels) views de un post, desde su embed: la página
// común del post responde 429 a Cloudflare, la embed no. Los números están
// a ~200 KB de iniciado el HTML; se lee hasta ahí y se corta.
async function metricasDePost(url) {
  const code = String(url).match(/\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1];
  if (!code) return { motivo: 'link sin código' };
  const res = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, { headers: { 'User-Agent': UA_FB } });
  if (!res.ok) { try { await res.body.cancel(); } catch {} return { motivo: `HTTP ${res.status}` }; }
  const html = await leerHasta(res, 'edge_liked_by', 600000);
  const n = (re) => { const m = html.match(re); return m ? Number(m[1]) : null; };
  // En el HTML van escapados: edge_liked_by\":{\"count\":230
  const likes = n(/edge_liked_by\\*":\{\\*"count\\*":(\d+)/);
  const comentarios = n(/edge_media_to_comment\\*":\{\\*"count\\*":(\d+)/);
  const views = n(/video_view_count\\*":(\d+)/);
  if (likes === null && comentarios === null) return { motivo: `la embed no trae números (${html.length} bytes)` };
  return { likes, comentarios, views };
}

async function snapshotLibre(env, piezaId, likes, comentarios, hoy, now, views = null) {
  await env.DB.prepare(
    `INSERT INTO piezas_metricas_dia (pieza_id, fecha, views, likes, comentarios, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pieza_id, fecha) DO UPDATE SET
       views=COALESCE(excluded.views, piezas_metricas_dia.views),
       likes=COALESCE(excluded.likes, piezas_metricas_dia.likes),
       comentarios=COALESCE(excluded.comentarios, piezas_metricas_dia.comentarios),
       actualizado_en=excluded.actualizado_en`
  ).bind(piezaId, hoy, views, likes, comentarios, now).run();
}

async function syncPostsLibre(env, warnings) {
  const now = new Date().toISOString();
  const hoy = now.slice(0, 10);
  let nuevos = 0, actualizados = 0;
  const tocadas = new Set();

  // 1. Últimos posteos del perfil: los nuevos entran como piezas Subido.
  let recientes = [];
  try { recientes = await postsDelPerfil(); }
  catch (e) { warnings.push(`posts (perfil público): ${e.message}`); }

  for (const n of recientes) {
    const code = n.shortcode;
    // Con los likes ocultos la embed manda 0: mejor no pisar nada.
    const likes = n.edge_liked_by && !n.like_and_view_counts_disabled ? num(n.edge_liked_by.count) : null;
    const comentarios = n.edge_media_to_comment ? num(n.edge_media_to_comment.count) : null;
    // Fecha y hora en Argentina (UTC-3 fijo).
    const art = new Date((n.taken_at_timestamp - 3 * 3600) * 1000).toISOString();
    const existente = await env.DB.prepare(`SELECT id FROM piezas WHERE video_url LIKE ?`)
      .bind(`%/${code}/`).first();
    if (existente) {
      await env.DB.prepare(
        `UPDATE piezas SET estado='Subido', likes=COALESCE(?, likes), comentarios=COALESCE(?, comentarios), actualizado_en=? WHERE id=?`
      ).bind(likes, comentarios, now, existente.id).run();
      await snapshotLibre(env, existente.id, likes, comentarios, hoy, now);
      tocadas.add(existente.id);
      actualizados++;
    } else {
      const caption = (n.edge_media_to_caption && n.edge_media_to_caption.edges[0] && n.edge_media_to_caption.edges[0].node.text) || null;
      const tipo = n.__typename === 'GraphVideo' ? 'reel' : 'p';
      const creada = await env.DB.prepare(
        `INSERT INTO piezas (tema, fecha, hora_publicacion, estado, formato, video_url, descripcion, likes, comentarios, creado_en, actualizado_en)
         VALUES ('(importado, sin clasificar)', ?, ?, 'Subido', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(art.slice(0, 10), art.slice(11, 16), TIPO_EMBED[n.__typename] ?? null,
             `https://instagram.com/${tipo}/${code}/`, caption, likes, comentarios, now, now).run();
      const id = creada.meta && creada.meta.last_row_id;
      if (id) { await snapshotLibre(env, id, likes, comentarios, hoy, now); tocadas.add(id); }
      nuevos++;
    }
  }

  // 2. El resto de lo publicado: likes y comentarios siguen creciendo. Se
  //    refrescan de a MAX_REFRESCOS por corrida, las que hace más que no se miran.
  const { results } = await env.DB.prepare(
    `SELECT id, video_url FROM piezas WHERE estado='Subido' AND video_url LIKE '%instagram.com/%'
     ORDER BY actualizado_en ASC LIMIT ?`
  ).bind(MAX_REFRESCOS + tocadas.size).all();
  let fallidas = 0;
  for (const p of results.filter((x) => !tocadas.has(x.id)).slice(0, MAX_REFRESCOS)) {
    const m = await metricasDePost(p.video_url).catch((e) => ({ motivo: e.message }));
    if (!m || m.motivo || (m.likes === null && m.comentarios === null)) {
      if (!fallidas && m && m.motivo) warnings.push(`posts: ${p.video_url} -> ${m.motivo}`);
      fallidas++;
      // Igual se marca como mirada, para que la rotación avance.
      await env.DB.prepare(`UPDATE piezas SET actualizado_en=? WHERE id=?`).bind(now, p.id).run();
      continue;
    }
    await env.DB.prepare(
      `UPDATE piezas SET likes=COALESCE(?, likes), comentarios=COALESCE(?, comentarios), views=COALESCE(?, views), actualizado_en=? WHERE id=?`
    ).bind(m.likes, m.comentarios, m.views, now, p.id).run();
    await snapshotLibre(env, p.id, m.likes, m.comentarios, hoy, now, m.views);
    actualizados++;
    // Sin pausa Instagram empieza a responder 429.
    await new Promise((r) => setTimeout(r, 400));
  }
  warnings.push(`posts: modo sin Windsor (perfil público) -- ${recientes.length} recientes vistos, sin alcance/guardados${fallidas ? `, ${fallidas} posts sin datos` : ''}`);
  return { nuevos, actualizados, fuente: 'libre' };
}

// Mismo control que en el worker de Visite: si la key de Windsor no tiene a
// @lunallenatours, no se usa (los posts caen al plan B).
async function cuentaEsLaNuestra(env, warnings) {
  try {
    const rows = await windsorFetch(env, 'username');
    if (rows.some((r) => r.username === IG_USUARIO)) return true;
    warnings.push(`windsor: la key tiene ${rows.map((r) => r.username).join(', ') || 'ninguna cuenta'}, no ${IG_USUARIO} -- no se usa`);
  } catch (e) {
    warnings.push(`windsor: ${e.message}`);
  }
  return false;
}

async function runSync(env) {
  const startedAt = new Date().toISOString();
  const { meta } = await env.DB.prepare(
    `INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`
  ).bind(startedAt).run();
  const runId = meta.last_row_id;

  const warnings = [];
  let posts = { nuevos: 0, actualizados: 0 };
  let dailyUpserted = 0;
  let demografiaOk = false;
  let fatal = null;

  try {
    if (!(await cuentaEsLaNuestra(env, warnings))) env = { ...env, WINDSOR_API_KEY: null };
    posts = await syncPosts(env, warnings);
    dailyUpserted = await syncDaily(env, warnings);
    demografiaOk = await syncDemografia(env, warnings);
  } catch (e) {
    fatal = e.message;
  }

  const finishedAt = new Date().toISOString();
  const status = fatal ? 'error' : 'ok';
  const errorMsg = fatal ? fatal : (warnings.length ? warnings.join(' | ') : null);

  await env.DB.prepare(
    `UPDATE sync_runs SET finished_at=?, status=?, posts_new=?, posts_updated=?,
       daily_upserted=?, demografia_ok=?, error=? WHERE id=?`
  ).bind(finishedAt, status, posts.nuevos, posts.actualizados, dailyUpserted,
         demografiaOk ? 1 : 0, errorMsg, runId).run();

  return {
    id: runId, status, posts_new: posts.nuevos, posts_updated: posts.actualizados,
    daily_upserted: dailyUpserted, demografia_ok: demografiaOk, warnings,
    fuente: posts.fuente || 'windsor',
  };
}


export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    if (url.pathname === '/sync' && request.method === 'POST') {
      if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401, corsHeaders());
      const result = await runSync(env);
      return json(result, 200, corsHeaders());
    }

    if (url.pathname === '/status' && request.method === 'GET') {
      if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401, corsHeaders());
      const { results } = await env.DB.prepare(
        'SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 30'
      ).all();
      return json(results, 200, corsHeaders());
    }

    return json({ error: 'not found' }, 404, corsHeaders());
  },
};
