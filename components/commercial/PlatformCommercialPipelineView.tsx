'use client';
// components/commercial/PlatformCommercialPipelineView.tsx — "Em progresso"
// (Kanban) SOMENTE LEITURA para o Super Admin (M1-F S8-C2-B2). Agrupa leads
// reais (list_platform_leads_for_company, archived=false) pelas etapas reais
// (list_pipeline_stages_for_company) — nunca PipeCard/StoreAdapter/drag and
// drop/reorder_pipeline_stages (S8-C1-B permanece intocado).
import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { PageHead, LCard, LightScreen, URG, LBtn } from '@/components/ui/kit';
import { CommercialWorkspaceHeader, CommercialWorkspaceEmptyState } from '@/components/commercial/CommercialWorkspaceHeader';
import { PlatformLeadDetails } from '@/components/commercial/PlatformLeadDetails';
import { PlatformLeadCreateModal } from '@/components/commercial/PlatformLeadCreateModal';
import { PlatformLeadEditModal } from '@/components/commercial/PlatformLeadEditModal';
import { useCommercialCompanyContext } from '@/lib/commercial/CommercialCompanyContext';
import { useOperationalCompanyContext } from '@/lib/operational/OperationalCompanyContext';
import { useCommercialCompanies } from '@/lib/hooks/useCommercialCompanies';
import { usePlatformLeads } from '@/lib/hooks/usePlatformLeads';
import { usePlatformPipelineStages } from '@/lib/hooks/usePlatformPipelineStages';
import { canMutateCommercialWorkspace } from '@/lib/capabilities';
import { isSuperAdminCommercialWriteEnabled } from '@/lib/flags';
import { formatLeadAssignmentLabel } from '@/lib/commercial/leadDisplay';
import type { PlatformLeadRow } from '@/lib/commercial/repository';

export type PlatformCommercialPipelineViewProps = {
  userId: string;
  platformRole: 'super_admin' | null;
};

