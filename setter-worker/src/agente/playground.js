// Playground, puntuación y asistente del editor de prompts (sección Setter IA).
// Usan el mismo loop que el turno real, pero no tocan D1: el lead es de
// mentira y las herramientas solo se anotan.

import { CAMPOS_LEAD, IA_ESTADOS, modoFinde } from './contexto.js';
import { correrAgentes, clienteClaude, modeloDe } from './loop.js';
import { partirBurbujas } from './turno.js';

import { MODELO_ANALISIS } from './analisis.js';

const ORIGENES = ['directo', 'web_ref', 'anuncio', 'instagram'];

async function cargar(db) {
  const [agentes, recursos, conocimiento, cfgFilas] = await Promise.all([
    db.prepare('SELECT * FROM setter_agentes ORDER BY id').all().then((r) => r.results),
    db.prepare('SELECT * FROM setter_recursos WHERE activo = 1 ORDER BY etiqueta').all().then((r) => r.results),
    db.prepare('SELECT * FROM setter_conocimiento WHERE activo = 1 ORDER BY titulo').all().then((r) => r.results),
    db.prepare('SELECT clave, valor FROM setter_config').all().then((r) => r.results),
  ]);
  return { agentes, recursos, conocimiento, cfg: Object.fromEntries(cfgFilas.map((r) => [r.clave, r.valor])) };
}

// Herramientas de mentira: cambian el lead en memoria y quedan anotadas.
async function ejecutarSimulado(ctx, nombre, input) {
  ctx.acciones.push({ agente: ctx.agente.clave, herramienta: nombre, input });
  const L = ctx.lead;
  switch (nombre) {
    case 'completar_lead':
      for (const [k, v] of Object.entries(input || {})) if (k in CAMPOS_LEAD && (L[k] === null || L[k] === undefined || L[k] === '')) L[k] = v;
      return { texto: 'Guardado.' };
    case 'cambiar_estado':
      if (IA_ESTADOS.includes(input.ia_estado)) L.ia_estado = input.ia_estado;
      return { texto: `Estado: ${input.ia_estado}.` };
    case 'calificar':
      L.calificado = L.calificado || input.calificacion; L.score = L.score || input.score;
      L.ia_calificacion = { si: 'interesado', masomenos: 'interesado', curioso: 'curioso' }[input.calificacion] || L.ia_calificacion;
      return { texto: `Calificado como ${input.calificacion}.` };
    case 'enviar_recurso': {
      const r = ctx.recursos.find((x) => x.etiqueta === String(input.etiqueta || '').replace(/^@/, ''));
      if (!r) return { texto: `No existe el recurso "${input.etiqueta}".`, error: true };
      ctx.salidas.push(r.etiqueta);
      return { texto: `Se manda @${r.etiqueta} después de tu mensaje.` };
    }
    case 'traspasar': {
      const d = ctx.agentes.find((a) => a.clave === input.clave && a.activo && a.rol === 'especialista');
      if (!d) return { texto: `No hay un especialista activo con la clave "${input.clave}".`, error: true };
      ctx.estado.traspasoA = d.clave;
      return { texto: `Traspasado a ${d.clave}. No escribas nada más.` };
    }
    case 'devolver': {
      const jefe = ctx.agentes.find((a) => a.rol === 'jefe' && a.activo);
      if (jefe) ctx.estado.traspasoA = jefe.clave;
      return { texto: 'Devuelto al agente principal. No escribas nada más.' };
    }
    case 'derivar_a_asesora':
      L.ia_estado = 'derivado';
      return { texto: 'Derivado. Despídete como indica tu prompt.' };
    case 'consultar_al_equipo':
      return { texto: 'Avisado al equipo. Dile que lo consultas y le confirmas; no adivines la respuesta.' };
    case 'descartar':
      L.ia_estado = input.tipo;
      return { texto: 'Descartado.' };
    default:
      return { texto: 'Hecho.' };
  }
}

// pedido: { agente_id, texto_prompt?, agente_activo?, origen, mensajes: [{ direccion: 'in'|'out', texto }], lead? }
export async function playground(env, pedido, { claude = null } = {}) {
  const { agentes, recursos, conocimiento, cfg } = await cargar(env.DB);
  const base = agentes.find((a) => a.id === Number(pedido.agente_id));
  if (!base) return { error: 'no existe el agente' };
  // En el playground el agente que se prueba cuenta como activo aunque todavía no lo esté.
  const lista = agentes.map((a) => (a.id === base.id ? { ...a, activo: 1 } : a));
  const inicio = lista.find((a) => a.clave === pedido.agente_activo) || lista.find((a) => a.id === base.id);
  const origen = ORIGENES.includes(pedido.origen) ? pedido.origen : 'directo';
  const lead = { id: 0, nombre: 'Lead de prueba', ia_origen: origen, codigo_web: origen === 'web_ref' ? 'LL-000000' : null, ia_estado: 'frio', ...(pedido.lead || {}) };
  const ahora = new Date();
  const conv = { id: 0, ventana_hasta: new Date(ahora.getTime() + 864e5).toISOString(), agente_activo: inicio.clave };
  const mensajes = (pedido.mensajes || []).slice(-40).map((m) => ({
    direccion: m.direccion === 'out' ? 'out' : 'in', autor: m.direccion === 'out' ? 'ia' : 'lead', tipo: 'text', texto: String(m.texto || '').slice(0, 4000),
  }));
  if (!mensajes.length || mensajes[mensajes.length - 1].direccion !== 'in') return { error: 'falta el mensaje del lead' };
  const ctx = { lead, agentes: lista, recursos, salidas: [], acciones: [], estado: {} };
  const res = await correrAgentes({
    cliente: claude || clienteClaude(env), modelo: modeloDe(env, cfg), agente: inicio, agentes: lista, recursos, conocimiento,
    conv, lead, mensajes, yaHabloIa: mensajes.some((m) => m.direccion === 'out'), ctx,
    // pedido.finde fuerza el modo fuera de horario para probarlo cualquier día ('noche' = hasta mañana).
    finde: pedido.finde ? { marca: env.SETTER_FINDE_MARCA || 'la agencia', nombre: env.SETTER_FINDE_NOMBRE || '', hasta: pedido.finde === 'noche' ? 'mañana' : 'lunes', yaPresentada: mensajes.some((m) => m.direccion === 'out') }
      : modoFinde(env, ahora, []),
    ejecutar: ejecutarSimulado,
    promptDe: async (a) => (a.id === base.id && pedido.texto_prompt ? { texto: pedido.texto_prompt }
      : env.DB.prepare(`SELECT * FROM setter_prompts WHERE agente_id = ? AND estado = 'publicado' ORDER BY version DESC LIMIT 1`).bind(a.id).first()),
  });
  return {
    error: res.error || null, detalle: res.detalle || null,
    burbujas: partirBurbujas(res.texto), recursos: ctx.salidas, acciones: ctx.acciones,
    agente_activo: res.agente?.clave || inicio.clave, lead,
  };
}

