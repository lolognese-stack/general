// Score interno del armador de itinerario de la web (/armar/). Lo calcula SOLO el servidor: el navegador recibe el
// tier (para decidir si muestra las preguntas extra y el botón de WhatsApp), nunca el desglose.
//
// Base: los mismos pesos del formulario /cotizar/ (lunallenatravel-web/cotizar/scoring.js), con dos cambios pedidos
// (grilling 14/11/2026): pesa más en contra la fecha lejana (> 12 meses) o sin fecha, y "solo estoy viendo ideas" en
// "¿Cuándo planeabas reservar?". El itinerario siempre suma 15 (lo armó). Presupuesto bajo y viaje corto no restan extra.

export const RANGOS_PRESUPUESTO = [
  { valor: 'lt500', etiqueta: 'Menos de US$ 500', puntos: 0 },
  { valor: '500-1000', etiqueta: 'US$ 500 – 1.000', puntos: 2 },
  { valor: '1000-1500', etiqueta: 'US$ 1.000 – 1.500', puntos: 4 },
  { valor: '1500-2000', etiqueta: 'US$ 1.500 – 2.000', puntos: 6 },
  { valor: '2000-3000', etiqueta: 'US$ 2.000 – 3.000', puntos: 8 },
  { valor: 'gt3000', etiqueta: 'Más de US$ 3.000', puntos: 10 },
];
export const RESERVA = [
  { valor: 'ya', etiqueta: 'En los próximos días', puntos: 10 },
  { valor: '1-3', etiqueta: 'En 1 a 3 meses', puntos: 5 },
  { valor: '3-6', etiqueta: 'En 3 a 6 meses', puntos: 0 },
  { valor: 'ideas', etiqueta: 'Todavía estoy viendo ideas', puntos: -20 },
];
const MES_MS = 2630016e3;

function mesesHasta(v, hoy) {
  if (v.fecha_tipo === 'exacta' && /^\d{4}-\d{2}-\d{2}$/.test(v.fecha || '')) return (Date.parse(`${v.fecha}T12:00:00Z`) - hoy) / MES_MS;
  if (v.fecha_tipo === 'mes' && /^\d{4}-\d{2}$/.test(v.fecha || '')) return (Date.parse(`${v.fecha}-01T12:00:00Z`) - hoy) / MES_MS;
  return null;
}

// v: { fecha_tipo: exacta|mes|nose, fecha, pasajes: comprados|pendientes, adultos, ninos, tiene_presupuesto, presupuesto_rango,
//      reserva, dias, destinos (cantidad), comentario }
export function scoreArmador(v, hoy = Date.now()) {
  const s = {};
  s.itinerario = 15;
  s.pasajes = v.pasajes === 'comprados' ? 15 : 0;
  const meses = mesesHasta(v, hoy);
  if (meses == null) s.fecha = 0;
  else if (v.fecha_tipo === 'exacta') s.fecha = meses <= 6 ? 15 : 10;
  else s.fecha = meses <= 6 ? 9 : 4;
  // Más peso en contra: sin fecha o a más de 12 meses.
  s.fecha_lejana = meses == null || meses > 12 ? -10 : 0;
  const r = RANGOS_PRESUPUESTO.find((x) => x.valor === v.presupuesto_rango);
  s.presupuesto = r ? 15 + r.puntos : 3;
  const personas = (Number(v.adultos) || 0) + (Number(v.ninos) || 0);
  s.grupo = personas >= 5 ? 10 : personas >= 3 ? 9 : personas === 2 ? 7 : personas === 1 ? 4 : 0;
  const dias = Number(v.dias) || 0;
  s.duracion = dias >= 15 ? 10 : dias >= 10 ? 8 : dias >= 5 ? 5 : dias > 0 ? 2 : 0;
  const n = Number(v.destinos) || 0;
  s.destinos = n >= 4 ? 5 : n >= 2 ? 4 : n === 1 ? 2 : 0;
  const largo = String(v.comentario || '').trim().length;
  s.detalle = largo >= 40 ? 5 : largo > 0 ? 2 : 0;
  const res = RESERVA.find((x) => x.valor === v.reserva);
  if (res) s.reserva = res.puntos;
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const score10 = Math.max(1, Math.min(10, Math.round(total / 10)));
  const tier = score10 >= 7 ? 'caliente' : score10 >= 5 ? 'tibio' : 'frio';
  return {
    total, score10, tier, desglose: s,
    accion: {
      caliente: 'Contactar por WhatsApp en menos de 1 hora y cotizar el itinerario que armó.',
      tibio: 'Contactar en el día: tiene itinerario armado, falta afinar fecha o presupuesto.',
      frio: 'Nutrir: no ve WhatsApp en la web. Retomar en 7 días con inspiración.',
    }[tier],
  };
}

// ¿Hay que hacer las preguntas extra? Solo si queda tibio y todavía no las respondió.
export function pideExtra(v, hoy) {
  const sc = scoreArmador(v, hoy);
  const falta = !v.reserva || !v.presupuesto_rango;
  return sc.tier === 'tibio' && falta;
}
