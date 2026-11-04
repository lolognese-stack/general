import { checkToken, json } from '../../_lib/auth.js';

// Cotizador de Luna Llena (repo luna-llena-cotizador, en Vercel) usado a mano desde el panel.
//
// El navegador nunca ve COTIZADOR_TOKEN: habla con esta Function (token del CRM) y esta
// Function habla con el cotizador. Sin COTIZADOR_TOKEN la pestaña no aparece (solo Luna Llena
// tiene el secret; nuevo-cliente.py no lo copia).
//
//   GET  /api/cotizador/estado    -> { activo }
//   GET  /api/cotizador/catalogo  -> productos del catálogo de la web (para el buscador)
//   POST /api/cotizador/cotizar   -> { pedido, nombre?, idioma?, dias_disponibles? } -> /v1/cotizar
//   POST /api/cotizador/turno     -> { mensaje, estado? } -> /v1/turno (pegar chat)
//   POST /api/cotizador/guardar   -> { lead_id, enviada?, quien?, pedido, nombre?, idioma?, ... } (recotiza y guarda)
//   GET  /api/cotizador/lead/<id> -> cotizaciones guardadas de ese lead (tabla cotizador_cotizaciones, migración 048)
//
// Los precios los calcula el cotizador por código; esta Function no toca importes.

const URL_COTIZADOR = 'https://luna-llena-cotizador.vercel.app';
const URL_CATALOGO = 'https://lunallenatravel.vercel.app/data/catalogo.json';
const URL_PROPUESTA = 'https://lunallenatravel.vercel.app/p/';   // la web reescribe /p/* a functions/p/[slug].js
const MAX_CUERPO = 32 * 1024;

const activo = env => !!env.COTIZADOR_TOKEN;

function hoyLima() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });   // YYYY-MM-DD
}

async function catalogo(env) {
  const url = env.LL_CATALOGO || URL_CATALOGO;
  const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error('No se pudo leer el catálogo de la web (HTTP ' + r.status + ')');
  const c = await r.json();
  return (c.productos || []).map(p => ({
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    zona: p.zona || null,
    duracion: (p.duracion && p.duracion.texto) || null,
    dificultad: p.dificultad || null,
    edad_minima: p.edad_minima ?? null,
    consultar: !!p.consultar,
    unidad: p.unidad || 'persona',
    tarifas: (p.tarifas || []).map(t => ({ nombre: t.nombre, usd: t.usd ?? null, publico: t.publico ?? null })),
  }));
}

async function leerCuerpo(request) {
  const crudo = await request.text();
  if (crudo.length > MAX_CUERPO) return { error: json({ error: 'Pedido demasiado grande' }, 413) };
  try { return { b: JSON.parse(crudo || '{}') }; } catch { return { error: json({ error: 'JSON inválido' }, 400) }; }
}

async function cotizar(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const c = cuerpoCotizar(b);
  if (c.error) return json({ error: c.error }, 400);
  return llamar(env, '/v1/cotizar', c);
}

// Lo que se manda a /v1/cotizar: solo los campos que entiende el motor.
function cuerpoCotizar(b) {
  const p = b.pedido;
  if (!p || !Array.isArray(p.items) || !p.items.length) return { error: 'Elegí al menos un producto' };
  if (!Array.isArray(p.viajeros) || !p.viajeros.length) return { error: 'Cargá al menos un viajero' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_viaje || '')) return { error: 'Falta la fecha del viaje' };

  // Solo los campos que entiende el motor: nada de pasaportes ni fechas de nacimiento.
  const pedido = {
    fecha_hoy: hoyLima(),
    fecha_viaje: p.fecha_viaje,
    viajeros: p.viajeros.slice(0, 40).map(v => {
      const o = { nacionalidad: String(v.nacionalidad || '').slice(0, 60) };
      if (v.adulto) o.adulto = true; else o.edad = Number(v.edad);
      if (v.estudiante) o.estudiante = true;
      return o;
    }),
    items: p.items.slice(0, 30).map(i => {
      const o = { id: String(i.id || '') };
      if (i.tarifa) o.tarifa = String(i.tarifa);
      if (i.cantidad) o.cantidad = Number(i.cantidad);
      return o;
    }),
  };
  if (p.llegada && /^\d{2}:\d{2}$/.test(p.llegada.hora || '')) pedido.llegada = { dia: 1, hora: p.llegada.hora };

  return {
    pedido,
    ordenar: true,
    nombre: b.nombre ? String(b.nombre).slice(0, 80) : null,
    idioma: ['es', 'en', 'pt'].includes(b.idioma) ? b.idioma : 'es',
    dias_disponibles: Number(b.dias_disponibles) > 0 ? Number(b.dias_disponibles) : null,
  };
}

