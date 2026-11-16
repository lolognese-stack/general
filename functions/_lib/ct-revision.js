// Link de revisión de una cotización (para Álvaro, desde el celular, sin contraseña).
// El link es /r/#<token>: el token va después del # para que no viaje en la URL al servidor ni quede en logs ni en el Referer.
// En la base solo queda el SHA-256 del token. Vence a los 30 días; generar uno nuevo invalida el anterior.
import { json } from './auth.js';
import { vistaCotizacion, cambiarEstado, esVigente, hermana } from './ct-cotizaciones.js';

// Link al pedido dentro del CRM (Álvaro entra con su acceso de cotizador).
export const linkPedido = (origen, pedidoId) => `${origen || ''}/panel-4c1f6a#/cotizaciones/pedido/${pedidoId}`;
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

// Mensaje listo para pegarle a Álvaro por WhatsApp al pasarle un pedido.
export function mensajePase({ pedido, revisor, nota, urgente, link, pendientes }) {
  const destinos = (Array.isArray(pedido.destinos) ? pedido.destinos : []).map((d) => d.ciudad).filter(Boolean).join(', ');
  const fechas = pedido.fecha_inicio ? `${fechaCorta(pedido.fecha_inicio)}${pedido.fecha_fin ? ' al ' + fechaCorta(pedido.fecha_fin) : ''}${pedido.fecha_tentativa ? ' (tentativa)' : ''}` : 'sin fecha';
  const L = [`${urgente ? '🔴 URGENTE · ' : ''}Hola ${revisor}, te pasé una cotización para revisar:`, `*${pedido.nombre}* · ${pedido.pasajeros} pax · ${fechas}${destinos ? ' · ' + destinos : ''}`];
  if (pendientes) L.push(`Te faltan ${pendientes} cosa${pendientes > 1 ? 's' : ''} por resolver (están arriba de todo, en "Te falta").`);
  if (nota) L.push('', `Nota: ${nota}`);
  L.push('', link);
  return L.join('\n');
}
import { webhookDiscord, mandarDiscord } from './propuestas.js';

const DIAS_VALIDEZ = 30;
export const TOKEN_OK = /^[A-Za-z0-9_-]{43}$/;
const ahora = "datetime('now')";

export async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenNuevo() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Desde el CRM: deja la cotización en revisión. Genera link si no hay uno vigente o si se pide uno nuevo.
export async function mandarARevision(env, cotId, body, por, { origen = '' } = {}) {
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE id = ?`).bind(cotId).first();
  if (!cot) return json({ error: 'No existe' }, 404);
  if (!['borrador', 'cambios_pedidos', 'en_revision'].includes(cot.estado)) return json({ error: 'Esta versión ya no se puede mandar a revisión' }, 409);
  if (!(await esVigente(env, cot))) return json({ error: 'Hay una versión más nueva' }, 409);
  const otra = await hermana(env, cot);
  if (otra) return json({ error: `Hay dos borradores (A y B): elegí uno antes de mandar a revisión` }, 409);
  const vista = await vistaCotizacion(env, cotId);
  if (!vista.lineas.length) return json({ error: 'La cotización no tiene líneas' }, 400);
  const revisor = String(body.revisor || 'Álvaro').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || 'Álvaro';
  // El link /r/ está retirado: Álvaro entra al CRM con su rol. Siempre sin link.
  body = { ...body, sin_link: true };
  const nota = String(body.nota || '').trim().slice(0, 1000) || null;
  const urgente = body.urgente ? 1 : 0;
  const vigente = cot.token_hash && cot.token_vence && cot.token_vence > new Date().toISOString().replace('T', ' ').slice(0, 19);
  let token = null;
  const stmts = [];
  // Desde que Álvaro entra al CRM con su rol, ya no se genera link (/r/ está retirado): sin_link lo omite.
  if (!body.sin_link && (body.nuevo_link || !vigente)) {
    token = tokenNuevo();
    const vence = new Date(Date.now() + DIAS_VALIDEZ * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
    stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET token_hash = ?, token_vence = ?, revisor = ? WHERE id = ?`).bind(await sha256(token), vence, revisor, cotId));
  }
  if (body.sin_link) stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET revisor = ? WHERE id = ?`).bind(revisor, cotId));
  stmts.push(env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'en_revision', actualizado_en = ${ahora} WHERE id = ?`).bind(cotId));
  stmts.push(env.DB.prepare(`UPDATE ct_pedidos SET nota_pase = ?, urgente = ?, pasado_en = ${ahora} WHERE id = ?`).bind(nota, urgente, cot.pedido_id));
  await env.DB.batch(stmts);
  await cambiarEstado(env, cot.pedido_id, 'en_revision', por, `Versión ${cot.version} pasada a ${revisor}${urgente ? ' (urgente)' : ''}${nota ? ': ' + nota.slice(0, 200) : ''}`);
  const link = linkPedido(origen, cot.pedido_id);
  const mensaje = mensajePase({ pedido: vista.pedido, revisor, nota, urgente, link, pendientes: vista.pendientes.total });
  return json({ ok: true, token, link_nuevo: !!token, revisor, usa_prueba: vista.cotizacion.usa_prueba, link, mensaje });
}

