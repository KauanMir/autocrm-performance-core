// lib/capabilities.ts — capabilities de INTERFACE (M1-D, commit 8).
// Funções puras sobre o role do usuário: sem React, sem Supabase, sem feature
// flag, sem localStorage, sem logs. A combinação com a flag remota acontece na
// camada de UI (App/telas). Isto é UX + defesa de handlers — a segurança REAL
// continua em RLS, grants e na RPC.
import type { User } from '@/lib/data';

// M1-F S8-B1: migrado de User.role (legado) para platformRole/
// activeMembership — mesma identidade já usada por canManageInvites/
// canAccessPlatformAdmin desde S3-B/S4-F1. `role` nunca é lido por nenhuma
// das três funções abaixo a partir desta etapa.
export type CapabilityUser = Pick<User, 'platformRole' | 'activeMembership'> | null | undefined;

function isActiveManager(user: CapabilityUser): boolean {
  return user?.activeMembership?.role === 'manager';
}

// COMPANY-SETTINGS-R1-EXEC — aba "Empresa" de Ajustes: Manager com
// membership ATIVA na própria empresa (edita phone/timezone reais via
// update_company_settings; name/cnpj somente leitura). Decisão de produto
// invertida em relação ao §28.3 original (que dava Empresa exclusivamente a
// Super Admin, canAccessFullSettings) — Super Admin NÃO tem companyId
// nenhum sem membership (nunca tem, por design) e a superfície genérica de
// Ajustes não tem company context ainda (ver ScreenEmpresas — só depois que
// esse modo existir, um Super Admin poderá editar configurações de uma
// empresa escolhida, por uma tela própria, nunca esta aba genérica). Nunca
// reutiliza canManageInvites/canAccessStageSettings (capabilities próprias,
// intocadas por esta função).
export function canManageCompanySettings(user: CapabilityUser): boolean {
  return isActiveManager(user);
}

// Área de Etapas: Super Admin (sempre) ou Manager com membership ATIVA. (A
// UI ainda exige a flag remota ON para a superfície remota — ver a regra de
// acesso efetivo na navegação.) Manager sem membership ativa e qualquer
// role legado isolado nunca autorizam por si só.
export function canAccessStageSettings(user: CapabilityUser): boolean {
  return user?.platformRole === 'super_admin' || isActiveManager(user);
}

// Reordenar etapas do pipeline: mesma matriz de canAccessStageSettings —
// nunca companyId como autorização (companyId é só o escopo passado ao
// hook, resolvido separadamente de activeMembership.companyId).
export function canReorderPipelineStages(user: CapabilityUser): boolean {
  return user?.platformRole === 'super_admin' || isActiveManager(user);
}

// M1-F S3-B — área administrativa de empresas da KAPA: só Super Admin de
// plataforma (platform_role, independente de role/companyId — um Super
// Admin nunca tem empresa). A UI ainda exige a flag
// NEXT_PUBLIC_FF_PLATFORM_ADMIN ON — ver a regra de acesso efetivo na
// navegação (mesma combinação capability×flag de canAccessStageSettings).
// Espelha is_platform_super_admin() no banco — mas quem decide de verdade
// continua sendo a RLS/RPC do servidor.
export type PlatformCapabilityUser = Pick<User, 'platformRole'> | null | undefined;

export function canAccessPlatformAdmin(user: PlatformCapabilityUser): boolean {
  return user?.platformRole === 'super_admin';
}

// M1-F S4-F1 — superfície de convites/usuários (aba "Usuários"): capability
// PRÓPRIA e restrita, nunca uma ampliação de canAccessFullSettings (que
// continua exigindo role==='admin' e continua liberando Empresa/Etapas
// normalmente). Autoriza:
//   - platformRole==='super_admin' (qualquer empresa, decisão de produto
//     §4 do S4-F1);
//   - OU membership ATIVA (company_memberships.role==='manager') — NUNCA
//     profiles.role legado sozinho: um Manager suspenso (membership
//     is_active=false) tem profiles.role==='manager' inalterado mas
//     activeMembership null (a consulta que popula esse campo já filtra
//     is_active=true, ver lib/services.ts._loadActiveMembership) — o
//     legado nunca concede acesso por si só, de propósito.
// Seller (activeMembership.role==='seller'), Auth user sem profile/
// membership (activeMembership undefined/null) e anon (user null) sempre
// caem em false pelo mesmo optional chaining.
//
// profile.is_active NÃO é checado aqui de propósito: User não carrega esse
// campo (não existe no tipo) porque _loadProfile() (lib/services.ts) já
// retorna null para qualquer profile inativo ANTES de montar o User —
// Super Admin incluso, o `!data.is_active` ali roda antes de qualquer
// branch por platform_role. Ou seja: um User inativo nunca existe em
// memória, então esta função nunca é chamada com um. Prova permanente
// em tests/services/authService.test.ts ('Super Admin com profile
// INATIVO').
export type InviteCapabilityUser = Pick<User, 'platformRole' | 'activeMembership'> | null | undefined;

