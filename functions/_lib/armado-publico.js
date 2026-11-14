// Armador de itinerario PÚBLICO de la web (/armar/ de lunallenatravel-web). Funciones puras.
//
// Arma una base día por día SIN PRECIOS con lo que publica la web (ct_web_productos + ct_web_dias, los mismos datos
// que usa el armado interno de Cotizaciones) y avisa lo que conviene revisar (altura, traslados largos, Machu Picchu
// antes de aclimatar). Nunca devuelve un campo de precio: todo sale por lista blanca (`diaPublico`).
//
// Candidatos por ciudad:
//   - tours de la web (hoy solo Cusco y Huaraz tienen tours sueltos);
//   - para las ciudades sin tours (Lima, Paracas, Ica, Nazca, Arequipa, Puno, Puerto Maldonado, Uyuni), los días de los
//     paquetes publicados en esa ciudad ("City tour Lima colonial y moderna", "Cañón del Colca" de 2 días, etc.).
import { tramosDe, recortar, destinosDePaquete, normCiudad } from './ct-armado.js';

// Destinos que ofrece el armador. `ciudad` es como la web nombra la ciudad en ct_web_dias / ciudad_base.
export const DESTINOS = [
  { id: 'lima', ciudad: 'Lima', nombre: 'Lima', sub: 'Capital gastronómica', noches: 2 },
  { id: 'paracas', ciudad: 'Paracas', nombre: 'Paracas', sub: 'Islas Ballestas', noches: 1 },
  { id: 'ica', ciudad: 'Ica', nombre: 'Ica y Huacachina', sub: 'Dunas y oasis', noches: 1 },
  { id: 'nazca', ciudad: 'Nazca', nombre: 'Nazca', sub: 'Líneas de Nazca', noches: 1 },
  { id: 'arequipa', ciudad: 'Arequipa', nombre: 'Arequipa y Colca', sub: 'Ciudad blanca y cañón', noches: 3 },
  { id: 'cusco', ciudad: 'Cusco', nombre: 'Cusco y Machu Picchu', sub: 'Valle Sagrado incluido', noches: 4 },
  { id: 'puno', ciudad: 'Puno', nombre: 'Puno y Titicaca', sub: 'Uros y Taquile', noches: 2 },
  { id: 'puerto-maldonado', ciudad: 'Puerto Maldonado', nombre: 'Amazonía (Tambopata)', sub: 'Selva y lodge', noches: 2 },
  { id: 'huaraz', ciudad: 'Huaraz', nombre: 'Huaraz', sub: 'Cordillera Blanca y treks', noches: 4 },
  { id: 'uyuni', ciudad: 'Uyuni', nombre: 'Salar de Uyuni', sub: 'Bolivia', noches: 2 },
];
export const RITMOS = ['tranquilo', 'equilibrado', 'a_full'];
const MAX_DIAS = 40;

// Lo que no se arma solo (como en el armado interno): retiros, ceremonias, clases.
const NO_AUTOMATICO = /ayahuasca|kambo|pachamama|espiritual|mistic|florecimiento|retiro|vivencial|free-|salsa|cooking|huachuma|realidad-virtual|mirabus|circuito-religioso/i;
// Orden de los tours de Cusco cuando no hay otra señal: lo que más venden los paquetes primero.
const PRIORIDAD = ['city-tour', 'valle-sagrado-vip-maras-moray', 'mapi-full-day-tren-turistico', 'montana-de-colores', 'laguna-humantay', 'valle-sur', 'valle-sagrado-tradicional', 'cuatrimotos-maras-moray', 'waqrapucara-full-day', 'puente-queswachaca', 'siete-lagunas-hot-spring', 'huchuyqosqo-full-day'];
const esMachuPicchu = (t) => /machu ?picchu|mapi|huayna/i.test(t || '');
const TITULO_PARTE = /\s*\((?:d[ií]a)\s*(\d+)\)\s*$/i;
const limpioTitulo = (t) => String(t || '').replace(/^llegada\s*\+\s*/i, '').replace(/^(ruta del sol|puno):\s*/i, '').replace(TITULO_PARTE, '').trim();
// Días de paquete que son traslados o que la web cargó en otra ciudad: no se ofrecen como actividad.
const NO_ES_ACTIVIDAD = /^salida$|^ruta del sol a |^puno$|valle sur/i;
const cap = (s, n) => (s == null ? null : String(s).slice(0, n));

