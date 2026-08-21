// lib/hooks/useRemoteVisitsScreenState.ts — composição de leitura remota de
// Visits (COMMERCIAL-REMOTE-VISITS-B2-A). Único ponto que combina
// useVisits + useAdaptedRemoteVisits + useRemoteLeadsScreenState com a
// MESMA identidade e o MESMO contrato de flags — futuros consumidores
// (VisitService/Home/ScreenVisitas, fora do escopo desta etapa) chamarão
// este hook, nunca os três hooks separadamente. Mesmo padrão exato de
// lib/hooks/useRemoteTasksScreenState.ts.
//
// Identidade vem por parâmetro (currentUser) — este hook não importa
// AuthService. A fórmula de identidade válida (userId + companyId +
// userIsActive + role manager/seller) é EXATAMENTE a mesma usada pelo
// outro ponto de gating de Visits (a query dentro de useVisits) — nunca
// diverge de quando a query real está habilitada.
//
// Rules of Hooks: os três hooks internos são SEMPRE chamados, na mesma
// ordem — useVisits já resolve seu próprio `queryEnabled` internamente;
// useAdaptedRemoteVisits recebe rows vazias fora do caminho ativo (hard
// gate na FONTE), nunca um hook pulado.
//
// HARD GATE: TanStack Query pode continuar expondo dado cacheado mesmo
// com `enabled=false` ou após um erro — por isso o mode final decide
// sozinho se alguma Visit é exposta, nunca o cache por si só. Fora de
// `visit_remote_active`, ou dentro dele durante loading/erro inicial,
// `rowsForAdaptation` é sempre `[]`: nenhuma Visit cacheada de um estado
// ativo anterior pode vazar para local/blocked/misconfigured/
// unavailable-identity/loading/erro.
import { useMemo } from 'react';
import type { User } from '@/lib/data';
import { useVisits } from '@/lib/hooks/useVisits';
import { useAdaptedRemoteVisits } from '@/lib/hooks/useAdaptedRemoteVisits';
import { useRemoteLeadsScreenState } from '@/lib/hooks/useRemoteLeadsScreenState';
import {
  isVisitAdapterError,
  type RemoteVisitModel,
  type RemoteVisitRow,
  type VisitAdapterError,
  type VisitLeadRef,
} from '@/lib/visits/adapter';

export type VisitScreenMode =
  // visit_remote_ready=false e Leads também local — caminho local
  // existente (VisitService/localStorage), este hook não decide mais nada.
  | 'visit_local'
  // Rollout parcial esperado: Leads já remote_ready, REMOTE_VISITS ainda
  // off — nunca tratado como erro (lib/visits/remoteVisitsMode.ts).
  | 'visit_blocked'
  // Config de base inválida (própria ou propagada de Leads) — falha
  // fechada, nenhuma bridge, nenhum dado local nem remoto.
  | 'visit_remote_misconfigured'
  // visit_remote_ready, mas o ator atual não qualifica (sem membership
  // ativa/operacional, não é Manager/Seller, ou usuário global inativo).
  | 'visit_remote_unavailable_identity'
  // Caminho remoto efetivo: useVisits/useAdaptedRemoteVisits são a
  // autoridade de loading/error/config-error/empty/success.
  | 'visit_remote_active';

export type UseRemoteVisitsScreenStateResult = {
  mode: VisitScreenMode;
  visits: readonly RemoteVisitModel[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  configError: VisitAdapterError | null;
  isEmpty: boolean;
  hasData: boolean;
  refetch: () => void;
};

const EMPTY_ROWS: readonly RemoteVisitRow[] = Object.freeze([]);
const EMPTY_VISITS: readonly RemoteVisitModel[] = Object.freeze([]);

export function useRemoteVisitsScreenState(
  currentUser: User | null,
): UseRemoteVisitsScreenStateResult {
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';
  const hasIdentity =
    isManagerOrSeller && userIsActive && Boolean(companyId) && Boolean(userId);

  // Chamados SEMPRE, na mesma ordem (Rules of Hooks). visitRemoteMode vem
  // do PRÓPRIO retorno de useVisits (nunca recalculado por uma segunda
  // chamada a resolveVisitRemoteMode aqui) — garante, por construção, que
  // o mode usado para decidir loading/error/gate é o MESMO valor que
  // decidiu `queryEnabled` dentro de useVisits (nenhuma divergência).
  const visitsQuery = useVisits({ userId, companyId, membershipRole, userIsActive });

  // Fonte reativa de Leads — nunca lê o snapshot singleton durante render
  // React; usa o mesmo composer já usado pelas telas de Leads/Tasks.
  const leadsScreenState = useRemoteLeadsScreenState(currentUser);

  const leadsById = useMemo(() => {
    const map: Record<string, VisitLeadRef> = {};
    for (const lead of leadsScreenState.leads.leads) {
      map[lead.id] = { id: lead.id, name: lead.name };
    }
    return map;
  }, [leadsScreenState.leads.leads]);

  let mode: VisitScreenMode;
  if (visitsQuery.visitRemoteMode === 'visit_local') mode = 'visit_local';
  else if (visitsQuery.visitRemoteMode === 'visit_blocked') mode = 'visit_blocked';
  else if (visitsQuery.visitRemoteMode === 'visit_remote_misconfigured') mode = 'visit_remote_misconfigured';
  else if (!hasIdentity) mode = 'visit_remote_unavailable_identity';
  else mode = 'visit_remote_active';

  const isActive = mode === 'visit_remote_active';
  const activeLoading = isActive && visitsQuery.isLoading;
  const activeError = isActive && visitsQuery.isError;

  // Hard gate NA FONTE: fora do caminho realmente pronto para adaptar
  // (active + não-loading + não-erro), o adapter nunca vê uma row
  // cacheada — sempre []. Hook ainda chamado sempre (Rules of Hooks), só o
  // INPUT muda.
  const rowsForAdaptation = isActive && !activeLoading && !activeError ? visitsQuery.rows : EMPTY_ROWS;
  const adapted = useAdaptedRemoteVisits(rowsForAdaptation, leadsById);

  let visits: readonly RemoteVisitModel[] = EMPTY_VISITS;
  let configError: VisitAdapterError | null = null;
  let isEmpty = false;
  let hasData = false;

  if (isActive && !activeLoading && !activeError) {
    if (isVisitAdapterError(adapted)) {
      configError = adapted;
    } else if (adapted.visits.length === 0) {
      isEmpty = true;
    } else {
      visits = adapted.visits;
      hasData = true;
    }
  }

  return {
    mode,
    visits,
    isLoading: activeLoading,
    isFetching: isActive ? visitsQuery.isFetching : false,
    isError: activeError,
    error: activeError ? visitsQuery.error : null,
    configError,
    isEmpty,
    hasData,
    refetch: visitsQuery.refetch,
  };
}
