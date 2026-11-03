// Turno del agente con Claude simulado: cada test arma la secuencia de
// respuestas que daría la API y revisa lo que quedó en D1 y lo que salió
// por WhatsApp.
import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { correrTurno, partirBurbujas } from '../src/agente/turno.js';
import { demoraMs } from '../src/agente/demora.js';
import { historial, finDeSemana } from '../src/agente/contexto.js';
import { canalDe } from '../src/canal/adapter.js';
import { prepararDb, webhookFirmado, payloadMensaje } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const todos = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;

let enviadosMeta;
let anthropicFalso = null;   // (url, init) => Response, para los tests que usan el SDK de verdad
beforeEach(async () => {
  anthropicFalso = null;
  await prepararDb();
  await env.DB.prepare('DELETE FROM setter_uso').run();
  await env.DB.prepare(`UPDATE setter_config SET valor = '0' WHERE clave = 'kill_switch'`).run();
  enviadosMeta = [];
  const original = globalThis.fetch;
  let n = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('https://lookaside.fbsbx.com/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/ogg' } });
    if (String(url).startsWith('https://graph.facebook.com/')) {
      if (!init?.body) return Response.json({ url: 'https://lookaside.fbsbx.com/audio/1' });   // GET de un media id
      const body = JSON.parse(init.body);
      if (body.status === 'read') return Response.json({ success: true });
      enviadosMeta.push(body);
      return Response.json({ messages: [{ id: 'wamid.OUT' + ++n }] });
    }
    if (anthropicFalso && String(url).startsWith('https://api.anthropic.com/')) return anthropicFalso(url, init);
    return original(url, init);
  });
});
afterEach(() => vi.restoreAllMocks());

