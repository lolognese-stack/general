# Plan: cotizaciones y propuestas dentro del CRM (Luna Llena Travel)

## Contexto

Hoy cotizar y proponer está repartido en cinco piezas: el panel del CRM, la página suelta `cotizaciones-4c1f6a` (otro diseño), la página suelta `propuestas-4c1f6a`, la pestaña vieja "Cotizador" (motor Python en Vercel, otro tarifario) y el armador + repo de propuestas (build y deploy a mano). El borrador de cotización no arma itinerario: solo ubica servicios elegidos a mano. La página de Ulises no es una plantilla: es HTML escrito por IA más inyecciones por regex.

Objetivo: una sola herramienta. Lead en el inbox → "Nuevo pedido" → el sistema arma itinerario y cotiza → Álvaro ajusta y aprueba → Lorenzo publica la propuesta con el diseño de Ulises.

## Decisiones tomadas

| # | Decisión | Por qué |
|---|---|---|
| 1 | Cotizaciones pasa a ser sección nativa del panel (`#/cotizaciones`), con sus componentes. API `/api/ct/*` y tablas `ct_*` no cambian; `/cotizaciones-4c1f6a` redirige. | Una sola navegación, diseño y login; los datos ya están en la D1 del CRM. |
| 2 | Pestaña vieja "Cotizador": se rescata lo que no se pisa (Pegar chat, Pegar/Subir Excel) y se oculta. | No puede haber dos cotizadores con precios distintos. |
| 3 | Obligatorios para crear pedido: destinos, días, personas, fecha. El resto viaja si está. | Sin esos cuatro no hay itinerario ni tarifa. |
| 4 | Sin fecha exacta: fecha tentativa elegida al crear, marcada en pedido, cotización y propuesta. | No frenar leads sin pasajes; la tarifa necesita un día. |
| 5 | "Nuevo pedido" siempre visible junto a "Pasar a Álvaro"; al tocarlo lee el chat con IA, precarga y marca lo que falta para completar ahí. | Reusa el análisis del pase actual; no depende de que la IA acierte sola. |
| 6 | Los dos botones conviven. Si el lead ya tiene pedido, la ficha del pase incluye el link al pedido y el chat muestra su estado. | El pase manual queda para casos raros sin romper lo que existe. |
| 7 | Álvaro usa el mismo editor del CRM con acceso de rol "cotizador" (solo ve Cotizaciones). El link `/r/#token` se retira. | Un solo editor; él ajusta itinerario y precios, no solo precios. |
| 8 | Lorenzo arma la base y puede editar líneas; Álvaro ajusta todo y aprueba. | Lorenzo todavía no conoce el producto; Álvaro tiene la última palabra. |
| 9 | Itinerarios: botón "Actualizar desde la web" que lee la web publicada y muestra qué cambió antes de aplicar. | Sin scripts locales ni cron (la cuenta está en el tope de 5). |
| 10 | Armado: la IA propone eligiendo días y tours del catálogo por id, sin ver precios; el código valida y calcula. | Flexible sin inventar servicios; la IA nunca calcula precios. |
| 11 | Tour sin tarifa: precio publicado en la web como sugerido, marcado; Álvaro confirma o corrige cada uno antes de aprobar. | Total estimado desde el inicio sin dar por bueno un precio dudoso. |
| 12 | Días que no alcanzan: dos borradores. A respeta los días, recorta y avisa. B arma lo que pidió el cliente con avisos de por qué no es viable. | Álvaro elige con las dos caras a la vista. |
| 13 | Destino que la web no tiene: se arma como ilustración (marcado, sin precio) y Álvaro corrige. | No perder lo que sí se puede armar solo. |
| 14 | Reglas de viaje (orden, altura, traslados) avisan, no bloquean. Editables. | Las reglas iniciales nadie las validó; Álvaro decide. |
| 15 | Paquete publicado: la cotización muestra precio por componentes y precio web; Álvaro marca cuál vale. | Los dos números difieren mucho (639 vs 1.136-1.728). |
| 16 | Propuesta: la sirve el CRM desde la base, en el dominio actual `luna-llena-propuestas.vercel.app/<slug>/`. Ulises queda congelada en su URL. | Publicar o corregir es un botón, sin deploy; los links viejos no se rompen. |
| 17 | Textos por día: la IA redacta desde la ficha web, una vez; quedan guardados y editables en la vista previa. | Calidad de Ulises sin inventar servicios; página estable. |
| 18 | Con precios de prueba: vista previa interna con banda "PRECIOS DE PRUEBA"; sin link público ni "enviada". | Permite probar el flujo completo sin riesgo de enviar. |
| 19 | Lorenzo genera, revisa y publica la propuesta. | Los textos de venta son suyos. |
| 20 | Orden: flujo de punta a punta (fases abajo), cada fase probada en local y publicada con OK. | Cada fase deja algo usable. |