export function canManageInvites(user: InviteCapabilityUser): boolean {
  if (user?.platformRole === 'super_admin') return true;
  return user?.activeMembership?.role === 'manager';
}

// M1-F S8-C2-B2 — workspace comercial (Clientes/Andamento): capability
// PRÓPRIA, nunca uma leitura de User.role legado (achado 2 do S8-C2-A1: hoje
// NAV_ROLES[user.role] decide sozinho, o que já vaza 'clientes'/'andamento'
// para Super Admin via o valor legado de compatibilidade em profiles.role).
// Autoriza:
//   - platformRole==='super_admin' — QUALQUER empresa, mas SEMPRE explícita
//     (o contexto comercial resolve qual; esta função nunca sabe disso).
//     A combinação com NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ é decisão
//     do chamador (App.tsx), nunca desta função (mesmo padrão de
//     canAccessStageSettings/isRemoteStagesEnabled);
//   - OU membership ATIVA de Manager/Seller — nunca profiles.role legado
//     sozinho, mesmo raciocínio de canManageInvites.
// Sem identidade, sem platformRole/activeMembership (auth sem profile) ou
// anon: false pelo mesmo optional chaining.
export type CommercialWorkspaceCapabilityUser = Pick<User, 'platformRole' | 'activeMembership'> | null | undefined;

export function canAccessCommercialWorkspace(user: CommercialWorkspaceCapabilityUser): boolean {
  if (user?.platformRole === 'super_admin') return true;
  const role = user?.activeMembership?.role;
  return role === 'manager' || role === 'seller';
}

// M1-F S8-C2-C2 — mutation comercial (create/update/duplicidade de Leads):
// capability PRÓPRIA, nunca uma ampliação de canAccessCommercialWorkspace
// (que só decide se o WORKSPACE existe — leitura). Exclusiva de Super
// Admin: Manager/Seller nunca usam esta capability platform (continuam
// integralmente nas telas legadas, com seus próprios contratos locais).
//
// Contrato (§37 do design): true somente quando TODAS as condições valem
// simultaneamente — platformRole==='super_admin'; readEnabled (a UI só
// pode mostrar a superfície platform com a flag READ ligada, mesmo padrão
// já usado pelo B2); writeEnabled (a flag WRITE em si — "WRITE só é
// EFETIVA quando READ também está ligada" é justamente readEnabled &&
// writeEnabled aqui, nunca uma leitura cruzada de flag dentro de
// lib/flags.ts); selectedCompanyStatus não nulo (nenhuma empresa
// selecionada = nenhuma mutation possível, nunca inferida); status
// 'ativa'/'implantacao' (mesma matriz já aprovada para as RPCs de
// mutation no S8-C2-C1 — 'suspensa'/'cancelada' sempre false, mesmo com
// as duas flags ligadas).
//
// profile.is_active NÃO é checado aqui de propósito — mesmo raciocínio já
// documentado em canManageInvites: um User inativo nunca existe em
// memória (_loadProfile retorna null antes de montar o User), então esta
// função nunca é chamada com um.
export type CommercialMutationCapabilityUser = Pick<User, 'platformRole'> | null | undefined;

export type CommercialMutationCapabilityInput = {
  actor: CommercialMutationCapabilityUser;
  readEnabled: boolean;
  writeEnabled: boolean;
  // null = nenhuma empresa selecionada ainda (selectedCompanyId null) —
  // nunca inferida a partir de outro estado.
  selectedCompanyStatus: 'implantacao' | 'ativa' | 'suspensa' | 'cancelada' | null;
};

export function canMutateCommercialWorkspace(input: CommercialMutationCapabilityInput): boolean {
  if (input.actor?.platformRole !== 'super_admin') return false;
  if (!input.readEnabled || !input.writeEnabled) return false;
  if (input.selectedCompanyStatus === null) return false;
  return input.selectedCompanyStatus === 'ativa' || input.selectedCompanyStatus === 'implantacao';
}

