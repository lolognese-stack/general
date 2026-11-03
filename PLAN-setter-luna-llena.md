# Plan: Setter IA de WhatsApp dentro del CRM de Luna Llena

> **Versión 3.** Suma lo relevado por dentro de SetterApp (agentes, recursos, inbox, analíticas). Reemplaza la v2.
> El setter se construye **dentro del CRM existente** (`crm-plantilla.pages.dev`): mismo panel, misma base D1, mismos leads.
> Este archivo es el plan maestro para Claude Code. Va en la raíz del proyecto del CRM y se ejecuta fase por fase.

---

## 0. Prompt de arranque (pegar en Claude Code, abierto en la carpeta del CRM)

```
Leé PLAN-setter-luna-llena.md completo. Vamos a sumar al CRM un setter de IA para WhatsApp, fase por fase.
Reglas:
- Antes de tocar nada, hacé la Fase 0 (relevamiento) y mostrame el resultado.
- Trabajá UNA fase por vez. Al terminar cada una, corré los criterios de aceptación,
  mostrame qué quedó y esperá mi OK antes de seguir.
- La D1 crm-plantilla tiene DATOS REALES y la comparten el CRM, la web y el formulario:
  migraciones solo aditivas (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN), en migrations/,
  SIN aplicarlas en remoto. Las aplico yo. Probá todo con wrangler y D1 local.
- No hagas deploy: lo hago yo.
- Respetá el estilo actual del panel (JS vanilla, mismos componentes, mismo sistema de colores).
  No metas frameworks nuevos en el panel.
- Nunca subas secretos: van con `wrangler secret` y documentados en .dev.vars.example sin valores.
- Escribí tests para el webhook, la lógica del agente y la cola por conversación.
- Si algo choca con la documentación actual de Meta, Cloudflare o Anthropic, frená y avisame.
Empezá por la Fase 0.
```

---

## 1. Qué hace el sistema

Un **setter de IA** que atiende los WhatsApp de Luna Llena Travel las 24 horas, integrado al CRM:

1. **Responde** con el tono de Luna Llena (español neutro, "tú"), en mensajes cortos y simulando el tiempo de lectura de una persona.
2. **Filtra/califica** con preguntas naturales y **completa la ficha del lead que ya existe en el CRM**:
   - destinos, fechas, personas, residencia y presupuesto por persona;
   - edades de menores, categoría de hotel, ocupación, régimen y servicio;
   - ocasión especial, vuelos internos y pasajes.
3. **Marca el estado del lead** (frío, tibio, calificado, etc.) y la calificación del CRM (Sí / Masomenos / Curioso + score).
4. **Manda recursos** cuando la conversación llega a ese punto: link del cotizador, itinerarios en PDF, audios grabados por el equipo.
5. **Pasa el chat a una asesora** cuando el lead está calificado o pide una persona. La asesora sigue contestando **desde la app WhatsApp Business del celular**, y la IA se calla sola en ese chat.
6. **Retoma** a quien se enfrió, con un especialista de seguimiento.
7. **Analiza** cada chat (objeciones, motivo de pérdida, preguntas sin responder) y lo muestra en analíticas dentro del CRM.

**Objetivo del setter:** filtrar. La IA no cotiza ni cierra: entrega leads calificados con la ficha completa y un resumen.

---

## 2. Qué se copia de SetterApp (relevado por dentro)

La cuenta de SetterApp está en el plan gratis, **sin canales conectados**. El agente "Juan" y su especialista "Follow-ups" tienen el **prompt vacío**, no hay versiones guardadas ni recursos cargados. No hay configuración para copiar, pero sí **la estructura del producto**, que es lo que se replica.

### 2.1 Agentes: un "jefe" + especialistas

- **Jefe:** el agente principal. Tiene su "prompt del jefe" y atiende la conversación.
- **Especialistas:** sub-agentes con nombre, una **clave** (se arma sola a partir del nombre) y una **misión** (su prompt). El jefe le **traspasa la conversación** a un especialista nombrándolo por su clave.
  - En la cuenta hay uno: **Follow-ups**, que "retoma a quien se enfría".
  - Un especialista se crea inactivo y se activa al guardar su misión.
- **Canal por agente:** cada agente se asigna a Instagram o a WhatsApp, y tiene un interruptor para encenderlo o apagarlo.

