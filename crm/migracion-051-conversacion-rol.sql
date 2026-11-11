-- Inbox: chats anclados y contactos del equipo (9/11). Aditiva.
-- anclada: el chat se queda arriba de la lista.
-- rol: NULL = un lead de siempre; 'cotizador' = la persona que arma las cotizaciones
--      (no es un lead: el botón "Pasar al cotizador" le manda la ficha completa).
-- alias: cómo se llama en el Inbox un chat que no tiene lead.
ALTER TABLE wa_conversaciones ADD COLUMN anclada INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wa_conversaciones ADD COLUMN rol TEXT;
ALTER TABLE wa_conversaciones ADD COLUMN alias TEXT;
