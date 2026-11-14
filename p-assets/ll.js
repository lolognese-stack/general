/* Motor de la propuesta Luna Llena Travel: barra de progreso del viaje, animaciones y reseñas. */
(function () {
  document.documentElement.classList.add('js');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Entrada suave de cada bloque
  var rv = $$('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add('in'); });

  // Barra de progreso: va marcando en qué día del viaje estás
  var bar = $('#pbar'), fill = $('#pbar-fill'), where = $('#pbar-where'), track = $('#pbar-track'), bottom = $('#bottom');
  var days = $$('[data-day]');
  var total = days.length;
  var cover = $('.cover');
  var geo = [];
  function medir() {
    var y = window.pageYOffset;
    geo = days.map(function (d) { var r = d.getBoundingClientRect(); return { top: r.top + y, bottom: r.bottom + y, el: d }; });
    $$('.pbar__tick', track).forEach(function (t) { t.remove(); });
    if (!geo.length) return;
    var ini = geo[0].top, fin = geo[geo.length - 1].bottom, span = Math.max(1, fin - ini);
    $$('[data-city-start]').forEach(function (c) {
      var t = c.getBoundingClientRect().top + y;
      var f = Math.min(1, Math.max(0, (t - ini) / span));
      var tick = document.createElement('i'); tick.className = 'pbar__tick'; tick.style.left = (f * 100) + '%';
      tick.innerHTML = '<span>' + c.getAttribute('data-city-start') + '</span>'; track.appendChild(tick);
    });
  }
  function pintar() {
    var y = window.pageYOffset, h = window.innerHeight;
    var pasoPortada = cover ? cover.offsetHeight * 0.6 : 300;
    bar.classList.toggle('on', y > pasoPortada);
    if (bottom) bottom.classList.toggle('on', y > pasoPortada);
    if (!geo.length) return;
    var ref = y + h * 0.45;
    var ini = geo[0].top, fin = geo[geo.length - 1].bottom;
    var f = Math.min(1, Math.max(0, (ref - ini) / Math.max(1, fin - ini)));
    fill.style.width = (f * 100).toFixed(2) + '%';
    var actual = -1;
    for (var i = 0; i < geo.length; i++) if (geo[i].top <= ref) actual = i;
    if (actual < 0) { where.innerHTML = 'Tu viaje <b>empieza aquí</b>'; return; }
    var d = geo[actual].el;
    var after = ref > fin;
    where.innerHTML = after
      ? 'Viaje completo · <b>tu inversión</b>'
      : 'Día <b>' + d.getAttribute('data-day') + '</b> de ' + total + ' · ' + d.getAttribute('data-place');
  }
  var ticking = false;
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(function () { pintar(); ticking = false; }); } }, { passive: true });
  window.addEventListener('resize', function () { medir(); pintar(); });
  window.addEventListener('load', function () { medir(); pintar(); setTimeout(function () { medir(); pintar(); }, 1200); });
  medir(); pintar();

  // Reseñas rotativas
  var rs = $$('.resena'), dots = $$('.dots button'), cur = 0, timer;
  function ver(i) {
    cur = i;
    rs.forEach(function (r, k) { r.classList.toggle('on', k === i); r.setAttribute('aria-hidden', k !== i); });
    dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
  }
  dots.forEach(function (d, k) { d.addEventListener('click', function () { ver(k); clearInterval(timer); }); });
  if (rs.length > 1 && !reduce) timer = setInterval(function () { ver((cur + 1) % rs.length); }, 8000);
})();
