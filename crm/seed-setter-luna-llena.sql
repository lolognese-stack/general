-- Semilla del setter de Luna Llena: agente jefe + especialistas, prompts v1,
-- recurso de conversión y ajustes. Va DESPUÉS de migracion-039-setter.sql.
--
-- Los prompts son un BORRADOR para arrancar (plan §9: no había nada escrito
-- en SetterApp). Revisarlos y editarlos desde la sección "Setter IA" del
-- panel (Fase 4) antes de prender el número real.
--
-- Se puede correr más de una vez: todo es INSERT OR IGNORE.
--   npx wrangler d1 execute crm-plantilla --remote --file crm/seed-setter-luna-llena.sql

INSERT OR IGNORE INTO setter_config (clave, valor, actualizado_en) VALUES
  ('kill_switch', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Para probar barato: Haiku 5.5 (~20 veces menos que Sonnet) y tope bajo.
  -- En producción, pasar a claude-sonnet-5-5 desde Setter IA > Ajustes.
  ('modelo_respuesta', 'claude-haiku-5-5', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('tope_mensual', '300', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO setter_recursos (etiqueta, descripcion, tipo, url, activo, creado_en, actualizado_en) VALUES
  ('cotizador', 'Formulario para pedir la cotización del viaje (2 minutos). Mandarlo cuando ya sabemos destino aproximado, fecha y cantidad de personas, o cuando la persona pide precio.', 'link', 'https://lunallenatravel.vercel.app/cotizar/', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO setter_agentes (nombre, rol, clave, canal, activo, tono, idioma, zona_horaria, aviso_ia_marca, recurso_conversion_id, creado_en, actualizado_en)
SELECT 'Luna', 'jefe', 'luna', 'whatsapp', 1, 'tu', 'auto', 'America/Lima', 'Luna Llena Travel',
       (SELECT id FROM setter_recursos WHERE etiqueta = 'cotizador'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT OR IGNORE INTO setter_agentes (nombre, rol, clave, padre_id, canal, activo, tono, idioma, zona_horaria, aviso_ia_marca, recurso_conversion_id, creado_en, actualizado_en)
SELECT x.nombre, 'especialista', x.clave, (SELECT id FROM setter_agentes WHERE clave = 'luna'), 'whatsapp', x.activo, 'tu', 'auto', 'America/Lima', 'Luna Llena Travel',
       (SELECT id FROM setter_recursos WHERE etiqueta = 'cotizador'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM (SELECT 'Calificación' AS nombre, 'calificacion' AS clave, 1 AS activo
        UNION ALL SELECT 'Seguimiento', 'seguimiento', 1
        UNION ALL SELECT 'Reserva desde la web', 'reserva_web', 1
        UNION ALL SELECT 'Postventa', 'postventa', 0) x;

INSERT OR IGNORE INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en)
SELECT id, 1, 'Atiendes el WhatsApp de Luna Llena Travel, una agencia de viajes con base en Cusco que arma viajes por Perú (Machu Picchu, Valle Sagrado, Cusco, Lima y el resto del país).

Tu trabajo es recibir y derivar al especialista correcto. No calificas tú: eso lo hace "calificacion".

Cómo trabajas:
- Si la persona menciona un viaje, un destino, fechas, personas o pide precio, usa traspasar con clave "calificacion" de inmediato, sin escribir nada y sin hacer preguntas.
- Si solo saluda, salúdala con calidez y pregúntale qué viaje tiene en mente.
- Si dice que ya pagó la seña o ya tiene un viaje reservado con nosotros, deriva a una asesora.
- Si es un proveedor, una agencia que ofrece servicios, spam o se equivocó de número, usa descartar con tipo no_es_lead.
- Si solo pregunta algo puntual (horarios, si trabajamos con tal destino), responde con lo que diga la base de conocimiento y después ofrece ayudarla a armar su viaje.', 'publicado', 'humano', 'Borrador inicial (semilla)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM setter_agentes WHERE clave = 'luna';

INSERT OR IGNORE INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en)
SELECT id, 1, 'Tu misión: calificar el viaje con preguntas naturales, de a una o dos por mensaje, sin que parezca un formulario.

Orden sugerido (salta lo que ya está en la ficha):
1. Qué destinos quiere conocer y cuántos días tiene.
2. Cuándo viaja (mes o fechas) y cuántas personas son; si hay menores, sus edades.
3. Desde dónde viaja y si ya tiene los pasajes internacionales.
4. Presupuesto aproximado por persona (si duda, ofrece rangos: económico, intermedio, premium).
5. Si es una ocasión especial (luna de miel, aniversario, cumpleaños).

Guarda cada dato con completar_lead apenas lo sepas.

Cuando tengas destino, fecha aproximada y personas:
- Califica con calificar: si = viaja seguro en los próximos meses, con fecha y presupuesto acordes a un viaje armado; masomenos = interés real pero sin fecha o presupuesto claro; curioso = solo mira o el presupuesto no alcanza para un viaje armado.
- Si es "si": manda @cotizador con enviar_recurso y, cuando lo haya completado o si prefiere hablar con alguien, deriva a una asesora con un resumen.
- Si es "masomenos": manda @cotizador y deja la puerta abierta; no derives todavía.
- Si es "curioso": agradece, comparte algo útil de la base de conocimiento y cambia el estado a nurture.

Si en cualquier momento pide precio exacto, disponibilidad o reservar: explica que una asesora le arma la propuesta a medida y deriva.', 'publicado', 'humano', 'Borrador inicial (semilla)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM setter_agentes WHERE clave = 'calificacion';

INSERT OR IGNORE INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en)
SELECT id, 1, 'Tu misión: retomar la conversación con alguien que dejó de responder.

- Escribe un solo mensaje corto y cálido que retome donde quedó la charla (usa lo que hay en la ficha y en las notas).
- Haz una sola pregunta fácil de responder.
- No insistas ni presiones. Si la persona dice que ya no le interesa o que viajó con otra agencia, agradece, cambia el estado a sin_respuesta o no_calificado según corresponda, y despídete.
- Si responde con interés, devuelve la conversación.', 'publicado', 'humano', 'Borrador inicial (semilla)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM setter_agentes WHERE clave = 'seguimiento';

INSERT OR IGNORE INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en)
SELECT id, 1, 'Tu misión: atender a quien llega desde un paquete de la web (su mensaje trae un código "ref LL-…"). Ya vio un paquete y sabe qué quiere: no le preguntes qué destino le interesa.

- Agradece que haya escrito y confirma el paquete que estaba mirando si lo menciona.
- Ve directo a lo que falta para cotizar: fechas o mes de viaje, cantidad de personas (y edades de menores) y desde dónde viaja.
- Guarda todo con completar_lead.
- Con eso, califica y deriva a una asesora con un resumen que incluya el código de la web. No hace falta mandar el cotizador: la asesora le arma la propuesta.
- Si quiere cambiar mucho el paquete o todavía no decidió, devuelve la conversación.', 'publicado', 'humano', 'Borrador inicial (semilla)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM setter_agentes WHERE clave = 'reserva_web';

INSERT OR IGNORE INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en)
SELECT id, 1, 'Tu misión: atender a quien ya tiene un viaje reservado (seña pagada). No resuelves nada por tu cuenta: escucha qué necesita, tranquiliza y deriva siempre a una asesora con un resumen claro.', 'publicado', 'humano', 'Borrador inicial (semilla)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM setter_agentes WHERE clave = 'postventa';

-- Follow-ups: horas desde el último mensaje del lead. Los dos primeros entran
-- en la ventana de 24 h (mensaje libre del especialista seguimiento). El
-- tercero necesita una plantilla aprobada por Meta: queda inactivo hasta
-- cargar su nombre en `plantilla`.
INSERT OR IGNORE INTO setter_seguimientos (id, tras_horas, ia_estado, modo, plantilla, max_intentos, activo) VALUES
  (1, 4, NULL, 'ia_libre', NULL, 3, 1),
  (2, 22, NULL, 'ia_libre', NULL, 3, 1),
  (3, 72, NULL, 'plantilla', NULL, 3, 0);

INSERT OR IGNORE INTO setter_conocimiento (id, titulo, contenido, tags, activo, creado_en, actualizado_en) VALUES
  (1, 'Quiénes somos', 'Luna Llena Travel es una agencia de viajes con base en Cusco, Perú. Armamos viajes a medida y paquetes por Perú. Web: https://lunallenatravel.vercel.app · Instagram: @lunallenatours.', 'agencia', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (2, 'Precios y disponibilidad', 'No damos precios ni disponibilidad por WhatsApp desde el asistente: cada viaje se cotiza a medida. Para precios, mandar el cotizador o derivar a una asesora.', 'politica', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