**Especialistas para Luna Llena (propuesta):**

| Clave | Misión |
|---|---|
| `calificacion` | Completar el checklist y decidir Sí / Masomenos / Curioso |
| `seguimiento` | Retomar a quien se enfrió (dentro de las 24 h, mensaje libre; después, plantilla) |
| `reserva_web` | Atender a quien llega con código "ref LL-…" desde un paquete de la web: ya sabe qué quiere, va directo a fechas y personas |
| `postventa` (opcional) | Dudas de quien ya tiene seña pagada; deriva siempre a una persona |

### 2.2 Configuración de cada agente

| Opción en SetterApp | En el CRM |
|---|---|
| Nombre interno ("No lo ve el lead") | Igual |
| Tono: Usted / Tú | Igual. Para Luna Llena: **Tú** |
| Idioma y dialecto forzado (es-AR, es-MX, neutro, English, PT-BR…) | Igual. Para Luna Llena: **español neutro**, y además **English** y **Português** si el lead escribe en esos idiomas |
| Zona horaria ("la hora que el setter cree que es") | Igual. Para Luna Llena: **Perú (Lima/Cusco)** |
| **Responde siempre** (si está encendido, que una persona conteste a mano NO pausa la IA) | Igual, apagado por defecto |
| **Responder al instante** (por defecto simula lectura humana: hasta 3 min en el primer mensaje) | Igual. Demora por defecto según el largo del mensaje, más larga en el primero |
| **Aviso de IA** (obligatorio en Europa, art. 50 del Reglamento de IA: el lead tiene que saber que habla con una IA; texto fijo + tu marca; vacío = desactivado) | Igual. **Encenderlo**: Luna Llena tiene oficina en Francia y vende a europeos |

### 2.3 Editor de prompt

- **Prompt del jefe** o **misión** del especialista, en un editor de texto grande con botón Guardar.
- **Puntuación del prompt:** una IA evalúa el prompt, le pone nota y lista qué le falta ("Volver a puntuar").
- **Historial:** versiones guardadas, con la opción de volver a una.
- **Asistente:** un chat que lee el prompt, lo edita y **lo prueba antes de responder**. Los cambios quedan en borrador hasta que se guardan. Trae atajos como:
  - "¿Qué le falta a este prompt?"
  - "Que no diga el precio por DM"
  - "Agregá cómo responder a 'lo voy a pensar'"
- **Probar (playground):** simula la conversación con el prompt y el modelo reales, sin guardar nada. Se elige **por dónde entró el lead**, y eso cambia su "temperatura":
  - DM directo → `cold`;
  - respuesta a una historia → `warm`;
  - automatización (se replica el disparador).

  Para WhatsApp, los orígenes equivalentes son:
  - directo;
  - desde la web con código LL- (tibio/caliente);
  - anuncio click-to-WhatsApp;
  - link de ManyChat/Instagram.
- **"Guion por pasos"** (opción por agente): el prompt se arma como pasos numerados. El análisis registra en qué paso está cada lead y las analíticas muestran **dónde se traban**.

### 2.4 Recursos (links, archivos y audios)

- Cada recurso tiene:
  - **Etiqueta** corta, sin espacios (ej. `@guia-posparto`), que **se cita en el prompt**;
  - **Descripción:** "qué es y cuándo mandarlo";
  - tipo **Link** o **Archivo**;
  - alcance: todos los agentes.
- **Audios:** se graban o suben desde Recursos › Audios, y el setter los manda como nota de voz.
- **"Es el link de agenda de este agente":** cada agente necesita uno, y es lo que el embudo cuenta como **"agenda enviada"**.
  - En Luna Llena, el equivalente es el **recurso de conversión**: el link del cotizador (`luna-llena-viaje.pages.dev`) o la derivación a la asesora. Se cuenta como "cotizador enviado / derivado".

### 2.5 Inbox (`/conversations`)

