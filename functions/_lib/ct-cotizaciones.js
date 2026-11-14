// Pedidos y cotizaciones del cotizador interno (la parte con base). El cálculo está en cotizar.js.
import { json } from './auth.js';
import { aCentavos, aFecha, CATEGORIAS, HABITACIONES } from './tarifario.js';
import { armarBorrador, precioLinea, totales, usaPrueba, sumarDias } from './cotizar.js';

export const ESTADOS_PEDIDO = ['nuevo', 'borrador_listo', 'en_revision', 'aprobada', 'enviada', 'cerrada', 'perdida'];
const EDITABLES = ['borrador', 'cambios_pedidos', 'en_revision'];
const ahora = "datetime('now')";
const texto = (v, max = 2000) => { const s = String(v ?? '').replace(/[ \t]+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const usd = (c) => c === null || c === undefined ? null : `USD ${(c / 100).toFixed(2)}`;
const parse = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };

// ---------- lectura ----------
export async function cargarCatalogo(env) {
  const [s, t, h, ht] = await env.DB.batch([
    env.DB.prepare(`SELECT id, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min, precio_es_venta, activo FROM ct_servicios`),
    env.DB.prepare(`SELECT * FROM ct_tarifas`),
    env.DB.prepare(`SELECT id, nombre, ciudad, categoria, precio_es_venta, es_ilustrativo, activo FROM ct_hoteles`),
    env.DB.prepare(`SELECT * FROM ct_hotel_tarifas`),
  ]);
  const agrupar = (lista, campo) => { const m = new Map(); for (const x of lista) (m.get(x[campo]) || m.set(x[campo], []).get(x[campo])).push(x); return m; };
  const ts = agrupar(t.results, 'servicio_id'), hts = agrupar(ht.results, 'hotel_id');
  return {
    servicios: s.results.map((x) => ({ ...x, tarifas: ts.get(x.id) || [] })),
    hoteles: h.results.map((x) => ({ ...x, tarifas: hts.get(x.id) || [] })),
  };
}

export async function configActual(env) {
  const [c, t] = await env.DB.batch([env.DB.prepare(`SELECT * FROM ct_config`), env.DB.prepare(`SELECT temporada, desde_md, hasta_md, es_prueba FROM ct_temporadas`)]);
  const cfg = { temporadas: t.results.map(({ temporada, desde_md, hasta_md }) => ({ temporada, desde_md, hasta_md })), es_prueba: {} };
  for (const k of ['margen_pct', 'tc_pen_por_usd', 'recargo_tarjeta_pct', 'igv_pct']) {
    const f = c.results.find((x) => x.clave === k);
    cfg[k] = f ? Number(f.valor) : null;
    if (!f || f.es_prueba) cfg.es_prueba[k] = 1;
  }
  if (t.results.some((x) => x.es_prueba)) cfg.es_prueba.temporadas = 1;
  return cfg;
}

const pedidoDe = (p) => p && ({ ...p, destinos: parse(p.destinos, []), servicios: parse(p.servicios, []) });

// ---------- validación del pedido ----------
function leerPedido(b) {
  const errores = [];
  const nombre = texto(b.nombre, 120);
  if (!nombre) errores.push('falta el nombre');
  const pasajeros = Number(b.pasajeros);
  if (!Number.isInteger(pasajeros) || pasajeros < 1 || pasajeros > 60) errores.push('pasajeros: un número entero de 1 a 60');
  const fi = b.fecha_inicio ? aFecha(b.fecha_inicio) : null, ff = b.fecha_fin ? aFecha(b.fecha_fin) : null;
  if (b.fecha_inicio && !fi) errores.push('fecha de inicio no válida');
  if (b.fecha_fin && !ff) errores.push('fecha de fin no válida');
  if (fi && ff && ff < fi) errores.push('la fecha de fin es anterior a la de inicio');
  const destinos = [];
  for (const d of Array.isArray(b.destinos) ? b.destinos.slice(0, 15) : []) {
    const ciudad = texto(d && d.ciudad, 60);
    const noches = Number(d && d.noches);
    if (!ciudad) continue;
    if (!Number.isInteger(noches) || noches < 0 || noches > 60) { errores.push(`noches en ${ciudad}: entero de 0 a 60`); continue; }
    destinos.push({ ciudad, noches });
  }
  if (!destinos.length) errores.push('falta al menos un destino');
  const cat = b.categoria_hotel || null;
  if (cat && ![...CATEGORIAS, 'sin_hotel'].includes(cat)) errores.push('categoría de hotel no válida');
  const servicios = (Array.isArray(b.servicios) ? b.servicios : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 40);
  const lead = b.lead_id === undefined || b.lead_id === null || b.lead_id === '' ? null : Number(b.lead_id);
  if (lead !== null && !Number.isInteger(lead)) errores.push('lead no válido');
  return { errores, d: { nombre, pais: texto(b.pais, 60), fecha_inicio: fi, fecha_fin: ff, pasajeros, destinos, categoria_hotel: cat, servicios, pedidos_especiales: texto(b.pedidos_especiales, 2000), lead_id: lead } };
}

// ---------- cotización: recalcular y ver ----------
const CAMPOS_CALCULADOS = ['tarifa_id', 'neto_unit_cent', 'moneda', 'neto_cent', 'venta_cent', 'margen_pct', 'precio_es_venta', 'es_ilustrativa', 'problema'];

// Recalcula todas las líneas (menos lo pisado), guarda lo que cambió y devuelve la vista completa.
export async function vistaCotizacion(env, cotId, { catalogo = null } = {}) {
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(cotId).first();
  if (!cot) return null;
  const [p, ls] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM ct_pedidos WHERE id = ?`).bind(cot.pedido_id),
    env.DB.prepare(`SELECT * FROM ct_lineas WHERE cotizacion_id = ? ORDER BY dia, orden, id`).bind(cotId),
  ]);
  const pedido = pedidoDe(p.results[0]);
  const config = parse(cot.config_json, {});
  const editable = EDITABLES.includes(cot.estado);
  let lineas = ls.results;
  const stmts = [];
  if (editable) {
    catalogo = catalogo || await cargarCatalogo(env);
    lineas = lineas.map((l) => {
      const n = precioLinea(l, { catalogo, config, pax: pedido.pasajeros });
      if (CAMPOS_CALCULADOS.some((k) => (n[k] ?? null) !== (l[k] ?? null))) {
        stmts.push(env.DB.prepare(`UPDATE ct_lineas SET ${CAMPOS_CALCULADOS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...CAMPOS_CALCULADOS.map((k) => n[k] ?? null), l.id));
      }
      return n;
    });
  }
  const tot = totales(lineas, { pax: pedido.pasajeros, config });
  const prueba = editable ? (usaPrueba(lineas, config) ? 1 : 0) : cot.usa_prueba;
  if (editable && (cot.total_neto_cent !== tot.neto_cent || cot.total_venta_cent !== tot.venta_cent || cot.usa_prueba !== prueba || cot.problemas !== tot.problemas)) {
    stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET total_neto_cent = ?, total_venta_cent = ?, usa_prueba = ?, problemas = ?, actualizado_en = ${ahora} WHERE id = ?`)
      .bind(tot.neto_cent, tot.venta_cent, prueba, tot.problemas, cotId));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const { token_hash, ...publica } = cot;
  return {
    cotizacion: { ...publica, total_neto_cent: tot.neto_cent, total_venta_cent: tot.venta_cent, usa_prueba: prueba, problemas: tot.problemas, config: config, avisos: parse(cot.avisos, []), editable, tiene_link: !!token_hash },
    pedido, lineas, totales: tot,
  };
}

async function crearCotizacion(env, pedido, por, { version = 1, lineas = null, catalogo = null } = {}) {
  catalogo = catalogo || await cargarCatalogo(env);
  const config = await configActual(env);
  let avisos = [];
  if (!lineas) ({ lineas, avisos } = armarBorrador(pedido, catalogo));
  const r = await env.DB.prepare(`INSERT INTO ct_cotizaciones (pedido_id, version, estado, config_json, avisos, creado_por) VALUES (?, ?, 'borrador', ?, ?, ?)`)
    .bind(pedido.id, version, JSON.stringify(config), JSON.stringify(avisos), por).run();
  const cotId = r.meta.last_row_id;
  if (lineas.length) await env.DB.batch(lineas.map((l) => insertarLinea(env, cotId, l)));
  return cotId;
}

const COLS_LINEA = ['dia', 'orden', 'fecha', 'tipo', 'servicio_id', 'hotel_id', 'descripcion', 'pasajeros', 'cantidad', 'habitacion', 'unidades',
  'neto_cent', 'venta_cent', 'margen_fijo', 'pisado_neto', 'pisado_venta', 'nota'];
const insertarLinea = (env, cotId, l) => env.DB.prepare(`INSERT INTO ct_lineas (cotizacion_id, ${COLS_LINEA.join(', ')}) VALUES (?, ${COLS_LINEA.map(() => '?').join(', ')})`)
  .bind(cotId, ...COLS_LINEA.map((k) => l[k] ?? (['pisado_neto', 'pisado_venta', 'neto_cent', 'venta_cent'].includes(k) ? 0 : ['cantidad', 'unidades', 'pasajeros'].includes(k) ? 1 : k === 'orden' ? 0 : null)));

export async function cambiarEstado(env, pedidoId, estado, por, nota = null) {
  return env.DB.batch([
    env.DB.prepare(`UPDATE ct_pedidos SET estado = ?, estado_desde = ${ahora}, actualizado_en = ${ahora} WHERE id = ?`).bind(estado, pedidoId),
    env.DB.prepare(`INSERT INTO ct_pedido_estados (pedido_id, estado, por, nota) VALUES (?, ?, ?, ?)`).bind(pedidoId, estado, por, nota),
  ]);
}

const ultimaCotizacion = (env, pedidoId) => env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE pedido_id = ? ORDER BY version DESC LIMIT 1`).bind(pedidoId).first();

