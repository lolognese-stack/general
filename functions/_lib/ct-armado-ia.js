// La IA propone qué tour va en cada día libre. NUNCA ve un precio: solo ciudad, nombre, duración y resumen del tour.
// Lo que devuelve lo valida ct-armado.js (clave que exista, que no se repita, que quepa); lo demás lo completa el armado base.
import { claudeJson } from './claude.js';

const SCHEMA = {
  type: 'object',
  properties: {
    elecciones: {
      type: 'array',
      items: { type: 'object', properties: { slot: { type: 'string' }, candidato: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['slot', 'candidato'], additionalProperties: false },
    },
  },
  required: ['elecciones'],
  additionalProperties: false,
};

const SISTEMA = `Armás itinerarios de Perú para una agencia. Te doy los días libres de un viaje ("slots") y los tours disponibles ("candidatos") por ciudad.
Para cada slot elegí la clave de UN candidato de la MISMA ciudad, o null si ninguno conviene.
Reglas: no repitas un candidato; un candidato de 2 o más días ocupa los días siguientes (no lo pongas si el slot siguiente ya lo vas a usar o no entra antes de la salida);
variá el tipo de actividad (no pongas dos días seguidos exigentes de trekking); si el pedido del cliente dice algo ("tranquilo", "aventura", "con niños"), usalo para elegir.
No inventes claves. No hables de precios: no los tenés.`;

// Devuelve null si no hay API key: el armado usa solo el orden base.
export function elegirConIA(env) {
  if (!env || !env.ANTHROPIC_API_KEY) return null;
  return async ({ slots, candidatos, pedido }) => {
    const user = JSON.stringify({
      cliente: { personas: pedido.pasajeros, pedido_especial: pedido.pedidos_especiales || '' },
      slots: slots.map((s) => ({ slot: s.id, ciudad: s.ciudad, dia: s.dia, puede_seguir_hasta_el_dia: s.hasta })),
      candidatos,
    });
    const { datos } = await claudeJson(env, { system: SISTEMA, user, schema: SCHEMA, maxTokens: 1500 });
    const out = {};
    for (const e of datos.elecciones || []) if (e && e.candidato) out[e.slot] = e.candidato;
    return out;
  };
}
