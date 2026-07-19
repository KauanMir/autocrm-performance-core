'use client';
// AuthCacheBoundary (M1-D, commit 9) — peça A da limpeza de cache.
// Responsabilidade EXCLUSIVA: reagir a supabase.auth.onAuthStateChange
// (SIGNED_OUT e troca do auth user). A identidade COMERCIAL (companyId/
// is_active, que o GoTrue não conhece) é a peça B: useQueryCacheIdentity,
// chamado no App depois que o profile resolve. Não importa AuthService, não
// faz consultas Supabase no callback, não chama signOut.
import React, { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { resetQueryCache } from '@/lib/query/resetQueryCache';

export function AuthCacheBoundary({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Só o ÚLTIMO auth user id observado — nenhum outro dado retido.
  const lastAuthUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextId = session?.user?.id ?? null;
      const prevId = lastAuthUserIdRef.current;

      if (event === 'SIGNED_OUT') {
        resetQueryCache(queryClient);
        lastAuthUserIdRef.current = null;
        return;
      }

      if (nextId !== prevId) {
        // Troca direta de usuário limpa; o PRIMEIRO usuário depois de um
        // estado sem identidade (INITIAL_SESSION / primeiro SIGNED_IN) só
        // registra — não há dados anteriores para vazar.
        if (prevId !== null) resetQueryCache(queryClient);
        lastAuthUserIdRef.current = nextId;
        return;
      }

      // Mesmo usuário (TOKEN_REFRESHED, SIGNED_IN repetido, INITIAL_SESSION
      // subsequente): nada a limpar, nenhum refetch forçado.
    });

    return () => { data.subscription.unsubscribe(); };
  }, [queryClient]);

  return <>{children}</>;
}