- Lista de chats con buscador y **filtros**:
  - **Estado del lead:** Cold, Warm, Qualified, Booking Link Sent, Booked, No Showed, Closed, Not Closed, Nurture, No Response, Not Qualified, Not a Lead.
  - **Quién responde:** todas / con IA / humano.
  - **Sin leer:** todas / sin leer / leídas.
  - **Visto por el lead:** todas / vio y no contestó / no lo abrió. Sale de los avisos de lectura de WhatsApp.
  - **Asignación:** todas / míos / sin asignar.
  - **Quién abrió la conversación:** el lead / nosotros.
  - **Última actividad:** hoy / esta semana / este mes / personalizado.
  - **Urgentes:** solo las que esperan a una persona.
- **Aviso sonoro** cuando un lead pide un humano, aunque la pestaña esté en segundo plano.
- **Contactos:** se crean solos con cada mensaje entrante. Tienen filtros y exportación.

### 2.6 Analíticas

- **Resumen:**
  - checklist de puesta en marcha (canal conectado, setter creado);
  - KPIs: leads nuevos que agendaron, leads, tasa de agenda enviada, tasa de agenda, respuesta de leads, **"esperan a una persona"** (IA apagada y el lead escribió último);
  - embudo de conversión: cada etapa cuenta a quien llegó al menos ahí;
  - **para retomar a mano** (últimos 30 días);
  - leads y reuniones por día;
  - **de dónde vienen**.
- **Por qué se pierden:** dónde mueren (etapa del corte), por qué (motivo), cómo terminan, qué los frena y **objeciones, con una frase típica de cada una**.
- **Quién llega:** estados hoy, tipos de lead (de los que dejaron de responder), pain points y qué piden.
- **Setter IA:**
  - tiempo de respuesta del setter;
  - respuesta del lead tras el primer mensaje de la IA;
  - **tasa de lectura** de los mensajes de la IA;
  - follow-ups contestados;
  - mensajes de IA por lead nuevo;
  - IA apagada en leads abiertos;
  - mensajes por día (IA / equipo / lead);
  - **señales de compra** y cuántos agendan;
  - qué se hizo en la conversación;
  - **dónde se traban en el guion**.
- **Avanzadas:**
  - origen de leads por cohorte;
  - **primera intención** (qué quería en el primer mensaje);
  - **preguntas sin responder** (lo que el lead preguntó y el setter no supo contestar: es la lista de lo que falta en la base de conocimiento);
  - objeciones;
  - dónde se pierden (motivo, más los que nunca respondieron en 3 días);
  - **follow-ups por intento** (1, 2, 3+): enviados, contestados, agenda enviada, llamadas, descartados y tiempo hasta responder. Solo cuenta follow-ups de más de 72 h.

### 2.7 Otros

- **Conector MCP** para consultar conversaciones y métricas, y cambiar el setter desde Claude o ChatGPT. En SetterApp es de pago; acá queda como fase opcional.
- **Créditos:** solo cuentan las respuestas de la IA a leads; el análisis y el asistente no. En el CRM se traduce en un **contador de uso y tope mensual** configurable.

---

## 3. Qué ya tiene el CRM (relevado del panel deployado)

| Pieza | Cómo está hoy | Cómo la usa el setter |
|---|---|---|
| **Stack** | Cloudflare Pages + Pages Functions (`/api/*`) + D1 `crm-plantilla`. Panel de una sola página en JS vanilla | Se suma ahí, más un Worker para la cola (sección 6) |
| **Auth** | Token en `localStorage` (`crm_token`), header `x-crm-token`, 401 → pantalla de token | Las rutas nuevas usan el mismo chequeo |
| **Leads** (`/api/leads`) | Ficha con contacto, viaje, checklist de calificación, etapa, setter, closer, fuente, ángulo, etiqueta ManyChat y código web | La IA crea o actualiza el lead por número de WhatsApp y llena el checklist |
| **Etapas** | lead_nuevo → contactado → propuesta_pendiente → propuesta_enviada → seguimiento → ganado / perdido (+ motivo de perdido) | No se tocan. El estado de la IA va aparte (sección 7) |
| **Calificación** | Sí / Masomenos / Curioso + score | La IA la propone y la asesora la puede corregir |
| **Código web** | El "ref LL-…" que llega en el WhatsApp desde la web | Activa el especialista `reserva_web` y se guarda en `codigo_web` |
| **Conversación** (`/api/metricas`) | Carga diaria **manual** de conversaciones, calendarios enviados y calls agendadas | El setter la llena solo |
| **Agendas & Setteo** | Leads por ángulo/pieza, cobertura de ángulo, calificados | Suma "setteado por IA vs. humano" |
| **Transcripción** (`/api/transcribir-idea/`) | Ya transcribe audios de ideas | Se reutiliza para las notas de voz de los leads |
| **Polling** | El panel refresca cada X segundos | El inbox usa el mismo mecanismo |
| **ManyChat** (`/api/manychat-preparar`) | Integración con Instagram | Sigue igual |

