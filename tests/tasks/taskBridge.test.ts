// Testes da ponte QueryCache → snapshot de Tasks (COMMERCIAL-REMOTE-B1-
// B2-B2-A). QueryClient real (sem rede: dados entram via setQueryData/
// fetchQuery com queryFn local), snapshot restaurado após cada teste.
// Cobre o ciclo de vida completo: hidratação inicial (success/empty/
// error/loading/absent), success/empty/error/removed em voo, geração
// morta (inerte), stop e isolamento de dono/query.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { startTaskRemoteBridge } from '@/lib/tasks/taskBridge';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import {
  buildRemoteTaskSnapshot,
  clearAllRemoteTaskSnapshots,
  getRemoteTaskSnapshot,
  setRemoteTaskSnapshot,
} from '@/lib/tasks/remoteTaskSnapshot';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { resetQueryCache } from '@/lib/query/resetQueryCache';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

afterEach(() => {
  clearAllRemoteTaskSnapshots();
});

function taskRow(overrides: Partial<RemoteTaskRow> = {}): RemoteTaskRow {
  return {
    id: 'task-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    title: 'Ligar para Carlos',
    note: '',
    priority: 'alta',
    status: 'pending',
    due_at: '2026-08-21T17:00:00+00:00',
    completed_at: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    completed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
    version: 1,
    ...overrides,
  };
}

const KEY_A = taskQueryKeys.active('company-a');
const ADMIN = { companyId: 'company-a', identityKey: 'user-admin' };

function startBridge(queryClient: QueryClient, notify?: () => void) {
  return startTaskRemoteBridge({ queryClient, ...ADMIN, notify });
}

async function putQueryInErrorState(queryClient: QueryClient): Promise<void> {
  await queryClient
    .fetchQuery({
      queryKey: KEY_A,
      queryFn: () => Promise.reject(new Error('permission denied')),
      retry: false,
    })
    .catch(() => {});
}

// ── §25/§30: hidratação inicial — success já no cache (gate obrigatório) ──

describe('startTaskRemoteBridge — hidratação inicial: success já no cache', () => {
  it('rows já em success no cache populam o snapshot IMEDIATAMENTE, sem esperar evento', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-pre' })]);
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows.map((r) => r.id)).toEqual(['task-pre']);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it('§26: success com [] já no cache produz snapshot PRESENTE com rows=[] (nunca absent)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY_A, [] as RemoteTaskRow[]);
    const stop = startBridge(queryClient);
    const snapshot = getRemoteTaskSnapshot('company-a', 'user-admin');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rows).toEqual([]);
    stop();
  });
});

// ── §27: query ausente ──────────────────────────────────────────────────

describe('startTaskRemoteBridge — hidratação inicial: query ausente', () => {
  it('nenhuma query no cache ⇒ snapshot absent; evento futuro popula normalmente', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();

    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-tardio' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows.map((r) => r.id)).toEqual(['task-tardio']);
    stop();
  });

  it('não lança erro ao iniciar sem nenhuma query correspondente', () => {
    const queryClient = new QueryClient();
    expect(() => startBridge(queryClient)).not.toThrow();
  });
});

// ── §28: query loading no start ──────────────────────────────────────────

describe('startTaskRemoteBridge — hidratação inicial: query loading', () => {
  it('query pending (sem data) no start ⇒ snapshot absent, nenhum vazio fabricado', () => {
    const queryClient = new QueryClient();
    // Dispara um fetch que nunca resolve neste teste — query fica pending.
    void queryClient.fetchQuery({
      queryKey: KEY_A,
      queryFn: () => new Promise<RemoteTaskRow[]>(() => {}),
    });
    const stop = startBridge(queryClient);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('snapshot antigo do MESMO dono é removido se o bridge (re)inicia com a query ainda loading (defesa em profundidade — cenário construído diretamente, não alcançável em uso normal)', () => {
    const queryClient = new QueryClient();
    // Semeia um snapshot "sobrevivente" diretamente (bypass do bridge) para
    // provar que a hidratação inicial o remove mesmo sem um bridge anterior
    // real produzi-lo nesta execução.
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow({ id: 'task-obsoleta' })], ADMIN));
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).not.toBeNull();

    void queryClient.fetchQuery({
      queryKey: KEY_A,
      queryFn: () => new Promise<RemoteTaskRow[]>(() => {}),
    });
    const stop = startBridge(queryClient);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });
});

