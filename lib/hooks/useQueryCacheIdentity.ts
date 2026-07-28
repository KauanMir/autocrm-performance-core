// lib/hooks/useQueryCacheIdentity.ts — peça B da limpeza de cache (M1-D,
// commit 9). Observa a identidade COMERCIAL resolvida pelo App (auth user +
// profile + membership ativa) e reseta o QueryClient quando ela muda.
// Complementa o AuthCacheBoundary, que só enxerga o auth user do GoTrue.
// Sem AuthService, sem feature flag, sem Supabase, sem localStorage.
//
// CORREÇÃO (M1-F S6-E): companyId vinha de profiles.company_id (coluna
// legada, não afetada por suspensão/desligamento/transferência de
// membership) — suspender/transferir uma membership não mudava nenhum
// campo observado aqui, então o cache empresarial de um usuário suspenso
// continuava vivo indefinidamente. companyId agora vem de
// activeMembership.companyId (a mesma fonte que AuthService usa para tudo
// o mais); membershipRole/hasActiveMembership são novos, para que troca de
// papel (seller↔manager) e perda/ganho de membership ativa também limpem o
// cache. platformRole entra separado — Super Admin nunca tem
// activeMembership (por design), e isso não pode parecer "perda de
// identidade": hasActiveMembership=false é o estado NORMAL e estável de um
// Super Admin, nunca um sinal de invalidação por si só (só a MUDANÇA de
// qualquer campo aciona o reset, nunca um valor específico isoladamente).
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { resetQueryCache } from '@/lib/query/resetQueryCache';

export type QueryCacheIdentity = {
  userId?: string | null;
  platformRole?: 'super_admin' | null;
  // Empresa da membership ATIVA — nunca profiles.company_id legado.
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  hasActiveMembership?: boolean;
  isActive: boolean;
};

type NormalizedIdentity = {
  userId: string | null;
  platformRole: 'super_admin' | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  hasActiveMembership: boolean;
  isActive: boolean;
};

export function useQueryCacheIdentity(identity: QueryCacheIdentity): void {
  const queryClient = useQueryClient();
  // Comparação por CAMPOS primitivos — nunca por referência de objeto.
  const userId = identity.userId ?? null;
  const platformRole = identity.platformRole ?? null;
  const companyId = identity.companyId ?? null;
  const membershipRole = identity.membershipRole ?? null;
  const hasActiveMembership = Boolean(identity.hasActiveMembership);
  const isActive = Boolean(identity.isActive);

  const prevRef = useRef<NormalizedIdentity | null>(null);

  useEffect(() => {
    const prev = prevRef.current;

    // Primeira montagem: só registra.
    if (prev === null) {
      prevRef.current = { userId, platformRole, companyId, membershipRole, hasActiveMembership, isActive };
      return;
    }

    // Mesmos valores (inclusive re-render com objeto novo): nada a fazer.
    if (
      prev.userId === userId
      && prev.platformRole === platformRole
      && prev.companyId === companyId
      && prev.membershipRole === membershipRole
      && prev.hasActiveMembership === hasActiveMembership
      && prev.isActive === isActive
    ) {
      return;
    }

    // Só limpa se EXISTIA identidade comercial anterior — o primeiro usuário
    // depois de um estado vazio não tem nada anterior para vazar. isActive/
    // userId (nunca hasActiveMembership/companyId isolados) bastam como
    // sinal de "havia algo a proteger" — um Super Admin sem membership é
    // identidade válida e estável, não um estado vazio.
    const hadIdentity = prev.isActive || prev.userId !== null;
    if (hadIdentity) {
      resetQueryCache(queryClient);
    }
    prevRef.current = { userId, platformRole, companyId, membershipRole, hasActiveMembership, isActive };
  }, [queryClient, userId, platformRole, companyId, membershipRole, hasActiveMembership, isActive]);
}
