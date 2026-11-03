-- Migración 046: sync del Google Sheet "Luna Llena | CRM Setting" al CRM.
--
-- Solo aditiva. Aplicar en remoto:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-046-sheet-sync.sql
--
-- sheet_eventos: una fila por evento de las hojas "Registro Setter N" (las
-- llena ManyChat: INBOUND, FUP, CALENDARIO, CALL). `clave` es única, así que
-- reenviar el mismo evento (reintento del Apps Script) no duplica.
-- `nombre_raw` es la columna Nombre del Sheet, que desde ahora es el usuario
-- de Instagram; `ig_username` es ese mismo valor normalizado (sin @, en
-- minúsculas) y es lo que une el evento con leads.ig_username.
CREATE TABLE IF NOT EXISTS sheet_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  setter TEXT NOT NULL,            -- 'Setter 1', 'Setter 2'...
  evento TEXT NOT NULL,            -- INBOUND | FUP | CALENDARIO | CALL
  fecha TEXT NOT NULL,             -- YYYY-MM-DD en la zona horaria del Sheet
  momento TEXT NOT NULL,           -- marca temporal completa (ISO con offset)
  manychat_id TEXT,                -- columna "ID Suscriptor"
  ig_username TEXT,
  nombre_raw TEXT,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sheet_eventos_fecha ON sheet_eventos(fecha, evento);
CREATE INDEX IF NOT EXISTS idx_sheet_eventos_ig ON sheet_eventos(ig_username);
CREATE INDEX IF NOT EXISTS idx_sheet_eventos_mc ON sheet_eventos(manychat_id);

-- sheet_agendas: la fila completa de las hojas "Closer N" (agenda, llamada,
-- situación, programa, cash...). Lo que tiene columna propia en `leads`
-- (fechas, setter, closer, fuente, estrategia, medio, calificado) además se
-- copia al lead; el resto vive acá en datos_json para no perderlo.
CREATE TABLE IF NOT EXISTS sheet_agendas (
  clave TEXT PRIMARY KEY,          -- hoja|persona|fecha_agenda
  hoja TEXT NOT NULL,
  ig_username TEXT,
  nombre_raw TEXT,
  datos_json TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sheet_agendas_ig ON sheet_agendas(ig_username);
