-- Migración 018: sección Objetivos -- el programa de 90 días contra lo
-- acordado en la kick-off, revisado semana a semana.
--
-- Tres tablas, tres responsabilidades:
--   programa  -> qué se acordó (fechas, metas, curva). Fila única.
--   semanas   -> qué pasó cada semana: notas y, al cerrar, los números
--                congelados. Una fila por semana solo cuando hay algo
--                escrito; las semanas sin fila se calculan en vivo.
--   ajustes   -> correcciones a mano sobre un número automático, con el
--                original guardado al lado. Nunca se pisa el cálculo.
--
-- Los defaults (curva, umbrales, total) viven en programa.config.json, no
-- acá: la fila de `programa` se crea desde ese archivo la primera vez que
-- alguien pide /api/objetivos, así un cliente nuevo arranca editando un
-- JSON y no una base.

CREATE TABLE IF NOT EXISTS programa (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fecha_dia_0 TEXT,                    -- YYYY-MM-DD, arranca el reloj de 90 días
  dias_pausa INTEGER NOT NULL DEFAULT 0,
  fecha_primera_publicacion TEXT,      -- YYYY-MM-DD, semana 1 arranca acá
  objetivo_total_consultas INTEGER NOT NULL,
  seguidores_inicio INTEGER,
  objetivo_seguidores INTEGER,         -- NULL = se calcula: max(minimo, inicio + incremento)
  umbrales_json TEXT NOT NULL,         -- {"superado":1.2,"cumplido":1,"cerca":0.8}
  curva_json TEXT NOT NULL,            -- [{semana, consultas, piezas, visitas_video, conv_pub, conv_dia, pct_conv, seguidores}]
  texto_objetivo TEXT,
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS semanas (
  numero INTEGER PRIMARY KEY,
  cerrada_en TEXT,                     -- NULL = abierta; con fecha = congelada
  metricas_json TEXT,                  -- foto de {objetivo, real, estado} por métrica al cerrar
  porque TEXT,                         -- se muestra al cliente
  que_hacemos TEXT,                    -- se muestra al cliente
  nota_interna TEXT,                   -- nunca sale al cliente
  actualizado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ajustes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semana INTEGER NOT NULL,
  metrica TEXT NOT NULL,               -- consultas | piezas | visitas_video | conv_pub | conv_dia | pct_conv | seguidores | ventas
  valor_original REAL,                 -- lo que daba el cálculo automático al momento de corregir
  valor_manual REAL NOT NULL,
  motivo TEXT,
  creado_en TEXT NOT NULL
);

-- Una corrección vigente por métrica y semana: la última pisa la anterior.
CREATE INDEX IF NOT EXISTS idx_ajustes_semana ON ajustes(semana, metrica, id DESC);