// Claude falso: devuelve las respuestas en orden y guarda lo que recibió.
function claudeFalso(respuestas) {
  const pedidos = [];
  return {
    pedidos,
    beta: { messages: { create: async (p) => { pedidos.push(structuredClone(p)); const r = respuestas.shift(); if (!r) throw new Error('sin respuestas'); return r; } } },
  };
}
let idTool = 0;
const usar = (name, input) => ({ type: 'tool_use', id: 'tu_' + ++idTool, name, input });
const resp = (...content) => ({ content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const texto = (t) => ({ type: 'text', text: t });

async function chatConLead(textoLead = 'Hola! Quiero ir a Machu Picchu') {
  await webhookFirmado(exports.default, payloadMensaje({ texto: textoLead, id: 'wamid.L' + Math.random() }));
  return uno('SELECT * FROM wa_conversaciones');
}
const correr = (conv, claude) => correrTurno(env, canalDe(env), conv.id, { claude, dormir: async () => {} });

describe('conversación completa', () => {
  it('jefe saluda con aviso de IA, traspasa a calificacion, que llena el checklist, califica, manda el cotizador y deriva', async () => {
    const conv = await chatConLead('Hola! Somos 2 y queremos ir a Machu Picchu en marzo, vivimos en Madrid');
    const claude = claudeFalso([
      resp(usar('traspasar', { clave: 'calificacion', motivo: 'quiere un viaje' })),
      resp(
        usar('completar_lead', { destinos: 'Machu Picchu', personas: 2, fecha_viaje: 'marzo', residencia: 'Madrid' }),
        usar('calificar', { calificacion: 'si', score: 8, motivo: 'fecha y grupo claros' }),
        usar('enviar_recurso', { etiqueta: 'cotizador' }),
        usar('derivar_a_asesora', { motivo: 'calificado', resumen: 'Pareja desde Madrid, Machu Picchu en marzo.' }),
      ),
      resp(texto('¡Hola! Soy el asistente virtual con IA de Luna Llena Travel 🌙\n\nQué lindo plan. Te paso el cotizador y una asesora te escribe en breve.')),
    ]);

    const r = await correr(conv, claude);
    expect(r).toBe('respondio:calificacion:3');

    // El jefe recibió el aviso obligatorio; calificacion, la herramienta de devolver.
    expect(claude.pedidos[0].system[1].text).toContain('asistente virtual con IA de Luna Llena Travel');
    expect(claude.pedidos[0].tools.map((t) => t.name)).toContain('traspasar');
    expect(claude.pedidos[1].tools.map((t) => t.name)).toContain('devolver');
    expect(claude.pedidos[1].system[0].text).toContain('Tu misión: calificar el viaje');
    expect(claude.pedidos[0]).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'adaptive' }, output_config: { effort: 'low' } });
    expect(claude.pedidos[0].fallbacks).toBeUndefined();   // Haiku no tiene fallback por rechazo
    // El turno del asistente con las herramientas vuelve tal cual, y los 4 resultados en un solo mensaje.
    const ultimo = claude.pedidos[2].messages;
    expect(ultimo.at(-1).content).toHaveLength(4);

    const lead = await uno('SELECT * FROM leads');
    expect(lead).toMatchObject({ destinos: 'Machu Picchu', personas: 2, fecha_viaje: 'marzo', residencia: 'Madrid', calificado: 'si', score: 8, ia_estado: 'derivado', etapa: 'contactado' });
    expect(lead.ia_resumen).toContain('Pareja desde Madrid');
    // Derivado: espera a una persona, pero la IA lee una respuesta más.
    expect(await uno('SELECT ia_activa, ia_pausa_motivo, espera_persona, agente_activo FROM wa_conversaciones'))
      .toEqual({ ia_activa: 1, ia_pausa_motivo: null, espera_persona: 1, agente_activo: 'calificacion' });
    expect(lead).toMatchObject({ ia_calificacion: 'interesado', ia_calificacion_por: 'ia' });

    // Dos burbujas de texto y después el link.
    expect(enviadosMeta.map((m) => m.text?.body)).toEqual([
      '¡Hola! Soy el asistente virtual con IA de Luna Llena Travel 🌙',
      'Qué lindo plan. Te paso el cotizador y una asesora te escribe en breve.',
      'https://lunallenatravel.vercel.app/cotizar/',
    ]);
    const salientes = await todos(`SELECT autor, agente_clave, recurso_id FROM wa_mensajes WHERE direccion = 'out' ORDER BY id`);
    expect(salientes.every((m) => m.autor === 'ia' && m.agente_clave === 'calificacion')).toBe(true);
    expect(salientes[2].recurso_id).toBeTruthy();
    expect(await uno('SELECT respuestas_ia FROM setter_uso')).toEqual({ respuestas_ia: 1 });
    expect((await todos(`SELECT tipo FROM setter_eventos ORDER BY id`)).map((e) => e.tipo))
      .toEqual(expect.arrayContaining(['traspaso', 'calificacion', 'estado', 'derivacion']));
  });

  it('un lead con "ref LL-…" lo atiende reserva_web desde el primer mensaje', async () => {
    const conv = await chatConLead('Hola! Me interesa el paquete Cusco 5 días (ref LL-111222)');
    const claude = claudeFalso([resp(texto('¡Hola! Soy el asistente virtual con IA de Luna Llena Travel. ¿Para qué fechas lo estás pensando?'))]);
    expect(await correr(conv, claude)).toBe('respondio:reserva_web:1');
    expect(claude.pedidos[0].system[0].text).toContain('Ya vio un paquete');
    expect(await uno('SELECT agente_activo FROM wa_conversaciones')).toEqual({ agente_activo: 'reserva_web' });
  });

  it('si la respuesta no dice que es una IA, antepone el aviso', async () => {
    const conv = await chatConLead();
    const claude = claudeFalso([resp(texto('¡Hola! ¿En qué te ayudo?'))]);
    await correr(conv, claude);
    expect(enviadosMeta.map((m) => m.text.body)).toEqual(['Hola, soy el asistente virtual con IA de Luna Llena Travel.', '¡Hola! ¿En qué te ayudo?']);
  });
});

