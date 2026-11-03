# Contrato de datos de ventas: web ↔ CRM

Este archivo es la **única fuente de verdad** sobre cómo se guarda una venta. Lo usan dos proyectos que comparten la misma D1 (`crm-plantilla`, id `3bc152cd-ac4c-4043-baf7-9c84b68fa945`):

- **CRM** (`repo/plantilla-crm`): crea las tablas (migración 033), las muestra en la sección **Ventas** y opera los cambios de estado manuales.
- **Web** (`luna-llena-web`): crea las ventas desde el checkout y registra los pagos que avisan los webhooks de Stripe y PayPal.

Las reglas de convivencia:

- **Solo el CRM crea o altera estas tablas.** La web no trae migraciones propias para ellas.
- Si algún lado necesita una columna nueva, se agrega acá primero y después en una migración nueva del CRM.
- **Nunca se renombra ni se borra una columna.**

## Montos

**Siempre en centavos enteros** (`*_centavos INTEGER`), con la moneda al lado. Nada de `REAL`. Ejemplo: USD 1.234,50 → `123450`.

## Estados de una venta (`ventas.estado`)

| Estado | Quién lo pone | Significado |
|---|---|---|
| `pendiente_pago` | web | Se creó el checkout, pero el pago no llegó |
| `sena_pagada` | web (webhook) | Se cobró la seña. **La agencia tiene 24 h para confirmar** |
| `confirmada` | CRM (botón) | Hay cupo y la agencia la confirmó |
| `pagada` | CRM (automático) | Lo pagado alcanza el total: seña + saldo |
| `finalizada` | CRM (botón o automático) | El viaje ya terminó |
| `cancelada` | CRM (botón) | Se canceló. El reembolso, si lo hay, va como pago tipo `reembolso` |

Además, hay dos estados **calculados, que no se guardan**:

- **"Abandonada":** una venta en `pendiente_pago` con más de 2 h de antigüedad. Sirve para recuperar carritos por WhatsApp.
- **"Por confirmar vencida":** una venta en `sena_pagada` con más de 24 h desde el pago.

## Migración 033 (la escribe y la aplica el CRM)

