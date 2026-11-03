// Formulario para guardar un post en el Ideador. Se usa de dos formas:
//   - popup de la extensión (toma el link de la pestaña activa)
//   - ?embebido=1&url=…  dentro del panel que abre el botón de Instagram

const params = new URLSearchParams(location.search);
const EMBEBIDO = params.has('embebido');
const $ = (id) => document.getElementById(id);

const ESTRELLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 5.95 6.55.85-4.8 4.55 1.2 6.5L12 17.3l-5.8 3.15 1.2-6.5-4.8-4.55 6.55-.85z"/></svg>';

const puntajes = { formato_score: 0, angulo_score: 0 };
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
  $('conexion').textContent = con?.crmNombre ? `Antes conectada a: ${con.crmNombre}` : 'Sin conectar';
}

function mostrarConexion(con) {
  $('conexion').textContent = 'Conectada a: ';
  const b = document.createElement('b');
  b.textContent = con.crmNombre || con.crmUrl;
  $('conexion').append(b);
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

function llenarFormatos() {
  for (const f of FORMATOS) $('formato').append(opcion(f, f));
}

function pintarEstrellas() {
  for (const grupo of document.querySelectorAll('.estrellas')) {
    const campo = grupo.dataset.campo;
    grupo.innerHTML = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" data-n="${n}" class="${n <= puntajes[campo] ? 'on' : ''}" aria-label="${n} de 5">${ESTRELLA}</button>`).join('');
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.estrellas button');
  if (!b) return;
  const campo = b.parentElement.dataset.campo;
  const n = Number(b.dataset.n);
  puntajes[campo] = puntajes[campo] === n ? 0 : n; // tocar la misma estrella la saca
  pintarEstrellas();
});

// --- Ángulos ---------------------------------------------------------------
// La lista termina con "+ Nuevo ángulo…": un cliente nuevo arranca sin
// ángulos y los va creando desde acá (POST /api/angulos).

const NUEVO_ANGULO = '__nuevo';
let angulosActivos = [];
let anguloElegido = ''; // para volver a él si se cancela el alta

async function cargarAngulos(seleccionar) {
  angulosActivos = (await apiCrm('/api/angulos')).filter((a) => a.activo === undefined || Number(a.activo) === 1);
  const sel = $('angulo');
  const previo = seleccionar ?? anguloElegido;
  sel.replaceChildren(opcion('', angulosActivos.length ? 'Elegí…' : 'Todavía no hay ángulos'));
  const categorias = [...CATEGORIAS_ANGULO, ...new Set(angulosActivos.map((a) => a.categoria || 'Otros'))];
  for (const cat of new Set(categorias)) {
    const delGrupo = angulosActivos.filter((a) => (a.categoria || 'Otros') === cat);
    if (!delGrupo.length) continue;
    const g = document.createElement('optgroup');
    g.label = cat;
    for (const a of delGrupo) g.append(opcion(a.id, a.nombre));
    sel.append(g);
  }
  sel.append(opcion(NUEVO_ANGULO, '+ Nuevo ángulo…'));
  sel.value = String(previo ?? '');
  if (sel.value !== String(previo ?? '')) sel.value = '';
  anguloElegido = sel.value;
}

function abrirNuevoAngulo() {
  $('angulo').value = anguloElegido;
  $('nuevo-angulo').hidden = false;
  $('nuevo-estado').textContent = '';
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

$('angulo').addEventListener('change', () => {
  if ($('angulo').value === NUEVO_ANGULO) abrirNuevoAngulo();
  else anguloElegido = $('angulo').value;
});
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
  $('formato').value = idea?.formato || '';
  if (idea?.formato && $('formato').value !== idea.formato) {
    $('formato').append(opcion(idea.formato, idea.formato));
    $('formato').value = idea.formato;
  }
  $('angulo').value = idea?.angulo_ids?.[0] ?? '';
  anguloElegido = $('angulo').value;
  $('aplicacion').value = idea?.aplicacion || '';
  $('views').value = idea?.views ?? '';
  puntajes.formato_score = idea?.formato_score || 0;
  puntajes.angulo_score = idea?.angulo_score || 0;
  pintarEstrellas();
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
    const angulo = Number($('angulo').value);
    const views = $('views').value === '' ? undefined : Number($('views').value);
    const idea = await apiCrm('/api/ideas', {
      method: 'POST',
      body: {
        url: urlCanonica(url),
        formato: $('formato').value,
        formato_score: puntajes.formato_score,
        angulo_ids: angulo ? [angulo] : [],
        angulo_score: puntajes.angulo_score,
        aplicacion: $('aplicacion').value.trim(),
        caption: vista?.caption || undefined,
        creador: vista?.creador || undefined,
        views,
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
$('link-opciones').addEventListener('click', (e) => {
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
  llenarFormatos();
  pintarEstrellas();
  $('url').value = await urlInicial();

  try {
    await Promise.all([cargarAngulos(), cargarExistentes()]);
  } catch (e) {
    return manejarError(e);
  }
  actualizarVista();
})();
