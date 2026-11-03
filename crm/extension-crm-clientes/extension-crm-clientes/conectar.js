// Corre en https://*.pages.dev/panel-*: cada CRM de cliente es su propio
// proyecto de Pages, así que la extensión se conecta al panel que se abra.
// Si el panel tiene crm_token en localStorage, guarda URL + token + título +
// colores. Abrir el panel de otro cliente reemplaza la conexión anterior.

(() => {
  // El valor crudo de una variable puede ser otra var(); pintarla en un
  // elemento devuelve el color ya resuelto.
  function colorDeVariable(nombre) {
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;visibility:hidden;color:var(${nombre})`;
    document.body.appendChild(el);
    const color = getComputedStyle(el).color;
    el.remove();
    const crudo = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return crudo ? aHex(color) : null;
  }

  // Con el panel en tema oscuro las variables son claras y no sirven para
  // pintar sobre blanco: en ese caso se mantienen los colores que ya había.
  function coloresDelPanel() {
    const brand = colorDeVariable('--brand');
    const glacier = colorDeVariable('--glacier');
    if (!brand || !glacier) return null;
    const { tinta } = paleta({ brand, glacier });
    if (contrasteConBlanco(tinta) < 4.5) return undefined;
    return { brand, glacier };
  }

  async function conectar() {
    let token;
    try { token = localStorage.getItem('crm_token'); } catch { return; }
    if (!token) return;

    const antes = await chrome.storage.local.get(['crmUrl', 'crmToken', 'crmNombre', 'colores']);
    const crmUrl = location.origin;
    const crmNombre = (document.title || '').trim() || location.hostname;
    const colores = coloresDelPanel();

    const cambios = {};
    if (antes.crmUrl !== crmUrl || antes.crmToken !== token) {
      cambios.crmUrl = crmUrl;
      cambios.crmToken = token;
      cambios.conectadaEn = Date.now();
      if (antes.crmUrl && antes.crmUrl !== crmUrl) cambios.avisoCambio = antes.crmNombre || antes.crmUrl;
    }
    if (antes.crmNombre !== crmNombre) cambios.crmNombre = crmNombre;
    // Otro CRM sin colores legibles: no quedarse con los del cliente anterior.
    if (colores == null && antes.crmUrl !== crmUrl) cambios.colores = null;
    if (colores && JSON.stringify(colores) !== JSON.stringify(antes.colores)) cambios.colores = colores;

    if (Object.keys(cambios).length) await chrome.storage.local.set(cambios);
  }

  // Si se recarga la extensión, este script queda huérfano y chrome.* tira.
  const intentar = () => conectar().catch(() => {});
  intentar();
  // El token puede aparecer después (login en el panel) o cambiar de tema.
  setInterval(intentar, 3000);
})();