// CRM-BULK-IMPORT-A2/B2 — importação em massa de Leads via CSV: capability
// PRÓPRIA, nunca uma ampliação de canMutateCommercialWorkspace (aquela
// decide a superfície de mutation manual do Super Admin como um todo;
// importar é uma ação distinta, com seu próprio botão e seu próprio gate).
//
// Manager: SEM checagem de companyStatus aqui, de propósito — mesmo
// contrato já usado por resolveLeadMutationCapabilities.canCreate (que
// autoriza "Novo Lead" só por role/flag/profile, nunca lendo o status ao
// vivo da empresa): tentar mutar numa empresa não-ativa já é recusado pelo
// próprio bulk_import_leads (resolve_lead_mutation_context) no momento do
// clique, exatamente como create_lead já faz para "Novo Lead" hoje — nunca
// um gap de segurança, só onde a checagem acontece. Ajustado nesta forma
// depois de uma regressão real: a primeira versão exigia companyStatus
// também para Manager, o que forçava esta tela a depender de
// OperationalCompanyContext só para isso e quebrou os testes de
// ScreenClientes que renderizam a tela sem esse Provider (o mesmo padrão
// que "Novo Lead" já evita há muito tempo).
//
// Super Admin contextual: true somente com a flag de escrita comercial
// ligada E a empresa selecionada 'ativa'/'implantacao' (mesma matriz de
// canMutateCommercialWorkspace) — aqui o status FAZ sentido checar no
// cliente porque a superfície Platform já mantém o status da empresa
// selecionada em memória para outra finalidade (o seletor de empresas).
// Super Admin GENÉRICO, sem nenhuma empresa selecionada (companyStatus
// null), é sempre false.
//
// Seller: sempre false — decisão de produto (A1 §28), não limitação
// técnica. Backend (bulk_import_leads) continua sendo a autoridade REAL —
// esta função só decide se o botão "Importar CSV" existe na UI.
export type ImportLeadsCapabilityUser = Pick<User, 'platformRole' | 'activeMembership'> | null | undefined;

export type ImportLeadsCapabilityInput = {
  actor: ImportLeadsCapabilityUser;
  // Só consultado no ramo Super Admin — null = nenhuma empresa selecionada
  // (Super Admin genérico) ou irrelevante (Manager/Seller, ver acima).
  companyStatus: 'implantacao' | 'ativa' | 'suspensa' | 'cancelada' | null;
  // Resolvido pelo chamador a partir de isSuperAdminCommercialWriteEnabled()
  // — só relevante para o ramo Super Admin; ignorado para Manager/Seller
  // (mesmo padrão de canMutateCommercialWorkspace, que também nunca lê
  // flag dentro desta camada).
  superAdminWriteEnabled: boolean;
};

export function canImportLeads(input: ImportLeadsCapabilityInput): boolean {
  if (input.actor?.platformRole === 'super_admin') {
    if (!input.superAdminWriteEnabled) return false;
    if (input.companyStatus === null) return false;
    return input.companyStatus === 'ativa' || input.companyStatus === 'implantacao';
  }

  return input.actor?.activeMembership?.role === 'manager';
}

// M1-F S6-F — ciclo de vida empresarial de usuários (suspender/reativar/
// desligar/transferir). Ator resolvido pelo chamador (nunca lido de
// AuthService aqui, mesmo padrão do restante deste arquivo): Super Admin
// (profileId apenas, nenhuma empresa — atua sobre qualquer empresa) ou
// Manager (profileId + companyId da própria membership ativa).
export type MembershipLifecycleActor =
  | { kind: 'super_admin'; profileId: string }
  | { kind: 'manager'; profileId: string; companyId: string };

// Linha-alvo: exatamente os campos que list_company_users/
// list_inactive_company_users devolvem, nunca o Row inteiro de
// company_memberships (nenhum dos dois expõe platform_role do alvo — a RPC
// é a autoridade real contra "alvo é outro Super Admin", ver nota abaixo).
export type MembershipLifecycleTargetRow = {
  profileId: string;
  companyId: string;
  companyRole: 'manager' | 'seller';
  lifecycleStatus: 'active' | 'suspended' | 'offboarded';
};

export type MembershipLifecycleCapabilities = {
  canSuspend: boolean;
  canReactivate: boolean;
  canOffboard: boolean;
  canTransfer: boolean;
};

const NO_MEMBERSHIP_LIFECYCLE_CAPABILITIES: MembershipLifecycleCapabilities = {
  canSuspend: false,
  canReactivate: false,
  canOffboard: false,
  canTransfer: false,
};

