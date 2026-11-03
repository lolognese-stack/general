// Reglas de Ventas compartidas por los endpoints de /api/ventas.
//
// Las tablas y los estados salen de crm/VENTAS-CONTRATO.md: la web de la
// agencia escribe en las mismas tablas (crea ventas en pendiente_pago y las
// pasa a sena_pagada desde el webhook). Todo lo que viene después de la seña
// es del CRM y vive acá. Montos siempre en centavos enteros.

export const ESTADOS = ['pendiente_pago', 'sena_pagada', 'confirmada', 'pagada', 'finalizada', 'cancelada'];
export const TIPOS_PAGO = ['sena', 'saldo', 'reembolso', 'ajuste'];
export const PROVEEDORES = ['stripe', 'paypal', 'transferencia', 'efectivo', 'yape', 'otro'];

// Transiciones que el panel puede pedir por PATCH. pendiente_pago ->
// sena_pagada exige un pago 'sena' aprobado y confirmada -> pagada exige
// lo cobrado >= total; las dos además pasan solas al registrar el pago.
export const TRANSICIONES = {
  pendiente_pago: ['sena_pagada', 'cancelada'],
  sena_pagada: ['confirmada', 'cancelada'],
  confirmada: ['pagada', 'cancelada'],
  pagada: ['finalizada', 'cancelada'],
  finalizada: [],
  cancelada: [],
};

