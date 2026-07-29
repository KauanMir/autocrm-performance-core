'use client';
// components/commercial/PlatformLeadDetails.tsx — detalhe + timeline do
// Lead para o Super Admin. Leitura (M1-F S8-C2-B2) + mutations restantes
// (M1-F S8-C2-D2): mover etapa, atribuir/desatribuir vendedor, arquivar/
// desarquivar, registrar evento comercial, adicionar entrada manual na
// timeline. Consome list_platform_lead_timeline (via
// usePlatformLeadTimeline) — nunca lead.timeline (formato mock embutido,
// ver FlowVerCliente). Nenhuma das seis RPCs restantes é chamada fora
// deste componente na árvore platform.
//
// canMutate=false (READ sem WRITE, empresa suspensa/cancelada, ou nenhuma
// das duas flags) preserva integralmente o comportamento do B2/C2: badge
// "Somente leitura", nenhum hook de mutation autorizado é montado com
// authorized=true, nenhuma ação aparece.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBadge, LBtn } from '@/components/ui/kit';
import { FlowShell } from '@/components/flows/FlowsShared';
import { usePlatformLeadTimeline } from '@/lib/hooks/usePlatformLeadTimeline';
import { usePlatformSellers } from '@/lib/hooks/usePlatformSellers';
import { useMovePlatformLead } from '@/lib/hooks/useMovePlatformLead';
import { useApplyPlatformLeadEvent } from '@/lib/hooks/useApplyPlatformLeadEvent';
import { useAssignPlatformLeadSeller } from '@/lib/hooks/useAssignPlatformLeadSeller';
import { useArchivePlatformLead } from '@/lib/hooks/useArchivePlatformLead';
import { useUnarchivePlatformLead } from '@/lib/hooks/useUnarchivePlatformLead';
import { useAddPlatformLeadTimelineEntry } from '@/lib/hooks/useAddPlatformLeadTimelineEntry';
import { useCommercialCompanyContext } from '@/lib/commercial/CommercialCompanyContext';
import { getPlatformCommercialErrorMessage } from '@/lib/commercial/errors';
import { formatLeadAssignmentLabel, resolveLeadStageName } from '@/lib/commercial/leadDisplay';
import type { PlatformLeadRow, PlatformPipelineStageRow } from '@/lib/commercial/repository';
import {
  PlatformLeadArchiveControl,
  PlatformLeadEventMenu,
  PlatformLeadSellerMenu,
  PlatformLeadStageMenu,
  PlatformLeadTimelineForm,
  PLATFORM_MANUAL_TIMELINE_COLOR,
  PLATFORM_MANUAL_TIMELINE_ICON,
} from '@/components/commercial/PlatformLeadActions';
import type { LeadEventType } from '@/lib/commercial/leadEventRegistry';

export type PlatformLeadDetailsProps = {
  lead: PlatformLeadRow;
  companyId: string;
  stagesById: Readonly<Record<string, PlatformPipelineStageRow>>;
  // M1-F S8-C2-D2 — lista completa (ordenada) das etapas reais da empresa
  // capturada, para o seletor explícito de movimentação. Vazia (default)
  // preserva o comportamento somente leitura quando o chamador não a
  // fornece.
  stages?: readonly PlatformPipelineStageRow[];
  onClose: () => void;
  // M1-F S8-C2-C2 — resolvido pelo chamador via canMutateCommercialWorkspace
  // (READ+WRITE+empresa ativa/implantacao). false preserva o comportamento
  // original do B2 (badge "Somente leitura", nenhuma ação de edição).
  canMutate?: boolean;
  onEdit?: () => void;
};

function formatDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR');
}

