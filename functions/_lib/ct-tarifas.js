// Alta y edición de tarifas (servicio u hotel). La usan el tarifario y la casilla "Guardar también en el tarifario" de una línea.
import { json } from './auth.js';
import { leerFila, solapan, describirTramo } from './tarifario.js';

const ahora = "datetime('now')";
const texto = (v, max = 2000) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

// Fila de la base -> formato de leerFila (para controlar solapamientos).
export const comoTarifa = (t) => ({ clase: 'servicio', clave: t.clave, nombre: t.nombre, temporada: t.temporada, pax_desde: t.pax_desde, pax_hasta: t.pax_hasta, vigente_desde: t.vigente_desde, vigente_hasta: t.vigente_hasta, es_ilustrativa: t.es_ilustrativa, id: t.id });
export const comoHotelTarifa = (t) => ({ clase: 'hotel', clave: t.clave, nombre: t.nombre, habitacion: t.habitacion, temporada: t.temporada, vigente_desde: t.vigente_desde, vigente_hasta: t.vigente_hasta, es_ilustrativa: t.es_ilustrativa, id: t.id });

export const registro = (env, entidad, id, campo, antes, despues, por, motivo = null) =>
  env.DB.prepare(`INSERT INTO ct_cambios_precio (entidad, entidad_id, campo, antes, despues, por, motivo) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(entidad, String(id), campo, antes === null || antes === undefined ? null : String(antes), despues === null || despues === undefined ? null : String(despues), por, motivo);

export const precioTxt = (cent, moneda) => cent === null || cent === undefined ? null : `${moneda} ${(cent / 100).toFixed(2)}`;

// Tarifa (de servicio o de hotel): se valida con la misma lectura que el importador.
export async function guardarTarifa(env, clase, id, body, por) {
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
    : { tipo: padre.tipo, nombre: padre.nombre, ciudad: padre.ciudad, pax_desde: body.pax_desde, pax_hasta: body.pax_hasta, ganancia: body.ganancia };
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
    const vals = [padreId, d.neto_cent, d.moneda, d.pax_desde, d.pax_hasta, d.temporada, d.vigente_desde, d.vigente_hasta, d.es_ilustrativa, d.ganancia_cent ?? null];
    if (id) stmts.push(env.DB.prepare(`UPDATE ct_tarifas SET servicio_id=?, neto_cent=?, moneda=?, pax_desde=?, pax_hasta=?, temporada=?, vigente_desde=?, vigente_hasta=?, es_ilustrativa=?, ganancia_cent=?, fuente=COALESCE(fuente, 'a mano'), actualizado_en=${ahora} WHERE id=?`).bind(...vals, id));
    else stmts.push(env.DB.prepare(`INSERT INTO ct_tarifas (servicio_id, neto_cent, moneda, pax_desde, pax_hasta, temporada, vigente_desde, vigente_hasta, es_ilustrativa, ganancia_cent, fuente) VALUES (?,?,?,?,?,?,?,?,?,?, 'a mano')`).bind(...vals));
  }
  const res = await env.DB.batch(stmts);
  const nuevoId = id || res[0].meta.last_row_id;
  const antes = actual ? precioTxt(actual.neto_cent, actual.moneda) : null, despues = precioTxt(d.neto_cent, d.moneda);
  if (antes !== despues) await registro(env, entidad, nuevoId, actual ? 'precio' : 'alta', antes, despues, por, motivo).run();
  return json({ ok: true, id: nuevoId });
}

