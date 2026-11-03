# CRM: sección "Ventas" (base para conectar la web después)

Trabajas en `C:\Users\lala\repo\plantilla-crm`, la plantilla del CRM: Cloudflare Pages, Functions y D1. Tiene git local y no tiene remoto. Su deploy demo es el CRM que hoy usa **Luna Llena Travel** (`crm-plantilla.pages.dev/panel-4c1f6a`), con la D1 `crm-plantilla` (id `3bc152cd-ac4c-4043-baf7-9c84b68fa945`), **que tiene datos reales que el usuario usa todos los días**.

Hay que sumar una sección **Ventas** al panel, lista para que más adelante la web de Luna Llena (`luna-llena-web`, en construcción) escriba ahí las reservas que se pagan online con seña. **La web no se toca en esta tarea.** Al terminar, el CRM tiene que funcionar solo: cargar ventas a mano, registrar pagos y cambiar estados. Cuando la web esté lista, se conecta sin tocar el CRM.

Trabaja sin pedirme confirmaciones. Lo que no esté definido lo eliges tú, eligiendo lo más sensato, y lo anotas al final de este archivo, en "Decisiones tomadas". Responde en español y conciso. Verifica todo de verdad en el preview: nada de "debería funcionar".

## 0. Antes de empezar

- Corre `git status`. Puede haber cambios sin commitear de otra sesión (al 23/10 había una línea de `manychat_id` en `abrirDrawer`). **No los pises ni los descartes**: trabaja encima y commitea solo lo tuyo con `git add <archivos>` (nunca `-A`).
- Lee la memoria del proyecto (`crm-plantilla-clientes.md` y `luna-llena-travel.md`). Tienen reglas que ya costaron caro:
  - **El deploy de la demo va SIEMPRE por `deploy-demo.py` con los flags de Luna Llena.** Un `wrangler pages deploy .` directo vuelve el CRM a gris y a "CRM". El comando es: `python deploy-demo.py "#FF7A00" "#161616" --nombre "Luna Llena Travel" --favicon ../luna-llena-logos/d3-luna-grande/luna-llena-d3-luna-grande-icono.svg --accent-dark "#FFB066"`.
  - La plantilla del repo queda gris y genérica, porque `nuevo-cliente.py` la pinta para cada cliente. **Nada de "Luna Llena" hardcodeado** en el panel ni en las Functions.
- **Lee `C:\Users\lala\repo\luna-llena-web\VENTAS-CONTRATO.md`.** Es el contrato de datos que comparten la web y el CRM: tablas, estados, montos en centavos y qué escribe cada lado. **Impleméntalo tal cual.** Copia ese archivo a `crm/VENTAS-CONTRATO.md` dentro de esta plantilla, para que viaje con ella.
- Mira cómo está hecha una sección existente antes de inventar patrones:
  - `renderLeads` / `renderBoard` / `renderTabla` y el drawer de leads (`abrirDrawer`) en `panel-4c1f6a.html`.
  - `functions/api/leads.js` y `functions/api/leads/[id].js`.
  - `functions/_lib/auth.js`: roles `cliente`/`admin` con `checkToken` / `rolDe`.
  - Copia su estilo, sus tokens de color, sus componentes (botones, chips, drawer, KPIs) y su forma de rutear (`#/seccion/vista`).

## 1. Base de datos

- Crea `crm/migracion-033-ventas.sql` con **exactamente** el SQL del contrato: `ventas`, `venta_pagos`, `venta_viajeros` y `venta_eventos`, más sus índices. El encabezado sigue el estilo de la 032 (qué hace y cómo se aplica).
- Si `schema.sql` o `nuevo-cliente.py` aplican migraciones para los clientes nuevos, súmala para que todo cliente nuevo nazca con Ventas.
- Aplícala en **local** y prueba. **Después aplícala en remoto** sobre `crm-plantilla`. Es aditiva (solo `CREATE … IF NOT EXISTS`); igual, antes de aplicarla verifica con `SELECT name FROM sqlite_master` que las tablas no existan ya.
- Crea `crm/seed-ventas-demo.sql`, **solo para la D1 local**: unas 8 ventas de ejemplo en estados distintos, con pagos, viajeros y eventos. **Nunca lo apliques en remoto.**

## 2. API (Functions, todas con `checkToken`)

