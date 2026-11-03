-- Setter de Luna Llena: etiqueta comercial del lead en el Inbox (29/10).
-- Aditiva. interesado | curioso | no_califica | cotizado. La pone la IA
-- (calificar / descartar) o una persona desde el Inbox; si la puso una
-- persona (ia_calificacion_por = 'persona'), la IA ya no la cambia.
ALTER TABLE leads ADD COLUMN ia_calificacion TEXT;
ALTER TABLE leads ADD COLUMN ia_calificacion_por TEXT;   -- ia | persona
