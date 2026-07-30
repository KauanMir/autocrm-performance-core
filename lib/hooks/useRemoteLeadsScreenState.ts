// lib/hooks/useRemoteLeadsScreenState.ts — composição de leitura remota de
// Leads para as telas de Manager/Seller (M1-E, E3-B1). Único ponto que
// combina usePipelineStages + useCurrentCompanySellerLabels + useLeads com a
// MESMA identidade e o MESMO contrato de flags — ScreenClientesLegacy e
// ScreenAndamentoLegacy chamam este hook (nunca os três hooks separadamente),
// evitando dois caminhos de adaptação divergentes.
//
// Identidade vem por parâmetro (currentUser) — mesmo padrão de useLeads/
// usePipelineStages/useCurrentCompanySellerLabels: este hook não importa
// AuthService. Rules of Hooks: os três hooks internos são SEMPRE chamados,
// na mesma ordem — `enabled` de cada um (já resolvido internamente a partir
// das flags reais) é quem decide se alguma rede é de fato usada; local
// (REMOTE_LEADS=false) nunca dispara useLeads/useCurrentCompanySellerLabels
// (ambos checam isRemoteLeadsEnabled() internamente).
import type { User } from '@/lib/data';
import { PipelineService } from '@/lib/services';
import { usePipelineStages, type UsePipelineStagesResult } from '@/lib/hooks/usePipelineStages';
import {
  useCurrentCompanySellerLabels,
  type UseCurrentCompanySellerLabelsResult,
} from '@/lib/hooks/useCurrentCompanySellerLabels';
import { useLeads, type UseLeadsResult } from '@/lib/hooks/useLeads';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

export type RemoteLeadsScreenMode =
  // REMOTE_LEADS=false: telas usam exclusivamente o caminho local existente
  // (LeadService.getAll()/useStore()) — este hook não decide mais nada.
  | 'local'
  // REMOTE_LEADS=true e REMOTE_STAGES=false: falha fechada — nenhuma bridge,
  // nenhum dado local, nenhum dado remoto.
  | 'remote_misconfigured'
  // REMOTE_LEADS=true e REMOTE_STAGES=true, mas o ator atual não qualifica
  // (sem membership ativa/operacional, não é Manager/Seller, ou usuário
  // global inativo) — nunca Super Admin: ScreenClientesLegacy/
  // ScreenAndamentoLegacy nunca montam para Super Admin (router em
  // ScreensOps.tsx), então este caso cobre apenas identidade incompleta.
  | 'remote_unavailable_identity'
  // Caminho remoto efetivo: os três hooks internos são a autoridade de
  // loading/error/empty/success — a tela lê `leads`/`pipeline`/`sellerLabels`
  // diretamente, nunca LeadService/SellerService/StoreAdapter.
  | 'remote_active';

export type UseRemoteLeadsScreenStateResult = {
  mode: RemoteLeadsScreenMode;
  pipeline: UsePipelineStagesResult;
  sellerLabels: UseCurrentCompanySellerLabelsResult;
  leads: UseLeadsResult;
};

export function useRemoteLeadsScreenState(
  currentUser: User | null,
): UseRemoteLeadsScreenStateResult {
  const flagMode = resolveRemoteLeadsFlagMode();

  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';
  const hasIdentity =
    isManagerOrSeller && userIsActive && Boolean(companyId) && Boolean(userId);

  // Chamados SEMPRE, na mesma ordem (Rules of Hooks) — cada hook já resolve
  // sua própria flag internamente; local (REMOTE_LEADS=false) mantém
  // queryEnabled=false nos dois hooks de leads/sellers sem nenhuma rede.
  const pipeline = usePipelineStages({
    userId,
    companyId,
    userIsActive,
    localStageNames: PipelineService.getStages(),
  });

  const sellerLabels = useCurrentCompanySellerLabels({
    userId,
    companyId,
    membershipRole,
    userIsActive,
  });

  // Prontidão: stages exige catálogo real não-vazio (sem stages, nenhum lead
  // seria adaptável de qualquer forma — mesma leitura de usePipelineStages);
  // sellers está pronto assim que a busca se resolve, mesmo vazia (empresa
  // sem nenhum Seller cadastrado ainda é um índice vazio válido).
  const stagesReady = pipeline.hasData;
  const sellersReady = !sellerLabels.isLoading && !sellerLabels.isError;

  const leads = useLeads({
    userId,
    companyId,
    userIsActive,
    stagesById: pipeline.byId,
    sellersById: sellerLabels.sellersById,
    stagesReady,
    sellersReady,
  });

  let mode: RemoteLeadsScreenMode;
  if (flagMode === 'local') mode = 'local';
  else if (flagMode === 'remote_misconfigured') mode = 'remote_misconfigured';
  else if (!hasIdentity) mode = 'remote_unavailable_identity';
  else mode = 'remote_active';

  return { mode, pipeline, sellerLabels, leads };
}
