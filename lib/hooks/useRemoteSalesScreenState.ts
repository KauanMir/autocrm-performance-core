// lib/hooks/useRemoteSalesScreenState.ts — composição de leitura remota de
// Sales (COMMERCIAL-REMOTE-SALES-A2). Único ponto que combina useSales +
// useAdaptedRemoteSales com a MESMA identidade e o MESMO contrato de flags
// — ScreenVendas (remote branch) consome este hook, nunca os dois hooks
// separadamente. Mesmo padrão exato de lib/hooks/useRemoteDealsScreenState.ts.
//
// Identidade vem por parâmetro (currentUser) — este hook não importa
// AuthService. A fórmula de identidade válida (userId + companyId +
// userIsActive + role manager/seller) é EXATAMENTE a mesma usada pelo
// outro ponto de gating de Sales (a query dentro de useSales) — nunca
// diverge de quando a query real está habilitada.
//
// HARD GATE: TanStack Query pode continuar expondo dado cacheado mesmo com
// `enabled=false` ou após um erro — por isso o mode final decide sozinho se
// alguma Sale é exposta, nunca o cache por si só. Fora de
// `sale_remote_active`, ou dentro dele durante loading/erro inicial,
// `rowsForAdaptation` é sempre `[]`: nenhuma Sale cacheada de um estado
// ativo anterior pode vazar para local/blocked/misconfigured/
// unavailable-identity/loading/erro.
import type { User } from '@/lib/data';
import { useSales } from '@/lib/hooks/useSales';
import { useAdaptedRemoteSales } from '@/lib/hooks/useAdaptedRemoteSales';
import {
  isSaleAdapterError,
  type SaleAdapterError,
  type RemoteSaleModel,
  type RemoteSaleRow,
} from '@/lib/sales/adapter';

export type SaleScreenMode =
  // sale_remote_ready=false e Deals também local — caminho local existente
  // (SaleService/localStorage), este hook não decide mais nada.
  | 'sale_local'
  // Rollout parcial esperado: Deals já deal_remote_ready, REMOTE_SALES
  // ainda off — nunca tratado como erro (lib/sales/remoteSalesMode.ts).
  | 'sale_blocked'
  // Config de base inválida (própria ou propagada de Deals) — falha
  // fechada, nenhuma bridge, nenhum dado local nem remoto.
  | 'sale_remote_misconfigured'
  // sale_remote_ready, mas o ator atual não qualifica (sem membership
  // ativa/operacional, não é Manager/Seller, ou usuário global inativo).
  | 'sale_remote_unavailable_identity'
  // Caminho remoto efetivo: useSales/useAdaptedRemoteSales são a
  // autoridade de loading/error/config-error/empty/success.
  | 'sale_remote_active';

export type UseRemoteSalesScreenStateResult = {
  mode: SaleScreenMode;
  sales: readonly RemoteSaleModel[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  configError: SaleAdapterError | null;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const EMPTY_ROWS: readonly RemoteSaleRow[] = Object.freeze([]);
const EMPTY_SALES: readonly RemoteSaleModel[] = Object.freeze([]);

export function useRemoteSalesScreenState(
  currentUser: User | null,
): UseRemoteSalesScreenStateResult {
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';
  const hasIdentity =
    isManagerOrSeller && userIsActive && Boolean(companyId) && Boolean(userId);

  // Chamado SEMPRE, na mesma ordem (Rules of Hooks). saleRemoteMode vem do
  // PRÓPRIO retorno de useSales (nunca recalculado por uma segunda chamada
  // a resolveSalesRemoteMode aqui) — garante, por construção, que o mode
  // usado para decidir loading/error/gate é o MESMO valor que decidiu
  // `queryEnabled` dentro de useSales (nenhuma divergência).
  const salesQuery = useSales({ userId, companyId, membershipRole, userIsActive });

  let mode: SaleScreenMode;
  if (salesQuery.saleRemoteMode === 'sale_local') mode = 'sale_local';
  else if (salesQuery.saleRemoteMode === 'sale_blocked') mode = 'sale_blocked';
  else if (salesQuery.saleRemoteMode === 'sale_remote_misconfigured') mode = 'sale_remote_misconfigured';
  else if (!hasIdentity) mode = 'sale_remote_unavailable_identity';
  else mode = 'sale_remote_active';

  const isActive = mode === 'sale_remote_active';
  const activeLoading = isActive && salesQuery.isLoading;
  const activeError = isActive && salesQuery.isError;

  // Hard gate NA FONTE: fora do caminho realmente pronto para adaptar
  // (active + não-loading + não-erro), o adapter nunca vê uma row
  // cacheada — sempre []. Hook ainda chamado sempre (Rules of Hooks), só o
  // INPUT muda.
  const rowsForAdaptation = isActive && !activeLoading && !activeError ? salesQuery.rows : EMPTY_ROWS;
  const adapted = useAdaptedRemoteSales(rowsForAdaptation);

  let sales: readonly RemoteSaleModel[] = EMPTY_SALES;
  let configError: SaleAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isSaleAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.sales.length === 0) {
      isEmpty = true;
    } else {
      sales = adapted.sales;
      hasData = true;
    }
  }

  return {
    mode,
    sales,
    isLoading: activeLoading,
    isFetching: isActive ? salesQuery.isFetching : false,
    isError: activeError,
    error: activeError ? salesQuery.error : null,
    configError,
    isEmpty,
    hasData,
    refetch: salesQuery.refetch,
  };
}