export const ETIQUETA = {
  pendiente_pago: 'Pendiente de pago',
  sena_pagada: 'Seña pagada',
  confirmada: 'Confirmada',
  pagada: 'Pagada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const DOS_HORAS = 2 * 3600 * 1000;
const UN_DIA = 24 * 3600 * 1000;

export function autorDe(rol) {
  return rol === 'admin' ? 'panel:admin' : 'panel:cliente';
}

// "USD 1.500" / "USD 1.500,50": el mismo formato que usa el panel.
export function formatoMonto(centavos, moneda = 'USD') {
  const n = Math.round(Number(centavos) || 0);
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const enteros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cent = abs % 100;
  return `${moneda} ${neg}${enteros}${cent ? ',' + String(cent).padStart(2, '0') : ''}`;
}

export function tokenNuevo() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = '';
  b.forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// token_vence = fecha_inicio - 15 días (contrato). Al regenerar o mover la
// fecha, si eso ya pasó o está encima, se da al menos una semana desde hoy.
export function venceDe(fechaInicio, minimoUnaSemana = false) {
  const d = new Date(fechaInicio + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 15);
  if (minimoUnaSemana) {
    const semana = new Date(Date.now() + 7 * UN_DIA);
    if (d < semana) return semana.toISOString();
  }
  return d.toISOString();
}

export function slug(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Un viajero cuenta como completo con nombre, nacionalidad, documento y
// fecha de nacimiento (sexo y tipo de documento son opcionales).
export const SQL_VIAJERO_COMPLETO = `COALESCE(TRIM(nombre_completo),'') <> '' AND COALESCE(TRIM(nacionalidad),'') <> ''
  AND COALESCE(TRIM(doc_numero),'') <> '' AND COALESCE(TRIM(fecha_nacimiento),'') <> ''`;

// Neto aprobado: seña + saldo + ajustes - reembolsos.
export const SQL_PAGADO = `COALESCE((SELECT SUM(CASE WHEN p.tipo = 'reembolso' THEN -p.monto_centavos ELSE p.monto_centavos END)
  FROM venta_pagos p WHERE p.venta_id = v.id AND p.estado = 'aprobado'), 0)`;

const SQL_SELECT = `SELECT v.*, ${SQL_PAGADO} AS pagado_centavos,
  (SELECT COUNT(*) FROM venta_viajeros w WHERE w.venta_id = v.id AND ${SQL_VIAJERO_COMPLETO}) AS viajeros_completos,
  (SELECT GROUP_CONCAT(DISTINCT p.proveedor) FROM venta_pagos p WHERE p.venta_id = v.id AND p.estado = 'aprobado') AS proveedores,
  l.nombre AS lead_nombre, l.etapa AS lead_etapa
  FROM ventas v LEFT JOIN leads l ON l.id = v.lead_id`;

// Lo calculado que no se guarda (contrato: "Abandonada" y "Por confirmar vencida").
export function calcular(v, ahora = Date.now()) {
  const total = (v.adultos || 0) + (v.menores || 0);
  return {
    ...v,
    saldo_centavos: (v.total_centavos || 0) - (v.pagado_centavos || 0),
    viajeros_total: total,
    abandonada: v.estado === 'pendiente_pago' && ahora - Date.parse(v.creado_en) > DOS_HORAS,
    confirmacion_vencida: v.estado === 'sena_pagada' && !!v.sena_pagada_en && ahora - Date.parse(v.sena_pagada_en) > UN_DIA,
  };
}

export async function listar(env, filtros = {}) {
  const where = [];
  const binds = [];
  if (filtros.estado) { where.push('v.estado = ?'); binds.push(filtros.estado); }
  if (filtros.lead_id) { where.push('v.lead_id = ?'); binds.push(Number(filtros.lead_id)); }
  if (filtros.desde) { where.push('substr(v.creado_en, 1, 10) >= ?'); binds.push(filtros.desde); }
  if (filtros.hasta) { where.push('substr(v.creado_en, 1, 10) <= ?'); binds.push(filtros.hasta); }
  if (filtros.q) {
    where.push(`(v.nombre LIKE ? OR v.email LIKE ? OR v.whatsapp LIKE ? OR v.producto_nombre LIKE ? OR v.id LIKE ?)`);
    const q = `%${filtros.q}%`;
    binds.push(q, q, q, q, q);
  }
  const sql = SQL_SELECT + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY v.creado_en DESC';
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results;
}

export async function cargar(env, id) {
  const v = await env.DB.prepare(SQL_SELECT + ' WHERE v.id = ?').bind(id).first();
  return v ? calcular(v) : null;
}

export function evento(env, ventaId, tipo, detalle, autor, ahora) {
  return env.DB.prepare(
    'INSERT INTO venta_eventos (venta_id, tipo, detalle, autor, creado_en) VALUES (?, ?, ?, ?, ?)'
  ).bind(ventaId, tipo, detalle, autor, ahora);
}

// Lead enlazado a ganado + datos de la seña (contrato: igual que hace la web
// al cobrar). Devuelve las sentencias para sumarlas a un batch.
export async function leadGanado(env, venta, ahora) {
  if (!venta.lead_id) return [];
  const lead = await env.DB.prepare('SELECT etapa FROM leads WHERE id = ?').bind(venta.lead_id).first();
  if (!lead) return [];
  const st = [
    env.DB.prepare(
      `UPDATE leads SET etapa = 'ganado', sena_pct = ?, sena_fecha = ?, precio = ?, actualizado_en = ? WHERE id = ?`
    ).bind(venta.sena_pct, ahora.slice(0, 10), formatoMonto(venta.total_centavos, venta.moneda).replace(/,\d\d$/, ''), ahora, venta.lead_id),
  ];
  if (lead.etapa !== 'ganado') {
    st.push(env.DB.prepare(
      `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, ?, 'ganado', 'ventas', ?)`
    ).bind(venta.lead_id, lead.etapa, ahora));
  }
  return st;
}

// Pasa la venta a otro estado con sus marcas de tiempo y su evento.
// Devuelve las sentencias; no valida (eso lo hace quien llama).
export function sentenciasEstado(env, venta, hasta, autor, ahora, extra = {}) {
  const set = ['estado = ?', 'actualizado_en = ?'];
  const vals = [hasta, ahora];
  if (hasta === 'sena_pagada' && !venta.sena_pagada_en) { set.push('sena_pagada_en = ?'); vals.push(ahora); }
  if (hasta === 'confirmada') { set.push('confirmada_en = ?'); vals.push(ahora); }
  if (hasta === 'cancelada') {
    set.push('cancelada_en = ?', 'motivo_cancelacion = ?');
    vals.push(ahora, extra.motivo);
  }
  const detalle = `${ETIQUETA[venta.estado]} → ${ETIQUETA[hasta]}` + (extra.motivo ? `: ${extra.motivo}` : '') + (extra.auto ? ' (automático)' : '');
  return [
    env.DB.prepare(`UPDATE ventas SET ${set.join(', ')} WHERE id = ?`).bind(...vals, venta.id),
    evento(env, venta.id, 'estado', detalle, autor, ahora),
  ];
}
