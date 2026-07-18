// lib/query/client.ts — factory do QueryClient da aplicação (M1-D, commit 1).
// Factory em vez de singleton de módulo: cada montagem de AppProviders cria a
// sua instância via useState(() => createAppQueryClient()), o que evita estado
// vazando entre renders de teste e entre requests do prerender do Next.
import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutos
        retry: 2,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
