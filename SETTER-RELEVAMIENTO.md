# Setter IA — Fase 0: relevamiento del CRM

> Relevado el 29/10/2026 sobre el código local. Sin código escrito todavía.
> Acompaña a `PLAN-setter-luna-llena.md` (v3).

## 1. Dónde está el código

- **`C:\Users\lala\repo\plantilla-crm`**: git local, **sin remoto** (por eso no aparece en `lolognese-stack`).
- Es **la plantilla** de CRM para clientes: `nuevo-cliente.py` la copia entera (`shutil.copytree`) para cada cliente nuevo. La demo `crm-plantilla` es hoy el CRM de Luna Llena y se deploya con `deploy-demo.py` + flags de marca.
  → Todo lo que se sume acá lo heredan los CRM de clientes futuros (ver decisión D1).
- Árbol con trabajo ajeno sin commitear que **ya está en producción** (score de leads, migración 035, `leads.js`, `leads/[id].js`, panel). Los commits del setter no pueden arrastrarlo ni pisarlo.

## 2. Estructura

```
plantilla-crm/
├─ wrangler.toml            Pages "crm-plantilla", D1 binding DB, Workers AI binding AI
├─ _headers                 noindex + no-store en panel y /api/*
├─ panel-4c1f6a.html        panel completo: 9.618 líneas, HTML + CSS + JS vanilla en un archivo
├─ functions/_lib/*.js      auth, ventas, web-metricas, manychat, programa, vivo, reporte, canal, ig-foto
├─ functions/api/**         ~45 endpoints (file-based routing de Pages)
├─ crm/schema.sql           tablas base
├─ crm/migracion-NNN-*.sql  migraciones 002 → 038 (la próxima es 039)
├─ deploy-demo.py           deploy de la demo Luna Llena (pinta marca, sube con wrangler)
└─ nuevo-cliente.py         copia la plantilla para un cliente
```

- **No hay `package.json`, ni dependencias, ni tests.** Las Functions son JS plano sin build.
- **No hay `migrations/`**: la convención es `crm/migracion-NNN-nombre.sql`, aplicadas a mano con `wrangler d1 execute`.

## 3. Functions y auth

- `functions/_lib/auth.js`: header `x-crm-token`, comparación en tiempo constante contra dos secrets:
  - `CRM_TOKEN` → rol `cliente`
  - `CRM_ADMIN_TOKEN` → rol `admin`
- Helpers: `checkToken` (cualquier rol), `esAdmin`, `rolDe`, `json`. El rol lo usa `/api/yo` para que el panel oculte botones; la Function igual devuelve 403.
- Varios endpoints viejos redefinen su propio `json()` en vez de importarlo; los nuevos lo importan de `auth.js`.
- Endpoints públicos sin token (web): `lead-web`, `cotizacion-web`, `cotizar-web`, `evento-web`, `tally` (firmado con `TALLY_SIGNING_SECRET`).
- `.dev.vars` local: `CRM_TOKEN`, `CRM_ADMIN_TOKEN`, `TALLY_SIGNING_SECRET`. No hay `.dev.vars.example`.

## 4. Esquema real de `leads`

`schema.sql` + `ALTER TABLE` de las migraciones (no pude leer la D1 remota, ver §9):

| Grupo | Columnas |
|---|---|
| Base | `id`, `nombre` (NOT NULL), `pais`, `whatsapp` (texto libre), `email`, `personas`, `destinos`, `fecha_viaje`, `etapa`, `propuesta_url`, `precio`, `notas`, `creado_en`, `actualizado_en` |
| Tally / viaje | `fecha_alta`, `pasajes`, `llegada`, `salida`, `dias`, `submission_id` |
| Seguimiento | `calificado` (si \| masomenos \| curioso), `fecha_agenda`, `fecha_llamada`, `setter`, `closer`, `fuente`, `estrategia`, `medio_agenda`, `perdido_motivo`, `sena_pct`, `sena_fecha`, `saldo_vence`, `planning_fee` |
| Checklist cotizador | `presupuesto_pp`, `edades_menores`, `residencia`, `categoria_hotel`, `ocupacion`, `regimen`, `servicio`, `ocasion`, `vuelos_internos` |
| Atribución | `angulo`, `etiqueta_manychat`, `manychat_id`, `utm_source`, `utm_campaign`, `rama`, `duracion_segundos`, `meta_json`, `tipo_cotizacion` |
| Score (035, sin commitear) | `score`, `score_detalle` |
| Web (037) | `codigo_web` |