---

## 4. Decisiones tomadas

- **Negocio:** Luna Llena Travel. Un agente jefe + especialistas.
- **Canal:** WhatsApp Business. Instagram sigue en ManyChat. El modelo de datos deja el campo `canal`, así sumar Instagram después no obliga a rehacer nada.
- **Celular:** el equipo sigue con la app WhatsApp Business. En producción, el número va en **coexistencia** (sección 5).
- **Dónde vive:** dentro del CRM. Rutas en Pages Functions, tablas nuevas en D1 con migraciones aditivas, secciones nuevas en el panel y un Worker `setter-worker` para el webhook, la cola con demora y las tareas programadas.
- **IA:** API de Anthropic.
  - `claude-sonnet-5-5` para responder y para el asistente del prompt;
  - `claude-haiku-5-5` para analizar, clasificar y puntuar.
  - Los modelos se configuran desde el panel.

---

## 5. Coexistencia (WhatsApp Business app + Cloud API)

Mismo número en el celular y en la API. La asesora ve en el celular lo que escribe la IA. Lo que ella manda desde el celular llega como webhook "echo" y pausa la IA en ese chat (salvo que "Responde siempre" esté encendido).

El alta en coexistencia se hace con el *Embedded Signup* de Meta, que solo ofrecen:

- los **BSP** (360dialog, Twilio, YCloud, etc.);
- los **Meta Tech Providers**, que no conviene para uso propio.

**Estrategia:**

- **Desarrollo:** número de prueba gratis de la Cloud API.
- **Producción:** el número real se conecta por un BSP con coexistencia.
- Toda la mensajería pasa por una interfaz `ChannelAdapter`:

```ts
interface ChannelAdapter {
  verifyWebhook(req: Request): Response | null
  validateSignature(req: Request, rawBody: string): Promise<boolean> // HMAC con WebCrypto
  parseInbound(body: unknown): InboundEvent[]   // mensajes, estados (sent/delivered/read) y echoes
  sendText(to: string, text: string): Promise<SentRef>
  sendMedia(to: string, media: MediaRef): Promise<SentRef>       // incluye audio como nota de voz
  sendTemplate(to: string, name: string, lang: string, params: string[]): Promise<SentRef>
  markRead(messageId: string): Promise<void>
}
// MetaCloudAdapter (dev) y <Bsp>Adapter (producción con coexistencia)
```

**Plan B sin coexistencia:** número solo en Cloud API, y la asesora contesta desde el inbox del CRM.

---

## 6. Arquitectura en Cloudflare

```
WhatsApp (lead) ⇄ Meta Cloud API / BSP
                       │ webhook
                       ▼
  setter-worker (Worker)
   ├─ POST /webhook: valida firma, guarda en D1 (idempotente) y responde 200
   │                 → avisa al Durable Object de esa conversación
   ├─ Durable Object "Conversacion" (uno por número)
   │    - cada mensaje reprograma su alarma a ahora + demora humana
   │      → debounce: varios mensajes seguidos reciben UNA respuesta
   │    - un turno por vez → nunca hay dos respuestas en paralelo
   │    - al sonar: chequea pausa → elige quién atiende (jefe o especialista activo)
   │      → arma contexto → Claude con herramientas → envía → actualiza lead y estado
   └─ Cron Trigger (cada 15 min): follow-ups, análisis pendientes, métricas del día, alertas

  Pages (CRM actual)
   ├─ /api/setter/*: inbox, chat, enviar desde la web, pausar/reanudar, agentes,
   │                 prompts y versiones, puntuación, asistente, playground,
   │                 recursos y analíticas
   │   (para enviar llama al Worker por Service Binding)
   └─ Panel: secciones nuevas "Inbox", "Setter IA" y "Recursos", pestaña "Chat"
      en la ficha del lead y analíticas del setter

  D1 crm-plantilla (binding DB, compartido) · R2 para archivos y audios de Recursos
```

