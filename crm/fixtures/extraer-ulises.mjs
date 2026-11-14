// Saca los datos (datos_json) y el esqueleto de la propuesta de Ulises YA PUBLICADA, para probar que la plantilla nueva
// da las mismas secciones. Se corre una vez; el resultado queda en crm/fixtures/ (no se necesita el repo de propuestas
// para correr las pruebas).
// Uso: node crm/fixtures/extraer-ulises.mjs <luna-llena-propuestas>/dist/ulises-b69ed5/index.html <luna-llena-propuestas>/ulises-b69ed5/propuesta.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esqueleto } from './esqueleto.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const [htmlPath, jsonPath] = process.argv.slice(2);
const html = fs.readFileSync(htmlPath, 'utf8');
const prop = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const dec = (s) => String(s ?? '').replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const un = (re, s, i = 1) => { const m = s.match(re); return m ? dec(m[i]) : ''; };
const todos = (re, s) => [...s.matchAll(re)];
const quitar = (s) => dec(s.replace(/<[^>]+>/g, ''));

const sec = (id) => { const i = html.indexOf(`id="${id}"`); const j = html.indexOf('</section>', i); return html.slice(i, j); };

const cover = html.slice(html.indexOf('<header class="cover"'), html.indexOf('</header>'));
const datos = {
  numero: prop.numero, cliente: prop.cliente, validUntil: prop.validUntil, version: prop.version, updatedAt: prop.updatedAt,
  changelog: prop.changelog, status: prop.status, videoUrl: prop.videoUrl, tags: prop.tags,
  viaje: {
    nombre: prop.viaje.nombre, pais: prop.viaje.pais, inicio: prop.viaje.inicio, fin: prop.viaje.fin, pasajeros: prop.viaje.pasajeros,
    paisOrigen: quitar(un(/<b>Desde<\/b>([\s\S]*?)<\/div>/, cover).replace(/<span class="venta-bandera"[\s\S]*?<\/span>/, '')),
    fechas: quitar(un(/<b>Fechas<\/b>([\s\S]*?)<\/div>/, cover)),
  },
  portada: { foto: un(/--cover-image:url\('([^']*)'\)/, cover), lugar: '' },
};

const rec = sec('recorrido');
datos.recorrido = { copy: un(/<p class="lead rv">([\s\S]*?)<\/p>/, rec) };
const stats = todos(/<div><b>(\d+)<\/b><span>/g, rec).map((m) => Number(m[1]));
datos.viaje.dias = stats[0]; datos.viaje.destinos = stats[2];

datos.ciudades = todos(/<article class="city rv" style="--photo:url\('([^']*)'\)">([\s\S]*?)<\/article>/g, rec).map((m) => {
  const c = m[2];
  const fechaNombre = quitar(un(/<p class="city__date">([\s\S]*?)<\/p>/, c));
  const partes = fechaNombre.split(' · ');
  return {
    foto: dec(m[1]), nombre: partes[partes.length - 1], rango: partes.length > 1 ? partes.slice(0, -1).join(' · ') : '',
    titulo: un(/<h3>([\s\S]*?)<\/h3>/, c), noches: Number(un(/<p class="city__hotel">(\d+) noche/, c)), hotel: quitar(un(/ en <b>([\s\S]*?)<\/b>/, c)),
    linea: un(/<p class="city__line">([\s\S]*?)<\/p>/, c), tags: todos(/<span>([\s\S]*?)<\/span>/g, un(/<div class="tags">([\s\S]*?)<\/div>/, c)).map((x) => dec(x[1])),
  };
});

const iFlow = html.indexOf('<div class="narrow flow">');
const fFlow = html.indexOf('<div class="finish rv">');
const flow = html.slice(iFlow, fFlow);
datos.flujo = todos(/<section class="chapter"[\s\S]*?<\/section>|<article class="day [\s\S]*?<\/article>|<article class="hotel rv">[\s\S]*?<\/article>|<div class="flight rv">[\s\S]*?<\/div>(?=\s*(?:<section|<article|<div class="flight|<div class="finish))/g, flow).map((m) => {
  const b = m[0];
  if (b.startsWith('<section')) {
    const paso = un(/<span class="chapter__step">([\s\S]*?)<\/span>/, b);
    const pm = paso.match(/Capítulo (\d+)(?: · (.*))?/);
    const pills = todos(/<span>([\s\S]*?)<\/span>/g, un(/<div class="pills">([\s\S]*?)<\/div>/, b)).map((x) => dec(x[1]));
    return { t: 'cap', n: Number(pm[1]), fecha: pm[2] || '', ciudad: un(/data-city-start="([^"]*)"/, b), foto: un(/--chapter-image:url\('([^']*)'\)/, b),
      titulo: un(/<h3>([\s\S]*?)<\/h3>/, b), copy: un(/<\/h3><p>([\s\S]*?)<\/p>/, b), noches: Number((pills[0] || '').match(/\d+/)?.[0] || 0), pills: pills.slice(1) };
  }
  if (b.startsWith('<article class="day')) {
    const body = b.slice(b.indexOf('<div class="day__body">'));
    const sinTl = body.replace(/<div class="tl">[\s\S]*<\/div>(?=<\/div><\/article>)/, '');
    return {
      t: 'dia', dia: Number(un(/data-day="(\d+)"/, b)), kind: un(/class="day day--(\w+)/, b), lugar: un(/data-place="([^"]*)"/, b),
      label: un(/<span class="day__no">([\s\S]*?)<\/span>/, b), foto: un(/<div class="day__photo"><img src="([^"]*)"/, b),
      kicker: un(/<p class="day__kicker">([\s\S]*?)<\/p>/, b), titulo: un(/<h4>([\s\S]*?)<\/h4>/, b),
      relato: un(/<\/h4><p>([\s\S]*?)<\/p>/, sinTl), chips: todos(/<span>([\s\S]*?)<\/span>/g, un(/<div class="chips">([\s\S]*?)<\/div>/, sinTl)).map((x) => dec(x[1])),
      momentos: todos(/<li class="tl__i"><time>([\s\S]*?)<\/time><div class="tl__c">(?:<img src="([^"]*)" alt="[^"]*" loading="lazy">)?<h5>([\s\S]*?)<\/h5><p>([\s\S]*?)<\/p>/g, b)
        .map((x) => ({ time: dec(x[1]), image: dec(x[2] || ''), title: dec(x[3]), text: dec(x[4]) })),
    };
  }
  if (b.startsWith('<article class="hotel')) {
    return { t: 'hotel', foto: un(/--photo:url\('([^']*)'\)/, b), noches: Number(un(/<span class="hotel__nights">(\d+)/, b)),
      dia: Number(un(/día (\d+)/, b)), ciudad: un(/día \d+ · ([\s\S]*?)<\/p>/, b), nombre: un(/<h3>([\s\S]*?)<\/h3>/, b),
      filas: todos(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g, b).map((x) => [dec(x[1]), dec(x[2])]) };
  }
  return { t: 'vuelo', texto: quitar(un(/<p>([\s\S]*?)(?:<small>|<\/p>)/, b)), detalle: un(/<small>([\s\S]*?)<\/small>/, b), precio: '' };
});

