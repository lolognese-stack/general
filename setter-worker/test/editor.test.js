// Fase 4: sección Setter IA (endpoints de Pages) y playground/puntuar/asistente del Worker.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import * as agentes from '../../functions/api/setter/agentes.js';
import * as agente from '../../functions/api/setter/agentes/[id].js';
import * as prompts from '../../functions/api/setter/agentes/[id]/prompts.js';
import * as config from '../../functions/api/setter/config.js';
import * as conocimiento from '../../functions/api/setter/conocimiento.js';
import { playground, puntuar, asistente } from '../src/agente/playground.js';
import { prepararDb } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const envCrm = () => ({ ...env, CRM_TOKEN: 'cli', CRM_ADMIN_TOKEN: 'adm', SETTER: { fetch: () => Response.json({}) } });
const pedido = (tok, body, method = 'POST') => new Request('https://crm.test/x', { method, headers: { 'x-crm-token': tok }, body: body ? JSON.stringify(body) : undefined });
const jefe = () => uno(`SELECT * FROM setter_agentes WHERE clave = 'luna'`);

function claudeFalso(respuestas) {
  const pedidos = [];
  const create = async (p) => { pedidos.push(p); return respuestas.shift(); };
  return { pedidos, messages: { create }, beta: { messages: { create } } };
}
const texto = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });

beforeEach(async () => {
  await prepararDb();
  // Lo que dejó otro test encima de la semilla.
  const SEMILLA = `('luna','calificacion','seguimiento','reserva_web','postventa')`;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM setter_puntuaciones'),
    env.DB.prepare(`DELETE FROM setter_prompts WHERE version > 1 OR agente_id IN (SELECT id FROM setter_agentes WHERE clave NOT IN ${SEMILLA})`),
    env.DB.prepare(`DELETE FROM setter_agentes WHERE clave NOT IN ${SEMILLA}`),
    env.DB.prepare(`UPDATE setter_agentes SET tono = 'tu', responder_al_instante = 0, modelo = NULL`),
    env.DB.prepare(`UPDATE setter_config SET valor = CASE clave WHEN 'kill_switch' THEN '0' WHEN 'modelo_respuesta' THEN 'claude-haiku-5-5' ELSE valor END`),
  ]);
});

describe('agentes y prompts', () => {
  it('el cliente puede leer pero no crear', async () => {
    const r = await agentes.onRequestGet({ request: pedido('cli', null, 'GET'), env: envCrm() });
    const d = await r.json();
    expect(d.admin).toBe(false);
    expect(d.agentes[0]).toMatchObject({ clave: 'luna', version_publicada: 1 });
    expect((await agentes.onRequestPost({ request: pedido('cli', { nombre: 'X' }), env: envCrm() })).status).toBe(403);
  });

  it('especialista nuevo: clave sola, inactivo, se activa al publicar su primera misión', async () => {
    const r = await agentes.onRequestPost({ request: pedido('adm', { nombre: 'Objeción Precio' }), env: envCrm() });
    const { id, clave } = await r.json();
    expect(clave).toBe('objecion_precio');
    expect((await uno('SELECT activo FROM setter_agentes WHERE id = ?', id)).activo).toBe(0);
    // No se puede activar sin misión publicada.
    expect((await agente.onRequestPatch({ request: pedido('adm', { activo: true }, 'PATCH'), env: envCrm(), params: { id } })).status).toBe(400);
    await prompts.onRequestPost({ request: pedido('adm', { texto: 'borrador', publicar: false }), env: envCrm(), params: { id } });
    expect((await uno('SELECT activo FROM setter_agentes WHERE id = ?', id)).activo).toBe(0);
    const p = await (await prompts.onRequestPost({ request: pedido('adm', { texto: 'misión', publicar: true }), env: envCrm(), params: { id } })).json();
    expect(p).toMatchObject({ version: 2, estado: 'publicado', activado: true });
    expect((await uno('SELECT activo FROM setter_agentes WHERE id = ?', id)).activo).toBe(1);
    // Mismo nombre otra vez: otra clave.
    expect((await (await agentes.onRequestPost({ request: pedido('adm', { nombre: 'Objeción precio' }), env: envCrm() })).json()).clave).toBe('objecion_precio_2');
  });

  it('volver a una versión anterior la publica como versión nueva', async () => {
    const { id } = await jefe();
    await prompts.onRequestPost({ request: pedido('adm', { texto: 'versión 2', publicar: true }), env: envCrm(), params: { id } });
    const v1 = await uno('SELECT id FROM setter_prompts WHERE agente_id = ? AND version = 1', id);
    const r = await (await prompts.onRequestPost({ request: pedido('adm', { desde_id: v1.id }), env: envCrm(), params: { id } })).json();
    expect(r).toMatchObject({ version: 3, estado: 'publicado' });
    const activa = await uno(`SELECT texto, nota_cambio FROM setter_prompts WHERE agente_id = ? AND estado = 'publicado' ORDER BY version DESC LIMIT 1`, id);
    expect(activa.texto).toContain('Atiendes el WhatsApp de Luna Llena');
    expect(activa.nota_cambio).toBe('Vuelta a la versión 1');
  });

  it('config del agente y del setter', async () => {
    const { id } = await jefe();
    await agente.onRequestPatch({ request: pedido('adm', { tono: 'usted', responder_al_instante: true, modelo: 'claude-sonnet-5-5' }, 'PATCH'), env: envCrm(), params: { id } });
    expect(await uno('SELECT tono, responder_al_instante, modelo FROM setter_agentes WHERE id = ?', id)).toEqual({ tono: 'usted', responder_al_instante: 1, modelo: 'claude-sonnet-5-5' });
    expect((await agente.onRequestPatch({ request: pedido('adm', { activo: false }, 'PATCH'), env: envCrm(), params: { id } })).status).toBe(400);
    // El cliente puede usar el kill switch, no cambiar el modelo.
    expect((await config.onRequestPatch({ request: pedido('cli', { kill_switch: true }, 'PATCH'), env: envCrm() })).status).toBe(200);
    expect((await uno(`SELECT valor FROM setter_config WHERE clave = 'kill_switch'`)).valor).toBe('1');
    expect((await config.onRequestPatch({ request: pedido('cli', { modelo_respuesta: 'claude-opus-5-5' }, 'PATCH'), env: envCrm() })).status).toBe(403);
    expect((await config.onRequestPatch({ request: pedido('adm', { modelo_respuesta: 'gpt-5' }, 'PATCH'), env: envCrm() })).status).toBe(400);
  });

  it('base de conocimiento', async () => {
    await conocimiento.onRequestPost({ request: pedido('adm', { titulo: 'Cancelación', contenido: '30 días antes, reintegro total.' }), env: envCrm() });
    const l = await (await conocimiento.onRequestGet({ request: pedido('cli', null, 'GET'), env: envCrm() })).json();
    expect(l.map((k) => k.titulo)).toContain('Cancelación');
  });
});

