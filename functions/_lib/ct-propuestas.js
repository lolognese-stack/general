// Propuestas para el cliente, desde el CRM: generar (con textos de IA), vista previa editable, publicar y servir.
// La cotización manda: sin aprobar, con precios de prueba, con precios web sin confirmar o con ilustraciones se ve la vista
// previa interna con banda roja, pero NO se publica ni se marca enviada.
//   GET  /api/ct/pedidos/:id/propuesta       { propuesta, bloqueos }      POST (generar o regenerar, con IA)
//   GET  /api/ct/propuestas                  lista                       GET /api/ct/propuestas/:id  { propuesta, datos, bloqueos }
//   GET  /api/ct/propuestas/:id/vista        { html, banda, bloqueos }   PUT /api/ct/propuestas/:id  { cambios: [{ruta, valor}] }
//   POST /api/ct/propuestas/:id/publicar     { changelog? }              POST /api/ct/propuestas/:id/retirar
//   GET  /api/propuesta-publica?slug=        (público) la página publicada

import { json } from './auth.js';
import { vistaCotizacion, cargarCatalogo, cargarWeb, esVigente, cambiarEstado } from './ct-cotizaciones.js';
import { armarDatos, escribirTextos, bloqueosDe, bandaDe, aplicarCambios, slugDe } from './ct-propuesta-datos.js';
import { renderPagina, configEfectivo, hoyLima, SLUG_OK } from './propuesta-pagina.js';
import { PROPUESTAS_URL } from './propuestas.js';
import { setterActivo, alWorker } from './setter.js';

const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const ANTES_DE_ENVIADA = ['lead_nuevo', 'contactado', 'propuesta_pendiente'];

export async function configPlantilla(env) {
  const f = await env.DB.prepare(`SELECT valor FROM propuestas_config WHERE clave = 'plantilla'`).first().catch(() => null);
  return configEfectivo(parse(f && f.valor, null));
}

// La cotización de la propuesta: la aprobada más nueva; si no hay, la última que no quedó reemplazada.
async function cotizacionDe(env, pedidoId) {
  return (await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE pedido_id = ? AND estado = 'aprobada' ORDER BY version DESC LIMIT 1`).bind(pedidoId).first())
    || (await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE pedido_id = ? AND estado != 'reemplazada' ORDER BY version DESC LIMIT 1`).bind(pedidoId).first());
}

const resumenFila = (r) => ({
  id: r.id, pedido_id: r.pedido_id, cotizacion_id: r.cotizacion_id, slug: r.slug, estado: r.estado, version: r.version, valid_until: r.valid_until,
  textos: r.textos, creada_por: r.creada_por, creada_en: r.creada_en, actualizada_en: r.actualizada_en, publicada_por: r.publicada_por, publicada_en: r.publicada_en,
});

async function bloqueosDeFila(env, r) {
  const vista = await vistaCotizacion(env, r.cotizacion_id);
  if (!vista) return { vista: null, bloqueos: ['La cotización ya no existe'] };
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(r.cotizacion_id).first();
  return { vista, bloqueos: bloqueosDe(vista, { vigente: await esVigente(env, cot) }) };
}

