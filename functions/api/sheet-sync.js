// POST /api/sheet-sync — recibe del Apps Script del Google Sheet
// "Luna Llena | CRM Setting" lo que pasa en el Sheet, y lo deja en el CRM.
//
// Dos tipos de envío (campo `tipo`):
//
//   registro  { tipo, setter?: 'Setter 1', eventos: [{ evento, fecha, momento, id_suscriptor, nombre, pieza?, setter? }] }
//     Sheet nuevo "Luna Llena | Setting" (apps-script-sheet/Setting.gs): una
//     sola hoja Registro, el setter va por fila y PIEZA (o DIAS) trae la Pieza.
//     Conversaciones = personas con DIAS en el día; formularios enviados =
//     FORMULARIO; completados = CONSULTA (se recalculan solos en metricas_dia).
//
//     Filas de "Registro Setter N" (las escribe ManyChat). Se guardan en
//     sheet_eventos (sin duplicar), se recalcula `conversaciones` de
//     metricas_dia con los INBOUND del día y se une la persona con su lead por
//     manychat_id o por usuario de Instagram (la columna Nombre ahora es el
//     usuario). CALENDARIO y CALL crean el lead si no existía; INBOUND y FUP
//     solo completan uno que ya existe (no inundan el CRM de leads).
//
//   agendas   { tipo, hoja: 'Closer 3', filas: [{ nombre, fecha_agenda, fecha_llamada, setter, closer, ... }] }
//     Filas de "Closer N". Lo que tiene columna en `leads` se copia al lead
//     (el valor del Sheet manda cuando no está vacío); la fila completa queda
//     en sheet_agendas.
//
// Es idempotente: reenviar lo mismo no duplica nada. Máximo 50 filas por
// pedido, para no pasar los 100 parámetros por consulta de D1.

import { rolDe, json } from '../_lib/auth.js';
import { texto, fechaOVacio, usuarioIg, evento as normEvento, calificado, marcas } from '../_lib/sheet-sync.js';

const MAX_FILAS = 50;

export async function onRequestPost({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'body no es json' }, 400); }
  if (body.tipo === 'registro') return registro(env, body);
  if (body.tipo === 'agendas') return agendas(env, body);
  return json({ error: "tipo debe ser 'registro' o 'agendas'" }, 400);
}

