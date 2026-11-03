// Fase 7: análisis por chat (Haiku) y analíticas del setter.
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { analizarConversacion, analizarPendientes } from '../src/agente/analisis.js';
import * as analiticas from '../../functions/api/setter/analiticas.js';
import * as semana from '../../functions/api/setter/semana.js';
import { prepararDb, webhookFirmado, payloadMensaje } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const envCrm = () => ({ ...env, CRM_TOKEN: 'cli', SETTER: { fetch: () => Response.json({}) } });
const get = (mod, q = '') => mod.onRequestGet({ request: new Request('https://crm.test/x' + q, { headers: { 'x-crm-token': 'cli' } }), env: envCrm() }).then((r) => r.json());

const ANALISIS = {
  intencion_inicial: 'Machu Picchu en marzo', objeciones: [{ objecion: 'precio', frase: 'está muy caro' }], dolores: ['poco tiempo'],
  pedidos: ['hotel céntrico'], senales_compra: ['preguntó por la seña'], preguntas_sin_respuesta: ['¿Aceptan tarjeta en cuotas?'],
  motivo_perdida: '', etapa_corte: 'cotizador', tipo_lead: 'decidido', proxima_accion: 'mandar propuesta', prioridad: 'alta',
};
const claude = (d = ANALISIS) => {
  const pedidos = [];
  return { pedidos, messages: { create: async (p) => { pedidos.push(p); return { content: [{ type: 'text', text: JSON.stringify(d) }], stop_reason: 'end_turn' }; } } };
};

beforeEach(async () => {
  await prepararDb();
  await env.DB.batch([env.DB.prepare('DELETE FROM setter_archivos'), env.DB.prepare(`UPDATE setter_agentes SET recurso_conversion_id = (SELECT id FROM setter_recursos WHERE etiqueta = 'cotizador')`)]);
});

async function chat({ waId = '51911111111', minAtras = 120, conRespuesta = true } = {}) {
  const en = new Date(Date.now() - minAtras * 60e3).toISOString();
  await webhookFirmado(exports.default, payloadMensaje({ waId, id: 'w' + waId, en, texto: 'Hola, quiero ir a Machu Picchu' }));
  const conv = await uno('SELECT * FROM wa_conversaciones WHERE wa_id = ?', waId);
  const rec = await uno(`SELECT id FROM setter_recursos WHERE etiqueta = 'cotizador'`);
  const t = (m) => new Date(Date.now() - (minAtras - m) * 60e3).toISOString();
  await env.DB.prepare(`INSERT INTO wa_mensajes (conversacion_id, direccion, autor, tipo, texto, estado, recurso_id, creado_en) VALUES (?, 'out', 'ia', 'text', 'Hola!', 'read', NULL, ?), (?, 'out', 'ia', 'text', 'link', 'delivered', ?, ?)`)
    .bind(conv.id, t(1), conv.id, rec.id, t(2)).run();
  if (conRespuesta) await env.DB.prepare(`INSERT INTO wa_mensajes (conversacion_id, direccion, autor, tipo, texto, creado_en) VALUES (?, 'in', 'lead', 'text', 'gracias', ?)`).bind(conv.id, t(5)).run();
  await env.DB.prepare('UPDATE wa_conversaciones SET ultimo_en = ?, ultimo_autor = ? WHERE id = ?').bind(t(5), conRespuesta ? 'lead' : 'ia', conv.id).run();
  return conv;
}

describe('análisis por chat', () => {
  it('guarda el análisis y la primera intención del lead', async () => {
    const conv = await chat();
    const c = claude();
    await analizarConversacion(env, conv.id, { claude: c });
    expect(c.pedidos[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { format: { type: 'json_schema' } } });
    expect(c.pedidos[0].messages[0].content).toContain('Lead: Hola, quiero ir a Machu Picchu');
    const a = await uno('SELECT * FROM wa_analisis WHERE conversacion_id = ?', conv.id);
    expect(a).toMatchObject({ intencion_inicial: 'Machu Picchu en marzo', tipo_lead: 'decidido', prioridad: 'alta', motivo_perdida: null });
    expect(JSON.parse(a.objeciones_json)).toEqual([{ objecion: 'precio', frase: 'está muy caro' }]);
    expect((await uno('SELECT ia_primera_intencion FROM leads')).ia_primera_intencion).toBe('Machu Picchu en marzo');
  });

  it('el cron analiza solo los chats quietos con novedades', async () => {
    await chat({ waId: '51911111111', minAtras: 120 });
    await chat({ waId: '51922222222', minAtras: 10 });   // todavía activo
    const c = claude();
    expect(await analizarPendientes(env, { claude: c })).toEqual({ pendientes: 1, hechos: 1 });
    expect(await analizarPendientes(env, { claude: c })).toEqual({ pendientes: 0, hechos: 0 });
  });
});

describe('analíticas', () => {
  it('embudo, lectura, objeciones y preguntas sin responder', async () => {
    const c1 = await chat({ waId: '51911111111' });
    await chat({ waId: '51922222222', conRespuesta: false });
    await analizarConversacion(env, c1.id, { claude: claude() });
    await env.DB.prepare(`UPDATE leads SET etapa = 'propuesta_enviada', calificado = 'si' WHERE wa_id = '51911111111'`).run();
    const a = await get(analiticas, '?dias=30');
    expect(a.resumen).toMatchObject({ leads: 2, respondieron: 1, tasa_respuesta: 50, cotizador: 2, tasa_cotizador: 100, propuesta: 1, ganados: 0 });
    expect(a.embudo.map((e) => e.valor)).toEqual([2, 1, 1, 2, 0, 1, 0]);
    expect(a.setter.tasa_lectura).toBe(50);
    expect(a.setter.mensajes_ia_por_lead).toBe(2);
    expect(a.perdidas.objeciones).toEqual([{ objecion: 'precio', n: 1, frase: 'está muy caro' }]);
    expect(a.avanzadas.preguntas_sin_respuesta).toEqual([{ pregunta: '¿Aceptan tarjeta en cuotas?', conversacion_id: c1.id }]);
    expect(a.origenes).toEqual([{ valor: 'directo', n: 2 }]);
  });

  it('/api/setter/semana resume los últimos 7 días', async () => {
    const c1 = await chat();
    await analizarConversacion(env, c1.id, { claude: claude() });
    const s = await get(semana);
    expect(s.resumen.leads).toBe(1);
    expect(s.preguntas_sin_respuesta).toEqual(['¿Aceptan tarjeta en cuotas?']);
    expect(s.objeciones[0].objecion).toBe('precio');
  });
});
