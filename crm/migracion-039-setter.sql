-- Migración 039: setter de IA para WhatsApp (solo Luna Llena).
--
-- Solo aditiva: CREATE TABLE IF NOT EXISTS y ALTER TABLE ADD COLUMN. No toca
-- datos existentes. Plan completo en PLAN-setter-luna-llena.md (sección 7) y
-- ajustes en SETTER-RELEVAMIENTO.md.
--
-- Fechas en ISO 8601 UTC, con el sufijo _en como el resto de la base.
--
-- Aplicar (lo hace Lorenzo):
--   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-039-setter.sql
-- Ojo: los ALTER TABLE fallan si se corre dos veces (SQLite no tiene ADD
-- COLUMN IF NOT EXISTS). Si falla en el primer ALTER, ya estaba aplicada.

-- 1. leads: lo que el setter sabe del lead. Nunca pisa columnas de la asesora.
ALTER TABLE leads ADD COLUMN wa_id TEXT;                -- E.164 sin '+', ej. 51930299443
ALTER TABLE leads ADD COLUMN ia_estado TEXT;            -- frio | tibio | calificado | cotizador_enviado | derivado | nurture | sin_respuesta | no_calificado | no_es_lead
ALTER TABLE leads ADD COLUMN ia_resumen TEXT;
ALTER TABLE leads ADD COLUMN ia_score_motivo TEXT;
ALTER TABLE leads ADD COLUMN ia_origen TEXT;            -- directo | web_ref | anuncio | instagram | otro
ALTER TABLE leads ADD COLUMN ia_primera_intencion TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_wa_id ON leads(wa_id);

-- 2. Agentes: un jefe + especialistas (traspaso por clave).
CREATE TABLE IF NOT EXISTS setter_agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,                       -- interno, no lo ve el lead
  rol TEXT NOT NULL DEFAULT 'especialista',   -- jefe | especialista
  clave TEXT NOT NULL UNIQUE,                 -- sale del nombre: 'calificacion', 'seguimiento'
  padre_id INTEGER REFERENCES setter_agentes(id),
  canal TEXT NOT NULL DEFAULT 'whatsapp',
  activo INTEGER NOT NULL DEFAULT 0,
  tono TEXT NOT NULL DEFAULT 'tu',            -- usted | tu
  idioma TEXT NOT NULL DEFAULT 'auto',        -- auto | es | es-AR | en | pt-BR | ...
  zona_horaria TEXT NOT NULL DEFAULT 'America/Lima',
  responde_siempre INTEGER NOT NULL DEFAULT 0,
  responder_al_instante INTEGER NOT NULL DEFAULT 0,
  aviso_ia_marca TEXT,                        -- vacío = sin aviso de IA
  guion_por_pasos INTEGER NOT NULL DEFAULT 0,
  recurso_conversion_id INTEGER,
  modelo TEXT,                                -- null = el default del Worker
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- 3. Prompts versionados. La versión publicada más nueva es la activa.
CREATE TABLE IF NOT EXISTS setter_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agente_id INTEGER NOT NULL REFERENCES setter_agentes(id),
  version INTEGER NOT NULL,
  texto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador',    -- borrador | publicado
  autor TEXT NOT NULL DEFAULT 'humano',       -- humano | asistente
  nota_cambio TEXT,
  creado_en TEXT NOT NULL,
  UNIQUE (agente_id, version)
);
CREATE INDEX IF NOT EXISTS idx_setter_prompts_agente ON setter_prompts(agente_id, estado, version DESC);

CREATE TABLE IF NOT EXISTS setter_puntuaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id INTEGER NOT NULL REFERENCES setter_prompts(id),
  nota INTEGER,
  faltantes_json TEXT,
  creado_en TEXT NOT NULL
);

-- 4. Recursos del setter (no confundir con `recursos`, los lead magnets del Planificador).
CREATE TABLE IF NOT EXISTS setter_recursos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  etiqueta TEXT NOT NULL UNIQUE,              -- sin espacios, se cita como @etiqueta
  descripcion TEXT NOT NULL,                  -- qué es y cuándo mandarlo
  tipo TEXT NOT NULL,                         -- link | archivo | audio
  url TEXT,
  r2_key TEXT,
  mime TEXT,
  duracion_s INTEGER,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- 5. Base de conocimiento.
CREATE TABLE IF NOT EXISTS setter_conocimiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  tags TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);

