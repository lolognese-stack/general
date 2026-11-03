// Adaptador de Kapso (BSP) para el número en coexistencia (Fase 8). Kapso
// reenvía el payload crudo de Meta (webhook kind "meta") y expone la misma
// Cloud API en api.kapso.ai/meta/whatsapp, así que todo sale del adaptador de
// Meta salvo la autenticación, la firma y la bajada de medios.
// Contrato en adapter.js.

import { MetaCloudAdapter, firmaHmac, iguales } from './meta.js';

export class KapsoAdapter extends MetaCloudAdapter {
  constructor(env) {
    super(env);
    this.nombre = 'Kapso';
    this.raiz = `https://api.kapso.ai/meta/whatsapp/${env.META_GRAPH_VERSION || 'v24.0'}`;
    this.base = `${this.raiz}/${env.META_PHONE_NUMBER_ID}`;
  }

  auth() {
    return { 'x-api-key': this.env.KAPSO_API_KEY };
  }

  // Kapso no hace el handshake GET de Meta: el webhook se da de alta por su API.
  verifyWebhook() {
    return null;
  }

  // HMAC-SHA256 en hex del cuerpo crudo, sin el prefijo "sha256=".
  async validateSignature(req, raw) {
    const header = (req.headers.get('x-webhook-signature') || '').toLowerCase();
    if (!this.env.KAPSO_WEBHOOK_SECRET || !header) return false;
    return iguales(header, await firmaHmac(this.env.KAPSO_WEBHOOK_SECRET, raw));
  }

  // El id da un download_url de pocos minutos con la autenticación adentro.
  async downloadMedia(mediaId) {
    const r = await fetch(`${this.raiz}/${encodeURIComponent(mediaId)}?phone_number_id=${this.env.META_PHONE_NUMBER_ID}`, { headers: this.auth() });
    const info = await r.json().catch(() => ({}));
    const url = info.download_url || info.url;
    if (!r.ok || !url) throw new Error(`Kapso ${r.status}: ${info.error?.message || info.error || 'media no disponible'}`);
    const archivo = await fetch(url);
    if (!archivo.ok) throw new Error(`Kapso ${archivo.status}: no se pudo bajar el archivo`);
    return archivo;
  }
}