function primeraFoto(p) {
  try { const f = typeof p.fotos === 'string' ? JSON.parse(p.fotos) : p.fotos; return Array.isArray(f) && f[0] ? String(f[0]) : null; } catch { return null; }
}

// web (cargarWeb) -> Map ciudadNorm -> [candidato]. Candidato: { clave, ciudad, nombre, resumen, foto, url, dias, partes:[{titulo, texto, foto}] }
export function candidatosPublicos(web) {
  const porCiudad = new Map();
  const add = (ciudad, c) => { const k = normCiudad(ciudad); (porCiudad.get(k) || porCiudad.set(k, []).get(k)).push(c); };
  const conTours = new Set();
  for (const p of web.filter((x) => x.tipo === 'tour' && x.ciudad_base)) {
    if (NO_AUTOMATICO.test(p.id) || Number(p.dias) > 10) continue;
    const dias = Math.max(1, Number(p.dias) || 1);
    const det = (p.dias_detalle || []).length === dias ? p.dias_detalle : null;
    conTours.add(normCiudad(p.ciudad_base));
    add(p.ciudad_base, {
      clave: `t:${p.id}`, ciudad: p.ciudad_base, nombre: p.nombre, resumen: cap(p.resumen, 300), foto: primeraFoto(p), url: p.url || null, dias,
      partes: Array.from({ length: dias }, (_, i) => ({ titulo: det ? (det[i].titulo || p.nombre) : dias > 1 ? `${p.nombre} (día ${i + 1} de ${dias})` : p.nombre, texto: cap(det ? det[i].relato : p.resumen, 400), foto: (det && det[i].foto) || primeraFoto(p) })),
    });
  }
  // Días de paquetes, solo para ciudades sin tours sueltos. "X (día 1)" + "X (día 2)" seguidos = una actividad de 2 días.
  const vistos = new Set();
  for (const p of web.filter((x) => x.tipo === 'paquete')) {
    const ds = p.dias_detalle || [];
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      const base = limpioTitulo(d.titulo);
      if (!d.ciudad || conTours.has(normCiudad(d.ciudad)) || NO_ES_ACTIVIDAD.test(base) || NO_ES_ACTIVIDAD.test((d.titulo || '').trim())) continue;
      const run = [d];
      if (TITULO_PARTE.test(d.titulo || '')) {
        while (i + run.length < ds.length && limpioTitulo(ds[i + run.length].titulo) === base && normCiudad(ds[i + run.length].ciudad) === normCiudad(d.ciudad)) run.push(ds[i + run.length]);
      }
      i += run.length - 1;
      const k = `${normCiudad(d.ciudad)}|${normCiudad(base)}`;
      if (vistos.has(k) || !base) continue;
      vistos.add(k);
      add(d.ciudad, {
        clave: `d:${p.id}:${d.dia}`, ciudad: d.ciudad, nombre: base, resumen: cap(d.relato, 300), foto: d.foto || null, url: p.url || null, dias: run.length,
        partes: run.map((x) => ({ titulo: limpioTitulo(x.titulo) + (run.length > 1 ? ` (día ${run.indexOf(x) + 1} de ${run.length})` : ''), texto: cap(x.relato, 400), foto: x.foto || null })),
      });
    }
  }
  for (const [k, lista] of porCiudad) {
    const pri = (c) => { const i = PRIORIDAD.indexOf(c.clave.slice(2)); return i < 0 ? 999 : i; };
    porCiudad.set(k, lista.sort((a, b) => (pri(a) - pri(b)) || (a.dias - b.dias) || a.nombre.localeCompare(b.nombre, 'es')));
  }
  return porCiudad;
}

// Índice clave -> candidato.
export function indiceCandidatos(porCiudad) {
  const m = new Map();
  for (const lista of porCiudad.values()) for (const c of lista) m.set(c.clave, c);
  return m;
}

export function destinosDisponibles(porCiudad) {
  return DESTINOS.map((d) => ({ id: d.id, ciudad: d.ciudad, nombre: d.nombre, sub: d.sub, noches: d.noches, disponible: (porCiudad.get(normCiudad(d.ciudad)) || []).length > 0 }));
}

