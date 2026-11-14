-- Fase 3 (cotizaciones dentro del CRM): itinerarios leídos de la web publicada y armado automático.
-- Nada de esto trae precios de costo: precio_web_cent es el precio PUBLICADO (de venta), siempre "sugerido".

CREATE TABLE IF NOT EXISTS ct_web_productos (
  id            TEXT PRIMARY KEY,                 -- slug de la web (carpeta)
  tipo          TEXT NOT NULL CHECK (tipo IN ('paquete', 'tour')),
  nombre        TEXT NOT NULL,
  zona          TEXT,
  ciudades      TEXT,                              -- JSON: ciudades que recorre, en orden
  ciudad_base   TEXT,                              -- ciudad donde se hospeda el pasajero para hacerlo (tours)
  dias          INTEGER NOT NULL DEFAULT 1,
  noches        INTEGER NOT NULL DEFAULT 0,
  precio_web_cent INTEGER,                         -- USD por persona, NULL = "consultar"
  url           TEXT,
  resumen       TEXT,
  incluye       TEXT,                              -- JSON: lista
  no_incluye    TEXT,                              -- JSON: lista
  fotos         TEXT,                              -- JSON: URLs
  hash          TEXT,                              -- para saber si cambió desde la última lectura
  leido_en      TEXT NOT NULL DEFAULT (datetime('now')),
  activo        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ct_web_productos_tipo ON ct_web_productos (tipo, activo);

CREATE TABLE IF NOT EXISTS ct_web_dias (
  producto_id TEXT NOT NULL REFERENCES ct_web_productos(id),
  dia         INTEGER NOT NULL,
  ciudad      TEXT,
  titulo      TEXT,
  relato      TEXT,                                -- lo que hace el pasajero ese día (pasos de la ficha, resumidos)
  foto        TEXT,
  PRIMARY KEY (producto_id, dia)
);

CREATE TABLE IF NOT EXISTS ct_web_lecturas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  cuando    TEXT NOT NULL DEFAULT (datetime('now')),
  por       TEXT,
  altas     INTEGER NOT NULL DEFAULT 0,
  cambios   INTEGER NOT NULL DEFAULT 0,
  bajas     INTEGER NOT NULL DEFAULT 0,
  detalle   TEXT                                   -- JSON: ids por grupo
);

-- Reglas de viaje (avisan, no bloquean). Las puse yo: es_prueba = 1 hasta que Álvaro las valide.
CREATE TABLE IF NOT EXISTS ct_reglas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo      TEXT NOT NULL CHECK (tipo IN ('ciudad', 'conexion', 'aclimatacion')),
  clave     TEXT NOT NULL,                         -- ciudad, o "origen>destino"
  datos     TEXT NOT NULL,                         -- JSON (altura_m / horas, dia_completo / max_actividad_dia1)
  es_prueba INTEGER NOT NULL DEFAULT 1,
  actualizado_por TEXT,
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tipo, clave)
);
INSERT OR IGNORE INTO ct_reglas (tipo, clave, datos) VALUES
  ('ciudad', 'Lima',             '{"altura_m":155}'),
  ('ciudad', 'Paracas',          '{"altura_m":5}'),
  ('ciudad', 'Ica',              '{"altura_m":406}'),
  ('ciudad', 'Nazca',            '{"altura_m":520}'),
  ('ciudad', 'Arequipa',         '{"altura_m":2335}'),
  ('ciudad', 'Cusco',            '{"altura_m":3400}'),
  ('ciudad', 'Puno',             '{"altura_m":3830}'),
  ('ciudad', 'Aguas Calientes',  '{"altura_m":2040}'),
  ('ciudad', 'Puerto Maldonado', '{"altura_m":200}'),
  ('conexion', 'Cusco>Puno',     '{"horas":8,"dia_completo":true}'),
  ('conexion', 'Puno>Cusco',     '{"horas":8,"dia_completo":true}'),
  ('conexion', 'Lima>Cusco',     '{"horas":1.5,"dia_completo":false}'),
  ('conexion', 'Cusco>Lima',     '{"horas":1.5,"dia_completo":false}'),
  ('conexion', 'Lima>Arequipa',  '{"horas":1.5,"dia_completo":false}'),
  ('conexion', 'Arequipa>Cusco', '{"horas":1.5,"dia_completo":false}'),
  ('conexion', 'Arequipa>Puno',  '{"horas":6,"dia_completo":true}'),
  ('conexion', 'Lima>Paracas',   '{"horas":4,"dia_completo":true}'),
  ('conexion', 'Paracas>Nazca',  '{"horas":3,"dia_completo":false}'),
  ('conexion', 'Nazca>Arequipa', '{"horas":9,"dia_completo":true}'),
  ('aclimatacion', 'general',    '{"altura_aviso_m":3000,"salto_aviso_m":2000,"dia_completo_primer_dia":false}');

-- Une el servicio del tarifario con el tour de la web; guarda qué se armó con qué.
ALTER TABLE ct_servicios ADD COLUMN web_id TEXT;
ALTER TABLE ct_pedidos ADD COLUMN paquete_web_id TEXT;
ALTER TABLE ct_cotizaciones ADD COLUMN variante TEXT CHECK (variante IS NULL OR variante IN ('A', 'B'));
ALTER TABLE ct_cotizaciones ADD COLUMN precio_modo TEXT NOT NULL DEFAULT 'componentes';
ALTER TABLE ct_cotizaciones ADD COLUMN paquete_web_cent INTEGER;
ALTER TABLE ct_cotizaciones ADD COLUMN paquete_web_confirmado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ct_lineas ADD COLUMN origen_precio TEXT NOT NULL DEFAULT 'tarifario';   -- tarifario | web | manual | excel | ilustrativa
ALTER TABLE ct_lineas ADD COLUMN sin_confirmar INTEGER NOT NULL DEFAULT 0;          -- 1 = precio sugerido de la web que nadie confirmó
ALTER TABLE ct_lineas ADD COLUMN web_producto_id TEXT;
ALTER TABLE ct_lineas ADD COLUMN web_dia INTEGER;
