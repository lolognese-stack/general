import { rolDe, json } from '../../../_lib/auth.js';
import { cargar, evento, leadGanado, sentenciasEstado, autorDe, formatoMonto, TIPOS_PAGO, PROVEEDORES } from '../../../_lib/ventas.js';

const NOMBRE_TIPO = { sena: 'Seña', saldo: 'Saldo', reembolso: 'Reembolso', ajuste: 'Ajuste' };
const NOMBRE_PROV = { stripe: 'Stripe', paypal: 'PayPal', transferencia: 'transferencia', efectivo: 'efectivo', yape: 'Yape', otro: 'otro medio' };

// POST /api/ventas/:id/pagos: pago registrado a mano desde el panel.
// La seña cobrada por fuera de la web también entra por acá y hace lo mismo
// que el webhook (pendiente_pago -> sena_pagada + lead ganado). Si con este
// pago lo cobrado alcanza el total y la venta está confirmada, pasa a pagada.
export async function onRequestPost({ request, env, params }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const v = await cargar(env, params.id);
  if (!v) return json({ error: 'No existe esa venta' }, 404);
  const b = await request.json().catch(() => ({}));

  const tipo = b.tipo;
  const monto = Number(b.monto_centavos);
  const proveedor = b.proveedor;
  const referencia = (b.referencia || '').trim() || null;
  if (!TIPOS_PAGO.includes(tipo)) return json({ error: 'Tipo de pago inválido' }, 400);
  if (!Number.isInteger(monto) || monto <= 0) return json({ error: 'El monto tiene que ser un entero en centavos mayor a 0' }, 400);
  if (!PROVEEDORES.includes(proveedor)) return json({ error: 'Medio de pago inválido' }, 400);
  if (v.estado === 'cancelada' && tipo !== 'reembolso') return json({ error: 'La venta está cancelada: solo se puede registrar un reembolso.' }, 409);
  if (tipo === 'reembolso' && monto > v.pagado_centavos) {
    return json({ error: `El reembolso supera lo cobrado (${formatoMonto(v.pagado_centavos, v.moneda)}).` }, 400);
  }
  if (referencia) {
    const repetido = await env.DB.prepare('SELECT id FROM venta_pagos WHERE proveedor = ? AND referencia = ?').bind(proveedor, referencia).first();
    if (repetido) return json({ error: `Ese pago ya está registrado (${NOMBRE_PROV[proveedor]}, referencia ${referencia}).` }, 409);
  }

  const ahora = new Date().toISOString();
  const autor = autorDe(rol);
  const st = [
    env.DB.prepare(
      `INSERT INTO venta_pagos (venta_id, tipo, monto_centavos, moneda, proveedor, referencia, estado, registrado_por, nota, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'aprobado', 'panel', ?, ?)`
    ).bind(v.id, tipo, monto, v.moneda, proveedor, referencia, (b.nota || '').trim() || null, ahora),
    evento(env, v.id, 'pago', `${NOMBRE_TIPO[tipo]} ${formatoMonto(monto, v.moneda)} por ${NOMBRE_PROV[proveedor]}${referencia ? ` (ref. ${referencia})` : ''}`, autor, ahora),
    env.DB.prepare('UPDATE ventas SET actualizado_en = ? WHERE id = ?').bind(ahora, v.id),
  ];

  const pagado = v.pagado_centavos + (tipo === 'reembolso' ? -monto : monto);
  if (tipo === 'sena' && v.estado === 'pendiente_pago') {
    st.push(...sentenciasEstado(env, v, 'sena_pagada', autor, ahora, { auto: true }));
    st.push(...(await leadGanado(env, v, ahora)));
  }
  if (v.estado === 'confirmada' && pagado >= v.total_centavos) {
    st.push(...sentenciasEstado(env, v, 'pagada', autor, ahora, { auto: true }));
  }

  try {
    await env.DB.batch(st);
  } catch (e) {
    // Carrera contra el índice único (dos clicks o un webhook a la vez).
    if (/UNIQUE/i.test(String(e && e.message))) return json({ error: 'Ese pago ya está registrado (mismo medio y referencia).' }, 409);
    throw e;
  }
  return json(await cargar(env, v.id), 201);
}
