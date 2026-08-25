'use client';
// components/commercial/PlatformCommercialClientsView.tsx — "Clientes"
// SOMENTE LEITURA para o Super Admin (M1-F S8-C2-B2). Consome
// list_platform_leads_for_company/list_pipeline_stages_for_company via os
// hooks platform — nunca LeadService/StoreAdapter, nunca o formato mock
// (urgency/health/timeline calculados). Nenhum callback de mutation existe
// nesta árvore: sem criar, editar, mover, atribuir, arquivar.
import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBadge, LBtn, Chip, PageHead, LCard, LightScreen, URG } from '@/components/ui/kit';
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
import { formatLeadAssignmentLabel, resolveLeadAssignmentState, resolveLeadStageName } from '@/lib/commercial/leadDisplay';
import type { PlatformLeadRow } from '@/lib/commercial/repository';

export type PlatformCommercialClientsViewProps = {
  userId: string;
  // Sempre 'super_admin' na prática (o router em ScreensOps.tsx só monta
  // esta superfície para Super Admin) — resolvido pelo chamador, nunca lido
  // de AuthService aqui.
  platformRole: 'super_admin' | null;
};

type AssignmentFilter = 'todos' | 'assigned' | 'unassigned';

function LeadListCard({ lead, stageName, onOpen }: { lead: PlatformLeadRow; stageName: string; onOpen: () => void }) {
  const u = URG[lead.urgency] || URG.green;
  return (
    <div
      data-testid={`platform-lead-card-${lead.id}`}
      onClick={onOpen}
      className="lift"
      style={{
        background: '#151517', border: '1px solid var(--border)', borderLeft: `3px solid ${u.c}`,
        borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar name={lead.name} size={38} ring={u.c} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{lead.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t-500)' }}>
            <Icon name="phone" size={11} stroke={2} /> {lead.phone}
          </div>
        </div>
        {lead.archived_at && <LBadge tone="green">Arquivado</LBadge>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--t-700)', flexWrap: 'wrap' }}>
        <Icon name="car" size={13} stroke={2} style={{ color: 'var(--t-400)' }} />
        <span>{lead.car}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'var(--t-700)' }}>{stageName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--t-500)' }}>
        <Icon name="users" size={12} stroke={2} /> {formatLeadAssignmentLabel(lead.seller_id)}
      </div>
    </div>
  );
}

export function PlatformCommercialClientsView({ userId, platformRole }: PlatformCommercialClientsViewProps) {
  // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC §15/§24 — quando o Super Admin
  // chegou via /company/[id] (OperationalCompanyContext em modo
  // super_admin), essa é a ÚNICA autoridade de empresa: o seletor manual do
  // CommercialCompanyContext (fluxo antigo, Super Admin genérico escolhendo
  // livremente) nunca decide neste caso — nunca duas autoridades
  // simultâneas (Company A no contexto operacional + Company B no
  // comercial). Fora do contexto operacional, comportamento 100%
  // preservado (seletor manual, como sempre).
  const operational = useOperationalCompanyContext();
  const isOperationalMode = operational.mode === 'super_admin';
  const commercial = useCommercialCompanyContext();
  const selectedCompanyId = isOperationalMode ? operational.companyId : commercial.selectedCompanyId;
  const setSelectedCompanyId = commercial.setSelectedCompanyId;
  const companiesQuery = useCommercialCompanies({ userId, authorized: true });
  const stagesQuery = usePlatformPipelineStages({ companyId: selectedCompanyId, authorized: true });
  const [archived, setArchived] = useState(false);
  const leadsQuery = usePlatformLeads({ companyId: selectedCompanyId, archived, authorized: true });

  const [search, setSearch] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('todos');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);

  // Troca de empresa: fecha o detalhe/modais e limpa filtros locais que não
  // fazem mais sentido para o novo contexto (decisão do S8-C2-B2 §6/§11,
  // estendida no S8-C2-C2 para os modais de criação/edição).
  useEffect(() => {
    setSelectedLeadId(null);
    setSearch('');
    setAssignmentFilter('todos');
    setArchived(false);
    setCreateModalOpen(false);
    setEditingLeadId(null);
  }, [selectedCompanyId]);

  const filteredLeads = leadsQuery.leads.filter((lead) => {
    if (assignmentFilter !== 'todos' && resolveLeadAssignmentState(lead.seller_id) !== assignmentFilter) return false;
    if (search.trim() === '') return true;
    const term = search.trim().toLowerCase();
    return lead.name.toLowerCase().includes(term) || lead.phone.toLowerCase().includes(term);
  });

  const selectedLead = selectedLeadId ? leadsQuery.leads.find((l) => l.id === selectedLeadId) ?? null : null;
  const editingLead = editingLeadId ? leadsQuery.leads.find((l) => l.id === editingLeadId) ?? null : null;
  const selectedCompany = selectedCompanyId ? companiesQuery.companies.find((c) => c.id === selectedCompanyId) ?? null : null;

  // Capability PRÓPRIA (nunca canAccessCommercialWorkspace, que só decide se
  // o workspace de LEITURA existe) — true somente com READ+WRITE ligadas,
  // ator Super Admin, empresa selecionada e status ativa/implantacao.
  const canMutate = canMutateCommercialWorkspace({
    actor: { platformRole },
    readEnabled: true,
    writeEnabled: isSuperAdminCommercialWriteEnabled(),
    selectedCompanyStatus: selectedCompany?.status ?? null,
  });

  return (
    <LightScreen>
      <PageHead
        title="Clientes"
        sub={canMutate
          ? 'Acompanhamento comercial da KAPA. Dados reais da empresa selecionada.'
          : 'Acompanhamento comercial da KAPA, leitura somente. Dados reais da empresa selecionada.'}
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
        <CommercialWorkspaceEmptyState label="Selecione uma empresa para visualizar os clientes." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Chip active={!archived} onClick={() => setArchived(false)}>Ativos</Chip>
            <Chip active={archived} onClick={() => setArchived(true)}>Arquivados</Chip>
            <Chip active={assignmentFilter === 'todos'} onClick={() => setAssignmentFilter('todos')}>Todos</Chip>
            <Chip active={assignmentFilter === 'assigned'} onClick={() => setAssignmentFilter('assigned')}>Com vendedor</Chip>
            <Chip active={assignmentFilter === 'unassigned'} onClick={() => setAssignmentFilter('unassigned')}>Sem vendedor</Chip>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar cliente"
            style={{ width: '100%', maxWidth: 360, padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', color: '#fff', fontFamily: 'inherit', fontSize: 13.5, outline: 'none', marginBottom: 18 }}
          />

          {leadsQuery.isLoading ? (
            <div data-testid="platform-clients-loading" style={{ color: 'var(--t-500)', fontSize: 13.5 }}>Carregando…</div>
          ) : leadsQuery.isError ? (
            <div data-testid="platform-clients-error">
              <LCard style={{ textAlign: 'center', color: 'var(--red)' }}>Não foi possível carregar os clientes.</LCard>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div data-testid="platform-clients-empty">
              <LCard style={{ textAlign: 'center', color: 'var(--t-500)' }}>Nenhum cliente encontrado.</LCard>
            </div>
          ) : (
            <div data-testid="platform-clients-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {filteredLeads.map((lead) => (
                <LeadListCard
                  key={lead.id}
                  lead={lead}
                  stageName={resolveLeadStageName(lead.stage_id, stagesQuery.stagesById)}
                  onOpen={() => setSelectedLeadId(lead.id)}
                />
              ))}
            </div>
          )}
        </>
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
