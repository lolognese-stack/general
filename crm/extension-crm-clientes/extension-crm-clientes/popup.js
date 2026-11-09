// Formulario para guardar un post en el Ideador. Se usa de dos formas:
//   - popup de la extensión (toma el link de la pestaña activa)
//   - ?embebido=1&url=…  dentro del panel que abre el botón de Instagram

const params = new URLSearchParams(location.search);
const EMBEBIDO = params.has('embebido');
const $ = (id) => document.getElementById(id);

// Los que más se usan van como botones; el resto, en "Otro…".
const FORMATOS_PRINCIPALES = ['Broll Texto', 'Carrusel', 'Clip/s Paisaje'];
const ANGULOS_PRINCIPALES = ['Paisaje', 'Itinerario'];

let formatoElegido = '';
let existentes = new Map(); // codigo -> idea ya guardada
let vista = null;           // lo que devolvió /api/ig-datos para el link actual
let pedidoVista = 0;

// --- Comunicación con la página de Instagram (solo embebido) ---------------

function avisarPadre(msg) {
  if (!EMBEBIDO) return;
  const origen = location.ancestorOrigins?.[0] || '*';
  window.parent.postMessage({ crmExt: true, ...msg }, origen);
}

function cerrar() {
  if (EMBEBIDO) avisarPadre({ tipo: 'cerrar' });
  else window.close();
}

// --- Estado de conexión ----------------------------------------------------

function mostrarSinConexion(con) {
  $('form').hidden = true;
  $('sin-conexion').hidden = false;
  $('conexion').textContent = 'Sin conectar';
  $('conexion').classList.add('off');
  $('conexion').title = con?.crmNombre ? `Antes conectada a: ${con.crmNombre}` : 'Sin conectar';
}

function mostrarConexion(con) {
  const nombre = con.crmNombre || con.crmUrl;
  $('conexion').textContent = nombre;
  $('conexion').classList.remove('off');
  $('conexion').title = `Conectada a: ${nombre}`;
  if (con.avisoCambio) {
    $('aviso').textContent = `Cambió la conexión: antes estaba en ${con.avisoCambio}.`;
    $('aviso').hidden = false;
    chrome.storage.local.remove('avisoCambio');
  }
}

function manejarError(e) {
  if (e?.sinConexion) return leerConexion().then(mostrarSinConexion);
  $('estado').textContent = e?.message || 'No se pudo guardar';
  $('estado').className = 'estado error';
}

// --- Campos ----------------------------------------------------------------

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

function chip(valor, texto, on) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (on ? ' on' : '');
  b.dataset.valor = valor;
  b.textContent = texto;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  return b;
}

// --- Formato ---------------------------------------------------------------

function pintarFormatos() {
  $('formato-chips').replaceChildren(...FORMATOS_PRINCIPALES.map((f) => chip(f, f, f === formatoElegido)));
  const sel = $('formato-otro');
  const otros = FORMATOS.filter((f) => !FORMATOS_PRINCIPALES.includes(f));
  // Un formato viejo que ya no está en la lista se muestra igual.
  if (formatoElegido && !FORMATOS.includes(formatoElegido)) otros.push(formatoElegido);
  sel.replaceChildren(opcion('', 'Otro…'), ...otros.map((f) => opcion(f, f)));
  const esOtro = !!formatoElegido && !FORMATOS_PRINCIPALES.includes(formatoElegido);
  sel.value = esOtro ? formatoElegido : '';
  sel.classList.toggle('on', esOtro);
}

$('formato-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  formatoElegido = formatoElegido === b.dataset.valor ? '' : b.dataset.valor; // tocarlo de nuevo lo saca
  pintarFormatos();
});
$('formato-otro').addEventListener('change', () => {
  formatoElegido = $('formato-otro').value;
  pintarFormatos();
});

// --- Ángulos ---------------------------------------------------------------
// La lista termina con "+ Nuevo ángulo…": un cliente nuevo arranca sin
// ángulos y los va creando desde acá (POST /api/angulos).

const NUEVO_ANGULO = '__nuevo';
let angulosActivos = [];
let anguloElegido = ''; // para volver a él si se cancela el alta

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es').trim();
const anguloPorId = (id) => angulosActivos.find((a) => String(a.id) === String(id));
// Los principales se buscan por nombre en los ángulos de este CRM; si alguno no existe, no aparece.
const angulosPrincipales = () => ANGULOS_PRINCIPALES.map((n) => angulosActivos.find((a) => sinTildes(a.nombre) === sinTildes(n))).filter(Boolean);

