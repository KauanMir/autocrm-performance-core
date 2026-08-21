// lib/hooks/useRemoteDealsScreenState.ts — composição de leitura remota de
// Deals (COMMERCIAL-REMOTE-DEALS-B2-A). Único ponto que combina useDeals +
// useAdaptedRemoteDeals com a MESMA identidade e o MESMO contrato de flags
// — futuros consumidores (ScreenPropostas/Negociações, fora do escopo desta
// etapa) chamarão este hook, nunca os dois hooks separadamente. Mesmo
// padrão exato de lib/hooks/useRemoteVisitsScreenState.ts/
// lib/hooks/useRemoteTasksScreenState.ts.
//
// Diferente de useRemoteVisitsScreenState: SEM composição com
// useRemoteLeadsScreenState — o adapter de Deals não precisa de leadsById
// (client_name_snapshot já resolvido na própria row, B2-A-PRECHECK §10), e
// a dependência de Leads para o MODO (blocked/misconfigured) já é resolvida
// inteiramente dentro de resolveDealRemoteMode()/useDeals. Menos um hook
// interno, mesma garantia de Rules of Hooks (sempre chamados, mesma ordem).
//
// Identidade vem por parâmetro (currentUser) — este hook não importa
// AuthService. A fórmula de identidade válida (userId + companyId +
// userIsActive + role manager/seller) é EXATAMENTE a mesma usada pelo
// outro ponto de gating de Deals (a query dentro de useDeals) — nunca
// diverge de quando a query real está habilitada.
//
// HARD GATE: TanStack Query pode continuar expondo dado cacheado mesmo com
// `enabled=false` ou após um erro — por isso o mode final decide sozinho se
// alguma Deal é exposta, nunca o cache por si só. Fora de
// `deal_remote_active`, ou dentro dele durante loading/erro inicial,
// `rowsForAdaptation` é sempre `[]`: nenhuma Deal cacheada de um estado
// ativo anterior pode vazar para local/blocked/misconfigured/
// unavailable-identity/loading/erro.
import type { User } from '@/lib/data';
import { useDeals } from '@/lib/hooks/useDeals';
import { useAdaptedRemoteDeals } from '@/lib/hooks/useAdaptedRemoteDeals';
import {
  isDealAdapterError,
  type DealAdapterError,
  type RemoteDealModel,
  type RemoteDealRow,
} from '@/lib/deals/adapter';

export type DealScreenMode =
  // deal_remote_ready=false e Leads também local — caminho local existente
  // (DealService/localStorage), este hook não decide mais nada.
  | 'deal_local'
  // Rollout parcial esperado: Leads já remote_ready, REMOTE_DEALS ainda
  // off — nunca tratado como erro (lib/deals/remoteDealsMode.ts).
  | 'deal_blocked'
  // Config de base inválida (própria ou propagada de Leads) — falha
  // fechada, nenhuma bridge, nenhum dado local nem remoto.
  | 'deal_remote_misconfigured'
  // deal_remote_ready, mas o ator atual não qualifica (sem membership
  // ativa/operacional, não é Manager/Seller, ou usuário global inativo).
  | 'deal_remote_unavailable_identity'
  // Caminho remoto efetivo: useDeals/useAdaptedRemoteDeals são a
  // autoridade de loading/error/config-error/empty/success.
  | 'deal_remote_active';

export type UseRemoteDealsScreenStateResult = {
  mode: DealScreenMode;
  deals: readonly RemoteDealModel[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  configError: DealAdapterError | null;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const EMPTY_ROWS: readonly RemoteDealRow[] = Object.freeze([]);
const EMPTY_DEALS: readonly RemoteDealModel[] = Object.freeze([]);

export function useRemoteDealsScreenState(
  currentUser: User | null,
): UseRemoteDealsScreenStateResult {
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';
  const hasIdentity =
    isManagerOrSeller && userIsActive && Boolean(companyId) && Boolean(userId);

  // Chamado SEMPRE, na mesma ordem (Rules of Hooks). dealRemoteMode vem do
  // PRÓPRIO retorno de useDeals (nunca recalculado por uma segunda chamada
  // a resolveDealRemoteMode aqui) — garante, por construção, que o mode
  // usado para decidir loading/error/gate é o MESMO valor que decidiu
  // `queryEnabled` dentro de useDeals (nenhuma divergência).
  const dealsQuery = useDeals({ userId, companyId, membershipRole, userIsActive });

  let mode: DealScreenMode;
  if (dealsQuery.dealRemoteMode === 'deal_local') mode = 'deal_local';
  else if (dealsQuery.dealRemoteMode === 'deal_blocked') mode = 'deal_blocked';
  else if (dealsQuery.dealRemoteMode === 'deal_remote_misconfigured') mode = 'deal_remote_misconfigured';
  else if (!hasIdentity) mode = 'deal_remote_unavailable_identity';
  else mode = 'deal_remote_active';

  const isActive = mode === 'deal_remote_active';
  const activeLoading = isActive && dealsQuery.isLoading;
  const activeError = isActive && dealsQuery.isError;

  // Hard gate NA FONTE: fora do caminho realmente pronto para adaptar
  // (active + não-loading + não-erro), o adapter nunca vê uma row
  // cacheada — sempre []. Hook ainda chamado sempre (Rules of Hooks), só o
  // INPUT muda.
  const rowsForAdaptation = isActive && !activeLoading && !activeError ? dealsQuery.rows : EMPTY_ROWS;
  const adapted = useAdaptedRemoteDeals(rowsForAdaptation);

  let deals: readonly RemoteDealModel[] = EMPTY_DEALS;
  let configError: DealAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isDealAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.deals.length === 0) {
      isEmpty = true;
    } else {
      deals = adapted.deals;
      hasData = true;
    }
  }

  return {
    mode,
    deals,
    isLoading: activeLoading,
    isFetching: isActive ? dealsQuery.isFetching : false,
    isError: activeError,
    error: activeError ? dealsQuery.error : null,
    configError,
    isEmpty,
    hasData,
    refetch: dealsQuery.refetch,
  };
}