// ---------- endpoints ----------
export async function listarPedidos(env) {
  const r = await env.DB.prepare(`SELECT p.id, p.nombre, p.pais, p.fecha_inicio, p.fecha_fin, p.pasajeros, p.destinos, p.estado, p.estado_desde, p.creado_en, p.creado_por,
      c.id AS cotizacion_id, c.version, c.estado AS cot_estado, c.total_venta_cent, c.usa_prueba, c.problemas
    FROM ct_pedidos p
    LEFT JOIN ct_cotizaciones c ON c.id = (SELECT id FROM ct_cotizaciones WHERE pedido_id = p.id ORDER BY version DESC LIMIT 1)
    ORDER BY p.estado_desde DESC LIMIT 300`).all();
  return json({ pedidos: r.results.map((p) => ({ ...p, destinos: parse(p.destinos, []) })), ahora: new Date().toISOString() });
}

export async function crearPedido(env, body, por) {
  const { errores, d } = leerPedido(body);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  const r = await env.DB.prepare(`INSERT INTO ct_pedidos (lead_id, nombre, pais, fecha_inicio, fecha_fin, pasajeros, destinos, servicios, categoria_hotel, pedidos_especiales, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(d.lead_id, d.nombre, d.pais, d.fecha_inicio, d.fecha_fin, d.pasajeros, JSON.stringify(d.destinos), JSON.stringify(d.servicios), d.categoria_hotel, d.pedidos_especiales, por).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare(`INSERT INTO ct_pedido_estados (pedido_id, estado, por) VALUES (?, 'nuevo', ?)`).bind(id, por).run();
  // El sistema arma el borrador solo.
  const cotId = await crearCotizacion(env, { ...d, id }, 'sistema');
  await cambiarEstado(env, id, 'borrador_listo', 'sistema', 'Borrador armado automáticamente');
  await vistaCotizacion(env, cotId);
  return json({ ok: true, id, cotizacion_id: cotId });
}

export async function verPedido(env, id) {
  const p = await env.DB.prepare(`SELECT * FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!p) return json({ error: 'No existe' }, 404);
  const [est, cots] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM ct_pedido_estados WHERE pedido_id = ? ORDER BY id`).bind(id),
    env.DB.prepare(`SELECT id, version, estado, total_venta_cent, usa_prueba, problemas, aprobada_por, aprobada_en, creado_en FROM ct_cotizaciones WHERE pedido_id = ? ORDER BY version DESC`).bind(id),
  ]);
  return json({ pedido: pedidoDe(p), estados: est.results, cotizaciones: cots.results });
}

export async function editarPedido(env, id, body, por) {
  const actual = await env.DB.prepare(`SELECT * FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!actual) return json({ error: 'No existe' }, 404);
  const { errores, d } = leerPedido(body);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  await env.DB.prepare(`UPDATE ct_pedidos SET lead_id = ?, nombre = ?, pais = ?, fecha_inicio = ?, fecha_fin = ?, pasajeros = ?, destinos = ?, servicios = ?, categoria_hotel = ?, pedidos_especiales = ?, actualizado_en = ${ahora} WHERE id = ?`)
    .bind(d.lead_id, d.nombre, d.pais, d.fecha_inicio, d.fecha_fin, d.pasajeros, JSON.stringify(d.destinos), JSON.stringify(d.servicios), d.categoria_hotel, d.pedidos_especiales, id).run();
  // Si cambió la fecha de inicio, las fechas de las líneas de la cotización editable se corren con ella.
  const cot = await ultimaCotizacion(env, id);
  if (cot && EDITABLES.includes(cot.estado) && d.fecha_inicio && d.fecha_inicio !== actual.fecha_inicio) {
    await env.DB.prepare(`UPDATE ct_lineas SET fecha = date(?, '+' || (dia - 1) || ' days') WHERE cotizacion_id = ? AND dia IS NOT NULL`).bind(d.fecha_inicio, cot.id).run();
  }
  return json({ ok: true });
}

