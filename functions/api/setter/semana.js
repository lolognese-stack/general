import { checkToken, json } from '../../_lib/auth.js';
import { setterActivo } from '../../_lib/setter.js';
import { cargarDatos, calcular } from '../../_lib/setter-analiticas.js';
// Resumen de los últimos 7 días para el agente semanal de ventas: los números
// del embudo, objeciones, preguntas sin responder y a quién retomar a mano.

export async function onRequestGet({ request, env }) {
  if (!checkToken(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!setterActivo(env)) return json({ error: 'el setter no está activo en este CRM' }, 404);
  const hasta = new Date().toISOString();
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const a = calcular(await cargarDatos(env.DB, desde), { desde, hasta });
  return json({
    periodo: a.periodo,
    resumen: a.resumen,
    embudo: a.embudo,
    origenes: a.origenes,
    objeciones: a.perdidas.objeciones,
    motivos_perdida: a.perdidas.motivos,
    preguntas_sin_respuesta: a.avanzadas.preguntas_sin_respuesta.map((p) => p.pregunta),
    para_retomar: a.para_retomar,
    setter: { respuesta_mediana_s: a.setter.respuesta_mediana_s, tasa_lectura: a.setter.tasa_lectura, followups: a.avanzadas.followups },
  });
}
