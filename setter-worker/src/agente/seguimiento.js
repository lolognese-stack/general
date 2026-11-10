// Follow-ups: los corre el cron cada 15 min.
//
// Reglas en setter_seguimientos (activas, ordenadas por tras_horas). El
// intento N usa la regla N, contando las horas desde el último mensaje del
// lead. Entran dos tipos de chat donde lo último es nuestro y nadie espera a
// una persona:
//   - la IA está activa y el lead sigue abierto;
//   - la IA está pausada porque una persona tomó el chat (le mandó la
//     cotización) y esa persona escribió lo último. El seguimiento sale pero
//     la IA sigue pausada: si el lead contesta, lo atiende la persona.
// El agente decide si corresponde escribir: si no escribe nada (el chat ya
// se cerró, o se le preguntó el presupuesto y no contestó), queda anotado y
// no se le vuelve a preguntar hasta que el lead escriba de nuevo.
//   ia_libre  → el especialista `seguimiento` escribe un mensaje (solo con la
//               ventana de 24 h abierta).
//   plantilla → plantilla aprobada por Meta (`plantilla` = su nombre, en
//               español, sin variables). Sin nombre cargado, se saltea.
// Se respeta el horario (9 a 21 h en la zona del agente). Pasadas todas las
// reglas sin respuesta, el lead queda como sin_respuesta.

import { ejecutar } from './herramientas.js';
import { modoFinde, turnoDelEquipo } from './contexto.js';
import { correrAgentes, clienteClaude, modeloDe } from './loop.js';
import { partirBurbujas } from './turno.js';
import { enviar } from '../enviar.js';

const ABIERTOS = ['frio', 'tibio', 'calificado', 'cotizador_enviado', 'nurture'];
const PAUSA_PERSONA = ['asesora_respondio', 'handoff'];
const AUTOR_PERSONA = ['asesora_app', 'asesora_web'];
// Lo que contesta el agente cuando decide no escribir.
export const NO_ESCRIBIR = '[NO_ESCRIBIR]';
const en = (lista) => lista.map((x) => `'${x}'`).join(',');
const HORA_DESDE = 9, HORA_HASTA = 21;

function horaEn(zona, ahora) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: zona || 'America/Lima', hour: 'numeric', hourCycle: 'h23' }).format(ahora));
}

async function evento(db, conv, tipo, detalle, ahora) {
  await db.prepare('INSERT INTO setter_eventos (conversacion_id, lead_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?, ?)')
    .bind(conv.id, conv.lead_id, tipo, detalle ?? null, ahora).run();
}

