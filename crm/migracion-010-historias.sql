-- Migración 010: calendario de historias de IG, separado del planificador
-- de contenido. Una fila = secuencia de historias de un día (no una
-- historia suelta): las métricas de ManyChat (aperturas, respuestas,
-- calificados, formularios) se miden por secuencia completa, y los 4
-- abridores outbound son variantes de texto de esa secuencia. Carga manual
-- desde el panel -- ManyChat no tiene export directo.
CREATE TABLE historias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT,                -- día de la secuencia (YYYY-MM-DD)
  semana TEXT,               -- etiqueta "Semana N de Mes", recalculada siempre desde fecha
  angulo_id INTEGER REFERENCES angulos(id),
  tema TEXT NOT NULL,
  palabra_clave TEXT,        -- palabra a responder en la historia (dispara ManyChat)
  link_manychat TEXT,
  recurso_id INTEGER REFERENCES recursos(id),
  etiqueta_manychat TEXT,
  abridor_1 TEXT,
  abridor_2 TEXT,
  abridor_3 TEXT,
  abridor_4 TEXT,
  aperturas INTEGER,         -- aperturas del abridor outbound
  respuestas INTEGER,        -- tasa de respuesta = respuestas/aperturas, calculada en el panel
  calificados INTEGER,
  formularios INTEGER,       -- formularios completados
  creado_en TEXT,
  actualizado_en TEXT
);