// ── §29: erro já no cache no start ───────────────────────────────────────

describe('startTaskRemoteBridge — hidratação inicial: erro já no cache', () => {
  it('estado de erro pré-existente deixa o espelho limpo, nenhum dado antigo servido', async () => {
    const queryClient = new QueryClient();
    await putQueryInErrorState(queryClient);
    const stop = startBridge(queryClient);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('snapshot antigo do mesmo dono é limpo quando a query já está error no start', async () => {
    const queryClient = new QueryClient();
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow()], ADMIN));
    await putQueryInErrorState(queryClient);
    const stop = startBridge(queryClient);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });
});

// ── §30/§31: replace / empty replace ─────────────────────────────────────

describe('startTaskRemoteBridge — substituição em voo', () => {
  it('sucesso substitui o snapshot POR INTEIRO (nunca merge/append)', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);

    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-a' }), taskRow({ id: 'task-b' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows.map((r) => r.id))
      .toEqual(['task-a', 'task-b']);

    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-c' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows.map((r) => r.id))
      .toEqual(['task-c']); // nunca ['task-a','task-b','task-c']
    stop();
  });

  it('atualização para [] mantém o snapshot PRESENTE com rows=[] (limpa Tasks antigas)', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows).toHaveLength(1);

    queryClient.setQueryData(KEY_A, [] as RemoteTaskRow[]);
    const snapshot = getRemoteTaskSnapshot('company-a', 'user-admin');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.rows).toEqual([]);
    stop();
  });

  it('rows recebidas nunca compartilham array mutável com o caller (cópia defensiva)', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    const rows = [taskRow({ id: 'task-a' })];
    queryClient.setQueryData(KEY_A, rows);
    rows.push(taskRow({ id: 'task-intruso' }));
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows.map((r) => r.id)).toEqual(['task-a']);
    stop();
  });
});

// ── §32/§33: erro e remoção em voo ────────────────────────────────────────

describe('startTaskRemoteBridge — erro e remoção em voo', () => {
  it('erro APÓS sucesso apaga o snapshot imediatamente e notifica', async () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    expect(notify).toHaveBeenCalledTimes(1);

    await putQueryInErrorState(queryClient);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });

  it('remoção da query do cache apaga o snapshot e notifica', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    expect(notify).toHaveBeenCalledTimes(1);

    queryClient.removeQueries({ queryKey: KEY_A, exact: true });
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });
});

// ── §34: eventos não relacionados ────────────────────────────────────────

describe('startTaskRemoteBridge — correspondência exata da query', () => {
  it('outra company, outra query e eventos não relacionados não alteram o snapshot nem notificam', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);

    queryClient.setQueryData(taskQueryKeys.active('company-b'), [taskRow({ company_id: 'company-b' })]);
    queryClient.setQueryData(['company', 'company-a', 'leads'], [{ id: 'lead-1' }]);
    queryClient.setQueryData(['company', 'company-a', 'seller-labels', 'remote', 'user-admin'], []);

    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it('snapshot escrito para o admin não é servido a outra identidade da mesma empresa', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).not.toBeNull();
    expect(getRemoteTaskSnapshot('company-a', 'user-seller-1')).toBeNull();
    stop();
  });
});

// ── §35/§36: geração ──────────────────────────────────────────────────────

