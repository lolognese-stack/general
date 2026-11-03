Armame una extensión de Chrome (Manifest V3) para guardar referencias de Instagram en el Ideador del CRM de clientes (la plantilla). Copiá como base la extensión que ya existe en `C:\Users\lala\repo\ideador-contenido\extension` (popup + panel lateral + botón dentro de Instagram que abre el formulario en un iframe), pero hacé una extensión NUEVA en `C:\Users\lala\repo\extension-crm-clientes`. No toques la de ideador-contenido: esa es la de Visite.ar y tiene que seguir andando.

## A qué CRM se conecta

- CRM de prueba: `https://crm-plantilla.pages.dev`, panel en `/panel-4c1f6a`.
- Cada cliente tiene su propio CRM (sale de `plantilla-crm/nuevo-cliente.py`): otro proyecto de Cloudflare Pages con otro nombre y otro panel `panel-xxxxxx`. La extensión NO puede tener la URL fija.
- Conexión automática: un content script corre en `https://*.pages.dev/panel-*`. Si en el localStorage de esa página hay `crm_token`, guarda en `chrome.storage.local` el par `{ crmUrl: location.origin, crmToken, crmNombre: document.title }`. Así, abrir una vez el panel del cliente deja la extensión conectada a ese CRM. Si se conecta a uno distinto, reemplaza el anterior y lo avisa en el popup ("Conectada a: <título>").
- Agregá una página de opciones mínima para ver a qué CRM está conectada y desconectarla. El token no se muestra nunca.

## API del CRM (la misma que el CRM de Visite)

Todas con header `x-crm-token: <crmToken>`:
- `GET /api/angulos`: lista de ángulos `{ id, nombre, categoria, activo }`. Categorías: Problema, Solución, Producto, Otros.
- `POST /api/ig-datos` con body `{ url }`: vista previa de un post. Devuelve `{ ok, image (data URL), likes, comentarios, creador, caption }`.
- `POST /api/ideas` con body `{ url, formato, formato_score, angulo_ids: [id], angulo_score, aplicacion, caption, creador, views, likes, comentarios, origen: 'extension' }`. Devuelve la idea; si ese post ya estaba, la actualiza (no duplica) y responde `actualizada: true`.
- `POST /api/foto-idea/:id` con body `{ mime, data }` (base64 sin el prefijo `data:`): guarda la portada. Mandala solo si la idea que volvió no tiene `foto_v`.
- `GET /api/ideas`: para saber qué posts ya están guardados (campo `codigo` = shortcode).

Si el CRM responde 401, borrá el token guardado y mostrá "Abrí el panel del CRM para conectar la extensión".

Los formatos van en una lista local: Broll Narrativo, Broll Texto, Clips Plan/Experiencia, Clip/s Paisaje, POV Paisaje, Carrusel, Foto con copy, MEME, GRWM, 3ra Persona, Versus Victor H, Talking Head.

## El botón en Instagram (lo más importante)

El botón va AL LADO DE LOS LIKES, a la izquierda del corazón, en la misma fila que corazón / comentar / compartir / guardar. Es un cuadrado chico (unos 28 px) con borde redondeado y un ícono SVG propio (nada de emojis), del mismo tamaño visual que los íconos de Instagram, para que parezca parte de la barra.

- Tiene que aparecer en: el feed, el post abierto en modal o en su página (/p/, /reel/) y el visor de reels (/reels/), donde la barra es vertical a la derecha: ahí el botón va arriba del corazón.
- Encontrá la barra por accesibilidad y estructura, nunca por clases (Instagram las cambia seguido). Buscá el botón de "Me gusta" / "Like" (svg con aria-label "Me gusta", "Like", "Ya no me gusta" o "Unlike"), subí a su contenedor de botones e insertá el tuyo como primer hijo. Sacá el link del post del article o del modal más cercano (href con /p/CODE o /reel/CODE). En /reels/ el post es el de la URL.
- Instagram es una SPA y recicla el DOM: usá un MutationObserver con debounce, marcá cada barra ya procesada con un data-attribute y verificá que el botón siga apuntando al post correcto (si cambió el código, actualizalo).
- Al tocarlo se abre el mismo formulario del popup en un panel a la derecha (iframe del popup en modo `embebido`, como en la extensión de ideador-contenido). Al guardar, el botón queda marcado (relleno) y el tooltip dice "Ya está en el ideador". Los posts ya guardados (según `GET /api/ideas`) también se marcan.
- Sacá el botón flotante "Guardar idea" que tenía la extensión vieja: ahora todo pasa por el de la barra.

## Diseño

Que siga los colores del CRM del cliente: leé del panel, en el mismo content script de conexión, el valor computado de las variables CSS `--brand` y `--glacier` y guardalos junto al token. Usá esos dos colores en el popup y en el botón. Si no hay valores, usá rojo `#C8102E` y tinta `#3A1712`.

No uses botones píldora coloridos. El popup tiene que ser limpio y estar al tono del CRM.

## Cómo probar

No hay Chrome real disponible para cargar la extensión. Probá con la técnica que ya se usó: copiá la extensión a una carpeta que sirva el mismo origen que el CRM local, con un `mock.js` que reemplace `chrome.*` sobre localStorage, y una página falsa de Instagram con la estructura de la barra (article, section, botones con svg aria-label "Me gusta"). Verificá:
- que el botón aparece a la izquierda del corazón,
- que sigue al post correcto al scrollear,
- que guarda contra el CRM.

Para levantar el CRM de la plantilla en local: `npx wrangler pages dev . --port 8789 --binding CRM_TOKEN=dev-cliente CRM_ADMIN_TOKEN=dev-admin`, desde `C:\Users\lala\repo\plantilla-crm`. Borrá las carpetas de prueba al terminar.

## Al final

Dejá un README corto con:
- cómo cargarla desde chrome://extensions (modo desarrollador, "Cargar descomprimida"),
- cómo se conecta a un CRM,
- qué hacer si Instagram cambia la barra y el botón deja de aparecer.
