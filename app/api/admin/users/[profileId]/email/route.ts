// app/api/admin/users/[profileId]/email/route.ts — Route Handler
// server-side de alteração administrativa de e-mail (M1-F S5-E1-A, design
// §22.7, decisões congeladas do S5-E0). Único caminho de escrita em
// auth.users.email — sempre via createAdminClient().auth.admin.
// updateUserById(), nunca SQL direto. Sequência obrigatória: Auth primeiro,
// profiles depois (commit_profile_email_update, chamado como o ATOR real
// via cliente escopado pelo JWT) — se profiles falhar, tenta compensar
// revertendo o Auth para o e-mail anterior.
//
// Decisões congeladas: só Super Admin ativo; nunca o próprio e-mail; nunca
// outro Super Admin; divergência pré-existente entre profiles.email e
// auth.users.email falha com user_email_state_conflict (nunca reconcilia
// silenciosamente); email_confirm=true; nenhuma revogação de sessão (S6);
// nenhum e-mail completo em log/auditoria.
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { requireAuthenticatedActor, readJsonObjectBody, isOriginAllowed, isValidUuid, jsonResponse } from '@/lib/server/invites/http';
import { getAppUrl, InvalidAppUrlError } from '@/lib/server/env';
import { statusForCode, type UserEmailErrorCode } from '@/lib/server/users/errors';
import { logUserEmailEvent, logUserEmailAlert } from '@/lib/server/users/logger';

export const runtime = 'nodejs';

const ALLOWED_BODY_KEYS = ['email'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;

function errorResponse(code: UserEmailErrorCode): Response {
  return jsonResponse(statusForCode(code), { success: false, code });
}

// Trim + lowercase (mesmo critério de profiles_email_idx, que é sobre
// lower(email)) + validação de formato — nunca aceita espaço interno,
// caractere de controle, string vazia ou acima de 254 caracteres. Mesmo
// EMAIL_PATTERN já usado em lib/hooks/useCreateInvite.ts (frontend).
function normalizeAndValidateEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (CONTROL_CHAR_PATTERN.test(value)) return null;

  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_EMAIL_LENGTH) return null;
  if (/\s/.test(trimmed)) return null;

  const normalized = trimmed.toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) return null;

  return normalized;
}