// Guardar en lead: el servidor vuelve a cotizar el pedido (los importes nunca vienen del navegador),
// guarda el resultado y, si el asesor marcó que ya se la mandó, pasa el lead a "Propuesta enviada"
// (solo si estaba antes en el embudo: nunca lo hace retroceder).
const ANTES_DE_ENVIADA = ['lead_nuevo', 'contactado', 'propuesta_pendiente'];

async function guardar(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const leadId = Number(b.lead_id);
  if (!Number.isInteger(leadId) || leadId <= 0) return json({ error: 'Elegí el lead' }, 400);
  const lead = await env.DB.prepare('SELECT id, etapa, precio FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return json({ error: 'Ese lead no existe' }, 404);
  const c = cuerpoCotizar(b);
  if (c.error) return json({ error: c.error }, 400);

  // Página de propuesta: slug al azar; el link va dentro del mensaje (lo pone el cotizador).
  let slug = null, link = null;
  if (b.pagina) {
    const bytes = crypto.getRandomValues(new Uint8Array(14));
    slug = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    link = URL_PROPUESTA + slug + '/';
    Object.assign(c, { pagina: true, link });
  }

  const { status, data } = await pedir(env, '/v1/cotizar', c);
  if (status !== 200) return json({ error: (data && data.error) || 'El cotizador no respondió' }, 502);
  const cot = data.cotizacion || {};
  const conTotal = ['calculado', 'sin_disponibilidad_confirmada'].includes(cot.estado) && cot.total_usd;
  const html = slug && conTotal && data.propuesta_html ? String(data.propuesta_html) : null;
  if (slug && !html) { slug = null; link = null; }   // sin total no hay página para el cliente
  const enviada = b.enviada ? 1 : 0;
  const now = new Date().toISOString();
  const quien = b.quien ? String(b.quien).slice(0, 60) : null;
  const nombres = Array.isArray(b.nombres) ? b.nombres : [];
  const resumen = (data.pedido && data.pedido.items || []).map(i => {
    const n = nombres.find(x => x && x.id === i.id);
    return n ? String(n.nombre).slice(0, 80) : i.id;
  }).join(' + ').slice(0, 400);
  const v = cot.versiones || {};

  const sentencias = [env.DB.prepare(
    `INSERT INTO cotizador_cotizaciones (lead_id, estado, total_usd, adelanto_usd, viajeros, fecha_viaje, resumen, idioma, mensaje,
       pedido_json, versiones, enviada, quien, creado_en, slug, propuesta_html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(leadId, cot.estado || 'desconocido', conTotal ? String(cot.total_usd) : null, conTotal ? String(cot.adelanto_usd) : null,
    c.pedido.viajeros.length, c.pedido.fecha_viaje, resumen, c.idioma, (data.borrador && data.borrador.texto) || null,
    JSON.stringify(data.pedido || c.pedido), [v.catalogo, v.entradas, v.reglas, v.tc].filter(Boolean).join(' · '), enviada, quien, now,
    slug, html)];

  let etapa = lead.etapa;
  if (enviada && ANTES_DE_ENVIADA.includes(lead.etapa)) {
    etapa = 'propuesta_enviada';
    sentencias.push(env.DB.prepare('UPDATE leads SET etapa = ?, actualizado_en = ? WHERE id = ?').bind(etapa, now, leadId));
    sentencias.push(env.DB.prepare('INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en) VALUES (?, ?, ?, ?, ?)')
      .bind(leadId, lead.etapa, etapa, quien, now));
  }
  // El precio del lead (el que se ve en la tarjeta) solo se completa si estaba vacío.
  if (enviada && conTotal && !lead.precio) {
    sentencias.push(env.DB.prepare('UPDATE leads SET precio = ?, actualizado_en = ? WHERE id = ?').bind('USD ' + cot.total_usd, now, leadId));
  }
  // Con página, el link del lead (propuesta_url) apunta a la última propuesta.
  if (link) sentencias.push(env.DB.prepare('UPDATE leads SET propuesta_url = ?, actualizado_en = ? WHERE id = ?').bind(link, now, leadId));
  await env.DB.batch(sentencias);
  return json({ ok: true, etapa, cambio_etapa: etapa !== lead.etapa, estado: cot.estado, total_usd: conTotal ? cot.total_usd : null,
    link, mensaje: (data.borrador && data.borrador.texto) || null, pagina_pedida: !!b.pagina });
}

async function deLead(env, id) {
  const leadId = Number(id);
  if (!Number.isInteger(leadId) || leadId <= 0) return json({ error: 'lead inválido' }, 400);
  const r = await env.DB.prepare(
    `SELECT id, estado, total_usd, adelanto_usd, viajeros, fecha_viaje, resumen, idioma, mensaje, pedido_json, versiones, enviada, quien, creado_en, slug
     FROM cotizador_cotizaciones WHERE lead_id = ? ORDER BY creado_en DESC LIMIT 30`
  ).bind(leadId).all();
  return json({ cotizaciones: r.results || [] });
}

// Pegar chat: el mensaje del cliente lo interpreta el asesor del cotizador (Claude Haiku en Vercel).
// Sin estado: el panel guarda `estado` y lo reenvía con el próximo mensaje del mismo cliente.
async function turno(request, env) {
  const { b, error } = await leerCuerpo(request);
  if (error) return error;
  const mensaje = typeof b.mensaje === 'string' ? b.mensaje.trim() : '';
  if (!mensaje) return json({ error: 'Pegá el mensaje del cliente' }, 400);
  if (mensaje.length > 4000) return json({ error: 'El mensaje es muy largo (máximo 4000 caracteres): pegá solo lo del viaje' }, 413);
  const estado = b.estado && typeof b.estado === 'object' ? b.estado : null;
  return llamar(env, '/v1/turno', { mensaje, estado, hoy: hoyLima() });
}

// Llama al cotizador. Devuelve { status, data } con status ya traducido para el panel.
async function pedir(env, ruta, cuerpo) {
  let r;
  try {
    r = await fetch((env.COTIZADOR_URL || URL_COTIZADOR) + ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.COTIZADOR_TOKEN },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    return { status: 502, data: { error: 'El cotizador no respondió. Probá de nuevo en un rato.' } };
  }
  const texto = await r.text();
  let data;
  try { data = JSON.parse(texto); } catch { return { status: 502, data: { error: 'Respuesta inválida del cotizador (HTTP ' + r.status + ')' } }; }
  if (r.status === 401 || r.status === 503) return { status: 502, data: { error: 'El CRM no tiene bien configurado el token del cotizador.' } };
  if (!r.ok) return { status: r.status === 400 || r.status === 413 ? r.status : 502, data: { error: data.error || 'HTTP ' + r.status } };
  return { status: 200, data };
}

async function llamar(env, ruta, cuerpo) {
  const { status, data } = await pedir(env, ruta, cuerpo);
  return json(data, status);
}

export async function onRequest({ request, env, params }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const ruta = (params.ruta || []).join('/');
  const metodo = request.method;

  if (ruta === 'estado' && metodo === 'GET') return json({ activo: activo(env) });
  if (!activo(env)) return json({ error: 'Cotizador no disponible en este CRM' }, 404);

  if (ruta === 'catalogo' && metodo === 'GET') {
    try { return json({ productos: await catalogo(env) }); }
    catch (e) { return json({ error: e.message }, 502); }
  }
  if (ruta === 'cotizar' && metodo === 'POST') return cotizar(request, env);
  if (ruta === 'turno' && metodo === 'POST') return turno(request, env);
  if (ruta === 'guardar' && metodo === 'POST') return guardar(request, env);
  const mLead = ruta.match(/^lead\/(\d+)$/);
  if (mLead && metodo === 'GET') return deLead(env, mLead[1]);
  return json({ error: 'no existe' }, 404);
}
