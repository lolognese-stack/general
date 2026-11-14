// API del link de revisión (sin token del CRM: autoriza el token del link, en el header x-revision-token).
//   GET  /api/revision                 la cotización completa (con netos: es una página interna)
//   PUT  /api/revision/lineas/:lid     { neto | venta | margen | restaurar, motivo, nota }
//   PUT  /api/revision/notas           { notas_alvaro }
//   POST /api/revision/aprobar         { nota? }
//   POST /api/revision/cambios         { texto }
import { json } from '../../_lib/auth.js';
import { vistaCotizacion, editarLinea, editarCotizacion } from '../../_lib/ct-cotizaciones.js';
import { cotizacionDeToken, aprobar, pedirCambios } from '../../_lib/ct-revision.js';

export async function onRequest({ request, env, params }) {
  const { cot, err } = await cotizacionDeToken(env, request.headers.get('x-revision-token'));
  if (err) return err;
  const [sub, idTxt] = [].concat(params.ruta || []);
  const m = request.method;
  let body = {};
  if (m === 'POST' || m === 'PUT') { try { body = await request.json(); } catch {} }
  const por = `${cot.revisor || 'Revisión'} (link)`;
  try {
    if (!sub && m === 'GET') return json(await vistaCotizacion(env, cot.id));
    if (sub === 'lineas' && idTxt && m === 'PUT') {
      const lid = Number(idTxt);
      if (!Number.isInteger(lid)) return json({ error: 'línea no válida' }, 400);
      // Desde el link solo se tocan precios y notas (no días, hoteles ni pasajeros).
      const permitido = {};
      for (const k of ['neto', 'venta', 'margen', 'restaurar', 'motivo', 'nota']) if (body[k] !== undefined) permitido[k] = body[k];
      return editarLinea(env, cot.id, lid, permitido, por);
    }
    if (sub === 'notas' && m === 'PUT') return editarCotizacion(env, cot.id, { notas_alvaro: body.notas_alvaro }, por);
    if (sub === 'aprobar' && m === 'POST') return aprobar(env, cot, body);
    if (sub === 'cambios' && m === 'POST') return pedirCambios(env, cot, body);
  } catch (e) {
    return json({ error: 'Error interno: ' + String(e.message || e).slice(0, 200) }, 500);
  }
  return json({ error: 'No encontrado' }, 404);
}