```sql
CREATE TABLE IF NOT EXISTS ventas (
  id TEXT PRIMARY KEY,                       -- UUID v4, no adivinable (va en URLs públicas)
  lead_id INTEGER,                           -- leads.id (puede ser NULL al crearse)
  origen TEXT NOT NULL,                      -- 'web' | 'manual' | 'whatsapp'
  producto_slug TEXT NOT NULL,               -- slug del paquete en la web
  producto_nombre TEXT NOT NULL,             -- copia del nombre al momento de vender
  producto_categoria TEXT,                   -- viajes-completos | machu-picchu | tours-cusco | trekking | retiros
  opcion TEXT,                               -- ej. 'Tren Vistadome'
  fecha_inicio TEXT NOT NULL,                -- YYYY-MM-DD
  fecha_fin TEXT,                            -- YYYY-MM-DD
  adultos INTEGER NOT NULL DEFAULT 1,
  menores INTEGER NOT NULL DEFAULT 0,
  moneda TEXT NOT NULL DEFAULT 'USD',
  total_centavos INTEGER NOT NULL,
  sena_pct INTEGER NOT NULL DEFAULT 30,
  sena_centavos INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente_pago',
  nombre TEXT NOT NULL,                      -- quien reserva
  email TEXT NOT NULL,
  whatsapp TEXT,
  pais TEXT,
  notas_cliente TEXT,                        -- "¿algo que debamos saber?"
  notas_internas TEXT,                       -- solo el panel
  motivo_cancelacion TEXT,
  token_viajeros TEXT,                       -- 32 bytes aleatorios, base64url
  token_vence TEXT,                          -- ISO; = fecha_inicio - 15 días
  meta_json TEXT,                            -- utm, referrer, etc.
  sena_pagada_en TEXT,
  confirmada_en TEXT,
  cancelada_en TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas(estado);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha_inicio ON ventas(fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_ventas_lead ON ventas(lead_id);
CREATE INDEX IF NOT EXISTS idx_ventas_email ON ventas(email);

CREATE TABLE IF NOT EXISTS venta_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id TEXT NOT NULL,
  tipo TEXT NOT NULL,                        -- 'sena' | 'saldo' | 'reembolso' | 'ajuste'
  monto_centavos INTEGER NOT NULL,           -- siempre positivo; el signo lo da el tipo
  moneda TEXT NOT NULL,
  proveedor TEXT NOT NULL,                   -- 'stripe' | 'paypal' | 'transferencia' | 'efectivo' | 'yape' | 'otro'
  referencia TEXT,                           -- payment_intent de Stripe / capture id de PayPal / nro. de operación
  estado TEXT NOT NULL DEFAULT 'aprobado',   -- 'aprobado' | 'pendiente' | 'fallido'
  registrado_por TEXT NOT NULL,              -- 'webhook' | 'panel'
  nota TEXT,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venta_pagos_venta ON venta_pagos(venta_id);
-- Idempotencia de webhooks: el mismo pago no entra dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_venta_pagos_ref ON venta_pagos(proveedor, referencia) WHERE referencia IS NOT NULL;

CREATE TABLE IF NOT EXISTS venta_viajeros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id TEXT NOT NULL,
  orden INTEGER NOT NULL,                    -- 1..(adultos+menores)
  nombre_completo TEXT,                      -- como figura en el pasaporte
  nacionalidad TEXT,
  doc_tipo TEXT,                             -- 'pasaporte' | 'dni' | 'ce' | 'otro'
  doc_numero TEXT,
  fecha_nacimiento TEXT,                     -- YYYY-MM-DD
  sexo TEXT,                                 -- 'F' | 'M' | 'X'
  es_menor INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  UNIQUE (venta_id, orden)
);

CREATE TABLE IF NOT EXISTS venta_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id TEXT NOT NULL,
  tipo TEXT NOT NULL,                        -- 'creada' | 'pago' | 'estado' | 'viajeros' | 'nota' | 'mail'
  detalle TEXT,                              -- texto humano: "Seña USD 450 por Stripe"
  autor TEXT NOT NULL,                       -- 'web' | 'webhook' | 'panel:cliente' | 'panel:admin'
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venta_eventos_venta ON venta_eventos(venta_id);
```

## Qué escribe la web, paso a paso

1. **Checkout creado** (`POST /api/reservas`):
   - `INSERT INTO ventas` con `origen='web'`, `estado='pendiente_pago'`, los montos **calculados en el servidor** y `token_viajeros` / `token_vence` ya generados.
   - Además: `INSERT venta_eventos (tipo='creada', autor='web')`.
2. **Pago aprobado** (webhook de Stripe o captura de PayPal), todo en un `env.DB.batch([...])`:
   1. `INSERT INTO venta_pagos (tipo='sena', proveedor, referencia, registrado_por='webhook', …)`. Si choca contra `uq_venta_pagos_ref`, **es un webhook repetido: corta ahí y responde 200**.
   2. `UPDATE ventas SET estado='sena_pagada', sena_pagada_en=?, actualizado_en=? WHERE id=? AND estado='pendiente_pago'`.
   3. **Lead:** busca en `leads` por email (o WhatsApp). Si existe, enlázalo (`ventas.lead_id`) y pásalo a `etapa='ganado'`. Si no existe, créalo con `fuente='Web: reserva'`, `etapa='ganado'`, `destinos=producto_nombre`, `fecha_viaje=fecha_inicio`, `personas=adultos+menores`, `precio` (el total como texto, "USD 1.500") y `sena_pct`/`sena_fecha`. Después enlázalo.
   4. `INSERT venta_eventos (tipo='pago', detalle='Seña USD X por Stripe', autor='webhook')`.