| Ruta | Qué hace |
|---|---|
| `GET /api/ventas` | Lista con filtros `?estado=&desde=&hasta=&q=`. Devuelve cada venta con lo **calculado**: `pagado_centavos` (aprobados: seña + saldo + ajustes − reembolsos), `saldo_centavos`, `viajeros_completos` / `viajeros_total`, `abandonada` (en `pendiente_pago` hace más de 2 h) y `confirmacion_vencida` (en `sena_pagada` hace más de 24 h). |
| `POST /api/ventas` | Venta **manual** (`origen='manual'` o `'whatsapp'`), para lo que se cierra por WhatsApp. Calcula `sena_centavos` desde `sena_pct`, genera el UUID, `token_viajeros` (32 bytes, base64url) y `token_vence` (= `fecha_inicio` − 15 días), y registra el evento `creada`. |
| `GET /api/ventas/:id` | El detalle con pagos, viajeros, eventos y el lead enlazado (nombre + etapa). |
| `PATCH /api/ventas/:id` | Edita los datos y hace las **transiciones de estado** válidas (ver abajo). Cada cambio deja un `venta_eventos` con autor `panel:cliente` o `panel:admin`, según el rol. |
| `POST /api/ventas/:id/pagos` | Registra un pago a mano (saldo, reembolso o ajuste), con proveedor, referencia y nota. Si con ese pago lo cobrado alcanza el total y la venta está `confirmada`, la pasa sola a `pagada`. |
| `PUT /api/ventas/:id/viajeros` | Carga o edita pasaportes desde el panel (upsert por `venta_id` + `orden`). |
| `POST /api/ventas/:id/token` | Regenera el link de pasaportes con un vencimiento nuevo. |

**Transiciones permitidas** (todo lo demás devuelve 409, con un mensaje claro):

```
pendiente_pago → sena_pagada   (solo si hay un pago 'sena' aprobado; en la web lo hace el webhook)
pendiente_pago → cancelada
sena_pagada    → confirmada | cancelada
confirmada     → pagada (automático por pagos) | cancelada
pagada         → finalizada | cancelada
```

- `cancelada` exige `motivo_cancelacion`.
- Si al cancelar ya había plata cobrada, la respuesta avisa que falta registrar el reembolso. El reembolso de verdad se hace en Stripe o PayPal; acá solo se registra.
- **Lead:** al crear una venta manual elegida desde un lead, o al pasar a `sena_pagada`, el lead enlazado pasa a `etapa='ganado'`, se guardan `sena_pct` / `sena_fecha` y se registra `precio` (por ejemplo, "USD 1.500"). Al cancelar, el lead **no** se mueve solo: queda en el panel para que lo decida una persona.
- Montos: siempre enteros en centavos en la API. El formato (`USD 1.500,00`) es solo del front.

## 3. Panel: sección "Ventas"

- **Navegación:** un botón nuevo en la barra lateral, **"Ventas"**, entre "Leads" y "Agendas & Setteo", con un ícono SVG del mismo estilo que los otros (por ejemplo, una etiqueta de precio o una bolsa). Rutas: `#/ventas/pipeline`, `#/ventas/tabla`, `#/ventas/salidas`, `#/ventas/<id>` (abre el drawer).
- **KPIs arriba,** con el mismo componente que los de Leads y un selector de período (este mes / mes pasado / 90 días):
  - **Vendido:** la suma de `total` de las ventas que llegaron al menos a `sena_pagada` dentro del período.
  - **Cobrado:** pagos aprobados netos dentro del período.
  - **Saldo por cobrar:** de las ventas activas (`sena_pagada`, `confirmada`).
  - **Por confirmar:** cantidad, en rojo si hay alguna con `confirmacion_vencida`.
  - **Carritos abandonados:** de los últimos 7 días.
- **Pipeline:** un kanban por estado, con las columnas Seña pagada · Confirmada · Pagada · Finalizada · Cancelada, y además "Pendiente de pago" como columna plegada al final.
  - Cada tarjeta lleva el nombre, el paquete, la fecha de salida, las personas, el total y lo pagado (con una barrita), un chip de "Pasaportes 2/4" y una alerta si la confirmación está vencida.
  - El drag & drop solo permite las transiciones válidas. Si la transición requiere un dato (motivo, pago), abre el drawer en vez de moverla.
