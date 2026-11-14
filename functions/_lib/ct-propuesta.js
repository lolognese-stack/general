// Cotización aprobada -> propuesta web (luna-llena-propuestas). Función pura: la usa /api/ct y la prueba crm/probar-propuesta.mjs.
//
// La integración no es directa: una propuesta publicada es una carpeta <slug>/ en el repo luna-llena-propuestas con
//   base.html       la página que arma el armador (luna-llena-armador) a partir de un texto de cotización
//   propuesta.json  los datos de venta (número, vencimiento, precio por persona, tags…)
// y se publica con build + deploy en Vercel. Esto deja listos los dos insumos:
//   texto_armador   cotización en texto, como la mandaría un agente: se abre en Cotizador > Propuesta del panel
//   propuesta_json  borrador de propuesta.json; scripts/desde-cotizacion.mjs lo copia a la carpeta nueva
// REGLA: nada de netos, márgenes, proveedores ni notas internas. Solo precios de venta.

import { normalizar } from './tarifario.js';
import { sumarDias } from './cotizar.js';

export const DIAS_VALIDEZ_PROPUESTA = 15;

const DS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const diaTxt = (iso) => `${DS[new Date(iso + 'T12:00:00Z').getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const usd = (cent) => (cent / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const a2 = (cent) => Math.round(cent) / 100;
const HAB = { SGL: 'simple', DBL: 'doble', TPL: 'triple' };

// Tags que usa la propuesta (testimonios por tag, cancelación de 30 días con 'trekking').
const PALABRAS = [
  [/machu\s*picchu/i, 'machu-picchu'], [/valle\s*sagrado/i, 'valle-sagrado'], [/humantay/i, 'humantay'],
  [/monta[ñn]a.*colores|7\s*colores|vinicunca/i, 'montaña-colores'], [/cuatrimoto/i, 'cuatrimotos'],
  [/nazca/i, 'nazca'], [/huacachina|paracas|\bica\b/i, 'ica'], [/titicaca|uros|amantan[ií]|taquile/i, 'puno'],
  [/trek|camino inca|salkantay|huayhuash|choquequirao/i, 'trekking'],
];

const listaY = (xs) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;

export function slugSugerido(nombre, azar) {
  const base = normalizar(String(nombre || 'cliente').split(/\s+/)[0]).slice(0, 30) || 'cliente';
  return `${base}-${azar}`;
}

// vista = vistaCotizacion(); servicios = catálogo (para "incluye"); hoy = YYYY-MM-DD (Lima)
export function paraPropuesta(vista, { servicios = [], hoy, azar = '000000' } = {}) {
  const { cotizacion: c, pedido: p, lineas, totales: t } = vista;
  const errores = [];
  if (c.estado !== 'aprobada') errores.push('La cotización no está aprobada');
  if (c.usa_prueba) errores.push('Usa PRECIOS DE PRUEBA: no puede ir a una propuesta para el cliente');
  if (t.problemas) errores.push('Hay líneas sin precio');
  if (!p.fecha_inicio || !p.fecha_fin) errores.push('El pedido no tiene fechas de inicio y fin');
  if (errores.length) return { errores };

  const pax = Math.max(1, Number(p.pasajeros) || 1);
  const ventaHotel = lineas.filter((l) => l.tipo === 'hotel').reduce((s, l) => s + l.venta_cent, 0);
  const totalPP = Math.round(t.venta_cent / pax);
  const alojPP = Math.round(ventaHotel / pax);
  const ciudades = p.destinos.map((d) => d.ciudad);

  const tags = new Set(ciudades.map((x) => normalizar(x)).filter(Boolean));
  for (const l of lineas) for (const [re, tag] of PALABRAS) if (re.test(l.descripcion)) tags.add(tag);

  const propuesta_json = {
    numero: `CT-${p.id}-v${c.version}`,
    cliente: String(p.nombre).trim().split(/\s+/)[0],
    validUntil: sumarDias(hoy, DIAS_VALIDEZ_PROPUESTA),
    status: 'enviada',
    version: 1,
    updatedAt: hoy,
    changelog: [{ version: 1, fecha: hoy, texto: 'Propuesta enviada.' }],
    videoUrl: null,
    viaje: { nombre: `Perú: ${listaY(ciudades)}`, pais: 'Perú', inicio: p.fecha_inicio, fin: p.fecha_fin, pasajeros: pax },
    precio: { totalPP: a2(totalPP), desglosePP: { alojamiento: a2(alojPP), tours: a2(totalPP - alojPP) } },
    tags: [...tags],
    pdf: null,
    fuentes: { cotizacion: `CRM · pedido ${p.id} · cotización versión ${c.version} (aprobada por ${c.aprobada_por || '—'} el ${String(c.aprobada_en || '').slice(0, 10)})` },
    pago: {},
    opcionales: [],
    confirmado: null,
  };

  // Texto para el armador: lo que vería el cliente (sin netos ni notas internas).
  const porDia = new Map();
  for (const l of lineas) if (l.tipo !== 'hotel') (porDia.get(l.dia) || porDia.set(l.dia, []).get(l.dia)).push(l);
  const nDias = Math.max(1, p.destinos.reduce((s, d) => s + d.noches, 0) + 1, ...lineas.map((l) => l.dia || 1));
  const dias = [];
  for (let d = 1; d <= nDias; d++) {
    const items = (porDia.get(d) || []).map((l) => l.descripcion);
    dias.push(`Día ${d} (${diaTxt(sumarDias(p.fecha_inicio, d - 1))}): ${items.length ? items.join(' + ') : 'libre'}`);
  }
  const hoteles = lineas.filter((l) => l.tipo === 'hotel').map((l) => {
    const nombre = l.descripcion.split(' · ')[0];
    return `- Día ${l.dia}: ${nombre}, ${l.cantidad} noche${l.cantidad > 1 ? 's' : ''}, ${l.unidades} habitación${l.unidades > 1 ? 'es' : ''} ${HAB[l.habitacion] || ''}`.trim();
  });
  const incluye = [], noIncluye = [];
  for (const l of lineas) {
    const s = servicios.find((x) => x.id === l.servicio_id);
    if (s && s.incluye) incluye.push(`${s.nombre}: ${s.incluye}`);
    if (s && s.no_incluye) noIncluye.push(`${s.nombre}: ${s.no_incluye}`);
  }
  const texto_armador = [
    `Cotización aprobada · Luna Llena Travel · ${propuesta_json.numero}`,
    `Pasajero: ${p.nombre} · ${pax} persona${pax > 1 ? 's' : ''}${p.pais ? ' · ' + p.pais : ''}`,
    `Fechas: del ${p.fecha_inicio} al ${p.fecha_fin} · Fecha de llegada (día 1): ${p.fecha_inicio}`,
    `Destinos: ${p.destinos.map((d) => `${d.ciudad} (${d.noches} noche${d.noches === 1 ? '' : 's'})`).join(', ')}`,
    p.pedidos_especiales ? `Pedidos del cliente: ${p.pedidos_especiales}` : '',
    '', 'Itinerario:', ...dias,
    hoteles.length ? '\nAlojamiento:' : '', ...hoteles,
    '',
    `Precio total por persona: USD ${usd(totalPP)} (total del grupo USD ${usd(t.venta_cent)})`,
    hoteles.length ? `Desglose por persona: alojamiento USD ${usd(alojPP)} · tours y traslados USD ${usd(totalPP - alojPP)}` : '',
    incluye.length ? `\nIncluye:\n${incluye.map((x) => '- ' + x).join('\n')}` : '',
    noIncluye.length ? `\nNo incluye:\n${noIncluye.map((x) => '- ' + x).join('\n')}` : '',
  ].filter((x) => x !== '').join('\n');

  return { slug: slugSugerido(p.nombre, azar), propuesta_json, texto_armador };
}