async function cargarAngulos(seleccionar) {
  angulosActivos = (await apiCrm('/api/angulos')).filter((a) => a.activo === undefined || Number(a.activo) === 1);
  const previo = String(seleccionar ?? anguloElegido ?? '');
  anguloElegido = anguloPorId(previo) ? previo : '';
  pintarAngulos();
}

function pintarAngulos() {
  const principales = angulosPrincipales();
  $('angulo-chips').replaceChildren(...principales.map((a) => chip(a.id, a.nombre, String(a.id) === anguloElegido)));
  const elegido = anguloPorId(anguloElegido);
  const esOtro = !!elegido && !principales.includes(elegido);
  const b = $('angulo-otro');
  b.textContent = esOtro ? elegido.nombre : (angulosActivos.length ? 'Otro…' : 'Elegí o creá uno…');
  b.classList.toggle('on', esOtro);
}

$('angulo-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  anguloElegido = anguloElegido === b.dataset.valor ? '' : b.dataset.valor; // tocarlo de nuevo lo saca
  pintarAngulos();
});

// --- Desplegable de ángulos con buscador -----------------------------------

let activo = -1; // índice resaltado con las flechas

function opcionesFiltradas() {
  const q = sinTildes($('angulo-buscar').value);
  return angulosActivos.filter((a) => !q || sinTildes(a.nombre).includes(q) || sinTildes(a.categoria).includes(q));
}

function itemLista(clase, texto, valor) {
  const li = document.createElement('li');
  li.className = clase;
  li.textContent = texto;
  if (valor !== undefined) {
    li.setAttribute('role', 'option');
    li.dataset.valor = valor;
    li.setAttribute('aria-selected', String(valor) === anguloElegido ? 'true' : 'false');
  } else {
    li.setAttribute('role', 'presentation');
  }
  return li;
}

function pintarLista() {
  const filtrados = opcionesFiltradas();
  const items = [];
  const categorias = new Set([...CATEGORIAS_ANGULO, ...filtrados.map((a) => a.categoria || 'Otros')]);
  for (const cat of categorias) {
    const delGrupo = filtrados.filter((a) => (a.categoria || 'Otros') === cat);
    if (!delGrupo.length) continue;
    items.push(itemLista('grupo', cat));
    for (const a of delGrupo) items.push(itemLista('op', a.nombre, String(a.id)));
  }
  if (!filtrados.length) items.push(itemLista('vacio-op', 'No hay ángulos con ese nombre.'));
  const q = $('angulo-buscar').value.trim();
  items.push(itemLista('op nuevo-op', q ? `+ Crear "${q}"` : '+ Nuevo ángulo…', NUEVO_ANGULO));
  $('angulo-lista').replaceChildren(...items);
  activo = 0;
  marcarActivo();
}

function marcarActivo() {
  const ops = [...$('angulo-lista').querySelectorAll('.op')];
  ops.forEach((li, i) => li.classList.toggle('activo', i === activo));
  ops[activo]?.scrollIntoView({ block: 'nearest' });
}

function abrirCombo() {
  $('angulo-pop').hidden = false;
  $('angulo-otro').setAttribute('aria-expanded', 'true');
  $('angulo-buscar').value = '';
  pintarLista();
  $('angulo-buscar').focus();
}

function cerrarCombo() {
  $('angulo-pop').hidden = true;
  $('angulo-otro').setAttribute('aria-expanded', 'false');
}

function elegirDeLista(valor) {
  const q = $('angulo-buscar').value.trim();
  cerrarCombo();
  if (valor === NUEVO_ANGULO) return abrirNuevoAngulo(q);
  anguloElegido = String(valor);
  pintarAngulos();
}

