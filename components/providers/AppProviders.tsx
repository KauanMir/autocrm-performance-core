'use client';
// AppProviders — fronteira única de providers da aplicação (M1-D, commit 1).
// Neste commit só existe o QueryClientProvider; nenhuma query/mutation é
// declarada ainda, então o comportamento do app é idêntico ao anterior.
//
// Limpeza de cache (commit futuro "feat(auth-cache)", em duas peças — NÃO
// implementar aqui):
//   A. AuthCacheBoundary — reage somente a supabase.auth.onAuthStateChange
//      (SIGNED_OUT e mudança do auth user).
//   B. useQueryCacheIdentity(activeUser) — chamado em App.tsx depois que o
//      profile ativo resolve; observa activeUser.id/companyId/isActive e, na
//      mudança de identidade comercial, cancela queries e limpa o cache
//      (onAuthStateChange sozinho não conhece o companyId de public.profiles).
// AuthService/lib/services.ts nunca importam nada de React Query.
import React, { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createAppQueryClient } from '@/lib/query/client';

export function AppProviders({ children }: { children: React.ReactNode }) {
  // Uma única instância por montagem — o initializer do useState roda uma vez;
  // re-renders reutilizam o mesmo QueryClient (nunca recriado a cada render).
  const [queryClient] = useState(() => createAppQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
