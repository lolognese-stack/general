import { rolDe, json } from '../../_lib/auth.js';
import {
  cargar, evento, leadGanado, sentenciasEstado, autorDe, venceDe, slug, formatoMonto,
  TRANSICIONES, ETIQUETA,
} from '../../_lib/ventas.js';

// Campos que el panel puede editar. Estado, montos cobrados, tokens y
// marcas de tiempo van por sus propios caminos.
const EDITABLES = [
  'lead_id', 'producto_slug', 'producto_nombre', 'producto_categoria', 'opcion',
  'fecha_inicio', 'fecha_fin', 'adultos', 'menores', 'moneda', 'total_centavos', 'sena_pct',
  'nombre', 'email', 'whatsapp', 'pais', 'notas_cliente', 'notas_internas', 'origen',
];
const NOMBRES = {
  lead_id: 'lead', producto_slug: 'slug', producto_nombre: 'paquete', producto_categoria: 'categoría',
  opcion: 'opción', fecha_inicio: 'salida', fecha_fin: 'regreso', adultos: 'adultos', menores: 'menores',
  moneda: 'moneda', total_centavos: 'total', sena_pct: '% seña', nombre: 'nombre', email: 'email',
  whatsapp: 'WhatsApp', pais: 'país', notas_cliente: 'notas del cliente', notas_internas: 'notas internas', origen: 'origen',
};

export async function onRequestGet({ request, env, params }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const v = await cargar(env, params.id);
  if (!v) return json({ error: 'No existe esa venta' }, 404);
  const [pagos, viajeros, eventos] = await Promise.all([
    env.DB.prepare('SELECT * FROM venta_pagos WHERE venta_id = ? ORDER BY creado_en').bind(v.id).all(),
    env.DB.prepare('SELECT * FROM venta_viajeros WHERE venta_id = ? ORDER BY orden').bind(v.id).all(),
    env.DB.prepare('SELECT * FROM venta_eventos WHERE venta_id = ? ORDER BY creado_en, id').bind(v.id).all(),
  ]);
  return json({
    ...v,
    pagos: pagos.results, viajeros: viajeros.results, eventos: eventos.results,
    lead: v.lead_id && v.lead_nombre !== null ? { id: v.lead_id, nombre: v.lead_nombre, etapa: v.lead_etapa } : null,
    web_url: (env.VENTAS_WEB_URL || '').replace(/\/+$/, '') || null,
  });
}