$('angulo-otro').addEventListener('click', () => ($('angulo-pop').hidden ? abrirCombo() : cerrarCombo()));
$('angulo-buscar').addEventListener('input', pintarLista);
$('angulo-buscar').addEventListener('keydown', (e) => {
  const ops = [...$('angulo-lista').querySelectorAll('.op')];
  if (e.key === 'ArrowDown') { e.preventDefault(); activo = Math.min(activo + 1, ops.length - 1); marcarActivo(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activo = Math.max(activo - 1, 0); marcarActivo(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (ops[activo]) elegirDeLista(ops[activo].dataset.valor); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarCombo(); $('angulo-otro').focus(); }
});
$('angulo-lista').addEventListener('mousedown', (e) => e.preventDefault()); // que el buscador no pierda el foco
$('angulo-lista').addEventListener('click', (e) => {
  const li = e.target.closest('.op');
  if (li) elegirDeLista(li.dataset.valor);
});
document.addEventListener('click', (e) => {
  if (!$('angulo-pop').hidden && !e.target.closest('#angulo-pop, #angulo-otro')) cerrarCombo();
});

function abrirNuevoAngulo(nombre = '') {
  $('nuevo-angulo').hidden = false;
  $('nuevo-estado').textContent = '';
  $('nuevo-nombre').value = nombre;
  $('nuevo-nombre').focus();
}

function cerrarNuevoAngulo() {
  $('nuevo-angulo').hidden = true;
  $('nuevo-nombre').value = '';
  $('nuevo-estado').textContent = '';
}

const mismoNombre = (a, b) => a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es');

async function agregarAngulo() {
  const nombre = $('nuevo-nombre').value.trim();
  if (!nombre) {
    $('nuevo-estado').textContent = 'Escribí el nombre del ángulo.';
    $('nuevo-nombre').focus();
    return;
  }
  $('nuevo-agregar').disabled = true;
  try {
    const existente = angulosActivos.find((a) => mismoNombre(a.nombre, nombre));
    if (existente) {
      await cargarAngulos(existente.id);
    } else {
      try {
        const { id } = await apiCrm('/api/angulos', { method: 'POST', body: { nombre, categoria: $('nuevo-categoria').value } });
        await cargarAngulos(id);
      } catch (e) {
        // Ya existe (quizás inactivo o creado desde otra pestaña): se elige ese.
        if (e.status !== 409) throw e;
        await cargarAngulos();
        const igual = angulosActivos.find((a) => mismoNombre(a.nombre, nombre));
        if (!igual) throw new Error('Ya existe un ángulo con ese nombre, pero está desactivado en el CRM.');
        await cargarAngulos(igual.id);
      }
    }
    cerrarNuevoAngulo();
  } catch (e) {
    if (e.sinConexion) return manejarError(e);
    $('nuevo-estado').textContent = e.message || 'No se pudo agregar el ángulo.';
  } finally {
    $('nuevo-agregar').disabled = false;
  }
}

$('nuevo-agregar').addEventListener('click', agregarAngulo);
$('nuevo-cancelar').addEventListener('click', cerrarNuevoAngulo);
$('nuevo-nombre').addEventListener('input', () => { $('nuevo-estado').textContent = ''; });
// Enter en el nombre agrega el ángulo en vez de guardar la idea.
$('nuevo-nombre').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); agregarAngulo(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarNuevoAngulo(); }
});
for (const c of CATEGORIAS_ANGULO) $('nuevo-categoria').append(opcion(c, c));

async function cargarExistentes() {
  const ideas = await apiCrm('/api/ideas');
  existentes = new Map(ideas.filter((i) => i.codigo).map((i) => [i.codigo, i]));
}

// Si el post ya estaba, el formulario arranca con lo que tiene en el CRM.
function precargar(idea) {
  formatoElegido = idea?.formato || '';
  pintarFormatos();
  const id = String(idea?.angulo_ids?.[0] ?? '');
  anguloElegido = anguloPorId(id) ? id : '';
  pintarAngulos();
  $('aplicacion').value = idea?.aplicacion || '';
}

// --- Vista previa ----------------------------------------------------------

function numero(n) {
  return n == null ? null : Number(n).toLocaleString('es-AR');
}