describe('playground', () => {
  it('prueba el texto del editor con el modelo de Ajustes y no toca la base', async () => {
    const { id } = await jefe();
    const claude = claudeFalso([
      { content: [{ type: 'tool_use', id: 't1', name: 'completar_lead', input: { destinos: 'Cusco' } }, { type: 'tool_use', id: 't2', name: 'enviar_recurso', input: { etiqueta: 'cotizador' } }], stop_reason: 'tool_use' },
      texto('¡Hola! Soy el asistente virtual con IA de Luna Llena Travel.\n\nTe paso el cotizador.'),
    ]);
    const r = await playground(env, { agente_id: id, texto_prompt: 'PROMPT DEL EDITOR', origen: 'web_ref', mensajes: [{ direccion: 'in', texto: 'Hola, Cusco' }] }, { claude });
    expect(r.burbujas).toEqual(['¡Hola! Soy el asistente virtual con IA de Luna Llena Travel.', 'Te paso el cotizador.']);
    expect(r.recursos).toEqual(['cotizador']);
    expect(r.acciones.map((a) => a.herramienta)).toEqual(['completar_lead', 'enviar_recurso']);
    expect(r.lead.destinos).toBe('Cusco');
    expect(claude.pedidos[0].system[0].text).toContain('PROMPT DEL EDITOR');
    expect(claude.pedidos[0].system[1].text).toContain('código LL-');
    expect(claude.pedidos[0].model).toBe('claude-haiku-5-5');
    expect(await uno('SELECT count(*) n FROM leads')).toEqual({ n: 0 });
    expect(await uno('SELECT count(*) n FROM setter_eventos')).toEqual({ n: 0 });
  });

  it('sigue con el especialista al que traspasó', async () => {
    const { id } = await jefe();
    const claude = claudeFalso([
      { content: [{ type: 'tool_use', id: 't1', name: 'traspasar', input: { clave: 'calificacion', motivo: 'x' } }], stop_reason: 'tool_use' },
      texto('¿Cuántos son?'),
      texto('Perfecto.'),
    ]);
    const r1 = await playground(env, { agente_id: id, mensajes: [{ direccion: 'in', texto: 'Quiero viajar' }] }, { claude });
    expect(r1.agente_activo).toBe('calificacion');
    const r2 = await playground(env, { agente_id: id, agente_activo: r1.agente_activo, mensajes: [{ direccion: 'in', texto: 'Quiero viajar' }, { direccion: 'out', texto: '¿Cuántos son?' }, { direccion: 'in', texto: 'Dos' }] }, { claude });
    expect(r2.agente_activo).toBe('calificacion');
    expect(claude.pedidos[2].system[0].text).toContain('Tu misión: calificar');
  });
});

describe('puntuar y asistente', () => {
  it('puntúa con Haiku y salida estructurada', async () => {
    const claude = claudeFalso([texto(JSON.stringify({ nota: 7, resumen: 'Bien, le falta manejo de precio.', faltantes: ['Qué decir si piden precio'] }))]);
    const r = await puntuar(env, { texto: 'prompt' }, { claude });
    expect(r).toEqual({ nota: 7, resumen: 'Bien, le falta manejo de precio.', faltantes: ['Qué decir si piden precio'] });
    expect(claude.pedidos[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { format: { type: 'json_schema' } } });
  });

  it('el asistente propone un prompt y lo prueba en el playground', async () => {
    const { id } = await jefe();
    const claude = claudeFalso([
      texto(JSON.stringify({ respuesta: 'Agregué una regla.', prompt_nuevo: 'PROMPT NUEVO', mensaje_prueba: '¿Cuánto sale?' })),
      texto('Una asesora te arma la propuesta.'),
    ]);
    const r = await asistente(env, { agente_id: id, texto_prompt: 'viejo', chat: [{ role: 'user', content: 'Que no diga el precio' }] }, { claude });
    expect(r).toMatchObject({ respuesta: 'Agregué una regla.', prompt_nuevo: 'PROMPT NUEVO', prueba: { mensaje: '¿Cuánto sale?', burbujas: ['Una asesora te arma la propuesta.'] } });
    expect(claude.pedidos[1].system[0].text).toContain('PROMPT NUEVO');
  });
});
