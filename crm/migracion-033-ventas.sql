-- Migración 033: ventas (reservas con seña, pagos, viajeros e historial)
--
-- Base de la sección Ventas del panel. Las mismas tablas las escribe la web
-- de la agencia cuando cobra una seña online (checkout + webhooks), así que el
-- SQL es copia exacta de crm/VENTAS-CONTRATO.md: si hace falta una columna
-- nueva, primero se agrega al contrato y después va en otra migración. Montos
-- siempre en centavos enteros. Solo CREATE ... IF NOT EXISTS: es idempotente
-- y no toca nada de lo que ya existe.
--
-- Aplicar:
--   npx wrangler d1 execute <proyecto> --remote --file=crm/migracion-033-ventas.sql

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
