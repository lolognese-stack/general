import { checkToken, rolDe, json } from '../_lib/auth.js';
import { setterActivo, alWorker, evento } from '../_lib/setter.js';
import { propuestaVerificada, datosPublicados, SLUG } from '../_lib/propuestas.js';
import { secuencia, proximoToque, textoDe, retomarDesde, caliente, hoyLima } from '../_lib/seguimientos.js';

// Seguimientos post propuesta (migración 055). Los usa el Inbox: botón "Seguimientos hoy" y tarjeta en el chat.
//
//   GET  /api/seguimientos                     los que tienen toque hoy o atrasado, y los calientes
//   GET  /api/seguimientos?conversacion_id=N   el seguimiento de ese chat (aunque hoy no le toque nada)
//   GET  /api/seguimientos?propuestas=1        propuestas que se pueden unir a un chat
//   POST /api/seguimientos  { accion, slug, ... }
//        enviada      { slug, conversacion_id }    Día 0: arranca la secuencia
//        enviar       { slug, dia, texto }         manda desde el Inbox (solo con la ventana de 24 h abierta)
//        hecho        { slug, dia }                lo mandó desde el teléfono
//        saltear      { slug, dia }
//        pausar | perdida | respondio  { slug }
//        retomar      { slug }                     vuelve a arrancar desde el toque de 30, 60 o 90 días
//        disponibilidad { slug, valor }            día 12: con true va el mensaje A
//   Todas aceptan { por } (quién lo hizo); si no viene, se guarda el rol.
//
// Freno automático, calculado al pedir la lista (sin tocar el Worker):
//   - el cliente escribió después del último toque (o del Día 0)       -> respondio
//   - escribió "quiero reservar la propuesta N° <numero>"               -> terminada
//   - la propuesta publicada pasó a confirmada (se revisa cada 6 h)     -> terminada

const ESTADOS = ['activa', 'pausada', 'respondio', 'perdida', 'terminada'];
const SEIS_HORAS = 6 * 3600e3;
const isoDe = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : 0);
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

async function secuenciaDe(env) {
  const f = await env.DB.prepare(`SELECT valor FROM propuestas_config WHERE clave = 'seguimientos_secuencia'`).first();
  return secuencia(f?.valor);
}

function porDe(body, request, env) {
  const p = typeof body?.por === 'string' ? body.por.trim().slice(0, 40) : '';
  return p || rolDe(request, env) || 'crm';
}

async function cambiarEstado(env, slug, estado, motivo) {
  await env.DB.prepare(`UPDATE propuesta_seguimientos SET estado = ?, estado_motivo = ?, actualizado_en = datetime('now') WHERE slug = ?`)
    .bind(estado, motivo ?? null, slug).run();
}

// Freno automático. Devuelve el estado nuevo si cambió.
async function frenar(env, s, ultimoToque) {
  // Desde cuándo cuenta una respuesta: el último toque hecho, o el Día 0 / el retomar.
  // retomado_en guarda el momento exacto (ISO) en que se apretó Retomar.
  const ref = Math.max(isoDe(s.creado_en), isoDe(ultimoToque), isoDe(s.retomado_en));
  if (s.conversacion_id && isoDe(s.ultimo_in_en) > ref) {
    if (s.numero) {
      const pidio = await env.DB.prepare(
        `SELECT 1 FROM wa_mensajes WHERE conversacion_id = ? AND direccion = 'in' AND creado_en >= ? AND lower(texto) LIKE ? LIMIT 1`
      ).bind(s.conversacion_id, new Date(ref).toISOString(), `%quiero reservar la propuesta n° ${String(s.numero).toLowerCase()}%`).first();
      if (pidio) return cambio(env, s, 'terminada', 'pidió reservar');
    }
    return cambio(env, s, 'respondio', `respondió el ${ddmm(hoyLima(new Date(isoDe(s.ultimo_in_en))))}`);
  }
  // Confirmada en la página publicada: se mira como mucho cada 6 h por propuesta.
  const chequeo = await env.DB.prepare(`SELECT ultimo_en FROM propuesta_avisos WHERE slug = ? AND tipo = 'chequeo_estado'`).bind(s.slug).first();
  if (!chequeo || Date.now() - isoDe(chequeo.ultimo_en) > SEIS_HORAS) {
    await env.DB.prepare(`INSERT INTO propuesta_avisos (slug, tipo, ultimo_en) VALUES (?, 'chequeo_estado', ?)
      ON CONFLICT (slug, tipo) DO UPDATE SET ultimo_en = excluded.ultimo_en`).bind(s.slug, new Date().toISOString()).run();
    const d = await datosPublicados(env, s.slug);
    if (d && d.status === 'confirmada') return cambio(env, s, 'terminada', 'viaje confirmado');
  }
  return null;
}
async function cambio(env, s, estado, motivo) {
  await cambiarEstado(env, s.slug, estado, motivo);
  s.estado = estado; s.estado_motivo = motivo;
  return estado;
}

