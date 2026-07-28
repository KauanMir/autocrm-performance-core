'use client';
// components/commercial/PlatformLeadDetails.tsx — detalhe + timeline
// SOMENTE LEITURA de um lead real, para o Super Admin (M1-F S8-C2-B2).
// Consome list_platform_lead_timeline (via usePlatformLeadTimeline) — nunca
// lead.timeline (formato mock embutido, ver FlowVerCliente). Nenhum callback
// de mutation é aceito ou passado adiante: sem editar, salvar, adicionar
// evento, arquivar, mover, atribuir ou remover atribuição.
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBadge } from '@/components/ui/kit';
import { FlowShell } from '@/components/flows/FlowsShared';
import { usePlatformLeadTimeline } from '@/lib/hooks/usePlatformLeadTimeline';
import { formatLeadAssignmentLabel, resolveLeadStageName } from '@/lib/commercial/leadDisplay';
import type { PlatformLeadRow } from '@/lib/commercial/repository';
import type { PlatformPipelineStageRow } from '@/lib/commercial/repository';

export type PlatformLeadDetailsProps = {
  lead: PlatformLeadRow;
  companyId: string;
  stagesById: Readonly<Record<string, PlatformPipelineStageRow>>;
  onClose: () => void;
};

function formatDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR');
}

export function PlatformLeadDetails({ lead, companyId, stagesById, onClose }: PlatformLeadDetailsProps) {
  const timeline = usePlatformLeadTimeline({ companyId, leadId: lead.id, authorized: true });
  const stageName = resolveLeadStageName(lead.stage_id, stagesById);
  const assignmentLabel = formatLeadAssignmentLabel(lead.seller_id);

  return (
    <FlowShell
      eyebrow="MODO COMERCIAL — SOMENTE LEITURA"
      title={lead.name}
      icon="user"
      accent="#3B82F6"
      onClose={onClose}
      status={<LBadge tone="amber"><Icon name="eye" size={12} stroke={2.2} /> Somente leitura</LBadge>}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 22, borderRadius: 16, background: 'linear-gradient(120deg,#1b1b1f,#121214)', border: '1px solid var(--border)', marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{lead.name}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="phone" size={14} stroke={2} /> {lead.phone}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="car" size={14} stroke={2} /> {lead.car}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="flow" size={14} stroke={2} /> {stageName}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="users" size={14} stroke={2} /> {assignmentLabel}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)' }}>{lead.archived_at ? 'Arquivado' : 'Ativo'}</span>
          </div>
        </div>
      </div>

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
      </div>
    </FlowShell>
  );
}