// Desde el link: la cotización del token (o un error HTTP listo para devolver).
export async function cotizacionDeToken(env, token) {
  if (!TOKEN_OK.test(token || '')) return { err: json({ error: 'Link no válido' }, 404) };
  const cot = await env.DB.prepare(`SELECT * FROM ct_cotizaciones WHERE token_hash = ?`).bind(await sha256(token)).first();
  if (!cot) return { err: json({ error: 'Este link no existe o fue reemplazado por uno nuevo' }, 404) };
  if (!cot.token_vence || cot.token_vence < new Date().toISOString().replace('T', ' ').slice(0, 19)) return { err: json({ error: 'Este link venció: pedí uno nuevo' }, 410) };
  return { cot };
}

async function avisar(env, tipo, texto) {
  try {
    await env.DB.prepare('INSERT INTO propuesta_alertas (slug, tipo, texto, dispositivo) VALUES (?, ?, ?, ?)').bind('-', tipo, texto, null).run();
    const url = await webhookDiscord(env);
    if (url) await mandarDiscord(url, texto);
  } catch { /* el cambio de estado ya quedó: el aviso es un extra */ }
}

// rol: 'cotizador' (Álvaro) o el equipo. Una versión nueva en borrador la aprueba el equipo solo si es un "cambio chico".
export async function aprobar(env, cot, body, { rol = null, origen = '' } = {}) {
  const chica = cot.estado === 'borrador' && rol !== 'cotizador';
  if (!['en_revision', 'cambios_pedidos'].includes(cot.estado) && !chica) return json({ error: cot.estado === 'aprobada' ? 'Ya está aprobada' : 'Esta versión ya no se puede aprobar' }, 409);
  const vista = await vistaCotizacion(env, cot.id);
  if (chica) {
    const cc = vista.cambio_chico || {};
    if (!cc.hay_aprobada) return json({ error: 'Pasala a Álvaro: la primera versión la aprueba él' }, 409);
    if (!cc.ok) return json({ error: `Tiene precios sin confirmar en el tarifario: pasala a Álvaro (${(cc.motivos || []).slice(0, 3).join('; ')})`, motivos: cc.motivos }, 409);
  }
  if (vista.totales.problemas) return json({ error: `Hay ${vista.totales.problemas} líneas sin precio: completalas antes de aprobar` }, 409);
  // Lo que armó el sistema sin una tarifa propia no se aprueba hasta que alguien lo confirme o lo corrija.
  const pe = vista.pendientes || { total: 0 };
  if (pe.total) {
    const partes = [pe.ilustrativas && `${pe.ilustrativas} línea${pe.ilustrativas > 1 ? 's' : ''} ilustrativa${pe.ilustrativas > 1 ? 's' : ''} (destino que la web no tiene)`, pe.sin_confirmar && `${pe.sin_confirmar} precio${pe.sin_confirmar > 1 ? 's' : ''} de la web sin confirmar`, pe.paquete_web && 'el precio del paquete web sin confirmar'].filter(Boolean);
    return json({ error: `No se puede aprobar: ${partes.join(', ')}. Corregilas o confirmalas en cada línea.`, pendientes: pe }, 409);
  }
  const por = cot.revisor || 'Revisión';
  const nota = String(body.nota || '').trim().slice(0, 1000) || null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'aprobada', aprobada_por = ?, aprobada_en = ${ahora}, actualizado_en = ${ahora},
      notas_alvaro = CASE WHEN ? IS NULL THEN notas_alvaro WHEN COALESCE(TRIM(notas_alvaro), '') = '' THEN ? ELSE notas_alvaro || char(10) || ? END WHERE id = ?`).bind(por, nota, nota, nota, cot.id),
  ]);
  await cambiarEstado(env, cot.pedido_id, 'aprobada', por, `Versión ${cot.version} aprobada`);
  const t = vista.totales;
  const final = await env.DB.prepare(`SELECT notas_alvaro FROM ct_cotizaciones WHERE id = ?`).bind(cot.id).first();
  const notas = String(final?.notas_alvaro || '').trim();
  await avisar(env, 'cotizacion_aprobada', [
    `✅ ${por} aprobó la cotización de ${vista.pedido.nombre} (v${cot.version}${chica ? ', cambio chico' : ''}): US$ ${(t.venta_cent / 100).toFixed(2)}${vista.cotizacion.usa_prueba ? ' · PRECIOS DE PRUEBA, no se puede mandar' : ''}`,
    notas ? `Notas: ${notas.slice(0, 600)}` : null,
    `Lista para propuesta: ${linkPedido(origen, cot.pedido_id)}`,
  ].filter(Boolean).join('\n'));
  return json({ ok: true, ...(await vistaCotizacion(env, cot.id)) });
}

export async function pedirCambios(env, cot, body) {
  if (!['en_revision', 'cambios_pedidos'].includes(cot.estado)) return json({ error: 'Esta versión ya no admite cambios' }, 409);
  const texto = String(body.texto || '').trim().slice(0, 2000);
  if (!texto) return json({ error: 'Escribí qué hay que cambiar' }, 400);
  const por = cot.revisor || 'Revisión';
  const p = await env.DB.prepare(`SELECT nombre FROM ct_pedidos WHERE id = ?`).bind(cot.pedido_id).first();
  await env.DB.prepare(`UPDATE ct_cotizaciones SET estado = 'cambios_pedidos', pedido_cambios = ?, actualizado_en = ${ahora} WHERE id = ?`).bind(texto, cot.id).run();
  await cambiarEstado(env, cot.pedido_id, 'borrador_listo', por, `Pidió cambios: ${texto.slice(0, 250)}`);
  await avisar(env, 'cotizacion_cambios', `${por} pidió cambios en la cotización de ${p?.nombre || '?'} (v${cot.version}): ${texto.slice(0, 300)}`);
  return json({ ok: true, ...(await vistaCotizacion(env, cot.id)) });
}
