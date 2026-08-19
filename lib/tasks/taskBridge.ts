// lib/tasks/taskBridge.ts — ponte QueryCache → snapshot remoto de Tasks
// (COMMERCIAL-REMOTE-B1-B2-B2-A). Ainda NÃO montada por nenhum componente
// (essa etapa pertence ao lifecycle hook + App wiring, B1-B2-B2-B/B1-B3).
//
// RAW ONLY (precheck §6): trabalha exclusivamente com RemoteTaskRow[] — não
// importa taskAdapter, deriveTaskState, formatTaskWhen, snapshot/catálogo de
// Leads, SellerService, React ou TaskService. Fluxo em sentido único: a
// cada resultado novo da query watched, o snapshot é substituído POR
// INTEIRO (nunca merge/append/patch); erro ou remoção da query APAGAM
// imediatamente o snapshot do dono.
//
// CORREÇÃO A (B1-B2-B2-A-EXEC §0): a geração do cache é validada
// IMEDIATAMENTE antes de toda e qualquer chamada a setRemoteTaskSnapshot —
// inclusive na hidratação inicial, mesmo esta sendo inteiramente síncrona
// (sem await entre o start e a leitura inicial). Defense-in-depth
// deliberada: nunca confiar somente no argumento "sem await, portanto
// race impossível" para omitir a checagem.
//
// CORREÇÃO B (B1-B2-B2-A-EXEC §0): a sincronização inicial NUNCA limpa o
// snapshot cegamente antes de inspecionar o estado atual da query watched.
// Ordem: subscribe → capturar generationAtStart → inspecionar estado
// atual → decidir popular ou limpar. Isso evita uma transição artificial
// dado→ausente/vazio→dado (com notificação duplicada) quando a query já
// tinha um resultado success válido antes do bridge iniciar.
//
// GERAÇÃO MORTA (B2-B2-A-EXEC §12/§13): ao detectar generation !==
// generationAtStart (em qualquer ponto — hidratação inicial ou evento
// futuro), o bridge se torna DEFINITIVAMENTE inerte: limpa o próprio
// snapshot, cancela a subscription e nunca mais processa nada, mesmo que
// stop() externo nunca seja chamado. Este bridge pertence a uma geração
// morta (identidade trocada) — não há motivo para continuar vivo.
import { hashKey, type QueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import { RemoteTasksError } from '@/lib/tasks/errors';
import {
  buildRemoteTaskSnapshot,
  clearRemoteTaskSnapshot,
  setRemoteTaskSnapshot,
} from '@/lib/tasks/remoteTaskSnapshot';

export type TaskRemoteBridgeOptions = {
  queryClient: QueryClient;
  companyId: string;
  // Dono do snapshot (id do usuário autenticado) — a RLS entrega conjuntos
  // diferentes por usuário; o snapshot nunca cruza identidades.
  identityKey: string;
  // Notificação pós-transição (na montagem real, B1-B3, será o notify da
  // store, para os consumidores legados — Home, ScreenPendencias —
  // re-renderizarem via useStore(), mesmo padrão já desenhado para Leads).
  // Só dispara quando o estado disponível de fato muda.
  notify?: () => void;
};

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// Inicia a ponte e retorna a função de parada (idempotente). Guarda de
// geração: resultado que chegue depois de logout/troca de identidade é
// descartado e o espelho do dono é limpo — nunca repovoado.
export function startTaskRemoteBridge(options: TaskRemoteBridgeOptions): () => void {
  const { queryClient, companyId, identityKey, notify } = options;

  if (!isNonEmpty(companyId) || !isNonEmpty(identityKey)) {
    throw new RemoteTasksError('remote_tasks_invalid_context', {
      operation: 'startTaskRemoteBridge',
    });
  }

  // Correspondência EXATA da query observada, pelo mesmo hash que o
  // TanStack usa internamente — outras companies/outras queries têm
  // hashes diferentes e nunca casam (nada de comparação por prefixo).
  const watchedKey = taskQueryKeys.active(companyId);
  const watchedHash = hashKey(watchedKey);
  const generationAtStart = getQueryCacheGeneration(queryClient);

  // Última referência aplicada: eventos que reentregam a MESMA referência
  // (structural sharing do TanStack já evita isso na maioria dos casos,
  // mas o dedup fica explícito aqui) não são uma transição real — sem
  // isso o notify dispararia em não-mudanças. Nenhuma deep equality.
  let lastAppliedRows: RemoteTaskRow[] | undefined;
  // true após stop() OU após o bridge se tornar definitivamente inerte
  // por mismatch de geração — as duas causas produzem o mesmo efeito
  // observável (nunca mais escreve, nunca mais processa eventos).
  let stopped = false;

  const clearOwnAndMaybeNotify = (): void => {
    lastAppliedRows = undefined;
    const cleared = clearRemoteTaskSnapshot(companyId, identityKey);
    if (cleared && notify) notify();
  };

  // Geração morta: pertence a uma identidade que já não existe mais —
  // limpa o que possui, cancela a subscription e nunca mais reage a nada.
  const goInert = (): void => {
    if (stopped) return;
    stopped = true;
    clearOwnAndMaybeNotify();
    unsubscribe();
  };

  const applyRows = (rows: RemoteTaskRow[] | undefined): void => {
    if (stopped) return;
    // Correção A: geração validada IMEDIATAMENTE antes de qualquer
    // escrita — inclusive quando chamado a partir da hidratação inicial
    // síncrona.
    if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
      goInert();
      return;
    }
    // Sem dado utilizável ainda (query pending): nunca fabrica um
    // snapshot vazio — ausência de dados nunca vira snapshot presente.
    if (!rows) {
      clearOwnAndMaybeNotify();
      return;
    }
    if (rows === lastAppliedRows) return; // mesma referência, sem transição
    lastAppliedRows = rows;
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot(rows, { companyId, identityKey }));
    if (notify) notify();
  };

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (stopped) return;
    if (event.query.queryHash !== watchedHash) return;

    // Geração muda no meio da vida do bridge (evento assíncrono, ao
    // contrário da hidratação inicial que roda no mesmo tick) — checagem
    // ANTES de qualquer outra decisão, inclusive antes do branch
    // 'removed'.
    if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
      goInert();
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
        // consumidor passa a falhar explicitamente, nunca serve dado
        // antigo como se fosse atual.
        clearOwnAndMaybeNotify();
        return;
      }
      applyRows(event.query.state.data as RemoteTaskRow[] | undefined);
    }
  });

  // Sincronização inicial (correção B): inspeciona o estado ATUAL da
  // query watched — nunca um clear-then-hydrate cego. Geração checada
  // primeiro (correção A); se já não bate, o bridge nasce inerte e nunca
  // chega a olhar a query.
  if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
    goInert();
  } else {
    const initialState = queryClient.getQueryState(watchedKey);
    if (initialState?.status === 'error') {
      // Estado de erro pré-existente: garante espelho limpo, nunca serve
      // um snapshot antigo do mesmo dono como se refletisse a query atual.
      clearOwnAndMaybeNotify();
    } else if (initialState?.status === 'success') {
      // Sucesso válido já no cache — inclusive [] (zero Tasks pending é
      // um resultado válido, não "indisponível") — popula imediatamente,
      // sem esperar um próximo evento.
      applyRows(initialState.data as RemoteTaskRow[] | undefined);
    } else {
      // Loading ou ausente (query ainda não existe/ainda não resolveu):
      // nenhum dado válido ainda — nunca fabrica snapshot vazio. Um
      // snapshot antigo do MESMO dono (de uma execução anterior do
      // bridge) já não reflete a query atual e é removido.
      clearOwnAndMaybeNotify();
    }
  }

  return function stop(): void {
    if (stopped) return; // idempotente — parar duas vezes é seguro
    stopped = true;
    unsubscribe();
    // O bridge é o único escritor: sem ele, o snapshot do dono deixa de
    // ser confiável — é removido, notificando se o estado disponível mudou.
    clearOwnAndMaybeNotify();
  };
}