describe('notas de voz', () => {
  it('transcribe el audio con Whisper y Claude responde al texto', async () => {
    const p = payloadMensaje();
    const m = p.entry[0].changes[0].value.messages[0];
    delete m.text;
    Object.assign(m, { type: 'audio', audio: { id: 'AUDIO1', mime_type: 'audio/ogg; codecs=opus', voice: true } });
    await webhookFirmado(exports.default, p);
    const conv = await uno('SELECT * FROM wa_conversaciones');
    const whisper = vi.fn(async () => ({ text: 'Hola, quiero ir a Cusco en julio' }));
    const claude = claudeFalso([resp(texto('Soy el asistente virtual con IA de Luna Llena Travel. ¡Cusco en julio es precioso!'))]);
    const r = await correrTurno({ ...env, AI: { run: whisper } }, canalDe(env), conv.id, { claude, dormir: async () => {} });
    expect(r).toBe('respondio:luna:1');
    expect(whisper).toHaveBeenCalledOnce();
    expect(await uno(`SELECT transcripcion FROM wa_mensajes WHERE tipo = 'audio'`)).toEqual({ transcripcion: 'Hola, quiero ir a Cusco en julio' });
    expect(claude.pedidos[0].messages.at(-1).content).toBe('[nota de voz] Hola, quiero ir a Cusco en julio');
  });
});

describe('no pisar datos', () => {
  it('completar_lead solo llena vacíos y anota las diferencias', async () => {
    const conv = await chatConLead();
    await env.DB.prepare(`UPDATE leads SET destinos = 'Cusco', personas = 4 WHERE id = ?`).bind(conv.lead_id).run();
    const claude = claudeFalso([
      resp(usar('completar_lead', { destinos: 'Machu Picchu', personas: 4, fecha_viaje: 'abril', nombre: 'Ana' })),
      resp(texto('Soy el asistente virtual con IA de Luna Llena Travel. ¡Genial!')),
    ]);
    await correr(conv, claude);
    const lead = await uno('SELECT nombre, destinos, personas, fecha_viaje, ia_resumen FROM leads');
    expect(lead).toMatchObject({ destinos: 'Cusco', personas: 4, fecha_viaje: 'abril', nombre: 'Ana' });
    expect(lead.ia_resumen).toContain('destinos: el lead dijo "Machu Picchu" (en la ficha: "Cusco")');
    expect(lead.ia_resumen).not.toContain('personas');
  });

  it('calificar no pisa la calificación ni el score cargados', async () => {
    const conv = await chatConLead();
    await env.DB.prepare(`UPDATE leads SET calificado = 'masomenos', score = 5 WHERE id = ?`).bind(conv.lead_id).run();
    const claude = claudeFalso([
      resp(usar('calificar', { calificacion: 'si', score: 9, motivo: 'x' })),
      resp(texto('Soy el asistente virtual con IA de Luna Llena Travel.')),
    ]);
    await correr(conv, claude);
    expect(await uno('SELECT calificado, score, ia_score_motivo FROM leads')).toEqual({ calificado: 'masomenos', score: 5, ia_score_motivo: 'x' });
  });

  it('el nombre provisorio (+51…) sí se reemplaza', async () => {
    await webhookFirmado(exports.default, (() => { const p = payloadMensaje(); delete p.entry[0].changes[0].value.contacts; return p; })());
    const conv = await uno('SELECT * FROM wa_conversaciones');
    expect((await uno('SELECT nombre FROM leads')).nombre).toBe('+51930299443');
    await correr(conv, claudeFalso([resp(usar('completar_lead', { nombre: 'Rosa' })), resp(texto('Gracias Rosa, soy el asistente virtual con IA de Luna Llena Travel.'))]));
    expect((await uno('SELECT nombre FROM leads')).nombre).toBe('Rosa');
  });
});