- **Tabla:** ordenable y filtrable, con las mismas columnas más el origen y el proveedor de pago. Exporta a CSV, igual que Leads si ya lo hace.
- **Salidas:** una agenda de las próximas 8 semanas agrupada por `fecha_inicio`, para operar: quién sale, cuántos son, si falta saldo y si faltan pasaportes. Los faltantes se marcan **con ícono y texto**, no solo con color.
- **Carritos abandonados:** un filtro rápido (chip) que lista las ventas abandonadas, con botón de WhatsApp y un mensaje prellenado ("Hola <nombre>, vimos que estabas reservando <paquete> para el <fecha>. ¿Te ayudamos a terminar?").
- **Drawer de venta,** con el mismo patrón que el de leads:
  1. **Encabezado:** estado y acciones válidas según el estado actual (Confirmar, Registrar pago, Cancelar, Marcar finalizada).
  2. **Viaje:** paquete, opción, fechas y personas (editables).
  3. **Quien reserva:** datos de contacto, botón de WhatsApp y link al lead enlazado, o "Enlazar a un lead" con un buscador.
  4. **Montos:** total, seña (%), pagado y saldo, más la **lista de pagos** con proveedor y referencia, y el botón "Registrar pago".
  5. **Viajeros:** X de N completos, una tabla editable y el link de pasaportes con los botones **Copiar** y **Enviar por WhatsApp**. El link se arma con la variable de entorno **`VENTAS_WEB_URL`**; si no está configurada, se muestra "Falta configurar la web" y el botón queda deshabilitado con su motivo visible. También el botón "Regenerar link".
  6. **Notas internas.**
  7. **Historial:** `venta_eventos` en orden cronológico.
- **"Nueva venta"** (botón principal de la sección): un formulario en el drawer con un selector de lead (opcional) y, para el producto, un texto libre con nombre + slug + categoría, porque el catálogo vive en la web; más adelante se puede leer de ahí. Incluye fecha, adultos, menores, moneda (USD por defecto), total y % de seña (30 por defecto). Al guardar, ofrece registrar la seña ya cobrada.
- **Desde el drawer de un lead:** un bloque "Ventas" con las ventas enlazadas y el botón "Crear venta para este lead", que abre "Nueva venta" con los datos precargados.
- **Roles:** `cliente` y `admin` ven y operan todo Ventas. Solo `admin` puede borrar una venta: un borrado real, con confirmación escribiendo el nombre de la persona, y solo si no tiene pagos.
- Cuida el **mobile:** el kanban pasa a una lista agrupada por estado, el drawer ocupa la pantalla completa, los targets miden ≥ 44px y no hay scroll horizontal a 375px.
- Respeta el modo oscuro que ya tiene el panel, usando los tokens existentes y sin colores nuevos sueltos.

## 4. Preparado para la web (sin conectarla)

- Documenta en `crm/VENTAS-CONTRATO.md`, en una sección "Estado de la integración", qué falta para que la web se enchufe: nada en el CRM, solo `VENTAS_WEB_URL` y que la web escriba según el contrato.
- **No crees endpoints públicos sin token para la web:** comparte la misma D1 y escribe directo, como hoy hace `luna-llena-viaje` con `leads`.
- Agrega `VENTAS_WEB_URL` a la documentación de variables de la plantilla y a `nuevo-cliente.py`, si este maneja variables. En la demo, déjala **sin configurar** por ahora.

## 5. Verificación (obligatoria, con evidencia)

En el preview local (`wrangler pages dev` con D1 local + el seed):

1. La sección carga con los 5 KPIs y los números coinciden con el seed (cuéntalos a mano en SQL y compara).
2. Crea una venta manual desde un lead, registra la seña, confírmala, registra el saldo → pasa sola a `pagada` → márcala finalizada. El historial muestra cada paso y el lead quedó en `ganado`.
3. Pruebas de error:
   - Una transición inválida por API (por ejemplo, `pendiente_pago → confirmada`) devuelve 409.
   - Cancelar sin motivo se rechaza.
   - Cargar el mismo pago dos veces con igual proveedor + referencia rebota por el índice único.
4. Carga pasaportes desde el panel y verifica el contador X/N.
5. Prueba el mobile a 375px y el modo oscuro, con capturas.
6. Prueba "Simular la web": inserta por SQL, como lo haría la web según el contrato, una venta `pendiente_pago` + un pago `sena` vía `stripe` + el `UPDATE` a `sena_pagada`, y confirma que aparece bien en el panel, con la alerta de 24 h si le cambias la fecha.

Después:

- Aplica la migración en remoto y deploya la demo **con `deploy-demo.py` y los flags de Luna Llena**.
- Abre `crm-plantilla.pages.dev/panel-4c1f6a`. Para ver datos reales hace falta el token del navegador del usuario; si no lo tienes, verifica al menos que el panel cargue, que la sección Ventas aparezca vacía y que el nombre y la paleta sigan siendo los de Luna Llena.
- Commitea solo tus archivos con mensajes `feat(ventas): …`, sin pushear (no hay remoto).
- Actualiza la memoria `crm-plantilla-clientes.md` con: sección Ventas, migración 033 y `VENTAS_WEB_URL`.

## Decisiones tomadas

**Datos y API**

