// El content script de Instagram no puede hablarle al CRM directo (CORS):
// le pide acá la lista de posts que ya están en el ideador.
importScripts('comun.js');

chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (msg?.tipo !== 'guardados') return false;
  apiCrm('/api/ideas')
    .then((ideas) => responder({ ok: true, codigos: ideas.filter((i) => i.tipo !== 'hook').map((i) => i.codigo).filter(Boolean) }))
    .catch((e) => responder({ ok: false, sinConexion: !!e.sinConexion, error: e.message }));
  return true;
});
