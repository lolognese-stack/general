-- Migración 004: proveedores, tarifas y cotizaciones
--
-- El motor de precio vive en functions/_lib/pricing.js. Esta migración solo
-- crea dónde vive el dato: proveedores y sus tarifas (con vigencia — la
-- tarifa vencida bloquea, no avisa), y las cotizaciones armadas con esas
-- tarifas.
--
-- cotizacion_items guarda un SNAPSHOT (neto, base, vigencia) de la tarifa
-- al momento de cotizar. Si la tarifa cambia o vence después, la
-- cotización ya guardada no se mueve — es la foto del día que se cotizó.

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,           -- hotel | excursion | traslado | guia | aereo | otro
  destino TEXT,
  contacto TEXT,
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proveedores_tipo ON proveedores(tipo);

CREATE TABLE IF NOT EXISTS tarifas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  servicio TEXT NOT NULL,
  base TEXT NOT NULL,           -- por_pax | por_grupo (fijos: auto, chofer, guia)
  ocupacion TEXT,                -- single | doble | matrimonial | twin | triple | null
  temporada TEXT,                -- alta | baja | todo
  edad_min INTEGER,
  edad_max INTEGER,
  moneda TEXT NOT NULL DEFAULT 'USD',
  neto REAL NOT NULL,
  markup_pct REAL NOT NULL,
  vigencia_desde TEXT NOT NULL,
  vigencia_hasta TEXT NOT NULL,
  condiciones TEXT,               -- allotment | free_sale | on_request + release
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tarifas_proveedor ON tarifas(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_tarifas_vigencia ON tarifas(vigencia_hasta);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  variante TEXT NOT NULL DEFAULT 'unica',   -- bueno | mejor | premium | unica
  fecha_viaje TEXT,
  colchon_pct REAL NOT NULL DEFAULT 4,
  vigencia_hasta TEXT NOT NULL,             -- la mas temprana de sus items
  pax_json TEXT NOT NULL,                   -- resultado por cantidad de pax, ya calculado
  single_supp_pct REAL,
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cotizaciones_lead ON cotizaciones(lead_id);

CREATE TABLE IF NOT EXISTS cotizacion_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id),
  tarifa_id INTEGER REFERENCES tarifas(id),
  descripcion TEXT NOT NULL,
  base TEXT NOT NULL,
  ocupacion TEXT,
  cantidad REAL NOT NULL DEFAULT 1,
  neto REAL NOT NULL,            -- snapshot
  markup_pct REAL NOT NULL,      -- snapshot
  vigencia_hasta TEXT NOT NULL   -- snapshot
);

CREATE INDEX IF NOT EXISTS idx_cotizacion_items_cotizacion ON cotizacion_items(cotizacion_id);
