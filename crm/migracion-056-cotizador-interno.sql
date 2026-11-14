-- Migración 056: cotizador interno (tarifario, configuración, pedidos y cotizaciones).
-- Lorenzo carga el pedido, el sistema arma el borrador y Álvaro lo revisa y aprueba desde el celular.
-- Todo lo que es tabla ct_* es interno: netos y margen nunca salen en nada que vea el cliente.
-- Importes en centavos (INTEGER) para no arrastrar errores de punto flotante.
-- Aplicar: npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-056-cotizador-interno.sql
-- Seed de tarifas de prueba (aparte, se puede volver a correr): crm/seed-cotizador-ilustrativo.sql

-- Configuración editable desde la pantalla. es_prueba = 1 mientras nadie confirme el valor:
-- una cotización que usa un valor de prueba sale con el cartel PRECIOS DE PRUEBA.
CREATE TABLE IF NOT EXISTS ct_config (
  clave          TEXT PRIMARY KEY,   -- margen_pct | tc_pen_por_usd | recargo_tarjeta_pct | igv_pct
  valor          TEXT NOT NULL,
  es_prueba      INTEGER NOT NULL DEFAULT 0,
  actualizado_por TEXT,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Temporadas que se repiten todos los años (MM-DD). Un rango puede cruzar el año (12-15 a 01-10).
-- Un día que no cae en ninguna 'alta' es 'baja'.
CREATE TABLE IF NOT EXISTS ct_temporadas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  temporada TEXT NOT NULL CHECK (temporada IN ('alta', 'baja')),
  desde_md  TEXT NOT NULL,           -- MM-DD
  hasta_md  TEXT NOT NULL,           -- MM-DD (inclusive)
  nota      TEXT,
  es_prueba INTEGER NOT NULL DEFAULT 0
);

-- Catálogo de servicios (todo menos hoteles).
CREATE TABLE IF NOT EXISTS ct_servicios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clave       TEXT NOT NULL UNIQUE,  -- tipo|ciudad|nombre normalizado: así el importador encuentra el servicio
  nombre      TEXT NOT NULL,
  ciudad      TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('tour', 'traslado', 'tren', 'entrada', 'paquete')),
  duracion    TEXT,                  -- texto libre: "Medio día", "2D/1N"
  incluye     TEXT,
  no_incluye  TEXT,
  pax_min     INTEGER NOT NULL DEFAULT 1,
  precio_es_venta INTEGER NOT NULL DEFAULT 0, -- 1 = lo opera Luna Llena: la tarifa ya es precio de venta (sin margen)
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tarifas por persona. pax_hasta NULL = "y más" (7+). temporada 'todas' vale para alta y baja.
CREATE TABLE IF NOT EXISTS ct_tarifas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id   INTEGER NOT NULL REFERENCES ct_servicios(id),
  neto_cent     INTEGER NOT NULL CHECK (neto_cent >= 0),
  moneda        TEXT NOT NULL CHECK (moneda IN ('USD', 'PEN')),
  pax_desde     INTEGER NOT NULL DEFAULT 1,
  pax_hasta     INTEGER,
  temporada     TEXT NOT NULL DEFAULT 'todas' CHECK (temporada IN ('todas', 'alta', 'baja')),
  vigente_desde TEXT NOT NULL,       -- YYYY-MM-DD
  vigente_hasta TEXT NOT NULL,       -- YYYY-MM-DD (inclusive)
  es_ilustrativa INTEGER NOT NULL DEFAULT 0,
  fuente        TEXT,                -- de dónde salió (archivo importado, "a mano")
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ct_tarifas_servicio ON ct_tarifas (servicio_id);

CREATE TABLE IF NOT EXISTS ct_hoteles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clave       TEXT NOT NULL UNIQUE,  -- ciudad|categoria|nombre normalizado
  ciudad      TEXT NOT NULL,
  categoria   TEXT NOT NULL CHECK (categoria IN ('economico', 'confort', 'premium')),
  nombre      TEXT NOT NULL,
  es_ilustrativo INTEGER NOT NULL DEFAULT 0,
  precio_es_venta INTEGER NOT NULL DEFAULT 0, -- 1 = la tarifa ya es precio de venta (sin margen)
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Precio neto por noche y por habitación (no por persona).
CREATE TABLE IF NOT EXISTS ct_hotel_tarifas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id      INTEGER NOT NULL REFERENCES ct_hoteles(id),
  habitacion    TEXT NOT NULL CHECK (habitacion IN ('SGL', 'DBL', 'TPL')),
  neto_cent     INTEGER NOT NULL CHECK (neto_cent >= 0),
  moneda        TEXT NOT NULL CHECK (moneda IN ('USD', 'PEN')),
  temporada     TEXT NOT NULL DEFAULT 'todas' CHECK (temporada IN ('todas', 'alta', 'baja')),
  vigente_desde TEXT NOT NULL,
  vigente_hasta TEXT NOT NULL,
  es_ilustrativa INTEGER NOT NULL DEFAULT 0,
  fuente        TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ct_hotel_tarifas_hotel ON ct_hotel_tarifas (hotel_id);

