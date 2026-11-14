// API del cotizador interno (tarifario, configuración, importador). Todo detrás del token del CRM.
//   GET    /api/ct/tarifario                   servicios + tarifas + hoteles + tarifas de hotel
//   POST   /api/ct/servicios                   alta de servicio          PUT /api/ct/servicios/:id
//   POST   /api/ct/tarifas                     alta de tarifa            PUT|DELETE /api/ct/tarifas/:id
//   POST   /api/ct/hoteles                     alta de hotel             PUT /api/ct/hoteles/:id
//   POST   /api/ct/hotel-tarifas               alta de tarifa de hotel   PUT|DELETE /api/ct/hotel-tarifas/:id
//   GET    /api/ct/config                      configuración + temporadas
//   PUT    /api/ct/config                      { valores: {clave: valor}, temporadas?: [...] }
//   POST   /api/ct/importar                    { filas, aplicar, reemplazar_ilustrativas, fuente }
//   GET    /api/ct/cambios?entidad=&id=        registro de cambios de precio
//   GET    /api/ct/pedidos                     tablero        POST /api/ct/pedidos (alta + borrador automático)
//   GET|PUT /api/ct/pedidos/:id               ver / editar datos del pedido
//   POST   /api/ct/pedidos/:id/estado          { estado, nota }      POST /api/ct/pedidos/:id/rearmar
//   GET|PUT /api/ct/cotizaciones/:id          ver (recalcula) / { notas_alvaro, usar_config_actual }
//   POST   /api/ct/cotizaciones/:id/lineas     agregar línea   PUT|DELETE /api/ct/cotizaciones/:id/lineas/:lid
//   POST   /api/ct/cotizaciones/:id/nueva-version          GET /api/ct/cotizaciones/:id/cambios
//   POST   /api/ct/cotizaciones/:id/revision   { revisor, nuevo_link } -> { token } (el token solo se ve esta vez)
// Quién: header x-crm-usuario (lo elige cada dispositivo en la página: "Soy Lorenzo / Soy Álvaro").
import { rolDe, json } from '../../_lib/auth.js';
import {
  leerFila, revisarArchivo, claveServicio, claveHotel, solapan, describirTramo,
  TIPOS_SERVICIO, CATEGORIAS,
} from '../../_lib/tarifario.js';
import {
  listarPedidos, crearPedido, verPedido, editarPedido, estadoPedido, rearmar, nuevaVersion,
  vistaCotizacion, editarCotizacion, agregarLinea, editarLinea, borrarLinea, cambiosCotizacion,
} from '../../_lib/ct-cotizaciones.js';
import { mandarARevision } from '../../_lib/ct-revision.js';

const CONFIG = {
  margen_pct: { min: 0, max: 300, nombre: 'Margen por defecto (%)' },
  tc_pen_por_usd: { min: 0.5, max: 20, nombre: 'Tipo de cambio (soles por dólar)' },
  recargo_tarjeta_pct: { min: 0, max: 50, nombre: 'Recargo por tarjeta (%)' },
  igv_pct: { min: 0, max: 50, nombre: 'IGV (%)' },
};

function quien(request, rol) {
  let u = request.headers.get('x-crm-usuario') || '';
  try { u = decodeURIComponent(u); } catch {}
  u = u.replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40);
  return u || (rol === 'admin' ? 'admin' : 'equipo');
}
const leerJson = async (request) => { try { return await request.json(); } catch { return {}; } };
const ahora = "datetime('now')";
const texto = (v, max = 2000) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

// Fila de la base -> formato de leerFila (para controlar solapamientos).
const comoTarifa = (t) => ({ clase: 'servicio', clave: t.clave, nombre: t.nombre, temporada: t.temporada, pax_desde: t.pax_desde, pax_hasta: t.pax_hasta, vigente_desde: t.vigente_desde, vigente_hasta: t.vigente_hasta, es_ilustrativa: t.es_ilustrativa, id: t.id });
const comoHotelTarifa = (t) => ({ clase: 'hotel', clave: t.clave, nombre: t.nombre, habitacion: t.habitacion, temporada: t.temporada, vigente_desde: t.vigente_desde, vigente_hasta: t.vigente_hasta, es_ilustrativa: t.es_ilustrativa, id: t.id });