## Modelo de datos (migración 059, sobre la D1 `crm-plantilla`)

Tablas nuevas:

- `ct_web_productos`: `id` (slug de la web), `tipo` (paquete | tour), `nombre`, `zona`, `ciudades` (JSON), `dias`, `noches`, `precio_web_cent`, `url`, `incluye`, `no_incluye`, `fotos` (JSON), `hash`, `leido_en`, `activo`.
- `ct_web_dias`: `producto_id`, `dia`, `ciudad`, `titulo`, `relato`, `foto`, `incluye`.
- `ct_web_lecturas`: cuándo, quién, altas / cambios / bajas.
- `ct_reglas`: `tipo` (ciudad | conexion | aclimatacion), `datos` (JSON: altura, orden, horas de traslado, día completo sí/no), `es_prueba` (1 hasta que Álvaro la valide).
- `ct_propuestas`: `id`, `pedido_id`, `cotizacion_id`, `lead_id`, `slug` (único, `<nombre>-<6 al azar>`), `estado` (borrador | publicada | retirada), `version`, `datos_json` (portada, días con relato, horarios y foto, incluye, precio por persona y desglose), `valid_until`, `changelog`, `publicada_por`, `publicada_en`.

Columnas nuevas:

- `ct_servicios.web_id`: une el servicio del tarifario con el tour de la web.
- `ct_pedidos`: `dias`, `fecha_tentativa`, `conversacion_id`, `paquete_web_id`, `origen` (inbox | manual | chat | excel).
- `ct_cotizaciones`: `variante` (A | B | NULL), `precio_modo` (componentes | paquete_web), `paquete_web_cent`. La variante descartada pasa a `reemplazada` (estado que ya existe).
- `ct_lineas`: `origen_precio` (tarifario | web | manual | excel), `sin_confirmar`, `web_producto_id`, `web_dia`. Lo ilustrativo usa `es_ilustrativa`, que ya existe.

Sin cambios: tarifario, configuración, registro de cambios, tracking de propuestas (`propuesta_*`, migración 054), seguimientos (055). `cotizador_cotizaciones` (cotizador viejo) queda de solo lectura.

Regla de bloqueo, en un solo lugar (`functions/_lib/cotizar.js`, `usaPrueba` ampliada): no se publica ni se marca enviada si hay tarifa o configuración de prueba, línea ilustrativa, precio web sin confirmar, línea con problema, o cotización sin aprobar.

Acceso: secret nuevo `CRM_COTIZADOR_TOKEN` → rol `cotizador` en `functions/_lib/auth.js`. `checkToken` deja de aceptarlo; solo `/api/ct/*` y `/api/yo` lo admiten.

## Pantallas

1. **Cotizaciones** (sección del panel): Pedidos · Tarifario (servicios, hoteles, importar) · Itinerarios de la web · Configuración (margen, tipo de cambio, reglas, registro de cambios).
2. **Pedido**: datos del lead, borradores A/B lado a lado cuando hay dos, itinerario día por día editable, avisos arriba, totales (componentes y precio web si es paquete), acciones: rearmar, mandar a Álvaro, aprobar, pedir cambios.
3. **Inbox**: botón "Nuevo pedido" + diálogo precargado; chip con el estado del pedido; el pase a Álvaro lleva el link.
4. **Propuesta** (dentro del pedido): generar, vista previa editable (textos, fotos, vencimiento), publicar, nueva versión con changelog.
5. **Propuestas** (sección del panel): el tracking de `propuestas-4c1f6a`, nativo.
6. **Página pública**: plantilla con las secciones de Ulises (inicio, recorrido, itinerario, incluye, autoridad, inversión, reserva, confianza, preguntas, barra inferior).

Fijo en la plantilla: estructura, estilos, quiénes somos, cómo reservar, medios de pago, cancelación, FAQ, testimonios por tag, términos (hoy en `config.json`, pasan a `propuestas_config`). Cambia por cliente: portada (nombre, país, fechas, viajeros), recorrido, días, fotos, incluye, precio, vencimiento, versión.

