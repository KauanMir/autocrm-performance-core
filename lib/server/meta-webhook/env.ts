// lib/server/meta-webhook/env.ts — leitura/validação das variáveis
// server-only da integração Meta (webhook oficial). Espelha o padrão de
// lib/server/env.ts: NUNCA prefixar NEXT_PUBLIC_, NUNCA importado por
// código client-side, NUNCA expõe o valor em erro/log (só o nome da
// variável ausente/vazia). Módulo isolado: nada além do Route Handler de
// /api/webhooks/meta importa lib/server/meta-webhook/*.

export type MetaWebhookEnvName = 'META_WEBHOOK_VERIFY_TOKEN' | 'META_APP_SECRET';

export class MissingMetaWebhookEnvError extends Error {
  constructor(public readonly variableName: MetaWebhookEnvName) {
    // Mensagem contém só o NOME da variável, nunca o valor recebido.
    super(`${variableName}_missing`);
    this.name = 'MissingMetaWebhookEnvError';
  }
}

function readNonEmpty(name: MetaWebhookEnvName): string {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new MissingMetaWebhookEnvError(name);
  }
  return raw;
}

// Token combinado no painel do Meta for Developers e reenviado em
// hub.verify_token durante o handshake do GET. Comparado em tempo
// constante no Route Handler — nunca devolvido na resposta, nunca logado.
export function getMetaWebhookVerifyToken(): string {
  return readNonEmpty('META_WEBHOOK_VERIFY_TOKEN');
}

// App Secret do app Meta. Extremamente sensível: é a chave HMAC do
// X-Hub-Signature-256. Nunca devolvido pela API, nunca logado, nunca
// client-side, nunca com prefixo NEXT_PUBLIC_.
export function getMetaAppSecret(): string {
  return readNonEmpty('META_APP_SECRET');
}
