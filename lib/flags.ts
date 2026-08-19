// lib/flags.ts — feature flags dos módulos remotos (M1-D stages, M1-E leads,
// M1-F platform admin, M1-F S5-D usuários ativos, M1-F S5-E1 edição de e-mail).
//
// OFF por padrão. A ativação real acontece somente via variável de ambiente
// (NEXT_PUBLIC_FF_REMOTE_STAGES / NEXT_PUBLIC_FF_REMOTE_LEADS /
// NEXT_PUBLIC_FF_PLATFORM_ADMIN / NEXT_PUBLIC_FF_ACTIVE_USERS /
// NEXT_PUBLIC_FF_USER_EMAIL_EDIT) depois da validação de cada módulo —
// nenhum commit liga flag por padrão.
//
// M1-F S5-E1: NEXT_PUBLIC_FF_USER_EMAIL_EDIT é uma flag SEPARADA de
// NEXT_PUBLIC_FF_ACTIVE_USERS (decisão congelada do S5-E0 §18/§15) — a
// edição de e-mail tem risco/impacto diferente (afeta login) e uma
// superfície de backend própria (Route Handler + Auth Admin API), então
// precisa poder ser ativada independentemente da listagem de usuários já
// publicada. Nenhuma UI consome esta flag ainda (S5-E1-A é só backend).
//
// COMMERCIAL-REMOTE-B1: NEXT_PUBLIC_FF_REMOTE_TASKS é uma flag SEPARADA de
// NEXT_PUBLIC_FF_REMOTE_LEADS/NEXT_PUBLIC_FF_REMOTE_STAGES — Tasks é o
// primeiro domínio comercial local (Tasks/Visits/Deals/Sales) a ganhar
// backend remoto próprio, migrado independentemente dos demais. Esta flag
// só controla o valor BRUTO de REMOTE_TASKS; a regra de que Tasks nunca
// pode continuar em localStorage quando Leads já está remoto (rollout
// parcial vira BLOCKED, nunca LOCAL) vive em
// lib/tasks/remoteTasksMode.ts, não aqui.
//
// M1-F S6-F: NEXT_PUBLIC_FF_USER_LIFECYCLE é uma flag SEPARADA de
// NEXT_PUBLIC_FF_ACTIVE_USERS, mas só tem efeito quando ACTIVE_USERS também
// está ligada (a interface de ciclo de vida — suspender/reativar/desligar/
// transferir — é uma extensão da seção "Usuários ativos"; sem a listagem
// base habilitada, não há linha nenhuma para anexar uma ação). As RPCs que
// ela consome (suspend_membership/reactivate_membership/offboard_seller/
// offboard_manager/transfer_membership, S6-B/S6-C/S6-D/S6-E2) ainda não
// foram aplicadas no banco remoto no momento em que este frontend é escrito
// — mesmo motivo de rollout das flags anteriores. Nenhuma flag é ativada por
// esta etapa.
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
export const REMOTE_TASKS_DEV_OVERRIDE_KEY = 'autocrm_ff_remote_tasks';
export const PLATFORM_ADMIN_DEV_OVERRIDE_KEY = 'autocrm_ff_platform_admin';
export const ACTIVE_USERS_DEV_OVERRIDE_KEY = 'autocrm_ff_active_users';
export const USER_EMAIL_EDIT_DEV_OVERRIDE_KEY = 'autocrm_ff_user_email_edit';
export const USER_LIFECYCLE_DEV_OVERRIDE_KEY = 'autocrm_ff_user_lifecycle';
export const COMPANY_SELECTOR_DEV_OVERRIDE_KEY = 'autocrm_ff_company_selector';
export const SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY = 'autocrm_ff_super_admin_commercial_read';
export const SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY = 'autocrm_ff_super_admin_commercial_write';

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

// COMMERCIAL-REMOTE-B1 — NEXT_PUBLIC_FF_REMOTE_TASKS (mesmo contrato de
// isRemoteStagesEnabled/isRemoteLeadsEnabled). Só o valor bruto da própria
// flag — a combinação com o estado de Leads/Stages (rollout parcial vs.
// misconfiguration) é decisão de lib/tasks/remoteTasksMode.ts, nunca desta
// função.
export function isRemoteTasksEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_REMOTE_TASKS, REMOTE_TASKS_DEV_OVERRIDE_KEY);
}

export function isPlatformAdminEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_PLATFORM_ADMIN, PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
}

export function isActiveUsersEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_ACTIVE_USERS, ACTIVE_USERS_DEV_OVERRIDE_KEY);
}

export function isUserEmailEditEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_USER_EMAIL_EDIT, USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
}

// M1-F S6-F: só o valor bruto da própria flag — a combinação com
// isActiveUsersEnabled() é decisão do chamador (ScreensBiz), mesmo padrão já
// usado por userEmailEditEnabled.
export function isUserLifecycleEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_USER_LIFECYCLE, USER_LIFECYCLE_DEV_OVERRIDE_KEY);
}

// M1-F S7 — filtro contextual de empresa (decisão congelada em §26 do design
// doc). Só o valor bruto da própria flag — "somente Super Admin" e "não ativa
// telas sem suporte" são decisões de QUEM consome o filtro (o hook
// useCompanyScopeFilter já devolve companyFilterId=null para qualquer ator
// que não seja Super Admin, independente desta flag) e de QUAIS telas o
// integram (S7-C), nunca desta função. A flag controla exclusivamente se a
// superfície contextual aprovada (aba de Usuários) existe no bundle.
export function isCompanySelectorEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_COMPANY_SELECTOR, COMPANY_SELECTOR_DEV_OVERRIDE_KEY);
}

// M1-F S8-C2-B2 — leitura comercial do Super Admin (Clientes/Andamento reais,
// via as 4 RPCs estreitas do S8-C2-B1: list_commercial_companies/
// list_platform_leads_for_company/list_platform_lead_timeline/
// list_pipeline_stages_for_company). Só o valor bruto da própria flag — QUEM
// consome (canAccessCommercialWorkspace + platformRole==='super_admin') e
// QUAL superfície é montada (PlatformCommercialClientsView/PipelineView vs.
// as telas locais de Manager/Seller, inalteradas) são decisões do chamador
// (ScreensOps.tsx/App.tsx), nunca desta função. Independente de todas as
// outras flags — Manager/Seller nunca dependem dela (§S8-C2-A1/§31).
// NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE (mutations) é uma etapa futura,
// ainda não criada, e dependerá desta (READ) quando existir.
export function isSuperAdminCommercialReadEnabled(): boolean {
  return resolveFlag(
    process.env.NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ,
    SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY,
  );
}

// M1-F S8-C2-C2 — mutation comercial do Super Admin (create/update/
// duplicidade de Leads, via create_lead/update_lead/
// check_lead_phone_duplicate com p_company_id explícito). Só o valor bruto
// da própria flag — mesmo padrão de isUserLifecycleEnabled()/
// isActiveUsersEnabled(): a combinação "WRITE só é EFETIVA quando READ
// também está ligada" é decisão do chamador (canMutateCommercialWorkspace),
// nunca desta função. Independente de todas as outras flags — Manager/
// Seller nunca dependem dela.
export function isSuperAdminCommercialWriteEnabled(): boolean {
  return resolveFlag(
    process.env.NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE,
    SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY,
  );
}
