// Pestaña "Web" del panel: métricas de la web de Luna Llena en un período,
// comparadas con el período anterior de igual largo, cruzadas con leads y ventas.
import { rolDe, json } from '../_lib/auth.js';
import { metricasWeb, resumenWeb, alertasWeb, hoyPe, sumarDias, diasEntre } from '../_lib/web-metricas.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ request, env }) {
  const rol = rolDe(request, env);
  if (!rol) return json({ error: 'unauthorized' }, 401);

  const u = new URL(request.url);
  const hasta = FECHA.test(u.searchParams.get('hasta') || '') ? u.searchParams.get('hasta') : hoyPe();
  const desde = FECHA.test(u.searchParams.get('desde') || '') ? u.searchParams.get('desde') : sumarDias(hasta, -6);
  if (desde > hasta) return json({ error: 'rango invalido' }, 400);

  const largo = diasEntre(desde, hasta) + 1;
  const [actual, anterior, mcErr] = await Promise.all([
    metricasWeb(env.DB, desde, hasta),
    resumenWeb(env.DB, sumarDias(desde, -largo), sumarDias(desde, -1)),
    env.DB.prepare(
      `SELECT count(*) AS n, max(error) AS ultimo FROM manychat_web_sync
        WHERE error IS NOT NULL AND actualizado_en > datetime('now', '-7 days')`
    ).first(),
  ]);

  return json({
    rol,
    ...actual,
    anterior: { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1), resumen: anterior },
    alertas: alertasWeb(actual, anterior),
    // Tags y campos a ManyChat (functions/_lib/manychat.js): activo con el secret MANYCHAT_TOKEN.
    manychat: { activo: !!env.MANYCHAT_TOKEN, errores: mcErr?.n || 0, ultimo_error: mcErr?.ultimo || null },
  });
}
