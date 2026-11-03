-- Migración 006: planificador de contenido corto (viene de Notion, que se
-- jubila con esta migración).
--
-- Una sola fila por pieza: el registro planificado y el publicado-con-
-- métricas son el mismo, diferenciados por `estado`. A propósito distinto
-- del template de Organic Travelling, que tiene "plan" y "publicadas" como
-- dos almacenes separados y obliga a re-tipear la pieza cuando se publica.
--
-- El cruce lead↔pieza queda por texto (leads.etiqueta_manychat =
-- piezas.etiqueta_manychat), no por FK: leads.angulo/etiqueta_manychat no
-- cambian de tipo (0 filas cargadas hoy, migración gratis) y Agendas &
-- Setteo sigue leyendo l[campo] como string sin tocar una línea.

CREATE TABLE IF NOT EXISTS angulos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  categoria TEXT,                  -- Problema | Solución | Producto | Otros
  relevancia TEXT,                 -- MUY ALTA | ALTA | MEDIA | BAJA
  lugar TEXT,
  formatos_sugeridos TEXT,         -- CSV: "Reel,Historias,Carrusel"
  activo INTEGER NOT NULL DEFAULT 1,
  notion_id TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recursos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  problema TEXT,
  link TEXT,
  notas TEXT,
  notion_id TEXT,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS piezas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tema TEXT NOT NULL,
  fecha TEXT,                      -- YYYY-MM-DD
  semana TEXT,                     -- bucket de planificación tal cual venía de Notion
  estado TEXT NOT NULL DEFAULT 'IDEA',
  formato TEXT,
  lugar TEXT,
  angulo_id INTEGER REFERENCES angulos(id),
  recurso_id INTEGER REFERENCES recursos(id),
  etiqueta_manychat TEXT,
  link_manychat TEXT,
  video_url TEXT,
  hook TEXT,
  descripcion TEXT,
  cta TEXT,
  inspiracion TEXT,
  portada INTEGER NOT NULL DEFAULT 0,
  -- performance: se cargan a mano cuando estado='Subido'
  views INTEGER, alcance INTEGER, likes INTEGER, compartidos INTEGER,
  seguimientos INTEGER, comentarios INTEGER, guardados INTEGER,
  tiempo_prom TEXT, medido_en TEXT,
  notion_id TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- La etiqueta es la clave del cruce lead-pieza: tiene que ser única o el
-- conteo de leads se duplica entre piezas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_piezas_etiqueta
  ON piezas(etiqueta_manychat) WHERE etiqueta_manychat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_piezas_estado ON piezas(estado);
CREATE INDEX IF NOT EXISTS idx_piezas_fecha ON piezas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_piezas_angulo ON piezas(angulo_id);
