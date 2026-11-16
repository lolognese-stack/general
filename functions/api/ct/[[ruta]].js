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
//   GET    /api/ct/pedidos/:id/chat            chat del cliente (sin notas internas), solo lectura
//   GET|PUT /api/ct/cotizaciones/:id          ver (recalcula) / { notas_alvaro, usar_config_actual }
//   POST   /api/ct/cotizaciones/:id/lineas     agregar línea   PUT|DELETE /api/ct/cotizaciones/:id/lineas/:lid
//   POST   /api/ct/cotizaciones/:id/nueva-version          GET /api/ct/cotizaciones/:id/cambios
//   POST   /api/ct/cotizaciones/:id/revision   "Pasar a Álvaro": { revisor, nota, urgente } -> { link, mensaje para WhatsApp }
//   GET    /api/ct/cotizaciones/:id/propuesta  { slug, propuesta_json, texto_armador } para la propuesta web (solo aprobadas)
//   GET|POST /api/ct/pedidos/:id/propuesta     ver / generar la propuesta del cliente (IA)   GET /api/ct/propuestas[/:id[/vista]]   PUT|POST …/publicar|retirar
// Quién: header x-crm-usuario (lo elige cada dispositivo en la página: "Soy Lorenzo / Soy Álvaro").
import { rolDeCotizaciones, json } from '../../_lib/auth.js';
import {
  leerFila, revisarArchivo, claveServicio, claveHotel, solapan, describirTramo,
  TIPOS_SERVICIO, CATEGORIAS,
} from '../../_lib/tarifario.js';
import {
  listarPedidos, pedidosDe, crearPedido, crearPedidoExcel, verPedido, editarPedido, estadoPedido, rearmar, nuevaVersion,
  vistaCotizacion, editarCotizacion, agregarLinea, editarLinea, borrarLinea, cambiosCotizacion, chatDePedido,
} from '../../_lib/ct-cotizaciones.js';
import { mandarARevision, aprobar, pedirCambios } from '../../_lib/ct-revision.js';
import { paraPropuesta } from '../../_lib/ct-propuesta.js';
import { cargarCatalogo, esVigente, elegirVariante } from '../../_lib/ct-cotizaciones.js';
import { leerTanda, vistaDiferencias, aplicarTanda, cerrarLectura, listaWeb } from '../../_lib/ct-web.js';
import { leerTexto } from '../../_lib/ct-importar.js';
import { comoTarifa, comoHotelTarifa, registro, precioTxt, guardarTarifa } from '../../_lib/ct-tarifas.js';
import { propuestaDePedido, generarPropuesta, verPropuesta, listarPropuestas, vistaPropuesta, editarPropuesta, publicarPropuesta, retirarPropuesta, enviarPropuesta } from '../../_lib/ct-propuestas.js';

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
  return u || (rol === 'admin' ? 'admin' : rol === 'cotizador' ? 'cotizador' : 'equipo');
}
// El cotizador (Álvaro) mira y aprueba; generar, editar y publicar la propuesta es del equipo (Lorenzo): rol cliente o admin.
const soloEquipo = (rol) => (rol === 'cotizador' ? json({ error: 'Esto lo hace el equipo de Luna Llena (Lorenzo)' }, 403) : null);
const leerJson = async (request) => { try { return await request.json(); } catch { return {}; } };
const ahora = "datetime('now')";
const texto = (v, max = 2000) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

async function existentes(env) {
  const [a, b] = await env.DB.batch([
    env.DB.prepare(`SELECT t.*, s.clave, s.nombre FROM ct_tarifas t JOIN ct_servicios s ON s.id = t.servicio_id`),
    env.DB.prepare(`SELECT t.*, h.clave, h.nombre FROM ct_hotel_tarifas t JOIN ct_hoteles h ON h.id = t.hotel_id`),
  ]);
  return [...a.results.map(comoTarifa), ...b.results.map(comoHotelTarifa)];
}

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
  const noches_incluidas = b.noches_incluidas === undefined || b.noches_incluidas === '' || b.noches_incluidas === null ? 0 : Number(b.noches_incluidas);
  if (!Number.isInteger(noches_incluidas) || noches_incluidas < 0 || noches_incluidas > 30) errores.push('las noches incluidas tienen que ser un entero de 0 a 30');
  return { errores, d: { nombre, ciudad, tipo, pax_min, noches_incluidas, duracion: texto(b.duracion, 80), incluye: texto(b.incluye), no_incluye: texto(b.no_incluye), precio_es_venta: b.precio_es_venta ? 1 : 0, activo: b.activo === undefined ? 1 : (b.activo ? 1 : 0) } };
}

