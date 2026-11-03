// El loop de Claude con herramientas y traspasos, compartido por el turno
// real (turno.js) y el playground (playground.js). Quién ejecuta las
// herramientas y de dónde sale el prompt lo decide quien llama.

import Anthropic from '@anthropic-ai/sdk';
import { systemEstable, systemDinamico, historial } from './contexto.js';
import { definiciones } from './herramientas.js';

export const MODELO_RESPUESTA = 'claude-sonnet-5-5';
export const MAX_AGENTES_POR_TURNO = 3;   // jefe + 2 traspasos (riesgo de bucle, plan §11)
const MAX_PASOS_HERRAMIENTAS = 6;

export function clienteClaude(env) {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, fetch: (...a) => fetch(...a) });
}

export const modeloDe = (env, cfg, agente) => agente?.modelo || cfg.modelo_respuesta || env.SETTER_MODELO || MODELO_RESPUESTA;

// Fallback por rechazo: la API reintenta sola con otro modelo. Haiku no lo tiene.
export function extrasModelo(modelo) {
  return /^claude-(sonnet-5-5|opus-5|fable-5)/.test(modelo)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
}

// Devuelve { texto, agente, traspasos: [claves], error?: 'error_claude' | 'rechazo' | 'sin_prompt', detalle? }
// notaFinal: texto que se agrega como último turno del usuario (los follow-ups
// la usan porque el último mensaje del chat es nuestro).
export async function correrAgentes({ cliente, modelo, agente, agentes, recursos, conocimiento, conv, lead, mensajes, yaHabloIa, promptDe, ejecutar, ctx, notaFinal = null, finde = null }) {
  const traspasos = [];
  let usados = 0;
  while (agente && usados < MAX_AGENTES_POR_TURNO) {
    usados++;
    ctx.agente = agente;
    ctx.estado.traspasoA = null;
    const prompt = await promptDe(agente);
    if (!prompt) return { error: 'sin_prompt', detalle: `el agente ${agente.clave} no tiene prompt publicado`, agente, traspasos };
    const especialistas = agentes.filter((a) => a.activo && a.rol === 'especialista' && a.clave !== agente.clave);
    const tools = definiciones(agente, especialistas, { puedeTraspasar: usados < MAX_AGENTES_POR_TURNO });
    const system = [
      { type: 'text', text: systemEstable({ agente, prompt, agentes, conocimiento, recursos }), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: systemDinamico({ agente, conv: { ...conv, ya_hablo_ia: yaHabloIa }, lead, finde }) },
    ];
    const messages = historial(mensajes);
    if (notaFinal) {
      const ult = messages[messages.length - 1];
      if (ult && ult.role === 'user') ult.content += '\n\n' + notaFinal;
      else messages.push({ role: 'user', content: notaFinal });
    }
    const m = agente.modelo || modelo;

    for (let paso = 0; paso < MAX_PASOS_HERRAMIENTAS; paso++) {
      let r;
      try {
        r = await cliente.beta.messages.create({
          model: m, max_tokens: 4000, system, messages, tools,
          thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
          ...extrasModelo(m),
        });
      } catch (e) {
        return { error: 'error_claude', detalle: String(e.message || e).slice(0, 500), agente, traspasos };
      }
      if (r.stop_reason === 'refusal') return { error: 'rechazo', detalle: r.stop_details?.category || null, agente, traspasos };
      const usos = r.content.filter((b) => b.type === 'tool_use');
      if (!usos.length) {
        return { texto: r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim(), agente, traspasos };
      }
      // El turno del asistente vuelve tal cual (thinking incluido) y todos los
      // resultados van juntos en un solo mensaje del usuario.
      messages.push({ role: 'assistant', content: r.content });
      const resultados = [];
      for (const u of usos) {
        const res = await ejecutar(ctx, u.name, u.input);
        resultados.push({ type: 'tool_result', tool_use_id: u.id, content: res.texto, ...(res.error ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: resultados });
      if (ctx.estado.traspasoA) break;
    }
    if (!ctx.estado.traspasoA) return { texto: '', agente, traspasos };
    traspasos.push(ctx.estado.traspasoA);
    agente = agentes.find((a) => a.clave === ctx.estado.traspasoA);
  }
  return { texto: '', agente: ctx.agente, traspasos };
}