export async function POST(
  request: Request,
  { params }: { params: { profileId: string } },
): Promise<Response> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let appUrl: URL;
  try {
    appUrl = getAppUrl();
  } catch (error) {
    if (error instanceof InvalidAppUrlError) {
      logUserEmailAlert('app_url_invalid', { requestId });
      return errorResponse('internal_error');
    }
    throw error;
  }

  if (!isOriginAllowed(request, appUrl)) {
    return errorResponse('invalid_origin');
  }

  if (!isValidUuid(params.profileId)) {
    return errorResponse('user_not_found');
  }
  const targetProfileId = params.profileId;

  const bodyResult = await readJsonObjectBody(request, ALLOWED_BODY_KEYS);
  if (bodyResult.ok === false) {
    return errorResponse(bodyResult.error === 'body_too_large' ? 'body_too_large' : 'invalid_body');
  }

  const newEmail = normalizeAndValidateEmail(bodyResult.value.email);
  if (newEmail === null) {
    return errorResponse('invalid_email');
  }

  const actorResult = await requireAuthenticatedActor(request);
  if (actorResult.ok === false) {
    return errorResponse('unauthenticated');
  }
  const { actor, client: userClient } = actorResult;

  // decisão congelada #2: nunca o próprio e-mail por este fluxo — checagem
  // barata, antes de qualquer chamada de rede adicional.
  if (targetProfileId === actor.profileId) {
    return errorResponse('forbidden');
  }

  // is_platform_super_admin() já verifica profile ativo internamente
  // (mesmo helper usado por list_company_users/update_membership_role) —
  // nunca profiles.role/company_id, nunca selectedCompanyId.
  const { data: isSuperAdmin, error: superAdminError } = await userClient.rpc('is_platform_super_admin');
  if (superAdminError || !isSuperAdmin) {
    return errorResponse('forbidden');
  }

  const admin = createAdminClient();

  // service_role NÃO tem GRANT direto de SELECT em profiles/company_
  // memberships/companies neste projeto (confirmado empiricamente) — toda
  // leitura passa por get_profile_email_update_state (SECURITY DEFINER,
  // EXECUTE restrito a service_role), nunca um .from() direto.
  const { data: profileState, error: profileStateError } = await admin.rpc('get_profile_email_update_state', {
    p_target_profile_id: targetProfileId,
    p_new_email: newEmail,
  });

  if (profileStateError) {
    logUserEmailAlert('profile_state_lookup_failed', { requestId, targetProfileId });
    return errorResponse('internal_error');
  }

  const profileStateRow = Array.isArray(profileState) ? profileState[0] : profileState;
  if (!profileStateRow || !profileStateRow.profile_exists) {
    return errorResponse('user_not_found');
  }

  // decisão congelada: outro Super Admin nunca é alvo por este fluxo.
  if (profileStateRow.platform_role === 'super_admin') {
    return errorResponse('forbidden');
  }

  if (!profileStateRow.company_id || !profileStateRow.membership_is_active) {
    return errorResponse('user_not_found');
  }

  if (!profileStateRow.profile_is_active || profileStateRow.company_status === 'cancelada') {
    return errorResponse('user_inactive');
  }

  const companyId = profileStateRow.company_id;

  const currentProfileEmail = normalizeAndValidateEmail(profileStateRow.current_email);
  if (currentProfileEmail === null) {
    logUserEmailAlert('target_profile_email_invalid_shape', { requestId, targetProfileId });
    return errorResponse('internal_error');
  }

  // consulta estreita server-only (get_auth_email_update_state,
  // EXECUTE restrito a service_role) — nunca listUsers(), nunca busca por
  // e-mail que permita enumeração.
  const { data: authState, error: authStateError } = await admin.rpc('get_auth_email_update_state', {
    p_target_user_id: targetProfileId,
    p_new_email: newEmail,
  });

  if (authStateError) {
    logUserEmailAlert('auth_state_lookup_failed', { requestId, targetProfileId });
    return errorResponse('internal_error');
  }

  const stateRow = Array.isArray(authState) ? authState[0] : authState;
  if (!stateRow || typeof stateRow.current_email !== 'string') {
    return errorResponse('user_not_found');
  }

  const currentAuthEmail = normalizeAndValidateEmail(stateRow.current_email);
  if (currentAuthEmail === null) {
    logUserEmailAlert('auth_email_invalid_shape', { requestId, targetProfileId });
    return errorResponse('internal_error');
  }

  // decisão congelada #7/#8: divergência pré-existente nunca é reconciliada
  // silenciosamente — falha fechado.
  if (currentProfileEmail !== currentAuthEmail) {
    return errorResponse('user_email_state_conflict');
  }

  // idempotência: já é o valor final desejado nos dois lados — sucesso
  // sem escrita, sem chamar o Auth, sem auditoria.
  if (currentProfileEmail === newEmail) {
    logUserEmailEvent({
      requestId,
      operation: 'update_email',
      result: 'idempotent',
      actorProfileId: actor.profileId,
      targetProfileId,
      companyId,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(200, { profileId: targetProfileId, email: newEmail });
  }

  // conflito verificado dos dois lados por RPC estreita (nunca .from()
  // direto — service_role não tem GRANT nessas tabelas neste projeto):
  // stateRow.new_email_in_use (auth.users) já consultado acima;
  // profileStateRow.new_email_in_use (profiles) veio junto da mesma
  // chamada que trouxe o e-mail atual — nenhum round-trip extra.
  if (stateRow.new_email_in_use || profileStateRow.new_email_in_use) {
    return errorResponse('email_already_in_use');
  }

  // ── sequência obrigatória: Auth primeiro, profiles depois ──────────────
  const authUpdate = await admin.auth.admin.updateUserById(targetProfileId, {
    email: newEmail,
    email_confirm: true,
  });

  if (authUpdate.error) {
    logUserEmailEvent({
      requestId,
      operation: 'update_email',
      result: 'auth_failed',
      actorProfileId: actor.profileId,
      targetProfileId,
      companyId: companyId,
      durationMs: Date.now() - startedAt,
      code: 'email_update_failed',
    });
    return errorResponse('email_update_failed');
  }

  // commit_profile_email_update chamado COMO O ATOR real (userClient,
  // auth.uid() = actor.profileId) — nunca via admin/service_role, para que
  // a própria RPC revalide tudo do zero (mesmo padrão de "reservar depois
  // revalidar" do módulo de convites).
  const { error: commitError } = await userClient.rpc('commit_profile_email_update', {
    p_target_profile_id: targetProfileId,
    p_expected_email: currentProfileEmail,
    p_new_email: newEmail,
  });

  if (!commitError) {
    logUserEmailEvent({
      requestId,
      operation: 'update_email',
      result: 'success',
      actorProfileId: actor.profileId,
      targetProfileId,
      companyId: companyId,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(200, { profileId: targetProfileId, email: newEmail });
  }

  // profiles falhou -> tentar compensar o Auth, restaurando o e-mail
  // anterior. Nunca finge que a operação inteira foi atômica.
  const compensation = await admin.auth.admin.updateUserById(targetProfileId, {
    email: currentAuthEmail,
    email_confirm: true,
  });

  if (compensation.error) {
    logUserEmailAlert('email_compensation_failed', {
      requestId,
      targetProfileId,
      companyId: companyId,
    });
    return errorResponse('email_compensation_failed');
  }

  // compensação bem-sucedida: Auth já foi restaurado ao e-mail anterior, o
  // estado real do sistema está consistente de novo — sempre email_update_failed
  // genérico aqui (decisão congelada), nunca o código de domínio específico
  // de profiles (evita vazar detalhe de uma falha já compensada/irrelevante
  // para o chamador). O código real fica só no log interno, para diagnóstico.
  const domainCode = typeof (commitError as { message?: unknown }).message === 'string'
    ? (commitError as { message: string }).message
    : '';

  logUserEmailEvent({
    requestId,
    operation: 'update_email',
    result: 'profile_failed_compensated',
    actorProfileId: actor.profileId,
    targetProfileId,
    companyId: companyId,
    durationMs: Date.now() - startedAt,
    code: domainCode || 'email_update_failed',
  });

  return errorResponse('email_update_failed');
}
