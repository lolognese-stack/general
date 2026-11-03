# Ideador · CRM de clientes (extensión de Chrome)

Guarda referencias de Instagram en el Ideador del CRM de cada cliente (los que salen de `plantilla-crm/nuevo-cliente.py`). Es otra extensión, aparte de la de Visite.ar (`ideador-contenido/extension`), y las dos pueden estar instaladas al mismo tiempo.

## Cargarla en Chrome

1. Abrí `chrome://extensions`.
2. Prendé **Modo de desarrollador** (arriba a la derecha).
3. Tocá **Cargar descomprimida** y elegí esta carpeta (`extension-crm-clientes`).
4. Fijala en la barra (ícono del rompecabezas → pin) para tener el popup a mano.

Cuando cambies algo en los archivos, tocá el botón de recargar de la extensión en `chrome://extensions` y recargá Instagram.

## Cómo se conecta a un CRM

No hay que configurar nada. Abrí una vez el panel del cliente (por ejemplo `https://crm-plantilla.pages.dev/panel-4c1f6a`) con la sesión iniciada. La extensión toma de esa página:

- la dirección del CRM,
- el token (`crm_token` del panel; no se muestra nunca),
- el nombre (el título de la página),
- los colores `--brand` y `--glacier`, que usan el popup y el botón. Si no los encuentra, usa rojo `#C8102E` y tinta `#3A1712`.

Se queda conectada a **un CRM a la vez**: el último panel que abriste. Si abrís el panel de otro cliente, reemplaza la conexión y el popup lo avisa ("Cambió la conexión: antes estaba en …"). El popup siempre dice a cuál está conectada.

En **Detalles → Opciones de extensión** (o en "Conexión", al pie del popup) se ve el CRM conectado y se puede desconectar.

Si el CRM rechaza el token (por ejemplo porque se rotó), la extensión lo borra y muestra "Abrí el panel del CRM para conectar la extensión". Se arregla abriendo el panel otra vez.

> Solo funciona con CRMs en `*.pages.dev`. Si algún cliente pasa a un dominio propio, hay que sumar ese dominio en `manifest.json` (`host_permissions` y el `matches` de `conectar.js`).

## Cómo se usa

- **En Instagram:** al lado de los likes, a la izquierda del corazón, aparece un botón cuadrado con una lamparita. Al tocarlo se abre a la derecha un panel con el formulario: formato, ángulo, puntajes, aplicación y views. La portada, el creador, los likes y los comentarios se completan solos. Al guardar, el botón queda relleno ("Ya está en el ideador").
- **Desde el popup:** con un post abierto, el ícono de la extensión abre el mismo formulario con el link cargado. También se puede pegar un link a mano.

Guardar dos veces el mismo post no lo duplica: lo actualiza en el CRM.

**Ángulos nuevos:** la última opción de la lista de ángulos es **"+ Nuevo ángulo…"**. Ahí se escribe el nombre, se elige la categoría (Problema, Solución, Producto u Otros) y queda creado en el CRM y elegido para la idea. Sirve para un cliente que todavía no tiene ángulos cargados. Si ya existe uno con el mismo nombre, se elige ese en vez de crear otro.

## Si Instagram cambia la barra y el botón deja de aparecer

El botón **no depende de clases** de Instagram. Se ubica así (todo en `instagram.js`):

1. Busca los `svg` con `aria-label` "Me gusta", "Like", "Ya no me gusta" o "Unlike" de 20 px o más (los corazones chicos de los comentarios no cuentan). Están en `LIKE` y en `esCorazonDeBarra()`.
2. Desde ese botón sube hasta el contenedor que también tiene el de comentar (`aria-label` "Comentar" / "Comment", en `COMENTAR`) e inserta el botón justo antes del corazón (`barraDe()`).
3. Saca el post del link `/p/CODE` o `/reel/CODE` del `article`, del modal o de la URL (`postDeBarra()`).

Qué revisar, en este orden:

- **Cambiaron los textos de accesibilidad.** En Instagram, click derecho sobre el corazón → Inspeccionar, y fijate el `aria-label` del `svg`. Si cambió, sumalo a `LIKE`. Lo mismo con el globo de comentar y `COMENTAR`.
- **Aparece en el lugar equivocado o no aparece.** Probablemente cambió la estructura entre el corazón y el de comentar. Revisá `barraDe()`: sube hasta 8 niveles y corta si se pasa a otro post.
- **Aparece pero guarda otro post.** Revisá `postDeBarra()`: cómo se encuentra el link del post en el feed, el modal y `/reels/`.

Para ver qué está pasando, abrí la consola en Instagram y corré `document.querySelectorAll('.crm-ext-btn').length`. Si da 0, el paso 1 o el 2 no encuentran nada.

## Archivos

| Archivo | Qué hace |
|---|---|
| `manifest.json` | Permisos y dónde corre cada script. |
| `comun.js` | Llamadas a la API del CRM, formatos y colores. Lo usan todos los demás. |
| `conectar.js` | Corre en `*.pages.dev/panel-*` y guarda la conexión. |
| `instagram.js` / `instagram.css` | El botón de la barra y el panel lateral. |
| `popup.html` / `.css` / `.js` | El formulario (popup y panel lateral, `?embebido=1`). |
| `opciones.html` / `.js` | Ver y borrar la conexión. |
| `background.js` | Le pasa a Instagram la lista de posts ya guardados (Instagram no puede pedírsela al CRM directo). |
