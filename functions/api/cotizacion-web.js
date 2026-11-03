// Cotizaciones de las fichas de la web de Luna Llena (lunallenatravel-web).
//
// Cada ficha de tour/paquete tiene un formulario "Cotizar por WhatsApp"
// (nombre y teléfono obligatorios). Al mandarlo, la web abre WhatsApp con el
// pedido y, en paralelo, llama acá: queda un lead en el CRM con el paquete,
// la fecha, los viajeros, el total aproximado, de dónde vino la visita y el
// código LL-###### que también viaja en el mensaje ("ref LL-######").
//
// Como /api/lead-web, NO pide CRM_TOKEN: lo llama el JavaScript del sitio.
// Solo sabe crear (o completar) un lead. Contra el spam: honeypot + tiempo
// mínimo + validación.

import { canalDesdeReferer } from '../_lib/canal.js';
import { sincronizarManychat } from '../_lib/manychat.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const limpio = (v, max = 500) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const entero = (v, max = 99) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const CODIGO = /^LL-\d{6}$/;
const FUENTE = 'Página web';

export function onRequest({ request, next }) {
  if (request.method === 'POST') return next();
  return json({ error: 'metodo no permitido' }, 405);
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body invalido' }, 400);
  }

  if (limpio(body.apellido_2)) return json({ ok: true });
  const ms = Number(body.tiempo_ms);
  if (Number.isFinite(ms) && ms < 3000) return json({ ok: true });

  const nombre = limpio(body.nombre, 120);
  const telefono = limpio(body.telefono, 40);
  if (!nombre) return json({ error: 'falta el nombre' }, 400);
  if (!telefono || (telefono.match(/\d/g) || []).length < 6) return json({ error: 'telefono invalido' }, 400);

  const codigo = CODIGO.test(body.codigo || '') ? body.codigo : null;
  const manychatId = /^\d{1,20}$/.test(body.manychat_id || '') ? body.manychat_id : null;
  const paquete = limpio(body.paquete_nombre, 160);
  const adultos = entero(body.adultos) ?? 1;
  const menores = entero(body.menores) ?? 0;
  const edades = Array.isArray(body.edades) ? body.edades.map((x) => entero(x, 17)).filter((x) => x !== null) : [];
  const fecha = typeof body.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : null;
  const tarifa = limpio(body.tarifa, 120);
  const total = limpio(body.total, 40);
  const detalles = limpio(body.detalles, 2000);
  const referrer = limpio(body.referrer, 300);
  const utmSource = (limpio(body.utm_source, 120) || canalDesdeReferer(referrer) || 'directo').toLowerCase();
  const interno = body.interno === true;

  const notas = [
    interno ? 'PRUEBA INTERNA (navegador del equipo)' : null,
    codigo ? `Cotización desde la web · ref ${codigo}` : 'Cotización desde la web',
    tarifa ? `Tarifa: ${tarifa}` : null,
    total ? `Total aproximado: ${total}` : null,
    detalles ? `Detalles: ${detalles}` : null,
  ].filter(Boolean).join('\n');

  const meta = {
    sesion_web: limpio(body.sesion_id, 80),
    paquete_slug: limpio(body.paquete_slug, 120),
    tipo: limpio(body.tipo, 20),
    pagina: limpio(body.pagina, 200),
    tarifa, total, referrer,
    utm_medium: limpio(body.utm_medium, 120),
    utm_content: limpio(body.utm_content, 160),
    interno: interno || undefined,
  };

  const datos = {
    nombre,
    whatsapp: telefono,
    personas: adultos + menores,
    edades_menores: edades.length ? edades.join(', ') : null,
    destinos: paquete,
    fecha_viaje: fecha,
    precio: total,
    notas,
    tipo_cotizacion: 'Paquete',
    utm_source: utmSource,
    utm_campaign: limpio(body.utm_campaign, 160),
    codigo_web: codigo,
    manychat_id: manychatId,
    meta_json: JSON.stringify(meta),
  };

  const now = new Date().toISOString();

  // La misma visita que cotiza dos veces (cambió la fecha, otro paquete):
  // se completa el mismo lead en vez de duplicarlo.
  const existente = codigo
    ? await env.DB.prepare(
        `SELECT id FROM leads WHERE codigo_web = ? AND creado_en > datetime('now', '-1 day') LIMIT 1`
      ).bind(codigo).first()
    : null;

  // Si vino desde ManyChat y ya existe su lead (le escribió por Instagram o
  // WhatsApp antes), se completa ese lead: no se crea otro ni se pisa su nombre.
  const deManychat = !existente && manychatId
    ? await env.DB.prepare('SELECT id FROM leads WHERE manychat_id = ? ORDER BY id DESC LIMIT 1').bind(manychatId).first()
    : null;
  if (deManychat) {
    await env.DB.prepare(
      `UPDATE leads SET codigo_web = coalesce(codigo_web, ?), whatsapp = coalesce(whatsapp, ?),
              destinos = ?, fecha_viaje = coalesce(?, fecha_viaje), personas = ?, edades_menores = coalesce(?, edades_menores),
              precio = coalesce(?, precio), tipo_cotizacion = coalesce(tipo_cotizacion, 'Paquete'),
              notas = coalesce(notas || char(10) || char(10), '') || ?, actualizado_en = ?
        WHERE id = ?`
    ).bind(codigo, telefono, paquete, fecha, adultos + menores, datos.edades_menores, total,
      `[${now.slice(0, 10)}] ` + notas, now, deManychat.id).run();
    sincronizar(env, manychatId, waitUntil, interno);
    return json({ ok: true, id: deManychat.id, actualizado: true });
  }

  if (existente) {
    const cols = Object.keys(datos).filter((k) => datos[k] !== null);
    await env.DB.prepare(
      `UPDATE leads SET ${cols.map((c) => `${c} = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`
    ).bind(...cols.map((c) => datos[c]), now, existente.id).run();
    sincronizar(env, manychatId, waitUntil, interno);
    return json({ ok: true, id: existente.id, actualizado: true });
  }

  const cols = Object.keys(datos);
  const res = await env.DB.prepare(
    `INSERT INTO leads (${cols.join(', ')}, fuente, etapa, fecha_alta, creado_en, actualizado_en)
     VALUES (${cols.map(() => '?').join(', ')}, ?, 'lead_nuevo', ?, ?, ?)`
  ).bind(...cols.map((c) => datos[c]), FUENTE, now, now, now).run();

  sincronizar(env, manychatId, waitUntil, interno);
  return json({ ok: true, id: res.meta.last_row_id }, 201);
}

function sincronizar(env, manychatId, waitUntil, interno) {
  if (!manychatId || interno || !env.MANYCHAT_TOKEN) return;
  const p = sincronizarManychat(env, manychatId);
  if (waitUntil) waitUntil(p);
}
