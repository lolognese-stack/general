// GET /api/embudo?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  (sin parámetros = todo)
//
// Embudo de prospección de Luna Llena y recorrido de contenido, a partir de
// las filas del Sheet de setting (tabla sheet_eventos, ver migración 047).
//
// Cohorte: las personas cuyo PRIMER evento de prospección (DIAS, o cualquier
// etapa si DIAS no quedó registrado) cae en el rango. De esas, cuántas
// llegaron a cada etapa, en cualquier fecha posterior. Así el embudo no se
// infla con gente que entró antes del período.
//
// Recorrido, por persona y en orden de momento:
//   apertura  = la primera pieza que aparece (DIAS o RECORRIDO con Pieza)
//   gatillo   = la última pieza antes del primer FORMULARIO (si llegó)
//   nutrición = las piezas entre la apertura y el gatillo
// Ventas: las del lead unido por manychat_id, con estado vendido; `ventas_x`
// cuenta las de total >= el ticket objetivo (X, en USD).

import { rolDe, json } from '../_lib/auth.js';
import { ETAPAS } from '../_lib/sheet-sync.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TICKET_X_USD = 800;
const VENDIDA = "estado IN ('sena_pagada', 'confirmada', 'pagada', 'finalizada')";
const norm = (s) => String(s || '').trim().toLowerCase();

