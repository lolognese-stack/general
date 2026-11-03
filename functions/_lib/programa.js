// Lógica del programa de 90 días compartida entre endpoints de Objetivos.
import defaults from '../../programa.config.json';

export const DEFAULTS = defaults;

export function objetivoSeguidores(p) {
  if (p.objetivo_seguidores) return p.objetivo_seguidores;
  if (p.seguidores_inicio == null) return null;
  return Math.max(defaults.seguidores_minimo, p.seguidores_inicio + defaults.seguidores_incremento);
}

// Lee la fila única; si no existe la crea desde programa.config.json.
export async function leerPrograma(db) {
  let row = await db.prepare('SELECT * FROM programa WHERE id = 1').first();
  if (!row) {
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO programa (id, objetivo_total_consultas, umbrales_json, curva_json, texto_objetivo, actualizado_en)
       VALUES (1, ?, ?, ?, ?, ?)`
    ).bind(
      defaults.objetivo_total_consultas,
      JSON.stringify(defaults.umbrales),
      JSON.stringify(defaults.curva),
      defaults.textos.objetivo_programa,
      now,
    ).run();
    row = await db.prepare('SELECT * FROM programa WHERE id = 1').first();
  }
  return hidratar(row);
}

// Deriva los indicadores de conversación a partir de la meta de consultas:
// conversaciones necesarias = consultas / pct_conv; por publicación = eso /
// piezas; por día = eso / 7. Si falta consultas o pct_conv, se respeta lo que
// venga escrito a mano (o queda vacío).
export function completarCurva(curva) {
  return curva.map((w) => {
    const out = { ...w };
    if (w.consultas != null && w.pct_conv) {
      const conversaciones = w.consultas / w.pct_conv;
      out.conv_dia = Math.round(conversaciones / 7);
      out.conv_pub = w.piezas ? Math.round(conversaciones / w.piezas) : (w.conv_pub ?? null);
      out.derivado = true;
    }
    return out;
  });
}

export function hidratar(row) {
  const p = {
    ...row,
    umbrales: JSON.parse(row.umbrales_json),
    curva: completarCurva(JSON.parse(row.curva_json)),
  };
  delete p.umbrales_json; delete p.curva_json;
  p.duracion_dias = defaults.duracion_dias;
  p.objetivo_seguidores_calculado = objetivoSeguidores(p);
  p.vencimiento_ajustado = p.fecha_dia_0
    ? sumarDias(p.fecha_dia_0, defaults.duracion_dias + (p.dias_pausa || 0))
    : null;
  const sumaCurva = p.curva.reduce((a, w) => a + (w.consultas || 0), 0);
  p.aviso_curva = sumaCurva !== p.objetivo_total_consultas
    ? `La curva suma ${sumaCurva} consultas y el objetivo es ${p.objetivo_total_consultas} (diferencia ${sumaCurva - p.objetivo_total_consultas}).`
    : null;
  return p;
}

export function sumarDias(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Semana N = [primera_publicacion + 7(N-1), +7). Bloques de 7 días corridos,
// no semanas de calendario.
export function rangoSemana(p, n) {
  if (!p.fecha_primera_publicacion) return { desde: null, hasta: null };
  const desde = sumarDias(p.fecha_primera_publicacion, 7 * (n - 1));
  const hasta = sumarDias(desde, 6);
  return { desde, hasta };
}

export function semanaActual(p, hoy = new Date().toISOString().slice(0, 10)) {
  if (!p.fecha_primera_publicacion || hoy < p.fecha_primera_publicacion) return 0;
  const ms = Date.parse(hoy + 'T00:00:00Z') - Date.parse(p.fecha_primera_publicacion + 'T00:00:00Z');
  return Math.floor(ms / 86400000 / 7) + 1;
}

// Estado de una métrica: real / objetivo contra los umbrales.
export function estadoDe(real, objetivo, umbrales) {
  if (objetivo == null || objetivo === 0) return null;
  if (real == null) return 'sin_datos';
  const r = real / objetivo;
  if (r >= umbrales.superado) return 'superado';
  if (r >= umbrales.cumplido) return 'cumplido';
  if (r >= umbrales.cerca) return 'cerca';
  return 'no_cumplido';
}

export const METRICAS = ['consultas', 'piezas', 'visitas_video', 'conv_pub', 'conv_dia', 'pct_conv', 'seguidores', 'ventas'];

// Arma las semanas del programa con objetivo, real y estado.
//
// De dónde sale `real`, en orden de prioridad:
//   1. semana cerrada -> metricas_json congelado (no cambia nunca más)
//   2. ajuste manual  -> última fila de `ajustes` para esa métrica
//   3. cálculo en vivo -> `vivo[numero][metrica]` (fase 4; hoy llega vacío)
// `fuente` dice cuál ganó, para que el panel lo muestre.
export async function resolverSemanas(db, programa, rol, vivo = {}, hoy = new Date().toISOString().slice(0, 10)) {
  const { results: notas } = await db.prepare('SELECT * FROM semanas ORDER BY numero').all();
  const { results: ajustes } = await db.prepare('SELECT * FROM ajustes ORDER BY id').all();
  const porNumero = Object.fromEntries(notas.map((s) => [s.numero, s]));
  const ajustePor = {};
  for (const a of ajustes) (ajustePor[a.semana] ||= {})[a.metrica] = a; // la última pisa

  const actual = semanaActual(programa, hoy);
  const u = programa.umbrales;
  const semanas = [];
  let acumReal = 0, acumPlan = 0, acumDeberia = 0;

  for (const w of programa.curva) {
    const n = w.semana;
    const s = porNumero[n] || {};
    const rango = rangoSemana(programa, n);
    const objetivo = {
      consultas: w.consultas ?? null, piezas: w.piezas ?? null, visitas_video: w.visitas_video ?? null,
      conv_pub: w.conv_pub ?? null, conv_dia: w.conv_dia ?? null, pct_conv: w.pct_conv ?? null,
      seguidores: w.seguidores ? programa.objetivo_seguidores_calculado : null,
      ventas: null,
    };
    const congelado = s.cerrada_en && s.metricas_json ? JSON.parse(s.metricas_json) : null;
    const real = {}; const fuente = {}; const original = {};
    for (const m of METRICAS) {
      if (congelado) { real[m] = congelado.real?.[m] ?? null; fuente[m] = 'congelado'; continue; }
      const aj = ajustePor[n]?.[m];
      if (aj) { real[m] = aj.valor_manual; fuente[m] = 'manual'; original[m] = aj.valor_original; continue; }
      const v = vivo[n]?.[m];
      real[m] = v ?? null; fuente[m] = v == null ? null : 'auto';
    }

    const estado = {};
    for (const m of METRICAS) estado[m] = estadoDe(real[m], objetivo[m], u);

    // Métrica principal de la semana: consultas si la semana tiene meta de
    // consultas, si no piezas (semana 1). El estado "de la semana" es ese.
    const principal = objetivo.consultas != null ? 'consultas' : (objetivo.piezas != null ? 'piezas' : null);
    let fase, estadoSemana = null, ritmo = null;
    if (!rango.desde) fase = 'sin_programa';
    else if (s.cerrada_en) { fase = 'cerrada'; estadoSemana = principal ? estado[principal] : null; }
    else if (n === actual) {
      fase = 'en_curso';
      // Ritmo: real / días transcurridos × 7. Día 1 = la fecha de inicio.
      const dias = Math.min(7, Math.floor((Date.parse(hoy + 'T00:00:00Z') - Date.parse(rango.desde + 'T00:00:00Z')) / 86400000) + 1);
      if (principal && real[principal] != null && dias > 0) {
        ritmo = { metrica: principal, dias, proyectado: Math.round(real[principal] / dias * 7) };
      }
    }
    else if (n > actual) fase = 'pendiente';
    else { fase = 'vencida'; estadoSemana = principal ? estado[principal] : null; } // pasó y no se cerró: se muestra con lo que haya

    if (objetivo.consultas != null) acumPlan += objetivo.consultas;
    if (n <= actual && objetivo.consultas != null) acumDeberia += objetivo.consultas;
    if (real.consultas != null) acumReal += real.consultas;

    const sem = {
      numero: n, ...rango, fase, es_actual: n === actual, cerrada_en: s.cerrada_en || null,
      objetivo, real, fuente, estado, estado_semana: estadoSemana, principal, ritmo,
      acumulado: { real: acumReal, plan: acumPlan },
      porque: s.porque || null, que_hacemos: s.que_hacemos || null,
    };
    if (rol === 'admin') {
      sem.nota_interna = s.nota_interna || null;
      sem.original = original;
      sem.vivo = vivo[n] || {};
      // Todos los ajustes de la semana, con id para poder borrarlos. Los
      // posteriores al cierre no mueven el número: quedan como nota.
      sem.ajustes = Object.fromEntries(Object.entries(ajustePor[n] || {}).map(([m, a]) => [m, {
        id: a.id, valor_original: a.valor_original, valor_manual: a.valor_manual, motivo: a.motivo,
        creado_en: a.creado_en, post_cierre: !!(s.cerrada_en && a.creado_en > s.cerrada_en),
      }]));
    }
    semanas.push(sem);
  }

  // Proyección al cierre: acumulado + promedio de las últimas 2 semanas con
  // dato (cerradas o vencidas, no la que está en curso) × semanas restantes.
  const conDato = semanas.filter((s) => s.fase !== 'en_curso' && s.fase !== 'pendiente' && s.real.consultas != null && s.objetivo.consultas != null);
  const ult2 = conDato.slice(-2);
  const restantes = semanas.filter((s) => (s.fase === 'pendiente' || s.fase === 'en_curso') && s.objetivo.consultas != null).length;
  const promedio = ult2.length ? ult2.reduce((a, s) => a + s.real.consultas, 0) / ult2.length : null;
  const proyeccion = promedio == null ? null : Math.round(acumReal + promedio * restantes);

  const diaPrograma = programa.fecha_dia_0 && hoy >= programa.fecha_dia_0
    ? Math.floor((Date.parse(hoy + 'T00:00:00Z') - Date.parse(programa.fecha_dia_0 + 'T00:00:00Z')) / 86400000)
    : null;

  return {
    semana_actual: actual,
    resumen: {
      acumulado: acumReal, deberiamos: acumDeberia, objetivo: programa.objetivo_total_consultas,
      proyeccion, promedio_ult2: promedio, semanas_restantes: restantes, dia_programa: diaPrograma,
    },
    semanas,
  };
}