async function guardarServicio(env, id, body) {
  const { errores, d } = validarServicio(body);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  const clave = claveServicio(d.tipo, d.ciudad, d.nombre);
  const otro = await env.DB.prepare(`SELECT id FROM ct_servicios WHERE clave = ? AND id IS NOT ?`).bind(clave, id).first();
  if (otro) return json({ error: 'Ya existe un servicio con ese tipo, ciudad y nombre' }, 409);
  const vals = [clave, d.nombre, d.ciudad, d.tipo, d.duracion, d.incluye, d.no_incluye, d.pax_min, d.noches_incluidas, d.precio_es_venta, d.activo];
  if (id) {
    const r = await env.DB.prepare(`UPDATE ct_servicios SET clave=?, nombre=?, ciudad=?, tipo=?, duracion=?, incluye=?, no_incluye=?, pax_min=?, noches_incluidas=?, precio_es_venta=?, activo=?, actualizado_en=${ahora} WHERE id=?`).bind(...vals, id).run();
    if (!r.meta.changes) return json({ error: 'No existe' }, 404);
    return json({ ok: true, id });
  }
  const r = await env.DB.prepare(`INSERT INTO ct_servicios (clave, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min, noches_incluidas, precio_es_venta, activo) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run();
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
      stmts.push(env.DB.prepare(`INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, fuente, ganancia_cent)
        VALUES ((SELECT id FROM ct_servicios WHERE clave = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(d.clave, d.neto_cent, d.moneda, d.pax_desde, d.pax_hasta, d.temporada, d.vigente_desde, d.vigente_hasta, d.es_ilustrativa, fuente, d.ganancia_cent ?? null));
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
  const rol = rolDeCotizaciones(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const partes = [].concat(params.ruta || []);
  const [recurso, idTxt, sub, subIdTxt] = partes;
  const m0 = request.method;
  try {
    // Itinerarios de la web: leer en tandas, ver qué cambió y aplicar (Cloudflare deja 50 lecturas por pedido).
    if (recurso === 'web') {
      const cuerpo = m0 === 'POST' ? await leerJson(request) : {};
      if (!idTxt && m0 === 'GET') return listaWeb(env);
      if (idTxt === 'tanda' && m0 === 'POST') return json(await leerTanda(env, { desde: Math.max(0, Number(cuerpo.desde) || 0) }));
      if (idTxt === 'diferencias' && m0 === 'POST') return json(await vistaDiferencias(env, Array.isArray(cuerpo.productos) ? cuerpo.productos : [], cuerpo.ids));
      if (idTxt === 'aplicar' && m0 === 'POST') return aplicarTanda(env, cuerpo.productos);
      if (idTxt === 'cerrar' && m0 === 'POST') return cerrarLectura(env, cuerpo, quien(request, rol));
      if (idTxt === 'servicio' && m0 === 'PUT') {
        const sid = Number(cuerpo.servicio_id), wid = cuerpo.web_id ? String(cuerpo.web_id) : null;
        if (!Number.isInteger(sid)) return json({ error: 'servicio no válido' }, 400);
        if (wid && !(await env.DB.prepare(`SELECT id FROM ct_web_productos WHERE id = ?`).bind(wid).first())) return json({ error: 'Ese tour no está en la web leída' }, 400);
        await env.DB.prepare(`UPDATE ct_servicios SET web_id = ? WHERE id = ?`).bind(wid, sid).run();
        return json({ ok: true });
      }
    }
    if (recurso === 'reglas') {
      if (!idTxt && m0 === 'GET') return json({ reglas: (await env.DB.prepare(`SELECT * FROM ct_reglas ORDER BY tipo, clave`).all()).results });
      if (/^\d+$/.test(idTxt || '') && m0 === 'PUT') {
        const cuerpo = await leerJson(request);
        let datos; try { datos = JSON.parse(typeof cuerpo.datos === 'string' ? cuerpo.datos : JSON.stringify(cuerpo.datos)); } catch { return json({ error: 'Los datos tienen que ser un JSON válido' }, 400); }
        await env.DB.prepare(`UPDATE ct_reglas SET datos = ?, es_prueba = ?, actualizado_por = ?, actualizado_en = datetime('now') WHERE id = ?`).bind(JSON.stringify(datos), cuerpo.validada ? 0 : 1, quien(request, rol), Number(idTxt)).run();
        return json({ ok: true });
      }
    }
  } catch (e) {
    return json({ error: String(e.message || e).slice(0, 200) }, e.message && /web no devolvi/.test(e.message) ? 502 : 500);
  }
  const id = idTxt === undefined ? null : Number(idTxt);
  if (idTxt !== undefined && !Number.isInteger(id)) return json({ error: 'id no válido' }, 400);
  const subId = subIdTxt === undefined ? null : Number(subIdTxt);
  if (subIdTxt !== undefined && !Number.isInteger(subId)) return json({ error: 'id no válido' }, 400);
  const m = request.method;
  const por = quien(request, rol);
  const body = m === 'POST' || m === 'PUT' ? await leerJson(request) : {};

  try {
    if (recurso === 'tarifario' && m === 'GET') return json(await getTarifario(env));
    // Fase 5: pegar un chat o subir un Excel (la IA solo lee; el panel muestra lo leído antes de crear nada)
    if (recurso === 'leer-texto' && m === 'POST') return leerTexto(env, body);
    if (recurso === 'pedido-excel' && m === 'POST') return crearPedidoExcel(env, body, por);
    if (recurso === 'pedidos') {
      if (!id && !sub && m === 'GET') {
        const q = new URL(request.url).searchParams;
        const num = (k) => (/^\d+$/.test(q.get(k) || '') ? Number(q.get(k)) : null);
        if (q.has('lead') || q.has('conversacion')) return pedidosDe(env, num('lead'), num('conversacion'));
        return listarPedidos(env);
      }
      if (!id && !sub && m === 'POST') return crearPedido(env, body, por);
      if (id && !sub && m === 'GET') return verPedido(env, id);
      if (id && !sub && m === 'PUT') return editarPedido(env, id, body, por);
      if (id && sub === 'estado' && m === 'POST') return estadoPedido(env, id, body, por);
      if (id && sub === 'rearmar' && m === 'POST') return rearmar(env, id, por);
      // Chat del cliente, solo lectura (también para el cotizador).
      if (id && sub === 'chat' && m === 'GET') return chatDePedido(env, id);
      // Propuesta para el cliente: la generan, revisan, publican y mandan el equipo o Álvaro (cotizador).
      if (id && sub === 'propuesta' && m === 'GET') return propuestaDePedido(env, id);
      if (id && sub === 'propuesta' && m === 'POST') return generarPropuesta(env, id, por, { conIA: body.con_ia !== false });
    }
    if (recurso === 'propuestas') {
      if (!id && m === 'GET') return listarPropuestas(env);
      if (id && !sub && m === 'GET') return verPropuesta(env, id);
      if (id && sub === 'vista' && m === 'GET') return vistaPropuesta(env, id, new URL(request.url).origin);
      if (id && !sub && m === 'PUT') return editarPropuesta(env, id, body);
      if (id && sub === 'publicar' && m === 'POST') return publicarPropuesta(env, id, body, por);
      if (id && sub === 'retirar' && m === 'POST') return retirarPropuesta(env, id, por);
      if (id && sub === 'enviar' && m === 'POST') return enviarPropuesta(env, id, body, por);
    }
    if (recurso === 'cotizaciones' && id) {
      if (!sub && m === 'GET') { const v = await vistaCotizacion(env, id); return v ? json(v) : json({ error: 'No existe' }, 404); }
      if (!sub && m === 'PUT') return editarCotizacion(env, id, body, por);
      if (sub === 'lineas' && !subId && m === 'POST') return agregarLinea(env, id, body, por);
      if (sub === 'lineas' && subId && m === 'PUT') return editarLinea(env, id, subId, body, por);
      if (sub === 'lineas' && subId && m === 'DELETE') return borrarLinea(env, id, subId, por);
      if (sub === 'nueva-version' && m === 'POST') return nuevaVersion(env, id, por);
      if (sub === 'cambios' && m === 'GET') return cambiosCotizacion(env, id);
      if (sub === 'revision' && m === 'POST') return soloEquipo(rol) || mandarARevision(env, id, body, por, { origen: new URL(request.url).origin });
      if (sub === 'elegir-variante' && m === 'POST') return elegirVariante(env, id, por);
      // Álvaro aprueba o pide cambios desde el mismo editor (antes era desde el link /r/). Queda registrado quién fue.
      if ((sub === 'aprobar' || sub === 'pedir-cambios') && m === 'POST') {
        const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(id).first();
        if (!cot) return json({ error: 'No existe' }, 404);
        if (!(await esVigente(env, cot))) return json({ error: 'Hay una versión más nueva' }, 409);
        const quienes = { ...cot, revisor: por };
        return sub === 'aprobar' ? aprobar(env, quienes, body, { rol, origen: new URL(request.url).origin }) : pedirCambios(env, quienes, body);
      }
      if (sub === 'propuesta' && m === 'GET') {
        const v = await vistaCotizacion(env, id);
        if (!v) return json({ error: 'No existe' }, 404);
        const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
        const azar = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('');
        const r = paraPropuesta(v, { servicios: (await cargarCatalogo(env)).servicios, hoy, azar });
        return r.errores ? json({ error: r.errores.join('; '), errores: r.errores }, 409) : json(r);
      }
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
