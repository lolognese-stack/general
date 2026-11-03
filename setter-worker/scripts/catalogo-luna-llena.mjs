// Arma el catálogo de paquetes y tours de la web de Luna Llena para la base
// de conocimiento del setter (setter_conocimiento id 10). Lee las fichas de
// repo/lunallenatravel-web y escribe crm/seed-setter-catalogo.sql.
//
//   node scripts/catalogo-luna-llena.mjs [ruta-a-lunallenatravel-web]
//
// Después: npx wrangler d1 execute crm-plantilla --remote --file crm/seed-setter-catalogo.sql
// Volver a correrlo cada vez que cambien paquetes, tours o precios en la web.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WEB = process.argv[2] || join(AQUI, '../../../lunallenatravel-web');
const URL_WEB = 'https://lunallenatravel.vercel.app';
const SALIDA = join(AQUI, '../../crm/seed-setter-catalogo.sql');

const recortar = (t, n) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)) + '…');
const limpiar = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// "5D / 4N", "4D/3N", "Full Day" → texto de días y número para ordenar.
// En la web aparece de varias formas ("5D-4N", "4D/3D"); si el título no lo
// trae, se mira el slug ("trek-salkantay-4d-3n").
function diasDe(titulo, slug) {
  const m = titulo.match(/(\d+)\s*D\s*[\/-]?\s*(\d+)\s*[ND]/i) || slug.match(/(\d+)d-?(\d+)n/i);
  if (m) return { texto: `${m[1]} días / ${m[2]} noche${m[2] === '1' ? '' : 's'}`, n: Number(m[1]) };
  if (/full\s*day/i.test(titulo)) return { texto: '1 día (full day)', n: 1 };
  return { texto: 'unas horas o 1 día', n: 1 };
}

function ficha(carpeta, ruta) {
  const html = readFileSync(join(carpeta, 'index.html'), 'utf8');
  const titulo = limpiar(html.match(/<title>([^<]*)/)?.[1] || '').replace(/\s*·\s*Luna Llena Travel$/, '');
  const desc = limpiar(html.match(/<meta name="description" content="([^"]*)/)?.[1] || '');
  const precio = html.match(/data-book[^>]*data-price="([\d.]+)"/)?.[1] || html.match(/data-price="([\d.]+)"/)?.[1];
  const migas = (html.match(/<nav class="crumbs"[\s\S]*?<\/nav>/)?.[0] || '').split(/<\/a>|<span>\/<\/span>/).map(limpiar).filter((x) => x && x !== '/');
  const categoria = migas.length > 2 ? migas[migas.length - 2] : '';
  const dias = diasDe(titulo, ruta);
  // Una frase de qué se trata: alcanza para elegir sin gastar tokens. Muchas
  // fichas de tours tienen como descripción el título en mayúsculas; ahí se
  // usa el primer párrafo largo (sin las condiciones de reserva).
  const parrafo = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => limpiar(m[1]))
    .find((t) => t.length > 60 && !/^(Reservas|Cancelaciones|Cambios|No incluye|Incluye)/i.test(t)) || '';
  const util = /[a-záéíóúñ]{4}/.test(desc) && desc.length > 40 ? desc : parrafo;
  const corta = recortar(util.split(/(?<=\.)\s/)[0], 150);
  return { titulo, dias, precio: precio ? `desde USD ${Number(precio)} por persona` : 'precio a consultar', corta, categoria, url: `${URL_WEB}/${ruta}/` };
}

function leer(sub) {
  const base = join(WEB, sub);
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, 'index.html')))
    .map((d) => ficha(join(base, d.name), `${sub}/${d.name}`))
    .sort((a, b) => a.dias.n - b.dias.n || a.titulo.localeCompare(b.titulo, 'es'));
}

const linea = (f) => `- ${f.titulo} · ${f.dias.texto} · ${f.precio}${f.categoria ? ` · ${f.categoria}` : ''} · ${f.corta} · ${f.url}`;
const paquetes = leer('paquetes');
const tours = leer('tours');

const contenido = `Todo lo que vendemos, sacado de la web. Precios "desde" por persona, en dólares. Para recomendar, elegir lo que encaje con los días que tiene la persona. Cada línea: nombre · duración · precio · categoría · de qué se trata · link.

PAQUETES (viajes armados de varios días)
${paquetes.map(linea).join('\n')}

TOURS (salidas sueltas, de unas horas a varios días)
${tours.map(linea).join('\n')}`;

const sql = (s) => `'${s.replace(/'/g, "''")}'`;
writeFileSync(SALIDA, `-- Generado por setter-worker/scripts/catalogo-luna-llena.mjs a partir de la web.
-- No editar a mano: volver a correr el script.
INSERT INTO setter_conocimiento (id, titulo, contenido, tags, activo, creado_en, actualizado_en)
VALUES (10, 'Catálogo de paquetes y tours', ${sql(contenido)}, 'catalogo', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET titulo = excluded.titulo, contenido = excluded.contenido, tags = excluded.tags, activo = 1, actualizado_en = excluded.actualizado_en;
`);
console.log(`${paquetes.length} paquetes y ${tours.length} tours → ${SALIDA} (${contenido.length} caracteres)`);
