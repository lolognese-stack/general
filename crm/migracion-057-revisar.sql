-- Revisar: cola de posts que vienen de un CSV de Instagram (reporte de otras
-- cuentas) para pasarlos de a uno en Ideas > Revisar y guardarlos o
-- descartarlos. Lo descartado queda acá: si el post vuelve en otro CSV, no
-- se muestra de nuevo.
CREATE TABLE IF NOT EXISTS revisar_cola (
  codigo TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  usuario TEXT,
  publicado_en TEXT,
  likes INTEGER,
  comentarios INTEGER,
  reposts INTEGER,
  views INTEGER,
  caption TEXT,
  lote TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | guardado | descartado
  idea_id INTEGER,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisar_estado ON revisar_cola(estado, likes);
