// tests/helpers/renderWithQueryClient.tsx — harness de integração (commit 10).
// QueryClient NOVO por teste (retry desligado para não esperar backoff), sem
// instância compartilhada, sem rede, sem mock global de Supabase.
import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: 0 },
    },
  });
}

export function renderWithQueryClient(
  ui: React.ReactElement,
  queryClient: QueryClient = createTestQueryClient(),
) {
  const wrap = (node: React.ReactElement) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  const view = render(wrap(ui));
  return {
    queryClient,
    ...view,
    rerenderWithClient: (next: React.ReactElement) => view.rerender(wrap(next)),
  };
}