// Arma una fila para el Inbox.
async function fila(env, s, sec, hoy, { frenoAuto = true } = {}) {
  const { results: toques } = await env.DB.prepare('SELECT dia, accion, fecha, creado_en FROM propuesta_toques WHERE slug = ? ORDER BY creado_en').bind(s.slug).all();
  const ultimo = toques.length ? toques[toques.length - 1].creado_en : null;
  if (frenoAuto && s.estado === 'activa') await frenar(env, s, ultimo);
  // Lecturas acotadas (cupo diario de D1): eventos de las últimas 48 h para "caliente", y aperturas contadas aparte.
  const { results: ev } = await env.DB.prepare(
    `SELECT evento, detalle, creado_en FROM propuesta_eventos WHERE slug = ? AND creado_en >= datetime('now', '-2 days') ORDER BY creado_en DESC LIMIT 200`
  ).bind(s.slug).all();
  const ap = await env.DB.prepare(`SELECT count(*) AS n, max(creado_en) AS ultima FROM propuesta_eventos WHERE slug = ? AND evento = 'apertura'`).bind(s.slug).first();
  const aperturas = { length: ap?.n || 0, ultima: ap?.ultima || null };
  const p = proximoToque(s, toques, sec, hoy);
  const nombre = s.nombre || s.cliente || '';
  const texto = p ? textoDe(p.toque, { nombre, abrio: aperturas.length > 0, revisoDisponibilidad: Boolean(s.reviso_disponibilidad) }) : null;
  const ventanaAbierta = Boolean(s.ventana_hasta && isoDe(s.ventana_hasta) > Date.now());
  return {
    slug: s.slug, numero: s.numero, cliente: s.cliente, nombre,
    conversacion_id: s.conversacion_id, lead_id: s.lead_id, wa_id: s.wa_id || null,
    dia0: s.dia0, estado: s.estado, estado_motivo: s.estado_motivo,
    reviso_disponibilidad: Boolean(s.reviso_disponibilidad),
    toque: p ? { dia: p.toque.dia, clave: p.toque.clave, titulo: p.toque.titulo, tipo: p.toque.tipo, medio: p.toque.medio || null,
      adjunto: p.toque.adjunto || null, completar: p.toque.completar || null, conDisponibilidad: Boolean(p.toque.textoConDisponibilidad) } : null,
    vence: p?.vence || null, atraso: p?.atraso || 0, vencido: Boolean(p?.vencido),
    texto,
    caliente: s.estado === 'activa' && caliente(ev),
    abrio: aperturas.length > 0, aperturas: aperturas.length, ultima_apertura: aperturas.ultima,
    hechos: toques.length,
    ultimo_toque: toques.length ? toques[toques.length - 1].fecha : null,
    ventana_abierta: ventanaAbierta,
    wa_link: s.wa_id ? `https://wa.me/${s.wa_id}${texto && p.toque.tipo === 'texto' ? '?text=' + encodeURIComponent(texto) : ''}` : null,
  };
}

const SELECT_SEG = `SELECT s.*, p.numero, p.cliente, c.wa_id, c.ultimo_in_en, c.ventana_hasta,
    coalesce(c.alias, l.nombre, c.nombre_perfil) AS nombre
  FROM propuesta_seguimientos s
  LEFT JOIN propuestas p ON p.slug = s.slug
  LEFT JOIN wa_conversaciones c ON c.id = s.conversacion_id
  LEFT JOIN leads l ON l.id = coalesce(s.lead_id, c.lead_id)`;

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  const q = new URL(request.url).searchParams;
  const hoy = /^\d{4}-\d{2}-\d{2}$/.test(q.get('hoy') || '') && rolDe(request, env) === 'admin' ? q.get('hoy') : hoyLima();
  const sec = await secuenciaDe(env);

  if (q.get('propuestas') === '1') {
    const { results } = await env.DB.prepare(
      `SELECT p.slug, p.numero, p.cliente, s.estado, s.conversacion_id FROM propuestas p
       LEFT JOIN propuesta_seguimientos s ON s.slug = p.slug ORDER BY p.registrada_en DESC LIMIT 200`
    ).all();
    return json({ propuestas: results });
  }

  if (/^\d+$/.test(q.get('conversacion_id') || '')) {
    const { results } = await env.DB.prepare(`${SELECT_SEG} WHERE s.conversacion_id = ? ORDER BY s.creado_en DESC`).bind(Number(q.get('conversacion_id'))).all();
    const items = [];
    for (const s of results) items.push(await fila(env, s, sec, hoy));
    return json({ hoy, items, secuencia: sec.map((t) => ({ dia: t.dia, titulo: t.titulo, tipo: t.tipo })) });
  }

  return json(await listaHoy(env, hoy, sec));
}