export async function propuestaDePedido(env, pedidoId) {
  const r = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE pedido_id = ? ORDER BY id DESC LIMIT 1`).bind(pedidoId).first();
  if (!r) {
    const cot = await cotizacionDe(env, pedidoId);
    const vista = cot ? await vistaCotizacion(env, cot.id) : null;
    return json({ propuesta: null, bloqueos: vista ? bloqueosDe(vista) : ['Todavía no hay cotización'] });
  }
  const { bloqueos } = await bloqueosDeFila(env, r);
  return json({ propuesta: { ...resumenFila(r), link: r.estado === 'publicada' ? `${PROPUESTAS_URL(env)}/${r.slug}/` : null }, bloqueos });
}

// Arma (o vuelve a armar) la propuesta del pedido. Los textos los escribe la IA una sola vez; quedan guardados y se editan en la vista previa.
export async function generarPropuesta(env, pedidoId, por, { conIA = true } = {}) {
  const cot = await cotizacionDe(env, pedidoId);
  if (!cot) return json({ error: 'Este pedido todavía no tiene cotización' }, 409);
  const vista = await vistaCotizacion(env, cot.id);
  const [catalogo, web] = await Promise.all([cargarCatalogo(env), cargarWeb(env)]);
  const hoy = hoyLima();
  const previa = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE pedido_id = ? ORDER BY id DESC LIMIT 1`).bind(pedidoId).first();
  const ant = previa ? parse(previa.borrador_json, null) : null;
  const previo = ant ? { validUntil: ant.validUntil, version: ant.version, updatedAt: ant.updatedAt, changelog: ant.changelog, videoUrl: ant.videoUrl } : null;
  const numero = ant ? `CT-${pedidoId}-v${vista.cotizacion.version}` : undefined;

  let datos = armarDatos({ vista, catalogo, web, hoy, numero, previo });
  let textos = 'base', modelo = null, aviso = null;
  if (conIA) {
    const r = await escribirTextos(env, datos);
    if (r.textos) {
      datos = armarDatos({ vista, catalogo, web, hoy, numero, previo, textos: r.textos });
      textos = 'ia'; modelo = r.modelo;
    } else aviso = `No se pudieron redactar los textos con IA (${r.error}). Quedaron los de la ficha de la web: se editan en la vista previa.`;
  }
  const ahora = new Date().toISOString();
  if (previa) {
    await env.DB.prepare(`UPDATE ct_propuestas SET cotizacion_id = ?, borrador_json = ?, textos = ?, modelo = ?, valid_until = ?, actualizada_en = ? WHERE id = ?`)
      .bind(cot.id, JSON.stringify(datos), textos, modelo, datos.validUntil, ahora, previa.id).run();
    return json({ ok: true, id: previa.id, slug: previa.slug, textos, aviso });
  }
  const slug = slugDe(vista.pedido.nombre);
  const r = await env.DB.prepare(`INSERT INTO ct_propuestas (pedido_id, cotizacion_id, lead_id, slug, estado, version, borrador_json, valid_until, changelog, textos, modelo, creada_por, creada_en, actualizada_en)
    VALUES (?, ?, ?, ?, 'borrador', 1, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(pedidoId, cot.id, vista.pedido.lead_id ?? null, slug, JSON.stringify({ ...datos, slug }), datos.validUntil, JSON.stringify(datos.changelog), textos, modelo, por, ahora, ahora).run();
  return json({ ok: true, id: r.meta.last_row_id, slug, textos, aviso });
}

export async function verPropuesta(env, id) {
  const r = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE id = ?`).bind(id).first();
  if (!r) return json({ error: 'No existe' }, 404);
  const { bloqueos } = await bloqueosDeFila(env, r);
  return json({ propuesta: { ...resumenFila(r), link: r.estado === 'publicada' ? `${PROPUESTAS_URL(env)}/${r.slug}/` : null }, datos: parse(r.borrador_json, {}), bloqueos, hay_cambios_sin_publicar: r.estado === 'publicada' && r.borrador_json !== r.datos_json });
}

export async function listarPropuestas(env) {
  const r = await env.DB.prepare(`SELECT pr.*, p.nombre, p.pasajeros FROM ct_propuestas pr JOIN ct_pedidos p ON p.id = pr.pedido_id ORDER BY pr.id DESC LIMIT 200`).all();
  return json({ propuestas: r.results.map((x) => ({ ...resumenFila(x), nombre: x.nombre, pasajeros: x.pasajeros })) });
}

// Vista previa interna (con login). Muestra el borrador; con bloqueos, banda roja.
export async function vistaPropuesta(env, id, origen) {
  const r = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE id = ?`).bind(id).first();
  if (!r) return json({ error: 'No existe' }, 404);
  const { bloqueos } = await bloqueosDeFila(env, r);
  const banda = bandaDe(bloqueos);
  const html = renderPagina(parse(r.borrador_json, {}), { slug: r.slug, cfg: await configPlantilla(env), vista: true, banda, crm: origen });
  return json({ html, banda, bloqueos });
}

export async function editarPropuesta(env, id, body) {
  const r = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE id = ?`).bind(id).first();
  if (!r) return json({ error: 'No existe' }, 404);
  const { datos, errores } = aplicarCambios(parse(r.borrador_json, {}), body.cambios);
  if (errores.length) return json({ error: errores.join('; '), errores }, 400);
  await env.DB.prepare(`UPDATE ct_propuestas SET borrador_json = ?, valid_until = ?, actualizada_en = ? WHERE id = ?`).bind(JSON.stringify(datos), datos.validUntil, new Date().toISOString(), id).run();
  return json({ ok: true });
}