export async function estadoPedido(env, id, body, por) {
  const estado = String(body.estado || '');
  if (!ESTADOS_PEDIDO.includes(estado)) return json({ error: 'estado no válido' }, 400);
  const p = await env.DB.prepare(`SELECT estado FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!p) return json({ error: 'No existe' }, 404);
  if (p.estado === estado) return json({ ok: true });
  if (estado === 'enviada') {
    const cot = await ultimaCotizacion(env, id);
    if (!cot || cot.estado !== 'aprobada') return json({ error: 'Solo se puede marcar como enviada una cotización aprobada' }, 409);
    if (cot.usa_prueba) return json({ error: 'Esta cotización usa PRECIOS DE PRUEBA: no se puede mandar al cliente' }, 409);
  }
  await cambiarEstado(env, id, estado, por, texto(body.nota, 300));
  return json({ ok: true });
}

// Vuelve a armar el borrador desde el pedido (borra las líneas de la versión editable).
export async function rearmar(env, id, por) {
  const p = pedidoDe(await env.DB.prepare(`SELECT * FROM ct_pedidos WHERE id = ?`).bind(id).first());
  if (!p) return json({ error: 'No existe' }, 404);
  const cot = await ultimaCotizacion(env, id);
  if (cot && !EDITABLES.includes(cot.estado)) return json({ error: 'La última versión está aprobada: creá una versión nueva' }, 409);
  const catalogo = await cargarCatalogo(env);
  const { lineas, avisos } = armarBorrador(p, catalogo);
  const config = await configActual(env);
  if (!cot) { const cotId = await crearCotizacion(env, p, por, { catalogo }); return json({ ok: true, cotizacion_id: cotId }); }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ct_lineas WHERE cotizacion_id = ?`).bind(cot.id),
    env.DB.prepare(`UPDATE ct_cotizaciones SET avisos = ?, config_json = ?, actualizado_en = ${ahora} WHERE id = ?`).bind(JSON.stringify(avisos), JSON.stringify(config), cot.id),
    ...lineas.map((l) => insertarLinea(env, cot.id, l)),
    env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por) VALUES ('cotizacion', ?, 'rearmada', ?, NULL, ?)`).bind(String(cot.id), usd(cot.total_venta_cent), por),
  ]);
  return json({ ok: true, cotizacion_id: cot.id });
}

export async function nuevaVersion(env, cotId, por) {
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(cotId).first();
  if (!cot) return json({ error: 'No existe' }, 404);
  const ult = await ultimaCotizacion(env, cot.pedido_id);
  if (ult.id !== cot.id) return json({ error: 'Ya hay una versión más nueva' }, 409);
  const ls = (await env.DB.prepare(`SELECT * FROM ct_lineas WHERE cotizacion_id = ? ORDER BY dia, orden, id`).bind(cotId).all()).results;
  const nuevoId = await crearCotizacion(env, { id: cot.pedido_id }, por, { version: cot.version + 1, lineas: ls });
  await env.DB.batch([
    env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'reemplazada', actualizado_en = ${ahora} WHERE id = ?`).bind(cotId),
    env.DB.prepare(`UPDATE ct_cotizaciones SET notas_alvaro = ?, avisos = ?, revisor = ? WHERE id = ?`).bind(cot.notas_alvaro, cot.avisos, cot.revisor, nuevoId),
  ]);
  await cambiarEstado(env, cot.pedido_id, 'borrador_listo', por, `Versión ${cot.version + 1}`);
  return json({ ok: true, cotizacion_id: nuevoId });
}

