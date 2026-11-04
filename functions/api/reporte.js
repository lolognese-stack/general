// /api/reporte — sección Reporte del panel (ver functions/_lib/reporte-ia.js).
//
//   GET /api/reporte?desde&hasta&ticket            insumos (JSON) para revisar
//   GET /api/reporte?prompt=1&desde&hasta&ticket   { prompt, resumen, warnings }
//
// El CRM no llama a Claude: el panel copia el prompt y se pega en Claude chat
// o Claude Code, que devuelve el reporte como un .html con diseño.

import { rolDe, json } from '../_lib/auth.js';
import { armarInsumos, armarPrompt, TICKET_X_USD } from '../_lib/reporte-ia.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const rango = (desde, hasta) => {
  const h = FECHA.test(hasta || '') ? hasta : new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const d = FECHA.test(desde || '') ? desde : new Date(new Date(h + 'T12:00:00Z').getTime() - 29 * 86400000).toISOString().slice(0, 10);
  return d <= h ? { desde: d, hasta: h } : { desde: h, hasta: d };
};
const ticketDe = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 50 && n <= 100000 ? n : TICKET_X_USD; };

export async function onRequestGet({ request, env }) {
  if (!rolDe(request, env)) return json({ error: 'unauthorized' }, 401);
  const u = new URL(request.url);
  const r = rango(u.searchParams.get('desde'), u.searchParams.get('hasta'));
  const insumos = await armarInsumos(env.DB, { ...r, ticketUsd: ticketDe(u.searchParams.get('ticket')) });
  if (!u.searchParams.get('prompt')) return json(insumos);
  return json({ prompt: armarPrompt(insumos), resumen: insumos.resumen, warnings: insumos.warnings, embudo: insumos.capa_a_setting.embudo, periodo: insumos.periodo });
}
