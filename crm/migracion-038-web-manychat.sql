-- La web de Luna Llena reconoce a la persona que llega desde ManyChat: los
-- links llevan ?manychat_id={{contact id}} y assets/ll-t.js lo guarda en el
-- navegador. Con eso la visita se une al lead por leads.manychat_id (además
-- del código LL-######), aunque no toque WhatsApp ni cotice.

ALTER TABLE sesiones_web ADD COLUMN manychat_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sesiones_web_manychat ON sesiones_web (manychat_id);

-- Último estado que se mandó a ManyChat por contacto (tags y campos). Sirve
-- para llamar a la API solo cuando algo cambió. Lo escribe functions/_lib/manychat.js.
CREATE TABLE IF NOT EXISTS manychat_web_sync (
  manychat_id TEXT PRIMARY KEY,
  estado_json TEXT NOT NULL,     -- {tags: [...], campos: {...}} ya aplicados
  error TEXT,                    -- último error de la API, si hubo
  actualizado_en TEXT NOT NULL
);
