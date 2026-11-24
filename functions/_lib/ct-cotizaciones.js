// Pedidos y cotizaciones del cotizador interno (la parte con base). El cálculo está en cotizar.js.
import { json } from './auth.js';
import { aCentavos, aFecha, CATEGORIAS, HABITACIONES } from './tarifario.js';
import { armarBorrador, precioLinea, totales, usaPrueba, sumarDias } from './cotizar.js';
import { armarItinerario, indexarReglas, lineasTraslados } from './ct-armado.js';
import { elegirConIA } from './ct-armado-ia.js';
import { guardarTarifa } from './ct-tarifas.js';

export const ESTADOS_PEDIDO = ['nuevo', 'borrador_listo', 'en_revision', 'aprobada', 'enviada', 'cerrada', 'perdida'];
const EDITABLES = ['borrador', 'cambios_pedidos', 'en_revision'];
const ahora = "datetime('now')";
const texto = (v, max = 2000) => { const s = String(v ?? '').replace(/[ \t]+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const usd = (c) => c === null || c === undefined ? null : `USD ${(c / 100).toFixed(2)}`;
const parse = (s, def) => { try { return s ? JSON.parse(s) : def; } catch { return def; } };

// ---------- lectura ----------
export async function cargarCatalogo(env) {
  const [s, t, h, ht] = await env.DB.batch([
    env.DB.prepare(`SELECT id, nombre, ciudad, tipo, duracion, incluye, no_incluye, pax_min, noches_incluidas, precio_es_venta, activo FROM ct_servicios`),
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

const pedidoDe = (p) => p && ({ ...p, destinos: parse(p.destinos, []), servicios: parse(p.servicios, []), excursiones: parse(p.excursiones, []), traslados: parse(p.traslados, []) });

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
  const excursiones = (Array.isArray(b.excursiones) ? b.excursiones : String(b.excursiones || '').split(/[,\n;]+/)).map((x) => texto(x, 80)).filter(Boolean).slice(0, 20);
  // Traslados y trenes pedidos: [{ que, dia|null, modalidad PRI|GRU }]
  const traslados = (Array.isArray(b.traslados) ? b.traslados : []).slice(0, 15).map((t) => {
    const dia = Number(t && t.dia);
    return { que: texto(t && t.que, 120), dia: Number.isInteger(dia) && dia >= 1 && dia <= 90 ? dia : null, modalidad: String(t && t.modalidad || '').toUpperCase() === 'GRU' ? 'GRU' : 'PRI' };
  }).filter((t) => t.que);
  const lead = b.lead_id === undefined || b.lead_id === null || b.lead_id === '' ? null : Number(b.lead_id);
  if (lead !== null && !Number.isInteger(lead)) errores.push('lead no válido');
  const entero = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  const dias = entero(b.dias);
  if (dias !== null && (!Number.isInteger(dias) || dias < 1 || dias > 90)) errores.push('días: un entero de 1 a 90');
  const conversacion = entero(b.conversacion_id);
  if (conversacion !== null && !Number.isInteger(conversacion)) errores.push('conversación no válida');
  const origen = ['inbox', 'manual', 'chat', 'excel', 'web'].includes(b.origen) ? b.origen : 'manual';
  const tentativa = b.fecha_tentativa ? 1 : 0;
  // Los cuatro datos sin los que no hay itinerario ni tarifa (pedido desde el inbox): destinos, días, personas, fecha.
  if (origen === 'inbox') {
    if (!dias) errores.push('falta la cantidad de días');
    if (!fi) errores.push('falta la fecha (o una fecha tentativa)');
  }
  if (tentativa && !fi) errores.push('la fecha tentativa necesita un día elegido');
  // Sin fecha de fin, sale de la de inicio y los días.
  const fin = ff || (fi && dias ? new Date(Date.parse(fi + 'T12:00:00Z') + (dias - 1) * 86400e3).toISOString().slice(0, 10) : null);
  return { errores, d: { nombre, pais: texto(b.pais, 60), fecha_inicio: fi, fecha_fin: fin, pasajeros, destinos, categoria_hotel: cat, servicios, excursiones, traslados, pedidos_especiales: texto(b.pedidos_especiales, 2000), lead_id: lead, dias, fecha_tentativa: tentativa, conversacion_id: conversacion, origen } };
}

// Lo que impide aprobar ("Te falta"): líneas sin precio, ilustraciones (destino que la web no tiene), hoteles y servicios
// de ejemplo (tarifa de prueba), precios web sin confirmar y el precio del paquete sin confirmar.
// Los avisos del armado van en la lista para revisar, pero no bloquean (no hay nada que "resolver" en ellos).
// items: [{ tipo, linea_id, dia, texto, bloquea }] para el bloque "Te falta" del panel (cada ítem salta a su línea).
export function pendientesDe(cot, lineas, tot) {
  const items = [];
  const it = (tipo, l, txt, bloquea = true) => items.push({ tipo, linea_id: l ? l.id : null, dia: l ? l.dia ?? null : null, texto: txt, bloquea });
  for (const l of lineas) {
    const nombre = l.descripcion || 'Línea';
    if (l.problema) it('sin_precio', l, `${nombre}: ${l.problema}`);
    else if (l.es_ilustrativa && l.origen_precio === 'ilustrativa') it('ilustrativa', l, `${nombre}: ilustración, la web no tiene este destino. Armalo y ponele precio.`);
    else if (l.es_ilustrativa && !l.pisado_neto && !l.pisado_venta) it('ejemplo', l, `${nombre}: ${l.tipo === 'hotel' ? 'hotel' : 'tarifa'} de ejemplo. Elegí uno real o poné el precio.`);
    if (l.sin_confirmar) it('sin_confirmar', l, l.origen_precio === 'pedido' ? `${nombre}: lo pidió el cliente y no está en el tarifario. Poné el precio.` : `${nombre}: precio de la web sin confirmar.`);
  }
  if (tot.modo === 'paquete_web' && !cot.paquete_web_confirmado) it('paquete_web', null, 'El precio del paquete de la web, sin confirmar.');
  for (const a of (Array.isArray(cot.avisos) ? cot.avisos : parse(cot.avisos, []))) it('aviso', null, String(a), false);
  const n = (t) => items.filter((x) => x.tipo === t).length;
  const total = items.filter((x) => x.bloquea).length;
  return { ilustrativas: n('ilustrativa'), ejemplo: n('ejemplo'), sin_confirmar: n('sin_confirmar'), paquete_web: n('paquete_web'), sin_precio: n('sin_precio'), avisos: n('aviso'), total, items };
}

// "Cambio chico" (una versión nueva después de una aprobada): el equipo la aprueba sin pasar por Álvaro si no quedó
// nada pendiente y no hay precios puestos a mano (o líneas manuales) que no estuvieran ya en la versión aprobada.
const firmaLinea = (l) => [l.tipo, l.servicio_id ?? '', l.hotel_id ?? '', l.descripcion ?? '', l.habitacion ?? '', l.venta_cent].join('|');
export function cambioChico(lineas, pendientes, aprobadas) {
  if (!aprobadas) return { hay_aprobada: false, ok: false, motivos: [] };
  const ya = new Set(aprobadas.map(firmaLinea));
  const motivos = [];
  if (pendientes.total) motivos.push(`${pendientes.total} pendiente${pendientes.total > 1 ? 's' : ''} en "Te falta"`);
  for (const l of lineas) {
    const aMano = l.tipo === 'manual' || l.pisado_neto || l.pisado_venta;
    if (aMano && !ya.has(firmaLinea(l))) motivos.push(`${l.descripcion}: precio a mano sin tarifa`);
  }
  return { hay_aprobada: true, ok: !motivos.length, motivos };
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
  const tot = totales(lineas, { pax: pedido.pasajeros, config, modo: cot.precio_modo, paquete_web_cent: cot.paquete_web_cent });
  const prueba = editable ? (usaPrueba(lineas, config) ? 1 : 0) : cot.usa_prueba;
  if (editable && (cot.total_neto_cent !== tot.neto_cent || cot.total_venta_cent !== tot.venta_cent || cot.usa_prueba !== prueba || cot.problemas !== tot.problemas)) {
    stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET total_neto_cent = ?, total_venta_cent = ?, usa_prueba = ?, problemas = ?, actualizado_en = ${ahora} WHERE id = ?`)
      .bind(tot.neto_cent, tot.venta_cent, prueba, tot.problemas, cotId));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const { token_hash, ...publica } = cot;
  const pendientes = pendientesDe(cot, lineas, tot);
  let chico = { hay_aprobada: false, ok: false, motivos: [] };
  if (editable) {
    const ap = await env.DB.prepare(`SELECT id FROM ct_cotizaciones WHERE pedido_id = ? AND id != ? AND aprobada_en IS NOT NULL ORDER BY version DESC LIMIT 1`).bind(cot.pedido_id, cotId).first();
    if (ap) chico = cambioChico(lineas, pendientes, (await env.DB.prepare(`SELECT * FROM ct_lineas WHERE cotizacion_id = ?`).bind(ap.id).all()).results);
  }
  return {
    cotizacion: { ...publica, total_neto_cent: tot.neto_cent, total_venta_cent: tot.venta_cent, usa_prueba: prueba, problemas: tot.problemas, config: config, avisos: parse(cot.avisos, []), editable, tiene_link: !!token_hash },
    pedido, lineas, totales: tot,
    pendientes, cambio_chico: chico,
  };
}

async function crearCotizacion(env, pedido, por, { version = 1, lineas = null, catalogo = null, extra = {} } = {}) {
  catalogo = catalogo || await cargarCatalogo(env);
  const config = await configActual(env);
  let avisos = extra.avisos || [];
  if (!lineas) {
    const a = armarBorrador(pedido, catalogo); lineas = a.lineas; avisos = [...avisos, ...a.avisos];
    const t = lineasTraslados({ pedido, catalogo, orden: lineas.length });
    lineas = [...lineas, ...t.lineas].sort((x, y) => (x.dia - y.dia) || (x.orden - y.orden)); avisos = [...avisos, ...t.avisos];
  }
  const r = await env.DB.prepare(`INSERT INTO ct_cotizaciones (pedido_id, version, estado, config_json, avisos, creado_por, variante, precio_modo, paquete_web_cent, paquete_web_confirmado) VALUES (?, ?, 'borrador', ?, ?, ?, ?, ?, ?, 0)`)
    .bind(pedido.id, version, JSON.stringify(config), JSON.stringify(avisos), por, extra.variante || null, extra.precio_modo || 'componentes', extra.paquete_web_cent ?? null).run();
  const cotId = r.meta.last_row_id;
  if (lineas.length) await env.DB.batch(lineas.map((l) => insertarLinea(env, cotId, l)));
  return cotId;
}

const COLS_LINEA = ['dia', 'orden', 'fecha', 'tipo', 'servicio_id', 'hotel_id', 'descripcion', 'pasajeros', 'cantidad', 'habitacion', 'unidades',
  'neto_cent', 'venta_cent', 'margen_fijo', 'pisado_neto', 'pisado_venta', 'nota',
  'precio_es_venta', 'es_ilustrativa', 'origen_precio', 'sin_confirmar', 'web_producto_id', 'web_dia', 'horario', 'modalidad'];
const insertarLinea = (env, cotId, l) => env.DB.prepare(`INSERT INTO ct_lineas (cotizacion_id, ${COLS_LINEA.join(', ')}) VALUES (?, ${COLS_LINEA.map(() => '?').join(', ')})`)
  .bind(cotId, ...COLS_LINEA.map((k) => l[k] ?? (['pisado_neto', 'pisado_venta', 'neto_cent', 'venta_cent', 'precio_es_venta', 'es_ilustrativa', 'sin_confirmar'].includes(k) ? 0 : k === 'origen_precio' ? 'tarifario' : ['cantidad', 'unidades', 'pasajeros'].includes(k) ? 1 : k === 'orden' ? 0 : null)));

export async function cambiarEstado(env, pedidoId, estado, por, nota = null) {
  return env.DB.batch([
    env.DB.prepare(`UPDATE ct_pedidos SET estado = ?, estado_desde = ${ahora}, actualizado_en = ${ahora} WHERE id = ?`).bind(estado, pedidoId),
    env.DB.prepare(`INSERT INTO ct_pedido_estados (pedido_id, estado, por, nota) VALUES (?, ?, ?, ?)`).bind(pedidoId, estado, por, nota),
  ]);
}

const ultimaCotizacion = (env, pedidoId) => env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE pedido_id = ? ORDER BY version DESC LIMIT 1`).bind(pedidoId).first();

// ---------- armado automático (Fase 3) ----------
export async function cargarWeb(env) {
  const [p, d] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM ct_web_productos WHERE activo = 1`),
    env.DB.prepare(`SELECT w.* FROM ct_web_dias w JOIN ct_web_productos p ON p.id = w.producto_id WHERE p.activo = 1 ORDER BY w.producto_id, w.dia`),
  ]);
  const dias = new Map();
  for (const x of d.results) (dias.get(x.producto_id) || dias.set(x.producto_id, []).get(x.producto_id)).push(x);
  return p.results.map((x) => ({ ...x, ciudades: parse(x.ciudades, []), dias_detalle: dias.get(x.id) || [] }));
}

// Arma el itinerario del pedido y deja las cotizaciones (una, o dos si los días no alcanzan: A y B).
// Sin lectura de la web cargada, o con servicios elegidos a mano, queda el borrador de siempre.
async function generarCotizaciones(env, pedido, por, version0 = 1) {
  const catalogo = await cargarCatalogo(env);
  const web = await cargarWeb(env);
  let variantes = null, falla = null;
  if (web.length && !(pedido.servicios || []).length) {
    try {
      const reglas = indexarReglas((await env.DB.prepare(`SELECT * FROM ct_reglas`).all()).results);
      variantes = (await armarItinerario({ pedido, catalogo, web, reglas, elegir: elegirConIA(env) })).variantes;
    } catch (e) { falla = `El armado automático falló (${String(e.message || e).slice(0, 80)}): quedó el borrador básico.`; }
  }
  if (!variantes || !variantes.length) return [await crearCotizacion(env, pedido, por, { version: version0, catalogo, extra: { avisos: falla ? [falla] : [] } })];
  const ids = [];
  let v = version0;
  for (const vr of variantes) {
    ids.push(await crearCotizacion(env, pedido, por, { version: v++, lineas: vr.lineas, catalogo, extra: { variante: vr.variante, precio_modo: vr.precio_modo, paquete_web_cent: vr.paquete_web_cent, avisos: vr.avisos } }));
  }
  await env.DB.prepare(`UPDATE ct_pedidos SET paquete_web_id = ? WHERE id = ?`).bind(variantes[0].paquete_web_id || null, pedido.id).run();
  return ids;
}

// ¿Esta versión es de la ronda vigente? (la última, o la A de un par A/B todavía abierto)
export async function esVigente(env, cot) {
  const ult = await ultimaCotizacion(env, cot.pedido_id);
  if (!ult) return false;
  if (ult.id === cot.id) return true;
  return ult.variante === 'B' && cot.variante === 'A' && cot.version === ult.version - 1;
}
// La otra variante del par, si sigue abierta.
export async function hermana(env, cot) {
  if (!cot.variante) return null;
  const v = cot.variante === 'A' ? cot.version + 1 : cot.version - 1;
  const h = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE pedido_id = ? AND version = ? AND variante = ? AND estado != 'reemplazada'`).bind(cot.pedido_id, v, cot.variante === 'A' ? 'B' : 'A').first();
  return h || null;
}

// ---------- endpoints ----------
// De quién es la pelota: en revisión la tiene el cotizador (Álvaro); en cualquier otro estado, el equipo.
export const duenoDe = (estado) => (estado === 'en_revision' ? 'cotizador' : 'equipo');

export async function listarPedidos(env) {
  const r = await env.DB.prepare(`SELECT p.id, p.nombre, p.pais, p.fecha_inicio, p.fecha_fin, p.fecha_tentativa, p.dias, p.origen, p.pasajeros, p.destinos, p.estado, p.estado_desde, p.creado_en, p.creado_por,
      p.urgente, p.nota_pase, p.pasado_en,
      c.id AS cotizacion_id, c.version, c.estado AS cot_estado, c.total_venta_cent, c.usa_prueba, c.problemas, c.revisor, c.notas_alvaro,
      (SELECT COUNT(*) FROM ct_lineas l WHERE l.cotizacion_id = c.id AND (l.problema IS NOT NULL OR l.sin_confirmar = 1 OR (l.es_ilustrativa = 1 AND l.pisado_neto = 0 AND l.pisado_venta = 0)))
        + CASE WHEN c.precio_modo = 'paquete_web' AND c.paquete_web_confirmado = 0 THEN 1 ELSE 0 END AS pendientes
    FROM ct_pedidos p
    LEFT JOIN ct_cotizaciones c ON c.id = (SELECT id FROM ct_cotizaciones WHERE pedido_id = p.id ORDER BY version DESC LIMIT 1)
    ORDER BY p.estado_desde DESC LIMIT 300`).all();
  return json({ pedidos: r.results.map((p) => ({ ...p, destinos: parse(p.destinos, []), dueno: duenoDe(p.estado) })), ahora: new Date().toISOString() });
}

// Chat del cliente para el pedido (solo lectura; también lo ve el cotizador). Sin notas internas.
export async function chatDePedido(env, id) {
  const p = await env.DB.prepare(`SELECT conversacion_id, lead_id FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!p) return json({ error: 'No existe' }, 404);
  let convId = p.conversacion_id;
  if (!convId && p.lead_id) convId = (await env.DB.prepare(`SELECT id FROM wa_conversaciones WHERE lead_id = ? ORDER BY actualizado_en DESC LIMIT 1`).bind(p.lead_id).first())?.id || null;
  if (!convId) return json({ mensajes: [], conversacion_id: null });
  const r = await env.DB.prepare(`SELECT * FROM (SELECT id, direccion, autor, tipo, texto, transcripcion, creado_en FROM wa_mensajes
      WHERE conversacion_id = ? AND tipo <> 'nota' ORDER BY creado_en DESC, id DESC LIMIT 80) ORDER BY creado_en, id`).bind(convId).all();
  return json({ mensajes: r.results, conversacion_id: convId });
}

// Pedidos de un lead o de un chat del inbox (el chip de estado y el link del pase).
export async function pedidosDe(env, leadId, convId) {
  const r = await env.DB.prepare(`SELECT p.id, p.nombre, p.estado, p.estado_desde, p.fecha_inicio, p.fecha_tentativa, p.origen,
      c.id AS cotizacion_id, c.version, c.estado AS cot_estado, c.total_venta_cent, c.usa_prueba
    FROM ct_pedidos p
    LEFT JOIN ct_cotizaciones c ON c.id = (SELECT id FROM ct_cotizaciones WHERE pedido_id = p.id ORDER BY version DESC LIMIT 1)
    WHERE (? IS NOT NULL AND p.lead_id = ?) OR (? IS NOT NULL AND p.conversacion_id = ?)
    ORDER BY p.id DESC LIMIT 20`).bind(leadId, leadId, convId, convId).all();
  return json({ pedidos: r.results });
}

async function insertarPedido(env, d, por) {
  const r = await env.DB.prepare(`INSERT INTO ct_pedidos (lead_id, nombre, pais, fecha_inicio, fecha_fin, pasajeros, destinos, servicios, categoria_hotel, pedidos_especiales, creado_por, dias, fecha_tentativa, conversacion_id, origen, excursiones, traslados)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(d.lead_id, d.nombre, d.pais, d.fecha_inicio, d.fecha_fin, d.pasajeros, JSON.stringify(d.destinos), JSON.stringify(d.servicios), d.categoria_hotel, d.pedidos_especiales, por, d.dias, d.fecha_tentativa, d.conversacion_id, d.origen, JSON.stringify(d.excursiones), JSON.stringify(d.traslados)).run();
  const id = r.meta.last_row_id;
  await env.DB.prepare(`INSERT INTO ct_pedido_estados (pedido_id, estado, por) VALUES (?, 'nuevo', ?)`).bind(id, por).run();
  return id;
}

export async function crearPedido(env, body, por) {
  const { errores, d } = leerPedido(body);
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  const id = await insertarPedido(env, d, por);
  // El sistema arma el borrador solo.
  const ids = await generarCotizaciones(env, { ...d, id }, 'sistema');
  await cambiarEstado(env, id, 'borrador_listo', 'sistema', ids.length > 1 ? 'Dos borradores armados (A y B): los días no alcanzan' : 'Borrador armado automáticamente');
  for (const cid of ids) await vistaCotizacion(env, cid);
  return json({ ok: true, id, cotizacion_id: ids[0], cotizaciones: ids });
}

// Fase 5: cotización desde un Excel. Los precios son los del Excel (de venta, sin margen); no se arma itinerario ni se mira el tarifario.
// body = { pedido, lineas: [{ dia, descripcion, total_grupo_cent }] } (lo que devolvió /api/ct/leer-texto, ya revisado en el panel).
export async function crearPedidoExcel(env, body, por) {
  const { errores, d } = leerPedido({ ...(body.pedido || {}), origen: 'excel' });
  const filas = (Array.isArray(body.lineas) ? body.lineas : []).slice(0, 120).map((l) => ({
    dia: Number.isInteger(Number(l && l.dia)) && Number(l.dia) >= 1 && Number(l.dia) <= 90 ? Number(l.dia) : 1,
    descripcion: texto(l && l.descripcion, 200), cent: Math.round(Number(l && l.total_grupo_cent)),
    horario: texto(l && l.horario, 60), modalidad: l && ['PRI', 'GRU'].includes(String(l.modalidad || '').toUpperCase()) ? String(l.modalidad).toUpperCase() : null,
  })).filter((l) => l.descripcion && Number.isFinite(l.cent) && l.cent >= 0);
  if (!filas.length) errores.push('el Excel no trajo líneas con precio');
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  const id = await insertarPedido(env, d, por);
  const lineas = filas.map((l, i) => ({
    dia: l.dia, orden: i, fecha: d.fecha_inicio ? new Date(Date.parse(d.fecha_inicio + 'T12:00:00Z') + (l.dia - 1) * 86400e3).toISOString().slice(0, 10) : null,
    tipo: 'manual', descripcion: l.descripcion, pasajeros: d.pasajeros, cantidad: 1, neto_cent: l.cent, precio_es_venta: 1,
    origen_precio: 'excel', horario: l.horario, modalidad: l.modalidad,
  }));
  const cid = await crearCotizacion(env, { ...d, id }, por, { lineas, extra: { avisos: ['Cotización importada de un Excel: los precios son los del Excel, sin margen. No se armó itinerario ni se miró el tarifario.'] } });
  await cambiarEstado(env, id, 'borrador_listo', por, 'Importado de un Excel');
  const v = await vistaCotizacion(env, cid);
  return json({ ok: true, id, cotizacion_id: cid, total_venta_cent: v.totales.venta_cent });
}

export async function verPedido(env, id) {
  const p = await env.DB.prepare(`SELECT * FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!p) return json({ error: 'No existe' }, 404);
  const [est, cots] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM ct_pedido_estados WHERE pedido_id = ? ORDER BY id`).bind(id),
    env.DB.prepare(`SELECT id, version, estado, variante, precio_modo, paquete_web_cent, total_venta_cent, usa_prueba, problemas, avisos, aprobada_por, aprobada_en, creado_en FROM ct_cotizaciones WHERE pedido_id = ? ORDER BY version DESC`).bind(id),
  ]);
  const cotizaciones = cots.results.map((c, i, todas) => ({ ...c, avisos: parse(c.avisos, []), vigente: i === 0 || (todas[0].variante === 'B' && c.variante === 'A' && c.version === todas[0].version - 1) }));
  return json({ pedido: pedidoDe(p), estados: est.results, cotizaciones });
}

export async function editarPedido(env, id, body, por) {
  const actual = await env.DB.prepare(`SELECT * FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!actual) return json({ error: 'No existe' }, 404);
  // Lo que el formulario no manda (conversación, origen, días, fecha tentativa) se conserva.
  const { errores, d } = leerPedido({ conversacion_id: actual.conversacion_id, origen: actual.origen, dias: actual.dias, fecha_tentativa: actual.fecha_tentativa, traslados: parse(actual.traslados, []), ...body });
  if (errores.length) return json({ error: errores.join('; ') }, 400);
  await env.DB.prepare(`UPDATE ct_pedidos SET lead_id = ?, nombre = ?, pais = ?, fecha_inicio = ?, fecha_fin = ?, pasajeros = ?, destinos = ?, servicios = ?, categoria_hotel = ?, pedidos_especiales = ?, dias = ?, fecha_tentativa = ?, conversacion_id = ?, origen = ?, excursiones = ?, traslados = ?, actualizado_en = ${ahora} WHERE id = ?`)
    .bind(d.lead_id, d.nombre, d.pais, d.fecha_inicio, d.fecha_fin, d.pasajeros, JSON.stringify(d.destinos), JSON.stringify(d.servicios), d.categoria_hotel, d.pedidos_especiales, d.dias, d.fecha_tentativa, d.conversacion_id, d.origen, JSON.stringify(d.excursiones), JSON.stringify(d.traslados), id).run();
  // Si cambió la fecha de inicio, las fechas de las líneas de la cotización editable se corren con ella.
  const cot = await ultimaCotizacion(env, id);
  if (cot && EDITABLES.includes(cot.estado) && d.fecha_inicio && d.fecha_inicio !== actual.fecha_inicio) {
    await env.DB.prepare(`UPDATE ct_lineas SET fecha = date(?, '+' || (dia - 1) || ' days') WHERE cotizacion_id = ? AND dia IS NOT NULL`).bind(d.fecha_inicio, cot.id).run();
  }
  return json({ ok: true });
}

// Borra el pedido entero: propuestas, líneas, cotizaciones e historial de estados
// (las claves foráneas no tienen CASCADE), todo en un batch atómico.
export async function borrarPedido(env, id) {
  const p = await env.DB.prepare(`SELECT id FROM ct_pedidos WHERE id = ?`).bind(id).first();
  if (!p) return json({ error: 'No existe' }, 404);
  const cots = `SELECT id FROM ct_cotizaciones WHERE pedido_id = ?`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ct_propuestas WHERE pedido_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ct_cambios_precio WHERE entidad = 'linea' AND entidad_id IN (SELECT CAST(id AS TEXT) FROM ct_lineas WHERE cotizacion_id IN (${cots}))`).bind(id),
    env.DB.prepare(`DELETE FROM ct_lineas WHERE cotizacion_id IN (${cots})`).bind(id),
    env.DB.prepare(`DELETE FROM ct_cotizaciones WHERE pedido_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ct_pedido_estados WHERE pedido_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM ct_pedidos WHERE id = ?`).bind(id),
  ]);
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
  if (p.origen === 'excel') return json({ error: 'Este pedido viene de un Excel: se corrige editando sus líneas, no se vuelve a armar' }, 409);
  const cot = await ultimaCotizacion(env, id);
  if (cot && !EDITABLES.includes(cot.estado)) return json({ error: 'La última versión está aprobada: creá una versión nueva' }, 409);
  if (!cot) { const ids = await generarCotizaciones(env, p, por); return json({ ok: true, cotizacion_id: ids[0], cotizaciones: ids }); }
  // Ronda nueva: las versiones abiertas de la ronda vigente quedan reemplazadas y se arman las de ahora (una o A y B).
  const vigentes = (await env.DB.prepare(`SELECT id, version, estado, variante FROM ct_cotizaciones WHERE pedido_id = ? ORDER BY version DESC LIMIT 2`).bind(id).all()).results
    .filter((c, i) => i === 0 || (c.variante === 'A' && cot.variante === 'B' && c.version === cot.version - 1));
  const ids = await generarCotizaciones(env, p, por, cot.version + 1);
  await env.DB.batch([
    ...vigentes.filter((c) => EDITABLES.includes(c.estado)).map((c) => env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'reemplazada', actualizado_en = ${ahora} WHERE id = ?`).bind(c.id)),
    env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por) VALUES ('cotizacion', ?, 'rearmada', ?, NULL, ?)`).bind(String(cot.id), usd(cot.total_venta_cent), por),
  ]);
  for (const cid of ids) await vistaCotizacion(env, cid);
  await cambiarEstado(env, id, 'borrador_listo', por, `Rearmado: versión ${cot.version + 1}${ids.length > 1 ? ' y siguiente (A y B)' : ''}`);
  return json({ ok: true, cotizacion_id: ids[0], cotizaciones: ids });
}

export async function nuevaVersion(env, cotId, por) {
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(cotId).first();
  if (!cot) return json({ error: 'No existe' }, 404);
  if (!(await esVigente(env, cot))) return json({ error: 'Ya hay una versión más nueva' }, 409);
  const ult = await ultimaCotizacion(env, cot.pedido_id);
  const sib = await hermana(env, cot);
  if (sib && EDITABLES.includes(sib.estado)) return json({ error: 'Elegí primero entre la variante A y la B' }, 409);
  const ls = (await env.DB.prepare(`SELECT * FROM ct_lineas WHERE cotizacion_id = ? ORDER BY dia, orden, id`).bind(cotId).all()).results;
  const nuevoId = await crearCotizacion(env, { id: cot.pedido_id }, por, { version: ult.version + 1, lineas: ls, extra: { variante: cot.variante, precio_modo: cot.precio_modo, paquete_web_cent: cot.paquete_web_cent } });
  await env.DB.batch([
    env.DB.prepare(`UPDATE ct_cotizaciones SET paquete_web_confirmado = ? WHERE id = ?`).bind(cot.paquete_web_confirmado, nuevoId),
    env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'reemplazada', actualizado_en = ${ahora} WHERE id = ?`).bind(cotId),
    env.DB.prepare(`UPDATE ct_cotizaciones SET notas_alvaro = ?, avisos = ?, revisor = ? WHERE id = ?`).bind(cot.notas_alvaro, cot.avisos, cot.revisor, nuevoId),
  ]);
  await cambiarEstado(env, cot.pedido_id, 'borrador_listo', por, `Versión ${ult.version + 1}`);
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
  if (body.precio_modo !== undefined) {
    if (!['componentes', 'paquete_web'].includes(body.precio_modo)) return json({ error: 'modo de precio no válido' }, 400);
    if (body.precio_modo === 'paquete_web' && cot.paquete_web_cent == null) return json({ error: 'Esta cotización no tiene un paquete publicado con precio' }, 400);
    if (body.precio_modo !== cot.precio_modo) {
      stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET precio_modo = ?, paquete_web_confirmado = 0 WHERE id = ?`).bind(body.precio_modo, cotId));
      stmts.push(env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por, motivo) VALUES ('cotizacion', ?, 'precio vale', ?, ?, ?, ?)`)
        .bind(String(cotId), cot.precio_modo, body.precio_modo, por, texto(body.motivo, 200)));
    }
  }
  if (body.confirmar_paquete_web) {
    if ((body.precio_modo || cot.precio_modo) !== 'paquete_web') return json({ error: 'El precio vigente es por componentes' }, 400);
    stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET paquete_web_confirmado = 1 WHERE id = ?`).bind(cotId));
    stmts.push(env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por) VALUES ('cotizacion', ?, 'precio del paquete web confirmado', ?, ?, ?)`)
      .bind(String(cotId), 'sin confirmar', usd(cot.paquete_web_cent), por));
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
  if (body.tipo === 'traslado') {
    // Traslado o tren desde "+ Agregar": si el nombre es el de un servicio del tarifario, sale con su tarifa;
    // si no, línea manual. Sin precio queda "falta el precio" y bloquea la aprobación hasta que se lo pongan.
    const que = texto(body.que, 120);
    if (!que) return json({ error: 'falta qué traslado o tren' }, 400);
    const mod = String(body.modalidad || '').toUpperCase() === 'GRU' ? 'GRU' : 'PRI';
    const pax = entero(body.pasajeros, 1, 60) || cot.pasajeros;
    const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const servs = (await env.DB.prepare(`SELECT id, nombre, tipo FROM ct_servicios WHERE activo = 1 AND tipo IN ('traslado', 'tren')`).all()).results;
    const s = servs.find((x) => norm(x.nombre) === norm(que));
    const hayNeto = body.neto !== undefined && body.neto !== '';
    const neto = hayNeto ? aCentavos(body.neto) : 0;
    if (neto === null) return json({ error: 'el neto tiene que ser un número (USD)' }, 400);
    if (s && !hayNeto) l = { ...base, tipo: s.tipo, servicio_id: s.id, descripcion: s.nombre, pasajeros: pax, modalidad: mod };
    else l = { ...base, tipo: 'manual', descripcion: `${que} (${mod === 'PRI' ? 'privado' : 'compartido'})`.slice(0, 200), pasajeros: pax, modalidad: mod,
      neto_cent: neto, venta_cent: 0, origen_precio: hayNeto ? 'manual' : 'pedido', sin_confirmar: hayNeto ? 0 : 1,
      nota: hayNeto ? null : 'Falta el precio: ponelo con Editar para que se pueda aprobar.' };
  } else if (body.tipo === 'manual') {
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

// Guarda el precio de una línea como tarifa del servicio u hotel (en USD, por persona o por habitación y noche).
// Si la línea venía de una tarifa real, la actualiza; si no (sin tarifa, de ejemplo o de la web), crea una vigente desde hoy.
// precio_es_venta del servicio u hotel decide si se guarda el neto o el precio final; si no tiene tarifas reales y solo se
// cargó el precio final, pasa a ser "precio final".
async function tarifaDesdeLinea(env, l, { neto, venta }, por, motivo) {
  const hotel = l.tipo === 'hotel';
  const padre = await env.DB.prepare(`SELECT * FROM ${hotel ? 'ct_hoteles' : 'ct_servicios'} WHERE id = ?`).bind(hotel ? l.hotel_id : l.servicio_id).first();
  if (!padre) return { error: hotel ? 'Falta elegir el hotel' : 'El servicio ya no está en el catálogo' };
  if (hotel && padre.es_ilustrativo) return { error: `${padre.nombre} es un hotel de ejemplo: elegí un hotel real en la línea (o cargalo en Configuración › Hoteles) y guardá su tarifa` };
  const tabla = hotel ? 'ct_hotel_tarifas' : 'ct_tarifas', col = hotel ? 'hotel_id' : 'servicio_id';
  const reales = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${col} = ? AND es_ilustrativa = 0`).bind(padre.id).first()).n;
  let esVenta = !!padre.precio_es_venta;
  if (!esVenta && neto === null && venta !== null) {
    if (reales) return { error: `${padre.nombre} tiene tarifas de costo (neto): para guardarlo en el tarifario cambiá el neto, no el precio final` };
    esVenta = true;
    await env.DB.prepare(`UPDATE ${hotel ? 'ct_hoteles' : 'ct_servicios'} SET precio_es_venta = 1, actualizado_en = ${ahora} WHERE id = ?`).bind(padre.id).run();
  }
  const total = esVenta ? (venta ?? neto) : neto;
  if (total === null || total === undefined) return { error: 'Cambiá el precio para guardarlo en el tarifario' };
  const divisor = hotel ? Math.max(1, (l.cantidad || 1) * (l.unidades || 1)) : Math.max(1, l.pasajeros || 1);
  const unit = Math.round(total / divisor);
  const actual = l.tarifa_id ? await env.DB.prepare(`SELECT * FROM ${tabla} WHERE id = ? AND ${col} = ?`).bind(l.tarifa_id, padre.id).first() : null;
  const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const hasta = `${Number(hoy.slice(0, 4)) + 2}-12-31`;
  const cuerpo = actual && !actual.es_ilustrativa
    ? { ...actual, precio_neto: (unit / 100).toFixed(2), moneda: 'USD', es_ilustrativa: 0, motivo }
    : { [col]: padre.id, habitacion: l.habitacion, pax_desde: 1, pax_hasta: null, temporada: 'todas', vigente_desde: hoy, vigente_hasta: hasta, precio_neto: (unit / 100).toFixed(2), moneda: 'USD', es_ilustrativa: 0, motivo };
  const res = await guardarTarifa(env, hotel ? 'hotel' : 'servicio', actual && !actual.es_ilustrativa ? actual.id : null, cuerpo, por);
  const j = await res.json();
  if (!res.ok) return { error: `No se guardó en el tarifario: ${j.error}` };
  const unidad = hotel ? `${l.habitacion} por noche` : 'por persona';
  return { id: j.id, es_venta: esVenta, texto: `${padre.nombre} · ${esVenta ? 'precio final' : 'neto'} ${unidad}`, antes: actual ? `${actual.moneda} ${(actual.neto_cent / 100).toFixed(2)}` : null, precio: `USD ${(unit / 100).toFixed(2)}` };
}