export function PlatformLeadDetails({
  lead, companyId, stagesById, stages = [], onClose, canMutate = false, onEdit,
}: PlatformLeadDetailsProps) {
  const timeline = usePlatformLeadTimeline({ companyId, leadId: lead.id, authorized: true });
  const stageName = resolveLeadStageName(lead.stage_id, stagesById);
  const assignmentLabel = formatLeadAssignmentLabel(lead.seller_id);
  const isArchived = lead.archived_at !== null;

  // ── Proteção de contexto ────────────────────────────────────────────────
  // companyId/contextEpoch SEMPRE lidos ao vivo do contexto (nunca da prop
  // `companyId`, que é o valor CAPTURADO na abertura) — isContextStillValid
  // compara o capturado contra o ao vivo imediatamente antes de cada RPC,
  // mesmo padrão já usado por PlatformLeadCreateModal/PlatformLeadEditModal
  // (liveCompanyIdRef), estendido com contextEpoch para cobrir também uma
  // troca A->B->A enquanto uma mutation está pendente.
  const { selectedCompanyId, contextEpoch } = useCommercialCompanyContext();
  const liveCompanyIdRef = useRef(selectedCompanyId);
  const liveContextEpochRef = useRef(contextEpoch);
  useEffect(() => { liveCompanyIdRef.current = selectedCompanyId; }, [selectedCompanyId]);
  useEffect(() => { liveContextEpochRef.current = contextEpoch; }, [contextEpoch]);
  const capturedEpochRef = useRef(contextEpoch);
  const isContextStillValid = () =>
    liveCompanyIdRef.current === companyId && liveContextEpochRef.current === capturedEpochRef.current;

  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const sellersQuery = usePlatformSellers({ companyId, authorized: canMutate });
  const move = useMovePlatformLead({ authorized: canMutate });
  const applyEvent = useApplyPlatformLeadEvent({ authorized: canMutate });
  const assignSeller = useAssignPlatformLeadSeller({ authorized: canMutate });
  const archive = useArchivePlatformLead({ authorized: canMutate });
  const unarchive = useUnarchivePlatformLead({ authorized: canMutate });
  const addTimelineEntry = useAddPlatformLeadTimelineEntry({ authorized: canMutate });

  const anyPending = move.isPending || applyEvent.isPending || assignSeller.isPending
    || archive.isPending || unarchive.isPending || addTimelineEntry.isPending;

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setFeedback(null);
    try {
      await action();
      setFeedback({ kind: 'success', text: label });
    } catch (err) {
      setFeedback({ kind: 'error', text: getPlatformCommercialErrorMessage(err) });
    }
  };

  const handleMove = (stageId: string) => runAction('Lead movido.', () => move.moveLead({
    companyId, leadId: lead.id, stageId, expectedVersion: lead.version, isContextStillValid,
  }));

  const handleApplyEvent = (eventType: LeadEventType) => runAction('Evento registrado.', () => applyEvent.applyEvent({
    companyId, leadId: lead.id, eventType, isContextStillValid,
  }));

  const handleAssignSeller = (sellerId: string | null) => runAction(
    sellerId ? 'Vendedor atribuído.' : 'Vendedor removido.',
    () => assignSeller.assignSeller({ companyId, leadId: lead.id, sellerId, expectedVersion: lead.version, isContextStillValid }),
  );

  const handleArchive = () => runAction('Lead arquivado.', () => archive.archiveLead({
    companyId, leadId: lead.id, expectedVersion: lead.version, isContextStillValid,
  }));

  const handleUnarchive = () => runAction('Lead desarquivado.', () => unarchive.unarchiveLead({
    companyId, leadId: lead.id, expectedVersion: lead.version, isContextStillValid,
  }));

  const handleAddTimelineEntry = (input: { label: string; detail?: string }) => runAction('Entrada adicionada à timeline.', () => addTimelineEntry.addTimelineEntry({
    companyId,
    leadId: lead.id,
    icon: PLATFORM_MANUAL_TIMELINE_ICON,
    color: PLATFORM_MANUAL_TIMELINE_COLOR,
    label: input.label,
    detail: input.detail,
    isContextStillValid,
  }));

  return (
    <FlowShell
      eyebrow={canMutate ? 'MODO COMERCIAL' : 'MODO COMERCIAL — SOMENTE LEITURA'}
      title={lead.name}
      icon="user"
      accent="#3B82F6"
      onClose={onClose}
      status={canMutate
        ? <LBtn kind="ghost" icon="edit" onClick={onEdit}>Editar</LBtn>
        : <LBadge tone="amber"><Icon name="eye" size={12} stroke={2.2} /> Somente leitura</LBadge>}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 22, borderRadius: 16, background: 'linear-gradient(120deg,#1b1b1f,#121214)', border: '1px solid var(--border)', marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{lead.name}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="phone" size={14} stroke={2} /> {lead.phone}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="car" size={14} stroke={2} /> {lead.car}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="flow" size={14} stroke={2} /> {stageName}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="users" size={14} stroke={2} /> {assignmentLabel}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)' }}>{isArchived ? 'Arquivado' : 'Ativo'}</span>
          </div>
        </div>
      </div>

      {feedback && (
        <div role={feedback.kind === 'error' ? 'alert' : 'status'} data-testid="platform-lead-action-feedback"
          style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
            background: feedback.kind === 'error' ? 'var(--red-bg)' : 'rgba(39,199,95,.1)',
            border: `1px solid ${feedback.kind === 'error' ? 'var(--red-line)' : 'rgba(39,199,95,.3)'}`,
            color: feedback.kind === 'error' ? 'var(--red)' : '#27C75F',
          }}>
          <Icon name={feedback.kind === 'error' ? 'alert' : 'check'} size={15} stroke={2.2} />
          {feedback.text}
        </div>
      )}

      {canMutate && (
        <div data-testid="platform-lead-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
          {!isArchived && (
            <PlatformLeadStageMenu
              stages={stages}
              currentStageId={lead.stage_id}
              disabled={anyPending}
              onSelect={handleMove}
            />
          )}
          {!isArchived && (
            <PlatformLeadSellerMenu
              sellers={sellersQuery.sellers}
              sellersLoading={sellersQuery.isLoading}
              sellersError={sellersQuery.isError}
              currentSellerId={lead.seller_id}
              disabled={anyPending}
              onSelect={handleAssignSeller}
            />
          )}
          {!isArchived && (
            <PlatformLeadEventMenu disabled={anyPending} onSelect={handleApplyEvent} />
          )}
          <PlatformLeadArchiveControl
            archived={isArchived}
            disabled={anyPending}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
          />
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="history" size={16} stroke={2.1} style={{ color: '#E8CE72' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>Linha do tempo</span>
        </div>
        {timeline.isLoading ? (
          <div data-testid="platform-lead-timeline-loading" style={{ padding: '20px 0', color: 'var(--t-500)', fontSize: 13 }}>Carregando…</div>
        ) : timeline.isError ? (
          <div data-testid="platform-lead-timeline-error" role="alert" style={{ padding: '20px 0', color: 'var(--red)', fontSize: 13 }}>Não foi possível carregar a linha do tempo.</div>
        ) : timeline.isEmpty ? (
          <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--t-500)', fontSize: 13 }}>Nenhum histórico registrado ainda.</div>
        ) : (
          <div data-testid="platform-lead-timeline-list" style={{ position: 'relative', paddingLeft: 8 }}>
            {timeline.entries.map((entry, i) => (
              <div key={entry.id} style={{ display: 'flex', gap: 14, paddingBottom: i < timeline.entries.length - 1 ? 20 : 0 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `${entry.color}22`, color: entry.color, display: 'grid', placeItems: 'center', border: `1px solid ${entry.color}44` }}>
                  <Icon name={entry.icon} size={18} stroke={2.1} />
                </div>
                <div style={{ flex: 1, paddingTop: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>{entry.label}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--t-400)', whiteSpace: 'nowrap' }}>{formatDate(entry.occurred_at)}</span>
                  </div>
                  {entry.detail && <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{entry.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {canMutate && !isArchived && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-2)' }}>
            <PlatformLeadTimelineForm disabled={anyPending} onSubmit={handleAddTimelineEntry} />
          </div>
        )}
      </div>
    </FlowShell>
  );
}