describe('guardas', () => {
  it('con la IA pausada no responde ni llama a Claude', async () => {
    const conv = await chatConLead();
    await env.DB.prepare('UPDATE wa_conversaciones SET ia_activa = 0 WHERE id = ?').bind(conv.id).run();
    const claude = claudeFalso([]);
    expect(await correr(conv, claude)).toBe('pausada');
    expect(claude.pedidos).toHaveLength(0);
  });

  it('kill switch', async () => {
    const conv = await chatConLead();
    await env.DB.prepare(`UPDATE setter_config SET valor = '1' WHERE clave = 'kill_switch'`).run();
    expect(await correr(conv, claudeFalso([]))).toBe('kill_switch');
  });

  it('nunca escribe dos veces seguidas sin que el lead haya escrito', async () => {
    const conv = await chatConLead();
    await correr(conv, claudeFalso([resp(texto('Soy el asistente virtual con IA de Luna Llena Travel. ¡Hola!'))]));
    const claude = claudeFalso([resp(texto('¿Sigues ahí?'))]);
    expect(await correr(conv, claude)).toBe('nada_que_responder');
    expect(claude.pedidos).toHaveLength(0);
  });

  it('si el lead escribe mientras Claude piensa, descarta la respuesta', async () => {
    const conv = await chatConLead();
    const claude = {
      beta: { messages: { create: async () => {
        await webhookFirmado(exports.default, payloadMensaje({ id: 'wamid.MIENTRAS', texto: 'y otra cosa' }));
        return resp(texto('Soy el asistente virtual con IA de Luna Llena Travel.'));
      } } },
    };
    expect(await correr(conv, claude)).toBe('descartado_mensaje_nuevo');
    expect(enviadosMeta).toHaveLength(0);
  });

  it('si una asesora toma el chat mientras Claude piensa, no manda nada', async () => {
    const conv = await chatConLead();
    const claude = {
      beta: { messages: { create: async () => {
        await env.DB.prepare(`UPDATE wa_conversaciones SET ia_activa = 0, ia_pausa_motivo = 'manual' WHERE id = ?`).bind(conv.id).run();
        return resp(texto('Soy el asistente virtual con IA de Luna Llena Travel.'));
      } } },
    };
    expect(await correr(conv, claude)).toBe('descartado_pausa');
    expect(enviadosMeta).toHaveLength(0);
  });

  it('al llegar al tope mensual no responde y el chat pasa a esperar a una persona', async () => {
    const conv = await chatConLead();
    await env.DB.prepare(`INSERT INTO setter_uso (mes, respuestas_ia, tope) VALUES (?, 5, 5)`).bind(new Date().toISOString().slice(0, 7)).run();
    expect(await correr(conv, claudeFalso([]))).toBe('tope');
    expect(await uno('SELECT espera_persona FROM wa_conversaciones')).toEqual({ espera_persona: 1 });
  });

  it('un rechazo del modelo no manda nada y pide una persona', async () => {
    const conv = await chatConLead();
    expect(await correr(conv, claudeFalso([{ content: [], stop_reason: 'refusal', stop_details: { category: 'general_harms' } }]))).toBe('rechazo');
    expect(enviadosMeta).toHaveLength(0);
    expect(await uno('SELECT espera_persona FROM wa_conversaciones')).toEqual({ espera_persona: 1 });
  });

  it('corta los traspasos en bucle: el tercer agente ya no puede traspasar', async () => {
    const conv = await chatConLead();
    const claude = claudeFalso([
      resp(usar('traspasar', { clave: 'calificacion', motivo: 'a' })),
      resp(usar('devolver', { motivo: 'b' })),
      resp(texto('Soy el asistente virtual con IA de Luna Llena Travel. ¿Te ayudo con tu viaje?')),
    ]);
    expect(await correr(conv, claude)).toBe('respondio:luna:1');
    expect(claude.pedidos[2].tools.map((t) => t.name)).not.toContain('traspasar');
  });
});

