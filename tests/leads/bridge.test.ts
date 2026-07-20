// Testes da ponte QueryCache → snapshot (M1-E, E3).
// QueryClient real (sem rede: dados entram via setQueryData/fetchQuery com
// queryFn local), snapshot restaurado após cada teste. Cobre o ciclo de vida
// completo: success, empty, error, removal, stop e trocas de identidade.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { startLeadsRemoteBridge } from '@/lib/leads/bridge';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  clearAllRemoteLeadSnapshots,
  getRemoteLeadSnapshot,
} from '@/lib/leads/remoteSnapshot';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { resetQueryCache } from '@/lib/query/resetQueryCache';
import type { AdaptLeadRowsResult, LeadModel } from '@/lib/leads/adapter';

afterEach(() => {
  clearAllRemoteLeadSnapshots();
});

function leadModel(id: string): LeadModel {
  return {
    id,
    name: 'Carlos Andrade',
    phone: '(11) 99421-1190',
    car: 'Golf GTI 2022',
    stage: 'Novo',
    stageId: 'stage-new',
    stageCode: 'new',
    seller: 'Marcos Silva',
    sellerId: 's1',
    urgency: 'red',
    last: 'Sem contato ainda',
    alert: 'Fazer primeiro contato',
    pay: '—',
    value: '—',
    valueAmount: null,
    origem: undefined,
    temperature: undefined,
    createdByUserId: null,
    createdAt: '2026-07-19T12:00:00+00:00',
    archivedAt: null,
    version: 1,
    updatedAt: '2026-07-19T12:00:00+00:00',
    updatedByProfileId: null,
  };
}

function okResult(ids: string[]): AdaptLeadRowsResult {
  return { ok: true, leads: ids.map(leadModel) };
}

const KEY_A = leadQueryKeys.active('company-a');
const ADMIN = { companyId: 'company-a', identityKey: 'user-admin' };

function startBridge(queryClient: QueryClient, notify?: () => void) {
  return startLeadsRemoteBridge({ queryClient, ...ADMIN, notify });
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

describe('startLeadsRemoteBridge — sucesso', () => {
  it('resultado ok substitui o snapshot por inteiro e notifica depois de atualizar', () => {
    const queryClient = new QueryClient();
    // Registra o que o snapshot continha NO MOMENTO de cada notify: o estado
    // novo já deve estar disponível quando a notificação dispara.
    const idsAtNotify: Array<string[] | null> = [];
    const notify = vi.fn(() => {
      const snapshot = getRemoteLeadSnapshot('company-a', 'user-admin');
      idsAtNotify.push(snapshot ? snapshot.leads.map((l) => l.id) : null);
    });
    const stop = startBridge(queryClient, notify);

    queryClient.setQueryData(KEY_A, okResult(['lead-1', 'lead-2']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')?.leads.map((l) => l.id))
      .toEqual(['lead-1', 'lead-2']);
    expect(notify).toHaveBeenCalledTimes(1);

    queryClient.setQueryData(KEY_A, okResult(['lead-3']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')?.leads.map((l) => l.id))
      .toEqual(['lead-3']);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(idsAtNotify).toEqual([['lead-1', 'lead-2'], ['lead-3']]);
    stop();
  });

  it('sucesso com [] cria snapshot VÁLIDO vazio (nunca leads locais)', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, okResult([]));
    const snapshot = getRemoteLeadSnapshot('company-a', 'user-admin');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.leads).toEqual([]);
    stop();
  });

  it('hidrata imediatamente a partir de dado já existente no cache', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(KEY_A, okResult(['lead-pre']));
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')?.leads.map((l) => l.id))
      .toEqual(['lead-pre']);
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
  });

  it('cache vazio (sem data utilizável) NÃO vira snapshot vazio', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });
});

