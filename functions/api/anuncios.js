import { checkToken, json } from '../_lib/auth.js';

// Planillas diarias de la sección Anuncios.
//
// Dos campañas, una tabla cada una:
//   tipo=follow    Follow Me Ads (tráfico a perfil)  -> anuncios_dia
//   tipo=mensajes  campaña a WhatsApp / DM           -> anuncios_mensajes_dia
//
// GET  /api/anuncios?tipo=follow&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   Una fila por día que tenga algo. En Follow Me Ads se suma lo que el CRM ya
//   sabe de ese día (cuenta de Instagram, conversaciones del Sheet de setting,
//   ventas); en WhatsApp / DM todo es lo cargado a mano. El panel arma el
//   calendario y calcula CPM, CTR, costos y retornos: acá no se guarda nada
//   calculado.
//
// POST /api/anuncios  { tipo, fecha, <campo>: valor, ... }
//   Upsert parcial: solo pisa los campos que vienen. null o '' vacía la celda.

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS = {
  follow: {
    tabla: 'anuncios_dia',
    campos: { inversion: 'real', impresiones: 'entero', clicks: 'entero', seguidores: 'entero', frecuencia: 'real' },
  },
  mensajes: {
    tabla: 'anuncios_mensajes_dia',
    campos: {
      inversion: 'real', impresiones: 'entero', clicks: 'entero', repro_3s: 'entero', repro_50: 'entero',
      conversaciones: 'entero', cotizaciones: 'entero', clientes: 'entero', facturacion: 'real', cash: 'real',
    },
  },
};

function tipoDe(v) {
  return TIPOS[v] ? v : 'follow';
}

// Las tablas de embudo no existen en todos los CRM de la plantilla: si falta
// una, esa columna queda vacía en vez de romper la planilla entera.
async function filas(env, sql, args) {
  try {
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return results || [];
  } catch (e) {
    return [];
  }
}

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const tipo = tipoDe(url.searchParams.get('tipo'));
  const desde = url.searchParams.get('desde') || '';
  const hasta = url.searchParams.get('hasta') || '';
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) {
    return json({ error: 'desde y hasta requeridos (YYYY-MM-DD)' }, 400);
  }
  // Como mucho un año por pedido (el resumen anual).
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > 366) {
    return json({ error: 'el rango no puede pasar de un año' }, 400);
  }
  const rango = [desde, hasta];
  const { tabla, campos } = TIPOS[tipo];
  const cols = Object.keys(campos).join(', ');

  const dias = {};
  const dia = (f) => (dias[f] = dias[f] || { fecha: f });
  const ads = await filas(env, `SELECT fecha, ${cols}, nota, fuente FROM ${tabla} WHERE fecha BETWEEN ? AND ?`, rango);
  for (const r of ads) Object.assign(dia(r.fecha), r);

  if (tipo === 'follow') {
    const [cuenta, eventos, ventas] = await Promise.all([
      filas(env, 'SELECT fecha, views, comments, new_followers FROM metricas_cuenta_dia WHERE fecha BETWEEN ? AND ?', rango),
      // Una persona cuenta una vez por día y etapa. DIAS = entró la conversación;
      // FORMULARIO = pidió cotización. `con_pieza` separa las que entraron por
      // una pieza (comentario) de las que entraron de otra forma.
      filas(env, `SELECT fecha, evento,
                    COUNT(DISTINCT COALESCE(manychat_id, ig_username, clave)) AS n,
                    COUNT(DISTINCT CASE WHEN pieza IS NOT NULL AND pieza <> '' THEN COALESCE(manychat_id, ig_username, clave) END) AS con_pieza
                  FROM sheet_eventos
                  WHERE evento IN ('DIAS', 'FORMULARIO') AND fecha BETWEEN ? AND ?
                  GROUP BY fecha, evento`, rango),
      // Día de Perú (UTC-5), igual que el resto de las métricas de Luna Llena.
      filas(env, `SELECT date(COALESCE(sena_pagada_en, creado_en), '-5 hours') AS fecha, COUNT(*) AS n
                  FROM ventas
                  WHERE estado NOT IN ('pendiente_pago', 'cancelada')
                    AND date(COALESCE(sena_pagada_en, creado_en), '-5 hours') BETWEEN ? AND ?
                  GROUP BY 1`, rango),
    ]);
    for (const r of cuenta) Object.assign(dia(r.fecha), { views: r.views, comentarios_ig: r.comments, seguidores_total: r.new_followers });
    for (const r of eventos) {
      const d = dia(r.fecha);
      if (r.evento === 'DIAS') { d.conversaciones = r.n; d.conversaciones_pieza = r.con_pieza; }
      else d.cotizaciones = r.n;
    }
    for (const r of ventas) dia(r.fecha).ventas = r.n;
  }

  return json({ tipo, desde, hasta, dias: Object.values(dias).sort((a, b) => a.fecha.localeCompare(b.fecha)) });
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || !FECHA.test(body.fecha || '')) return json({ error: 'fecha requerida (YYYY-MM-DD)' }, 400);
  const tipo = tipoDe(body.tipo);
  const { tabla, campos } = TIPOS[tipo];

  const cols = [];
  const vals = [];
  for (const [campo, clase] of Object.entries(campos)) {
    if (!(campo in body)) continue;
    let v = body[campo];
    if (v === '' || v === null || v === undefined) v = null;
    else {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0) return json({ error: `${campo}: número inválido` }, 400);
      if (clase === 'entero') v = Math.round(v);
    }
    cols.push(campo);
    vals.push(v);
  }
  if ('nota' in body) {
    cols.push('nota');
    vals.push(body.nota ? String(body.nota).trim().slice(0, 300) : null);
  }
  if (!cols.length) return json({ error: 'nada para guardar' }, 400);

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ${tabla} (fecha, ${cols.join(', ')}, fuente, actualizado_en)
     VALUES (?, ${cols.map(() => '?').join(', ')}, 'manual', ?)
     ON CONFLICT(fecha) DO UPDATE SET
       ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
       fuente = 'manual', actualizado_en = excluded.actualizado_en`
  ).bind(body.fecha, ...vals, now).run();

  const fila = await env.DB.prepare(
    `SELECT fecha, ${Object.keys(campos).join(', ')}, nota, fuente FROM ${tabla} WHERE fecha = ?`
  ).bind(body.fecha).first();
  return json({ ok: true, tipo, dia: fila });
}
