// Aprendizaje del equipo: cada mañana (primera corrida del cron después de
// las 9, hora del equipo) lee lo que el equipo contestó por WhatsApp desde la
// corrida anterior y le pide a Claude lecciones reutilizables. Quedan en
// setter_sugerencias como "pendiente": la IA no las usa hasta que alguien
// las aprueba en Setter IA › Para aprobar.

import { clienteClaude, modeloDe } from './loop.js';

const ZONA = 'America/Argentina/Buenos_Aires';
const HORA = 9;
const MAX_CHATS = 40;
const MAX_CARACTERES = 60000;
const MAX_SUGERENCIAS = 10;

const ESQUEMA = {
  type: 'object',
  properties: {
    sugerencias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['respuesta', 'tono'] },
          conversacion_id: { type: 'integer' },
          pregunta: { type: 'string', description: 'Lo que preguntó el cliente, textual o resumido en una línea.' },
          respuesta_equipo: { type: 'string', description: 'Lo que contestó el equipo, textual.' },
          titulo: { type: 'string', description: 'Título corto de la lección (hasta 60 caracteres).' },
          contenido: { type: 'string', description: 'La lección lista para la IA, con el formato pedido.' },
        },
        required: ['tipo', 'conversacion_id', 'pregunta', 'respuesta_equipo', 'titulo', 'contenido'],
        additionalProperties: false,
      },
    },
  },
  required: ['sugerencias'],
  additionalProperties: false,
};

const SISTEMA = `Ayudas a que el asistente de WhatsApp de una agencia de viajes en Perú (Luna Llena Travel) aprenda del equipo humano.
Te paso chats donde el equipo contestó a clientes. Propón lecciones que sirvan para contestar a OTROS clientes:
- tipo "respuesta": algo general que el equipo explicó (cómo se reserva, formas de pago, qué incluye o no un tour, requisitos, políticas, horarios, cómo trabajan). Formato del contenido, en dos líneas:
Si preguntan algo como: «…»
Responde: «…»
  La respuesta usa las palabras del equipo, sin datos de ese cliente.
- tipo "tono": una forma de escribir del equipo que vale la pena imitar (cómo saludan, cómo responden a "está caro", cómo cierran). Formato: Cuando <situación>, el equipo escribe así: «…»
No propongas:
- datos de un solo caso: precios cotizados para ese cliente, fechas, cantidad de personas, nombres, teléfonos, links de pago;
- saludos genéricos o mensajes de una palabra;
- lo que ya está en la base de conocimiento o en las sugerencias pendientes que te paso.
Si dos chats enseñan lo mismo, propón una sola lección. Máximo ${MAX_SUGERENCIAS}. Si no hay nada que valga la pena, devuelve la lista vacía.`;

const AUTOR = { lead: 'Cliente', ia: 'IA', asesora_app: 'Equipo', asesora_web: 'Equipo' };

function horaYFecha(ahora) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(ahora).map((x) => [x.type, x.value]));
  return { hora: Number(p.hour), fecha: `${p.year}-${p.month}-${p.day}` };
}

async function config(db) {
  return Object.fromEntries((await db.prepare(`SELECT clave, valor FROM setter_config WHERE clave IN ('kill_switch', 'modelo_respuesta', 'aprendizaje_fecha', 'aprendizaje_hasta')`).all()).results.map((r) => [r.clave, r.valor]));
}
const guardar = (db, clave, valor, iso) => db.prepare('INSERT INTO setter_config (clave, valor, actualizado_en) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en').bind(clave, valor, iso);

// Lo corre el cron cada 15 min: trabaja una vez por día, desde las 9.
export async function aprenderSiToca(env, opciones = {}) {
  const ahora = opciones.ahora || new Date();
  const { hora, fecha } = horaYFecha(ahora);
  if (hora < HORA) return { espera: true };
  const cfg = await config(env.DB);
  if (cfg.aprendizaje_fecha === fecha) return { ya_corrio: true };
  return aprenderDelEquipo(env, { ...opciones, ahora });
}

// También se puede correr a mano (botón "Revisar ahora" del panel).
export async function aprenderDelEquipo(env, { claude = null, ahora = new Date() } = {}) {
  const db = env.DB, iso = ahora.toISOString();
  const cfg = await config(db);
  const desde = cfg.aprendizaje_hasta || new Date(ahora.getTime() - 864e5).toISOString();
  const marcar = () => db.batch([guardar(db, 'aprendizaje_hasta', iso, iso), guardar(db, 'aprendizaje_fecha', horaYFecha(ahora).fecha, iso)]);

  const { results: chats } = await db.prepare(
    `SELECT conversacion_id, max(creado_en) AS ultimo FROM wa_mensajes
      WHERE autor IN ('asesora_app', 'asesora_web') AND tipo = 'text' AND creado_en > ? AND creado_en <= ?
      GROUP BY conversacion_id ORDER BY ultimo DESC LIMIT ${MAX_CHATS}`
  ).bind(desde, iso).all();
  if (!chats.length) { await marcar(); return { chats: 0, sugerencias: 0 }; }

  const bloques = [];
  let largo = 0;
  for (const c of chats) {
    const texto = await textoDelChat(db, c.conversacion_id, iso, 30, desde);
    if (largo + texto.length > MAX_CARACTERES) break;
    largo += texto.length;
    bloques.push(`<chat id="${c.conversacion_id}">\n${texto}\n</chat>`);
  }
  const r = await proponer(env, { cfg, claude, iso, chatIds: chats.map((c) => c.conversacion_id), bloques,
    pedido: 'Chats (los mensajes del equipo marcados "(nuevo)" son los de este período; el resto es contexto):' });
  await marcar();
  return r;
}

