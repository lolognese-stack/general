// Itinerarios de la web publicada (lunallenatravel.vercel.app) dentro del CRM.
// "Actualizar desde la web": el panel pide la lista, lee las fichas en tandas (Cloudflare deja 50 lecturas por pedido),
// muestra qué cambió y recién ahí aplica. Port de luna-llena-armador/scripts/gen-catalogo.mjs (que leía carpetas locales).
//
// La web es la fuente de verdad de nombres, días y precio PUBLICADO. Ese precio es de venta y siempre es "sugerido":
// el cotizador nunca lo toma por bueno hasta que alguien lo confirma (ct_lineas.sin_confirmar).
import { json } from './auth.js';

export const WEB_POR_DEFECTO = 'https://lunallenatravel.vercel.app';
export const TANDA = 30;   // fichas por pedido: 30 + la lista = 31 lecturas, bajo el límite de 50

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
export const limpiar = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, ' ').trim();
export const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const norm = (s) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const absoluta = (u, base) => {
  if (!u) return '';
  const url = u.startsWith('/') ? base + u : u;
  return /^https:\/\//.test(url) ? url : '';
};

// ---------- ficha de la web -> datos ----------
export function parseFicha(html, base = WEB_POR_DEFECTO) {
  const titulo = limpiar((html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1]);
  if (!titulo) return null;
  const eyebrow = limpiar((html.match(/<span class="eyebrow">([^<]*)<\/span>\s*<h1>/) || [])[1]);
  const resumen = limpiar((html.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
  const precio = Number((html.match(/data-price="(\d+)"/) || [])[1]) || 0;
  const hero = absoluta((html.match(/name="img" value="([^"]+)"/) || [])[1], base) || absoluta((html.match(/<div class="gallery">[\s\S]*?<img src="([^"]+)"/) || [])[1], base);
  const galeria = [...(html.match(/<div class="gallery">([\s\S]*?)<\/div>/) || ['', ''])[1].matchAll(/<img src="([^"]+)"/g)].map((m) => absoluta(m[1], base)).filter(Boolean);
  const dias = [];
  for (const art of html.split('<article class="day">').slice(1)) {
    const cuerpo = art.split('</article>')[0];
    const pasos = [];
    for (const li of cuerpo.matchAll(/<li class="step[^"]*">([\s\S]*?)<\/li>/g)) {
      const b = li[1];
      const img = b.match(/<img src="([^"]+)"/);
      pasos.push({
        hora: limpiar((b.match(/<time class="step__time">([^<]*)</) || [])[1]),
        titulo: limpiar((b.match(/<h4 class="step__title">([\s\S]*?)<\/h4>/) || [])[1]),
        texto: limpiar((b.match(/<p class="step__text">([\s\S]*?)<\/p>/) || [])[1]),
        foto: img ? absoluta(img[1], base) : '',
      });
    }
    dias.push({ label: limpiar((cuerpo.match(/day__label">([^<]*)</) || [])[1]), titulo: limpiar((cuerpo.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]), pasos });
  }
  const bloque = (clase) => {
    const m = html.match(new RegExp(`<div class="${clase}">([\\s\\S]*?)</div>`));
    return m ? [...m[1].matchAll(/<li>(?:<i[^>]*><\/i>)?([\s\S]*?)<\/li>/g)].map((x) => limpiar(x[1])).filter(Boolean) : [];
  };
  return { titulo, eyebrow, resumen, precio, hero, galeria, dias, incluye: bloque('yes'), noIncluye: bloque('no') };
}

// ---------- ciudad de cada día ----------
// Reglas mías, sin validar (se ven en la pestaña Itinerarios). La primera que coincide gana.
const REGLAS_CIUDAD = [
  [/uyuni/i, 'Uyuni'], [/tambopata|puerto maldonado|selva/i, 'Puerto Maldonado'], [/nazca/i, 'Nazca'], [/paracas|ballestas/i, 'Paracas'],
  [/huacachina|\bica\b/i, 'Ica'], [/colca|arequipa/i, 'Arequipa'], [/puno|titicaca|uros|taquile|sillustani|ruta del sol/i, 'Puno'],
  [/\blima\b|parque de las aguas/i, 'Lima'], [/huaraz|huascar[aá]n|laguna 69|llanganuco/i, 'Huaraz'],
  [/cusco|valle sagrado|machu|aguas calientes|ollantay|pisac|maras|moray|humantay|monta[nñ]a de colores|vinicunca|sacsayhuam[aá]n/i, 'Cusco'],
];
export const ciudadDe = (texto, porDefecto) => { for (const [re, c] of REGLAS_CIUDAD) if (re.test(texto)) return c; return porDefecto; };
// Zonas de la web que se hacen alojándose en otra ciudad.
const BASE_ZONA = { 'machu picchu': 'Cusco', 'valle sagrado': 'Cusco', cusco: 'Cusco', huaraz: 'Huaraz' };
export const ciudadBase = (zona) => BASE_ZONA[norm(zona)] || String(zona || '').split(/,| y /)[0].trim() || 'Cusco';

const corto = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
function hashDe(txt) { let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

// Entrada del catálogo publicado (data/catalogo.json) + ficha -> producto normalizado.
export function aProducto(c, ficha) {
  const tipo = c.tipo === 'paquete' ? 'paquete' : 'tour';
  // Algunas fichas traen la duración mal (un trek de "3D/2N" figura de 1 día): el nombre y los días de la ficha también cuentan.
  const enNombre = Number((String(c.nombre).match(/(\d+)\s*D\s*[\/-]\s*\d+\s*N/i) || [])[1]) || 0;
  const dias = Math.max(1, Number(c.duracion?.dias) || 0, ficha?.dias?.length || 0, enNombre);
  const noches = Number.isInteger(c.duracion?.noches) && !enNombre ? c.duracion.noches : Math.max(0, dias - 1);
  const base = ciudadBase(c.zona);
  const fichaDias = ficha?.dias || [];
  let previa = tipo === 'paquete' ? (String(c.zona || '').split(/,| y /)[0].trim() || base) : base;
  const diasProd = tipo === 'paquete'
    ? fichaDias.map((d, i) => {
      const ciudad = ciudadDe(`${d.titulo} ${d.pasos.map((p) => p.titulo).join(' ')}`, previa);
      previa = ciudad;
      return { dia: i + 1, ciudad, titulo: d.titulo, relato: corto(d.pasos.map((p) => p.titulo).filter(Boolean).join(' · '), 400), foto: (d.pasos.find((p) => p.foto) || {}).foto || '' };
    })
    : [];
  const ciudades = tipo === 'paquete' ? [...new Set(diasProd.map((d) => d.ciudad))] : [base];
  const usd = c.tarifas && c.tarifas[0] && Number.isFinite(c.tarifas[0].usd) ? c.tarifas[0].usd : (ficha?.precio || null);
  const p = {
    id: c.id, tipo, nombre: c.nombre, zona: c.zona || '', ciudades: ciudades.length ? ciudades : [base], ciudad_base: base, dias, noches,
    precio_web_cent: c.consultar || !usd ? null : Math.round(usd * 100),
    url: c.url || '', resumen: ficha?.resumen || '', incluye: ficha?.incluye || [], no_incluye: ficha?.noIncluye || [],
    fotos: [ficha?.hero, ...(ficha?.galeria || [])].filter(Boolean).slice(0, 8), dias_detalle: diasProd,
  };
  p.hash = hashDe(JSON.stringify([p.nombre, p.zona, p.ciudades, p.dias, p.noches, p.precio_web_cent, p.incluye, p.no_incluye, p.dias_detalle.map((d) => [d.ciudad, d.titulo, d.relato])]));
  return p;
}

// ---------- diferencias contra lo guardado ----------
// guardados: filas de ct_web_productos (con .hash, .activo, .nombre); nuevos: productos normalizados.
export function diferencias(guardados, nuevos, { completo = true } = {}) {
  const g = new Map(guardados.map((x) => [x.id, x]));
  const altas = [], cambios = [], igual = [];
  for (const n of nuevos) {
    const v = g.get(n.id);
    if (!v) altas.push({ id: n.id, nombre: n.nombre });
    else if (v.hash !== n.hash || !v.activo) cambios.push({ id: n.id, nombre: n.nombre, antes: { precio_web_cent: v.precio_web_cent, dias: v.dias, nombre: v.nombre }, ahora: { precio_web_cent: n.precio_web_cent, dias: n.dias, nombre: n.nombre } });
    else igual.push(n.id);
  }
  const nuevosIds = new Set(nuevos.map((n) => n.id));
  const bajas = completo ? guardados.filter((x) => x.activo && !nuevosIds.has(x.id)).map((x) => ({ id: x.id, nombre: x.nombre })) : [];
  return { altas, cambios, bajas, sin_cambio: igual.length };
}

// ---------- lectura de la web ----------
export async function leerCatalogoWeb(env, fetchFn = fetch) {
  const base = String(env.WEB_URL || WEB_POR_DEFECTO).replace(/\/$/, '');
  const r = await fetchFn(`${base}/data/catalogo.json`);
  if (!r.ok) throw new Error(`La web no devolvió el catálogo (HTTP ${r.status})`);
  const j = await r.json();
  const lista = (j.productos || []).filter((p) => (p.tipo === 'tour' || p.tipo === 'paquete') && p.id && p.url).sort((a, b) => a.id.localeCompare(b.id));
  return { base, lista };
}

// Lee una tanda de fichas. Devuelve productos normalizados y los que fallaron (no frenan la tanda).
export async function leerTanda(env, { desde = 0, cuantos = TANDA } = {}, fetchFn = fetch) {
  const { base, lista } = await leerCatalogoWeb(env, fetchFn);
  const lote = lista.slice(desde, desde + Math.min(cuantos, TANDA));
  const errores = [];
  const productos = (await Promise.all(lote.map(async (c) => {
    try {
      const r = await fetchFn(base + c.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ficha = parseFicha(await r.text(), base);
      if (!ficha) throw new Error('la ficha no tiene título');
      return aProducto(c, ficha);
    } catch (e) { errores.push({ id: c.id, error: String(e.message || e).slice(0, 120) }); return null; }
  }))).filter(Boolean);
  const siguiente = desde + lote.length < lista.length ? desde + lote.length : null;
  return { total: lista.length, desde, siguiente, productos, errores, ids: lista.map((c) => c.id) };
}

// ---------- base de datos ----------
export async function productosGuardados(env) {
  return (await env.DB.prepare(`SELECT id, tipo, nombre, zona, ciudades, ciudad_base, dias, noches, precio_web_cent, url, hash, leido_en, activo FROM ct_web_productos ORDER BY tipo DESC, nombre`).all()).results
    .map((x) => ({ ...x, ciudades: safe(x.ciudades, []) }));
}
const safe = (t, d) => { try { return JSON.parse(t); } catch { return d; } };

export async function vistaDiferencias(env, nuevos, ids) {
  const g = await productosGuardados(env);
  const completo = Array.isArray(ids);
  const d = diferencias(g, nuevos, { completo: false });
  if (completo) { const set = new Set(ids); d.bajas = g.filter((x) => x.activo && !set.has(x.id)).map((x) => ({ id: x.id, nombre: x.nombre })); }
  return d;
}

export function sentenciasProducto(env, p) {
  const ahora = "datetime('now')";
  return [
    env.DB.prepare(`INSERT INTO ct_web_productos (id, tipo, nombre, zona, ciudades, ciudad_base, dias, noches, precio_web_cent, url, resumen, incluye, no_incluye, fotos, hash, leido_en, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${ahora}, 1)
      ON CONFLICT(id) DO UPDATE SET tipo = excluded.tipo, nombre = excluded.nombre, zona = excluded.zona, ciudades = excluded.ciudades, ciudad_base = excluded.ciudad_base,
        dias = excluded.dias, noches = excluded.noches, precio_web_cent = excluded.precio_web_cent, url = excluded.url, resumen = excluded.resumen, incluye = excluded.incluye,
        no_incluye = excluded.no_incluye, fotos = excluded.fotos, hash = excluded.hash, leido_en = ${ahora}, activo = 1`)
      .bind(p.id, p.tipo, p.nombre, p.zona, JSON.stringify(p.ciudades), p.ciudad_base, p.dias, p.noches, p.precio_web_cent, p.url, p.resumen, JSON.stringify(p.incluye), JSON.stringify(p.no_incluye), JSON.stringify(p.fotos), p.hash),
    env.DB.prepare(`DELETE FROM ct_web_dias WHERE producto_id = ?`).bind(p.id),
    ...(p.dias_detalle || []).map((d) => env.DB.prepare(`INSERT INTO ct_web_dias (producto_id, dia, ciudad, titulo, relato, foto) VALUES (?, ?, ?, ?, ?, ?)`).bind(p.id, d.dia, d.ciudad, d.titulo, d.relato, d.foto)),
  ];
}

const ok = (p) => p && typeof p.id === 'string' && /^[a-z0-9][a-z0-9-]{0,120}$/.test(p.id) && typeof p.nombre === 'string' && typeof p.hash === 'string' && Number.isInteger(p.dias);

export async function aplicarTanda(env, productos) {
  const buenos = (Array.isArray(productos) ? productos : []).filter(ok).slice(0, 30);
  if (!buenos.length) return json({ error: 'No hay productos para aplicar' }, 400);
  await env.DB.batch(buenos.flatMap((p) => sentenciasProducto(env, { ...p, ciudades: p.ciudades || [], incluye: p.incluye || [], no_incluye: p.no_incluye || [], fotos: p.fotos || [], dias_detalle: p.dias_detalle || [] })));
  return json({ ok: true, aplicados: buenos.length });
}

// Último paso: da de baja lo que ya no está en la web, une servicios del tarifario con tours por nombre y deja el registro.
export async function cerrarLectura(env, { ids, altas = 0, cambios = 0, detalle = null }, por) {
  if (!Array.isArray(ids) || !ids.length) return json({ error: 'Falta la lista de productos de la web' }, 400);
  const set = new Set(ids);
  const g = await productosGuardados(env);
  const bajas = g.filter((x) => x.activo && !set.has(x.id));
  const stmts = bajas.map((b) => env.DB.prepare(`UPDATE ct_web_productos SET activo = 0 WHERE id = ?`).bind(b.id));
  // Mapa servicio del tarifario <-> tour de la web (solo los que todavía no tienen uno).
  const servicios = (await env.DB.prepare(`SELECT id, nombre, ciudad FROM ct_servicios WHERE web_id IS NULL AND activo = 1`).all()).results;
  const tours = g.filter((x) => x.tipo === 'tour' && set.has(x.id));
  const mapeados = [];
  for (const s of servicios) {
    const n = norm(s.nombre);
    const t = tours.find((x) => norm(x.nombre) === n) || (n.length >= 10 ? tours.find((x) => { const m = norm(x.nombre); return m.includes(n) || n.includes(m); }) : null);
    if (t) { stmts.push(env.DB.prepare(`UPDATE ct_servicios SET web_id = ? WHERE id = ?`).bind(t.id, s.id)); mapeados.push({ servicio: s.nombre, web: t.nombre }); }
  }
  stmts.push(env.DB.prepare(`INSERT INTO ct_web_lecturas (por, altas, cambios, bajas, detalle) VALUES (?, ?, ?, ?, ?)`).bind(por, altas, cambios, bajas.length, JSON.stringify({ ...(detalle || {}), bajas: bajas.map((b) => b.id), mapeados })));
  await env.DB.batch(stmts);
  return json({ ok: true, bajas: bajas.length, mapeados });
}

export async function listaWeb(env) {
  const [p, l, s] = await env.DB.batch([
    env.DB.prepare(`SELECT id, tipo, nombre, zona, ciudades, ciudad_base, dias, noches, precio_web_cent, url, leido_en, activo FROM ct_web_productos ORDER BY activo DESC, tipo DESC, nombre`),
    env.DB.prepare(`SELECT * FROM ct_web_lecturas ORDER BY id DESC LIMIT 5`),
    env.DB.prepare(`SELECT id, nombre, ciudad, web_id, activo FROM ct_servicios ORDER BY ciudad, nombre`),
  ]);
  return json({ productos: p.results.map((x) => ({ ...x, ciudades: safe(x.ciudades, []) })), lecturas: l.results.map((x) => ({ ...x, detalle: safe(x.detalle, null) })), servicios: s.results });
}
