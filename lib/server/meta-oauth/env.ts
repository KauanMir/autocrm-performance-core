// lib/server/meta-oauth/env.ts — leitura/validação da variável server-only
// que assina o parâmetro OAuth `state` do "Login do Facebook para
// Empresas". Mesmo molde de lib/server/env.ts / lib/server/meta-webhook/
// env.ts: NUNCA prefixar NEXT_PUBLIC_, NUNCA importado por código
// client-side, NUNCA expõe o valor em erro/log (só o nome da variável).
//
// META_OAUTH_STATE_SECRET é uma chave HMAC INTERNA do CRM, dedicada só a
// este fim. NÃO é META_APP_SECRET (credencial da Meta) e NÃO é
// INVITE_RATE_LIMIT_PEPPER (hash de IP de convite) — domínios de
// confiança/rotação distintos.

export class InvalidMetaOAuthStateSecretError extends Error {
  constructor() {
    // Mensagem contém só o nome da variável, nunca o valor recebido.
    super('meta_oauth_state_secret_invalid');
    this.name = 'InvalidMetaOAuthStateSecretError';
  }
}

// Exatamente 32 bytes em hex minúsculo (64 caracteres) — mesmo formato de
// INVITE_RATE_LIMIT_PEPPER. Gere com: openssl rand -hex 32
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

export function getMetaOAuthStateSecret(): Buffer {
  const raw = process.env.META_OAUTH_STATE_SECRET;
  if (!raw || !SECRET_PATTERN.test(raw)) {
    throw new InvalidMetaOAuthStateSecretError();
  }
  return Buffer.from(raw, 'hex');
}

// META_APP_ID — identificador PÚBLICO do app Meta (aparece na URL de
// autorização OAuth e no client-side de qualquer SDK da Meta). NÃO é
// segredo como META_APP_SECRET, mas fica server-side nesta fase para
// manter a configuração organizada e o /start fail-closed sem ele.
// Formato: sequência de dígitos (o App ID numérico da Meta).
export class MissingMetaAppIdError extends Error {
  constructor() {
    super('meta_app_id_missing');
    this.name = 'MissingMetaAppIdError';
  }
}

// META_APP_SECRET — App Secret do app Meta. EXTREMAMENTE SENSÍVEL:
// credencial de autenticação com a Meta. É a MESMA variável já usada em
// Production pelo webhook (lib/server/meta-webhook) — aqui serve como
// `client_secret` da troca OAuth `code` -> access token; reutilizá-la é
// correto (é exatamente uma operação de autenticação com a Meta), NÃO se
// cria outro segredo. server-only, NUNCA NEXT_PUBLIC_, NUNCA devolvida
// pela API, NUNCA logada. Fail closed se ausente/vazia. Mantida aqui (e
// não importada de meta-webhook) para preservar o isolamento entre os
// dois módulos — cada um lê seu próprio env.
export class MissingMetaAppSecretError extends Error {
  constructor() {
    super('meta_app_secret_missing');
    this.name = 'MissingMetaAppSecretError';
  }
}

export function getMetaAppSecret(): string {
  const raw = process.env.META_APP_SECRET;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new MissingMetaAppSecretError();
  }
  return raw;
}

const APP_ID_PATTERN = /^[0-9]{1,32}$/;

export function getMetaAppId(): string {
  const raw = process.env.META_APP_ID;
  if (!raw || !APP_ID_PATTERN.test(raw.trim())) {
    throw new MissingMetaAppIdError();
  }
  return raw.trim();
}

// META_LOGIN_CONFIG_ID — ID da Configuration do "Login do Facebook para
// Empresas" (Facebook Login for Business), criada manualmente no painel
// Meta (App Dashboard > Facebook Login for Business > Configurations).
// No fluxo ATUAL da Meta, `config_id` SUBSTITUI `scope` na URL de
// autorização: as permissões são definidas DENTRO da Configuration, não
// na URL. Identificador numérico PÚBLICO (aparece na URL de autorização)
// — NÃO é segredo, mas fica server-side. /start falha fechado sem ele.
export class MissingMetaLoginConfigIdError extends Error {
  constructor() {
    super('meta_login_config_id_missing');
    this.name = 'MissingMetaLoginConfigIdError';
  }
}

const CONFIG_ID_PATTERN = /^[0-9]{1,32}$/;

export function getMetaLoginConfigId(): string {
  const raw = process.env.META_LOGIN_CONFIG_ID;
  if (!raw || !CONFIG_ID_PATTERN.test(raw.trim())) {
    throw new MissingMetaLoginConfigIdError();
  }
  return raw.trim();
}

// META_GRAPH_API_VERSION — OPCIONAL. A Meta versiona a Graph API
// trimestralmente; deixar como env permite acompanhar sem mudar código.
// Se ausente/mal formada, cai no default de lib/server/meta-oauth/config.ts
// (DEFAULT_GRAPH_API_VERSION). Formato: "v<major>.<minor>", ex.: v21.0.
const GRAPH_VERSION_PATTERN = /^v[0-9]{1,3}\.[0-9]{1,3}$/;

export function getMetaGraphApiVersionOverride(): string | null {
  const raw = process.env.META_GRAPH_API_VERSION;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return GRAPH_VERSION_PATTERN.test(trimmed) ? trimmed : null;
}