// Pedido de la web -> destinos [{ciudad, noches, otro}] válidos. `otro:<texto>` = destino libre "a definir".
export function leerDestinos(lista) {
  const out = [];
  for (const x of Array.isArray(lista) ? lista.slice(0, 10) : []) {
    const noches = Math.max(1, Math.min(20, Math.round(Number(x && x.noches) || 1)));
    const id = String((x && x.id) || '');
    if (id.startsWith('otro:')) { const t = id.slice(5).trim().slice(0, 40); if (t) out.push({ ciudad: t, noches, otro: true }); continue; }
    const d = DESTINOS.find((y) => y.id === id);
    if (d) out.push({ ciudad: d.ciudad, noches, otro: false });
  }
  return out;
}

const alturaDe = (reglas, ciudad) => reglas.alturas.get(normCiudad(ciudad));

// ---------- base ----------
// { destinos:[{ciudad,noches,otro}], dias?, ritmo, desde? (id de paquete) } -> { titulo, dias:[dia], avisos }
export function armarBase({ destinos, dias = null, ritmo = 'equilibrado', desde = null, web, reglas }) {
  const porCiudad = candidatosPublicos(web);
  const idx = indiceCandidatos(porCiudad);
  let titulo = 'Tu viaje a medida';
  let destinosUsados = destinos;
  const notas = [];

  // Desde un paquete: sus días tal cual (cada día de la ficha queda como actividad, el cliente después la cambia).
  if (desde) {
    const p = web.find((x) => x.id === desde && x.tipo === 'paquete');
    if (p && (p.dias_detalle || []).length) {
      titulo = `Basado en ${p.nombre}`;
      const dd = p.dias_detalle;
      const seq = dd.map((d, i) => ({ ciudad: d.ciudad || p.ciudad_base, tipo: i === dd.length - 1 && dd.length > 1 && /^salida$/i.test(d.titulo || '') ? 'salida' : 'actividad', paquete: { id: p.id, dia: d.dia, titulo: d.titulo, texto: d.relato, foto: d.foto } }));
      const out = componer(seq, { idx, reglas, porCiudad });
      return { titulo, desde: p.id, ...out };
    }
    notas.push('No encontramos ese paquete: armamos uno a medida con los mismos destinos.');
  }
  if (!destinosUsados.length) return { titulo, dias: [], avisos: [], resumen: null };

  const noches = destinosUsados.reduce((n, d) => n + d.noches, 0);
  let total = Number(dias) || noches + 1;
  total = Math.max(1, Math.min(MAX_DIAS, total));
  if (noches + 1 > total) {
    const r = recortar(destinosUsados.map((d) => ({ ...d })), total);
    destinosUsados = r.destinos.map((d) => ({ ...d, otro: destinos.find((x) => x.ciudad === d.ciudad)?.otro || false }));
    if (r.avisos.length) notas.push(`Para que entre en ${total} días acortamos el recorrido. Puedes sumar días abajo.`);
  } else if (noches + 1 < total) {
    const u = destinosUsados.length - 1;
    destinosUsados = destinosUsados.map((d, i) => (i === u ? { ...d, noches: d.noches + (total - noches - 1) } : d));
  }

  const { tramos } = tramosDe(destinosUsados);
  const N = tramos[tramos.length - 1].hasta;
  const seq = [];
  for (let d = 1; d <= N; d++) {
    const t = tramos.find((x) => d >= x.desde && d < x.hasta) || tramos[tramos.length - 1];
    const otro = destinosUsados.find((x) => x.ciudad === t.ciudad)?.otro;
    seq.push({ ciudad: t.ciudad, otro: !!otro, tipo: 'libre', clave: null });
  }
  // Llenar los días del medio de cada estadía según el ritmo.
  const usadas = new Set();
  const bloques = bloquesDe(seq);
  bloques.forEach((b, bi) => {
    if (seq[b.desde].otro) return;
    const cands = (porCiudad.get(normCiudad(b.ciudad)) || []).filter((c) => !usadas.has(c.clave));
    const alto = (alturaDe(reglas, b.ciudad) ?? 0) >= 2500;
    // Días disponibles: del segundo día de la estadía al último (el traslado es el primer día de la ciudad siguiente; el último día del viaje es la salida).
    const libres = [];
    for (let d = b.desde + 1; d <= b.hasta; d++) if (!(d === N && N > 1)) libres.push(d);
    // a full: también el día de llegada si la ciudad es baja y el traslado no lleva el día.
    if (ritmo === 'a_full' && !alto && !trasladoLargo(reglas, bloques[bi - 1], b)) libres.unshift(b.desde);
    // tranquilo: deja libre uno de cada tres días de estadía.
    const usar = ritmo === 'tranquilo' ? libres.filter((_, i) => (i + 1) % 3 !== 0) : libres;
    const ocupado = new Set();
    for (const d of usar) {
      if (ocupado.has(d)) continue;
      // Machu Picchu nunca en el primer día disponible de Cusco si se llega de abajo (mejor aclimatar).
      const primerDia = d === usar[0];
      const c = cands.find((x) => !usadas.has(x.clave) && x.dias <= contiguos(usar, ocupado, d) &&!(primerDia && alto && esMachuPicchu(x.clave + x.nombre)));
      if (!c) continue;
      for (let k = 0; k < c.dias; k++) { ocupado.add(d + k); seq[d + k - 1] = { ...seq[d + k - 1], tipo: 'actividad', clave: c.clave, parte: k + 1 }; }
      usadas.add(c.clave);
    }
  });
  const out = componer(seq, { idx, reglas, porCiudad });
  if (notas.length) out.avisos.unshift(...notas.map((texto) => ({ dia: null, texto, arreglo: null })));
  return { titulo, desde: null, ...out };
}