async function existentes(env) {
  const [a, b] = await env.DB.batch([
    env.DB.prepare(`SELECT t.*, s.clave, s.nombre FROM ct_tarifas t JOIN ct_servicios s ON s.id = t.servicio_id`),
    env.DB.prepare(`SELECT t.*, h.clave, h.nombre FROM ct_hotel_tarifas t JOIN ct_hoteles h ON h.id = t.hotel_id`),
  ]);
  return [...a.results.map(comoTarifa), ...b.results.map(comoHotelTarifa)];
}

const registro = (env, entidad, id, campo, antes, despues, por, motivo = null) =>
  env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por, motivo) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(entidad, String(id), campo, antes === null || antes === undefined ? null : String(antes), despues === null || despues === undefined ? null : String(despues), por, motivo);

const precioTxt = (cent, moneda) => cent === null || cent === undefined ? null : `${moneda} ${(cent / 100).toFixed(2)}`;

// ---------- tarifario ----------
async function getTarifario(env) {
  const [s, t, h, ht] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM ct_servicios ORDER BY ciudad, nombre`),
    env.DB.prepare(`SELECT * FROM ct_tarifas ORDER BY servicio_id, temporada, pax_desde, vigente_desde`),
    env.DB.prepare(`SELECT * FROM ct_hoteles ORDER BY ciudad, CASE categoria WHEN 'economico' THEN 1 WHEN 'confort' THEN 2 ELSE 3 END, nombre`),
    env.DB.prepare(`SELECT * FROM ct_hotel_tarifas ORDER BY hotel_id, CASE habitacion WHEN 'SGL' THEN 1 WHEN 'DBL' THEN 2 ELSE 3 END, temporada, vigente_desde`),
  ]);
  const porServ = new Map(), porHotel = new Map();
  for (const x of t.results) (porServ.get(x.servicio_id) || porServ.set(x.servicio_id, []).get(x.servicio_id)).push(x);
  for (const x of ht.results) (porHotel.get(x.hotel_id) || porHotel.set(x.hotel_id, []).get(x.hotel_id)).push(x);
  const ilustrativas = t.results.filter((x) => x.es_ilustrativa).length + ht.results.filter((x) => x.es_ilustrativa).length;
  return {
    servicios: s.results.map((x) => ({ ...x, tarifas: porServ.get(x.id) || [] })),
    hoteles: h.results.map((x) => ({ ...x, tarifas: porHotel.get(x.id) || [] })),
    resumen: { ilustrativas, reales: t.results.length + ht.results.length - ilustrativas },
  };
}

function validarServicio(b) {
  const errores = [];
  const nombre = texto(b.nombre, 160), ciudad = texto(b.ciudad, 60), tipo = String(b.tipo || '');
  if (!nombre) errores.push('falta el nombre');
  if (!ciudad) errores.push('falta la ciudad');
  if (!TIPOS_SERVICIO.includes(tipo)) errores.push('tipo no válido');
  const pax_min = b.pax_min === undefined || b.pax_min === '' || b.pax_min === null ? 1 : Number(b.pax_min);
  if (!Number.isInteger(pax_min) || pax_min < 1) errores.push('el mínimo de pasajeros tiene que ser un entero desde 1');
  return { errores, d: { nombre, ciudad, tipo, pax_min, duracion: texto(b.duracion, 80), incluye: texto(b.incluye), no_incluye: texto(b.no_incluye), precio_es_venta: b.precio_es_venta ? 1 : 0, activo: b.activo === undefined ? 1 : (b.activo ? 1 : 0) } };
}

async function guardarServicio(env, id, body) {
  const { errores, d } = validarServicio(body);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  const clave = claveServicio(d.tipo, d.ciudad, d.nombre);
  const otro = await env.DB.prepare(`SELECT id FROM ct_servicios WHERE clave = ? AND id IS NOT ?`).bind(clave, id).first();
  if (otro) return json({ error: 'Ya existe un servicio con ese tipo, ciudad y nombre' }, 409);
  const vals = [clave, d.nombre, d.ciudad, d.tipo, d.duracion, d.incluye, d.no_incluye, d.pax_min, d.precio_es_venta, d.activo];
  if (id) {
    const r = await env.DB.prepare(`UPDATE ct_servicios SET clave=?, nombre=?, ciudad=?, tipo=?, duracion=?, incluye=?, no_incluye=?, pax_min=?, precio_es_venta=?, activo=?, actualizado_en=${ahora} WHERE id=?`).bind(...vals, id).run();
    if (!r.meta.changes) return json({ error: 'No existe' }, 404);
    return json({ ok: true, id });
  }
  const r = await env.DB.prepare(`INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min, precio_es_venta, activo) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

