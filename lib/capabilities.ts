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

// Ajustes completos (Empresa/Usuários/Etapas): exclusivo de Super Admin.
// Manager (mesmo com membership ativa) nunca recebe esta superfície — só
// Usuários (canManageInvites) e Etapas (canAccessStageSettings), nunca
// Empresa (decisão congelada em §28.3 do design).
export function canAccessFullSettings(user: CapabilityUser): boolean {
  return user?.platformRole === 'super_admin';
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
