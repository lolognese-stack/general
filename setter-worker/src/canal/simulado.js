// Chats de prueba del Simulador (Setter IA › Simulador): números que empiezan
// con 999 (no existe ese código de país). Pasan por todo el setter (Inbox, IA,
// derivación, lecciones) pero nada sale a WhatsApp: este canal no manda nada
// y devuelve ids inventados.

export const PREFIJO_SIMULADO = '999';
export const esSimulado = (waId) => String(waId || '').startsWith(PREFIJO_SIMULADO);

const id = () => 'sim.' + crypto.randomUUID();

export const canalSimulado = {
  nombre: 'Simulador',
  simulado: true,
  async sendText() { return { providerId: id() }; },
  async sendMedia() { return { providerId: id() }; },
  async sendTemplate() { return { providerId: id() }; },
  async markRead() {},
  async uploadMedia() { throw new Error('el simulador no sube archivos'); },
  async downloadMedia() { throw new Error('el simulador no tiene archivos'); },
};

// El canal que corresponde a un chat: el real o, si es de prueba, el simulado.
export const canalPara = (canal, waId) => (esSimulado(waId) ? canalSimulado : canal);

// Horario de los chats de prueba (Simulador › Horario, setter_config.sim_horario):
// se prueba de día, de noche o el finde a cualquier hora. Los chats reales
// siempre usan la hora de verdad.
const HORAS = { dia: '2026-11-03T15:00:00.000Z', noche: '2026-11-04T02:00:00.000Z', finde: '2026-11-01T15:00:00.000Z' };
export const HORARIOS_SIM = ['siempre', 'real', 'dia', 'noche', 'finde'];

export function horarioDe(env, conv, cfg, t0) {
  const modo = esSimulado(conv.wa_id) ? cfg.sim_horario || 'siempre' : 'real';
  if (modo === 'siempre') return { envH: { ...env, SETTER_SOLO_NOCHE: '', SETTER_FINDE_MARCA: '' }, hora: HORAS.dia };
  if (modo === 'noche') return { envH: { ...env, SETTER_SOLO_NOCHE: '1' }, hora: HORAS.noche };
  return { envH: env, hora: HORAS[modo] || t0 };
}
