# Probar el setter con WhatsApp de verdad

Estado al 29/10: Fases 1 a 7 hechas y probadas en local con Claude real (Haiku). Falta que WhatsApp le avise al Worker de los mensajes que entran: Meta necesita una URL pública para el webhook.

## 1. Token permanente de Meta (el que tienes vence hoy)

1. business.facebook.com › Configuración del negocio › **Usuarios del sistema** › Agregar (rol Administrador).
2. En ese usuario: **Asignar activos** › tu app y tu cuenta de WhatsApp, con control total.
3. **Generar token** › elige la app › permisos `whatsapp_business_messaging` y `whatsapp_business_management` › caducidad **Nunca**.
4. Pega el token en `setter-worker/.dev.vars` como `META_ACCESS_TOKEN=` (reemplaza el temporal).

## 2. Tu celular como destinatario

El número de prueba (+1 555 641 4203) solo puede escribir a números verificados.
developers.facebook.com › tu app › WhatsApp › **Configuración de la API** › "Para" › Administrar lista › agrega tu celular y confirma el código.

## 3. URL pública: elige una

**A. Túnel temporal (lo más rápido, sin deploy ni cuenta de Cloudflare) — recomendado para la primera prueba**

Atajo: desde `plantilla-crm\setter-worker`, un solo comando hace los pasos 1 a 3 (instala cloudflared si falta, avisa si el token de Meta venció, levanta el Worker y el túnel, e imprime la URL y el token de verificación para pegar en Meta):
```bash
powershell -ExecutionPolicy Bypass -File probar-real.ps1
```

1. Instala cloudflared (una vez):
   ```bash
   winget install --id Cloudflare.cloudflared
   ```
2. Levanta el Worker local (en `plantilla-crm/setter-worker`):
   ```bash
   npm run dev -- --port 8790
   ```
3. En otra terminal, abre el túnel y copia la URL `https://….trycloudflare.com` que imprime:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8790
   ```
   La URL cambia cada vez que abres el túnel: hay que volver a cargarla en Meta.

**B. Deploy del Worker (queda fijo; no pide tarjeta: Workers, Durable Objects y D1 son gratis)**

1. Pon wrangler en la cuenta de Cloudflare de `crm-plantilla` (hoy está en otra):
   ```bash
   npx wrangler whoami
   ```
   Si no es esa cuenta:
   ```bash
   npx wrangler login
   ```
2. Aplica en la D1 remota, en este orden (solo agregan tablas y columnas):
   ```bash
   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-039-setter.sql
   ```
   ```bash
   npx wrangler d1 execute crm-plantilla --remote --file crm/migracion-040-setter-archivos.sql
   ```
   ```bash
   npx wrangler d1 execute crm-plantilla --remote --file crm/seed-setter-luna-llena.sql
   ```
3. Deploya el Worker (desde `setter-worker`):
   ```bash
   npx wrangler deploy
   ```
   La URL queda `https://setter-worker.<tu-subdominio>.workers.dev`.
4. Carga los secrets (cada comando pide el valor):
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
   Repite con `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` y `SETTER_INTERNAL_SECRET`. Opcional para el mail de derivación: `RESEND_API_KEY` y `AVISO_EMAIL`.
5. El mismo `SETTER_INTERNAL_SECRET` va en Pages:
   ```bash
   npx wrangler pages secret put SETTER_INTERNAL_SECRET --project-name crm-plantilla
   ```
6. Deploya el CRM con `deploy-demo.py` (con los flags de Luna Llena, como siempre). Siempre **después** del Worker: el panel lo usa por Service Binding.

## 4. Webhook en Meta

developers.facebook.com › tu app › WhatsApp › **Configuración** › Webhook › Editar:
- URL de devolución de llamada: `https://<la URL del paso 3>/webhook`
- Token de verificación: el mismo `META_VERIFY_TOKEN` del `.dev.vars` / secret.
- Verificar y guardar. Después, en "Campos de webhook", suscribe **messages**.

## 5. Prueba

1. Desde tu celular, escribe al número de prueba: "Hola, somos 2 y queremos ir a Machu Picchu en marzo".
2. Con `SETTER_DEMORA=instante` (solo local) responde en unos segundos; en producción espera la demora humana (hasta ~3 min el primer mensaje).
3. Mira el chat en el Inbox del CRM (`#/inbox`). Si probaste en local, abre `http://127.0.0.1:8791/panel-4c1f6a#/inbox` con el panel local levantado.
4. Si algo no responde: tabla `setter_eventos` (tipo `turno`, `error_claude`, `error_envio`…).

## Lo que queda

- **Modelo:** para probar quedó Haiku 5.5 con tope de 300 respuestas por mes. Antes de atender clientes reales, Setter IA › Ajustes › Sonnet 5.5.
- **Prompts:** son un borrador. El del jefe ya se ajustó para que traspase a `calificacion` apenas aparece un viaje (probado con Haiku). Seguir afinándolos con el Asistente y el Probar de Setter IA.
- **Follow-up de 72 h:** necesita una plantilla aprobada por Meta; cargar su nombre en `setter_seguimientos` (id 3) y activarla.
- **Fase 8:** pasar el número real de Luna Llena a coexistencia (app WhatsApp Business + API) por un BSP, y su adaptador.
- **Notas de voz en local:** no se transcriben (Workers AI no anda con wrangler en otra cuenta). En producción sí.
