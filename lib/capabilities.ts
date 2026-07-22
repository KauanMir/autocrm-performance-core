// lib/capabilities.ts — capabilities de INTERFACE (M1-D, commit 8).
// Funções puras sobre o role do usuário: sem React, sem Supabase, sem feature
// flag, sem localStorage, sem logs. A combinação com a flag remota acontece na
// camada de UI (App/telas). Isto é UX + defesa de handlers — a segurança REAL
// continua em RLS, grants e na RPC.
import type { User } from '@/lib/data';

export type CapabilityUser = Pick<User, 'role'> | null | undefined;

// Ajustes completos (Empresa/Usuários/Etapas): só admin.
export function canAccessFullSettings(user: CapabilityUser): boolean {
  return user?.role === 'admin';
}

// Área de Etapas: admin e manager. (A UI ainda exige a flag remota ON para o
// manager — ver a regra de acesso efetivo na navegação.)
export function canAccessStageSettings(user: CapabilityUser): boolean {
  return user?.role === 'admin' || user?.role === 'manager';
}

// Reordenar etapas do pipeline: admin e manager. Espelha a policy/RPC do
// banco (is_manager_or_admin) — mas quem decide de verdade é o servidor.
export function canReorderPipelineStages(user: CapabilityUser): boolean {
  return user?.role === 'admin' || user?.role === 'manager';
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