const fin = html.slice(fFlow, html.indexOf('</div>', html.indexOf('<span>', fFlow)) + 6);
datos.final = { stats: un(/<p>([\s\S]*?)<\/p>/, fin), titulo: un(/<h3>([\s\S]*?)<\/h3>/, fin), nota: un(/<span>([\s\S]*?)<\/span>/, fin) };

const inc = sec('incluye');
datos.incluye = {
  copy: un(/<p class="lead rv">([\s\S]*?)<\/p>/, inc),
  items: todos(/<li><svg[\s\S]*?<\/svg><span>([\s\S]*?)<\/span><\/li>/g, inc).map((m) => ({ title: dec(m[1].replace(/<small>[\s\S]*$/, '')), detail: un(/<small>([\s\S]*?)<\/small>/, m[1]) })),
  no_incluye: un(/<div class="no"><b>No incluye<\/b>([\s\S]*?)<\/div>/, inc),
};

const inv = sec('inversion');
datos.precio = {
  totalPP: prop.precio.totalPP, copy: un(/<p class="lead rv">([\s\S]*?)<\/p>/, inv),
  filas: todos(/<div class="row rv"><div><h4>([\s\S]*?)<\/h4><small>([\s\S]*?)<\/small><\/div><div class="amt">USD ([\d,.]+) <small>p\/p<\/small><\/div>(?:<ul>([\s\S]*?)<\/ul>)?<\/div>/g, inv)
    .map((m) => ({ titulo: dec(m[1]), detalle: dec(m[2]), montoPP: Number(m[3].replace(/,/g, '')), items: todos(/<li>([\s\S]*?)<\/li>/g, m[4] || '').map((x) => dec(x[1])) })),
  nota: un(/<p class="invest__note">Valor referencial por persona\. No incluye vuelo internacional\. Sujeto a disponibilidad al momento de reservar\.\s*([\s\S]*?)<\/p>/, inv),
};

fs.writeFileSync(path.join(aqui, 'ulises-datos.json'), JSON.stringify(datos, null, 1));
fs.writeFileSync(path.join(aqui, 'ulises-esqueleto.json'), JSON.stringify(esqueleto(html)));
console.log('ciudades', datos.ciudades.length, 'flujo', datos.flujo.length, 'filas', datos.precio.filas.length, 'items', datos.incluye.items.length, 'esqueleto', esqueleto(html).length);