El checklist de la sección 1 del plan **ya existe completo** en `leads`: no hacen falta columnas nuevas para calificar.

## 5. Métricas y transcripción

- **`/api/metricas`** (GET con `desde`/`hasta`, POST un día o lista, upsert por fecha) sobre `metricas_dia`:
  `fecha` PK, `conversaciones`, `formularios_enviados`, `formularios_completados`, `actualizado_en`.
  El panel (sección Conversación) los **rotula** "Conversaciones / Calendarios enviados / Calls". El plan habla de "calendarios enviados y calls agendadas": son estas mismas columnas con otro nombre.
- **`/api/transcribir-idea/[id]`**: Whisper de Workers AI (`@cf/openai/whisper-large-v3-turbo`) por el binding `AI`, sin API key. Recibe un stream del CDN de IG; pasa como `audio/mp4` (con `video/*` falla con "8001"). Sirve tal cual para notas de voz de WhatsApp (ogg/opus), cambiando el content type. Se reutiliza la técnica, no el endpoint (está atado a `ideas`).

## 6. R2

**No hay R2.** Ni binding en `wrangler.toml` ni uso en el código. Ojo: en otro proyecto (Ideas de Reels) se descartó R2 porque la cuenta de Cloudflare pide tarjeta para activarlo.

## 7. Panel

- Un solo archivo. Tokens de color en `:root` (`--brand`, `--glacier` y derivados; `deploy-demo.py`/`nuevo-cliente.py` los reemplazan por marca). Tema claro/oscuro propio.
- **Navegación:** botones `nav.nav button[data-seccion]` (leads, ventas, web, agendas, conversacion, planificador, historias, performance, objetivos) + subtabs por sección.
- **Router por hash:** `#/<seccion>/<vista>`. La regex de `parseHash()` (línea ~2796) enumera secciones y vistas: hay que sumar `inbox`, `setter`, etc. Ventas tiene su propio match.
- **Render:** una función `renderX()` por sección (`renderLeads`, `renderVentas`, `renderWeb`, …) que arma HTML con template strings; `api()` (línea ~2475) agrega el token y ante 401 vuelve a la pantalla de token.
- **Polling:** `setInterval(load, 8000)` recarga **todo** el estado. El inbox necesita su propio polling liviano (solo chats con cambios desde el último `actualizado_at`), no colgarse de `load`.
- **Drawer del lead** (`#drawer`): un solo panel, **sin pestañas** hoy. La pestaña "Chat" introduce un patrón nuevo ahí (los otros drawers tampoco tienen pestañas). Ya tiene un bloque "Actividad en la web" que se carga aparte: el chat puede seguir ese modelo (bloque/pestaña que se carga al abrir).

## 8. Ajustes propuestos a la sección 7 del plan