## Fases

Trabajo en un worktree del clon `%TEMP%\crm-general` (rama `deploy-cotizador`). Publicar: `deploy-demo.py` con flags de Luna Llena `--seco`, diff del panel contra producción, migración remota y `wrangler pages deploy`, siempre con OK.

**Fase 1. Sección nativa y acceso de Álvaro.** Portar `cotizaciones-4c1f6a.html` al panel con sus componentes (`ag-sec-h`, `wb-panel`, `pf2-card`); rol cotizador; redirección de la URL vieja y de `/r/`.
Terminado: todo lo que hoy se hace en la página suelta se hace en `#/cotizaciones`; con el token de cotizador solo se ve esa sección y el resto de la API da 403; tests `probar-tarifario`, `probar-cotizar` pasan.

**Fase 2. "Nuevo pedido" en el inbox.** Reusa `ibAnalisisParaPase` e `ibDatosViaje` del panel; fecha tentativa; enlace pedido ↔ lead ↔ chat; pase con link.
Terminado: desde un chat de prueba se crea el pedido sin tipear nada que ya esté en la ficha; si falta un obligatorio no deja crear; el chat muestra el estado; el pase incluye el link.

**Fase 3. Itinerarios de la web y armado automático.** Lector de la web (port de `luna-llena-armador/scripts/gen-catalogo.mjs`, en tandas por el límite de 50 lecturas por pedido); mapa tour web ↔ servicio; armado con `functions/_lib/claude.js` + validador de reglas; dos borradores; ilustrativos; precio web sugerido; doble total en paquetes.
Terminado: "Actualizar desde la web" carga los 12 paquetes y los tours y muestra el diff; cuatro pedidos de prueba dan lo esperado (paquete tal cual, a medida que encaja, días cortos con A y B, destino no publicado como ilustración); tests nuevos del validador y del cruce con tarifario pasan; nada con ilustrativos o precio web sin confirmar se puede aprobar.

**Fase 4. Plantilla de propuesta.** Un solo renderizador `datos_json → HTML` que une `luna-llena-armador/functions/_lib/propuesta-render.js`, `ll.css`/`ll.js` y las inyecciones de `luna-llena-propuestas/scripts/build.mjs` + `_venta/`; relatos por IA; vista previa; ruta pública en el CRM y rewrite en el `vercel.json` de `luna-llena-propuestas` (las carpetas estáticas ganan, Ulises no cambia); sección Propuestas nativa; al publicar: lead a `propuesta_enviada`, link, precio y seguimientos.
Terminado: con los datos de Ulises la plantilla da las mismas secciones y el mismo aspecto que la publicada (comparación lado a lado en escritorio y celular); una cotización de prueba solo se ve con login y banda roja, sin link público; el tracking registra aperturas de una propuesta nueva; la URL de Ulises responde igual que hoy.

**Fase 5. Rescates y retiro.** "Pedido desde texto pegado" y "Pegar/Subir Excel" (líneas con precio del Excel, origen `excel`) dentro de Cotizaciones; ocultar la pestaña vieja.
Terminado: el Excel de Ulises entra como cotización con sus precios; un chat pegado crea un pedido; el menú ya no muestra "Cotizador"; las cotizaciones viejas guardadas en leads se siguen viendo.

## Verificación

- Tests de nodo existentes y nuevos (`node crm/probar-*.mjs`).
- Cada fase en el navegador local con `wrangler pages dev` y D1 local (schema + migraciones + seed de prueba), escritorio y celular.
- Antes de cada deploy: diff del panel contra producción; después: prueba en vivo de solo lectura.

## Abierto

- Tarifas reales (hay 16 propias; el resto es de prueba), margen y tipo de cambio sin confirmar: mientras tanto nada sale al cliente.
- Reglas de viaje y mapa tour web ↔ servicio: los propongo yo, los valida Álvaro.
- Fichas de la web con relato corto o sin duración (8 treks) y conflictos de `data/conflictos.md`: el lector los informa, no los inventa.
- PDF de la propuesta: la página nueva no lo ofrece; queda "imprimir" del navegador salvo que se pida otra cosa.
- Reserva online (`/reservar/`) sigue apagada: "Quiero reservar" va a WhatsApp.
- Armador en Pages y API Python en Vercel quedan vivos sin uso; apagarlos se decide después de la fase 5.
- Datos de la agencia que ya faltaban: link de pago, transferencia, Cal.com, FAQ pendientes.