// PATCH: edita datos y/o cambia de estado ({ estado, motivo_cancelacion }).
export async function onRequestPatch({ request, env, params }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  const b = await request.json().catch(() => ({}));
  const v = await cargar(env, params.id);
  if (!v) return json({ error: 'No existe esa venta' }, 404);
  const ahora = new Date().toISOString();
  const autor = autorDe(rol);
  const st = [];
  let aviso = null;

  // ---- datos ----
  const campos = Object.keys(b).filter((k) => EDITABLES.includes(k));
  const nuevo = {};
  for (const k of campos) {
    let val = b[k];
    if (typeof val === 'string') val = val.trim();
    if (val === '') val = null;
    if (['adultos', 'menores', 'total_centavos', 'sena_pct', 'lead_id'].includes(k) && val !== null) val = Number(val);
    nuevo[k] = val;
  }
  const err = validar(nuevo);
  if (err) return json({ error: err }, 400);
  if (nuevo.lead_id) {
    const existe = await env.DB.prepare('SELECT id FROM leads WHERE id = ?').bind(nuevo.lead_id).first();
    if (!existe) return json({ error: 'El lead no existe' }, 400);
  }
  if ('email' in nuevo && nuevo.email === null) nuevo.email = '';       // NOT NULL en el contrato
  if ('producto_slug' in nuevo && !nuevo.producto_slug) nuevo.producto_slug = slug(nuevo.producto_nombre || v.producto_nombre);
  if ('moneda' in nuevo) nuevo.moneda = (nuevo.moneda || 'USD').toUpperCase();
  // La seña en centavos se recalcula mientras no se cobró: después queda la
  // que efectivamente se cobró.
  if (v.estado === 'pendiente_pago' && ('total_centavos' in nuevo || 'sena_pct' in nuevo)) {
    nuevo.sena_centavos = Math.round((nuevo.total_centavos ?? v.total_centavos) * (nuevo.sena_pct ?? v.sena_pct) / 100);
  }
  if ('fecha_inicio' in nuevo && nuevo.fecha_inicio !== v.fecha_inicio) nuevo.token_vence = venceDe(nuevo.fecha_inicio, true);

  const cambiados = Object.keys(nuevo).filter((k) => nuevo[k] !== v[k]);
  if (cambiados.length) {
    st.push(env.DB.prepare(`UPDATE ventas SET ${cambiados.map((k) => `${k} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`)
      .bind(...cambiados.map((k) => nuevo[k]), ahora, v.id));
    if (cambiados.includes('lead_id')) {
      const l = nuevo.lead_id ? await env.DB.prepare('SELECT nombre FROM leads WHERE id = ?').bind(nuevo.lead_id).first() : null;
      st.push(evento(env, v.id, 'nota', l ? `Enlazada al lead ${(l.nombre || '').trim()}` : 'Lead desenlazado', autor, ahora));
    }
    const visibles = cambiados.filter((k) => NOMBRES[k] && k !== 'lead_id');
    if (visibles.length) {
      const soloNotas = visibles.length === 1 && visibles[0] === 'notas_internas';
      st.push(evento(env, v.id, 'nota', soloNotas ? 'Notas internas actualizadas' : 'Datos editados: ' + visibles.map((k) => NOMBRES[k]).join(', '), autor, ahora));
    }
  }
  const actual = { ...v, ...nuevo };
  // Enlazar un lead a una venta con la seña ya cobrada lo deja ganado, como
  // hace la web al cobrar.
  if (cambiados.includes('lead_id') && actual.lead_id && !['pendiente_pago', 'cancelada'].includes(v.estado)) {
    st.push(...(await leadGanado(env, actual, ahora)));
  }

  // ---- estado ----
  if (b.estado && b.estado !== v.estado) {
    const hasta = b.estado;
    if (!ETIQUETA[hasta]) return json({ error: 'Estado desconocido' }, 400);
    if (!TRANSICIONES[v.estado].includes(hasta)) {
      return json({ error: `No se puede pasar de "${ETIQUETA[v.estado]}" a "${ETIQUETA[hasta]}". Desde ${ETIQUETA[v.estado]} se puede ir a: ${TRANSICIONES[v.estado].map((e) => ETIQUETA[e]).join(', ') || 'ningún estado'}.` }, 409);
    }
    if (hasta === 'sena_pagada') {
      const sena = await env.DB.prepare(`SELECT id FROM venta_pagos WHERE venta_id = ? AND tipo = 'sena' AND estado = 'aprobado' LIMIT 1`).bind(v.id).first();
      if (!sena) return json({ error: 'Para pasar a "Seña pagada" primero registra el pago de la seña.' }, 409);
    }
    if (hasta === 'pagada' && actual.pagado_centavos < actual.total_centavos) {
      return json({ error: `Faltan ${formatoMonto(actual.total_centavos - actual.pagado_centavos, actual.moneda)} para marcarla pagada. Registra el saldo y pasa sola.` }, 409);
    }
    let motivo = null;
    if (hasta === 'cancelada') {
      motivo = (b.motivo_cancelacion || '').trim();
      if (!motivo) return json({ error: 'Para cancelar hace falta el motivo.' }, 400);
      if (actual.pagado_centavos > 0) {
        aviso = `Hay ${formatoMonto(actual.pagado_centavos, actual.moneda)} cobrados: si se devuelven, haz el reembolso en el medio de pago y regístralo como pago tipo "reembolso".`;
      }
    }
    st.push(...sentenciasEstado(env, actual, hasta, autor, ahora, { motivo }));
    if (hasta === 'sena_pagada') st.push(...(await leadGanado(env, actual, ahora)));
    // Confirmada con todo ya cobrado: pasa sola a pagada.
    if (hasta === 'confirmada' && actual.pagado_centavos >= actual.total_centavos) {
      st.push(...sentenciasEstado(env, { ...actual, estado: 'confirmada' }, 'pagada', autor, ahora, { auto: true }));
    }
  } else if (b.motivo_cancelacion !== undefined && v.estado === 'cancelada') {
    const motivo = (b.motivo_cancelacion || '').trim();
    if (!motivo) return json({ error: 'El motivo no puede quedar vacío.' }, 400);
    st.push(env.DB.prepare('UPDATE ventas SET motivo_cancelacion = ?, actualizado_en = ? WHERE id = ?').bind(motivo, ahora, v.id));
  }

  if (!st.length) return json({ ...v, aviso: null });
  await env.DB.batch(st);
  return json({ ...(await cargar(env, v.id)), aviso });
}

// DELETE: borrado real, solo admin, solo sin pagos, y confirmando con el
// nombre de la persona ({ confirmar: "<nombre>" }).
export async function onRequestDelete({ request, env, params }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);
  if (rol !== 'admin') return json({ error: 'Solo el admin puede borrar ventas.' }, 403);
  const v = await env.DB.prepare('SELECT id, nombre FROM ventas WHERE id = ?').bind(params.id).first();
  if (!v) return json({ error: 'No existe esa venta' }, 404);
  const b = await request.json().catch(() => ({}));
  const norm = (s) => (s || '').toString().trim().toLowerCase();
  if (norm(b.confirmar) !== norm(v.nombre)) return json({ error: 'Para borrar escribe el nombre exacto de quien reserva.' }, 400);
  const pago = await env.DB.prepare('SELECT id FROM venta_pagos WHERE venta_id = ? LIMIT 1').bind(v.id).first();
  if (pago) return json({ error: 'Tiene pagos registrados: no se puede borrar. Cancélala.' }, 409);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM venta_viajeros WHERE venta_id = ?').bind(v.id),
    env.DB.prepare('DELETE FROM venta_eventos WHERE venta_id = ?').bind(v.id),
    env.DB.prepare('DELETE FROM ventas WHERE id = ?').bind(v.id),
  ]);
  return json({ ok: true });
}

function validar(n) {
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if ('nombre' in n && !n.nombre) return 'El nombre no puede quedar vacío';
  if ('producto_nombre' in n && !n.producto_nombre) return 'El paquete no puede quedar vacío';
  if ('fecha_inicio' in n && !fecha.test(n.fecha_inicio || '')) return 'La salida tiene que ser YYYY-MM-DD';
  if ('fecha_fin' in n && n.fecha_fin !== null && !fecha.test(n.fecha_fin)) return 'El regreso tiene que ser YYYY-MM-DD';
  if ('adultos' in n && (!Number.isInteger(n.adultos) || n.adultos < 1)) return 'Al menos 1 adulto';
  if ('menores' in n && n.menores !== null && (!Number.isInteger(n.menores) || n.menores < 0)) return 'Menores inválido';
  if ('menores' in n && n.menores === null) n.menores = 0;
  if ('total_centavos' in n && (!Number.isInteger(n.total_centavos) || n.total_centavos <= 0)) return 'El total tiene que ser un entero en centavos mayor a 0';
  if ('sena_pct' in n && (!Number.isInteger(n.sena_pct) || n.sena_pct < 0 || n.sena_pct > 100)) return 'El % de seña va de 0 a 100';
  if ('origen' in n && !['web', 'manual', 'whatsapp'].includes(n.origen)) return 'Origen inválido';
  return null;
}