async function cotEditable(env, cotId) {
  const cot = await env.DB.prepare(`SELECT c.*, p.fecha_inicio, p.pasajeros FROM ct_cotizaciones c JOIN ct_pedidos p ON p.id = c.pedido_id WHERE c.id = ?`).bind(cotId).first();
  if (!cot) return { err: json({ error: 'No existe' }, 404) };
  if (!EDITABLES.includes(cot.estado)) return { err: json({ error: cot.estado === 'aprobada' ? 'Está aprobada: no se edita. Creá una versión nueva.' : 'Esta versión ya no se edita' }, 409) };
  return { cot };
}

export async function editarCotizacion(env, cotId, body, por) {
  const { cot, err } = await cotEditable(env, cotId);
  if (err) return err;
  const stmts = [];
  if (body.usar_config_actual) {
    const config = await configActual(env);
    stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET config_json = ? WHERE id = ?`).bind(JSON.stringify(config), cotId));
    stmts.push(env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por) VALUES ('cotizacion', ?, 'configuración', ?, ?, ?)`)
      .bind(String(cotId), `margen ${parse(cot.config_json, {}).margen_pct}%`, `margen ${config.margen_pct}%`, por));
  }
  if (body.notas_alvaro !== undefined) stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET notas_alvaro = ? WHERE id = ?`).bind(texto(body.notas_alvaro, 4000), cotId));
  if (stmts.length) await env.DB.batch(stmts);
  return json(await vistaCotizacion(env, cotId));
}

const fechaDia = (inicio, dia) => inicio && Number.isInteger(dia) ? sumarDias(inicio, dia - 1) : null;
const entero = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };

export async function agregarLinea(env, cotId, body, por) {
  const { cot, err } = await cotEditable(env, cotId);
  if (err) return err;
  const dia = entero(body.dia, 1, 120);
  if (dia === null) return json({ error: 'día no válido' }, 400);
  const max = await env.DB.prepare(`SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM ct_lineas WHERE cotizacion_id = ?`).bind(cotId).first();
  const base = { dia, orden: max.o, fecha: fechaDia(cot.fecha_inicio, dia) };
  let l;
  if (body.tipo === 'manual') {
    const neto = aCentavos(body.neto ?? '');
    const desc = texto(body.descripcion, 200);
    if (!desc) return json({ error: 'falta la descripción' }, 400);
    if (neto === null) return json({ error: 'el neto tiene que ser un número (USD)' }, 400);
    const venta = body.venta === undefined || body.venta === '' ? null : aCentavos(body.venta);
    if (body.venta !== undefined && body.venta !== '' && venta === null) return json({ error: 'la venta tiene que ser un número (USD)' }, 400);
    l = { ...base, tipo: 'manual', descripcion: desc, pasajeros: entero(body.pasajeros, 1, 60) || cot.pasajeros, neto_cent: neto, venta_cent: venta ?? 0, pisado_venta: venta === null ? 0 : 1 };
  } else if (body.tipo === 'hotel') {
    const h = await env.DB.prepare(`SELECT id, nombre FROM ct_hoteles WHERE id = ?`).bind(Number(body.hotel_id)).first();
    if (!h) return json({ error: 'El hotel no existe' }, 400);
    const hab = HABITACIONES.includes(body.habitacion) ? body.habitacion : null;
    const noches = entero(body.noches, 1, 60), unidades = entero(body.unidades, 1, 30);
    if (!hab || !noches || !unidades) return json({ error: 'habitación, noches y cantidad de habitaciones' }, 400);
    l = { ...base, tipo: 'hotel', hotel_id: h.id, habitacion: hab, cantidad: noches, unidades, pasajeros: unidades * ({ SGL: 1, DBL: 2, TPL: 3 }[hab]),
      descripcion: `${h.nombre} · ${unidades} hab. ${{ SGL: 'simple', DBL: 'doble', TPL: 'triple' }[hab]} × ${noches} noche${noches > 1 ? 's' : ''}` };
  } else {
    const s = await env.DB.prepare(`SELECT id, nombre, tipo FROM ct_servicios WHERE id = ?`).bind(Number(body.servicio_id)).first();
    if (!s) return json({ error: 'El servicio no existe' }, 400);
    l = { ...base, tipo: s.tipo, servicio_id: s.id, descripcion: s.nombre, pasajeros: entero(body.pasajeros, 1, 60) || cot.pasajeros };
  }
  await insertarLinea(env, cotId, l).run();
  return json(await vistaCotizacion(env, cotId));
}

export async function editarLinea(env, cotId, lid, body, por) {
  const { cot, err } = await cotEditable(env, cotId);
  if (err) return err;
  const l = await env.DB.prepare(`SELECT * FROM ct_lineas WHERE id = ? AND cotizacion_id = ?`).bind(lid, cotId).first();
  if (!l) return json({ error: 'No existe la línea' }, 404);
  const sets = [], vals = [], log = [];
  const motivo = texto(body.motivo, 200);
  const set = (k, v) => { sets.push(`${k} = ?`); vals.push(v); };
  if (body.dia !== undefined) {
    const d = entero(body.dia, 1, 120); if (d === null) return json({ error: 'día no válido' }, 400);
    set('dia', d); set('fecha', fechaDia(cot.fecha_inicio, d));
  }
  if (body.descripcion !== undefined) { const t = texto(body.descripcion, 200); if (!t) return json({ error: 'falta la descripción' }, 400); set('descripcion', t); }
  if (body.pasajeros !== undefined) { const n = entero(body.pasajeros, 1, 60); if (!n) return json({ error: 'pasajeros no válido' }, 400); set('pasajeros', n); }
  if (l.tipo === 'hotel') {
    if (body.noches !== undefined) { const n = entero(body.noches, 1, 60); if (!n) return json({ error: 'noches no válido' }, 400); set('cantidad', n); }
    if (body.unidades !== undefined) { const n = entero(body.unidades, 1, 30); if (!n) return json({ error: 'habitaciones no válido' }, 400); set('unidades', n); }
    if (body.habitacion !== undefined) { if (!HABITACIONES.includes(body.habitacion)) return json({ error: 'habitación no válida' }, 400); set('habitacion', body.habitacion); }
    if (body.hotel_id !== undefined) {
      const h = await env.DB.prepare(`SELECT id FROM ct_hoteles WHERE id = ?`).bind(Number(body.hotel_id)).first();
      if (!h) return json({ error: 'El hotel no existe' }, 400);
      set('hotel_id', h.id);
    }
  }
  if (body.margen !== undefined) {
    const m = body.margen === '' || body.margen === null ? null : Number(String(body.margen).replace(',', '.'));
    if (m !== null && (!Number.isFinite(m) || m < 0 || m > 300)) return json({ error: 'margen entre 0 y 300' }, 400);
    if ((m ?? null) !== (l.margen_fijo ?? null)) { set('margen_fijo', m); log.push(['margen', l.margen_fijo == null ? 'config' : `${l.margen_fijo}%`, m == null ? 'config' : `${m}%`]); }
  }
  if (body.neto !== undefined && body.neto !== '') {
    const c = aCentavos(body.neto); if (c === null) return json({ error: 'el neto tiene que ser un número (USD)' }, 400);
    if (c !== l.neto_cent || !l.pisado_neto) { set('neto_cent', c); if (l.tipo !== 'manual') set('pisado_neto', 1); log.push(['neto', usd(l.neto_cent), usd(c)]); }
  }
  if (body.venta !== undefined && body.venta !== '') {
    const c = aCentavos(body.venta); if (c === null) return json({ error: 'la venta tiene que ser un número (USD)' }, 400);
    if (c !== l.venta_cent || !l.pisado_venta) { set('venta_cent', c); set('pisado_venta', 1); log.push(['venta', usd(l.venta_cent), usd(c)]); }
  }
  if (body.restaurar) { set('pisado_neto', 0); set('pisado_venta', 0); set('margen_fijo', null); log.push(['restaurado', `${usd(l.neto_cent)} / ${usd(l.venta_cent)}`, 'según tarifario']); }
  if (body.nota !== undefined) set('nota', texto(body.nota, 500));
  if (!sets.length) return json(await vistaCotizacion(env, cotId));
  await env.DB.batch([
    env.DB.prepare(`UPDATE ct_lineas SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, lid),
    ...log.map(([campo, antes, despues]) => env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por, motivo) VALUES ('linea', ?, ?, ?, ?, ?, ?)`)
      .bind(`${cotId}:${lid}`, `${campo} · ${l.descripcion}`.slice(0, 200), antes, despues, por, motivo)),
  ]);
  return json(await vistaCotizacion(env, cotId));
}

export async function borrarLinea(env, cotId, lid, por) {
  const { err } = await cotEditable(env, cotId);
  if (err) return err;
  const l = await env.DB.prepare(`SELECT * FROM ct_lineas WHERE id = ? AND cotizacion_id = ?`).bind(lid, cotId).first();
  if (!l) return json({ error: 'No existe la línea' }, 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ct_lineas WHERE id = ?`).bind(lid),
    env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por) VALUES ('linea', ?, ?, ?, NULL, ?)`).bind(`${cotId}:${lid}`, `borrada · ${l.descripcion}`.slice(0, 200), usd(l.venta_cent), por),
  ]);
  return json(await vistaCotizacion(env, cotId));
}

// Historial de cambios de precio de una cotización (todas sus líneas).
export async function cambiosCotizacion(env, cotId) {
  const r = await env.DB.prepare(`SELECT * FROM ct_cambios_precio WHERE (entidad = 'cotizacion' AND entidad_id = ?)
    OR (entidad = 'linea' AND entidad_id LIKE ?) ORDER BY id DESC LIMIT 200`).bind(String(cotId), `${cotId}:%`).all();
  return json({ cambios: r.results });
}