// Orden de las actividades dentro de un día (lo que se arrastra en el itinerario). body = { dia, ids: [lineas en orden] }.
// Solo cambia `orden`; el hotel del día queda al final. La propuesta y la vista leen por (dia, orden).
export async function ordenarLineas(env, cotId, body) {
  const { err } = await cotEditable(env, cotId);
  if (err) return err;
  const dia = entero(body.dia, 1, 120);
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 60);
  if (!dia || !ids.length) return json({ error: 'falta el día o el orden' }, 400);
  const del = (await env.DB.prepare(`SELECT id, tipo FROM ct_lineas WHERE cotizacion_id = ? AND dia = ?`).bind(cotId, dia).all()).results;
  const delDia = new Set(del.map((l) => l.id));
  if (ids.some((id) => !delDia.has(id))) return json({ error: 'Alguna actividad ya no está en ese día: recargá' }, 409);
  const resto = del.filter((l) => !ids.includes(l.id)).sort((a, b) => (a.tipo === 'hotel') - (b.tipo === 'hotel')).map((l) => l.id);
  await env.DB.batch([...ids, ...resto].map((id, i) => env.DB.prepare(`UPDATE ct_lineas SET orden = ? WHERE id = ? AND cotizacion_id = ?`).bind(i, id, cotId)));
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
  if (body.horario !== undefined) set('horario', texto(body.horario, 60));
  if (body.modalidad !== undefined) {
    const m = body.modalidad === '' || body.modalidad === null ? null : String(body.modalidad).toUpperCase();
    if (m !== null && m !== 'PRI' && m !== 'GRU') return json({ error: 'modalidad: PRI (privado) o GRU (grupal)' }, 400);
    set('modalidad', m);
  }
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
  const cambiaPrecio = sets.some((s) => s.startsWith('neto_cent') || s.startsWith('venta_cent'));
  // "Guardar también en el tarifario": el precio nuevo pasa a ser la tarifa del servicio u hotel y la línea vuelve a seguirla.
  if (body.guardar_tarifario && cambiaPrecio) {
    if (l.tipo === 'manual') return json({ error: 'Una línea manual no tiene servicio ni hotel: para el tarifario, cargala como servicio del catálogo' }, 400);
    const valor = (k) => { const i = sets.findIndex((s) => s.startsWith(k + ' ')); return i === -1 ? null : vals[i]; };
    const nueva = { ...l };
    sets.forEach((s, i) => { nueva[s.split(' ')[0]] = vals[i]; });
    const r = await tarifaDesdeLinea(env, nueva, { neto: valor('neto_cent'), venta: valor('venta_cent') }, por, motivo);
    if (r.error) return json({ error: r.error }, 409);
    const quitar = (k) => { let i; while ((i = sets.findIndex((s) => s.startsWith(k + ' '))) !== -1) { sets.splice(i, 1); vals.splice(i, 1); } };
    const ventaAMano = !r.es_venta && valor('venta_cent') !== null ? valor('venta_cent') : null;
    for (const k of ['neto_cent', 'venta_cent', 'pisado_neto', 'pisado_venta', 'sin_confirmar', 'es_ilustrativa', 'origen_precio']) quitar(k);
    set('pisado_neto', 0); set('sin_confirmar', 0); set('origen_precio', 'tarifario');
    if (ventaAMano !== null) { set('venta_cent', ventaAMano); set('pisado_venta', 1); } else set('pisado_venta', 0);
    log.push([`tarifario: ${r.texto}`, r.antes, r.precio]);
  }
  if (l.sin_confirmar && (body.confirmar || cambiaPrecio) && !body.guardar_tarifario) {
    set('sin_confirmar', 0);
    log.push(['precio web confirmado', 'sin confirmar', usd(sets.some((s) => s.startsWith('venta_cent')) ? vals[sets.findIndex((s) => s.startsWith('venta_cent'))] : l.venta_cent)]);
  }
  if (l.es_ilustrativa && !body.guardar_tarifario && (cambiaPrecio || body.ilustrativa === false)) {
    set('es_ilustrativa', 0); set('origen_precio', 'manual'); log.push(['ilustración corregida', 'ilustrativa', 'con precio']);
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

// Se queda con una de las dos variantes (A o B): la otra pasa a "reemplazada".
export async function elegirVariante(env, cotId, por) {
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(cotId).first();
  if (!cot) return json({ error: 'No existe' }, 404);
  if (!cot.variante) return json({ error: 'Esta cotización no es una variante' }, 400);
  const sib = await hermana(env, cot);
  if (!sib) return json({ ok: true, cotizacion_id: cotId });
  if (!EDITABLES.includes(cot.estado) || !EDITABLES.includes(sib.estado)) return json({ error: 'Alguna de las dos ya no se edita' }, 409);
  await env.DB.batch([
    env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'reemplazada', actualizado_en = ${ahora} WHERE id = ?`).bind(sib.id),
    env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por) VALUES ('cotizacion', ?, 'variante elegida', ?, ?, ?)`).bind(String(cot.pedido_id), sib.variante, cot.variante, por),
  ]);
  return json({ ok: true, cotizacion_id: cotId });
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