export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const u = new URL(request.url);
  const desde = FECHA.test(u.searchParams.get('desde') || '') ? u.searchParams.get('desde') : '0000-01-01';
  const hasta = FECHA.test(u.searchParams.get('hasta') || '') ? u.searchParams.get('hasta') : '9999-12-31';

  const db = env.DB;
  const etapasSql = ETAPAS.map((e) => `'${e}'`).join(',');
  // Persona = ManyChat ID; si la fila no lo trae, el usuario de Instagram.
  const PERSONA = `coalesce(nullif(manychat_id, ''), lower(ig_username), lower(nombre_raw))`;

  const { results: filas } = await db.prepare(
    `WITH cohorte AS (
       SELECT ${PERSONA} AS persona, min(fecha) AS entrada
         FROM sheet_eventos WHERE evento IN (${etapasSql})
        GROUP BY 1 HAVING min(fecha) BETWEEN ?1 AND ?2
     )
     SELECT c.persona, c.entrada, e.evento, e.momento, e.fecha, e.pieza, e.manychat_id
       FROM cohorte c JOIN sheet_eventos e ON ${PERSONA.replace(/manychat_id|ig_username|nombre_raw/g, (m) => 'e.' + m)} = c.persona
      WHERE e.evento IN (${etapasSql})
      ORDER BY c.persona, e.momento`
  ).bind(desde, hasta).all();

  // Agrupar por persona
  const personas = new Map();
  for (const f of filas) {
    const p = personas.get(f.persona) || { persona: f.persona, manychat_id: null, eventos: [] };
    p.manychat_id = p.manychat_id || f.manychat_id;
    p.eventos.push(f);
    personas.set(f.persona, p);
  }

  // Ventas por ManyChat ID (lead unido)
  const ids = [...new Set([...personas.values()].map((p) => p.manychat_id).filter(Boolean))];
  const ventasPorId = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const lote = ids.slice(i, i + 80);
    const { results } = await db.prepare(
      `SELECT l.manychat_id, count(v.id) AS n, max(v.total_centavos) AS max_c, sum(v.total_centavos) AS total_c
         FROM leads l JOIN ventas v ON v.lead_id = l.id AND v.${VENDIDA}
        WHERE l.manychat_id IN (${lote.map(() => '?').join(',')}) GROUP BY l.manychat_id`
    ).bind(...lote).all();
    for (const r of results) ventasPorId.set(String(r.manychat_id), r);
  }

  // Nombres de pieza del Planificador, por etiqueta de ManyChat
  const { results: piezasCrm } = await db.prepare(
    `SELECT id, tema, formato, fecha, etiqueta_manychat FROM piezas WHERE etiqueta_manychat IS NOT NULL AND etiqueta_manychat != ''`
  ).all();
  const piezaPorEtiqueta = new Map(piezasCrm.map((p) => [norm(p.etiqueta_manychat), p]));

  const llegaron = Object.fromEntries(ETAPAS.map((e) => [e, 0]));
  const dias = { formulario: [], consulta: [] };
  const recorridos = [];
  const porPieza = new Map();
  const fila = (etq) => {
    const k = norm(etq);
    if (!porPieza.has(k)) {
      const pc = piezaPorEtiqueta.get(k);
      porPieza.set(k, { etiqueta: etq, pieza_id: pc?.id || null, tema: pc?.tema || null, formato: pc?.formato || null,
        aperturas: 0, nutricion: 0, gatillos: 0, formularios: 0, consultas: 0, ventas: 0, ventas_x: 0 });
    }
    return porPieza.get(k);
  };

  let sinPieza = 0, conVentaX = 0, conVenta = 0;
  for (const p of personas.values()) {
    const ev = p.eventos;
    const tiene = new Set(ev.map((e) => e.evento));
    ETAPAS.forEach((e) => { if (tiene.has(e)) llegaron[e]++; });

    const t0 = new Date(ev[0].momento).getTime();
    const primero = (nombre) => ev.find((e) => e.evento === nombre);
    const fForm = primero('FORMULARIO'), fCons = primero('CONSULTA');
    if (fForm) dias.formulario.push((new Date(fForm.momento) - t0) / 86400000);
    if (fCons) dias.consulta.push((new Date(fCons.momento) - t0) / 86400000);

    // Piezas en orden, sin repetir la misma seguida
    const hastaGatillo = fForm ? ev.filter((e) => e.momento <= fForm.momento) : ev;
    const todas = ev.filter((e) => e.pieza).map((e) => e.pieza);
    const antes = hastaGatillo.filter((e) => e.pieza).map((e) => e.pieza);
    const v = p.manychat_id ? ventasPorId.get(String(p.manychat_id)) : null;
    const vendio = !!v, vendioX = !!v && (v.max_c || 0) >= TICKET_X_USD * 100;
    if (vendio) conVenta++;
    if (vendioX) conVentaX++;
    if (!todas.length) { sinPieza++; continue; }

    const apertura = todas[0];
    const gatillo = fForm && antes.length ? antes[antes.length - 1] : null;
    const medio = (fForm ? antes : todas).slice(1, gatillo ? -1 : undefined);
    const nutricion = [...new Set(medio.filter((x) => norm(x) !== norm(apertura) && (!gatillo || norm(x) !== norm(gatillo))))];

    const suma = (etq, campo) => { const r = fila(etq); r[campo]++; if (fForm) r.formularios++; if (fCons) r.consultas++; if (vendio) r.ventas++; if (vendioX) r.ventas_x++; };
    suma(apertura, 'aperturas');
    nutricion.forEach((x) => suma(x, 'nutricion'));
    if (gatillo && norm(gatillo) !== norm(apertura)) suma(gatillo, 'gatillos');
    else if (gatillo) fila(gatillo).gatillos++;

    recorridos.push({ persona: p.persona, manychat_id: p.manychat_id, entrada: ev[0].fecha,
      apertura, nutricion, gatillo, etapa: ETAPAS.filter((e) => tiene.has(e)).pop(),
      venta_usd: v ? Math.round((v.total_c || 0) / 100) : null });
  }

  const mediana = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  return json({
    desde: desde === '0000-01-01' ? null : desde, hasta: hasta === '9999-12-31' ? null : hasta,
    ticket_x_usd: TICKET_X_USD,
    personas: personas.size,
    etapas: ETAPAS.map((e) => ({ etapa: e, personas: llegaron[e] })),
    dias_mediana: { formulario: mediana(dias.formulario), consulta: mediana(dias.consulta) },
    con_venta: conVenta, con_venta_x: conVentaX, sin_pieza: sinPieza,
    piezas: [...porPieza.values()].sort((a, b) => (b.aperturas + b.gatillos) - (a.aperturas + a.gatillos) || b.nutricion - a.nutricion),
    recorridos: recorridos.slice(-200).reverse(),
  });
}