function trasladoLargo(reglas, previo, b) {
  if (!previo) return false;
  const c = reglas.conexiones.get(`${normCiudad(previo.ciudad)}>${normCiudad(b.ciudad)}`);
  return !!(c && c.dia_completo);
}

// Cuántos días seguidos libres hay desde `d` dentro de `usar`.
function contiguos(usar, ocupado, d) {
  let n = 0;
  while (usar.includes(d + n) && !ocupado.has(d + n)) n++;
  return n;
}

// Bloques de días seguidos en la misma ciudad (índices 1-based). El día 1 y cada cambio de ciudad abren bloque.
export function bloquesDe(seq) {
  const out = [];
  seq.forEach((x, i) => {
    const d = i + 1, ult = out[out.length - 1];
    if (ult && normCiudad(ult.ciudad) === normCiudad(x.ciudad)) ult.hasta = d; else out.push({ ciudad: x.ciudad, desde: d, hasta: d });
  });
  return out;
}

// ---------- componer + validar ----------
// seq: [{ ciudad, tipo, clave?, parte?, otro?, paquete? }] en orden de días. Rehace cada día desde el catálogo (el texto del
// cliente nunca se usa), arregla actividades de varios días cortadas y calcula los avisos.
export function componer(seq, { idx, reglas, porCiudad }) {
  const N = seq.length;
  const dias = seq.map((x, i) => ({ ...x, dia: i + 1 }));
  // Actividades de varios días: tienen que estar completas y seguidas; si no, el día queda libre.
  for (let i = 0; i < N; i++) {
    const x = dias[i];
    if (!x.clave) continue;
    const c = idx.get(x.clave);
    if (!c || normCiudad(c.ciudad) !== normCiudad(x.ciudad)) { dias[i] = { ...x, clave: null, tipo: 'libre' }; continue; }
    if (c.dias > 1) {
      const p = Number(x.parte) || 1;
      const ok = p === 1 && Array.from({ length: c.dias }, (_, k) => dias[i + k] && dias[i + k].clave === c.clave && (Number(dias[i + k].parte) || 1) === k + 1).every(Boolean);
      if (!ok) {
        if (p === 1 || !(i > 0 && dias[i - 1].clave === c.clave)) for (let k = i; k < N && dias[k].clave === c.clave; k++) dias[k] = { ...dias[k], clave: null, tipo: 'libre' };
        continue;
      }
      i += c.dias - 1;
    }
  }
  const bloques = bloquesDe(dias);
  const out = dias.map((x, i) => {
    const d = i + 1;
    const b = bloques.find((y) => d >= y.desde && d <= y.hasta);
    const bi = bloques.indexOf(b);
    let tipo = x.tipo, titulo = '', texto = null, foto = null, url = null, clave = null, parte = null, de = null;
    const c = x.clave ? idx.get(x.clave) : null;
    if (x.paquete) { titulo = String(x.paquete.titulo || '').trim() || x.ciudad; texto = cap(x.paquete.texto, 400); foto = x.paquete.foto || null; }
    if (c) { const p = c.partes[(Number(x.parte) || 1) - 1] || c.partes[0]; titulo = p.titulo; texto = p.texto; foto = p.foto; url = c.url; clave = c.clave; parte = Number(x.parte) || 1; de = c.dias; tipo = 'actividad'; }
    const llegada = d === b.desde;
    const salida = d === N && N > 1;
    if (x.otro && !(salida && !c)) { tipo = 'otro'; titulo = `${x.ciudad}: a definir con tu asesor`; texto = 'Este destino lo armamos contigo: cuéntale a tu asesor qué te gustaría hacer.'; }
    else if (!c && (!x.paquete || x.otro)) {
      if (salida) { tipo = 'salida'; titulo = `Salida desde ${x.ciudad}`; texto = 'Traslado al aeropuerto o a la estación según tu horario.'; }
      else if (llegada) { tipo = bi === 0 ? 'llegada' : 'traslado'; titulo = bi === 0 ? `Llegada a ${x.ciudad}` : `Traslado a ${x.ciudad}`; texto = bi === 0 ? 'Te recibimos y te llevamos al hotel. Resto del día libre.' : `Viaje de ${bloques[bi - 1].ciudad} a ${x.ciudad} y check-in.`; }
      else { tipo = 'libre'; titulo = `Día libre en ${x.ciudad}`; texto = 'Para descansar, recorrer a tu ritmo o sumar una excursión.'; }
    } else if (x.paquete && salida && tipo === 'salida') { titulo = `Salida desde ${x.ciudad}`; }
    return { dia: d, ciudad: cap(x.ciudad, 40), tipo, titulo: cap(titulo, 160), texto, foto, url, clave, parte, de, llegada, otro: !!x.otro, paquete: x.paquete ? { id: x.paquete.id, dia: x.paquete.dia } : null };
  });
  return { dias: out, avisos: avisosPublicos(out, bloques, reglas), resumen: resumenDe(out, bloques) };
}