function validarHotel(b) {
  const errores = [];
  const nombre = texto(b.nombre, 160), ciudad = texto(b.ciudad, 60), categoria = String(b.categoria || '');
  if (!nombre) errores.push('falta el nombre');
  if (!ciudad) errores.push('falta la ciudad');
  if (!CATEGORIAS.includes(categoria)) errores.push('categoría no válida');
  return { errores, d: { nombre, ciudad, categoria, es_ilustrativo: b.es_ilustrativo ? 1 : 0, precio_es_venta: b.precio_es_venta ? 1 : 0, activo: b.activo === undefined ? 1 : (b.activo ? 1 : 0) } };
}

async function guardarHotel(env, id, body) {
  const { errores, d } = validarHotel(body);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  const clave = claveHotel(d.ciudad, d.categoria, d.nombre);
  const otro = await env.DB.prepare(`SELECT id FROM ct_hoteles WHERE clave = ? AND id IS NOT ?`).bind(clave, id).first();
  if (otro) return json({ error: 'Ya existe un hotel con esa ciudad, categoría y nombre' }, 409);
  const vals = [clave, d.ciudad, d.categoria, d.nombre, d.es_ilustrativo, d.precio_es_venta, d.activo];
  if (id) {
    const r = await env.DB.prepare(`UPDATE ct_hoteles SET clave=?, ciudad=?, categoria=?, nombre=?, es_ilustrativo=?, precio_es_venta=?, activo=?, actualizado_en=${ahora} WHERE id=?`).bind(...vals, id).run();
    if (!r.meta.changes) return json({ error: 'No existe' }, 404);
    return json({ ok: true, id });
  }
  const r = await env.DB.prepare(`INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo, precio_es_venta, activo) VALUES (?,?,?,?,?,?,?)`).bind(...vals).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

// Tarifa (de servicio o de hotel): se valida con la misma lectura que el importador.
async function guardarTarifa(env, clase, id, body, por) {
  const tabla = clase === 'hotel' ? 'ct_hotel_tarifas' : 'ct_tarifas';
  const entidad = clase === 'hotel' ? 'hotel_tarifa' : 'tarifa';
  let actual = null;
  if (id) {
    actual = await env.DB.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).bind(id).first();
    if (!actual) return json({ error: 'No existe' }, 404);
  }
  const padreId = clase === 'hotel' ? Number(body.hotel_id ?? actual?.hotel_id) : Number(body.servicio_id ?? actual?.servicio_id);
  const padre = await env.DB.prepare(`SELECT * FROM ${clase === 'hotel' ? 'ct_hoteles' : 'ct_servicios'} WHERE id = ?`).bind(padreId).first();
  if (!padre) return json({ error: clase === 'hotel' ? 'El hotel no existe' : 'El servicio no existe' }, 400);
  const cruda = clase === 'hotel'
    ? { tipo: 'hotel', nombre: padre.nombre, ciudad: padre.ciudad, categoria_hotel: padre.categoria, habitacion: body.habitacion }
    : { tipo: padre.tipo, nombre: padre.nombre, ciudad: padre.ciudad, pax_desde: body.pax_desde, pax_hasta: body.pax_hasta };
  Object.assign(cruda, { precio_neto: body.precio_neto, moneda: body.moneda, temporada: body.temporada, vigente_desde: body.vigente_desde, vigente_hasta: body.vigente_hasta, es_ilustrativa: body.es_ilustrativa ? 'si' : 'no' });
  const { errores, d } = leerFila(cruda);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  d.clave = padre.clave;
  // Solapamiento contra las otras tarifas del mismo servicio u hotel.
  const hermanas = (await env.DB.prepare(`SELECT * FROM ${tabla} WHERE ${clase === 'hotel' ? 'hotel_id' : 'servicio_id'} = ? AND id IS NOT ?`).bind(padreId, id).all()).results
    .map((t) => (clase === 'hotel' ? comoHotelTarifa : comoTarifa)({ ...t, clave: padre.clave, nombre: padre.nombre }));
  const choca = hermanas.find((e) => e.es_ilustrativa === d.es_ilustrativa && solapan(d, e));
  if (choca) return json({ error: `Se pisa con otra tarifa (${describirTramo(choca)}, ${choca.temporada}, del ${choca.vigente_desde} al ${choca.vigente_hasta}). Cerrá la vigencia de la otra primero.` }, 409);

  const motivo = texto(body.motivo, 200);
  const stmts = [];
  if (clase === 'hotel') {
    const vals = [padreId, d.habitacion, d.neto_cent, d.moneda, d.temporada, d.vigente_desde, d.vigente_hasta, d.es_ilustrativa];
    if (id) stmts.push(env.DB.prepare(`UPDATE ct_hotel_tarifas SET hotel_id=?, habitacion=?, neto_cent=?, moneda=?, temporada=?, vigente_desde=?, vigente_hasta=?, es_ilustrativa=?, fuente=COALESCE(fuente, 'a mano'), actualizado_en=${ahora} WHERE id=?`).bind(...vals, id));
    else stmts.push(env.DB.prepare(`INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES (?,?,?,?,?,?,?,?, 'a mano')`).bind(...vals));
  } else {
    const vals = [padreId, d.neto_cent, d.moneda, d.pax_desde, d.pax_hasta, d.temporada, d.vigente_desde, d.vigente_hasta, d.es_ilustrativa];
    if (id) stmts.push(env.DB.prepare(`UPDATE ct_tarifas SET servicio_id=?, neto_cent=?, moneda=?, pax_desde=?, pax_hasta=?, temporada=?, vigente_desde=?, vigente_hasta=?, es_ilustrativa=?, fuente=COALESCE(fuente, 'a mano'), actualizado_en=${ahora} WHERE id=?`).bind(...vals, id));
    else stmts.push(env.DB.prepare(`INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente) VALUES (?,?,?,?,?,?,?,?,?, 'a mano')`).bind(...vals));
  }
  const res = await env.DB.batch(stmts);
  const nuevoId = id || res[0].meta.last_row_id;
  const antes = actual ? precioTxt(actual.neto_cent, actual.moneda) : null, despues = precioTxt(d.neto_cent, d.moneda);
  if (antes !== despues) await registro(env, entidad, nuevoId, actual ? 'precio' : 'alta', antes, despues, por, motivo).run();
  return json({ ok: true, id: nuevoId });
}