1. **Migraciones en `crm/`**, no en `migrations/`: `crm/migracion-039-setter.sql` (y siguientes). Mantengo la convención del repo.
2. **Choque de nombres con `recursos`:** ya existe la tabla `recursos` y `/api/recursos` (lead magnets del Planificador). La tabla nueva queda `setter_recursos` (como dice el plan) y la sección del panel se llama **"Recursos del setter"** o va como pestaña dentro de "Setter IA", para no confundir. Rutas bajo `/api/setter/recursos`.
3. **`wa_id` en `leads`:** `whatsapp` es texto libre y la normalización que existe (`vivo.js`) asume Argentina (saca `54 9`). Hace falta un normalizador E.164 propio (Perú +51 y extranjeros) en `functions/_lib/`, compartido con el Worker. El cruce: `wa_id` → `whatsapp` normalizado → `codigo_web` del mensaje ("ref LL-…") → crear.
4. **Lead nuevo por WhatsApp:** `nombre` es NOT NULL. Usar el `profile.name` del webhook o "WhatsApp +51…" si no viene.
5. **Calificación:** usar las columnas que ya están (`calificado`, `score`). `score`/`score_detalle` hoy los llena el formulario web (035): la IA **no los pisa** si ya tienen valor (misma regla de "solo vacíos") y su motivo va a `ia_score_motivo`.
6. **`metricas_dia`:** el Cron escribe `conversaciones` y usa `formularios_enviados` para "cotizador enviado / derivado" y `formularios_completados` para lo que hoy se rotula "calls". No hacen falta columnas nuevas; sí hay que decidir el mapeo (D3). Cambio a evaluar: hoy el POST **pisa** el día completo; si la carga manual corrige y después corre el Cron, la pisa. Propongo una columna `origen` (`auto`/`manual`) o que el Cron no escriba un día ya editado a mano.
7. **R2:** si la cuenta no permite R2 sin tarjeta, plan alternativo para recursos y audios: subir el archivo una vez a la Media API de WhatsApp (devuelve `media_id`, dura 30 días) y guardar el original en D1 solo si es chico (< ~1 MB, base64) o como link externo (Drive, que ya se usa con rclone en `/subir-pieza`). A decidir (D4).
8. **Rol:** configurar agentes, prompts, recursos, kill switch y modelos = **solo admin**; inbox, tomar control y responder = cualquier rol.
9. **`setter_eventos`** suma `lead_id` para poder mostrar la auditoría en la ficha.
10. Todo lo demás de la sección 7 entra tal cual.

## 9. Cosas que encontré y hay que saber

- **Wrangler está logueado en otra cuenta de Cloudflare** (consulta a la D1 remota → `code: 7403`, "The given account is not valid or is not authorized"). Coincide con la mudanza del Tracker a su propia cuenta. Para aplicar migraciones o deployar `crm-plantilla` hay que volver a la cuenta correcta (`wrangler login` o `CLOUDFLARE_ACCOUNT_ID`). El esquema de §4 sale de los `.sql`; conviene confirmarlo contra la remota cuando el login esté bien.
- **Tests:** como el repo no tiene `package.json`, el `setter-worker` va en su propia carpeta (`setter-worker/`) con `package.json`, `wrangler.toml` y vitest + `@cloudflare/vitest-pool-workers`. `nuevo-cliente.py` lo copiaría también: hay que sumarlo al `ignore` si el setter no es para todos los clientes.
- **CPU de Pages Functions:** el plan gratis da 10 ms de CPU por request. Esperar a Anthropic no cuenta como CPU, pero armar contextos grandes y parsear respuestas sí. Asistente, playground y puntuación conviene que pasen por el Worker (Service Binding), como el envío.
- **Durable Objects** con almacenamiento SQLite están disponibles en el plan gratis de Workers: la arquitectura de la sección 6 no exige plan pago. Cron mínimo: 1 por minuto (el plan usa 15 min, ok).
- **BSP con coexistencia:** en esta sesión está conectado el MCP de **Kapso** (plataforma de WhatsApp sobre Cloud API con alta por Embedded Signup y coexistencia). Es candidato natural para el `<Bsp>Adapter` de la Fase 8; hay que confirmar precio y si reenvía echoes por webhook.
- **ManyChat** (`/api/manychat-preparar`, `_lib/manychat.js`) no se toca.

## 10. Decisiones (29/10)

- **D1:** solo Luna Llena. `nuevo-cliente.py` no copia `setter-worker/`, y el panel muestra las secciones del setter solo si el CRM tiene el setter configurado.
- **D2:** el score se commiteó (e19dbb1) antes de empezar.
- **D3:** `metricas_dia` es de Instagram (los formularios ni llegan a WhatsApp): **el setter no la toca**. Las métricas de WhatsApp se calculan en vivo desde `wa_conversaciones` / `wa_mensajes` y van a las analíticas del setter. Esto reemplaza el punto §8.6 y el "la sección Conversación se llena sola" de la Fase 6.
- **D4:** pendiente. Lorenzo revisa si R2 está activo con el paso a paso. La Fase 1 no lo necesita: R2 entra en la Fase 5.

## Preguntas originales