function jsonDe(r) {
  const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(t);
}

const ESQUEMA_PUNTUACION = {
  type: 'object',
  properties: {
    nota: { type: 'integer', description: 'De 1 a 10.' },
    resumen: { type: 'string' },
    faltantes: { type: 'array', items: { type: 'string' } },
  },
  required: ['nota', 'resumen', 'faltantes'],
  additionalProperties: false,
};

// Nota del prompt de un setter de WhatsApp de una agencia de viajes, y qué le falta.
export async function puntuar(env, { texto, rol = 'jefe' }, { claude = null } = {}) {
  if (!String(texto || '').trim()) return { error: 'prompt vacío' };
  const { recursos } = await cargar(env.DB);
  const r = await (claude || clienteClaude(env)).messages.create({
    model: MODELO_ANALISIS,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_PUNTUACION } },
    system: 'Evalúas prompts de agentes de IA que atienden el WhatsApp de una agencia de viajes y califican leads. Sé concreto y breve. Responde en español.',
    messages: [{
      role: 'user',
      content: `Rol del agente: ${rol === 'jefe' ? 'agente principal' : 'especialista'}.\nRecursos disponibles: ${recursos.map((x) => '@' + x.etiqueta).join(', ') || 'ninguno'}.\n\nPuntúa este prompt de 1 a 10 y lista lo que le falta (máximo 6 puntos, cada uno una frase accionable): objetivo claro, tono, qué preguntar y en qué orden, cuándo calificar / derivar / mandar recursos, manejo de objeciones ("lo voy a pensar", precio), qué no decir.\n\n<prompt>\n${texto}\n</prompt>`,
    }],
  });
  if (r.stop_reason === 'refusal') return { error: 'el modelo no quiso evaluarlo' };
  const d = jsonDe(r);
  return { nota: Math.max(1, Math.min(10, d.nota | 0)), resumen: d.resumen, faltantes: d.faltantes.slice(0, 8) };
}

const ESQUEMA_ASISTENTE = {
  type: 'object',
  properties: {
    respuesta: { type: 'string', description: 'Lo que le contestas a quien edita el prompt.' },
    prompt_nuevo: { type: 'string', description: 'El prompt completo con tus cambios, o "" si no propones cambios.' },
    mensaje_prueba: { type: 'string', description: 'Un mensaje realista de un lead para probar el cambio, o "".' },
  },
  required: ['respuesta', 'prompt_nuevo', 'mensaje_prueba'],
  additionalProperties: false,
};

// Asistente del editor: lee el prompt, propone una versión nueva y la prueba
// en el playground antes de contestar. Nada se guarda: queda en el editor.
export async function asistente(env, { agente_id, texto_prompt, chat = [] }, { claude = null } = {}) {
  const { cfg } = await cargar(env.DB);
  const cliente = claude || clienteClaude(env);
  const historialChat = chat.slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));
  if (!historialChat.length || historialChat[historialChat.length - 1].role !== 'user') return { error: 'falta tu pedido' };
  const r = await cliente.messages.create({
    model: cfg.modelo_asistente || modeloDe(env, cfg),
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_ASISTENTE } },
    system: `Ayudas a editar el prompt de un agente de IA que atiende el WhatsApp de una agencia de viajes (Luna Llena Travel, Cusco). Cuando te pidan un cambio, devuelve el prompt completo en prompt_nuevo, cambiando solo lo necesario, y un mensaje_prueba de un lead que ejercite ese cambio. Si solo te preguntan algo, deja prompt_nuevo vacío. Responde en español, breve.\n\nPrompt actual:\n<prompt>\n${texto_prompt || ''}\n</prompt>`,
    messages: historialChat,
  });
  if (r.stop_reason === 'refusal') return { error: 'el modelo no quiso responder' };
  const d = jsonDe(r);
  const salida = { respuesta: d.respuesta, prompt_nuevo: d.prompt_nuevo || null, prueba: null };
  if (d.prompt_nuevo && d.mensaje_prueba) {
    const p = await playground(env, { agente_id, texto_prompt: d.prompt_nuevo, mensajes: [{ direccion: 'in', texto: d.mensaje_prueba }] }, { claude: cliente });
    salida.prueba = { mensaje: d.mensaje_prueba, burbujas: p.burbujas || [], acciones: p.acciones || [], error: p.error };
  }
  return salida;
}
