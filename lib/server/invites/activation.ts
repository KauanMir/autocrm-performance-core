// lib/server/invites/activation.ts — camada de serviço dos endpoints
// públicos de validação/aceite de convite (M1-F S4-C2A, freeze S4-C2 E0).
// Encapsula as 3 RPCs do S4-C1 (reserve_invite_validation_rate_limit,
// validate_invite_token, accept_invite) e a autenticação mínima do
// convidado — nenhuma delas grava nem loga token/hash bruto.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createUserScopedClient } from '@/lib/server/supabase/user-token-client';

// ── Autenticação mínima do convidado ────────────────────────────────────
// Deliberadamente separado de requireAuthenticatedActor()
// (lib/server/invites/http.ts, usado por create/resend): aquele helper é
// chamado sempre por um administrador com profile já existente — nada ali
// consulta profiles, mas o nome do campo devolvido (`profileId`) carrega
// essa suposição semântica. O convidado que aceita um convite pode
// legitimamente ainda não ter nenhuma linha em profiles (accept_invite()
// no banco decide tudo isso via auth.uid(), nunca por um parâmetro vindo
// daqui) — por isso este helper devolve só o id do usuário Auth, sem
// nenhuma consulta a profiles/membership/platform_role.
export interface AuthenticatedUser {
  id: string;
}

export type AuthenticatedUserResult =
  | { ok: true; user: AuthenticatedUser; client: SupabaseClient<Database>; jwt: string }
  | { ok: false };

const BEARER_PATTERN = /^Bearer (.+)$/;

export async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUserResult> {
  const header = request.headers.get('authorization');
  if (!header) {
    return { ok: false };
  }

  const match = BEARER_PATTERN.exec(header);
  if (!match) {
    return { ok: false };
  }

  const jwt = match[1].trim();
  if (!jwt) {
    return { ok: false };
  }

  const client = createUserScopedClient(jwt);
  const { data, error } = await client.auth.getUser(jwt);

  if (error || !data?.user) {
    return { ok: false };
  }

  return { ok: true, user: { id: data.user.id }, client, jwt };
}

// ── validate_invite_token ────────────────────────────────────────────────
export type ValidateInviteOutcome =
  | { outcome: 'rate_limited'; retryAfterSeconds: number }
  | { outcome: 'checked'; valid: boolean; code: string; maskedEmail: string | null }
  | { outcome: 'error' };

export interface ValidateInviteArgs {
  admin: SupabaseClient<Database>;
  ipHash: string;
  tokenHash: string;
}

// Extrai a única linha esperada de um retorno RETURNS TABLE (RPC de linha
// única) — falha fechado (null) se vier vazio OU com mais de uma linha,
// nunca assume [0] de um array de tamanho inesperado.
function singleRow<T>(data: T[] | null): T | null {
  if (!Array.isArray(data) || data.length !== 1) {
    return null;
  }
  return data[0];
}

const ROLE_KINDS = new Set(['super_admin', 'manager', 'seller']);

// Ordem fixa: reserva o rate limit ANTES de validar — nunca o inverso
// (validate_invite_token nunca é chamado sem reserva bem-sucedida antes).
export async function validateInvite(args: ValidateInviteArgs): Promise<ValidateInviteOutcome> {
  const { admin, ipHash, tokenHash } = args;

  const { data: rlData, error: rlError } = await admin.rpc('reserve_invite_validation_rate_limit', {
    p_ip_hash: ipHash,
    p_token_hash: tokenHash,
  });

  if (rlError) {
    return { outcome: 'error' };
  }

  const rl = singleRow(rlData);
  if (!rl || typeof rl.allowed !== 'boolean') {
    return { outcome: 'error' };
  }

  if (!rl.allowed) {
    const retryAfterSeconds = Number.isInteger(rl.retry_after_seconds) && (rl.retry_after_seconds as number) > 0
      ? (rl.retry_after_seconds as number)
      : 60;
    return { outcome: 'rate_limited', retryAfterSeconds };
  }

  const { data: vData, error: vError } = await admin.rpc('validate_invite_token', {
    p_token_hash: tokenHash,
  });

  if (vError) {
    return { outcome: 'error' };
  }

  const v = singleRow(vData);
  if (!v || typeof v.valid !== 'boolean' || typeof v.code !== 'string') {
    return { outcome: 'error' };
  }

  if (v.valid && typeof v.masked_email !== 'string') {
    // valid=true sem masked_email utilizável é uma forma inesperada da
    // RPC — falha fechado em vez de devolver algo que não é uma string.
    return { outcome: 'error' };
  }

  return {
    outcome: 'checked',
    valid: v.valid,
    code: v.code,
    maskedEmail: v.valid ? v.masked_email : null,
  };
}

// ── accept_invite ─────────────────────────────────────────────────────────
export type AcceptInviteOutcome =
  | {
      outcome: 'checked';
      success: boolean;
      code: string;
      roleKind: Database['public']['Enums']['invite_role_kind'] | null;
      retryAfterSeconds: number | null;
    }
  | { outcome: 'error' };

export interface AcceptInviteArgs {
  userClient: SupabaseClient<Database>;
  tokenHash: string;
}

// Sempre com o cliente escopado pelo JWT do chamador (auth.uid() dentro da
// RPC) — nunca com o cliente admin/service_role, que não tem EXECUTE
// concedido em accept_invite() (a migration só concede a `authenticated`).
export async function acceptInvite(args: AcceptInviteArgs): Promise<AcceptInviteOutcome> {
  const { userClient, tokenHash } = args;

  const { data, error } = await userClient.rpc('accept_invite', { p_token_hash: tokenHash });

  if (error) {
    return { outcome: 'error' };
  }

  const row = singleRow(data);
  if (!row || typeof row.success !== 'boolean' || typeof row.code !== 'string') {
    return { outcome: 'error' };
  }

  // success=true SEM role_kind utilizável é uma forma inesperada da RPC
  // (o domínio garante role_kind preenchido em todo sucesso) — falha
  // fechado em vez de devolver um valor fora do catálogo/nulo indevido.
  if (row.success && !ROLE_KINDS.has(row.role_kind as string)) {
    return { outcome: 'error' };
  }

  const rawRetryAfter = row.retry_after_seconds;
  const retryAfterSeconds = row.code === 'rate_limited'
    ? (Number.isInteger(rawRetryAfter) && (rawRetryAfter as number) > 0 ? (rawRetryAfter as number) : 60)
    : null;

  return {
    outcome: 'checked',
    success: row.success,
    code: row.code,
    roleKind: row.success ? row.role_kind : null,
    retryAfterSeconds,
  };
}
