// Analíticas del setter de WhatsApp (plan §2.6, adaptado a Luna Llena).
// Lee solo lo del período (conversaciones creadas desde `desde`) y calcula
// todo en memoria: se piden a mano desde el panel, no con el polling.

const PERU_MS = 5 * 3600e3;
const diaPeru = (iso) => new Date(Date.parse(iso) - PERU_MS).toISOString().slice(0, 10);
const ABIERTOS = ['frio', 'tibio', 'calificado', 'cotizador_enviado', 'nurture'];
const ETAPAS_PROPUESTA = ['propuesta_pendiente', 'propuesta_enviada', 'seguimiento', 'ganado'];
const lista = (j) => { try { const x = JSON.parse(j || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function contar(items, tope = 10) {
  const m = new Map();
  for (const it of items) {
    const k = String(it || '').trim();
    if (!k) continue;
    const clave = k.toLowerCase();
    const e = m.get(clave) || { valor: k, n: 0 };
    e.n++;
    m.set(clave, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, tope);
}

export async function cargarDatos(db, desde) {
  const [convs, msgs, analisis, agentes, derivaciones] = await Promise.all([
    db.prepare(
      `SELECT c.id, c.lead_id, c.wa_id, c.nombre_perfil, c.ia_activa, c.espera_persona, c.abierta_por, c.paso_guion, c.ultimo_autor, c.ultimo_en, c.creado_en,
              l.nombre, l.ia_estado, l.calificado, l.etapa, l.ia_origen, l.ia_primera_intencion
         FROM wa_conversaciones c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.creado_en >= ? AND c.rol IS NULL`
    ).bind(desde).all().then((r) => r.results),
    db.prepare(
      `SELECT m.conversacion_id, m.direccion, m.autor, m.estado, m.es_followup, m.intento_followup, m.recurso_id, m.creado_en
         FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id WHERE c.creado_en >= ? AND c.rol IS NULL AND m.tipo <> 'nota' ORDER BY m.creado_en, m.id`
    ).bind(desde).all().then((r) => r.results),
    db.prepare(`SELECT a.* FROM wa_analisis a JOIN wa_conversaciones c ON c.id = a.conversacion_id WHERE c.creado_en >= ?`).bind(desde).all().then((r) => r.results),
    db.prepare('SELECT clave, recurso_conversion_id FROM setter_agentes').all().then((r) => r.results),
    db.prepare(`SELECT conversacion_id FROM setter_eventos WHERE tipo = 'derivacion' AND creado_en >= ?`).bind(desde).all().then((r) => r.results),
  ]);
  return { convs, msgs, analisis, conversion: new Set(agentes.map((a) => a.recurso_conversion_id).filter(Boolean)), derivadas: new Set(derivaciones.map((d) => d.conversacion_id)) };
}

export function calcular({ convs, msgs, analisis, conversion, derivadas }, { desde, hasta }) {
  const porConv = new Map(convs.map((c) => [c.id, { c, m: [] }]));
  for (const m of msgs) porConv.get(m.conversacion_id)?.m.push(m);
  const an = new Map(analisis.map((a) => [a.conversacion_id, a]));

  // Hitos por conversación (cada etapa del embudo cuenta a quien llegó al menos ahí).
  const filas = [...porConv.values()].map(({ c, m }) => {
    const primeraIa = m.findIndex((x) => x.autor === 'ia');
    return {
      c, m,
      respondio: primeraIa >= 0 && m.slice(primeraIa + 1).some((x) => x.direccion === 'in'),
      calificado: !!c.calificado,
      cotizador: m.some((x) => x.recurso_id && conversion.has(x.recurso_id)),
      derivado: derivadas.has(c.id) || c.ia_estado === 'derivado',
      propuesta: ETAPAS_PROPUESTA.includes(c.etapa),
      ganado: c.etapa === 'ganado',
    };
  });
  const n = filas.length;
  const cuenta = (k) => filas.filter((f) => f[k]).length;
  const esperan = filas.filter((f) => f.c.espera_persona || (!f.c.ia_activa && f.c.ultimo_autor === 'lead'));

  // Mensajes por día y por autor.
  const dias = {};
  for (let t = Date.parse(desde); t <= Date.parse(hasta); t += 864e5) dias[diaPeru(new Date(t).toISOString())] = { leads: 0, ia: 0, equipo: 0, lead: 0 };
  for (const { c } of filas) if (dias[diaPeru(c.creado_en)]) dias[diaPeru(c.creado_en)].leads++;
  for (const x of msgs) {
    const d = dias[diaPeru(x.creado_en)]; if (!d) continue;
    d[x.autor === 'ia' ? 'ia' : x.autor === 'lead' ? 'lead' : 'equipo']++;
  }

  // Tiempo de respuesta de la IA: del mensaje del lead a la primera respuesta de la IA.
  const tiempos = [];
  for (const { m } of filas) {
    for (let i = 0; i < m.length; i++) {
      if (m[i].direccion !== 'in' || (m[i + 1] && m[i + 1].direccion === 'in')) continue;
      const r = m.slice(i + 1).find((x) => x.direccion === 'out');
      if (r && r.autor === 'ia' && !r.es_followup) tiempos.push((Date.parse(r.creado_en) - Date.parse(m[i].creado_en)) / 1000);
    }
  }
  const iaOut = msgs.filter((x) => x.autor === 'ia');

  // Follow-ups por intento (1, 2, 3+).
  const fu = {};
  for (const { m } of filas) {
    m.forEach((x, i) => {
      if (!x.es_followup) return;
      const k = x.intento_followup >= 3 ? '3+' : String(x.intento_followup || 1);
      const e = fu[k] || (fu[k] = { intento: k, enviados: 0, contestados: 0, horas: [] });
      e.enviados++;
      const resp = m.slice(i + 1).find((y) => y.direccion === 'in');
      if (resp) { e.contestados++; e.horas.push((Date.parse(resp.creado_en) - Date.parse(x.creado_en)) / 3600e3); }
    });
  }

  const objeciones = new Map();
  for (const a of analisis) for (const o of lista(a.objeciones_json)) {
    const k = String(o.objecion || '').toLowerCase().trim(); if (!k) continue;
    const e = objeciones.get(k) || { objecion: o.objecion, n: 0, frase: o.frase };
    e.n++; objeciones.set(k, e);
  }
  const preguntas = [];
  for (const a of analisis) for (const p of lista(a.preguntas_sin_respuesta_json)) preguntas.push({ pregunta: p, conversacion_id: a.conversacion_id });
  const origenes = contar(filas.map((f) => f.c.ia_origen || 'otro'));

  return {
    periodo: { desde, hasta },
    resumen: {
      leads: n,
      respondieron: cuenta('respondio'), tasa_respuesta: pct(cuenta('respondio'), n),
      cotizador: cuenta('cotizador'), tasa_cotizador: pct(cuenta('cotizador'), n),
      derivados: cuenta('derivado'), tasa_derivado: pct(cuenta('derivado'), n),
      propuesta: cuenta('propuesta'), ganados: cuenta('ganado'),
      esperan_persona: esperan.length,
    },
    embudo: [
      ['Conversaciones', n], ['Respondieron a la IA', cuenta('respondio')], ['Calificados', cuenta('calificado')],
      ['Cotizador enviado', cuenta('cotizador')], ['Derivados a asesora', cuenta('derivado')], ['Con propuesta', cuenta('propuesta')], ['Ganados', cuenta('ganado')],
    ].map(([etapa, valor]) => ({ etapa, valor })),
    para_retomar: filas
      .filter((f) => (f.c.ultimo_autor === 'lead' && !f.c.ia_activa) || (f.c.ia_estado === 'sin_respuesta' && ['si', 'masomenos'].includes(f.c.calificado)))
      .sort((a, b) => (b.c.ultimo_en || '').localeCompare(a.c.ultimo_en || '')).slice(0, 20)
      .map((f) => ({ conversacion_id: f.c.id, lead_id: f.c.lead_id, nombre: f.c.nombre || f.c.nombre_perfil || '+' + f.c.wa_id, ia_estado: f.c.ia_estado, calificado: f.c.calificado, ultimo_en: f.c.ultimo_en })),
    por_dia: Object.entries(dias).map(([dia, v]) => ({ dia, ...v })),
    origenes,
    perdidas: {
      etapa_corte: contar(analisis.map((a) => a.etapa_corte)),
      motivos: contar(analisis.map((a) => a.motivo_perdida)),
      como_terminan: contar(filas.map((f) => f.c.ia_estado || 'frio')),
      objeciones: [...objeciones.values()].sort((a, b) => b.n - a.n).slice(0, 10),
    },
    quien_llega: {
      estados: contar(filas.map((f) => f.c.ia_estado || 'frio')),
      tipos: contar(analisis.map((a) => a.tipo_lead)),
      dolores: contar(analisis.flatMap((a) => lista(a.dolores_json))),
      pedidos: contar(analisis.flatMap((a) => lista(a.pedidos_json))),
    },
    setter: {
      respuesta_mediana_s: mediana(tiempos),
      tasa_lectura: pct(iaOut.filter((x) => x.estado === 'read').length, iaOut.length),
      mensajes_ia_por_lead: n ? Math.round((iaOut.length / n) * 10) / 10 : 0,
      ia_apagada_abiertos: filas.filter((f) => !f.c.ia_activa && ABIERTOS.includes(f.c.ia_estado || 'frio')).length,
      senales_compra: contar(analisis.flatMap((a) => lista(a.senales_compra_json))),
      pasos_guion: contar(filas.filter((f) => f.c.paso_guion).map((f) => 'Paso ' + f.c.paso_guion)),
    },
    avanzadas: {
      cohortes: origenes.map(({ valor }) => {
        const g = filas.filter((f) => (f.c.ia_origen || 'otro').toLowerCase() === valor.toLowerCase());
        return { origen: valor, leads: g.length, cotizador: g.filter((f) => f.cotizador).length, derivados: g.filter((f) => f.derivado).length, ganados: g.filter((f) => f.ganado).length };
      }),
      primera_intencion: contar(filas.map((f) => an.get(f.c.id)?.intencion_inicial || f.c.ia_primera_intencion)),
      preguntas_sin_respuesta: preguntas.slice(0, 30),
      nunca_respondieron_3d: filas.filter((f) => !f.respondio && f.m.some((x) => x.autor === 'ia') && Date.parse(hasta) - Date.parse(f.c.creado_en) > 3 * 864e5).length,
      followups: Object.values(fu).sort((a, b) => a.intento.localeCompare(b.intento))
        .map(({ intento, enviados, contestados, horas }) => ({ intento, enviados, contestados, tasa: pct(contestados, enviados), horas_mediana: mediana(horas) })),
    },
  };
}