async function borrarTarifa(env, clase, id, por) {
  const tabla = clase === 'hotel' ? 'ct_hotel_tarifas' : 'ct_tarifas';
  const actual = await env.DB.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).bind(id).first();
  if (!actual) return json({ error: 'No existe' }, 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${tabla} WHERE id = ?`).bind(id),
    registro(env, clase === 'hotel' ? 'hotel_tarifa' : 'tarifa', id, 'baja', precioTxt(actual.neto_cent, actual.moneda), null, por),
  ]);
  return json({ ok: true });
}

// ---------- configuración ----------
async function getConfig(env) {
  const [c, t] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM ct_config`),
    env.DB.prepare(`SELECT * FROM ct_temporadas ORDER BY desde_md`),
  ]);
  const config = {};
  for (const [clave, meta] of Object.entries(CONFIG)) {
    const fila = c.results.find((x) => x.clave === clave);
    config[clave] = { nombre: meta.nombre, min: meta.min, max: meta.max, valor: fila ? fila.valor : null, es_prueba: fila ? fila.es_prueba : 1, actualizado_por: fila?.actualizado_por || null, actualizado_en: fila?.actualizado_en || null };
  }
  return { config, temporadas: t.results };
}

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
async function putConfig(env, body, por) {
  const stmts = [], errores = [];
  const actual = (await getConfig(env)).config;
  for (const [clave, v] of Object.entries(body.valores || {})) {
    const meta = CONFIG[clave];
    if (!meta) { errores.push(`${clave} no existe`); continue; }
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < meta.min || n > meta.max) { errores.push(`${meta.nombre}: tiene que ser un número entre ${meta.min} y ${meta.max}`); continue; }
    const valor = String(n);
    stmts.push(env.DB.prepare(`INSERT INTO ct_config (clave, valor, es_prueba, actualizado_por, actualizado_en) VALUES (?, ?, 0, ?, ${ahora})
      ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor, es_prueba = 0, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en`).bind(clave, valor, por));
    if (actual[clave].valor !== valor || actual[clave].es_prueba) stmts.push(registro(env, 'config', clave, actual[clave].valor === valor ? 'confirmado' : 'valor', actual[clave].valor, valor, por));
  }
  if (Array.isArray(body.temporadas)) {
    const ts = [];
    for (const [i, t] of body.temporadas.entries()) {
      if (!['alta', 'baja'].includes(t.temporada) || !MD.test(t.desde_md || '') || !MD.test(t.hasta_md || '')) { errores.push(`temporada ${i + 1}: revisá el tipo y las fechas (MM-DD)`); continue; }
      ts.push(t);
    }
    if (ts.length > 20) errores.push('máximo 20 rangos de temporada');
    if (!errores.length) {
      stmts.push(env.DB.prepare(`DELETE FROM ct_temporadas`));
      for (const t of ts) stmts.push(env.DB.prepare(`INSERT INTO ct_temporadas (temporada, desde_md, hasta_md, nota, es_prueba) VALUES (?, ?, ?, ?, 0)`).bind(t.temporada, t.desde_md, t.hasta_md, texto(t.nota, 120)));
      stmts.push(registro(env, 'config', 'temporadas', 'temporadas', null, ts.map((t) => `${t.temporada} ${t.desde_md}→${t.hasta_md}`).join(', '), por));
    }
  }
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, ...(await getConfig(env)) });
}