// La lista de "Seguimientos hoy". La usa también el aviso diario (/api/seguimientos-aviso).
export async function listaHoy(env, hoy = hoyLima(), sec = null) {
  sec = sec || await secuenciaDe(env);
  const { results } = await env.DB.prepare(`${SELECT_SEG} WHERE s.estado = 'activa'`).all();
  const items = [];
  for (const s of results) {
    const f = await fila(env, s, sec, hoy);
    // Caliente sin toque vencido: solo si hoy nadie le escribió todavía (ni el Día 0 ni un toque).
    if (f.estado === 'activa' && f.toque && (f.vencido || (f.caliente && f.dia0 < hoy && f.ultimo_toque !== hoy))) items.push(f);
  }
  // Primero los calientes, después los más atrasados.
  items.sort((a, b) => (b.caliente - a.caliente) || (b.vencido - a.vencido) || (b.atraso - a.atraso) || String(a.nombre).localeCompare(String(b.nombre)));
  return {
    hoy, total: items.length,
    calientes: items.filter((i) => i.caliente).length,
    atrasados: items.filter((i) => i.atraso > 0).length,
    items,
  };
}

// Mientras dure la secuencia, los follow-ups automáticos de la IA (setter-worker, correrSeguimientos)
// saltean este chat hasta que el cliente vuelva a escribir: así no le llegan dos mensajes.
async function omitirFollowupIA(env, conversacionId, leadId) {
  if (!conversacionId) return;
  try {
    await env.DB.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
      .bind(conversacionId, leadId ?? null, 'seguimiento_omitido', 'seguimiento de propuesta activo', new Date().toISOString()).run();
  } catch { /* CRM sin setter: no hay follow-ups de IA que frenar */ }
}

