// Demora "humana" antes de responder: lo que tardaría una persona en leer y
// contestar. Más larga en el primer mensaje (hasta ~3 min), más corta
// después y según el largo de lo que escribió el lead. Cada mensaje nuevo
// del lead reprograma la alarma: varios seguidos reciben una sola respuesta.
//
// SETTER_DEMORA = "instante" (var del Worker) la baja a 2 s, para probar.

export function demoraMs({ texto = '', esPrimero = false, alInstante = false, modo = '', azar = Math.random() } = {}) {
  if (modo === 'instante' || alInstante) return 2000;
  const largo = String(texto).length;
  const base = esPrimero ? Math.min(180000, 45000 + largo * 600) : Math.min(90000, 8000 + largo * 150);
  return Math.round(base * (0.8 + 0.4 * azar));   // ±20 % para que no sea un reloj
}