**Por qué Durable Objects:** el cron corre como mínimo cada 1 minuto. La alarma de un DO resuelve en una pieza la demora humana, el debounce y el turno único por conversación.

**Traspaso jefe → especialista:**

1. El jefe usa la herramienta `traspasar(clave, motivo)`.
2. La conversación guarda `agente_activo = clave`.
3. Desde el turno siguiente responde el especialista, con su misión + el contexto común.
4. El especialista puede devolver la conversación al jefe con `devolver(motivo)`.

Los follow-ups programados los atiende siempre el especialista `seguimiento`.

---

## 7. Modelo de datos (migraciones aditivas en D1)

Todo nuevo, con `CREATE TABLE IF NOT EXISTS`. A `leads` solo se le **agregan** columnas.

- **`ALTER TABLE leads ADD COLUMN`:**
  - `wa_id` (indexado, E.164);
  - `ia_estado`: frio | tibio | calificado | cotizador_enviado | derivado | nurture | sin_respuesta | no_calificado | no_es_lead. Es el equivalente a los estados de SetterApp; booked/closed ya los cubre la `etapa` del CRM;
  - `ia_resumen`, `ia_score_motivo`, `ia_origen` (directo | web_ref | anuncio | instagram | otro), `ia_primera_intencion`.
- **wa_conversaciones:**
  - `id`, `lead_id`, `canal` ('whatsapp'), `wa_id` (único);
  - `agente_id`, `agente_activo` (clave del jefe o del especialista);
  - `ia_activa`, `ia_pausa_motivo` (manual | asesora_respondio | handoff | kill_switch);
  - `abierta_por` (lead | nosotros), `asignada_a`, `espera_persona` (0/1);
  - `ultimo_in_at`, `ultimo_out_at`, `ventana_hasta`;
  - `no_leidos`, `visto_por_lead` (no_abrio | vio_no_contesto | contesto), `paso_guion`, `creado_at`.
- **wa_mensajes:**
  - `id`, `conversacion_id`, `direccion`;
  - `autor` (lead | ia | asesora_app | asesora_web | sistema), `agente_clave`;
  - `tipo`, `texto`, `media_key`, `transcripcion`, `recurso_id`;
  - `provider_id` **UNIQUE**, `estado` (sent | delivered | read | failed), `leido_at`;
  - `es_followup`, `intento_followup`, `creado_at`.
- **setter_agentes:**
  - `id`, `nombre`, `rol` (jefe | especialista), `clave`, `padre_id`, `canal`, `activo`;
  - `tono` (usted | tu), `idioma` (auto | es | es-AR | … | en | pt-BR), `zona_horaria`;
  - `responde_siempre`, `responder_al_instante`, `aviso_ia_marca`;
  - `guion_por_pasos` (0/1), `recurso_conversion_id`, `modelo`.
- **setter_prompts** (versionado):
  - `id`, `agente_id`, `version`, `texto`, `estado` (borrador | publicado), `autor` (humano | asistente), `nota_cambio`, `creado_at`;
  - la versión publicada más nueva es la activa.
- **setter_puntuaciones:** `prompt_id`, `nota`, `faltantes_json`, `creado_at`.
- **setter_recursos:**
  - `id`, `etiqueta` (única, sin espacios; se cita como `@etiqueta`), `descripcion` ("qué es y cuándo mandarlo");
  - `tipo` (link | archivo | audio), `url` o `r2_key`, `duracion_s` (audios), `activo`.
- **setter_conocimiento:** `id`, `titulo`, `contenido`, `tags`, `activo`. Destinos, paquetes, políticas, preguntas frecuentes. Puede alimentarse de `src/content/paquetes/*.json` de la web nueva.
- **setter_seguimientos:** `id`, `tras_horas`, `ia_estado`, `modo` (ia_libre | plantilla), `plantilla`, `max_intentos`.
- **wa_analisis:**
  - `conversacion_id`, `intencion_inicial`;
  - `objeciones_json` (cada una con su frase típica), `dolores_json`, `pedidos_json`, `senales_compra_json`;
  - `preguntas_sin_respuesta_json`, `motivo_perdida`, `etapa_corte`, `tipo_lead`;
  - `proxima_accion`, `prioridad`, `actualizado_at`.