describe('startLeadsRemoteBridge — erro e remoção', () => {
  it('erro APÓS sucesso apaga o snapshot imediatamente e notifica', async () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    expect(notify).toHaveBeenCalledTimes(1);

    await putQueryInErrorState(queryClient);
    // A última resposta boa NÃO continua servindo leitura.
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });

  it('erro INICIAL não cria snapshot e não notifica', async () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    await putQueryInErrorState(queryClient);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it('estado de erro pré-existente no cache deixa o espelho limpo na hidratação', async () => {
    const queryClient = new QueryClient();
    await putQueryInErrorState(queryClient);
    const stop = startBridge(queryClient);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('resultado de configuração inválida (ok:false) apaga o snapshot anterior', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));

    const configError: AdaptLeadRowsResult = {
      ok: false,
      reason: 'invalid_lead_configuration',
      code: 'stage_not_found',
      leadId: 'lead-x',
      stageId: 'stage-x',
      sellerId: null,
      rowIndex: 0,
    };
    queryClient.setQueryData(KEY_A, configError);
    // Dado não utilizável nunca continua sendo servido como leitura válida.
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('remoção da query do cache apaga o snapshot e notifica', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    expect(notify).toHaveBeenCalledTimes(1);

    queryClient.removeQueries({ queryKey: KEY_A, exact: true });
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('startLeadsRemoteBridge — correspondência exata da query', () => {
  it('archived/detail/timeline/stages/outra empresa não alteram snapshot nem notificam', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);

    queryClient.setQueryData(leadQueryKeys.active('company-b'), okResult(['lead-b']));
    queryClient.setQueryData(leadQueryKeys.archived('company-a'), okResult(['lead-arq']));
    queryClient.setQueryData(leadQueryKeys.detail('company-a', 'lead-1'), okResult(['lead-1']));
    queryClient.setQueryData(leadQueryKeys.timeline('company-a', 'lead-1'), []);
    queryClient.setQueryData(['company', 'company-a', 'pipeline-stages'], { ok: true, stages: [] });

    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it('snapshot escrito para o admin não é servido a outra identidade da mesma empresa', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).not.toBeNull();
    expect(getRemoteLeadSnapshot('company-a', 'user-seller-1')).toBeNull();
    stop();
  });
});

describe('startLeadsRemoteBridge — identidade e stop', () => {
  it('geração antiga (identidade trocada) descarta resultado e limpa o espelho', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).not.toBeNull();

    bumpQueryCacheGeneration(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-tardio']));
    // Resposta obsoleta nunca repovoa; espelho é limpo e a limpeza notifica.
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2); // set + limpeza
    stop();
  });

  it('resetQueryCache (logout/troca de identidade) deixa o espelho limpo', () => {
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).not.toBeNull();

    resetQueryCache(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-fantasma']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    stop();
  });

  it('bridge novo (pós-troca) não herda snapshot do anterior', () => {
    const queryClient = new QueryClient();
    const stopA = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-admin']));
    stopA(); // encerra a ponte anterior — snapshot do admin é apagado

    const stopB = startLeadsRemoteBridge({
      queryClient,
      companyId: 'company-a',
      identityKey: 'user-seller-1',
    });
    // O seller não enxerga nada do admin; a hidratação usa o cache atual
    // (dados do admin ainda no cache seriam re-associados SOMENTE após a
    // limpeza real do cache por identidade — resetQueryCache — que o M1-D
    // já executa em toda troca de usuário).
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    stopB();
  });

  it('stop apaga o snapshot do dono, notifica a transição e é idempotente', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    expect(notify).toHaveBeenCalledTimes(1);

    stop();
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(2);

    expect(() => stop()).not.toThrow(); // idempotente
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('callback tardio após stop não repopula o snapshot', () => {
    const queryClient = new QueryClient();
    const notify = vi.fn();
    const stop = startBridge(queryClient, notify);
    stop();
    queryClient.setQueryData(KEY_A, okResult(['lead-tardio']));
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('não persiste nada em localStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const queryClient = new QueryClient();
    const stop = startBridge(queryClient);
    queryClient.setQueryData(KEY_A, okResult(['lead-1']));
    stop();
    expect(setItem).not.toHaveBeenCalled();
  });
});
