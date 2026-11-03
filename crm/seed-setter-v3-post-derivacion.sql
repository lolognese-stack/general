-- Setter de Luna Llena, versión 3 del agente principal (29/10): al derivar ya
-- no se despide, pregunta si tiene alguna consulta sobre el servicio. La IA
-- lee esa respuesta, la contesta si puede, califica y se calla (turno.js).
-- Sale de la v2 cambiando solo la despedida. Va DESPUÉS de seed-setter-v2-criterio.sql
-- y de migracion-041-setter-calificacion.sql. Se puede correr más de una vez.
--
--   npx wrangler d1 execute crm-plantilla --remote --file crm/seed-setter-v3-post-derivacion.sql

INSERT INTO setter_prompts (agente_id, version, texto, estado, autor, nota_cambio, creado_en)
SELECT p.agente_id, 3,
       replace(p.texto, 'Al derivar, despídete solo con: "En breve le envío la cotización."',
               'Al derivar, en vez de despedirte escribe: "Perfecto, ya pasamos su consulta para armar la cotización. Mientras la preparamos, ¿tiene alguna consulta sobre el servicio?"'),
       'publicado', 'humano', 'Pregunta después de derivar (29/10)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM setter_prompts p JOIN setter_agentes a ON a.id = p.agente_id
 WHERE a.clave = 'luna' AND p.version = 2
   AND NOT EXISTS (SELECT 1 FROM setter_prompts x WHERE x.agente_id = p.agente_id AND x.version = 3);
