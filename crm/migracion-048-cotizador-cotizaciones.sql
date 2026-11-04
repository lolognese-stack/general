-- Migración 048: cotizaciones del Cotizador (pestaña Cotizador, solo Luna Llena).
--
-- Solo agrega una tabla y un índice. No borra ni cambia datos.
--
-- Es otra tabla que `cotizaciones` (migración 004, motor viejo con proveedores y
-- tarifas): esta guarda lo que calculó el cotizador de Luna Llena (repo
-- luna-llena-cotizador, en Vercel) al tocar "Guardar en lead". Los importes los
-- vuelve a calcular el servidor al guardar (functions/api/cotizador/[[ruta]].js):
-- nunca se guarda un número que mandó el navegador.
--
-- pedido_json: viajeros (nacionalidad, edad, estudiante), fecha, productos y días;
-- sirve para recotizar. Sin pasaportes ni fechas de nacimiento.
--
-- Aplicar:
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-048-cotizador-cotizaciones.sql

CREATE TABLE IF NOT EXISTS cotizador_cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  estado TEXT NOT NULL,          -- estado del motor: calculado, sin_disponibilidad_confirmada, pendiente_*, requiere_humano
  total_usd TEXT,                -- texto (Decimal), null si no hay total para mandar
  adelanto_usd TEXT,
  viajeros INTEGER,
  fecha_viaje TEXT,
  resumen TEXT,                  -- "Valle Sur + Machu Picchu Full Day…"
  idioma TEXT,
  mensaje TEXT,                  -- el mensaje para el cliente (plantilla del cotizador)
  pedido_json TEXT NOT NULL,
  versiones TEXT,                -- catalogo@hash · entradas@hash · reglas@hash · tc@fecha
  enviada INTEGER NOT NULL DEFAULT 0,  -- 1 = el asesor marcó que ya se la mandó al cliente
  quien TEXT,
  creado_en TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cotizador_cotizaciones_lead ON cotizador_cotizaciones(lead_id, creado_en DESC);
