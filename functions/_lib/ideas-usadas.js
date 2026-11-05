import { codigoIg } from './ig-foto.js';

// Una pieza Editada (o ya Subida) usó la idea que tiene como inspiración: la idea
// queda marcada como usada. El cruce es por el código del post, porque el link
// puede ser /p/CODE o /reels/CODE, con o sin parámetros. Los audios quedan afuera:
// su url es la de un reel que los usa, no la idea que inspiró la pieza.
export const piezaHecha = (estado) => estado === 'Editado' || estado === 'Subido';

export async function marcarIdeasUsadas(env, inspiracion) {
  const link = String(inspiracion || '').trim();
  if (!link) return;
  const codigo = codigoIg(link);
  const donde = codigo ? '(codigo = ?2 OR instr(url, ?3) > 0)' : 'url = ?2';
  const stmt = env.DB.prepare(
    `UPDATE ideas SET uso = 'usado', actualizado_en = ?1
      WHERE COALESCE(tipo, '') != 'audio' AND COALESCE(uso, '') != 'usado' AND ${donde}`
  );
  const now = new Date().toISOString();
  await (codigo ? stmt.bind(now, codigo, `/${codigo}`) : stmt.bind(now, link)).run();
}