// Única fonte de decisão — nunca duplicada em ActiveUserList/InactiveUserList
// ou em qualquer modal (§ decisão S6-F "Centralizar em capabilities").
// Matriz exata (spec S6-F §4):
//   Super Admin  | ativo:     Suspender, Desligar, Transferir
//                | suspenso:  Reativar, Desligar, Transferir
//                | desligado: somente leitura
//   Manager      | Seller ativo da própria empresa:    Suspender, Desligar
//                | Seller suspenso da própria empresa:  Reativar, Desligar
//                | nunca: Manager sobre Manager, transferência, fora da
//                  empresa, sobre a própria membership
//
// "Ação sobre Super Admin" não é decidível aqui por falta de sinal
// (platform_role do alvo nunca é devolvido pelas RPCs de listagem, ver tipo
// acima) — defesa em profundidade real fica com o backend (as cinco RPCs já
// recusam com 'forbidden' quando o alvo é Super Admin), exatamente o mesmo
// raciocínio já documentado para EditUserModal/rowCapabilities.
export function membershipLifecycleCapabilities(
  row: MembershipLifecycleTargetRow,
  actor: MembershipLifecycleActor | null,
): MembershipLifecycleCapabilities {
  if (!actor) return NO_MEMBERSHIP_LIFECYCLE_CAPABILITIES;
  if (row.profileId === actor.profileId) return NO_MEMBERSHIP_LIFECYCLE_CAPABILITIES;

  if (actor.kind === 'super_admin') {
    if (row.lifecycleStatus === 'active') {
      return { canSuspend: true, canReactivate: false, canOffboard: true, canTransfer: true };
    }
    if (row.lifecycleStatus === 'suspended') {
      return { canSuspend: false, canReactivate: true, canOffboard: true, canTransfer: true };
    }
    return NO_MEMBERSHIP_LIFECYCLE_CAPABILITIES;
  }

  // Manager: só Seller da própria empresa — nunca outro Manager, nunca fora
  // da empresa, nunca transferência.
  if (row.companyRole !== 'seller' || row.companyId !== actor.companyId) {
    return NO_MEMBERSHIP_LIFECYCLE_CAPABILITIES;
  }
  if (row.lifecycleStatus === 'active') {
    return { canSuspend: true, canReactivate: false, canOffboard: true, canTransfer: false };
  }
  if (row.lifecycleStatus === 'suspended') {
    return { canSuspend: false, canReactivate: true, canOffboard: true, canTransfer: false };
  }
  return NO_MEMBERSHIP_LIFECYCLE_CAPABILITIES;
}

// FOLLOW-UP-TEMPLATES-A3-EXEC — usar um template (Lead > Follow-up): Manager
// e Seller com membership ATIVA, nunca Super Admin (create_task continua
// hard-forbidden para ele — precheck A2-EXEC §30, nunca reaberto aqui).
// Sem checagem de companyStatus aqui de propósito, mesmo raciocínio já
// documentado em canImportLeads: tentar aplicar um template numa empresa
// não-ativa já é recusado pelo próprio create_task no momento do clique —
// nunca um gap de segurança, só onde a checagem acontece.
export type FollowUpTemplateCapabilityUser = Pick<User, 'platformRole' | 'activeMembership'> | null | undefined;

export function canUseFollowUpTemplate(user: FollowUpTemplateCapabilityUser): boolean {
  const role = user?.activeMembership?.role;
  return role === 'manager' || role === 'seller';
}

// FOLLOW-UP-TEMPLATES-A3-EXEC — gerenciar templates (Ajustes > Follow-ups):
// Manager da própria empresa SEMPRE; Super Admin contextual SOMENTE quando
// a empresa selecionada está 'ativa'/'implantacao' (mesma matriz de
// canImportLeads/canMutateCommercialWorkspace — 'suspensa'/'cancelada'
// sempre false). Seller: sempre false — decisão de produto (precheck A1 §6),
// não limitação técnica. Esta capability decide só ESCRITA (create/update/
// active/reorder); a VISIBILIDADE da aba Ajustes > Follow-ups é mais ampla
// (Manager OU qualquer Super Admin contextual, inclusive empresa suspensa,
// que só perde a escrita — precheck A3-EXEC §18) e é resolvida direto no
// componente, mesmo padrão de companySettingsAccess em ScreenAjustes.
export type ManageFollowUpTemplatesCapabilityInput = {
  actor: FollowUpTemplateCapabilityUser;
  // Só consultado no ramo Super Admin — null = nenhuma empresa selecionada
  // (Super Admin genérico) ou irrelevante (Manager).
  companyStatus: 'implantacao' | 'ativa' | 'suspensa' | 'cancelada' | null;
};

export function canManageFollowUpTemplates(input: ManageFollowUpTemplatesCapabilityInput): boolean {
  if (input.actor?.platformRole === 'super_admin') {
    if (input.companyStatus === null) return false;
    return input.companyStatus === 'ativa' || input.companyStatus === 'implantacao';
  }
  return input.actor?.activeMembership?.role === 'manager';
}