export async function publicarPropuesta(env, id, body, por) {
  const r = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE id = ?`).bind(id).first();
  if (!r) return json({ error: 'No existe' }, 404);
  const { vista, bloqueos } = await bloqueosDeFila(env, r);
  if (bloqueos.length) return json({ error: `No se puede publicar: ${bloqueos.join('; ')}`, bloqueos }, 409);
  const hoy = hoyLima();
  const datos = parse(r.borrador_json, {});
  if (!datos.validUntil) return json({ error: 'Falta la fecha de vencimiento de la propuesta' }, 409);
  const primera = !r.publicada_en;
  let version = r.version;
  const changelog = parse(r.changelog, datos.changelog || []);
  if (r.estado === 'publicada') {
    const texto = String(body.changelog || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!texto) return json({ error: 'Contá qué cambió (lo ve el cliente en la propuesta)' }, 400);
    version = r.version + 1;
    changelog.push({ version, fecha: hoy, texto });
    datos.updatedAt = hoy;
  } else if (primera) {
    version = 1;
    if (!changelog.length) changelog.push({ version: 1, fecha: hoy, texto: 'Propuesta enviada.' });
    datos.updatedAt = hoy;
  }
  datos.version = version; datos.changelog = changelog; datos.status = 'enviada'; datos.slug = r.slug;
  const publicado = JSON.stringify(datos);
  const ahora = new Date().toISOString();
  const link = `${PROPUESTAS_URL(env)}/${r.slug}/`;
  const p = vista.pedido;
  const sentencias = [
    env.DB.prepare(`UPDATE ct_propuestas SET estado = 'publicada', version = ?, datos_json = ?, borrador_json = ?, valid_until = ?, changelog = ?, publicada_por = ?, publicada_en = COALESCE(publicada_en, ?), actualizada_en = ? WHERE id = ?`)
      .bind(version, publicado, publicado, datos.validUntil, JSON.stringify(changelog), por, ahora, ahora, id),
    // el tracking reconoce el slug sin tener que pedir la página publicada
    env.DB.prepare(`INSERT INTO propuestas (slug, numero, cliente, valid_until) VALUES (?, ?, ?, ?) ON CONFLICT (slug) DO UPDATE SET numero = excluded.numero, cliente = excluded.cliente, valid_until = excluded.valid_until`)
      .bind(r.slug, datos.numero, datos.cliente, datos.validUntil),
  ];
  let etapa = null;
  const leadId = p.lead_id || r.lead_id;
  if (leadId) {
    const lead = await env.DB.prepare('SELECT id, etapa, precio FROM leads WHERE id = ?').bind(leadId).first();
    if (lead) {
      etapa = lead.etapa;
      if (ANTES_DE_ENVIADA.includes(lead.etapa)) {
        etapa = 'propuesta_enviada';
        sentencias.push(env.DB.prepare('UPDATE leads SET etapa = ?, actualizado_en = ? WHERE id = ?').bind(etapa, ahora, leadId));
        sentencias.push(env.DB.prepare('INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, ?, ?, ?, ?)').bind(leadId, lead.etapa, etapa, por, ahora));
      }
      sentencias.push(env.DB.prepare('UPDATE leads SET propuesta_url = ?, actualizado_en = ? WHERE id = ?').bind(link, ahora, leadId));
      if (!lead.precio) sentencias.push(env.DB.prepare('UPDATE leads SET precio = ?, actualizado_en = ? WHERE id = ?').bind(`USD ${new Intl.NumberFormat('en-US').format(Math.round(datos.precio.totalPP * datos.viaje.pasajeros))}`, ahora, leadId));
    }
  }
  // Seguimientos post propuesta (migración 055): arrancan al publicar la primera vez. Las versiones nuevas no los reinician.
  let seguimiento = false;
  if (primera && p.conversacion_id) {
    const conv = await env.DB.prepare('SELECT id, lead_id FROM wa_conversaciones WHERE id = ?').bind(p.conversacion_id).first();
    if (conv) {
      sentencias.push(env.DB.prepare('DELETE FROM propuesta_toques WHERE slug = ?').bind(r.slug));
      sentencias.push(env.DB.prepare(`INSERT INTO propuesta_seguimientos (slug, conversacion_id, lead_id, dia0, estado, estado_motivo) VALUES (?, ?, ?, ?, 'activa', ?)
        ON CONFLICT (slug) DO UPDATE SET conversacion_id = excluded.conversacion_id, lead_id = excluded.lead_id, dia0 = excluded.dia0, estado = 'activa', estado_motivo = excluded.estado_motivo,
          reviso_disponibilidad = 0, retomado_desde = NULL, retomado_en = NULL, creado_en = datetime('now'), actualizado_en = datetime('now')`).bind(r.slug, conv.id, conv.lead_id ?? leadId ?? null, hoy, `enviada por ${por}`));
      // el follow-up automático del setter saltea este chat mientras dure la secuencia
      sentencias.push(env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)').bind(conv.id, conv.lead_id ?? leadId ?? null, 'seguimiento_omitido', 'seguimiento de propuesta activo', ahora));
      seguimiento = true;
    }
  }
  try { await env.DB.batch(sentencias); } catch (e) {
    // CRM sin setter (sin setter_eventos): publicar igual, sin frenar el follow-up de IA
    if (!/setter_eventos/.test(String(e.message))) throw e;
    await env.DB.batch(sentencias.filter((s, i) => i < sentencias.length - (seguimiento ? 1 : 0)));
  }
  await cambiarEstado(env, r.pedido_id, 'enviada', por, `Propuesta publicada (versión ${version})`);
  return json({ ok: true, link, version, etapa, seguimiento });
}

export async function retirarPropuesta(env, id, por) {
  const r = await env.DB.prepare(`SELECT estado FROM ct_propuestas WHERE id = ?`).bind(id).first();
  if (!r) return json({ error: 'No existe' }, 404);
  await env.DB.prepare(`UPDATE ct_propuestas SET estado = 'retirada', actualizada_en = ?, publicada_por = COALESCE(publicada_por, ?) WHERE id = ?`).bind(new Date().toISOString(), por, id).run();
  return json({ ok: true });
}

// ---------- página pública (sin login) ----------
const CABECERAS = {
  'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
};
const noDisponible = (status = 404) => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Propuesta no disponible · Luna Llena Travel</title></head>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#161616;line-height:1.5">
<h1 style="font-size:22px">Esta propuesta no está disponible</h1>
<p>Escríbenos por WhatsApp y te la enviamos de nuevo.</p>
<p><a href="https://wa.me/51982360927" style="color:#FF7A00;font-weight:600">WhatsApp +51 982 360 927</a></p></body></html>`, { status, headers: { ...CABECERAS, 'cache-control': 'no-store' } });