3. **Pasaportes** (`/reserva/<id>/viajeros?t=…`):
   - Valida que el token coincida y no haya vencido.
   - Hace un `INSERT … ON CONFLICT(venta_id, orden) DO UPDATE` por viajero.
   - Agrega `venta_eventos (tipo='viajeros', detalle='3 de 4 completos')`.

**La web nunca hace** `confirmada`, `pagada`, `finalizada` ni `cancelada`: esos estados son del CRM.

## Link de pasaportes

```
{WEB_URL}/reserva/{id}/viajeros?t={token_viajeros}
```

El CRM lo arma con la variable `VENTAS_WEB_URL` (por ejemplo `https://luna-llena-web.pages.dev`) para poder copiarlo o mandarlo por WhatsApp desde el panel, también en las ventas cargadas a mano.

## Estado de la integración

_Copia del contrato que viaja con la plantilla del CRM (`repo/plantilla-crm/crm/`). La fuente original vive en `luna-llena-web/VENTAS-CONTRATO.md`; si cambia una, se actualiza la otra._

**En el CRM no falta nada.** Desde la migración 033 la sección Ventas funciona sola: carga manual de ventas (WhatsApp u otro), pagos, cambios de estado, pasaportes, historial y el bloque "Ventas" en el drawer de cada lead.

Para que la web se enchufe falta, solamente:

1. **`VENTAS_WEB_URL`** en el proyecto de Pages del CRM (por ejemplo `https://luna-llena-web.pages.dev`, sin barra final). Con eso el drawer arma el link de pasaportes y habilita **Copiar** y **Enviar por WhatsApp**. Sin ella, el panel muestra "Falta configurar la web" y deja esos botones deshabilitados. Para un cliente nuevo: `nuevo-cliente.py --web-url …`; en un proyecto existente: variable de entorno en Pages (o `[vars]` en su `wrangler.toml`) y deploy nuevo.
2. **Que la web escriba en la D1 según este contrato** (pasos 1 a 3 de arriba). El CRM no expone endpoints públicos para la web: la web comparte la D1 y escribe directo, como ya hace el formulario de viaje con `leads`.

Cómo lee el CRM lo que escribe la web:

- **Pagado** = pagos `aprobado` de tipo `sena` + `saldo` + `ajuste` − `reembolso`. **Saldo** = `total_centavos` − pagado.
- **Abandonada** = `pendiente_pago` con `creado_en` de hace más de 2 h. **Por confirmar vencida** = `sena_pagada` con `sena_pagada_en` de hace más de 24 h. Por eso la web tiene que llenar `sena_pagada_en` en el mismo `UPDATE` que pasa a `sena_pagada`.
- **Viajero completo** = `nombre_completo`, `nacionalidad`, `doc_numero` y `fecha_nacimiento` no vacíos (`sexo` y `doc_tipo` son opcionales). El contador "Pasaportes X/N" usa `N = adultos + menores`.
- **Fechas** en ISO 8601 UTC (`new Date().toISOString()`), igual que el resto de la base.
- **`registrado_por`**: el CRM escribe `'panel'`; la web, `'webhook'`.

Lo que hace el CRM de su lado (la web no lo repite):

- Una seña registrada a mano desde el panel hace lo mismo que el webhook: `pendiente_pago` → `sena_pagada` y el lead enlazado pasa a `ganado`.
- `confirmada` → `pagada` es automático cuando lo cobrado alcanza el total (al registrar el pago, o al confirmar si ya estaba todo cobrado).
- Regenerar el link de pasaportes pone un `token_viajeros` nuevo y `token_vence` = `fecha_inicio` − 15 días, o dentro de 7 días si esa fecha ya pasó. El link viejo deja de servir.
- Solo el rol admin puede borrar una venta, y solo si no tiene pagos.