async function actualizarVista() {
  const codigo = codigoIg($('url').value);
  const pedido = ++pedidoVista;
  vista = null;
  $('ya-guardada').hidden = !(codigo && existentes.has(codigo));
  if (!codigo) { $('vista').hidden = true; return; }

  if (existentes.has(codigo)) precargar(existentes.get(codigo));
  $('vista').hidden = false;
  $('vista').classList.add('cargando');
  $('vista-img').removeAttribute('src');
  $('vista-creador').textContent = 'Cargando vista previa…';
  $('vista-metricas').textContent = '';
  $('vista-caption').textContent = '';

  let datos = null;
  try { datos = await apiCrm('/api/ig-datos', { method: 'POST', body: { url: $('url').value } }); }
  catch (e) { if (e.sinConexion) return manejarError(e); }
  if (pedido !== pedidoVista) return; // cambió el link mientras esperaba

  $('vista').classList.remove('cargando');
  if (!datos?.ok) {
    $('vista-creador').textContent = 'Sin vista previa';
    $('vista-caption').textContent = 'Instagram no devolvió datos de este post. Se puede guardar igual.';
    return;
  }
  vista = datos;
  if (datos.image) $('vista-img').src = datos.image;
  $('vista-creador').textContent = datos.creador ? `@${datos.creador}` : 'Post de Instagram';
  $('vista-metricas').textContent = [
    datos.likes != null && `${numero(datos.likes)} me gusta`,
    datos.comentarios != null && `${numero(datos.comentarios)} comentarios`,
  ].filter(Boolean).join(' · ');
  $('vista-caption').textContent = datos.caption || '';
}

let esperaUrl;
$('url').addEventListener('input', () => {
  clearTimeout(esperaUrl);
  esperaUrl = setTimeout(actualizarVista, 400);
});

// --- Guardar ---------------------------------------------------------------

function urlCanonica(url) {
  const codigo = codigoIg(url);
  const tipo = /\/reels?\//.test(url) ? 'reel' : 'p';
  return `https://www.instagram.com/${tipo}/${codigo}/`;
}

async function guardarPortada(idea) {
  const m = vista?.image?.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m || idea.foto_v) return true;
  try {
    await apiCrm(`/api/foto-idea/${idea.id}`, { method: 'POST', body: { mime: m[1], data: m[2] } });
    return true;
  } catch (e) {
    if (e.sinConexion) throw e;
    return false;
  }
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('url').value.trim();
  const codigo = codigoIg(url);
  if (!codigo) {
    $('estado').textContent = 'Pegá un link de un post o reel de Instagram.';
    $('estado').className = 'estado error';
    return;
  }

  $('guardar').disabled = true;
  $('estado').textContent = 'Guardando…';
  $('estado').className = 'estado';
  try {
    const angulo = Number(anguloElegido);
    const idea = await apiCrm('/api/ideas', {
      method: 'POST',
      body: {
        url: urlCanonica(url),
        formato: formatoElegido,
        angulo_ids: angulo ? [angulo] : [],
        aplicacion: $('aplicacion').value.trim(),
        caption: vista?.caption || undefined,
        creador: vista?.creador || undefined,
        likes: vista?.likes ?? undefined,
        comentarios: vista?.comentarios ?? undefined,
        origen: 'extension',
      },
    });
    const conPortada = await guardarPortada(idea);
    existentes.set(codigo, idea);
    $('ya-guardada').hidden = false;
    $('estado').textContent = (idea.actualizada ? 'Actualizada en el ideador' : 'Guardada en el ideador')
      + (conPortada ? '' : ' (sin portada)');
    $('estado').className = 'estado ok';
    // El content script de Instagram escucha esto para marcar el botón.
    chrome.storage.local.set({ ultimaGuardada: { codigo, t: Date.now() } });
    avisarPadre({ tipo: 'guardada', codigo });
    if (EMBEBIDO) setTimeout(cerrar, 1400);
  } catch (err) {
    manejarError(err);
  } finally {
    $('guardar').disabled = false;
  }
});

// --- Arranque --------------------------------------------------------------

async function urlInicial() {
  if (params.get('url')) return params.get('url');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return codigoIg(tab?.url) ? tab.url : '';
  } catch { return ''; }
}

$('cerrar').addEventListener('click', cerrar);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && EMBEBIDO) cerrar(); });
$('conexion').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

(async function iniciar() {
  if (EMBEBIDO) {
    document.body.classList.add('embebido');
    $('cerrar').hidden = false;
  }
  const con = await leerConexion();
  aplicarPaleta(document.documentElement, con.colores);
  if (!con.crmToken) return mostrarSinConexion(con);

  mostrarConexion(con);
  $('form').hidden = false;
  pintarFormatos();
  $('url').value = await urlInicial();

  try {
    await Promise.all([cargarAngulos(), cargarExistentes()]);
  } catch (e) {
    return manejarError(e);
  }
  actualizarVista();
})();