async function registro(env, body) {
  const setterLote = texto(body.setter, 40);
  if (!Array.isArray(body.eventos) || !body.eventos.length) return json({ error: 'eventos vacío' }, 400);
  if (body.eventos.length > MAX_FILAS) return json({ error: `máximo ${MAX_FILAS} eventos por pedido` }, 400);

  const ahora = new Date().toISOString();
  const validos = [];
  const descartados = [];
  body.eventos.forEach((e, i) => {
    const ev = normEvento(e.evento);
    const fecha = fechaOVacio(e.fecha);
    const momento = texto(e.momento, 40);
    if (!ev) return descartados.push({ i, motivo: `evento desconocido: ${texto(e.evento, 30)}` });
    if (!fecha || !momento) return descartados.push({ i, motivo: 'fecha o momento inválido' });
    const id = texto(e.id_suscriptor, 40) || null;
    const nombreRaw = texto(e.nombre, 120);
    const ig = usuarioIg(nombreRaw);
    if (!id && !ig && !nombreRaw) return descartados.push({ i, motivo: 'sin ID Suscriptor ni Nombre' });
    const pieza = texto(e.pieza, 120) || null;
    const setter = texto(e.setter, 40) || setterLote || 'ManyChat';
    // La pieza entra en la clave: dos PIEZA en el mismo segundo con piezas
    // distintas son dos filas, no un duplicado.
    validos.push({ ev, fecha, momento, id, ig, nombreRaw, pieza, setter,
      clave: [setter, momento, ev, id || ig || nombreRaw, pieza || ''].join('|') });
  });
  if (!validos.length) {
    return json({ ok: true, recibidos: body.eventos.length, nuevos: 0, duplicados: 0, descartados,
      leads_actualizados: 0, leads_creados: 0, dias_recalculados: 0 });
  }

  const db = env.DB;

  // 1) Guardar los eventos. `changes` dice cuáles eran nuevos.
  const ins = await db.batch(validos.map((v) => db.prepare(
    `INSERT OR IGNORE INTO sheet_eventos (clave, setter, evento, fecha, momento, manychat_id, ig_username, nombre_raw, pieza, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(v.clave, v.setter, v.ev, v.fecha, v.momento, v.id, v.ig, v.nombreRaw, v.pieza, ahora)));
  const nuevos = ins.filter((r) => r.meta?.changes > 0).length;

  // 2) Personas distintas del pedido, para buscarlas en leads de una sola vez.
  const personas = new Map();
  for (const v of validos) {
    const k = v.id ? 'm:' + v.id : v.ig ? 'u:' + v.ig : null;
    if (!k) continue;
    const p = personas.get(k) || { id: v.id, ig: v.ig, eventos: new Set(), fechaCall: null, setter: v.setter };
    p.id = p.id || v.id;
    p.ig = p.ig || v.ig;
    p.eventos.add(v.ev);
    // CONSULTA (antes CALL) es la fecha que va a fecha_agenda del lead.
    if (v.ev === 'CONSULTA' && (!p.fechaCall || v.fecha < p.fechaCall)) p.fechaCall = v.fecha;
    personas.set(k, p);
  }

  const ids = [...new Set([...personas.values()].map((p) => p.id).filter(Boolean))];
  const igs = [...new Set([...personas.values()].map((p) => p.ig).filter(Boolean))];
  const porId = new Map();
  const porIg = new Map();
  if (ids.length || igs.length) {
    const cond = [];
    const binds = [];
    if (ids.length) { cond.push(`manychat_id IN (${marcas(ids.length)})`); binds.push(...ids); }
    if (igs.length) { cond.push(`lower(ig_username) IN (${marcas(igs.length)})`); binds.push(...igs); }
    const { results } = await db.prepare(
      `SELECT id, manychat_id, ig_username FROM leads WHERE ${cond.join(' OR ')} ORDER BY actualizado_en DESC`
    ).bind(...binds).all();
    for (const l of results) {
      if (l.manychat_id && !porId.has(String(l.manychat_id))) porId.set(String(l.manychat_id), l.id);
      const u = l.ig_username ? String(l.ig_username).toLowerCase() : null;
      if (u && !porIg.has(u)) porIg.set(u, l.id);
    }
  }

  // 3) Un batch con todo: leads (actualizar o crear) y conversaciones del día.
  const stmts = [];
  let actualizados = 0;
  let creados = 0;
  for (const p of personas.values()) {
    const leadId = (p.id && porId.get(p.id)) || (p.ig && porIg.get(p.ig)) || null;
    if (leadId) {
      actualizados++;
      stmts.push(db.prepare(
        `UPDATE leads SET
           manychat_id  = coalesce(nullif(manychat_id, ''), ?),
           ig_username  = coalesce(nullif(ig_username, ''), ?),
           setter       = coalesce(nullif(setter, ''), ?),
           fecha_agenda = coalesce(nullif(fecha_agenda, ''), ?),
           actualizado_en = ?
         WHERE id = ?`
      ).bind(p.id, p.ig, p.setter, p.fechaCall, ahora, leadId));
    } else if (p.eventos.has('FORMULARIO') || p.eventos.has('CONSULTA')) {
      creados++;
      stmts.push(db.prepare(
        `INSERT INTO leads (nombre, manychat_id, ig_username, setter, fuente, etapa, fecha_agenda, fecha_alta, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, 'Instagram', 'lead_nuevo', ?, ?, ?, ?)`
      // El nombre queda vacío: el Sheet trae el usuario de Instagram, que va a
      // ig_username. El nombre real se completa a mano o desde el formulario.
      ).bind('', p.id, p.ig, p.setter, p.fechaCall, ahora, ahora, ahora));
      stmts.push(db.prepare(
        `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en)
         VALUES ((SELECT last_insert_rowid()), NULL, 'lead_nuevo', 'sheet', ?)`
      ).bind(ahora));
    }
  }

  // Pestaña Conversación, sola: por día, personas distintas con DIAS (o
  // INBOUND, del Sheet viejo) = conversaciones; con FORMULARIO = enviados;
  // con CONSULTA = completados. Los días con eventos pisan la carga manual.
  const CUENTA = ['DIAS', 'INBOUND', 'FORMULARIO', 'CONSULTA'];
  const dias = [...new Set(validos.filter((v) => CUENTA.includes(v.ev)).map((v) => v.fecha))];
  const per = (evs) => `(SELECT COUNT(DISTINCT coalesce(manychat_id, ig_username, nombre_raw)) FROM sheet_eventos
                          WHERE fecha = ?1 AND evento IN (${evs}))`;
  for (const d of dias) {
    stmts.push(db.prepare(
      `INSERT INTO metricas_dia (fecha, conversaciones, formularios_enviados, formularios_completados, actualizado_en)
       VALUES (?1, ${per("'DIAS','INBOUND'")}, ${per("'FORMULARIO'")}, ${per("'CONSULTA'")}, ?2)
       ON CONFLICT(fecha) DO UPDATE SET
         conversaciones = excluded.conversaciones,
         formularios_enviados = excluded.formularios_enviados,
         formularios_completados = excluded.formularios_completados,
         actualizado_en = excluded.actualizado_en`
    ).bind(d, ahora));
  }

  if (stmts.length) await db.batch(stmts);

  return json({
    ok: true, recibidos: body.eventos.length, nuevos, duplicados: validos.length - nuevos,
    descartados, leads_actualizados: actualizados, leads_creados: creados, dias_recalculados: dias.length,
  });
}

async function agendas(env, body) {
  const hoja = texto(body.hoja, 40);
  if (!hoja) return json({ error: 'falta hoja' }, 400);
  if (!Array.isArray(body.filas) || !body.filas.length) return json({ error: 'filas vacío' }, 400);
  if (body.filas.length > MAX_FILAS) return json({ error: `máximo ${MAX_FILAS} filas por pedido` }, 400);

  const ahora = new Date().toISOString();
  const filas = [];
  const descartadas = [];
  body.filas.forEach((f, i) => {
    const nombreRaw = texto(f.nombre, 120);
    if (!nombreRaw) return descartadas.push({ i, motivo: 'sin Nombre' });
    const ig = usuarioIg(nombreRaw);
    const persona = ig || nombreRaw.toLowerCase();
    const fechaAgenda = fechaOVacio(f.fecha_agenda);
    filas.push({
      nombreRaw, ig, persona,
      fechaAgenda,
      fechaLlamada: fechaOVacio(f.fecha_llamada),
      setter: texto(f.setter, 60) || null,
      closer: texto(f.closer, 60) || null,
      fuente: texto(f.fuente, 80) || null,
      estrategia: texto(f.estrategia, 80) || null,
      medio: texto(f.medio_agenda, 80) || null,
      calif: calificado(f.calificado),
      clave: [hoja, persona, fechaAgenda || ''].join('|'),
      datos: f,
    });
  });
  if (!filas.length) {
    return json({ ok: true, recibidas: body.filas.length, leads_actualizados: 0, leads_creados: 0, descartadas });
  }

  const db = env.DB;
  const nombres = [...new Set(filas.map((f) => f.persona))];
  const { results } = await db.prepare(
    `SELECT id, nombre, ig_username FROM leads
      WHERE lower(ig_username) IN (${marcas(nombres.length)}) OR lower(nombre) IN (${marcas(nombres.length)})
      ORDER BY actualizado_en DESC`
  ).bind(...nombres, ...nombres).all();
  const porPersona = new Map();
  for (const l of results) {
    for (const k of [l.ig_username, l.nombre]) {
      const c = k ? String(k).toLowerCase() : null;
      if (c && !porPersona.has(c)) porPersona.set(c, l.id);
    }
  }

  // Una persona puede venir en varias filas (varias agendas): al lead le
  // llega una sola escritura, con la última fila que tiene cada dato.
  const porLead = new Map();
  for (const f of filas) {
    const m = porLead.get(f.persona) || { ...f };
    for (const k of ['ig', 'fechaAgenda', 'fechaLlamada', 'setter', 'closer', 'fuente', 'estrategia', 'medio', 'calif']) {
      if (f[k]) m[k] = f[k];
    }
    porLead.set(f.persona, m);
  }

  const stmts = [];
  let actualizados = 0;
  let creados = 0;
  for (const f of porLead.values()) {
    const leadId = porPersona.get(f.persona) || null;
    if (leadId) {
      actualizados++;
      stmts.push(db.prepare(
        `UPDATE leads SET
           ig_username  = coalesce(nullif(ig_username, ''), ?),
           fecha_agenda = coalesce(?, fecha_agenda),
           fecha_llamada = coalesce(?, fecha_llamada),
           setter       = coalesce(?, setter),
           closer       = coalesce(?, closer),
           fuente       = coalesce(?, fuente),
           estrategia   = coalesce(?, estrategia),
           medio_agenda = coalesce(?, medio_agenda),
           calificado   = coalesce(?, calificado),
           actualizado_en = ?
         WHERE id = ?`
      ).bind(f.ig, f.fechaAgenda, f.fechaLlamada, f.setter, f.closer, f.fuente, f.estrategia, f.medio, f.calif, ahora, leadId));
    } else {
      creados++;
      stmts.push(db.prepare(
        `INSERT INTO leads (nombre, ig_username, fecha_agenda, fecha_llamada, setter, closer, fuente, estrategia, medio_agenda,
                            calificado, etapa, fecha_alta, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, coalesce(?, 'Instagram'), ?, ?, ?, 'lead_nuevo', ?, ?, ?)`
      ).bind(f.nombreRaw, f.ig, f.fechaAgenda, f.fechaLlamada, f.setter, f.closer, f.fuente, f.estrategia, f.medio, f.calif, ahora, ahora, ahora));
      stmts.push(db.prepare(
        `INSERT INTO eventos (lead_id, etapa_desde, etapa_hasta, quien, creado_en)
         VALUES ((SELECT last_insert_rowid()), NULL, 'lead_nuevo', 'sheet', ?)`
      ).bind(ahora));
    }
  }
  // La fila completa (con situación, programa, cash...) queda guardada tal cual.
  for (const f of filas) {
    stmts.push(db.prepare(
      `INSERT INTO sheet_agendas (clave, hoja, ig_username, nombre_raw, datos_json, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET ig_username = excluded.ig_username, nombre_raw = excluded.nombre_raw,
         datos_json = excluded.datos_json, actualizado_en = excluded.actualizado_en`
    ).bind(f.clave, hoja, f.ig, f.nombreRaw, JSON.stringify(f.datos).slice(0, 8000), ahora));
  }
  await db.batch(stmts);

  return json({ ok: true, recibidas: body.filas.length, leads_actualizados: actualizados, leads_creados: creados, descartadas });
}