export async function onRequestPost({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  const slug = typeof b.slug === 'string' ? b.slug.trim() : '';
  if (!SLUG.test(slug)) return json({ error: 'slug inválido' }, 400);
  const accion = b.accion;
  const hoy = hoyLima();
  const por = porDe(b, request, env);

  if (accion === 'enviada') {
    const conv = Number(b.conversacion_id);
    if (!Number.isInteger(conv) || conv <= 0) return json({ error: 'falta el chat' }, 400);
    const c = await env.DB.prepare('SELECT id, lead_id FROM wa_conversaciones WHERE id = ?').bind(conv).first();
    if (!c) return json({ error: 'no existe el chat' }, 404);
    const p = await propuestaVerificada(env, slug);
    if (!p) return json({ error: 'esa propuesta no está publicada' }, 404);
    // Volver a marcarla reinicia la secuencia desde hoy (por ejemplo, si se mandó una versión nueva).
    await env.DB.batch([
      env.DB.prepare('DELETE FROM propuesta_toques WHERE slug = ?').bind(slug),
      env.DB.prepare(`INSERT INTO propuesta_seguimientos (slug, conversacion_id, lead_id, dia0, estado, estado_motivo)
        VALUES (?, ?, ?, ?, 'activa', ?)
        ON CONFLICT (slug) DO UPDATE SET conversacion_id = excluded.conversacion_id, lead_id = excluded.lead_id, dia0 = excluded.dia0,
          estado = 'activa', estado_motivo = excluded.estado_motivo, reviso_disponibilidad = 0, retomado_desde = NULL, retomado_en = NULL,
          creado_en = datetime('now'), actualizado_en = datetime('now')`).bind(slug, c.id, c.lead_id ?? null, hoy, `enviada por ${por}`),
    ]);
    await omitirFollowupIA(env, c.id, c.lead_id);
    return json({ ok: true, dia0: hoy });
  }

  const s = await env.DB.prepare(`${SELECT_SEG} WHERE s.slug = ?`).bind(slug).first();
  if (!s) return json({ error: 'esa propuesta no tiene seguimiento' }, 404);

  if (['pausar', 'perdida', 'respondio'].includes(accion)) {
    const estado = { pausar: 'pausada', perdida: 'perdida', respondio: 'respondio' }[accion];
    await cambiarEstado(env, slug, estado, `${{ pausada: 'pausada', perdida: 'perdida', respondio: 'respondió' }[estado]} (${por}, ${ddmm(hoy)})`);
    return json({ ok: true, estado });
  }
  if (accion === 'retomar') {
    const desde = retomarDesde(s.dia0, hoy);
    await env.DB.prepare(`UPDATE propuesta_seguimientos SET estado = 'activa', estado_motivo = ?, retomado_desde = ?, retomado_en = ?, actualizado_en = datetime('now') WHERE slug = ?`)
      .bind(`retomada por ${por} el ${ddmm(hoy)}`, desde, new Date().toISOString(), slug).run();
    await omitirFollowupIA(env, s.conversacion_id, s.lead_id);
    return json({ ok: true, desde });
  }
  if (accion === 'disponibilidad') {
    await env.DB.prepare(`UPDATE propuesta_seguimientos SET reviso_disponibilidad = ?, actualizado_en = datetime('now') WHERE slug = ?`).bind(b.valor ? 1 : 0, slug).run();
    return json({ ok: true });
  }

  if (['enviar', 'hecho', 'saltear'].includes(accion)) {
    if (s.estado !== 'activa') return json({ error: `la secuencia está ${s.estado}` }, 409);
    const sec = await secuenciaDe(env);
    const { results: toques } = await env.DB.prepare('SELECT dia, fecha FROM propuesta_toques WHERE slug = ?').bind(slug).all();
    const p = proximoToque(s, toques, sec, hoy);
    // Solo se puede marcar el toque que toca: evita doble clic y pestañas viejas.
    if (!p || p.toque.dia !== Number(b.dia)) return json({ error: 'ese toque ya no es el que toca; recargá la lista' }, 409);

    let texto = null;
    if (accion === 'enviar') {
      texto = typeof b.texto === 'string' ? b.texto.trim() : '';
      if (!texto) return json({ error: 'mensaje vacío' }, 400);
      if (texto.length > 4096) return json({ error: 'máximo 4096 caracteres' }, 400);
      if (/\[(?:Nombre|novedad real|lugar)\]/i.test(texto)) return json({ error: 'falta completar lo que está entre corchetes' }, 400);
      if (!s.conversacion_id) return json({ error: 'la propuesta no está unida a un chat' }, 409);
      if (!(s.ventana_hasta && isoDe(s.ventana_hasta) > Date.now())) {
        return json({ error: 'pasaron más de 24 h desde el último mensaje del cliente: mandalo desde el teléfono', ventana: false }, 409);
      }
      if (!setterActivo(env)) return json({ error: 'el envío desde el Inbox no está activo en este CRM', ventana: true }, 409);
      const r = await alWorker(env, 'interno/enviar', { method: 'POST', body: JSON.stringify({ conversacion_id: s.conversacion_id, texto, autor: 'asesora_web' }) });
      const data = await r.json().catch(() => ({ error: 'el Worker no respondió bien' }));
      if (!r.ok) return json({ error: data.error || 'no se pudo enviar' }, r.status);
      // Igual que responder a mano desde el Inbox: la IA se pausa en ese chat (salvo "Responde siempre").
      const conv = await env.DB.prepare('SELECT id, lead_id, ia_activa, agente_activo FROM wa_conversaciones WHERE id = ?').bind(s.conversacion_id).first();
      const siempre = await env.DB.prepare(`SELECT responde_siempre FROM setter_agentes WHERE activo = 1 AND (clave = ?1 OR rol = 'jefe') ORDER BY clave = ?1 DESC LIMIT 1`)
        .bind(conv?.agente_activo ?? '').first();
      if (conv?.ia_activa && !siempre?.responde_siempre) {
        await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'asesora_respondio' WHERE id = ?`).bind(conv.id).run();
        await evento(env.DB, conv, 'pausa', 'seguimiento de propuesta enviado desde el Inbox');
      }
    }
    await env.DB.prepare('INSERT INTO propuesta_toques (slug, dia, accion, texto, por, fecha) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(slug, p.toque.dia, { enviar: 'enviado', hecho: 'manual', saltear: 'salteado' }[accion], texto, por, hoy).run();
    await omitirFollowupIA(env, s.conversacion_id, s.lead_id);
    return json({ ok: true, dia: p.toque.dia });
  }

  return json({ error: 'acción desconocida' }, 400);
}