function resumenDe(dias, bloques) {
  return { dias: dias.length, ciudades: bloques.map((b) => b.ciudad).filter((c, i, a) => a.indexOf(c) === i), recorrido: bloques.map((b) => b.ciudad).join(' · ') };
}

// Avisos para el cliente (tono amable). Cada uno puede traer un arreglo que el armador aplica con un botón.
export function avisosPublicos(dias, bloques, reglas) {
  const av = [];
  const tope = reglas.aclimatacion?.altura_aviso_m ?? 3000;
  bloques.forEach((b, bi) => {
    const h = alturaDe(reglas, b.ciudad);
    const previa = bi ? alturaDe(reglas, bloques[bi - 1].ciudad) : null;
    const llegaDeAbajo = h != null && h >= tope && (previa == null || previa < 2500);
    const dLleg = dias[b.desde - 1];
    if (llegaDeAbajo && dLleg.tipo === 'actividad' && !dLleg.paquete) {
      av.push({ dia: b.desde, texto: `Día ${b.desde}: llegas a ${b.ciudad} (${h.toLocaleString('es-PE')} m). Te recomendamos un primer día tranquilo para aclimatarte.`, arreglo: { tipo: 'libre', dia: b.desde } });
    }
    if (llegaDeAbajo) {
      // Machu Picchu en el primer o segundo día en altura.
      for (let d = b.desde; d <= Math.min(b.hasta, b.desde + 1); d++) {
        const x = dias[d - 1];
        if (x.tipo === 'actividad' && !x.paquete && esMachuPicchu(`${x.clave || ''} ${x.titulo}`) && (x.parte || 1) === 1) {
          const otro = dias.slice(d, b.hasta).find((y) => y.tipo !== 'salida' && (y.de || 1) === 1 && !esMachuPicchu(`${y.clave || ''} ${y.titulo}`) && y.dia > d);
          av.push({ dia: d, texto: `Día ${d}: conviene hacer Machu Picchu después de un par de días en ${b.ciudad}, ya aclimatado.`, arreglo: otro && (x.de || 1) === 1 ? { tipo: 'intercambiar', dia: d, con: otro.dia } : null });
          break;
        }
      }
    }
    if (bi > 0) {
      const c = reglas.conexiones.get(`${normCiudad(bloques[bi - 1].ciudad)}>${normCiudad(b.ciudad)}`);
      if (c && c.dia_completo && dLleg.tipo === 'actividad' && !dLleg.paquete) av.push({ dia: b.desde, texto: `Día ${b.desde}: el viaje de ${bloques[bi - 1].ciudad} a ${b.ciudad} toma unas ${c.horas} horas. Mejor sin excursión ese día.`, arreglo: { tipo: 'libre', dia: b.desde } });
    }
  });
  const ult = dias[dias.length - 1];
  if (dias.length > 1 && ult.tipo === 'actividad' && !ult.paquete && (ult.de || 1) === 1) av.push({ dia: ult.dia, texto: `Día ${ult.dia}: es tu día de salida. Una excursión ese día depende del horario de tu vuelo.`, arreglo: { tipo: 'libre', dia: ult.dia } });
  return av;
}

