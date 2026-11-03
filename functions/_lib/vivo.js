// Cálculo automático de las métricas del programa, semana por semana,
// desde lo que el panel ya tiene en D1. Devuelve { [numero]: { metrica: valor } }
// para pasarle a resolverSemanas; ahí un ajuste manual o una semana cerrada
// pisan lo que sale de acá.
//
// Fuentes:
//   consultas   -> leads que entraron por formulario (Tally: submission_id;
//                  home: fuente 'Página web'), una sola vez por persona
//                  (mismo WhatsApp o mail), por COALESCE(fecha_alta, creado_en).
//   ventas      -> eventos con etapa_hasta='ganado' (fecha real del cierre).
//   piezas      -> piezas con estado 'Subido' y fecha en la semana.
//   visitas_video / conv_pub -> promedio de views / comentarios de esas piezas.
//   conv_dia    -> suma de comentarios de la semana / 7.
//   pct_conv    -> consultas / suma de comentarios.
//   seguidores  -> followers_count de demografia_ig menos los new_followers
//                  posteriores al fin de la semana (no hay serie de totales).
import { rangoSemana } from './programa.js';

const dia = (v) => (v ? String(v).slice(0, 10) : null);
const normTel = (t) => (t || '').replace(/\D/g, '').replace(/^54?9?/, '') || null;
const normMail = (m) => (m || '').trim().toLowerCase() || null;

export async function calcularVivo(db, programa, hoy = new Date().toISOString().slice(0, 10)) {
  if (!programa.fecha_primera_publicacion) return {};
  const semanas = programa.curva.map((w) => ({ n: w.semana, ...rangoSemana(programa, w.semana) }))
    .filter((s) => s.desde && s.desde <= hoy);
  if (!semanas.length) return {};
  const desde = semanas[0].desde, hasta = semanas[semanas.length - 1].hasta;
  const semanaDe = (ymd) => semanas.find((s) => ymd >= s.desde && ymd <= s.hasta)?.n;
  const vivo = {};
  for (const s of semanas) vivo[s.n] = { consultas: 0, ventas: 0, piezas: 0, _views: [], _com: [] };

  // --- consultas ---
  const { results: leads } = await db.prepare(
    `SELECT whatsapp, email, COALESCE(fecha_alta, creado_en) AS f
     FROM leads
     WHERE (submission_id IS NOT NULL OR fuente = 'Página web')
     ORDER BY COALESCE(fecha_alta, creado_en)`
  ).all();
  const vistos = new Set();
  for (const l of leads) {
    const tel = normTel(l.whatsapp), mail = normMail(l.email);
    // Persona repetida = mismo teléfono o mismo mail que alguien anterior.
    if ((tel && vistos.has('t:' + tel)) || (mail && vistos.has('m:' + mail))) continue;
    if (tel) vistos.add('t:' + tel);
    if (mail) vistos.add('m:' + mail);
    const f = dia(l.f);
    if (f < desde || f > hasta) continue;
    const n = semanaDe(f);
    if (n) vivo[n].consultas++;
  }

  // --- ventas ---
  const { results: ganados } = await db.prepare(
    `SELECT lead_id, MIN(creado_en) AS f FROM eventos WHERE etapa_hasta = 'ganado' GROUP BY lead_id`
  ).all();
  for (const g of ganados) {
    const n = semanaDe(dia(g.f));
    if (n) vivo[n].ventas++;
  }

  // --- piezas ---
  const { results: piezas } = await db.prepare(
    `SELECT fecha, views, comentarios FROM piezas WHERE estado = 'Subido' AND fecha >= ? AND fecha <= ?`
  ).bind(desde, hasta).all();
  for (const p of piezas) {
    const n = semanaDe(dia(p.fecha));
    if (!n) continue;
    vivo[n].piezas++;
    if (p.views != null) vivo[n]._views.push(+p.views);
    if (p.comentarios != null) vivo[n]._com.push(+p.comentarios);
  }

  // --- seguidores ---
  const demo = await db.prepare('SELECT followers_count, actualizado_en FROM demografia_ig WHERE id = 1').first();
  const { results: dias } = await db.prepare(
    'SELECT fecha, new_followers FROM metricas_cuenta_dia WHERE fecha >= ? ORDER BY fecha'
  ).bind(desde).all();
  const demoDia = demo ? dia(demo.actualizado_en) : null;

  for (const s of semanas) {
    const v = vivo[s.n];
    const prom = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    const sumCom = v._com.length ? v._com.reduce((x, y) => x + y, 0) : null;
    v.visitas_video = prom(v._views);
    v.conv_pub = prom(v._com);
    v.conv_dia = sumCom == null ? null : Math.round(sumCom / 7 * 10) / 10;
    v.pct_conv = sumCom ? Math.round(v.consultas / sumCom * 10000) / 10000 : null;
    delete v._views; delete v._com;

    // Seguidores al cierre de la semana: el snapshot actual menos lo que
    // entró después. Si el snapshot es anterior al fin de la semana, no hay
    // dato todavía (carga manual).
    if (demo && demo.followers_count != null && demoDia && demoDia >= s.hasta) {
      const posteriores = dias.filter((d) => d.fecha > s.hasta && d.fecha <= demoDia)
        .reduce((a, d) => a + (+d.new_followers || 0), 0);
      v.seguidores = demo.followers_count - posteriores;
    } else v.seguidores = null;
  }
  return vivo;
}
