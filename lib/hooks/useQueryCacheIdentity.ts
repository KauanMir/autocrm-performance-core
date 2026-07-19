// lib/hooks/useQueryCacheIdentity.ts — peça B da limpeza de cache (M1-D,
// commit 9). Observa a identidade COMERCIAL resolvida pelo App (auth user +
// profile: userId/companyId/isActive) e reseta o QueryClient quando ela muda.
// Complementa o AuthCacheBoundary, que só enxerga o auth user do GoTrue.
// Sem AuthService, sem feature flag, sem Supabase, sem localStorage.
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { resetQueryCache } from '@/lib/query/resetQueryCache';

export type QueryCacheIdentity = {
  userId?: string | null;
  companyId?: string | null;
  isActive: boolean;
};

type NormalizedIdentity = {
  userId: string | null;
  companyId: string | null;
  isActive: boolean;
};

export function useQueryCacheIdentity(identity: QueryCacheIdentity): void {
  const queryClient = useQueryClient();
  // Comparação por CAMPOS primitivos — nunca por referência de objeto.
  const userId = identity.userId ?? null;
  const companyId = identity.companyId ?? null;
  const isActive = Boolean(identity.isActive);

  const prevRef = useRef<NormalizedIdentity | null>(null);

  useEffect(() => {
    const prev = prevRef.current;

    // Primeira montagem: só registra.
    if (prev === null) {
      prevRef.current = { userId, companyId, isActive };
      return;
    }

    // Mesmos valores (inclusive re-render com objeto novo): nada a fazer.
    if (prev.userId === userId && prev.companyId === companyId && prev.isActive === isActive) {
      return;
    }

    // Só limpa se EXISTIA identidade comercial anterior — o primeiro usuário
    // depois de um estado vazio não tem nada anterior para vazar.
    const hadIdentity = prev.isActive || prev.userId !== null || prev.companyId !== null;
    if (hadIdentity) {
      resetQueryCache(queryClient);
    }
    prevRef.current = { userId, companyId, isActive };
  }, [queryClient, userId, companyId, isActive]);
}
