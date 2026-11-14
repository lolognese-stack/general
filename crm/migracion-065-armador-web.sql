-- Migración 065: itinerarios armados por los visitantes en la web (/armar/ de lunallenatravel-web).
-- Sin precios. Se ven en https://lunallenatravel.vercel.app/i/<slug>/ (la web reescribe /i/* al CRM).
-- El slug es al azar (no es el código de visita LL-######: detrás hay datos personales).

CREATE TABLE IF NOT EXISTS web_itinerarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  submission_id   TEXT NOT NULL UNIQUE,
  lead_id         INTEGER REFERENCES leads(id),
  codigo_web      TEXT,
  ip_hash         TEXT,                 -- SHA-256 de la IP + sal: solo para limitar altas por hora
  titulo          TEXT,
  desde_paquete   TEXT,                 -- id del paquete si arrancó con "Personalizar este viaje"
  ritmo           TEXT,
  categoria_hotel TEXT,
  viaje_json      TEXT,                 -- respuestas (fecha, personas, pasajes, presupuesto, reserva)
  base_json       TEXT NOT NULL,        -- días que armó el sistema
  dias_json       TEXT NOT NULL,        -- días como quedaron (editados o no)
  avisos_json     TEXT,
  comentario      TEXT,
  score           INTEGER,
  tier            TEXT,
  enviado_en      TEXT,                 -- apretó "Enviar a un asesor" / "Guardar mi itinerario"
  wa_click_en     TEXT,
  creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_web_itinerarios_lead ON web_itinerarios (lead_id);
CREATE INDEX IF NOT EXISTS idx_web_itinerarios_ip ON web_itinerarios (ip_hash, creado_en);