// "Aprender de este chat" del Inbox: alguien del equipo marca un chat (y
// opcionalmente dice qué aprender). Lee el chat entero, sin mirar fechas, y
// deja las sugerencias en Para aprobar como la revisión diaria.
export async function aprenderDeChat(env, { conversacion_id, nota = '' }, { claude = null, ahora = new Date() } = {}) {
  const db = env.DB, iso = ahora.toISOString();
  const conv = await db.prepare('SELECT id FROM wa_conversaciones WHERE id = ?').bind(conversacion_id ?? 0).first();
  if (!conv) return { error: 'no existe el chat' };
  const texto = await textoDelChat(db, conv.id, iso, 80);
  if (!texto) return { error: 'el chat no tiene mensajes' };
  nota = String(nota || '').trim().slice(0, 500);
  return proponer(env, {
    cfg: await config(db), claude, iso, chatIds: [conv.id], bloques: [`<chat id="${conv.id}">\n${texto}\n</chat>`],
    pedido: `El equipo marcó este chat para que aprendas de él${nota ? `. Lo que quiere que aprendas: «${nota}». Enfócate en eso; si no hay nada que lo enseñe, devuelve la lista vacía` : ': propón lo que valga la pena de lo que contestó el equipo'}.\n\nChat:`,
  });
}

async function textoDelChat(db, convId, hasta, max, desde = null) {
  const msgs = (await db.prepare(
    `SELECT * FROM (SELECT autor, tipo, texto, transcripcion, creado_en FROM wa_mensajes WHERE conversacion_id = ? AND creado_en <= ? AND tipo <> 'nota' ORDER BY creado_en DESC LIMIT ${max}) ORDER BY creado_en`
  ).bind(convId, hasta).all()).results;
  return msgs.map((m) => {
    const t = m.tipo === 'audio' ? '[nota de voz] ' + (m.transcripcion || '') : (m.texto || `[${m.tipo}]`);
    const nuevo = desde && AUTOR[m.autor] === 'Equipo' && m.creado_en > desde ? ' (nuevo)' : '';
    return `${AUTOR[m.autor] || m.autor}${nuevo}: ${t}`;
  }).join('\n');
}

// Pide las lecciones a Claude y las guarda como pendientes.
async function proponer(env, { cfg, claude, iso, chatIds, bloques, pedido }) {
  const db = env.DB;
  const [base, pendientes] = await Promise.all([
    db.prepare('SELECT titulo, contenido, tags FROM setter_conocimiento WHERE activo = 1').all().then((r) => r.results),
    db.prepare(`SELECT titulo FROM setter_sugerencias WHERE estado = 'pendiente'`).all().then((r) => r.results),
  ]);
  // El catálogo es largo y no se repite con lo que enseña el equipo: va solo el título.
  const yaSabe = base.map((k) => (String(k.tags || '').includes('leccion') ? `- ${k.titulo}: ${k.contenido.replace(/\s+/g, ' ').slice(0, 300)}` : `- ${k.titulo}`)).join('\n');

  const r = await (claude || clienteClaude(env)).messages.create({
    model: modeloDe(env, cfg),
    max_tokens: 6000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
    system: SISTEMA,
    messages: [{
      role: 'user',
      content: `Base de conocimiento actual:\n${yaSabe || '- (vacía)'}\n\nSugerencias pendientes de aprobar:\n${pendientes.map((p) => '- ' + p.titulo).join('\n') || '- (ninguna)'}\n\n${pedido}\n\n${bloques.join('\n\n')}`,
    }],
  });
  if (r.stop_reason === 'refusal') return { chats: bloques.length, sugerencias: 0, rechazo: true };
  const d = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));

  const ids = new Set(chatIds);
  const convDe = (s) => (ids.has(s.conversacion_id) ? s.conversacion_id : chatIds.length === 1 ? chatIds[0] : null);
  const validas = d.sugerencias.filter((s) => s.titulo.trim() && s.contenido.trim()).slice(0, MAX_SUGERENCIAS);
  const leads = new Map();
  for (const s of validas) {
    const conv = convDe(s);
    if (conv && !leads.has(conv)) leads.set(conv, (await db.prepare('SELECT lead_id FROM wa_conversaciones WHERE id = ?').bind(conv).first())?.lead_id ?? null);
  }
  await db.batch([
    ...validas.map((s) => {
      const conv = convDe(s);
      return db.prepare(
        `INSERT INTO setter_sugerencias (tipo, titulo, contenido, pregunta, respuesta_equipo, conversacion_id, lead_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(s.tipo, s.titulo.slice(0, 120), s.contenido.slice(0, 2000), s.pregunta.slice(0, 1000), s.respuesta_equipo.slice(0, 2000), conv, conv ? leads.get(conv) : null, iso);
    }),
    db.prepare('INSERT INTO setter_eventos (conversacion_id, tipo, detalle, creado_en) VALUES (?, ?, ?, ?)')
      .bind(chatIds.length === 1 ? chatIds[0] : null, 'aprendizaje', `${bloques.length} chats leídos, ${validas.length} sugerencias`, iso),
  ]);
  return { chats: bloques.length, sugerencias: validas.length };
}