- Una venta manual nace en `pendiente_pago`. La seña se registra como pago (el drawer lo ofrece apenas se crea, o con "Registrar seña"), y eso la pasa sola a `sena_pagada`, igual que el webhook. Por eso `POST /pagos` acepta también el tipo `sena`, no solo saldo/reembolso/ajuste.
- El lead pasa a `ganado` (con `sena_pct`, `sena_fecha` = hoy y `precio` "USD 1.800", sin centavos) en tres casos: venta creada desde un lead, paso a `sena_pagada` y enlazar un lead a una venta que ya tiene la seña. Queda un `eventos` del lead con `quien='ventas'`. Al cancelar, el lead no se toca.
- `confirmada → pagada` por PATCH solo si lo cobrado alcanza el total (si no, da 409 y dice cuánto falta). Además pasa sola al registrar el pago y al confirmar una venta que ya estaba toda cobrada.
- En una cancelada solo se puede registrar un reembolso, y ningún reembolso puede superar lo cobrado.
- `sena_centavos` se recalcula al editar el total o el % solo mientras está en `pendiente_pago`. Después queda la seña que efectivamente se cobró.
- `token_vence`: al crear es `fecha_inicio − 15 días`, como dice el contrato. Al regenerar o al mover la salida, si esa fecha ya pasó, se da una semana desde hoy. Con el link vencido, Copiar y WhatsApp quedan deshabilitados con su motivo.
- Viajero completo = nombre, nacionalidad, número de documento y fecha de nacimiento. El sexo y el tipo de documento son opcionales.
- Las ventas por WhatsApp pueden no tener email: se guarda `''` porque el contrato lo pide NOT NULL.
- Las ediciones se registran en `venta_eventos` con tipo `nota` ("Datos editados: …", "Enlazada al lead …", "Notas internas actualizadas"), para no inventar tipos fuera del contrato.
- `?desde=&hasta=` filtran por `creado_en`. También agregué `?lead_id=`, que usa el bloque Ventas del drawer del lead.
- `VENTAS_WEB_URL` viaja en el `GET /api/ventas/:id` como `web_url`. No hace falta un endpoint nuevo.
- El seed suma 3 leads de ejemplo (ids 9001-9003) para enlazar ventas. Es solo local, como el resto del seed.

**Panel**

- **Vendido:** el total de las ventas en `sena_pagada`, `confirmada`, `pagada` o `finalizada`, fechadas por `sena_pagada_en` (o `confirmada_en` / `creado_en` si falta). Las canceladas no cuentan aunque hayan pasado por la seña.
- **Cobrado:** los pagos aprobados netos, por la fecha del pago.
- **Saldo**, **Por confirmar** y **Carritos** no dependen del período.
- Los montos de distintas monedas se suman por separado ("USD 1.500 · PEN 300"), nunca mezclados.
- **Abandonada** sigue la definición del contrato, para cualquier origen. El KPI y el chip muestran solo las de los últimos 7 días.
- Las ventas se recargan al entrar a la sección y cada 30 s mientras está visible, no cada 8 s como los leads, para cuidar el cupo de lecturas de D1.
- **Drag:**
  - Las columnas inválidas se apagan mientras arrastras.
  - Si sueltas en Cancelada, en Seña pagada o en Pagada con saldo pendiente, se abre el drawer con el formulario que corresponde.
  - "Pendiente de pago" va plegada al final y se despliega con un botón.
- **CSV:** Leads no exportaba CSV; Ventas sí (con BOM, para Excel).
- **Mobile:** en la tabla scrollea su contenedor, igual que en Leads, pero la página no tiene scroll horizontal a 375px.
- La categoría es texto libre, con sugerencias de las que ya se usaron. Las monedas salen de una lista fija (USD, PEN, EUR, ARS, MXN, CLP, COP y BRL). Nada es propio de Luna Llena.
- **Borrar:** solo el admin y solo si la venta no tiene pagos. Pide el nombre (sin distinguir mayúsculas) y borra también los viajeros y el historial.
- Esta sección no tiene flechas arriba/abajo para pasar de una venta a otra en el drawer, como tienen los leads.

**Entorno y git**

- `nuevo-cliente.py --web-url` escribe `VENTAS_WEB_URL` en `[vars]` del `wrangler.toml` del cliente. En la demo queda sin configurar.
- La línea `manychat_id` de la otra sesión sigue sin commitear en el working tree. Armé el índice del panel sin ella, y la demo se deployó desde `git archive HEAD`, así que **esa línea todavía no está en producción**.
- Este archivo (`PROMPT-VENTAS.md`) tampoco está commiteado.
- Se verificó en local con la D1 local + el seed, y en un segundo `pages dev` con `VENTAS_WEB_URL` para probar el link. En remoto solo se aplicó la migración 033: 13 objetos nuevos y los datos de antes intactos.