-- Pedidos (los carga Lorenzo). lead_id opcional: une el pedido con el lead del CRM.
CREATE TABLE IF NOT EXISTS ct_pedidos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER REFERENCES leads(id),
  nombre        TEXT NOT NULL,
  pais          TEXT,
  fecha_inicio  TEXT,                -- YYYY-MM-DD
  fecha_fin     TEXT,
  pasajeros     INTEGER NOT NULL DEFAULT 2,
  destinos      TEXT,                -- JSON: [{"ciudad":"Cusco","noches":3}, …] en orden de viaje
  servicios     TEXT,                -- JSON: ids de ct_servicios que pidió el cliente (el borrador los ubica por día)
  categoria_hotel TEXT CHECK (categoria_hotel IS NULL OR categoria_hotel IN ('economico', 'confort', 'premium', 'sin_hotel')),
  pedidos_especiales TEXT,
  estado        TEXT NOT NULL DEFAULT 'nuevo'
                CHECK (estado IN ('nuevo', 'borrador_listo', 'en_revision', 'aprobada', 'enviada', 'cerrada', 'perdida')),
  estado_desde  TEXT NOT NULL DEFAULT (datetime('now')),
  creado_por    TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ct_pedidos_estado ON ct_pedidos (estado);

-- Historial de estados: de acá sale "hace cuánto está en cada estado".
CREATE TABLE IF NOT EXISTS ct_pedido_estados (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id  INTEGER NOT NULL REFERENCES ct_pedidos(id),
  estado     TEXT NOT NULL,
  por        TEXT,
  nota       TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ct_pedido_estados_pedido ON ct_pedido_estados (pedido_id);

-- Cotizaciones: una por versión. Aprobada = no se edita más (se crea la versión siguiente).
-- Los valores de configuración usados quedan congelados en config_json.
CREATE TABLE IF NOT EXISTS ct_cotizaciones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id     INTEGER NOT NULL REFERENCES ct_pedidos(id),
  version       INTEGER NOT NULL DEFAULT 1,
  estado        TEXT NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador', 'en_revision', 'cambios_pedidos', 'aprobada', 'reemplazada')),
  config_json   TEXT,                -- margen, tipo de cambio, recargo e IGV con los que se calculó
  total_neto_cent  INTEGER NOT NULL DEFAULT 0,  -- USD
  total_venta_cent INTEGER NOT NULL DEFAULT 0,  -- USD
  usa_prueba    INTEGER NOT NULL DEFAULT 0,     -- 1 = alguna tarifa o valor de configuración es de prueba: no se puede enviar
  problemas     INTEGER NOT NULL DEFAULT 0,     -- líneas sin tarifa, sin hotel o sin fecha
  notas_alvaro  TEXT,
  avisos        TEXT,                -- JSON: avisos del armado automático (fechas, servicios que no entran…)
  token_hash    TEXT,                -- SHA-256 del token del link de revisión (el token no se guarda)
  aprobada_por  TEXT,
  aprobada_en   TEXT,
  creado_por    TEXT,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pedido_id, version)
);
CREATE INDEX IF NOT EXISTS idx_ct_cotizaciones_token ON ct_cotizaciones (token_hash);

-- Líneas de la cotización: copia de lo que se cotizó (si la tarifa cambia después, la línea no cambia).
CREATE TABLE IF NOT EXISTS ct_lineas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id   INTEGER NOT NULL REFERENCES ct_cotizaciones(id),
  dia             INTEGER,           -- día del itinerario (1, 2…); hoteles: día de llegada
  orden           INTEGER NOT NULL DEFAULT 0,
  fecha           TEXT,              -- YYYY-MM-DD del día (hoteles: check-in)
  tipo            TEXT NOT NULL,     -- tour | traslado | tren | entrada | paquete | hotel | manual
  servicio_id     INTEGER,
  hotel_id        INTEGER,
  tarifa_id       INTEGER,           -- ct_tarifas.id o ct_hotel_tarifas.id según el tipo
  descripcion     TEXT NOT NULL,
  pasajeros       INTEGER NOT NULL DEFAULT 1,
  cantidad        INTEGER NOT NULL DEFAULT 1, -- noches para hoteles, 1 para el resto
  habitacion      TEXT,              -- hoteles: SGL | DBL | TPL
  unidades        INTEGER NOT NULL DEFAULT 1, -- hoteles: cantidad de habitaciones
  neto_unit_cent  INTEGER,           -- en la moneda original
  moneda          TEXT,
  neto_cent       INTEGER NOT NULL DEFAULT 0, -- total de la línea en USD
  venta_cent      INTEGER NOT NULL DEFAULT 0, -- total de la línea en USD
  margen_pct      REAL,              -- el que se aplicó (0 si la tarifa ya es precio de venta)
  margen_fijo     REAL,              -- margen puesto a mano para esta línea (NULL = el de la configuración)
  precio_es_venta INTEGER NOT NULL DEFAULT 0,
  es_ilustrativa  INTEGER NOT NULL DEFAULT 0,
  pisado_neto     INTEGER NOT NULL DEFAULT 0, -- 1 = alguien cambió el neto a mano (no se recalcula)
  pisado_venta    INTEGER NOT NULL DEFAULT 0, -- 1 = alguien cambió la venta a mano (no se recalcula)
  problema        TEXT,              -- sin tarifa, falta hotel… (se recalcula)
  nota            TEXT
);
CREATE INDEX IF NOT EXISTS idx_ct_lineas_cotizacion ON ct_lineas (cotizacion_id);

-- Registro de todo cambio de precio hecho a mano (tarifario y cotizaciones): quién, cuándo, antes y después.
CREATE TABLE IF NOT EXISTS ct_cambios_precio (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad    TEXT NOT NULL,          -- tarifa | hotel_tarifa | linea | config
  entidad_id TEXT NOT NULL,
  campo      TEXT NOT NULL,
  antes      TEXT,
  despues    TEXT,
  por        TEXT,
  motivo     TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ct_cambios_entidad ON ct_cambios_precio (entidad, entidad_id);