// Para el CRM: el itinerario en el formato de leads.itinerario (migración 048): un tramo por ciudad.
export function itinerarioLead(dias, fechaInicio = null) {
  const tramos = [];
  const fecha = (d) => {
    if (!fechaInicio) return null;
    const t = Date.parse(`${fechaInicio}T12:00:00Z`);
    return Number.isFinite(t) ? new Date(t + (d - 1) * 86400e3).toISOString().slice(0, 10) : null;
  };
  for (const x of dias) {
    const ult = tramos[tramos.length - 1];
    const dia = { fecha: fecha(x.dia), lugar: x.ciudad, detalle: `Día ${x.dia} · ${x.titulo}` };
    if (ult && normCiudad(ult.titulo) === normCiudad(x.ciudad)) ult.dias.push(dia); else tramos.push({ titulo: x.ciudad, dias: [dia] });
  }
  return tramos;
}

// Excursiones del itinerario (para precargar "Nuevo pedido" en Cotizaciones): nombres de las actividades.
export function excursionesDe(dias) {
  const out = [];
  for (const x of dias) {
    if (x.tipo !== 'actividad' || (x.parte || 1) !== 1) continue;
    // Días de un paquete: el título tal cual (sin "(día N)"); traslados y salida no son excursiones.
    const n = x.paquete ? String(x.titulo || '').replace(/^llegada\s*\+\s*/i, '').replace(TITULO_PARTE, '').trim() : limpioTitulo(String(x.titulo).replace(/\s*\(día \d+ de \d+\)$/, ''));
    if (n && !NO_ES_ACTIVIDAD.test(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

// Lo que el navegador manda al editar -> seq para componer. Solo campos conocidos.
export function leerSeq(lista) {
  return (Array.isArray(lista) ? lista.slice(0, MAX_DIAS) : []).map((x) => ({
    ciudad: cap(String((x && x.ciudad) || '').trim(), 40) || 'Perú',
    tipo: x && x.clave ? 'actividad' : 'libre',
    clave: typeof (x && x.clave) === 'string' && /^(t|d):[\w:-]{1,120}$/.test(x.clave) ? x.clave : null,
    parte: Math.max(1, Math.min(20, Number(x && x.parte) || 1)),
    otro: !!(x && x.otro),
    paquete: x && x.paquete && typeof x.paquete.id === 'string' ? { id: x.paquete.id.slice(0, 80), dia: Number(x.paquete.dia) || 0 } : null,
  }));
}

// Restituye el texto de los días que vienen de un paquete (el navegador solo manda id y día).
export function hidratarPaquetes(seq, web) {
  return seq.map((x) => {
    if (!x.paquete) return x;
    const p = web.find((y) => y.id === x.paquete.id);
    const d = p && (p.dias_detalle || []).find((y) => Number(y.dia) === x.paquete.dia);
    return d ? { ...x, tipo: 'actividad', paquete: { id: p.id, dia: d.dia, titulo: d.titulo, texto: d.relato, foto: d.foto } } : { ...x, paquete: null, tipo: 'libre' };
  });
}

// Paquetes para "Personalizar este viaje".
export function paquetesPublicos(web) {
  return web.filter((p) => p.tipo === 'paquete' && (p.dias_detalle || []).length).map((p) => ({ id: p.id, nombre: p.nombre, dias: p.dias, destinos: destinosDePaquete(p).map((d) => d.ciudad) }));
}
