// lib/leads/bridge.ts — ponte QueryCache → snapshot remoto (M1-E, E3).
// Headless e ainda NÃO montada no App (a montagem, junto do notify da store,
// pertence à fase que altera components/App.tsx). Fluxo em sentido único do
// design §10: a cada resultado novo da query de leads da empresa, o snapshot
// é substituído POR INTEIRO; erro ou remoção da query APAGAM imediatamente o
// snapshot do dono — o service nunca continua servindo a última resposta boa
// depois de um erro. Ninguém mais escreve no snapshot; a UI nunca escreve.
//
// Dependências explícitas (queryClient, companyId, identityKey, notify) —
// nada de singleton de QueryClient nem acesso escondido dentro de service.
import { hashKey, type QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import type { AdaptLeadRowsResult } from '@/lib/leads/adapter';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import {
  clearRemoteLeadSnapshot,
  setRemoteLeadSnapshot,
} from '@/lib/leads/remoteSnapshot';

export type LeadsRemoteBridgeOptions = {
  queryClient: QueryClient;
  companyId: string;
  // Dono do snapshot (id do usuário autenticado) — a RLS entrega conjuntos
  // diferentes por usuário; o snapshot nunca cruza identidades.
  identityKey: string;
  // Notificação pós-transição (na montagem real será o notify da store, para
  // os consumidores legados re-renderizarem via useStore()). Dependência
  // explícita — a store NÃO é importada aqui. Só dispara quando o estado
  // disponível de fato muda (novo snapshot ou limpeza real).
  notify?: () => void;
};

// Inicia a ponte e retorna a função de parada (idempotente). Guarda de
// geração (M1-D): resultado que chegue depois de logout/troca de identidade
// é descartado e o espelho do dono é limpo — nunca repovoado.
export function startLeadsRemoteBridge(options: LeadsRemoteBridgeOptions): () => void {
  const { queryClient, companyId, identityKey, notify } = options;

  // Correspondência EXATA da query observada, pelo mesmo hash que o TanStack
  // usa internamente — archived/detail/timeline/stages/outras empresas têm
  // hashes diferentes e nunca casam (nada de comparação por prefixo).
  const watchedKey = leadQueryKeys.active(companyId);
  const watchedHash = hashKey(watchedKey);
  const generationAtStart = getQueryCacheGeneration(queryClient);

  // Última referência aplicada: eventos 'updated' que reentregam o MESMO
  // resultado (início de fetch, invalidation) não são transição — sem isso o
  // notify dispararia em não-mudanças.
  let lastAppliedData: unknown;

  const clearOwnAndMaybeNotify = (): void => {
    lastAppliedData = undefined;
    const cleared = clearRemoteLeadSnapshot(companyId, identityKey);
    if (cleared && notify) notify();
  };

  const applyData = (data: unknown): void => {
    const result = data as AdaptLeadRowsResult | undefined;
    // Sem data utilizável ainda (pending): não cria snapshot nenhum —
    // ausência de dados nunca vira snapshot vazio.
    if (!result) return;
    if (result.ok !== true) {
      // Dados remotos incompatíveis (stage/seller órfão): o snapshot antigo
      // NÃO pode continuar servindo leitura — é apagado; o erro permanece
      // exposto pelo hook (configError).
      clearOwnAndMaybeNotify();
      return;
    }
    if (result === lastAppliedData) return; // mesmo resultado, sem transição
    lastAppliedData = result;
    setRemoteLeadSnapshot({
      source: 'remote',
      companyId,
      identityKey,
      leads: result.leads,
    });
    if (notify) notify();
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== watchedHash) return;

    // Identidade mudou (resetQueryCache já incrementou a geração): esta ponte
    // é obsoleta — limpa o espelho do dono e ignora qualquer evento, inclusive
    // respostas atrasadas da identidade anterior.
    if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
      clearOwnAndMaybeNotify();
      return;
    }

    if (event.type === 'removed') {
      // Query saiu do cache: nenhum dado remoto autoritativo disponível.
      clearOwnAndMaybeNotify();
      return;
    }

    if (event.type === 'updated') {
      if (event.query.state.status === 'error') {
        // Erro remoto: o snapshot da última resposta boa é apagado — o
        // LeadService passa a falhar explicitamente; o erro fica no hook.
        clearOwnAndMaybeNotify();
        return;
      }
      applyData(event.query.state.data);
    }
  });

  // Hidratação imediata a partir do estado já existente no cache: sucesso
  // válido popula; estado de erro pré-existente garante espelho limpo.
  const initialState = queryClient.getQueryState(watchedKey);
  if (initialState?.status === 'error') {
    clearOwnAndMaybeNotify();
  } else {
    applyData(initialState?.data);
  }

  let stopped = false;
  return function stop(): void {
    if (stopped) return; // idempotente — parar duas vezes é seguro
    stopped = true;
    unsubscribe();
    // A ponte é a única escritora: sem ela, o snapshot do dono deixa de ser
    // confiável — é removido, notificando se o estado disponível mudou.
    clearOwnAndMaybeNotify();
  };
}