describe('Durable Object de punta a punta', () => {
  it('webhook → demora → alarma → Claude (SDK real contra fetch simulado) → WhatsApp', async () => {
    const pedidosClaude = [];
    anthropicFalso = (url, init) => {
      pedidosClaude.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
      return Response.json({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [texto('¡Hola! Soy el asistente virtual con IA de Luna Llena Travel. ¿Qué viaje estás pensando?')], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
    };
    await env.DB.prepare(`UPDATE setter_config SET valor = 'claude-sonnet-5-5' WHERE clave = 'modelo_respuesta'`).run();
    await webhookFirmado(exports.default, payloadMensaje({ texto: 'Hola' }));
    const stub = env.CONVERSACION.get(env.CONVERSACION.idFromName('51930299443'));
    const alarma = await runInDurableObject(stub, (_, state) => state.storage.getAlarm());
    expect(alarma - Date.now()).toBeGreaterThan(30000);   // primer mensaje: demora humana larga
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await uno(`SELECT detalle FROM setter_eventos WHERE tipo = 'turno'`)).toEqual({ detalle: 'respondio:luna:1' });
    expect(pedidosClaude).toHaveLength(1);
    expect(pedidosClaude[0].url).toContain('/v1/messages');
    expect(pedidosClaude[0].headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    expect(pedidosClaude[0].headers.authorization).toBe('Bearer sk-ant-test');
    expect(enviadosMeta.map((m) => m.text?.body)).toEqual(['¡Hola! Soy el asistente virtual con IA de Luna Llena Travel. ¿Qué viaje estás pensando?']);
    expect(await uno(`SELECT detalle FROM setter_eventos WHERE tipo = 'turno'`)).toEqual({ detalle: 'respondio:luna:1' });
  });
});

describe('piezas sueltas', () => {
  it('parte la respuesta en hasta 3 burbujas', () => {
    expect(partirBurbujas('a\n\nb')).toEqual(['a', 'b']);
    expect(partirBurbujas('a\n\nb\n\nc\n\nd')).toEqual(['a', 'b', 'c\n\nd']);
  });
  it('demora humana: larga al principio, corta después, instante para probar', () => {
    expect(demoraMs({ texto: 'hola', esPrimero: true, azar: 0.5 })).toBeGreaterThan(40000);
    expect(demoraMs({ texto: 'hola', esPrimero: true, azar: 1 })).toBeLessThanOrEqual(216000);
    expect(demoraMs({ texto: 'hola', azar: 0.5 })).toBeLessThan(15000);
    expect(demoraMs({ modo: 'instante' })).toBe(2000);
  });
  it('historial: lead = user, nosotros = assistant, notas de voz con su transcripción', () => {
    const h = historial([
      { direccion: 'out', autor: 'asesora_app', tipo: 'text', texto: 'hola' },
      { direccion: 'in', autor: 'lead', tipo: 'text', texto: 'hola!' },
      { direccion: 'in', autor: 'lead', tipo: 'audio', transcripcion: 'quiero ir a cusco' },
      { direccion: 'out', autor: 'asesora_web', tipo: 'text', texto: 'dale' },
    ]);
    expect(h).toEqual([
      { role: 'user', content: 'hola!\n\n[nota de voz] quiero ir a cusco' },
      { role: 'assistant', content: '[escribió una asesora] dale' },
    ]);
  });
});

describe('después de derivar', () => {
  async function derivado(textoLead) {
    const conv = await chatConLead('Hola, quiero ir a Machu Picchu');
    await correr(conv, claudeFalso([
      resp(usar('derivar_a_asesora', { motivo: 'listo', resumen: 'Machu Picchu' })),
      resp(texto('Perfecto, ya pasamos su consulta. Mientras la preparamos, ¿tiene alguna consulta sobre el servicio?')),
    ]));
    await webhookFirmado(exports.default, payloadMensaje({ texto: textoLead, id: 'wamid.R' + Math.random(), en: new Date(Date.now() + 5000).toISOString() }));
    return conv;
  }

  it('lee una sola respuesta, califica y se pausa', async () => {
    const conv = await derivado('No, por ahora no. Capaz el año que viene');
    const claude = claudeFalso([
      resp(usar('calificar', { calificacion: 'curioso', motivo: 'sin consultas y fecha vaga' })),
      resp(texto('Perfecto, gracias.')),
    ]);
    expect(await correr(conv, claude)).toMatch(/^respondio:/);
    expect(claude.pedidos[0].messages.at(-1).content).toContain('ya derivaste este chat');
    expect(await uno('SELECT ia_activa, ia_pausa_motivo, espera_persona FROM wa_conversaciones')).toEqual({ ia_activa: 0, ia_pausa_motivo: 'handoff', espera_persona: 1 });
    expect(await uno('SELECT ia_calificacion FROM leads')).toEqual({ ia_calificacion: 'curioso' });
    // El mensaje siguiente ya no lo contesta la IA.
    await webhookFirmado(exports.default, payloadMensaje({ texto: '¿Hola?', id: 'wamid.R3', en: new Date(Date.now() + 10000).toISOString() }));
    expect(await correr(conv, claudeFalso([]))).toBe('pausada');
  });

  it('no vuelve a derivar', async () => {
    const conv = await derivado('¿El hotel tiene desayuno?');
    const claude = claudeFalso([resp(usar('derivar_a_asesora', { motivo: 'x', resumen: 'y' })), resp(texto('Se lo confirman con la cotización.'))]);
    await correr(conv, claude);
    expect(claude.pedidos[1].messages.at(-1).content[0].content).toContain('Ya está derivado');
    expect(await uno(`SELECT count(*) n FROM setter_eventos WHERE tipo = 'derivacion'`)).toEqual({ n: 1 });
  });
});

describe('consultar al equipo', () => {
  it('avisa, marca que espera a una persona y la IA sigue activa', async () => {
    const conv = await chatConLead('¿Aceptan pago con tarjeta de crédito?');
    const claude = claudeFalso([
      resp(usar('consultar_al_equipo', { pregunta: '¿Aceptan pago con tarjeta de crédito?' })),
      resp(texto('No sabría decirle con exactitud, lo consulto con el equipo y le confirmo.')),
    ]);
    await correr(conv, claude);
    expect(await uno('SELECT ia_activa, espera_persona FROM wa_conversaciones')).toEqual({ ia_activa: 1, espera_persona: 1 });
    expect(await uno(`SELECT detalle FROM setter_eventos WHERE tipo = 'consulta_equipo'`)).toEqual({ detalle: '¿Aceptan pago con tarjeta de crédito?' });
    expect(enviadosMeta.at(-1).text.body).toBe('No sabría decirle con exactitud, lo consulto con el equipo y le confirmo.');
  });
});

describe('etiqueta comercial', () => {
  it('la IA no pisa la etiqueta que puso una persona', async () => {
    const conv = await chatConLead('Hola');
    const lead = await uno('SELECT id FROM leads');
    await env.DB.prepare(`UPDATE leads SET ia_calificacion = 'cotizado', ia_calificacion_por = 'persona' WHERE id = ?`).bind(lead.id).run();
    await correr(conv, claudeFalso([resp(usar('calificar', { calificacion: 'curioso', motivo: 'x' })), resp(texto('Ok.'))]));
    expect(await uno('SELECT ia_calificacion, calificado FROM leads')).toEqual({ ia_calificacion: 'cotizado', calificado: 'curioso' });
  });

  it('descartar como no calificado lo etiqueta "no califica"', async () => {
    const conv = await chatConLead('Busco algo gratis');
    await correr(conv, claudeFalso([resp(usar('descartar', { tipo: 'no_calificado', motivo: 'x' })), resp(texto('Gracias.'))]));
    expect(await uno('SELECT ia_calificacion FROM leads')).toEqual({ ia_calificacion: 'no_califica' });
  });
});

describe('lecciones del equipo', () => {
  it('van en su propia sección del prompt, aparte de la base', async () => {
    await env.DB.prepare(`INSERT INTO setter_conocimiento (titulo, contenido, tags, activo, creado_en, actualizado_en) VALUES ('Corrección: tarjeta', 'Si preguntan algo como: «¿aceptan tarjeta?»' || char(10) || 'Responde: «Sí, con un recargo del 5 %»', 'leccion', 1, '2026-10-29', '2026-10-29')`).run();
    const conv = await chatConLead('¿Aceptan tarjeta?');
    const claude = claudeFalso([resp(texto('Sí, con un recargo del 5 %.'))]);
    await correr(conv, claude);
    const sys = claude.pedidos[0].system[0].text;
    expect(sys).toContain('# Respuestas que aprobó el equipo');
    expect(sys.indexOf('Responde: «Sí, con un recargo del 5 %»')).toBeGreaterThan(sys.indexOf('# Respuestas que aprobó el equipo'));
    expect(sys).not.toContain('## Corrección: tarjeta');
    await env.DB.prepare(`DELETE FROM setter_conocimiento WHERE tags = 'leccion'`).run();
  });
});

describe('modo fin de semana', () => {
  it('va del sábado 20:00 al lunes 08:00 en Argentina', () => {
    // Argentina es UTC-3 todo el año.
    expect(finDeSemana(new Date('2026-10-31T22:59:00Z'))).toBeNull();                         // sábado 19:59
    expect(finDeSemana(new Date('2026-10-31T23:00:00Z'))).toBe('2026-10-31T23:00:00.000Z');    // sábado 20:00
    expect(finDeSemana(new Date('2026-11-01T15:30:00Z'))).toBe('2026-10-31T23:00:00.000Z');    // domingo
    expect(finDeSemana(new Date('2026-11-02T10:59:59Z'))).toBe('2026-10-31T23:00:00.000Z');    // lunes 07:59
    expect(finDeSemana(new Date('2026-11-02T11:00:00Z'))).toBeNull();                         // lunes 08:00
    expect(finDeSemana(new Date('2026-10-30T23:30:00Z'))).toBeNull();                         // viernes
  });

  // Sábado 24/10 a las 21:00 de Argentina: antes de que cierre la ventana de 24 h del webhook.
  const sabado = '2026-10-25T00:00:00.000Z';
  const conFinde = { ...env, SETTER_FINDE_MARCA: 'Luna Llena', SETTER_FINDE_NOMBRE: 'Sofía' };

  it('la primera vez se presenta como Sofía, la asistente virtual, y avisa del lunes', async () => {
    const conv = await chatConLead('Hola, quiero ir a Machu Picchu');
    const claude = claudeFalso([resp(texto('Hola, ¿qué tal? Soy Sofía, la asistente virtual de Luna Llena.'))]);
    await correrTurno(conFinde, canalDe(env), conv.id, { claude, dormir: async () => {}, ahora: () => sabado });
    const sys = claude.pedidos[0].system[1].text;
    expect(sys).toContain('# Fuera del horario del equipo');
    expect(sys).toContain('preséntate como Sofía, la asistente virtual de Luna Llena');
    expect(sys).toContain('Hasta el lunes, que una persona del equipo pueda contestarle, va a estar hablando conmigo');
  });

  it('no se vuelve a presentar si ya habló en este finde, y fuera del finde no aparece', async () => {
    const conv = await chatConLead('Hola');
    await env.DB.prepare(`INSERT INTO wa_mensajes (conversacion_id, direccion, autor, tipo, texto, creado_en) VALUES (?, 'out', 'ia', 'text', 'Soy la asistente con IA', '2026-10-24T23:30:00.000Z')`).bind(conv.id).run();
    await webhookFirmado(exports.default, payloadMensaje({ texto: '5 días', id: 'wamid.L' + Math.random() }));
    const claude = claudeFalso([resp(texto('Perfecto.')), resp(texto('Perfecto.'))]);
    await correrTurno(conFinde, canalDe(env), conv.id, { claude, dormir: async () => {}, ahora: () => sabado });
    expect(claude.pedidos[0].system[1].text).toContain('Ya te presentaste este fin de semana');
    await webhookFirmado(exports.default, payloadMensaje({ texto: 'Somos 2', id: 'wamid.L' + Math.random() }));
    await correrTurno(conFinde, canalDe(env), conv.id, { claude, dormir: async () => {}, ahora: () => '2026-10-23T15:00:00.000Z' });
    expect(claude.pedidos[1].system[1].text).not.toContain('# Fuera del horario del equipo');
  });
});
