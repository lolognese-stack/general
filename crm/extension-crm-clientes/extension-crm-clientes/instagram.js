// Botón "Guardar en el ideador" dentro de la barra de acciones de Instagram,
// a la izquierda del corazón (en /reels/, donde la barra es vertical, arriba).
//
// Instagram cambia las clases seguido, así que la barra se encuentra por
// accesibilidad: el svg con aria-label "Me gusta"/"Like" y su contenedor
// común con el de "Comentar". Ver README → "Si el botón deja de aparecer".

(() => {
  const LIKE = ['Me gusta', 'Like', 'Ya no me gusta', 'Unlike'];
  const COMENTAR = ['Comentar', 'Comment'];
  const SEL_LIKE = LIKE.map((l) => `svg[aria-label="${l}"]`).join(',');
  const SEL_COMENTAR = COMENTAR.map((l) => `svg[aria-label="${l}"]`).join(',');
  const RE_POST = /\/(?:[\w.]+\/)?(p|reel)\/([\w-]+)/;
  const EXT_ORIGEN = new URL(chrome.runtime.getURL('')).origin;

  const ICONO = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="crm-ext-relleno" d="M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.3V16h6v-.9c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3Z"/>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.3V16h6v-.9c0-.5.2-1 .6-1.3A6 6 0 0 0 12 3Z"/>
  </svg>`;
  const TITULO = 'Guardar en el ideador';
  const TITULO_GUARDADO = 'Ya está en el ideador';

  let guardados = new Set();
  let conectada = false;

  // --- Encontrar barras y posts ---------------------------------------------

  // Los corazones chicos de los comentarios también dicen "Me gusta":
  // solo cuentan los del tamaño de la barra (24 px).
  function esCorazonDeBarra(svg) {
    const alto = Number(svg.getAttribute('height')) || svg.getBoundingClientRect().height;
    return alto >= 20;
  }

  function corazonesGrandes(el) {
    return [...el.querySelectorAll(SEL_LIKE)].filter(esCorazonDeBarra).length;
  }

  // Sube desde el botón de like hasta el contenedor que también tiene el de
  // comentar. Corta antes de pasarse a otro post (más de un corazón) o de
  // salir del article/modal.
  function barraDe(svg) {
    const boton = svg.closest('button, [role="button"]') || svg.parentElement;
    let hijo = boton;
    for (let el = boton.parentElement, i = 0; el && i < 8; hijo = el, el = el.parentElement, i++) {
      if (corazonesGrandes(el) > 1) break;
      if (el.querySelector(SEL_COMENTAR)) return { barra: el, hijo };
      if (el.matches('article, [role="dialog"], main')) break;
    }
    return { barra: boton.parentElement, hijo: boton };
  }

  function codigoEnLinks(raiz) {
    for (const a of raiz.querySelectorAll('a[href]')) {
      const m = a.getAttribute('href').match(RE_POST);
      if (m) return { tipo: m[1], codigo: m[2] };
    }
    return null;
  }

  function postDeLaUrl() {
    const m = location.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels)\/([\w-]+)/);
    return m ? { tipo: m[1] === 'p' ? 'p' : 'reel', codigo: m[2] } : null;
  }

  function postDeBarra(barra) {
    const deUrl = postDeLaUrl();
    // Visor de reels: el post es el de la URL.
    if (deUrl && location.pathname.startsWith('/reels/')) return deUrl;
    // Post abierto en modal: Instagram cambia la URL al abrirlo.
    if (deUrl && barra.closest('[role="dialog"]')) return deUrl;
    const article = barra.closest('article');
    if (article) {
      const p = codigoEnLinks(article);
      if (p) return p;
    }
    // Página del post (/p/, /reel/) sin article alrededor.
    if (deUrl) return deUrl;
    // Último recurso: el primer ancestro con links que apunten a un solo post.
    for (let el = barra.parentElement, i = 0; el && i < 10; el = el.parentElement, i++) {
      const codigos = new Set([...el.querySelectorAll('a[href]')]
        .map((a) => a.getAttribute('href').match(RE_POST)?.[2]).filter(Boolean));
      if (codigos.size === 1) return codigoEnLinks(el);
      if (codigos.size > 1) break;
    }
    return null;
  }

  // --- El botón -------------------------------------------------------------

  function pintarBoton(btn) {
    const guardado = guardados.has(btn.dataset.codigo);
    btn.classList.toggle('crm-ext-guardado', guardado);
    const titulo = !conectada ? `${TITULO} (abrí el panel del CRM para conectar)` : guardado ? TITULO_GUARDADO : TITULO;
    if (btn.title !== titulo) {
      btn.title = titulo;
      btn.setAttribute('aria-label', titulo);
    }
  }

  function crearBoton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crm-ext-btn';
    btn.innerHTML = ICONO;
    btn.addEventListener('click', alTocar, true);
    // Que el doble click no le dé like al post.
    btn.addEventListener('dblclick', (e) => e.stopPropagation(), true);
    return btn;
  }

  function alTocar(e) {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    const barra = btn.parentElement;
    const post = (barra && postDeBarra(barra)) || { tipo: btn.dataset.tipo, codigo: btn.dataset.codigo };
    if (!post.codigo) return;
    abrirPanel(`https://www.instagram.com/${post.tipo}/${post.codigo}/`);
  }

  function procesar(svg) {
    const { barra, hijo } = barraDe(svg);
    if (!barra || !hijo || hijo.parentElement !== barra) return;
    const post = postDeBarra(barra);
    let btn = barra.querySelector(':scope > .crm-ext-btn');
    if (!post) { btn?.remove(); return; }

    if (!btn) {
      btn = crearBoton();
      barra.dataset.crmExt = '1';
    }
    if (btn.nextElementSibling !== hijo) barra.insertBefore(btn, hijo);

    // Instagram recicla el DOM: la misma barra puede pasar a ser de otro post.
    if (btn.dataset.codigo !== post.codigo) {
      btn.dataset.codigo = post.codigo;
      btn.dataset.tipo = post.tipo;
    }
    // Barra vertical (visor de reels): el de comentar queda debajo del corazón.
    const comentar = barra.querySelector(SEL_COMENTAR);
    const vertical = !!comentar && comentar.getBoundingClientRect().top >= hijo.getBoundingClientRect().bottom - 2;
    btn.classList.toggle('crm-ext-vertical', vertical);
    // Mismo color que los íconos de la barra (cambia con el tema de Instagram).
    const color = getComputedStyle(svg).color;
    if (btn.style.getPropertyValue('--crm-ext-icono') !== color) btn.style.setProperty('--crm-ext-icono', color);
    pintarBoton(btn);
  }

  function escanear() {
    for (const svg of document.querySelectorAll(SEL_LIKE)) {
      if (esCorazonDeBarra(svg)) procesar(svg);
    }
  }

  let espera;
  function programarEscaneo() {
    clearTimeout(espera);
    espera = setTimeout(escanear, 250);
  }

  // --- Panel lateral con el formulario ----------------------------------------

  function cerrarPanel() {
    document.getElementById('crm-ext-panel')?.remove();
  }

  function abrirPanel(url) {
    let panel = document.getElementById('crm-ext-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'crm-ext-panel';
      panel.innerHTML = '<iframe title="Guardar en el ideador"></iframe>';
      document.documentElement.append(panel);
    }
    panel.querySelector('iframe').src = `${chrome.runtime.getURL('popup.html')}?embebido=1&url=${encodeURIComponent(url)}`;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== EXT_ORIGEN || !e.data?.crmExt) return;
    if (e.data.tipo === 'cerrar') cerrarPanel();
    if (e.data.tipo === 'guardada') marcarGuardado(e.data.codigo);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('crm-ext-panel')) cerrarPanel();
  });

  // --- Qué posts ya están guardados -------------------------------------------

  function marcarGuardado(codigo) {
    if (!codigo || guardados.has(codigo)) return;
    guardados.add(codigo);
    document.querySelectorAll('.crm-ext-btn').forEach(pintarBoton);
  }

  async function refrescarGuardados() {
    let r;
    try { r = await chrome.runtime.sendMessage({ tipo: 'guardados' }); } catch { return; }
    conectada = !!r?.ok || (!r?.sinConexion && conectada);
    if (r?.ok) guardados = new Set(r.codigos);
    if (r?.sinConexion) guardados = new Set();
    document.querySelectorAll('.crm-ext-btn').forEach(pintarBoton);
  }

  async function aplicarColores() {
    const { colores } = await chrome.storage.local.get('colores');
    aplicarPaleta(document.documentElement, colores);
  }

  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area !== 'local') return;
    if (cambios.ultimaGuardada?.newValue) marcarGuardado(cambios.ultimaGuardada.newValue.codigo);
    if (cambios.crmToken || cambios.crmUrl) refrescarGuardados();
    if (cambios.colores) aplicarColores();
  });

  // --- Arranque ---------------------------------------------------------------

  aplicarColores();
  refrescarGuardados();
  escanear();
  new MutationObserver(programarEscaneo).observe(document.body, { childList: true, subtree: true });

  // Navegación de la SPA (pushState no dispara nada que se pueda escuchar
  // desde el content script).
  let ultimaUrl = location.href;
  setInterval(() => {
    if (location.href !== ultimaUrl) {
      ultimaUrl = location.href;
      programarEscaneo();
    }
  }, 700);
  setInterval(refrescarGuardados, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refrescarGuardados();
  });
})();