// ---------- importador ----------
async function importar(env, body, por) {
  const reemplazar = !!body.reemplazar_ilustrativas;
  const rev = revisarArchivo(body.filas, await existentes(env), { reemplazarIlustrativas: reemplazar });
  if (rev.error) return json({ error: rev.error }, 400);
  const vista = rev.filas.map((f) => ({ n: f.n, errores: f.errores, avisos: f.avisos, d: f.d }));
  if (!body.aplicar) return json({ ok: true, aplicado: false, resumen: rev.resumen, filas: vista });
  if (rev.resumen.con_error) return json({ error: `Hay ${rev.resumen.con_error} filas con error: no se cargó nada`, resumen: rev.resumen, filas: vista }, 400);
  if (!rev.filas.length) return json({ error: 'El archivo no tiene filas' }, 400);

  const fuente = texto(body.fuente, 120) || 'importación';
  const stmts = [];
  if (reemplazar) {
    stmts.push(env.DB.prepare(`DELETE FROM ct_tarifas WHERE es_ilustrativa = 1`));
    stmts.push(env.DB.prepare(`DELETE FROM ct_hotel_tarifas WHERE es_ilustrativa = 1`));
    stmts.push(env.DB.prepare(`UPDATE ct_hoteles SET activo = 0, actualizado_en = ${ahora} WHERE es_ilustrativo = 1`));
  }
  const servicios = new Map(), hoteles = new Map();
  for (const { d } of rev.filas) {
    if (d.clase === 'servicio') {
      const s = servicios.get(d.clave) || { ...d };
      for (const k of ['duracion', 'incluye', 'no_incluye', 'pax_min', 'precio_es_venta']) if (s[k] === null || s[k] === undefined) s[k] = d[k];
      servicios.set(d.clave, s);
    } else {
      const h = hoteles.get(d.clave) || { ...d, todas_ilus: true };
      h.todas_ilus = h.todas_ilus && !!d.es_ilustrativa;
      if (h.precio_es_venta === null || h.precio_es_venta === undefined) h.precio_es_venta = d.precio_es_venta;
      hoteles.set(d.clave, h);
    }
  }
  for (const s of servicios.values()) {
    stmts.push(env.DB.prepare(`INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min, precio_es_venta)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 1), COALESCE(?, 0))
      ON CONFLICT (clave) DO UPDATE SET nombre = excluded.nombre, ciudad = excluded.ciudad,
        duracion = COALESCE(?, duracion), incluye = COALESCE(?, incluye), no_incluye = COALESCE(?, no_incluye),
        pax_min = COALESCE(?, pax_min), precio_es_venta = COALESCE(?, precio_es_venta), activo = 1, actualizado_en = ${ahora}`)
      .bind(s.clave, s.nombre, s.ciudad, s.tipo, s.duracion, s.incluye, s.no_incluye, s.pax_min, s.precio_es_venta,
        s.duracion, s.incluye, s.no_incluye, s.pax_min, s.precio_es_venta));
  }
  for (const h of hoteles.values()) {
    stmts.push(env.DB.prepare(`INSERT INTO ct_hoteles (clave, ciudad, categoria, nombre, es_ilustrativo, precio_es_venta) VALUES (?, ?, ?, ?, ?, COALESCE(?, 0))
      ON CONFLICT (clave) DO UPDATE SET nombre = excluded.nombre, ciudad = excluded.ciudad, es_ilustrativo = MIN(es_ilustrativo, excluded.es_ilustrativo),
        precio_es_venta = COALESCE(?, precio_es_venta), activo = 1, actualizado_en = ${ahora}`)
      .bind(h.clave, h.ciudad, h.categoria, h.nombre, h.todas_ilus ? 1 : 0, h.precio_es_venta, h.precio_es_venta));
  }
  for (const { d } of rev.filas) {
    if (d.clase === 'servicio') {
      stmts.push(env.DB.prepare(`INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente)
        VALUES ((SELECT id FROM ct_servicios WHERE clave = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(d.clave, d.neto_cent, d.moneda, d.pax_desde, d.pax_hasta, d.temporada, d.vigente_desde, d.vigente_hasta, d.es_ilustrativa, fuente));
    } else {
      stmts.push(env.DB.prepare(`INSERT INTO ct_hotel_tarifas (hotel_id, habitacion, neto_cent, moneda, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente)
        VALUES ((SELECT id FROM ct_hoteles WHERE clave = ?), ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(d.clave, d.habitacion, d.neto_cent, d.moneda, d.temporada, d.vigente_desde, d.vigente_hasta, d.es_ilustrativa, fuente));
    }
  }
  // Reemplazando: los servicios que quedan sin ninguna tarifa (los del seed de prueba) pasan a inactivos.
  if (reemplazar) stmts.push(env.DB.prepare(`UPDATE ct_servicios SET activo = 0, actualizado_en = ${ahora} WHERE activo = 1 AND NOT EXISTS (SELECT 1 FROM ct_tarifas t WHERE t.servicio_id = ct_servicios.id)`));
  stmts.push(registro(env, 'importacion', fuente, 'tarifas', null, `${rev.filas.length} tarifas${reemplazar ? ' (reemplazó las de prueba)' : ''}`, por));
  await env.DB.batch(stmts);   // D1 corre el batch en una transacción: entra todo o nada
  return json({ ok: true, aplicado: true, resumen: rev.resumen, reemplazadas: reemplazar });
}

// ---------- router ----------
export async function onRequest({ request, env, params }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const partes = [].concat(params.ruta || []);
  const [recurso, idTxt, sub, subIdTxt] = partes;
  const id = idTxt === undefined ? null : Number(idTxt);
  if (idTxt !== undefined && !Number.isInteger(id)) return json({ error: 'id no válido' }, 400);
  const subId = subIdTxt === undefined ? null : Number(subIdTxt);
  if (subIdTxt !== undefined && !Number.isInteger(subId)) return json({ error: 'id no válido' }, 400);
  const m = request.method;
  const por = quien(request, rol);
  const body = m === 'POST' || m === 'PUT' ? await leerJson(request) : {};

  try {
    if (recurso === 'tarifario' && m === 'GET') return json(await getTarifario(env));
    if (recurso === 'pedidos') {
      if (!id && !sub && m === 'GET') return listarPedidos(env);
      if (!id && !sub && m === 'POST') return crearPedido(env, body, por);
      if (id && !sub && m === 'GET') return verPedido(env, id);
      if (id && !sub && m === 'PUT') return editarPedido(env, id, body, por);
      if (id && sub === 'estado' && m === 'POST') return estadoPedido(env, id, body, por);
      if (id && sub === 'rearmar' && m === 'POST') return rearmar(env, id, por);
    }
    if (recurso === 'cotizaciones' && id) {
      if (!sub && m === 'GET') { const v = await vistaCotizacion(env, id); return v ? json(v) : json({ error: 'No existe' }, 404); }
      if (!sub && m === 'PUT') return editarCotizacion(env, id, body, por);
      if (sub === 'lineas' && !subId && m === 'POST') return agregarLinea(env, id, body, por);
      if (sub === 'lineas' && subId && m === 'PUT') return editarLinea(env, id, subId, body, por);
      if (sub === 'lineas' && subId && m === 'DELETE') return borrarLinea(env, id, subId, por);
      if (sub === 'nueva-version' && m === 'POST') return nuevaVersion(env, id, por);
      if (sub === 'cambios' && m === 'GET') return cambiosCotizacion(env, id);
      if (sub === 'revision' && m === 'POST') return mandarARevision(env, id, body, por);
    }
    if (recurso === 'servicios' && ((m === 'POST' && !id) || (m === 'PUT' && id))) return guardarServicio(env, id, body);
    if (recurso === 'hoteles' && ((m === 'POST' && !id) || (m === 'PUT' && id))) return guardarHotel(env, id, body);
    if (recurso === 'tarifas' || recurso === 'hotel-tarifas') {
      const clase = recurso === 'tarifas' ? 'servicio' : 'hotel';
      if ((m === 'POST' && !id) || (m === 'PUT' && id)) return guardarTarifa(env, clase, id, body, por);
      if (m === 'DELETE' && id) return borrarTarifa(env, clase, id, por);
    }
    if (recurso === 'config' && m === 'GET') return json(await getConfig(env));
    if (recurso === 'config' && m === 'PUT') return putConfig(env, body, por);
    if (recurso === 'importar' && m === 'POST') return importar(env, body, por);
    if (recurso === 'cambios' && m === 'GET') {
      const u = new URL(request.url);
      const ent = u.searchParams.get('entidad'), eid = u.searchParams.get('id');
      const r = ent
        ? await env.DB.prepare(`SELECT * FROM ct_cambios_precio WHERE entidad = ? AND (? IS NULL OR entidad_id = ?) ORDER BY id DESC LIMIT 100`).bind(ent, eid, eid).all()
        : await env.DB.prepare(`SELECT * FROM ct_cambios_precio ORDER BY id DESC LIMIT 100`).all();
      return json({ cambios: r.results });
    }
  } catch (e) {
    return json({ error: 'Error interno: ' + String(e.message || e).slice(0, 200) }, 500);
  }
  return json({ error: 'No encontrado' }, 404);
}