- **setter_uso:** `mes`, `respuestas_ia`, `tope`. Solo cuentan las respuestas a leads.
- **setter_eventos:** auditoría de traspasos, pausas, cambios de estado y errores.

**Cruce con leads existentes:**

- Se busca el lead por `wa_id`. Si no aparece, se normaliza `whatsapp` y se vuelve a buscar.
- Si no hay lead, se crea uno con `etapa = lead_nuevo`, `setter = "IA"`, la `fuente` según el origen y el `codigo_web` si vino.
- **Nunca se pisa** un campo que cargó la asesora: solo se completan los vacíos, y las diferencias se anotan en `ia_resumen`.

---

## 8. Fases

Cada fase termina con sus criterios de aceptación cumplidos y su propio commit o PR.

### Fase 0 — Relevamiento (sin escribir código)

`SETTER-RELEVAMIENTO.md` con:

- estructura del proyecto;
- cómo están hechas las Functions y el chequeo de `x-crm-token`;
- el esquema real de `leads` y de las métricas;
- cómo funcionan `/api/metricas` y `/api/transcribir-idea/`;
- si ya hay R2;
- el `wrangler.toml`;
- cómo se renderizan las secciones del panel.

Si el esquema real no coincide con la sección 7, propone los ajustes.

✅ **Aceptación:** el relevamiento está aprobado y la sección 7 quedó ajustada.

### Fase 1 — Base y canal WhatsApp

- `setter-worker`: binding a la D1, Durable Object, cron y secrets:
  - `ANTHROPIC_API_KEY`
  - `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`
  - `SETTER_INTERNAL_SECRET`
- Migraciones de la sección 7.
- `ChannelAdapter` + `MetaCloudAdapter`: handshake, firma, guardado idempotente, estados (incluido **read**, para "visto por el lead"), envío de texto, medios y audio, y marca de leído.

✅ **Aceptación:**
- Un mensaje de prueba crea o encuentra el lead.
- Un envío llega al celular.
- Un webhook repetido no duplica nada.
- Los estados actualizan el mensaje.

### Fase 2 — Inbox y contactos

- Sección **"Inbox"**: lista de chats con los **filtros de la sección 2.5** (estado, quién responde, sin leer, visto por el lead, asignación, quién abrió, última actividad, urgentes) y buscador.
- **Hilo:** burbujas por autor, indicando qué agente o especialista respondió; audios con su transcripción; aviso de ventana de 24 h cerrada.
- **Panel derecho:** ficha resumida del lead + análisis.
- Botones **"Tomar control" / "Devolver a la IA"** y **"Asignarme"**.
- Responder desde la web, vía el Worker.
- **Aviso sonoro** cuando un lead pide un humano (`espera_persona = 1`).
- Pestaña **"Chat"** en el drawer del lead.

✅ **Aceptación:**
- Un mensaje entrante aparece sin recargar la página.
- Los filtros funcionan.
- Responder desde el CRM llega al celular.
- Un pedido de humano suena.

### Fase 3 — Agente jefe + especialistas

- **Contexto común:** prompt publicado del agente que atiende + base de conocimiento + recursos disponibles (etiqueta + "cuándo mandarlo") + historial recortado + ficha del lead + campos faltantes + hora en Cusco + ventana + origen y temperatura.
- **Herramientas:**
  - `completar_lead(campos)` (solo campos vacíos);
  - `cambiar_estado(ia_estado)`;
  - `calificar(si | masomenos | curioso, score, motivo)`;
  - `enviar_recurso(etiqueta)`: si es el recurso de conversión, cuenta como "cotizador enviado";
  - `traspasar(clave, motivo)` y `devolver(motivo)`;
  - `derivar_a_asesora(motivo, resumen)`: pausa la IA, pone `espera_persona = 1`, `ia_estado = derivado`, mueve la etapa a `contactado` y avisa;
  - `descartar(motivo)`;
  - `guardar_codigo_web(ref)`;
  - `marcar_paso(n)` (si el guion por pasos está activo).
