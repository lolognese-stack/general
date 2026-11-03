-- Migración 028: Ideador de contenido dentro del CRM.
--
-- Referencias de Instagram (o ideas sueltas) guardadas para inspirarse, en la
-- misma base que piezas y ángulos: se ven desde cualquier dispositivo y una
-- idea pasa a pieza del Planificador con un click. Las carga también la
-- extensión de Chrome.
--
-- angulo_ids: JSON con ids de la tabla angulos. Una referencia puede servir
-- para más de un ángulo.
-- uso: '' (sin marcar) | 'usar' (en la lista para hacer) | 'usado'.
-- codigo: shortcode de Instagram, para no duplicar el mismo post.

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  codigo TEXT,
  creador TEXT,
  formato TEXT,
  formato_score INTEGER DEFAULT 0,
  angulo_ids TEXT DEFAULT '[]',
  angulo_score INTEGER DEFAULT 0,
  texto TEXT,
  aplicacion TEXT,
  caption TEXT,
  views INTEGER,
  likes INTEGER,
  comentarios INTEGER,
  uso TEXT DEFAULT '',
  pieza_id INTEGER,
  foto_v INTEGER,
  origen TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ideas_codigo ON ideas(codigo);

-- Misma forma que piezas_foto: base64 + mime, servida sin token y cacheada
-- para siempre por ?v=foto_v.
CREATE TABLE IF NOT EXISTS ideas_foto (
  idea_id INTEGER PRIMARY KEY,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  origen TEXT,
  actualizado_en TEXT NOT NULL
);