- **D1 — ¿Setter solo para Luna Llena o para la plantilla?** Recomiendo construirlo en la plantilla pero **apagado por defecto** (sin secrets de Meta/Anthropic no se activa, y la sección no aparece), así no hay dos ramas de código. Alternativa: excluir `setter-worker/` y las secciones en `nuevo-cliente.py`.
- **D2 — Commits con el score sin commitear:** ¿lo commiteo yo antes de empezar (es de otra sesión, ya está en prod) o lo dejo afuera con el truco de `hash-object` en cada commit?
- **D3 — Mapeo de `metricas_dia`:** ¿"cotizador enviado / derivado" va en `formularios_enviados`? ¿Y `formularios_completados` = "cotizador completado" (lead que llenó /cotizar/) o "call agendada"?
- **D4 — R2:** ¿la cuenta de Cloudflare de `crm-plantilla` tiene R2 habilitado? Si no, voy con la alternativa de §8.7.

## 11. Bitácora de fases

- **Fase 1 (0c2a62c):** Worker, migración 039, adaptador Meta, DO con debounce, 21 tests.
- **Fase 2 — Inbox:**
  - Sección "Inbox" (`#/inbox?c=<id>`), visible solo si `/api/setter/estado` dice activo (Service Binding `SETTER` + secret `SETTER_INTERNAL_SECRET` en Pages).
  - `wa_conversaciones` guarda copia del último mensaje (`ultimo_texto/autor/en`) para que la lista no lea `wa_mensajes`; índice en `espera_persona`. Se sumó a la 039 (todavía sin aplicar en remoto).
  - Polling liviano: `/api/setter/pulso` cada 6 s en cualquier sección (1 fila + urgentes por índice); la lista y el hilo se piden solo si cambió algo. Aviso sonoro y "(n)" en el título cuando un chat pasa a esperar a una persona.
  - Responder desde el CRM **pausa la IA** en ese chat (`ia_pausa_motivo = asesora_respondio`), para que no contesten las dos.
  - "Asignarme" usa un nombre guardado en el navegador (`crm_nombre`): el CRM no tiene usuarios, solo dos tokens.
  - En la ficha del lead, el chat va como bloque "Chat de WhatsApp" (últimos 8 mensajes + "Abrir en el Inbox"), igual que "Actividad en la web": el drawer no tiene pestañas.
  - Notas de voz y fotos se bajan de Meta por el Worker (`/interno/media/<id>`) bajo demanda; nada se guarda todavía.
- **Fase 3 — Agente jefe + especialistas:**
  - `setter-worker/src/agente/`: `contexto.js` (reglas fijas + prompt publicado + especialistas + recursos + conocimiento, cacheado; ficha, faltantes, hora de Lima, origen y ventana aparte), `herramientas.js` (las 10 del plan), `turno.js` (guardas, loop de herramientas, traspasos, envío), `demora.js`.
  - Modelo: `claude-sonnet-5-5` con thinking adaptativo y effort `low` (chat). Cambiable por agente (`setter_agentes.modelo`) o global (`setter_config.modelo_respuesta`). **Fallback por rechazo activado** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): si el clasificador de seguridad rechaza, la API reintenta sola con otro modelo. Si igual rechaza, no se manda nada y el chat pasa a "espera a una persona".
  - Traspaso en el mismo turno (el especialista contesta enseguida), máximo 3 agentes por turno: el tercero ya no tiene `traspasar`/`devolver`.
  - Lead con "ref LL-…" en su primer mensaje va directo a `reserva_web`.
  - Aviso de IA: se le pide al modelo en el primer mensaje; si no lo dice, se antepone una burbuja fija.
  - Antes de mandar se vuelve a mirar: si el lead escribió algo nuevo o una asesora tomó el chat mientras Claude pensaba, la respuesta se descarta.
  - Notas de voz: Whisper de Workers AI (binding `AI` en el Worker) antes de llamar a Claude.
  - "Escribiendo…": `typing_indicator` de la Cloud API al empezar el turno.
  - Uso: `setter_uso` cuenta 1 por turno con respuesta; `setter_config.tope_mensual` (2000 en la semilla). Al tope, no responde y el chat pasa a esperar a una persona.
  - `crm/seed-setter-luna-llena.sql`: agentes luna (jefe), calificacion, seguimiento, reserva_web, postventa (inactivo), prompts v1 **borrador**, recurso @cotizador (`/cotizar/` de la web nueva), conocimiento mínimo.
