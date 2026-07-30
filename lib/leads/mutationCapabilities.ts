// lib/leads/mutationCapabilities.ts — capabilities granulares de mutation
// de Leads para o caminho Manager/Seller (M1-E, E4-B1). Módulo PRÓPRIO,
// deliberadamente separado de lib/capabilities.ts (que permanece intocado):
// aquele arquivo cobre Settings/Convites/Commercial workspace Platform/
// Membership lifecycle — nenhuma capability de mutation granular de Leads
// remotos existia lá antes desta etapa.
//
// Função pura: sem React, sem Supabase, sem leitura de flags/.env — o modo
// remoto (`flagMode`) é sempre resolvido pelo chamador via
// resolveRemoteLeadsFlagMode() (lib/leads/remoteLeadsMode.ts) e recebido
// como parâmetro explícito, nunca lido daqui. Isto é UX + defesa de
// handlers — a segurança REAL continua em RLS/grants/RPC (mesmo
// disclaimer de lib/capabilities.ts).
import type { RemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';
import type { User } from '@/lib/data';

export type LeadMutationCapabilities = {
  canCreate: boolean;
  canEditDetails: boolean;
  // canApplyEvents permanece fora deste módulo — sempre false. O picker
  // técnico de 18 eventos nunca é liberado por inteiro; canAssignSeller/
  // canArchive seguem fora também, até E6 implementar os fluxos
  // correspondentes (assign_lead_seller/archive_lead/unarchive_lead).
  // canMoveStage foi ativado no E5-B1 (Kanban remoto conectado a
  // move_lead_to_stage via useMoveLeadToStage). canLogCallOutcome foi
  // ativado no E5-B2-A2 (somente o resultado de ligação conectado a
  // apply_lead_event via useApplyLeadEvent — os outros 14 eventos do
  // enum continuam fora, nunca liberados por canApplyEvents).
  canApplyEvents: boolean;
  canMoveStage: boolean;
  canLogCallOutcome: boolean;
  canAssignSeller: boolean;
  canArchive: boolean;
};

const NO_LEAD_MUTATION_CAPABILITIES: LeadMutationCapabilities = {
  canCreate: false,
  canEditDetails: false,
  canApplyEvents: false,
  canMoveStage: false,
  canLogCallOutcome: false,
  canAssignSeller: false,
  canArchive: false,
};

// Mesmo par platformRole/activeMembership já usado por
// CommercialMutationCapabilityUser/CommercialWorkspaceCapabilityUser em
// lib/capabilities.ts — nunca User.role legado.
export type LeadMutationCapabilitiesActor = Pick<User, 'platformRole' | 'activeMembership'> | null | undefined;

export type ResolveLeadMutationCapabilitiesInput = {
  // Resolvido pelo chamador via resolveRemoteLeadsFlagMode() — só
  // 'remote_ready' pode habilitar qualquer capability; 'local' (a etapa não
  // altera o caminho local) e 'remote_misconfigured' sempre caem em
  // NO_LEAD_MUTATION_CAPABILITIES.
  flagMode: RemoteLeadsFlagMode;
  // profile.is_active NÃO é lido de User (o tipo não carrega esse campo) —
  // mesmo raciocínio já documentado em lib/capabilities.ts
  // (canManageInvites): um User inativo nunca existe em memória
  // (_loadProfile retorna null antes de montar o User). O parâmetro é
  // explícito aqui porque o contrato desta etapa pede "profile ativo" como
  // entrada própria, não inferida silenciosamente do actor ser não-nulo.
  profileIsActive: boolean;
  actor: LeadMutationCapabilitiesActor;
};

// Matriz do E4 (docs/M1-E-DESIGN.md §15.4), estendida no E5-B1 (§15.8) e no
// E5-B2-A2 (§15.9):
//   Manager operacional                        -> canCreate + canEditDetails + canMoveStage + canLogCallOutcome
//   Seller operacional com sellerId válido      -> canCreate + canEditDetails + canMoveStage + canLogCallOutcome
//   Seller sem sellerId                         -> todas false
//   Super Admin                                 -> todas false (usa Platform)
//   sem membership/suspenso/offboarded/inativo  -> todas false
//   modo local/remote_misconfigured             -> todas false
// canApplyEvents/canAssignSeller/canArchive permanecem SEMPRE false neste
// módulo — pertencem a E5-B2-B/E6, nunca liberados aqui. Nem canMoveStage
// nem canLogCallOutcome sozinhos autorizam agir num Lead específico: a
// posse (Seller só no próprio) é responsabilidade de
// lib/leads/leadMutationOwnership.ts, combinada pelo chamador — este módulo
// resolve só a capability genérica do ator.
export function resolveLeadMutationCapabilities(
  input: ResolveLeadMutationCapabilitiesInput,
): LeadMutationCapabilities {
  const { flagMode, profileIsActive, actor } = input;

  if (flagMode !== 'remote_ready') return NO_LEAD_MUTATION_CAPABILITIES;
  if (!profileIsActive) return NO_LEAD_MUTATION_CAPABILITIES;
  if (!actor) return NO_LEAD_MUTATION_CAPABILITIES;
  // Super Admin nunca tem activeMembership (por design) — mas a checagem
  // explícita de platformRole vem primeiro, de propósito: nunca confiar
  // somente na ausência de membership para excluir Super Admin.
  if (actor.platformRole === 'super_admin') return NO_LEAD_MUTATION_CAPABILITIES;

  const membership = actor.activeMembership;
  if (!membership) return NO_LEAD_MUTATION_CAPABILITIES;

  if (membership.role === 'manager') {
    return { ...NO_LEAD_MUTATION_CAPABILITIES, canCreate: true, canEditDetails: true, canMoveStage: true, canLogCallOutcome: true };
  }

  // Seller: só operacional quando o próprio sellerId está resolvido.
  if (!membership.sellerId) return NO_LEAD_MUTATION_CAPABILITIES;
  return { ...NO_LEAD_MUTATION_CAPABILITIES, canCreate: true, canEditDetails: true, canMoveStage: true, canLogCallOutcome: true };
}