-- 6. Reglas de follow-up.
CREATE TABLE IF NOT EXISTS setter_seguimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tras_horas INTEGER NOT NULL,
  ia_estado TEXT,                             -- null = cualquiera
  modo TEXT NOT NULL DEFAULT 'ia_libre',      -- ia_libre | plantilla
  plantilla TEXT,
  max_intentos INTEGER NOT NULL DEFAULT 3,
  activo INTEGER NOT NULL DEFAULT 1
);

-- 7. Conversaciones: una por número de WhatsApp.
CREATE TABLE IF NOT EXISTS wa_conversaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  canal TEXT NOT NULL DEFAULT 'whatsapp',
  wa_id TEXT NOT NULL UNIQUE,
  nombre_perfil TEXT,                         -- profile.name que manda WhatsApp
  agente_id INTEGER REFERENCES setter_agentes(id),
  agente_activo TEXT,                         -- clave del jefe o del especialista
  ia_activa INTEGER NOT NULL DEFAULT 1,
  ia_pausa_motivo TEXT,                       -- manual | asesora_respondio | handoff | kill_switch
  abierta_por TEXT,                           -- lead | nosotros
  asignada_a TEXT,
  espera_persona INTEGER NOT NULL DEFAULT 0,
  ultimo_in_en TEXT,
  ultimo_out_en TEXT,
  ventana_hasta TEXT,                         -- ultimo_in_en + 24 h
  no_leidos INTEGER NOT NULL DEFAULT 0,
  visto_por_lead TEXT,                        -- no_abrio | vio_no_contesto | contesto
  paso_guion INTEGER,
  -- Último mensaje, copiado acá para que la lista del Inbox no lea wa_mensajes.
  ultimo_texto TEXT,
  ultimo_autor TEXT,
  ultimo_en TEXT,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_lead ON wa_conversaciones(lead_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_espera ON wa_conversaciones(espera_persona);
CREATE INDEX IF NOT EXISTS idx_wa_conv_actualizado ON wa_conversaciones(actualizado_en DESC);

-- 8. Mensajes. provider_id UNIQUE = el webhook repetido no duplica.
CREATE TABLE IF NOT EXISTS wa_mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacion_id INTEGER NOT NULL REFERENCES wa_conversaciones(id),
  direccion TEXT NOT NULL,                    -- in | out
  autor TEXT NOT NULL,                        -- lead | ia | asesora_app | asesora_web | sistema
  agente_clave TEXT,
  tipo TEXT NOT NULL,                         -- text | audio | image | document | video | sticker | template | ...
  texto TEXT,
  media_key TEXT,                             -- 'meta:<media_id>' o 'r2:<key>'
  transcripcion TEXT,
  recurso_id INTEGER REFERENCES setter_recursos(id),
  provider_id TEXT UNIQUE,
  estado TEXT,                                -- sent | delivered | read | failed (solo out)
  error TEXT,
  leido_en TEXT,
  es_followup INTEGER NOT NULL DEFAULT 0,
  intento_followup INTEGER,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_msj_conv ON wa_mensajes(conversacion_id, creado_en);

-- 9. Análisis por chat (Haiku).
CREATE TABLE IF NOT EXISTS wa_analisis (
  conversacion_id INTEGER PRIMARY KEY REFERENCES wa_conversaciones(id),
  intencion_inicial TEXT,
  objeciones_json TEXT,
  dolores_json TEXT,
  pedidos_json TEXT,
  senales_compra_json TEXT,
  preguntas_sin_respuesta_json TEXT,
  motivo_perdida TEXT,
  etapa_corte TEXT,
  tipo_lead TEXT,
  proxima_accion TEXT,
  prioridad TEXT,
  actualizado_en TEXT NOT NULL
);

-- 10. Uso mensual (solo respuestas de la IA a leads).
CREATE TABLE IF NOT EXISTS setter_uso (
  mes TEXT PRIMARY KEY,                       -- YYYY-MM
  respuestas_ia INTEGER NOT NULL DEFAULT 0,
  tope INTEGER
);

-- 11. Auditoría: traspasos, pausas, estados, errores.
CREATE TABLE IF NOT EXISTS setter_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversacion_id INTEGER,
  lead_id INTEGER,
  tipo TEXT NOT NULL,
  detalle TEXT,
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_setter_eventos_conv ON setter_eventos(conversacion_id, creado_en);

-- 12. Ajustes globales (kill switch, modelos por defecto).
CREATE TABLE IF NOT EXISTS setter_config (
  clave TEXT PRIMARY KEY,
  valor TEXT,
  actualizado_en TEXT NOT NULL
);