function PipelineLeadCard({ lead, onOpen }: { lead: PlatformLeadRow; onOpen: () => void }) {
  const u = URG[lead.urgency] || URG.green;
  return (
    <div
      data-testid={`platform-pipe-card-${lead.id}`}
      onClick={onOpen}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${u.c}`,
        borderRadius: 10, padding: 12, cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
      }}
      // Somente leitura: nenhum draggable, nenhum handler de drag registrado
      // (decisão do S8-C2-B2, §5) — diferente de PipeCard (ScreensOps.tsx).
    >
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>{lead.name}</div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon name="car" size={13} stroke={2} /> {lead.car}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--t-500)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>
        {formatLeadAssignmentLabel(lead.seller_id)}
      </div>
    </div>
  );
}

export function PlatformCommercialPipelineView({ userId, platformRole }: PlatformCommercialPipelineViewProps) {
  // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC §15/§25 — mesma regra de
  // PlatformCommercialClientsView: OperationalCompanyContext é a autoridade
  // quando presente (rota /company/[id]), nunca o seletor manual do
  // CommercialCompanyContext ao mesmo tempo.
  const operational = useOperationalCompanyContext();
  const isOperationalMode = operational.mode === 'super_admin';
  const commercial = useCommercialCompanyContext();
  const selectedCompanyId = isOperationalMode ? operational.companyId : commercial.selectedCompanyId;
  const setSelectedCompanyId = commercial.setSelectedCompanyId;
  const companiesQuery = useCommercialCompanies({ userId, authorized: true });
  const stagesQuery = usePlatformPipelineStages({ companyId: selectedCompanyId, authorized: true });
  const leadsQuery = usePlatformLeads({ companyId: selectedCompanyId, archived: false, authorized: true });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedLeadId(null);
    setCreateModalOpen(false);
    setEditingLeadId(null);
  }, [selectedCompanyId]);

  const selectedLead = selectedLeadId ? leadsQuery.leads.find((l) => l.id === selectedLeadId) ?? null : null;
  const editingLead = editingLeadId ? leadsQuery.leads.find((l) => l.id === editingLeadId) ?? null : null;
  const selectedCompany = selectedCompanyId ? companiesQuery.companies.find((c) => c.id === selectedCompanyId) ?? null : null;

  const canMutate = canMutateCommercialWorkspace({
    actor: { platformRole },
    readEnabled: true,
    writeEnabled: isSuperAdminCommercialWriteEnabled(),
    selectedCompanyStatus: selectedCompany?.status ?? null,
  });

  return (
    <LightScreen>
      <PageHead
        title="Em progresso"
        sub={canMutate
          ? 'Pipeline comercial da KAPA. Dados reais da empresa selecionada.'
          : 'Pipeline comercial da KAPA, leitura somente. Dados reais da empresa selecionada.'}
        actions={canMutate && (
          <LBtn kind="gold" icon="plus" onClick={() => setCreateModalOpen(true)}>Novo Lead</LBtn>
        )}
      />
      <CommercialWorkspaceHeader
        selectedCompanyId={selectedCompanyId}
        onSelectCompany={setSelectedCompanyId}
        companies={companiesQuery.companies}
        companiesLoading={companiesQuery.isLoading}
        companiesError={companiesQuery.isError}
        readOnly={!canMutate}
        hideSelector={isOperationalMode}
      />

      {!selectedCompanyId ? (
        <CommercialWorkspaceEmptyState label="Selecione uma empresa para visualizar o pipeline." />
      ) : stagesQuery.isLoading || leadsQuery.isLoading ? (
        <div data-testid="platform-pipeline-loading" style={{ color: 'var(--t-500)', fontSize: 13.5 }}>Carregando…</div>
      ) : stagesQuery.isError || leadsQuery.isError ? (
        <div data-testid="platform-pipeline-error">
          <LCard style={{ textAlign: 'center', color: 'var(--red)' }}>Não foi possível carregar o pipeline.</LCard>
        </div>
      ) : stagesQuery.isEmpty ? (
        <div data-testid="platform-pipeline-empty">
          <LCard style={{ textAlign: 'center', color: 'var(--t-500)' }}>Nenhuma etapa configurada para esta empresa.</LCard>
        </div>
      ) : (
        <div data-testid="platform-pipeline-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${stagesQuery.stages.length}, minmax(210px, 1fr))`, gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
          {stagesQuery.stages.map((stage) => {
            const items = leadsQuery.leads.filter((l) => l.stage_id === stage.id);
            return (
              <div key={stage.id} data-testid={`platform-pipe-col-${stage.code}`} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 360 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--t-900)' }}>{stage.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--t-500)', background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 8px' }}>{items.length}</span>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                  {items.length ? items.map((lead) => (
                    <PipelineLeadCard key={lead.id} lead={lead} onOpen={() => setSelectedLeadId(lead.id)} />
                  )) : (
                    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--t-400)', fontSize: 12.5, textAlign: 'center', padding: 20 }}>Nenhum cliente nesta etapa</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedLead && selectedCompanyId && (
        <PlatformLeadDetails
          lead={selectedLead}
          companyId={selectedCompanyId}
          stagesById={stagesQuery.stagesById}
          stages={stagesQuery.stages}
          onClose={() => setSelectedLeadId(null)}
          canMutate={canMutate}
          onEdit={() => { setEditingLeadId(selectedLead.id); setSelectedLeadId(null); }}
        />
      )}

      {createModalOpen && canMutate && selectedCompany && (
        <PlatformLeadCreateModal
          company={selectedCompany}
          onClose={() => setCreateModalOpen(false)}
        />
      )}

      {editingLead && canMutate && selectedCompany && (
        <PlatformLeadEditModal
          lead={editingLead}
          company={selectedCompany}
          onClose={() => setEditingLeadId(null)}
        />
      )}
    </LightScreen>
  );
}
