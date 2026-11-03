// Contrato de un canal de mensajería. Todo el resto del setter habla con esto,
// nunca con Meta o el BSP directo: así pasar del número de prueba (Cloud API)
// al número real en coexistencia (BSP, Fase 8) es cambiar de adaptador.
//
// interface ChannelAdapter {
//   verifyWebhook(req): Response | null          // handshake GET; null = no es un handshake válido
//   validateSignature(req, rawBody): Promise<boolean>
//   parseInbound(body): InboundEvent[]
//   sendText(to, text): Promise<SentRef>
//   sendMedia(to, media: MediaRef): Promise<SentRef>
//   sendTemplate(to, name, lang, params): Promise<SentRef>
//   markRead(messageId, { escribiendo }): Promise<void>
//   downloadMedia(mediaId): Promise<Response>   // el archivo, para hacer stream
//   uploadMedia(bytes, mime, nombre): Promise<string>   // media_id para mandar después
// }
//
// InboundEvent (uno de):
//   { tipo: 'mensaje', waId, nombre, providerId, en, msgTipo, texto, mediaId, mime, referral }
//   { tipo: 'echo',    waId, providerId, en, msgTipo, texto, mediaId, mime }   // lo mandó la asesora desde el celular
//   { tipo: 'estado',  providerId, waId, estado, en, error }                  // sent | delivered | read | failed
//
// MediaRef: { tipo: 'audio' | 'image' | 'document' | 'video', id?, link?, caption?, filename? }
// SentRef:  { providerId }

import { MetaCloudAdapter } from './meta.js';
import { KapsoAdapter } from './kapso.js';

// Con KAPSO_API_KEY el canal es Kapso (número real en coexistencia); sin ella,
// la Cloud API de Meta directo.
export function canalDe(env) {
  return env.KAPSO_API_KEY ? new KapsoAdapter(env) : new MetaCloudAdapter(env);
}
