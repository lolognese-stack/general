import { rolDe, json } from '../_lib/auth.js';
import { listar, calcular, cargar, evento, leadGanado, autorDe, tokenNuevo, venceDe, slug, ESTADOS } from '../_lib/ventas.js';

// GET /api/ventas?estado=&desde=&hasta=&q=&lead_id=
// Cada venta trae lo calculado (pagado, saldo, viajeros, abandonada,
// confirmacion_vencida) y sus pagos aprobados, para que el panel arme los
// KPIs por período sin otra consulta.
export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const u = new URL(request.url);
  const f = Object.fromEntries(['estado', 'desde', 'hasta', 'q', 'lead_id'].map((k) => [k, u.searchParams.get(k) || '']));
  if (f.estado && !ESTADOS.includes(f.estado)) return json({ error: 'estado desconocido' }, 400);

  const ventas = await listar(env, f);
  const { results: pagos } = await env.DB.prepare(
    `SELECT venta_id, tipo, monto_centavos, moneda, proveedor, creado_en FROM venta_pagos WHERE estado = 'aprobado'`
  ).all();
  const porVenta = {};
  pagos.forEach((p) => { (porVenta[p.venta_id] = porVenta[p.venta_id] || []).push(p); });

  const ahora = Date.now();
  return json(ventas.map((v) => {
    const { token_viajeros, ...resto } = calcular(v, ahora);
    return { ...resto, pagos: porVenta[v.id] || [] };
  }));
}

// POST /api/ventas: venta cargada a mano (lo que se cierra por WhatsApp).
// Nace en pendiente_pago; la seña se registra después como pago y la pasa
// sola a sena_pagada, igual que el webhook de la web.
export async function onRequestPost({ request, env }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));

  const nombre = (b.nombre || '').trim();
  const producto = (b.producto_nombre || '').trim();
  const total = Number(b.total_centavos);
  const pct = b.sena_pct === undefined || b.sena_pct === '' ? 30 : Number(b.sena_pct);
  const adultos = b.adultos === undefined || b.adultos === '' ? 1 : Number(b.adultos);
  const menores = Number(b.menores || 0);
  const origen = b.origen || 'manual';

  if (!nombre) return json({ error: 'Falta el nombre de quien reserva' }, 400);
  if (!producto) return json({ error: 'Falta el paquete' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_inicio || '')) return json({ error: 'Falta la fecha de salida (YYYY-MM-DD)' }, 400);
  if (b.fecha_fin && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha_fin)) return json({ error: 'fecha_fin tiene que ser YYYY-MM-DD' }, 400);
  if (!Number.isInteger(total) || total <= 0) return json({ error: 'El total tiene que ser un entero en centavos mayor a 0' }, 400);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) return json({ error: 'El % de seña va de 0 a 100' }, 400);
  if (!Number.isInteger(adultos) || adultos < 1 || !Number.isInteger(menores) || menores < 0) return json({ error: 'Personas inválidas' }, 400);
  if (!['manual', 'whatsapp'].includes(origen)) return json({ error: "origen tiene que ser 'manual' o 'whatsapp'" }, 400);

  let leadId = b.lead_id ? Number(b.lead_id) : null;
  if (leadId) {
    const existe = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(leadId).first();
    if (!existe) return json({ error: 'El lead no existe' }, 400);
  }

  const id = crypto.randomUUID();
  const ahora = new Date().toISOString();
  const autor = autorDe(rol);
  const venta = {
    id, lead_id: leadId, origen,
    producto_slug: (b.producto_slug || '').trim() || slug(producto),
    producto_nombre: producto,
    producto_categoria: (b.producto_categoria || '').trim() || null,
    opcion: (b.opcion || '').trim() || null,
    fecha_inicio: b.fecha_inicio, fecha_fin: b.fecha_fin || null,
    adultos, menores,
    moneda: (b.moneda || 'USD').toUpperCase(),
    total_centavos: total, sena_pct: pct, sena_centavos: Math.round(total * pct / 100),
    estado: 'pendiente_pago',
    nombre, email: (b.email || '').trim(), whatsapp: (b.whatsapp || '').trim() || null,
    pais: (b.pais || '').trim() || null,
    notas_cliente: b.notas_cliente || null, notas_internas: b.notas_internas || null,
    token_viajeros: tokenNuevo(), token_vence: venceDe(b.fecha_inicio),
    creado_en: ahora, actualizado_en: ahora,
  };
  const cols = Object.keys(venta);
  const st = [
    env.DB.prepare(`INSERT INTO ventas (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...cols.map((c) => venta[c])),
    evento(env, id, 'creada', `Venta ${origen === 'whatsapp' ? 'por WhatsApp' : 'manual'}: ${producto}`, autor, ahora),
    // Venta elegida desde un lead: el lead ya se ganó.
    ...(await leadGanado(env, venta, ahora)),
  ];
  await env.DB.batch(st);
  return json(await cargar(env, id), 201);
}