export async function correrSeguimientos(env, canal, { claude = null, ahora = new Date() } = {}) {
  const db = env.DB;
  const iso = ahora.toISOString();
  const cfg = Object.fromEntries((await db.prepare('SELECT clave, valor FROM setter_config').all()).results.map((r) => [r.clave, r.valor]));
  if (cfg.kill_switch === '1') return { kill_switch: true };
  if (turnoDelEquipo(env, ahora)) return { horario_equipo: true };   // de día escribe el equipo
  const reglas = (await db.prepare('SELECT * FROM setter_seguimientos WHERE activo = 1 ORDER BY tras_horas').all()).results;
  if (!reglas.length) return { sin_reglas: true };
  const agentes = (await db.prepare('SELECT * FROM setter_agentes ORDER BY id').all()).results;
  const jefe = agentes.find((a) => a.rol === 'jefe' && a.activo);
  const agente = agentes.find((a) => a.clave === 'seguimiento' && a.activo) || jefe;
  if (!agente) return { sin_agente: true };
  if (horaEn(agente.zona_horaria, ahora) < HORA_DESDE || horaEn(agente.zona_horaria, ahora) >= HORA_HASTA) return { fuera_de_horario: true };

  const limite = new Date(ahora.getTime() - reglas[0].tras_horas * 3600e3).toISOString();
  const { results: candidatos } = await db.prepare(
    `SELECT c.* FROM wa_conversaciones c JOIN leads l ON l.id = c.lead_id
      WHERE c.espera_persona = 0 AND c.ultimo_in_en IS NOT NULL
        AND c.ultimo_out_en > c.ultimo_in_en AND c.ultimo_in_en <= ?
        AND (
          (c.ia_activa = 1 AND coalesce(l.ia_estado, 'frio') IN (${en(ABIERTOS)}))
          OR (c.ia_activa = 0 AND c.ia_pausa_motivo IN (${en(PAUSA_PERSONA)})
              AND EXISTS (SELECT 1 FROM wa_mensajes m WHERE m.conversacion_id = c.id AND m.autor IN (${en(AUTOR_PERSONA)}) AND m.creado_en > c.ultimo_in_en)
              AND coalesce(l.ia_estado, 'frio') NOT IN ('no_calificado', 'no_es_lead', 'sin_respuesta'))
        )
        AND NOT EXISTS (SELECT 1 FROM setter_eventos e WHERE e.conversacion_id = c.id AND e.tipo = 'seguimiento_omitido' AND e.creado_en > c.ultimo_in_en)
      ORDER BY c.ultimo_in_en LIMIT 30`
  ).bind(limite).all();

  const hechos = [];
  for (const conv of candidatos) {
    const { n } = await db.prepare(`SELECT count(*) n FROM wa_mensajes WHERE conversacion_id = ? AND es_followup = 1 AND creado_en > ?`).bind(conv.id, conv.ultimo_in_en).first();
    const regla = reglas[n];
    const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(conv.lead_id).first();
    if (!regla) {
      if (n > 0 && lead.ia_estado !== 'sin_respuesta') {
        await db.prepare(`UPDATE leads SET ia_estado = 'sin_respuesta', actualizado_en = ? WHERE id = ?`).bind(iso, lead.id).run();
        await evento(db, conv, 'estado', `${lead.ia_estado || 'frio'} → sin_respuesta (${n} follow-ups sin respuesta)`, iso);
        hechos.push({ conv: conv.id, resultado: 'sin_respuesta' });
      }
      continue;
    }
    const horas = (ahora.getTime() - Date.parse(conv.ultimo_in_en)) / 3600e3;
    if (horas < regla.tras_horas) continue;
    const ventana = conv.ventana_hasta && conv.ventana_hasta > iso;
    const intento = n + 1;
    try {
      if (regla.modo === 'plantilla') {
        if (!regla.plantilla) continue;
        await enviar(env, canal, { conversacionId: conv.id, plantilla: { nombre: regla.plantilla, idioma: 'es' }, autor: 'ia', agenteClave: agente.clave, esFollowup: true, intentoFollowup: intento }, iso);
        hechos.push({ conv: conv.id, resultado: `plantilla:${intento}` });
      } else {
        if (!ventana) continue;
        const mensajes = (await db.prepare(
          `SELECT * FROM (SELECT * FROM wa_mensajes WHERE conversacion_id = ? AND tipo <> 'nota' ORDER BY creado_en DESC, id DESC LIMIT 60) ORDER BY creado_en, id`
        ).bind(conv.id).all()).results;
        const [recursos, conocimiento] = await Promise.all([
          db.prepare('SELECT * FROM setter_recursos WHERE activo = 1 ORDER BY etiqueta').all().then((r) => r.results),
          db.prepare('SELECT * FROM setter_conocimiento WHERE activo = 1 ORDER BY titulo').all().then((r) => r.results),
        ]);
        const ctx = { db, conv, lead, agente, agentes, recursos, ahora: iso, salidas: [], estado: {} };
        const res = await correrAgentes({
          cliente: claude || clienteClaude(env), modelo: modeloDe(env, cfg), agente, agentes, recursos, conocimiento,
          conv, lead, mensajes, yaHabloIa: true, ctx, ejecutar, finde: modoFinde(env, iso, mensajes),
          promptDe: (a) => db.prepare(`SELECT * FROM setter_prompts WHERE agente_id = ? AND estado = 'publicado' ORDER BY version DESC LIMIT 1`).bind(a.id).first(),
          notaFinal: `[Nota del sistema, no la ve la persona: no responde hace ${Math.floor(horas)} h. Es el seguimiento ${intento} de ${reglas.length}.${conv.ia_activa ? '' : ' Lo último se lo escribió una persona del equipo (por ejemplo, le mandó la cotización).'} Si corresponde, escribe un único mensaje corto para retomar la charla; si no corresponde, responde solo ${NO_ESCRIBIR}.]`,
        });
        if (res.error) { await evento(db, conv, 'error_seguimiento', `${res.error}: ${res.detalle || ''}`, iso); continue; }
        const burbujas = (res.texto || '').includes(NO_ESCRIBIR) ? [] : partirBurbujas(res.texto, 2);
        if (!burbujas.length) {
          await evento(db, conv, 'seguimiento_omitido', `el agente decidió no escribir (seguimiento ${intento})`, iso);
          hechos.push({ conv: conv.id, resultado: 'omitido' });
          continue;
        }
        for (const b of burbujas) {
          await enviar(env, canal, { conversacionId: conv.id, texto: b, autor: 'ia', agenteClave: res.agente.clave, esFollowup: true, intentoFollowup: intento }, iso);
        }
        hechos.push({ conv: conv.id, resultado: `ia:${intento}` });
      }
      await db.prepare(`INSERT INTO setter_uso (mes, respuestas_ia) VALUES (?, 1) ON CONFLICT(mes) DO UPDATE SET respuestas_ia = respuestas_ia + 1`).bind(iso.slice(0, 7)).run();
    } catch (e) {
      await evento(db, conv, 'error_seguimiento', String(e.message || e).slice(0, 300), iso);
    }
  }
  return { candidatos: candidatos.length, hechos };
}
