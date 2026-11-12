// Seguimientos post propuesta: secuencia de toques y cálculo de cuál toca hoy.
// Sin dependencias de Cloudflare en la lógica, para poder probarla con node (crm/probar-seguimientos.mjs).
//
// Reglas:
// - Día 0 = el día en que se apretó "Propuesta enviada" (hora de Lima).
// - Los toques van en orden y de a uno: el que sigue vence el día de la secuencia (dia0 + dia) o,
//   si el anterior se hizo tarde, la misma distancia después de ese (así nunca se juntan dos el mismo día).
// - Solo se muestra un toque por persona: el próximo sin hacer, si ya venció.
// - "Retomar" arranca desde el toque de 30, 60 o 90 días y lo hace vencer el día que se retoma.

export const ZONA = 'America/Lima';

// Textos dados por Luna Llena (12/11/2026). [Nombre] se reemplaza solo; [novedad real] y [lugar] los completa
// la persona antes de mandar. Se pueden pisar desde propuestas_config, clave 'seguimientos_secuencia' (JSON).
export const SECUENCIA_BASE = [
  {
    dia: 2, clave: 'ajustes', tipo: 'texto', titulo: 'Ajustes',
    texto: '¡Hola, [Nombre]! ¿Qué les pareció su viaje? Si quieren sacar o sumar alguna excursión, o tener más tiempo libre en algún lugar, me avisan y les paso la versión ajustada.',
    textoSinAbrir: '¡Hola, [Nombre]! ¿Pudieron abrir la propuesta? Cualquier cosa me avisan y se la reenvío.',
  },
  {
    dia: 5, clave: 'pasaporte', tipo: 'texto', titulo: 'Pasaporte',
    texto: '¡Hola, [Nombre]! Un dato importante para su viaje: para entrar a Perú, el pasaporte tiene que tener al menos 6 meses de vigencia 🛂 Y en Machu Picchu piden el original, el mismo con el que se compra la entrada; la fotocopia no sirve. Si no se acuerdan cuándo vence el suyo, revísenlo por las dudas. Cualquier duda que tengan sobre su viaje, me consultan 😊',
  },
  {
    dia: 8, clave: 'audio', tipo: 'grabar', medio: 'audio', titulo: 'Audio de Álvaro',
    texto: 'Hola, [Nombre], ¿cómo están? Quería saber en qué están con el viaje. Si hay algo que no les termina de cerrar, sea el precio, las fechas o algún tour, díganme con total confianza y lo ajustamos.',
  },
  {
    dia: 12, clave: 'cupos', tipo: 'texto', titulo: 'Cupos de Machu Picchu',
    // A solo con "revisé disponibilidad" marcado: si no, la frase de los cupos sería falsa.
    textoConDisponibilidad: '¡Hola, [Nombre]! Les cuento que los cupos para Machu Picchu en sus fechas se están empezando a llenar. Las entradas tienen cupo por día y se reservan con meses de anticipación. Avísenme si quieren ajustar algo de la propuesta, así reservan su lugar y se quedan tranquilos 😊',
    texto: '¡Hola, [Nombre]! Un dato importante: las entradas a Machu Picchu tienen cupo por día y se reservan con meses de anticipación, sobre todo en temporada alta. Avísenme si quieren ajustar algo de la propuesta, así reservan su lugar y se quedan tranquilos 😊',
  },
  {
    dia: 15, clave: 'cierre', tipo: 'grabar', medio: 'video', titulo: 'Video de cierre de Álvaro',
    texto: 'Hola, [Nombre], ¿cómo están? Soy Álvaro, de Luna Llena. Les grabo este video cortito para no llenarlos de mensajes. Me imagino que por ahora no es el momento del viaje, y está perfecto. Su propuesta queda guardada: cuando quieran retomarla, me escriben y la ajustamos. ¡Un abrazo grande!',
  },
  {
    dia: 30, clave: 'novedad', tipo: 'texto', titulo: 'Dato o novedad', completar: '[novedad real]',
    texto: '¡Hola, [Nombre]! ¿Cómo están? Les comparto algo que puede servirles si siguen pensando en Perú: [novedad real] ☀️ Su propuesta sigue guardada, por si quieren retomarla.',
  },
  {
    dia: 60, clave: 'inspiracion', tipo: 'texto', titulo: 'Inspiración', completar: '[lugar]', adjunto: 'foto',
    texto: '¡Hola, [Nombre]! Así estaba [lugar] esta semana 📸 Me acordé de su viaje. Cuando quieran retomarlo, aquí estamos.',
  },
  {
    dia: 90, clave: 'reactivacion', tipo: 'texto', titulo: 'Reactivación',
    texto: '¡Hola, [Nombre]! ¿Cómo están? Hace unos meses armamos juntos su viaje a Perú. ¿Siguen con ganas de hacerlo? Si quieren, se lo actualizo con fechas y precios nuevos, sin compromiso.',
  },
];