- **Aplicar la config del agente:** tono, idioma o dialecto, zona horaria, **aviso de IA** (en el primer mensaje), "responde siempre" y "responder al instante".
- **Demora humana:** según el largo del mensaje del lead, hasta ~3 min en el primero; partida en 1–3 burbujas.
- **Audios entrantes:** se transcriben y la IA responde al texto.
- **Guardas:**
  - no responde si está pausada o el kill switch está activo;
  - no inventa precios, cupos ni disponibilidad;
  - ante enojo o pedido de persona, deriva;
  - nunca escribe dos veces seguidas sin que el lead haya escrito, salvo los follow-ups.
- **Uso:** contador de respuestas de la IA y tope mensual. Al llegar al tope, la IA se pausa y avisa.

✅ **Aceptación:**
- Conversación de prueba completa: el jefe saluda con el aviso de IA, traspasa a `calificacion`, que llena el checklist, califica, manda el recurso de conversión y deriva.
- Un lead con "ref LL-…" va a `reserva_web`.
- Tests: debounce, turno único, pausa, traspaso, no pisar campos.

### Fase 4 — Sección "Setter IA" (configurarlo como yo quiera)

- **Lista de agentes:** jefe + especialistas, con canal, interruptor, "Probar" y "Editar prompt". "Nuevo especialista" pide nombre (la clave sale sola), se crea inactivo y se activa al guardar la misión.
- **Editor:**
  - texto del prompt o la misión, con autocompletado de `@etiquetas` de recursos;
  - panel derecho con 4 pestañas:
    - **Puntuación:** Haiku le pone nota y lista lo que falta.
    - **Historial:** versiones y "volver a esta".
    - **Asistente:** chat que propone ediciones, **las prueba en el playground** y las deja en borrador hasta "Guardar". Atajos: "¿Qué le falta?", "Que no diga el precio por WhatsApp", "Cómo responder a 'lo voy a pensar'".
    - **Config:** la tabla de la sección 2.2 + "guion por pasos" + recurso de conversión.
- **Playground:** chat simulado con el prompt (borrador o publicado) y el modelo reales. Selector de origen (directo / web con código LL- / anuncio / Instagram) y temperatura. No guarda nada ni toca leads.
- **Base de conocimiento:** crear, editar y desactivar ítems.
- **Kill switch global.**

✅ **Aceptación:**
- Crear un especialista, escribir su misión con el asistente, probarlo en el playground y publicarlo cambia el comportamiento real sin deploy.
- Volver a una versión anterior funciona.

### Fase 5 — Recursos

- Sección **"Recursos"** con dos pestañas:
  - **Links y archivos:** etiqueta, descripción "qué es y cuándo mandarlo", link o archivo en R2.
  - **Audios:** **grabar desde el navegador** o subir, guardado en R2 y enviado como nota de voz.
- Marcar el **recurso de conversión** de cada agente (el cotizador o la derivación). Si un agente no tiene uno, se muestra un aviso.
- Carga inicial sugerida:
  - `@cotizador` (link de conversión);
  - PDFs de itinerarios de los 3 destacados;
  - `@politica-cancelacion`;
  - un audio de bienvenida de la asesora.

✅ **Aceptación:** el setter manda el recurso correcto según su descripción, y un audio llega como nota de voz.

### Fase 6 — Derivación, echoes, follow-ups y métricas del CRM

- **Aviso de derivación** a la asesora (email con el servicio que ya use el CRM, o plantilla de WhatsApp) con resumen, ficha y link al chat.
- **Pausa por echo** cuando la asesora responde desde el celular, salvo "responde siempre".
- **Follow-ups** con el especialista `seguimiento`, según `setter_seguimientos`:
  - dentro de 24 h, mensaje libre;
  - después, **plantillas aprobadas por Meta**;
  - tope de intentos y horario.
- **Sección Conversación:** el Cron escribe solo el registro del día (conversaciones, cotizadores enviados/derivados y calls si se cargan). La carga manual queda para corregir.
- **Agendas & Setteo:** filtro IA vs. humano.

✅ **Aceptación:**
- Un echo pausa la IA.
- Un chat enfriado recibe un follow-up (fuera de ventana, solo plantilla).
- La sección Conversación se llena sola.

### Fase 7 — Análisis y analíticas del setter

