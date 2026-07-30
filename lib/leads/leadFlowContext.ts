// lib/leads/leadFlowContext.ts — contrato tipado de fonte local/remota para
// os flows de Leads (M1-E, E4-B2). Função pura (sem React): a ÚNICA chamada
// a resolveRemoteLeadsFlagMode() na camada de UI de flows/telas — nenhum
// componente lê isRemoteLeadsEnabled()/isRemoteStagesEnabled() diretamente.
//
// FlowLayer roteia flows por id sem contexto próprio (payload é o único
// canal, e nem todo caller o preenche), então os flows chamam esta função
// com o currentUser que já resolvem (mesmo padrão já usado por
// FlowNovoCliente/ScreenClientesLegacy via AuthService.getCurrentUser()) em
// vez de espalhar leitura de flag/env pelos componentes.
import type { User } from '@/lib/data';
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';
import {
  resolveLeadMutationCapabilities,
  type LeadMutationCapabilities,
} from '@/lib/leads/mutationCapabilities';

export type LeadFlowDataSource = 'local' | 'remote';

export type LeadFlowContext = {
  dataSource: LeadFlowDataSource;
  capabilities: LeadMutationCapabilities;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  sellerId: string | null;
  userId: string | null;
  userIsActive: boolean;
};

// dataSource é 'remote' sempre que a flag estiver ligada — inclusive
// remote_misconfigured ou sem identidade operacional — nunca 'local' nesses
// casos: nenhum fallback local silencioso sob flag ON (mesmo invariante do
// E3). A UI distingue os sub-estados sem permissão pelas capabilities
// (todas false cobre exatamente esses casos).
export function resolveLeadFlowContext(user: User | null): LeadFlowContext {
  const flagMode = resolveRemoteLeadsFlagMode();
  const dataSource: LeadFlowDataSource = flagMode === 'local' ? 'local' : 'remote';

  const capabilities = resolveLeadMutationCapabilities({
    flagMode,
    profileIsActive: Boolean(user),
    actor: user,
  });

  return {
    dataSource,
    capabilities,
    companyId: user?.activeMembership?.companyId ?? null,
    membershipRole: user?.activeMembership?.role ?? null,
    sellerId: user?.activeMembership?.sellerId ?? null,
    userId: user?.id ?? null,
    userIsActive: Boolean(user),
  };
}