// Días desde los que se puede retomar una secuencia frenada.
export const RETOMAR_DESDE = [30, 60, 90];

export function hoyLima(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const MS_DIA = 86400000;
const aMs = (f) => Date.parse(f + 'T12:00:00Z');
export function sumarDias(fecha, n) { return new Date(aMs(fecha) + n * MS_DIA).toISOString().slice(0, 10); }
export function diasEntre(desde, hasta) { return Math.round((aMs(hasta) - aMs(desde)) / MS_DIA); }

// Secuencia efectiva: la guardada en config (si es válida) o la base. Siempre ordenada por día.
export function secuencia(guardada) {
  let s = SECUENCIA_BASE;
  if (guardada) {
    try {
      const v = typeof guardada === 'string' ? JSON.parse(guardada) : guardada;
      if (Array.isArray(v) && v.length && v.every((t) => Number.isInteger(t.dia) && t.dia > 0 && t.clave && (t.texto || t.tipo === 'grabar'))) s = v;
    } catch { /* se usa la base */ }
  }
  return [...s].sort((a, b) => a.dia - b.dia);
}

// Próximo toque de un seguimiento.
// seg: fila de propuesta_seguimientos · toques: filas de propuesta_toques de ese slug · hoy: YYYY-MM-DD.
// Devuelve null si la secuencia no está activa o ya terminó; si no, { toque, vence, atraso, vencido }.
export function proximoToque(seg, toques, sec, hoy) {
  if (!seg || seg.estado !== 'activa') return null;
  const hechos = new Map();
  for (const t of toques || []) if (!hechos.has(t.dia) || t.fecha > hechos.get(t.dia)) hechos.set(t.dia, t.fecha);
  let base = seg.dia0, diaBase = 0;
  const desde = seg.retomado_desde || 0;
  for (const t of sec) {
    if (t.dia < desde) continue;
    let vence;
    // retomado_en puede venir como fecha (YYYY-MM-DD) o como momento ISO: vence ese día, hora de Lima.
    if (desde && t.dia === desde) vence = seg.retomado_en ? (seg.retomado_en.length > 10 ? hoyLima(new Date(seg.retomado_en)) : seg.retomado_en) : sumarDias(seg.dia0, t.dia);
    else vence = [sumarDias(seg.dia0, t.dia), sumarDias(base, t.dia - diaBase)].sort().pop();
    if (hechos.has(t.dia)) { base = hechos.get(t.dia); diaBase = t.dia; continue; }
    const atraso = diasEntre(vence, hoy);
    return { toque: t, vence, atraso: Math.max(0, atraso), vencido: atraso >= 0 };
  }
  return null; // se hicieron todos
}

// Texto listo para mandar. abrio: si abrió la propuesta alguna vez (cambia el toque del día 2).
export function textoDe(t, { nombre, abrio = true, revisoDisponibilidad = false } = {}) {
  let x = t.texto || '';
  if (t.textoSinAbrir && !abrio) x = t.textoSinAbrir;
  if (t.textoConDisponibilidad && revisoDisponibilidad) x = t.textoConDisponibilidad;
  const n = (nombre || '').trim().split(/\s+/)[0] || '';
  return n ? x.replace(/\[Nombre\]/g, n) : x.replace(/,?\s*\[Nombre\]/g, '');
}

// Desde qué día retomar según cuánto pasó desde el día 0: el primero de 30/60/90 que todavía no pasó
// (o 90 si ya pasaron todos).
export function retomarDesde(dia0, hoy) {
  const d = diasEntre(dia0, hoy);
  return RETOMAR_DESDE.find((x) => x >= d) || RETOMAR_DESDE[RETOMAR_DESDE.length - 1];
}

// "Caliente": en las últimas 48 h tocó reservar/ver-reserva/duda, vio la sección reserva,
// estuvo más de 3 minutos o la abrió 2 veces o más. eventos: filas de propuesta_eventos (creado_en UTC).
export function caliente(eventos, ahora = new Date()) {
  const desde = ahora.getTime() - 48 * 3600 * 1000;
  const rec = (eventos || []).filter((e) => Date.parse(String(e.creado_en).replace(' ', 'T') + (String(e.creado_en).endsWith('Z') ? '' : 'Z')) >= desde);
  if (rec.some((e) => e.evento === 'cta' && ['reservar', 'ver-reserva', 'duda', 'barra-reserva'].includes(e.detalle))) return true;
  if (rec.some((e) => e.evento === 'seccion' && e.detalle === 'reserva')) return true;
  if (rec.filter((e) => e.evento === 'tiempo').reduce((s, e) => s + (Number(e.detalle) || 0), 0) > 180) return true;
  return rec.filter((e) => e.evento === 'apertura').length >= 2;
}
