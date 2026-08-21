// Testes de lib/visits/mutationGeneration.ts (COMMERCIAL-REMOTE-VISITS-B2-B).
// Unidade isolada, sem Supabase, sem React — prova diretamente que a
// guarda de geração cobre AMBOS os caminhos de `fn()` (resolve e
// rejeita), nunca só o caminho de sucesso. Mesmo padrão de
// tests/tasks/taskMutationGeneration.test.ts.
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { runVisitMutationWithGenerationGuard } from '@/lib/visits/mutationGeneration';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { isRemoteVisitsError } from '@/lib/visits/errors';

function client(): QueryClient {
  return new QueryClient();
}

describe('runVisitMutationWithGenerationGuard — geração estável', () => {
  it('fn() resolve, geração inalterada: retorna o resultado real', async () => {
    const queryClient = client();
    const result = await runVisitMutationWithGenerationGuard(queryClient, 'op', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('fn() rejeita, geração inalterada: propaga o erro ORIGINAL (nunca identity_changed)', async () => {
    const queryClient = client();
    const originalError = new Error('stale_write');
    await expect(
      runVisitMutationWithGenerationGuard(queryClient, 'op', async () => { throw originalError; }),
    ).rejects.toBe(originalError);
  });
});

describe('runVisitMutationWithGenerationGuard — geração muda no caminho de SUCESSO', () => {
  it('fn() resolve, mas a geração mudou durante a chamada: identity_changed, nunca o resultado real', async () => {
    const queryClient = client();
    const result = runVisitMutationWithGenerationGuard(queryClient, 'my_op', async () => {
      bumpQueryCacheGeneration(queryClient);
      return 'valor-real-que-nunca-deve-aterrissar';
    });
    await expect(result).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
  });
});

describe('runVisitMutationWithGenerationGuard — geração muda no caminho de REJEIÇÃO (gate crítico)', () => {
  it('fn() rejeita, e a geração mudou durante a chamada: identity_changed, NUNCA o erro original da geração morta', async () => {
    const queryClient = client();
    const originalError = new Error('stale_write');
    const result = runVisitMutationWithGenerationGuard(queryClient, 'my_op', async () => {
      bumpQueryCacheGeneration(queryClient);
      throw originalError;
    });
    await expect(result).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    await expect(result).rejects.not.toBe(originalError);
  });

  it('onConflictError NUNCA é chamado quando a geração mudou (decisão de invalidar pertence só à geração viva)', async () => {
    const queryClient = client();
    let conflictCalls = 0;
    const result = runVisitMutationWithGenerationGuard(
      queryClient,
      'my_op',
      async () => {
        bumpQueryCacheGeneration(queryClient);
        throw new Error('stale_write');
      },
      { onConflictError: () => { conflictCalls += 1; } },
    );
    await expect(result).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
    expect(conflictCalls).toBe(0);
  });
});

describe('runVisitMutationWithGenerationGuard — onConflictError com geração válida', () => {
  it('fn() rejeita com geração ainda válida: onConflictError roda com o erro real, e o erro real é propagado', async () => {
    const queryClient = client();
    const originalError = new Error('stale_write');
    let receivedError: unknown;
    await expect(
      runVisitMutationWithGenerationGuard(
        queryClient,
        'my_op',
        async () => { throw originalError; },
        { onConflictError: (error) => { receivedError = error; } },
      ),
    ).rejects.toBe(originalError);
    expect(receivedError).toBe(originalError);
  });

  it('sem onConflictError fornecido: rejeição com geração válida simplesmente propaga (sem erro por ausência do callback)', async () => {
    const queryClient = client();
    await expect(
      runVisitMutationWithGenerationGuard(queryClient, 'my_op', async () => { throw new Error('forbidden'); }),
    ).rejects.toThrow('forbidden');
  });

  it('identity_changed lançado é reconhecido por isRemoteVisitsError', async () => {
    const queryClient = client();
    const result = runVisitMutationWithGenerationGuard(queryClient, 'op', async () => {
      bumpQueryCacheGeneration(queryClient);
      return 'x';
    });
    await expect(result).rejects.toSatisfy((e: unknown) => isRemoteVisitsError(e));
  });
});

describe('runVisitMutationWithGenerationGuard — isolamento em relação ao guard de Tasks', () => {
  it('o erro identity_changed de Visits NUNCA é remote_tasks_mutation_identity_changed', async () => {
    const queryClient = client();
    const result = runVisitMutationWithGenerationGuard(queryClient, 'op', async () => {
      bumpQueryCacheGeneration(queryClient);
      return 'x';
    });
    await expect(result).rejects.toMatchObject({ code: 'remote_visits_mutation_identity_changed' });
  });
});