// origen = dónde vive este CRM (ll.css y ll.js se piden ahí): en producción llega por el rewrite de Vercel, así que es el dominio del CRM.
export async function servirPropuesta(env, slug, { reservar = false, origen } = {}) {
  if (!SLUG_OK.test(slug) || slug.startsWith('_')) return noDisponible();
  const r = await env.DB.prepare(`SELECT estado, datos_json FROM ct_propuestas WHERE slug = ?`).bind(slug).first();
  if (!r || r.estado !== 'publicada' || !r.datos_json) return noDisponible();
  // La reserva online está apagada: /<slug>/reservar/ lleva a "Cómo reservar".
  if (reservar) return new Response(null, { status: 302, headers: { location: `/${slug}/#reserva`, 'cache-control': 'no-store' } });
  return new Response(renderPagina(parse(r.datos_json, {}), { slug, cfg: await configPlantilla(env), crm: origen }), { headers: CABECERAS });
}

// Manda el link de la propuesta publicada al chat del cliente por WhatsApp (la API de Kapso, el número de Luna Llena).
// Con la ventana de 24 h abierta va como mensaje normal (texto editable); cerrada, va la plantilla aprobada
// propuesta_viaje_lista ("Hola {nombre}! Ya está lista la propuesta… {link}"), que es lo único que WhatsApp deja.
export const PLANTILLA_PROPUESTA = 'propuesta_viaje_lista';
export async function enviarPropuesta(env, id, body, por) {
  if (!setterActivo(env)) return json({ error: 'El WhatsApp del CRM no está activo' }, 409);
  const r = await env.DB.prepare(`SELECT * FROM ct_propuestas WHERE id = ?`).bind(id).first();
  if (!r) return json({ error: 'No existe' }, 404);
  if (r.estado !== 'publicada') return json({ error: 'Primero publícala: sin publicar no hay link para el cliente' }, 409);
  const link = `${PROPUESTAS_URL(env)}/${r.slug}/`;
  const ped = await env.DB.prepare(`SELECT id, nombre, lead_id, conversacion_id FROM ct_pedidos WHERE id = ?`).bind(r.pedido_id).first();
  let conv = ped && ped.conversacion_id ? await env.DB.prepare(`SELECT * FROM wa_conversaciones WHERE id = ?`).bind(ped.conversacion_id).first() : null;
  const leadId = (ped && ped.lead_id) || r.lead_id;
  if (!conv && leadId) conv = await env.DB.prepare(`SELECT * FROM wa_conversaciones WHERE lead_id = ? ORDER BY ultimo_en DESC LIMIT 1`).bind(leadId).first();
  if (!conv) return json({ error: 'Este pedido no tiene chat de WhatsApp: ábrelo en el Inbox (o agrégalo como contacto) y vuelve a probar', sin_chat: true }, 409);
  const lead = conv.lead_id ? await env.DB.prepare(`SELECT nombre FROM leads WHERE id = ?`).bind(conv.lead_id).first() : null;
  const nombre = String(body.nombre || (lead && lead.nombre) || conv.alias || conv.nombre_perfil || '').trim().split(/\s+/)[0].replace(/^\+?\d+$/, '') || 'hola';
  const ahora = new Date().toISOString();
  const ventana = !!(conv.ventana_hasta && conv.ventana_hasta > ahora);
  let texto = typeof body.texto === 'string' ? body.texto.trim().slice(0, 4000) : '';
  if (texto && !texto.includes(link)) texto += `\n\n${link}`;
  const pedido = ventana
    ? { conversacion_id: conv.id, texto: texto || `Hola ${nombre}! Ya está lista la propuesta de tu viaje 🌕\n\n${link}\n\nCualquier duda o cambio, me escribes por aquí.`, autor: 'asesora_web' }
    : { conversacion_id: conv.id, plantilla: { nombre: PLANTILLA_PROPUESTA, idioma: 'es', params: [nombre, link] }, autor: 'asesora_web' };
  const w = await alWorker(env, 'interno/enviar', { method: 'POST', body: JSON.stringify(pedido) });
  const d = await w.json().catch(() => ({ error: 'el WhatsApp no respondió bien' }));
  if (!w.ok) {
    const e = String(d.error || 'no se pudo enviar');
    const msg = /13200[01]|template|plantilla/i.test(e) && !ventana
      ? `La plantilla ${PLANTILLA_PROPUESTA} todavía no está aprobada por Meta (o la rechazó): copia el link y mándalo desde el Inbox cuando el cliente escriba. Detalle: ${e}`
      : e;
    return json({ error: msg }, w.status >= 500 ? 502 : w.status);
  }
  // Escribir a mano pausa la IA en ese chat (igual que responder desde el Inbox).
  if (conv.ia_activa) await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'asesora_respondio' WHERE id = ?`).bind(conv.id).run();
  await env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
    .bind(conv.id, conv.lead_id, 'propuesta_enviada', `${link} · ${ventana ? 'mensaje' : 'plantilla'} · ${por}`, ahora).run().catch(() => {});
  return json({ ok: true, modo: ventana ? 'mensaje' : 'plantilla', conversacion_id: conv.id, link });
}
