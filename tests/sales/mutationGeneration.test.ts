// Testes de lib/sales/mutationGeneration.ts (COMMERCIAL-REMOTE-SALES-A2).
// Unidade isolada, sem Supabase, sem React — prova diretamente que a
// guarda de geração cobre AMBOS os caminhos de `fn()` (resolve e
// rejeita), nunca só o caminho de sucesso. Mesmo padrão de
// tests/deals/mutationGeneration.test.ts.
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { runSaleMutationWithGenerationGuard } from '@/lib/sales/mutationGeneration';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { isRemoteSalesError } from '@/lib/sales/errors';

function client(): QueryClient {
  return new QueryClient();
}

describe('runSaleMutationWithGenerationGuard — geração estável', () => {
  it('fn() resolve, geração inalterada: retorna o resultado real', async () => {
    const queryClient = client();
    const result = await runSaleMutationWithGenerationGuard(queryClient, 'op', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('fn() rejeita, geração inalterada: propaga o erro ORIGINAL (nunca identity_changed)', async () => {
    const queryClient = client();
    const originalError = new Error('deal_closed');
    await expect(
      runSaleMutationWithGenerationGuard(queryClient, 'op', async () => { throw originalError; }),
    ).rejects.toBe(originalError);
  });
});

describe('runSaleMutationWithGenerationGuard — geração muda no caminho de SUCESSO', () => {
  it('fn() resolve, mas a geração mudou durante a chamada: identity_changed, nunca o resultado real', async () => {
    const queryClient = client();
    const result = runSaleMutationWithGenerationGuard(queryClient, 'my_op', async () => {
      bumpQueryCacheGeneration(queryClient);
      return 'valor-real-que-nunca-deve-aterrissar';
    });
    await expect(result).rejects.toMatchObject({ code: 'remote_sales_mutation_identity_changed' });
  });
});

describe('runSaleMutationWithGenerationGuard — geração muda no caminho de REJEIÇÃO (gate crítico)', () => {
  it('fn() rejeita, e a geração mudou durante a chamada: identity_changed, NUNCA o erro original da geração morta', async () => {
    const queryClient = client();
    const originalError = new Error('deal_closed');
    const result = runSaleMutationWithGenerationGuard(queryClient, 'my_op', async () => {
      bumpQueryCacheGeneration(queryClient);
      throw originalError;
    });
    await expect(result).rejects.toMatchObject({ code: 'remote_sales_mutation_identity_changed' });
    await expect(result).rejects.not.toBe(originalError);
  });

  it('onConflictError NUNCA é chamado quando a geração mudou (decisão de invalidar pertence só à geração viva)', async () => {
    const queryClient = client();
    let conflictCalls = 0;
    const result = runSaleMutationWithGenerationGuard(
      queryClient,
      'my_op',
      async () => {
        bumpQueryCacheGeneration(queryClient);
        throw new Error('deal_closed');
      },
      { onConflictError: () => { conflictCalls += 1; } },
    );
    await expect(result).rejects.toMatchObject({ code: 'remote_sales_mutation_identity_changed' });
    expect(conflictCalls).toBe(0);
  });
});

describe('runSaleMutationWithGenerationGuard — onConflictError com geração válida', () => {
  it('fn() rejeita com geração ainda válida: onConflictError roda com o erro real, e o erro real é propagado', async () => {
    const queryClient = client();
    const originalError = new Error('deal_closed');
    let receivedError: unknown;
    await expect(
      runSaleMutationWithGenerationGuard(
        queryClient,
        'my_op',
        async () => { throw originalError; },
        { onConflictError: (error) => { receivedError = error; } },
      ),
    ).rejects.toBe(originalError);
    expect(receivedError).toBe(originalError);
  });

  it('identity_changed lançado é reconhecido por isRemoteSalesError', async () => {
    const queryClient = client();
    const result = runSaleMutationWithGenerationGuard(queryClient, 'op', async () => {
      bumpQueryCacheGeneration(queryClient);
      return 'x';
    });
    await expect(result).rejects.toSatisfy((e: unknown) => isRemoteSalesError(e));
  });
});