- **Fase 4 — Setter IA:**
  - Sección `#/setter/agentes | conocimiento | ajustes`. Escribir = solo admin; el kill switch lo puede tocar cualquiera.
  - Editor con versiones (borrador / publicada / "volver a esta" = nueva versión publicada), autocompletado de `@etiqueta`, pestañas Probar, Puntuación, Historial, Asistente y Config (tabla 2.2).
  - Playground, puntuación y asistente corren en el Worker (la API key vive solo ahí) y no tocan leads: herramientas simuladas sobre un lead de mentira. El loop de Claude es el mismo que el turno real (`agente/loop.js`).
  - Puntuación con `claude-haiku-5-5` y salida estructurada; asistente con el modelo de Ajustes (o `modelo_asistente`), propone el prompt completo y lo prueba antes de responder.
  - Especialista nuevo: la clave sale del nombre, nace inactivo y se activa al publicar su primera misión.
  - **Modo barato para probar:** la semilla deja `modelo_respuesta = claude-haiku-5-5` y tope 300/mes. Haiku no tiene fallback por rechazo: solo se manda `fallbacks` a Sonnet 5.5 / Opus / Fable. Pasar a Sonnet desde Ajustes antes de producción.
- **Fase 5 — Recursos sin R2:** vista `#/setter/recursos` (Links y archivos | Audios). Archivos de hasta 1 MB en `setter_archivos` (migración 040, base64); al mandarlos se suben a WhatsApp (`/media`) y el media_id se reusa 25 días. Grabación desde el navegador solo en formatos que WhatsApp acepta: OGG/Opus (Firefox, sale como nota de voz) o MP4/AAC (Chrome, sale como audio común); si no, pide subir el archivo. Aviso de agentes activos sin recurso de conversión.
- **Fase 6 — Echo, follow-ups, aviso y Agendas:**
  - La asesora contesta desde el celular (echo) o desde el Inbox: la IA se pausa en ese chat, salvo "Responde siempre".
  - Follow-ups en el cron (cada 15 min, de 9 a 21 h en la zona del agente), reglas en `setter_seguimientos` (semilla: 4 h y 22 h con mensaje libre del especialista `seguimiento`; 72 h con plantilla, inactiva hasta cargar el nombre de una plantilla aprobada por Meta). Pasadas las reglas sin respuesta: `sin_respuesta`.
  - Aviso de derivación por mail (Resend) si el Worker tiene `RESEND_API_KEY` y `AVISO_EMAIL`; si no, solo el sonido del Inbox.
  - Agendas & Setteo: filtro "setteado por IA / por una persona" y bloque "Por setter".
  - `metricas_dia` no se toca (es de Instagram, decisión D3).
- **Fase 7 — Análisis y analíticas:**
  - Haiku analiza cada chat quieto hace 30 min con novedades (cron, hasta 10 por corrida): intención inicial, objeciones con frase textual, dolores, pedidos, señales de compra, preguntas sin responder, motivo de pérdida, etapa del corte, tipo de lead, próxima acción, prioridad. Esquema validado contra la API real.
  - Vista `#/setter/analiticas` (Resumen, Por qué se pierden, Quién llega, Setter IA, Avanzadas; 7/30/90 días). Se calcula a pedido, no con el polling. "Agregar a la base" lleva la pregunta sin responder al formulario de conocimiento.
  - `/api/setter/semana` (token del CRM): resumen de 7 días para el agente semanal de ventas.
- **Fase 8 (parte que no depende del BSP) — Monitoreo:** el cron pasa a "espera a una persona" (suena en el Inbox) los chats con la IA activa donde el lead escribió último hace más de 10 min, y deja `alerta_sin_respuesta`. Vista `#/setter/salud`: último mensaje recibido / respondido, quién espera, problemas de 7 días agrupados con qué hacer, últimos eventos.
