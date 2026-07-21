// lib/server/invites/auth-email.ts — integração com o Supabase Auth
// nativo (M1-F S4-A2B, design §15/§16). Duas chamadas possíveis, nesta
// ordem fixa: inviteUserByEmail() (cria+envia, usuário novo) e, só quando
// o código estável de erro indicar conta já existente, signInWithOtp()
// com shouldCreateUser:false (nunca recria, usuário existente). A resposta
// ao chamador é sempre a mesma nos dois casos (design §20 — anti-
// enumeração): esta função não devolve qual caminho foi usado.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export type DeliveryErrorCode =
  | 'auth_email_failed'
  | 'auth_rate_limited'
  | 'auth_unavailable'
  | 'unexpected_delivery_error';

export type SendInviteEmailResult =
  | { ok: true }
  | { ok: false; errorCode: DeliveryErrorCode };

interface AuthErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
}

function asAuthErrorLike(error: unknown): AuthErrorLike | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  return error as AuthErrorLike;
}

// Classifica pelo `error.code`/`error.name`/`error.status` estáveis do
// GoTrue — nunca por `error.message` (texto livre, pode mudar sem aviso).
export function classifyAuthError(error: unknown): DeliveryErrorCode {
  const e = asAuthErrorLike(error);
  if (!e) {
    return 'unexpected_delivery_error';
  }

  // AuthRetryableFetchError: falha de transporte (rede/timeout) antes de
  // qualquer resposta do GoTrue — nunca confundir com falha reportada
  // pela API (auth_email_failed).
  if (e.name === 'AuthRetryableFetchError') {
    return 'auth_unavailable';
  }

  if (e.code === 'over_email_send_rate_limit' || e.status === 429) {
    return 'auth_rate_limited';
  }

  if (typeof e.code === 'string' || typeof e.status === 'number') {
    return 'auth_email_failed';
  }

  return 'unexpected_delivery_error';
}

export interface SendInviteEmailArgs {
  admin: SupabaseClient<Database>;
  anon: SupabaseClient<Database>;
  email: string;
  redirectTo: string;
  // Metadado opcional (nome do convidado) — só disponível no CREATE, cuja
  // requisição HTTP já traz `name`. O RESEND consulta a linha via RLS só
  // com id/company_id/email/status (design §17 passo 3, sem `name`), então
  // chama esta função sem esse argumento.
  name?: string;
}

// Tenta inviteUserByEmail (usuário novo); se o código estável indicar
// conta já existente ('email_exists'), cai para signInWithOtp (usuário
// existente, nunca recria, nunca senha temporária). Usado tanto pelo
// CREATE quanto pelo RESEND — mesmo fallback exato nos dois.
export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<SendInviteEmailResult> {
  const { admin, anon, email, redirectTo, name } = args;

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    ...(name !== undefined ? { data: { name } } : {}),
  });

  if (!error) {
    return { ok: true };
  }

  const e = asAuthErrorLike(error);
  if (e?.code === 'email_exists') {
    const { error: otpError } = await anon.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });

    if (!otpError) {
      return { ok: true };
    }

    return { ok: false, errorCode: classifyAuthError(otpError) };
  }

  return { ok: false, errorCode: classifyAuthError(error) };
}
