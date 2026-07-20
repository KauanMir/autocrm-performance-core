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