describe('startTaskRemoteBridge — geração', () => {
  it('bumpQueryCacheGeneration ANTES do start não produz mismatch — generationAtStart é sempre capturada fresca no momento do start, então um bridge recém-iniciado nunca nasce inerte por uma troca de identidade que já tinha terminado antes dele existir', () => {
    // Prova o inverso do que se poderia presumir ingenuamente: bumpar a
    // geração e SÓ DEPOIS chamar startTaskRemoteBridge não é o cenário de
    // corrida — generationAtStart é lida em tempo real na própria chamada,
    // então "geração mudou antes do start" e "nenhuma mudança" são
    // indistinguíveis do ponto de vista do bridge. A hidratação inicial
    // síncrona (subscribe → capturar geração → ler estado atual, sem
    // nenhum await entre os passos) torna a janela de corrida descrita no
    // precheck §17 estruturalmente inexistente — não por omissão do
    // guard (ele existe e roda, ver o teste de mismatch EM VOO abaixo,
    // que exercita a MESMA função applyRows), mas porque não há como
    // interpor uma mudança de geração entre a captura e a escrita dentro
    // de uma função inteiramente síncrona.
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-pre' })]);
    bumpQueryCacheGeneration(queryClient);

    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows.map((r) => r.id)).toEqual(['task-pre']);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it('geração muda DURANTE a vida do bridge: evento chega depois ⇒ descartado, snapshot limpo, bridge fica inerte permanentemente', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-1' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).not.toBeNull();

    bumpQueryCacheGeneration(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-tardio' })]);
    // Resposta obsoleta nunca repovoa; o snapshot é limpo pela detecção de
    // geração morta.
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();

    // Um SEGUNDO evento pós-mismatch também não escreve — bridge é
    // definitivamente inerte, não só "descartou uma vez".
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-tardio-2' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('resetQueryCache (logout/troca de identidade) deixa o espelho limpo e o bridge inerte', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).not.toBeNull();

    resetQueryCache(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-fantasma' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('bridge novo (pós-troca) não herda snapshot do anterior', () => {
    const queryClient = new QueryClient();
    const stopA = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-admin' })]);
    stopA();

    const stopB = startTaskRemoteBridge({
      queryClient,
      companyId: 'company-a',
      identityKey: 'user-seller-1',
    });
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    stopB();
  });
});

// ── §37: stop ───────────────────────────────────────────────────────────

describe('startTaskRemoteBridge — stop', () => {
  it('stop apaga o snapshot do dono, notifica a transição e é idempotente', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    expect(notify).toHaveBeenCalledTimes(1);

    stop();
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);

    expect(() => stop()).not.toThrow();
    expect(notify).toHaveBeenCalledTimes(2); // segunda chamada não gera notify extra
  });

  it('evento tardio após stop não repopula o snapshot', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    stop();
    queryClient.setQueryData(KEY_A, [taskRow({ id: 'task-tardio' })]);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('stop sem nenhum dado prévio não notifica (nada para limpar)', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    stop();
    expect(notify).not.toHaveBeenCalled();
  });
});

// ── §38/§39: notify e isolamento de dono ──────────────────────────────────

describe('startTaskRemoteBridge — notify sem ruído', () => {
  it('evento não relacionado nunca dispara notify', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(taskQueryKeys.active('company-b'), [taskRow({ company_id: 'company-b' })]);
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it('reentrega da MESMA referência de rows não dispara notify (dedup, sem deep-compare)', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    const rows = [taskRow()];
    queryClient.setQueryData(KEY_A, rows);
    expect(notify).toHaveBeenCalledTimes(1);

    // Mesma referência reaplicada via setQueryData (TanStack preserva a
    // referência quando o valor não muda) não deve gerar uma segunda
    // notificação.
    queryClient.setQueryData(KEY_A, rows);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('startTaskRemoteBridge — validação de dono e ausência de persistência', () => {
  it('companyId ou identityKey vazios lançam RemoteTasksError, nunca iniciam sem dono completo', () => {
    const queryClient = new QueryClient();
    expect(() => startTaskRemoteBridge({ queryClient, companyId: '', identityKey: 'u' }))
      .toThrow('remote_tasks_invalid_context');
    expect(() => startTaskRemoteBridge({ queryClient, companyId: 'c', identityKey: '  ' }))
      .toThrow('remote_tasks_invalid_context');
  });

  it('não persiste nada em localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, [taskRow()]);
    stop();
    expect(setItem).not.toHaveBeenCalled();
  });
});
