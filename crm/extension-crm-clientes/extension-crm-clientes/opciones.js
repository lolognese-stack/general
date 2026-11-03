// A qué CRM está conectada la extensión. El token nunca se muestra.

const $ = (id) => document.getElementById(id);

function muestra(color) {
  const s = document.createElement('span');
  s.className = 'muestra';
  s.style.background = color;
  return s;
}

async function pintar() {
  const con = await leerConexion();
  aplicarPaleta(document.documentElement, con.colores);
  const conectada = !!(con.crmUrl && con.crmToken);
  $('conectada').hidden = !conectada;
  $('desconectada').hidden = conectada;
  if (!conectada) return;

  $('nombre').textContent = con.crmNombre || '—';
  $('direccion').textContent = con.crmUrl;
  const p = paleta(con.colores);
  $('colores').replaceChildren(
    muestra(p.tinta), document.createTextNode(`${p.tinta}   `),
    muestra(p.acento), document.createTextNode(p.acento + (con.colores ? '' : ' (por defecto)')),
  );
}

$('desconectar').addEventListener('click', async () => {
  await chrome.storage.local.remove(['crmUrl', 'crmToken', 'crmNombre', 'colores', 'avisoCambio', 'conectadaEn']);
  pintar();
});

chrome.storage.onChanged.addListener(pintar);
pintar();
