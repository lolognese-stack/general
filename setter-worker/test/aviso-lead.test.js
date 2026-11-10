// Aviso de lead: además del mail deja una nota interna en el Inbox (Worker /interno/nota).
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { armarAvisoLead, notaAlInbox } from '../../functions/_lib/aviso-lead.js';
import { prepararDb } from './ayuda.js';

const uno = (sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const lead = { id: 1, nombre: 'Ana Torres', whatsapp: '+51 930 299 443', dias: 6, personas: 2, destinos: 'Cusco' };
const setterFetch = vi.fn((url, init) => exports.default.fetch(url, init));
const envCrm = () => ({ ...env, SETTER_INTERNAL_SECRET: env.SETTER_INTERNAL_SECRET, SETTER: { fetch: setterFetch } });

beforeEach(async () => { await prepararDb(); setterFetch.mockClear(); });

describe('nota del aviso de lead en el Inbox', () => {
  it('deja la nota con lo que falta y el mensaje para copiar, sin links ni datos repetidos', async () => {
    expect(await notaAlInbox(envCrm(), lead, armarAvisoLead(lead))).toBe(true);
    const m = await uno(`SELECT m.tipo, m.autor, m.texto, c.espera_persona, c.ia_activa FROM wa_mensajes m JOIN wa_conversaciones c ON c.id = m.conversacion_id WHERE c.wa_id = '51930299443'`);
    expect(m).toMatchObject({ tipo: 'nota', autor: 'sistema', espera_persona: 1, ia_activa: 0 });
    expect(m.texto).toContain('Aviso de lead: contactar por WhatsApp');
    expect(m.texto).toContain('Faltan para cotizar:');
    expect(m.texto).not.toContain('Nombre:');
    expect(m.texto).toContain('Mensaje sugerido:\nHola Ana!');
    expect(m.texto).not.toContain('wa.me');
    expect(m.texto).not.toContain('Abrir en el CRM');
  });

  it('sin el setter activo o sin WhatsApp, no hace nada', async () => {
    expect(await notaAlInbox({ ...env }, lead, armarAvisoLead(lead))).toBe(false);
    expect(await notaAlInbox(envCrm(), { ...lead, whatsapp: '' }, armarAvisoLead({ ...lead, whatsapp: '' }))).toBe(false);
    expect(setterFetch).not.toHaveBeenCalled();
  });

  it('si el Worker falla, devuelve false y no tira', async () => {
    const roto = { ...envCrm(), SETTER: { fetch: () => Promise.reject(new Error('caído')) } };
    expect(await notaAlInbox(roto, lead, armarAvisoLead(lead))).toBe(false);
  });
});
