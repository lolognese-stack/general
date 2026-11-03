// Llamada a la API de Claude desde las Functions del panel (el Radar y el
// resumen de la persona). Usa el secret ANTHROPIC_API_KEY de Pages, la misma
// key que el setter-worker. Salida estructurada: el modelo devuelve JSON que
// cumple el esquema, sin reintentos por JSON roto.

export const MODELO_RADAR = 'claude-haiku-5-5';

export async function claudeJson(env, { system, user, schema, maxTokens = 4000, modelo = MODELO_RADAR }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Falta el secret ANTHROPIC_API_KEY en el CRM.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${data.error?.message || 'error'}`);
  if (data.stop_reason === 'refusal') throw new Error('Claude no quiso analizar este chat.');
  if (data.stop_reason === 'max_tokens') throw new Error('El chat es demasiado largo para un reporte.');
  const texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { datos: JSON.parse(texto), modelo: data.model || modelo };
}
