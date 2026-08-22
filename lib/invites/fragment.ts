// lib/invites/fragment.ts — parser puro dos parâmetros de aceite de convite
// (M1-F S4-C2B; VERCEL-INVITES-S1-R1 — contrato primário passou de
// fragmento para query string, ver lib/server/invites/token.ts). Nunca toca
// window/document diretamente — recebe a string já lida pelo chamador.
// Nenhuma normalização silenciosa: qualquer forma inesperada é rejeitada,
// nunca corrigida.
export type InviteAuthType = 'invite' | 'magiclink';

export interface ParsedInviteFragment {
  inviteToken: string;
  authTokenHash: string;
  authType: InviteAuthType;
}

export type ParseFragmentResult =
  | { ok: true; value: ParsedInviteFragment }
  | { ok: false };

const REQUIRED_KEYS = ['invite_token', 'auth_token_hash', 'auth_type'] as const;

// Mesmo formato de generateInviteToken() (lib/server/invites/token.ts):
// 43 caracteres base64url, sem padding.
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// auth_token_hash: ASCII imprimível seguro (0x21–0x7e, sem espaço/controle),
// comprimento máximo defensivo — nunca um formato mais restrito do que o
// comprovado pelo Supabase instalado (ex.: hex-only), só uma faixa segura.
const AUTH_TOKEN_HASH_PATTERN = /^[\x21-\x7e]+$/;
const MAX_AUTH_TOKEN_HASH_LENGTH = 512;

// Limite defensivo do corpo inteiro antes de qualquer parsing — nenhuma
// materialização/processamento proporcional a uma entrada hostil gigante.
const MAX_PARAMS_LENGTH = 4096;

// Núcleo único de validação — usado tanto pelo parser de query string
// (primário) quanto pelo de fragmento (fallback legado). Nenhuma regra de
// negócio duplicada entre os dois: só a remoção do marcador inicial
// ('?' ou '#') difere entre os chamadores.
function validateInviteParams(body: string): ParseFragmentResult {
  if (body.length === 0) {
    return { ok: false };
  }
  if (body.length > MAX_PARAMS_LENGTH) {
    return { ok: false };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return { ok: false };
  }

  const seenKeys = new Set<string>();
  for (const key of params.keys()) {
    seenKeys.add(key);
  }

  // chave inesperada — whitelist fechada
  for (const key of seenKeys) {
    if (!(REQUIRED_KEYS as readonly string[]).includes(key)) {
      return { ok: false };
    }
  }

  // campo ausente ou duplicado — exatamente uma ocorrência de cada
  for (const key of REQUIRED_KEYS) {
    if (params.getAll(key).length !== 1) {
      return { ok: false };
    }
  }

  const rawInviteToken = params.get('invite_token') ?? '';
  const rawAuthTokenHash = params.get('auth_token_hash') ?? '';
  const rawAuthType = params.get('auth_type') ?? '';

  if (!RAW_TOKEN_PATTERN.test(rawInviteToken)) {
    return { ok: false };
  }

  if (rawAuthType !== 'invite' && rawAuthType !== 'magiclink') {
    return { ok: false };
  }

  if (
    rawAuthTokenHash.length === 0 ||
    rawAuthTokenHash.length > MAX_AUTH_TOKEN_HASH_LENGTH ||
    !AUTH_TOKEN_HASH_PATTERN.test(rawAuthTokenHash)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      inviteToken: rawInviteToken,
      authTokenHash: rawAuthTokenHash,
      authType: rawAuthType,
    },
  };
}

// Parser PRIMÁRIO (VERCEL-INVITES-S1-R1) — location.search real do link de
// convite atual. Aceita tanto "?..." quanto já sem o "?".
export function parseInviteQuery(search: string): ParseFragmentResult {
  if (typeof search !== 'string') {
    return { ok: false };
  }

  const body = search.startsWith('?') ? search.slice(1) : search;
  // Um '?' ou '#' embutido no restante é sempre malformado (nunca duas
  // query strings concatenadas nem uma query com fragmento dentro).
  if (body.includes('?') || body.includes('#')) {
    return { ok: false };
  }

  return validateInviteParams(body);
}

// Parser LEGADO (mantido como fallback de baixo churn — links antigos já
// enviados antes do VERCEL-INVITES-S1-R1 continuam usando fragmento).
// Comportamento inalterado desde M1-F S4-C2B.
export function parseInviteFragment(hash: string): ParseFragmentResult {
  if (typeof hash !== 'string') {
    return { ok: false };
  }

  // Aceita tanto "#..." quanto já sem o "#" — remove só o PRIMEIRO
  // caractere se for '#'. Um segundo '#' no restante é sempre malformado
  // (nunca dois fragmentos concatenados/fragmento dentro de fragmento).
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body.includes('#')) {
    return { ok: false };
  }

  return validateInviteParams(body);
}

// Ponto de entrada único do fluxo de aceite (AcceptInviteFlow): tenta a
// query string (contrato atual) e só cai para o fragmento (contrato legado)
// se a query não trouxer um resultado válido.
export function resolveInviteLinkParams(input: { search: string; hash: string }): ParseFragmentResult {
  const fromQuery = parseInviteQuery(input.search);
  if (fromQuery.ok) {
    return fromQuery;
  }
  return parseInviteFragment(input.hash);
}
