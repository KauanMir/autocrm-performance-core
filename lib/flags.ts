// lib/flags.ts — feature flags dos módulos remotos (M1-D stages, M1-E leads,
// M1-F platform admin, M1-F S5-D usuários ativos).
//
// OFF por padrão. A ativação real acontece somente via variável de ambiente
// (NEXT_PUBLIC_FF_REMOTE_STAGES / NEXT_PUBLIC_FF_REMOTE_LEADS /
// NEXT_PUBLIC_FF_PLATFORM_ADMIN / NEXT_PUBLIC_FF_ACTIVE_USERS) depois da
// validação de cada módulo — nenhum commit liga flag por padrão.
//
// M1-F S5-D: NEXT_PUBLIC_FF_ACTIVE_USERS existe porque as migrations
// list_company_users/update_profile_name/update_membership_role (S5-A2/S5-B/
// S5-C) ainda não foram aplicadas no banco remoto no momento em que este
// frontend é escrito — a flag mantém a seção "Usuários ativos" desligada em
// produção até o deploy real das migrations, sem exigir um segundo mecanismo
// de rollout (reaproveita exatamente o mesmo contrato de isRemoteStagesEnabled/
// isPlatformAdminEnabled). Diferente de canManageInvites (capability), esta
// flag não decide QUEM pode ver a seção — só SE ela existe no bundle;
// autorização real continua nas RPCs.
//
// Override de desenvolvimento: localStorage['autocrm_ff_remote_stages'] /
// localStorage['autocrm_ff_remote_leads'] / localStorage['autocrm_ff_platform_admin'] /
// localStorage['autocrm_ff_active_users'], reconhecido EXCLUSIVAMENTE quando
// NODE_ENV === 'development'. Em produção o localStorage nunca é consultado —
// nenhum usuário ativa flag pelo navegador. As flags não são reativas: mudar
// o override exige recarregar a página.
//
// Nenhum estado React, nenhum hook, nenhum log — funções puras de leitura.
// A flag controla exclusivamente a exposição da UI (rollout) — nunca é
// autoridade de segurança: quem decide de verdade continua sendo a RLS de
// companies e is_platform_super_admin() no banco (M1-F S3).

export const REMOTE_STAGES_DEV_OVERRIDE_KEY = 'autocrm_ff_remote_stages';
export const REMOTE_LEADS_DEV_OVERRIDE_KEY = 'autocrm_ff_remote_leads';
export const PLATFORM_ADMIN_DEV_OVERRIDE_KEY = 'autocrm_ff_platform_admin';
export const ACTIVE_USERS_DEV_OVERRIDE_KEY = 'autocrm_ff_active_users';

// Somente as strings exatas 'true'/'false' são reconhecidas (case-sensitive);
// qualquer outro valor (1, yes, on, TRUE, vazio…) é tratado como inválido.
function parseFlagValue(value: string | null | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// Contrato único das duas flags. O valor bruto do env chega por parâmetro
// porque o inlining de NEXT_PUBLIC_* do Next.js exige acesso por membro
// direto (process.env.NEXT_PUBLIC_…) no call site — nunca acesso dinâmico.
function resolveFlag(envRawValue: string | null | undefined, devOverrideKey: string): boolean {
  const envValue = parseFlagValue(envRawValue) ?? false;

  // Produção (qualquer NODE_ENV !== 'development'): retorna antes de qualquer
  // acesso a window/localStorage.
  if (process.env.NODE_ENV !== 'development') return envValue;

  // Development em SSR (window ausente): usa o env.
  if (typeof window === 'undefined') return envValue;

  // Development no browser: precedência = override válido no localStorage →
  // variável de ambiente válida → false.
  try {
    const override = parseFlagValue(window.localStorage.getItem(devOverrideKey));
    return override ?? envValue;
  } catch {
    // SecurityError (cookies bloqueados etc.) — cai no valor do ambiente.
    return envValue;
  }
}

export function isRemoteStagesEnabled(): boolean {
  // process.env lido DENTRO da função (não em constante de módulo) para
  // permitir testes isolados.
  return resolveFlag(process.env.NEXT_PUBLIC_FF_REMOTE_STAGES, REMOTE_STAGES_DEV_OVERRIDE_KEY);
}

export function isRemoteLeadsEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_REMOTE_LEADS, REMOTE_LEADS_DEV_OVERRIDE_KEY);
}

export function isPlatformAdminEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_PLATFORM_ADMIN, PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
}

export function isActiveUsersEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_ACTIVE_USERS, ACTIVE_USERS_DEV_OVERRIDE_KEY);
}
