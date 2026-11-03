// lib/server/whatsapp-webhook/env.ts — leitura/validação das variáveis
// server-only do webhook oficial da WhatsApp Cloud API. Mesmo padrão de
// lib/server/meta-webhook/env.ts: NUNCA prefixar NEXT_PUBLIC_, NUNCA
// importado por código client-side, NUNCA expõe o valor em erro/log (só o
// nome da variável ausente/vazia). Módulo isolado: só o Route Handler de
// /api/webhooks/whatsapp importa lib/server/whatsapp-webhook/*.

export type WhatsAppWebhookEnvName = 'WHATSAPP_WEBHOOK_VERIFY_TOKEN' | 'META_APP_SECRET';

export class MissingWhatsAppWebhookEnvError extends Error {
  constructor(public readonly variableName: WhatsAppWebhookEnvName) {
    // Mensagem contém só o NOME da variável, nunca o valor recebido.
    super(`${variableName}_missing`);
    this.name = 'MissingWhatsAppWebhookEnvError';
  }
}

function readNonEmpty(name: WhatsAppWebhookEnvName): string {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new MissingWhatsAppWebhookEnvError(name);
  }
  return raw;
}

// Token combinado no painel do Meta for Developers (WhatsApp >
// Configuração > Webhook) e reenviado em hub.verify_token no handshake do
// GET. PRÓPRIO do WhatsApp — distinto de META_WEBHOOK_VERIFY_TOKEN (Lead
// Ads), para que rotacionar um não derrube o outro. Comparado em tempo
// constante; nunca devolvido, nunca logado.
export function getWhatsAppWebhookVerifyToken(): string {
  return readNonEmpty('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
}

// App Secret do app Meta "KAPA CRM". O produto WhatsApp foi adicionado ao
// MESMO app, e a Meta assina os webhooks de WhatsApp com o App Secret do app
// (X-Hub-Signature-256, mesmo mecanismo do Lead Ads). Por isso é a MESMA
// credencial já usada em /api/webhooks/meta — nenhum segredo novo.
export function getWhatsAppAppSecret(): string {
  return readNonEmpty('META_APP_SECRET');
}