- **Análisis por chat** con Haiku, después de cada intercambio relevante y en el Cron:
  - intención inicial;
  - objeciones con su frase típica;
  - dolores, pedidos y señales de compra;
  - **preguntas sin responder**;
  - motivo de pérdida y etapa del corte;
  - tipo de lead;
  - próxima acción y prioridad.
- **Analíticas** (sección nueva o pestañas en Performance), replicando la sección 2.6 adaptada:
  - **Resumen:** leads, tasa de cotizador enviado, tasa de derivación → propuesta → ganado (cruzando con la etapa del CRM), respuesta de leads, **esperan a una persona**, embudo, **para retomar a mano**, por día, de dónde vienen.
  - **Por qué se pierden:** dónde mueren, por qué, qué los frena, objeciones con frase típica.
  - **Quién llega:** estados, tipos de lead, pain points, qué piden.
  - **Setter IA:** tiempos de respuesta, tasa de lectura, follow-ups contestados, mensajes por lead, IA apagada en leads abiertos, mensajes por día (IA/equipo/lead), señales de compra, **dónde se traban en el guion**.
  - **Avanzadas:** cohortes por origen, primera intención, **preguntas sin responder** (con botón "agregar a la base de conocimiento"), follow-ups por intento (1, 2, 3+).
- **Endpoint semanal** `/api/setter/semana` para el agente semanal de ventas.

✅ **Aceptación:** con conversaciones de prueba analizadas, cada bloque muestra datos reales, y "preguntas sin responder" lleva a la base de conocimiento.

### Fase 8 — Producción con coexistencia

- `<Bsp>Adapter`: firma, envío, plantillas y echoes.
- Checklist para la dueña: alta del número en coexistencia, decidir si se importa el historial, migraciones en remoto, secrets, deploy del Worker y de Pages, URL del webhook.
- **Monitoreo:** errores en `setter_eventos`, alerta si un chat queda más de X minutos sin respuesta con la IA activa, kill switch.

✅ **Aceptación:**
- Un mensaje real entra, la IA responde y la asesora ve todo en el celular.
- Si la asesora contesta desde el celular, la IA se calla.

### Fase 9 (opcional) — Conector MCP

- Un servidor MCP remoto del CRM, como Worker con auth por token, para preguntarle a Claude por los leads, las conversaciones y las métricas, y **editar prompts en borrador** desde Claude.

---

## 9. Pendientes (los resuelve la dueña)

- [ ] **Dónde está el código fuente del CRM** (carpeta o repo). En `lolognese-stack` no está.
- [ ] API key de Anthropic.
- [ ] App en Meta for Developers con WhatsApp (para desarrollar alcanza con el número de prueba).
- [ ] BSP para coexistencia en producción.
- [ ] **Prompt del jefe y misiones:** no hay nada escrito en SetterApp, así que se arma de cero. El asistente del editor ayuda, pero hace falta una primera versión de la oferta, el tono y los criterios de Sí / Masomenos / Curioso.
- [ ] Base de conocimiento inicial y qué precios o rangos se pueden decir.
- [ ] Recursos iniciales: link del cotizador, PDFs, audio de bienvenida.
- [ ] A quién se avisa al derivar y a qué etapa pasa el lead.

---

## 10. Reglas de WhatsApp a respetar en el código

- **Ventana de 24 h:** fuera de ella, solo plantillas aprobadas, que Meta cobra.
- **Webhooks idempotentes y rápidos:** el trabajo va en el Durable Object.
- **Solo APIs oficiales.**
- **Aviso de IA** encendido para leads europeos.
- **Datos personales:** las mismas protecciones del CRM, y borrado a pedido.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Romper datos reales de la D1 | Migraciones aditivas probadas en local; las aplica la dueña |
| La IA pisa datos de la asesora | Solo completa campos vacíos |
| La IA promete precios o cupos | Prohibidos en el prompt + base de conocimiento + derivación |
| La IA y la asesora contestan a la vez | Pausa por echo + turno único |
| Especialistas que se pasan el chat en bucle | Máximo 2 traspasos por turno; después responde el jefe |
| Prompt mal editado en producción | Borrador → playground → publicar, con historial para volver atrás |
| Coexistencia complicada | `ChannelAdapter` y plan B con el inbox del CRM |
| Costos de IA | Haiku para análisis y puntuación, historial recortado, tope mensual |
