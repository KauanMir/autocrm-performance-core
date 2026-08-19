// lib/hooks/useTasks.ts — leitura remota de Tasks (COMMERCIAL-REMOTE-B1-
// B2-B1). Ainda NÃO consumido por nenhuma tela/componente.
//
// Identidade vem por parâmetro (o componente resolve o usuário ativo) —
// este hook não importa AuthService. Rules of Hooks: useQuery é chamado
// SEMPRE, na mesma ordem, com `enabled` fazendo o gating.
//
// Segurança: nenhum company_id é enviado ao Supabase — a RLS
// (tasks_select) é a autoridade de isolamento; o companyId aparece
// apenas na query key, para particionar o cache por empresa. Com modo
// remote_ready, erro remoto NUNCA cai para Tasks locais (sem mistura de
// fontes, sem initialData/placeholderData locais).
//
// Dado canônico é RAW (B1-B2-B precheck §11/§21): a queryFn NÃO adapta
// com Lead/Seller catalog — retorna RemoteTaskRow[] tal como veio do
// banco. A conversão para RemoteTaskModel[] (lib/tasks/taskAdapter.ts)
// acontece fora deste hook, num passo posterior (B1-B2-B2/B3) que também
// reage a mudanças de catálogo/dia sem precisar de um novo fetch daqui.
import { useQuery } from '@tanstack/react-query';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';
import { taskQueryKeys } from '@/lib/tasks/taskQueryKeys';
import { fetchPendingTaskRows } from '@/lib/tasks/remoteTaskRepository';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

export type UseTasksOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type UseTasksResult = {
  taskRemoteMode: ReturnType<typeof resolveTaskRemoteMode>;
  queryEnabled: boolean;
  queryKey: readonly unknown[];
  rows: readonly RemoteTaskRow[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

// Key sentinela usada SOMENTE quando não há companyId válido (enabled=
// false, zero requests): as keys reais têm string não vazia no segundo
// segmento, então esta nunca colide com cache de empresa alguma — mesmo
// padrão de DISABLED_LEADS_QUERY_KEY (lib/hooks/useLeads.ts:57).
const DISABLED_TASKS_QUERY_KEY = ['company', null, 'tasks', 'disabled'] as const;

const EMPTY_TASK_ROWS: readonly RemoteTaskRow[] = Object.freeze([]);

export function useTasks(options: UseTasksOptions): UseTasksResult {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const taskRemoteMode = resolveTaskRemoteMode();
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled =
    taskRemoteMode === 'task_remote_ready' &&
    Boolean(userId) &&
    hasCompany &&
    userIsActive &&
    isManagerOrSeller;

  const queryKey = hasCompany
    ? taskQueryKeys.active(companyId as string)
    : DISABLED_TASKS_QUERY_KEY;

  // Declarada SEMPRE (modo não remote_ready ⇒ enabled=false, zero
  // chamadas). Usa os defaults do QueryClient do AppProviders — nada de
  // staleTime/retry aqui (mesmos valores aprovados para leads/pipeline
  // stages, B1-B2-B precheck §30 — refetchOnWindowFocus:true do default
  // global já cobre o caso multiusuário de Tasks sem override nenhum).
  const query = useQuery<RemoteTaskRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchPendingTaskRows,
  });

  const rows = query.data ?? EMPTY_TASK_ROWS;

  return {
    taskRemoteMode,
    queryEnabled,
    queryKey,
    rows,
    isLoading: queryEnabled ? query.isLoading : false,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    isEmpty: Boolean(query.data && query.data.length === 0),
    hasData: Boolean(query.data && query.data.length > 0),
    refetch: query.refetch,
  };
}
