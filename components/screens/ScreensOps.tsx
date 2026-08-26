'use client';
import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, URG, LBtn, LBadge, Chip, Guide, LightScreen, PageHead, LCard } from '@/components/ui/kit';
import { STAGES, TASK_STATE } from '@/lib/data';
import { useStore } from '@/lib/store';
import { LeadService, TaskService, PipelineService, AuthService, SellerService } from '@/lib/services';
import { useRemoteLeadsScreenState, type RemoteLeadsScreenMode } from '@/lib/hooks/useRemoteLeadsScreenState';
import { useRemoteLeadStageMoveController } from '@/lib/hooks/useRemoteLeadStageMoveController';
import { useArchivedLeads } from '@/lib/hooks/useArchivedLeads';
import { useRemoteTasksScreenState } from '@/lib/hooks/useRemoteTasksScreenState';
import { useCompleteTask } from '@/lib/hooks/useCompleteTask';
import { isRemoteTasksError } from '@/lib/tasks/errors';
import { resolveLeadMutationCapabilities, type LeadMutationCapabilities } from '@/lib/leads/mutationCapabilities';
import { canActorMutateLead } from '@/lib/leads/leadMutationOwnership';
import { adaptLeadRows } from '@/lib/leads/adapter';
import type { RemoteLeadsErrorCode } from '@/lib/leads/errors';
import type { RemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';
import type { PipelineStage } from '@/lib/pipeline/adapter';

// M1-E E5-B1: mensagens sanitizadas fixas do movimento remoto do Kanban —
// mesmo modelo de remoteLeadErrorMessage (Flows2.tsx), próprio deste
// arquivo (nunca importado de lá): nenhum UUID/SQL/RPC/payload/stack.
// identity_changed nunca chega aqui — o controller descarta antes de
// popular errorCodeByLead. company_required/company_not_found nunca
// ocorrem neste caminho (Manager/Seller nunca enviam p_company_id), por
// isso caem no genérico em vez de mensagem inventada.
function remoteLeadMoveErrorMessage(code: RemoteLeadsErrorCode | undefined): string {
  switch (code) {
    case 'remote_leads_mutation_stage_not_found':
      return 'A etapa selecionada não está mais disponível.';
    case 'remote_leads_mutation_lead_not_found':
      return 'Este Lead não está mais disponível.';
    case 'remote_leads_mutation_lead_archived':
      return 'Este Lead foi arquivado e não pode ser movimentado.';
    case 'remote_leads_mutation_forbidden':
      return 'Você não possui permissão para movimentar este Lead.';
    case 'remote_leads_mutation_company_read_only':
      return 'Esta empresa está em modo somente leitura.';
    default:
      return 'Não foi possível movimentar o Lead.';
  }
}

// COMMERCIAL-REMOTE-B1-B3-C2: mensagens sanitizadas fixas da conclusão
// remota de Tasks — mesmo modelo de remoteLeadMoveErrorMessage acima:
// nenhum UUID/SQL/RPC/payload/stack, nenhum código bruto. identity_changed
// nunca chega aqui — o handler de TaskRow descarta antes (não é um erro
// pertencente à identidade atual, não deve aparecer para o novo usuário).
function remoteTaskCompleteErrorMessage(error: unknown): string {
  const code = isRemoteTasksError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_tasks_mutation_stale_write':
      return 'Esta pendência foi alterada. Os dados foram atualizados.';
    case 'remote_tasks_mutation_already_completed':
      return 'Esta pendência já foi concluída.';
    case 'remote_tasks_mutation_task_not_found':
      return 'Esta pendência não está mais disponível.';
    case 'remote_tasks_mutation_forbidden':
      return 'Você não tem permissão para concluir esta pendência.';
    default:
      return 'Não foi possível concluir a pendência. Tente novamente.';
  }
}

// M1-E E4-B2: deriva o flagMode das capabilities a partir do MESMO
// remote.mode que a tela já usa para tudo (leitura, estados, testes) — nunca
// re-resolve a flag de ambiente de forma independente aqui. Isso é o que
// torna `remote.mode` a única fonte da verdade (inclusive em testes que
// mockam useRemoteLeadsScreenState diretamente, sem tocar em lib/flags).
function flagModeFromScreenState(mode: RemoteLeadsScreenMode): RemoteLeadsFlagMode {
  if (mode === 'local') return 'local';
  if (mode === 'remote_misconfigured') return 'remote_misconfigured';
  return 'remote_ready'; // remote_unavailable_identity | remote_active
}

import { isSuperAdminCommercialReadEnabled } from '@/lib/flags';
import { PlatformCommercialClientsView } from '@/components/commercial/PlatformCommercialClientsView';
import { PlatformCommercialPipelineView } from '@/components/commercial/PlatformCommercialPipelineView';
import { useOperationalCompanyContext } from '@/lib/operational/OperationalCompanyContext';
import { usePlatformTasksScreenState } from '@/lib/hooks/usePlatformTasksScreenState';

const STAGE_TONE: Record<string, string> = {
  'Novo': 'green', 'Qualificado': 'green', 'Visita agendada': 'amber',
  'Em negociação': 'amber', 'Fechamento': 'green',
};

function LeadCard({ lead, go, capabilities, canLigar }: {
  lead: any; go: any; capabilities?: LeadMutationCapabilities | null;
  // M1-E E5-B2-A2 — só significativo quando capabilities está presente
  // (caminho remoto), já resolvido pelo chamador via canActorMutateLead
  // (mesmo padrão de moveAuthorized em PipeCard/E5-B1).
  canLigar?: boolean;
}) {
  const u = (URG as any)[lead.urgency];
  const red = lead.urgency === 'red';
  const green = lead.urgency === 'green';
  const av = red ? 50 : green ? 36 : 42;
  // M1-E E4-B2: ausência de capabilities = caminho local (acesso integral,
  // igual a antes desta etapa). M1-E E5-B2-A2: Ligar agora deixou de
  // depender de canApplyEvents — usa canLigar (capability + posse do
  // Lead). Visita continua atrás de canApplyEvents (picker de 18 eventos,
  // ainda fora do E5-B2-A2).
  const showLigar = capabilities ? Boolean(canLigar) : true;
  const showVisita = capabilities ? capabilities.canApplyEvents : true;
  const quickActionsHidden = !showLigar && !showVisita;
  return (
    <div className="lift" onClick={() => (window as any).__openFlow('ver-cliente', { lead, capabilities: capabilities ?? null })} style={{
      background: red
        ? 'linear-gradient(180deg, rgba(255,46,46,.18), rgba(255,46,46,.03)), #161618'
        : green ? 'linear-gradient(180deg, #151517, #0f0f11)'
        : 'linear-gradient(180deg, #1a1a1d, #131315)',
      border: `1px solid ${red ? 'var(--red-line)' : 'var(--border)'}`,
      borderLeft: `${red ? 5 : 3}px solid ${u.c}`, borderRadius: 'var(--radius)',
      boxShadow: red ? '0 20px 46px -20px rgba(255,30,30,.42)' : 'var(--shadow-md)',
      animation: red ? 'redScream 2.4s ease-in-out infinite' : 'none',
      padding: red ? 20 : green ? 15 : 18, display: 'flex', flexDirection: 'column', gap: green ? 10 : 13,
      opacity: green ? 0.94 : 1, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar name={lead.name} size={av} ring={u.c} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: red ? 17.5 : green ? 14.5 : 16, color: 'var(--t-900)' }}>{lead.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: green ? 12 : 13, color: 'var(--t-500)', marginTop: 2 }}>
            <Icon name="phone" size={12} stroke={2} /> {lead.phone}
          </div>
        </div>
        <LBadge tone={lead.urgency} solid={red}>{red && <Icon name="flame" size={12} stroke={2.4} />}{u.label}</LBadge>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: green ? 12.5 : 13.5, color: 'var(--t-700)' }}>
        <Icon name="car" size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
        <span style={{ fontWeight: 600 }}>{lead.car}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'var(--t-700)', fontWeight: 600 }}>{lead.stage}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--t-500)' }}>
        <Icon name="users" size={12} stroke={2} /> {lead.seller || '-'}
      </div>

      {green ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <Icon name="check" size={14} stroke={2.4} style={{ color: u.c }} />
          <span style={{ color: 'var(--t-500)', fontWeight: 600 }}>{lead.alert}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t-400)' }}>{lead.last}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: red ? '12px 14px' : '10px 12px', borderRadius: 10, background: red ? 'rgba(255,46,46,.16)' : u.bg, border: `1px solid ${u.line}` }}>
          <Icon name={red ? 'flame' : 'clock'} size={red ? 18 : 16} stroke={2.2} style={{ color: u.c }} />
          <span style={{ fontSize: red ? 14 : 13, fontWeight: 700, color: u.c }}>{lead.alert}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: red ? '#FFB3B3' : 'var(--t-400)' }}>{lead.last}</span>
        </div>
      )}

      {/* Card itself opens Central do Cliente (M0-K3.2, correção 4) — internal
          buttons stop propagation so Ligar/Visita don't also trigger it.
          M1-E E5-B2-A2: no modo remoto, Ligar usa canLigar (capability +
          posse do Lead); Visita continua atrás de canApplyEvents (sempre
          false até o picker de eventos existir) — as duas ações somem
          independentemente uma da outra; só a abertura do detalhe é
          garantida. */}
      <div style={{ display: 'flex', gap: 8 }} onClick={(e: any) => e.stopPropagation()}>
        {showLigar && <LBtn size="sm" kind={red ? 'danger' : green ? 'ghost' : 'primary'} icon="phone" style={{ flex: 1, justifyContent: 'center' }} onClick={() => (window as any).__openFlow('ligar', { lead })}>{green ? 'Ligar' : 'Ligar agora'}</LBtn>}
        {showVisita && !green && <LBtn size="sm" kind="ghost" icon="calendar" onClick={() => (window as any).__openFlow('criar-visita', { lead })}>Visita</LBtn>}
        <LBtn size="sm" kind="ghost" icon="arrowRight" style={quickActionsHidden ? { flex: 1, justifyContent: 'center' } : undefined} onClick={() => (window as any).__openFlow('ver-cliente', { lead, capabilities: capabilities ?? null })} />
      </div>
    </div>
  );
}

const CLIENT_FILTERS = ['Todos', 'Atrasados', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação'];
const URGENCY_RANK: Record<string, number> = { red: 0, amber: 1, green: 2 };

function sortByUrgency(list: any[]): any[] {
  return [...list].sort((a: any, b: any) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);
}

function filterByStageOrDelay(leads: any[], filter: string): any[] {
  return leads.filter((l: any) => {
    if (filter === 'Todos') return true;
    if (filter === 'Atrasados') return l.urgency === 'red';
    return l.stage === filter;
  });
}

function ClientesGridSkeleton({ testId }: { testId: string }) {
  return (
    <div data-testid={testId} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', minHeight: 180, opacity: 0.55 }} />
      ))}
    </div>
  );
}

// M1-E E6-B2-B — item read-only da lista de Arquivados (Manager). Nunca
// abre ações de Lead ativo (Ligar/Visita/Editar/Atribuir/Arquivar) — só
// abre o detalhe read-only (`ver-cliente-arquivado`), que decide sozinho se
// mostra "Restaurar Lead" (capabilities.canArchive, a mesma que governa
// archive/unarchive — nunca canUnarchive separado).
function ArchivedLeadRow({ lead }: { lead: any }) {
  const archivedAtLabel = (() => {
    if (!lead.archivedAt) return null;
    const d = new Date(lead.archivedAt);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR');
  })();
  return (
    <div
      className="lift"
      data-testid={`arquivados-item-${lead.id}`}
      onClick={() => (window as any).__openFlow('ver-cliente-arquivado', { lead })}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12,
        border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer',
      }}
    >
      <Avatar name={lead.name} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{lead.name}</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap', fontSize: 12, color: 'var(--t-500)' }}>
          {lead.car && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="car" size={12} stroke={2} /> {lead.car}</span>
          )}
          <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,.06)' }}>{lead.stage}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="users" size={12} stroke={2} /> {lead.seller || '-'}</span>
          {archivedAtLabel && <span>Arquivado em {archivedAtLabel}</span>}
        </div>
      </div>
      <Icon name="arrowRight" size={16} stroke={2} style={{ color: 'var(--t-400)' }} />
    </div>
  );
}

// M1-F S8-C2-B2: corpo LEGADO de Clientes (Manager/Seller) — extraído sem
// nenhuma alteração funcional/visual, exportado como ScreenClientes (router,
// zero hooks) mais abaixo. Super Admin nunca monta este componente.
//
// M1-E E3-B1: com REMOTE_LEADS efetiva, este componente lê exclusivamente
// useRemoteLeadsScreenState (Leads/Stages/Sellers reais) — nenhum
// LeadService/SellerService/StoreAdapter é consultado nesse caminho; local
// (REMOTE_LEADS=false) permanece 100% intacto, corpo original preservado
// abaixo sem nenhuma alteração.
function ScreenClientesLegacy({ go, initialFilter }: any) {
  useStore();
  const currentUser = AuthService.getCurrentUser();
  const isSeller = currentUser?.activeMembership?.role === 'seller';
  const remote = useRemoteLeadsScreenState(currentUser);
  // M1-E E4-B2: capabilities granulares (canCreate libera o botão "Novo
  // Lead" remoto; o restante é propagado para LeadCard/ver-cliente).
  // flagMode derivado de remote.mode (nunca resolvido de forma
  // independente) — ver flagModeFromScreenState.
  const capabilities = resolveLeadMutationCapabilities({
    flagMode: flagModeFromScreenState(remote.mode),
    profileIsActive: Boolean(currentUser),
    actor: currentUser,
  });
  // M1-E E5-B2-A2 — identidade do ator para autorização por Lead do botão
  // Ligar (canActorMutateLead) — mesmos campos que leadFlowContext.ts já
  // extrai do User, nunca inferidos pelo nome do Seller.
  const membershipRole: 'manager' | 'seller' | null =
    currentUser?.activeMembership?.role === 'manager' || currentUser?.activeMembership?.role === 'seller'
      ? currentUser.activeMembership.role
      : null;
  const actorSellerId = currentUser?.activeMembership?.sellerId ?? null;
  // M1-E E6-B2-B — identidade para useArchivedLeads (mesmos campos que
  // ScreenAndamentoLegacy já extrai para o controller de movimento).
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  const [sellerFilter, setSellerFilter] = useState<string>('Todos');
  // PILOT-UI-TRUTH-FIXES-R1-EXEC §11 — seed opcional vindo da navegação
  // (Home "Ver atrasados" → go('clientes', { filter: 'Atrasados' })). Só
  // aceita um valor pertencente a CLIENT_FILTERS — qualquer outra coisa
  // (undefined, filtro desconhecido) cai no padrão 'Todos' de sempre.
  const [filter, setFilter] = useState(
    typeof initialFilter === 'string' && CLIENT_FILTERS.includes(initialFilter) ? initialFilter : 'Todos',
  );
  // Ativos/Arquivados — Manager-only (gate real é capabilities.canArchive,
  // calculado abaixo; Seller nunca vê o toggle, então nunca sai de
  // 'ativos'). Chamado sempre (Rules of Hooks) — useArchivedLeads já gateia
  // Manager-only/remote_ready internamente, então para Seller a query nunca
  // dispara mesmo que este estado pudesse mudar.
  const [clientsArea, setClientsArea] = useState<'ativos' | 'arquivados'>('ativos');
  const archived = useArchivedLeads({ userId, companyId, membershipRole: currentUser?.activeMembership?.role ?? null, userIsActive });

  if (remote.mode !== 'local') {
    const { pipeline, sellerLabels, leads: leadsQuery } = remote;
    const isActive = remote.mode === 'remote_active';
    const showChrome = remote.mode !== 'remote_misconfigured' && remote.mode !== 'remote_unavailable_identity';

    const stagesConfigError = isActive && pipeline.configError !== null;
    const stagesBlockingError = isActive && pipeline.isError && !pipeline.hasData && !stagesConfigError;
    const stagesEmpty = isActive && pipeline.isEmpty && !pipeline.isError && !stagesConfigError;
    const stagesLoading = isActive && !pipeline.hasData && !stagesConfigError && !stagesBlockingError && !stagesEmpty;
    const leadsConfigError = isActive && !stagesLoading && !stagesConfigError && !stagesBlockingError && !stagesEmpty && leadsQuery.configError !== null;
    const leadsBlockingError = isActive && !stagesLoading && !stagesConfigError && !stagesBlockingError && !stagesEmpty && !leadsConfigError && leadsQuery.isError && !leadsQuery.hasData && !leadsQuery.isEmpty;
    const leadsLoading = isActive && !stagesLoading && !stagesConfigError && !stagesBlockingError && !stagesEmpty && !leadsConfigError && !leadsBlockingError && leadsQuery.isLoading && !leadsQuery.hasData && !leadsQuery.isEmpty;
    const leadsEmpty = isActive && !stagesLoading && !stagesConfigError && !stagesBlockingError && !stagesEmpty && !leadsConfigError && !leadsBlockingError && !leadsLoading && leadsQuery.isEmpty;
    const leadsStale = isActive && leadsQuery.isError && leadsQuery.hasData;

    // M1-E E6-B2-B — área "Arquivados": só quando o Manager está realmente
    // operacional em remote_ready (mesma condição que libera Alterar
    // responsável/Arquivar Lead no E6-B2-A — nunca uma checagem nova
    // paralela). Reaproveita os estados de Stage já computados acima (o
    // catálogo de etapas é compartilhado entre Ativos e Arquivados).
    const showArchivedArea = capabilities.canArchive;
    let archivedBody: React.ReactNode = null;
    if (showArchivedArea && clientsArea === 'arquivados') {
      if (stagesConfigError) {
        archivedBody = <KanbanStateCard testId="arquivados-state-stage-config-error">As etapas da loja não correspondem à configuração esperada.</KanbanStateCard>;
      } else if (stagesBlockingError) {
        archivedBody = <KanbanStateCard testId="arquivados-state-error" onRetry={() => pipeline.refetch()}>Não foi possível carregar as etapas.</KanbanStateCard>;
      } else if (stagesEmpty) {
        archivedBody = <KanbanStateCard testId="arquivados-state-stage-empty">Nenhuma etapa configurada para sua loja.</KanbanStateCard>;
      } else if (stagesLoading || archived.isLoading) {
        archivedBody = <ClientesGridSkeleton testId="arquivados-skeleton" />;
      } else if (archived.isError) {
        archivedBody = <KanbanStateCard testId="arquivados-state-error" onRetry={() => archived.refetch()}>Não foi possível carregar os Leads arquivados.</KanbanStateCard>;
      } else {
        const adaptedArchived = adaptLeadRows(archived.leads, { stagesById: pipeline.byId, sellersById: sellerLabels.sellersById });
        if (!adaptedArchived.ok) {
          archivedBody = <KanbanStateCard testId="arquivados-state-lead-config-error">Um ou mais Leads arquivados estão com configuração inválida.</KanbanStateCard>;
        } else if (adaptedArchived.leads.length === 0) {
          archivedBody = <KanbanStateCard testId="arquivados-state-empty">Nenhum Lead arquivado.</KanbanStateCard>;
        } else {
          archivedBody = (
            <div data-testid="arquivados-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {adaptedArchived.leads.map((l) => <ArchivedLeadRow key={l.id} lead={l} />)}
            </div>
          );
        }
      }
    }

    const allLeads: any[] = isActive ? [...leadsQuery.leads] : [];
    const leadsFiltered = (!isSeller && sellerFilter !== 'Todos')
      ? allLeads.filter((l: any) => l.sellerId === sellerFilter)
      : allLeads;
    const delayed = leadsFiltered.filter((l: any) => l.urgency === 'red').length;
    const sorted = sortByUrgency(filterByStageOrDelay(leadsFiltered, filter));

    let gridBody: React.ReactNode;
    if (remote.mode === 'remote_misconfigured') {
      gridBody = <KanbanStateCard testId="clientes-state-misconfigured">As etapas remotas precisam estar disponíveis para carregar os Leads.</KanbanStateCard>;
    } else if (remote.mode === 'remote_unavailable_identity') {
      gridBody = <KanbanStateCard testId="clientes-state-disabled">Sessão indisponível. Entre novamente para ver seus clientes.</KanbanStateCard>;
    } else if (stagesConfigError) {
      gridBody = <KanbanStateCard testId="clientes-state-stage-config-error">As etapas da loja não correspondem à configuração esperada.</KanbanStateCard>;
    } else if (stagesBlockingError) {
      gridBody = <KanbanStateCard testId="clientes-state-error" onRetry={() => pipeline.refetch()}>Não foi possível carregar as etapas.</KanbanStateCard>;
    } else if (stagesEmpty) {
      gridBody = <KanbanStateCard testId="clientes-state-stage-empty">Nenhuma etapa configurada para sua loja.</KanbanStateCard>;
    } else if (stagesLoading) {
      gridBody = <ClientesGridSkeleton testId="clientes-skeleton" />;
    } else if (leadsConfigError) {
      gridBody = <KanbanStateCard testId="clientes-state-lead-config-error" onRetry={() => leadsQuery.refetch()}>Um ou mais clientes remotos estão com configuração inválida.</KanbanStateCard>;
    } else if (leadsBlockingError) {
      gridBody = <KanbanStateCard testId="clientes-state-error" onRetry={() => leadsQuery.refetch()}>Não foi possível carregar os clientes.</KanbanStateCard>;
    } else if (leadsLoading) {
      gridBody = <ClientesGridSkeleton testId="clientes-skeleton" />;
    } else if (leadsEmpty) {
      gridBody = <KanbanStateCard testId="clientes-state-empty">Nenhum cliente cadastrado ainda.</KanbanStateCard>;
    } else {
      gridBody = (
        <div data-testid="clientes-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
          {sorted.map((l: any) => {
            const canLigar = canActorMutateLead({
              capability: capabilities.canLogCallOutcome,
              actorRole: membershipRole,
              actorSellerId,
              leadSellerId: l.sellerId ?? null,
            });
            return <LeadCard key={l.id} lead={l} go={go} capabilities={capabilities} canLigar={canLigar} />;
          })}
        </div>
      );
    }

    const showArchivedTab = clientsArea === 'arquivados' && showArchivedArea;

    return (
      <LightScreen>
        <PageHead title="Clientes" sub="Cada cliente mostra na cor o que precisa de você. Vermelho = aja agora."
          actions={capabilities.canCreate ? <LBtn kind="gold" icon="plus" size="lg" onClick={() => (window as any).__openFlow('novo-cliente')}>Novo Lead</LBtn> : undefined} />
        {showArchivedArea && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }} data-testid="clientes-area-toggle">
            <Chip active={clientsArea === 'ativos'} onClick={() => setClientsArea('ativos')}>Ativos</Chip>
            <Chip active={clientsArea === 'arquivados'} onClick={() => setClientsArea('arquivados')}>Arquivados</Chip>
          </div>
        )}
        {showArchivedTab ? (
          archivedBody
        ) : (
          <>
            {showChrome && leadsStale && (
              <div data-testid="clientes-stale-warning" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'var(--amber-bg, rgba(255,163,31,.08))', border: '1px solid var(--amber-line, rgba(255,163,31,.3))', color: 'var(--t-700)', fontSize: 13 }}>
                <Icon name="alert" size={15} stroke={2.2} style={{ color: 'var(--amber)' }} />
                <span>Não foi possível atualizar os clientes. Exibindo dados anteriores.</span>
                <button onClick={() => leadsQuery.refetch()} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-700)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, textDecoration: 'underline' }}>Tentar novamente</button>
              </div>
            )}
            {showChrome && (
              <Guide tone="red" icon="flame" scream text={<span>Você tem <b>{delayed} clientes atrasados</b> sem contato. Comece por eles. São os que mais esfriam.</span>} action="Ver atrasados" onAction={() => setFilter('Atrasados')} />
            )}
            {showChrome && !isSeller && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <Chip active={sellerFilter === 'Todos'} onClick={() => setSellerFilter('Todos')}>Todos</Chip>
                {sellerLabels.sellerLabels.map((s) => <Chip key={s.seller_id} active={sellerFilter === s.seller_id} onClick={() => setSellerFilter(s.seller_id)}>{s.name}</Chip>)}
              </div>
            )}
            {showChrome && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                {CLIENT_FILTERS.map(f => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f === 'Atrasados' ? `Atrasados (${delayed})` : f}</Chip>)}
              </div>
            )}
            {gridBody}
          </>
        )}
      </LightScreen>
    );
  }

  // ── Caminho LOCAL (REMOTE_LEADS=false): comportamento M0 inalterado ─────
  const allLeads = LeadService.getAll(); // already RBAC-scoped: seller sees only their own here
  const sellers = SellerService.getAll();
  const leads = (!isSeller && sellerFilter !== 'Todos')
    ? allLeads.filter((l: any) => l.sellerId === sellerFilter)
    : allLeads;
  const delayed = leads.filter((l: any) => l.urgency === 'red').length;
  const sorted = sortByUrgency(filterByStageOrDelay(leads, filter));
  return (
    <LightScreen>
      <PageHead title="Clientes" sub="Cada cliente mostra na cor o que precisa de você. Vermelho = aja agora." actions={<LBtn kind="gold" icon="plus" size="lg" onClick={() => (window as any).__openFlow('novo-cliente')}>Novo cliente</LBtn>} />
      <Guide tone="red" icon="flame" scream text={<span>Você tem <b>{delayed} clientes atrasados</b> sem contato. Comece por eles. São os que mais esfriam.</span>} action="Ver atrasados" onAction={() => setFilter('Atrasados')} />
      {!isSeller && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Chip active={sellerFilter === 'Todos'} onClick={() => setSellerFilter('Todos')}>Todos</Chip>
          {sellers.map((s: any) => <Chip key={s.id} active={sellerFilter === s.id} onClick={() => setSellerFilter(s.id)}>{s.first}</Chip>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {CLIENT_FILTERS.map(f => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f === 'Atrasados' ? `Atrasados (${delayed})` : f}</Chip>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        {sorted.map((l: any) => <LeadCard key={l.id} lead={l} go={go} />)}
      </div>
    </LightScreen>
  );
}

// M1-F S8-C2-B2: router de "Clientes" — ZERO hooks próprios (Rules of
// Hooks: a escolha é de QUAL componente montar, nunca de qual hook chamar
// dentro do MESMO componente). Super Admin + flag comercial ON monta a
// superfície platform (somente leitura, dados reais); qualquer outro caso
// (Manager/Seller, ou Super Admin com a flag OFF) monta o corpo legado
// intacto. `User.role` legado nem existe mais no tipo — nunca decidiu
// este switch.
export function ScreenClientes({ go, initialFilter }: any) {
  const currentUser = AuthService.getCurrentUser();
  const isSuperAdmin = currentUser?.platformRole === 'super_admin';
  if (isSuperAdmin && isSuperAdminCommercialReadEnabled()) {
    return <PlatformCommercialClientsView userId={currentUser!.id} platformRole={currentUser!.platformRole} />;
  }
  return <ScreenClientesLegacy go={go} initialFilter={initialFilter} />;
}

function PipeCard({ lead, go, dragging, onDragStart, onDragEnd, capabilities, moveAuthorized, isPending, errorMessage }: {
  lead: any; go: any; dragging: boolean; onDragStart: any; onDragEnd: any; capabilities?: LeadMutationCapabilities | null;
  // M1-E E5-B1 — só significativos quando capabilities está presente (caminho remoto).
  moveAuthorized?: boolean; isPending?: boolean; errorMessage?: string | null;
}) {
  const u = (URG as any)[lead.urgency];
  // M1-E E4-B2: ausência de capabilities = caminho local (drag integral).
  // M1-E E5-B1: presença de capabilities = caminho remoto — canDrag agora
  // exige a capability genérica (canMoveStage) E a posse deste Lead
  // específico (moveAuthorized, resolvido pelo chamador via
  // canActorMutateLead) E que este Lead não esteja com um movimento
  // pendente — nunca um segundo drag/drop no mesmo Lead enquanto o
  // primeiro não confirmou.
  const canDrag = capabilities ? (capabilities.canMoveStage && Boolean(moveAuthorized) && !isPending) : true;
  return (
    <div
      draggable={canDrag}
      data-testid={`pipe-card-${lead.id}`}
      onDragStart={(e: any) => {
        if (!canDrag) return;
        // dataTransfer.setData is required for Firefox to allow the drag to start at
        // all, but the id is read back from lifted React state on drop, not from
        // dataTransfer.getData — some browsers restrict/lose that payload depending
        // on the drag phase, which was silently swallowing the drop (M0-K1.5, bug 1).
        // M1-E E5-B1: payload mínimo — só o id (nenhum nome/telefone/veículo/
        // Seller/objeto completo). No caminho remoto, sourceStageId/targetStageId
        // são resolvidos no drop a partir da lista remota atual, nunca daqui.
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(lead.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => (window as any).__openFlow('ver-cliente', { lead, capabilities: capabilities ?? null })} style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${u.c}`,
      borderRadius: 10, padding: 12, cursor: isPending ? 'wait' : 'grab', boxShadow: 'var(--shadow-sm)',
      opacity: dragging ? 0.4 : isPending ? 0.7 : 1,
      transition: 'transform .12s, box-shadow .12s, opacity .12s',
    }}
      onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
      onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>{lead.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isPending && (
            <span data-testid={`pipe-card-pending-${lead.id}`}>
              <LBadge tone="amber">Salvando…</LBadge>
            </span>
          )}
          {lead.urgency === 'red' && <Icon name="flame" size={15} stroke={2.4} style={{ color: 'var(--red)' }} />}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon name="car" size={13} stroke={2} /> {lead.car}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border-2)' }}>
        <Avatar name={lead.seller} size={20} />
        <span style={{ fontSize: 11.5, color: 'var(--t-500)' }}>{lead.seller.split(' ')[0]}</span>
      </div>
      {errorMessage && (
        <div data-testid={`pipe-card-error-${lead.id}`} style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}

// M1-D: cores das colunas do Kanban por CODE (contrato estável), não por name —
// o name é editável no futuro; o code não. O caminho local também recebe os
// codes oficiais via adaptLocalStageNames, então uma única função serve os
// dois sources. Code desconhecido cai no tom neutro.
const STAGE_CODE_TONES: Record<string, string> = {
  new: '#8B8B93', qualified: '#27C75F', visit_scheduled: '#FFA31F',
  negotiation: '#3B82F6', closing: '#E8CE72',
};
const NEUTRAL_STAGE_TONE = '#8B8B93';
export function getPipelineStageTone(code: string): string {
  return STAGE_CODE_TONES[code] ?? NEUTRAL_STAGE_TONE;
}

function KanbanStateCard({ testId, children, onRetry }: { testId: string; children: React.ReactNode; onRetry?: () => void }) {
  return (
    <LCard style={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
      <div data-testid={testId} style={{ display: 'grid', placeItems: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ color: 'var(--t-500)', fontSize: 14, maxWidth: 420 }}>{children}</div>
        {onRetry && <LBtn kind="primary" icon="refresh" onClick={onRetry}>Tentar novamente</LBtn>}
      </div>
    </LCard>
  );
}

// M1-F S8-C2-B2: corpo LEGADO de Andamento (Manager/Seller) — extraído sem
// nenhuma alteração funcional/visual além da correção do achado 1 do
// S8-C2-A1 (companyId agora vem de activeMembership.companyId, nunca do
// legado profiles.company_id) — exportado como ScreenAndamento (router,
// zero hooks) mais abaixo. Super Admin nunca monta este componente.
//
// M1-E E3-B1: pipeline continua vindo de useRemoteLeadsScreenState (mesmo
// usePipelineStages de sempre, agora composto com Leads/Sellers remotos) —
// com REMOTE_LEADS=false o comportamento é IDÊNTICO ao anterior (inclusive
// "Stages remotos + Leads locais agrupados por name", já aprovado no M1-D).
// Só quando REMOTE_LEADS estiver efetiva (remote.mode==='remote_active') o
// Kanban passa a usar Leads remotos agrupados por stageId — nunca por name.
function ScreenAndamentoLegacy({ go }: any) {
  useStore();
  const currentUser = AuthService.getCurrentUser();
  const isSeller = currentUser?.activeMembership?.role === 'seller';
  // Manager/admin see everyone by default and narrow by seller — a seller
  // never sees this control at all, since leads here are already scoped to
  // their own (local: LeadService.getAll(); remoto: RLS no backend).
  const [sellerFilter, setSellerFilter] = useState<string>('Todos');
  const [overStage, setOverStage] = useState<string | null>(null);
  // Source of truth for "which lead is being dragged" — deliberately not
  // dataTransfer.getData() at drop time, which is what silently dropped
  // moves before they ever reached PipelineService.moveCard (M0-K1.5, bug 1).
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // M1-D: colunas podem vir do Supabase sob a feature flag. Identidade já
  // resolvida pelo caller do app: AuthService só cacheia profiles ATIVOS
  // (_loadProfile rejeita is_active=false e login desfaz meia-sessão), então
  // Boolean(currentUser) significa "profile ativo resolvido" — nunca um
  // true fixo. Com a flag OFF o hook devolve os mesmos names locais de
  // PipelineService.getStages() adaptados, sem nenhuma chamada remota.
  //
  // M1-E E3-B1: useRemoteLeadsScreenState chama usePipelineStages com a
  // MESMA identidade que antes (companyId de activeMembership.companyId,
  // nunca do legado profiles.company_id) — nenhuma mudança de contrato.
  const remote = useRemoteLeadsScreenState(currentUser);
  const pipeline = remote.pipeline;
  const isRemoteLeadsActive = remote.mode === 'remote_active';
  const isMisconfigured = remote.mode === 'remote_misconfigured';
  // M1-E E4-B2/E5-B1: capabilities granulares — canMoveStage foi ativado no
  // E5-B1 (drag remoto conectado a move_lead_to_stage). flagMode derivado
  // de remote.mode (nunca resolvido de forma independente) — ver
  // flagModeFromScreenState.
  const capabilities = resolveLeadMutationCapabilities({
    flagMode: flagModeFromScreenState(remote.mode),
    profileIsActive: Boolean(currentUser),
    actor: currentUser,
  });

  // M1-E E5-B1 — identidade do ator para autorização por Lead (canActorMutateLead)
  // e para o controller de movimento. Mesmos campos que leadFlowContext.ts já
  // extrai do User, nunca inferidos.
  const membershipRole: 'manager' | 'seller' | null =
    currentUser?.activeMembership?.role === 'manager' || currentUser?.activeMembership?.role === 'seller'
      ? currentUser.activeMembership.role
      : null;
  const actorSellerId = currentUser?.activeMembership?.sellerId ?? null;
  const companyId = currentUser?.activeMembership?.companyId ?? null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);
  // Muda em logout/troca de empresa/membership/transferência/suspensão —
  // o controller descarta pendência/erro visuais antigos quando isso muda
  // (decisão humana #15 do E5-B1).
  const identityKey = `${userId ?? ''}:${companyId ?? ''}`;

  // Chamado SEMPRE (Rules of Hooks) — nenhuma mutation real é disparada até
  // attemptMove ser chamado a partir do drop; useMoveLeadToStage (dentro do
  // controller) já bloqueia sem identidade operacional.
  const moveController = useRemoteLeadStageMoveController({
    userId, companyId, membershipRole, userIsActive, identityKey,
  });

  // Diagnóstico de configuração incompatível: detalhes só em development —
  // o usuário final vê apenas a mensagem amigável do estado dedicado.
  useEffect(() => {
    if (pipeline.configError && process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error('[AutoCRM] pipeline_stages name-mismatch:', pipeline.configError);
    }
  }, [pipeline.configError]);

  // M1-E E3-B1: Leads remotos (RLS já escopada) quando o caminho remoto está
  // efetivo; caminho local (LeadService.getAll()) em qualquer outro caso —
  // exatamente como antes desta etapa quando REMOTE_LEADS=false.
  const allLeads: any[] = isRemoteLeadsActive ? [...remote.leads.leads] : LeadService.getAll();
  const sellers = isRemoteLeadsActive ? null : SellerService.getAll();
  const leads = (!isSeller && sellerFilter !== 'Todos')
    ? allLeads.filter((l: any) => l.sellerId === sellerFilter)
    : allLeads;
  const endDrag = () => { setDraggedId(null); setOverStage(null); };

  // Estados do caminho remoto de STAGES (flag REMOTE_STAGES ON) — IDÊNTICOS
  // aos de antes desta etapa; source==='remote' independe de REMOTE_LEADS.
  const isRemoteStages = pipeline.source === 'remote';
  const showDisabled = isRemoteStages && !pipeline.queryEnabled;
  const showSkeleton = isRemoteStages && pipeline.queryEnabled && pipeline.isLoading && !pipeline.hasData;
  const showConfigError = isRemoteStages && pipeline.configError !== null;
  const showBlockingError = isRemoteStages && pipeline.isError && !pipeline.hasData && !showConfigError;
  const showEmpty = isRemoteStages && pipeline.isEmpty && !pipeline.isError && !showConfigError;
  const showStaleWarning = isRemoteStages && pipeline.isError && pipeline.hasData;

  // Estados NOVOS, exclusivos do caminho remoto de LEADS (REMOTE_LEADS
  // efetiva) — só avaliados depois que Stages já está saudável (o próprio
  // useRemoteLeadsScreenState só habilita a query de Leads quando
  // pipeline.hasData, então nenhum destes é alcançável enquanto Stages
  // estiver em loading/erro/vazio/configError).
  const showLeadsConfigError = isRemoteLeadsActive && remote.leads.configError !== null;
  const showLeadsBlockingError = isRemoteLeadsActive && !showLeadsConfigError && remote.leads.isError && !remote.leads.hasData && !remote.leads.isEmpty;
  const showLeadsSkeleton = isRemoteLeadsActive && !showLeadsConfigError && !showLeadsBlockingError && remote.leads.isLoading && !remote.leads.hasData && !remote.leads.isEmpty;
  const showLeadsStaleWarning = isRemoteLeadsActive && remote.leads.isError && remote.leads.hasData;

  let body: React.ReactNode;
  if (isMisconfigured) {
    // REMOTE_LEADS=true e REMOTE_STAGES=false: falha fechada — nunca cai no
    // caminho local de pipeline.source (que ficaria 'local' aqui, já que
    // usePipelineStages também respeita a própria flag independente).
    body = (
      <KanbanStateCard testId="kanban-state-misconfigured">
        As etapas remotas precisam estar disponíveis para carregar os Leads.
      </KanbanStateCard>
    );
  } else if (showDisabled) {
    // Defensivo: App.tsx nunca monta telas sem currentUser ativo (mostra a
    // AuthFlow antes) — se chegar aqui, a sessão/profile ficou indisponível.
    body = (
      <KanbanStateCard testId="kanban-state-disabled">
        Sessão indisponível. Entre novamente para ver o pipeline da sua loja.
      </KanbanStateCard>
    );
  } else if (showSkeleton) {
    body = (
      <div data-testid="kanban-skeleton" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(210px, 1fr))', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, minHeight: 360, opacity: 0.55 }} />
        ))}
      </div>
    );
  } else if (showConfigError) {
    body = (
      <KanbanStateCard testId="kanban-state-config-error" onRetry={() => pipeline.refetch()}>
        As etapas da loja não correspondem à configuração esperada.
      </KanbanStateCard>
    );
  } else if (showBlockingError) {
    body = (
      <KanbanStateCard testId="kanban-state-error" onRetry={() => pipeline.refetch()}>
        Não foi possível carregar as etapas do pipeline.
      </KanbanStateCard>
    );
  } else if (showEmpty) {
    body = (
      <KanbanStateCard testId="kanban-state-empty">
        Nenhuma etapa configurada para sua loja.
      </KanbanStateCard>
    );
  } else if (showLeadsConfigError) {
    body = (
      <KanbanStateCard testId="kanban-state-leads-config-error" onRetry={() => remote.leads.refetch()}>
        Um ou mais clientes remotos estão com configuração inválida.
      </KanbanStateCard>
    );
  } else if (showLeadsBlockingError) {
    body = (
      <KanbanStateCard testId="kanban-state-leads-error" onRetry={() => remote.leads.refetch()}>
        Não foi possível carregar os clientes do pipeline.
      </KanbanStateCard>
    );
  } else if (showLeadsSkeleton) {
    body = (
      <div data-testid="kanban-leads-skeleton" style={{ display: 'grid', gridTemplateColumns: `repeat(${pipeline.stages.length}, minmax(210px, 1fr))`, gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
        {pipeline.stages.map((s: PipelineStage) => (
          <div key={s.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12, minHeight: 360, opacity: 0.55 }} />
        ))}
      </div>
    );
  } else {
    body = (
      <>
        {showStaleWarning && (
          <div data-testid="kanban-stale-warning" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'var(--amber-bg, rgba(255,163,31,.08))', border: '1px solid var(--amber-line, rgba(255,163,31,.3))', color: 'var(--t-700)', fontSize: 13 }}>
            <Icon name="alert" size={15} stroke={2.2} style={{ color: 'var(--amber)' }} />
            <span>Não foi possível atualizar as etapas. Exibindo dados anteriores.</span>
            <button onClick={() => pipeline.refetch()} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-700)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, textDecoration: 'underline' }}>Tentar novamente</button>
          </div>
        )}
        {showLeadsStaleWarning && (
          <div data-testid="kanban-leads-stale-warning" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, borderRadius: 10, background: 'var(--amber-bg, rgba(255,163,31,.08))', border: '1px solid var(--amber-line, rgba(255,163,31,.3))', color: 'var(--t-700)', fontSize: 13 }}>
            <Icon name="alert" size={15} stroke={2.2} style={{ color: 'var(--amber)' }} />
            <span>Não foi possível atualizar os clientes. Exibindo dados anteriores.</span>
            <button onClick={() => remote.leads.refetch()} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-700)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, textDecoration: 'underline' }}>Tentar novamente</button>
          </div>
        )}
        <div data-testid="kanban-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${pipeline.stages.length}, minmax(210px, 1fr))`, gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
          {pipeline.stages.map((stage: PipelineStage) => {
            // M1-E E3-B1: caminho remoto de Leads agrupa por stageId real —
            // nunca por name (decisão 15). Caminho local/stages-remoto-com-
            // leads-local continua por name, exatamente como antes.
            const items = isRemoteLeadsActive
              ? leads.filter((l: any) => l.stageId === stage.id)
              : leads.filter((l: any) => l.stage === stage.name);
            const isOver = overStage === stage.name;
            return (
              <div key={stage.id} data-testid={`kanban-col-${stage.code}`} data-terminal={stage.isTerminal ? 'true' : 'false'}
                onDragOver={(e: any) => { e.preventDefault(); if (draggedId && overStage !== stage.name) setOverStage(stage.name); }}
                onDragLeave={() => setOverStage((s: string | null) => (s === stage.name ? null : s))}
                onDrop={(e: any) => {
                  e.preventDefault();
                  if (isRemoteLeadsActive) {
                    // M1-E E5-B1 — o drag payload é só o id (ver PipeCard); o Lead
                    // atual e o sourceStageId são resolvidos AGORA, pela lista
                    // remota atual (nunca por um objeto capturado no dragStart).
                    const draggedLead = draggedId ? leads.find((l: any) => l.id === draggedId) : null;
                    if (draggedLead) {
                      const moveAuthorized = canActorMutateLead({
                        capability: capabilities.canMoveStage,
                        actorRole: membershipRole,
                        actorSellerId,
                        leadSellerId: draggedLead.sellerId ?? null,
                      });
                      if (moveAuthorized && !moveController.isLeadPending(draggedLead.id)) {
                        moveController.attemptMove({
                          leadId: draggedLead.id,
                          sourceStageId: draggedLead.stageId,
                          targetStageId: stage.id,
                        });
                      }
                    }
                  } else if (draggedId) {
                    PipelineService.moveCard(draggedId, stage.name);
                  }
                  endDrag();
                }}
                style={{ background: 'var(--surface-2)', border: `1px solid ${isOver ? 'var(--gold-line)' : 'var(--border)'}`, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 360, transition: 'border-color .15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                  <span data-testid={`kanban-tone-${stage.code}`} style={{ width: 8, height: 8, borderRadius: 3, background: getPipelineStageTone(stage.code) }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--t-900)' }}>{stage.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--t-500)', background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 8px' }}>{items.length}</span>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                  {items.length ? items.map((l: any) => {
                    // M1-E E5-B1 — posse por Lead: Manager qualquer Lead da
                    // empresa, Seller só o próprio (canActorMutateLead). Só
                    // avaliado no caminho remoto — local preserva drag integral.
                    const moveAuthorized = isRemoteLeadsActive
                      ? canActorMutateLead({
                          capability: capabilities.canMoveStage,
                          actorRole: membershipRole,
                          actorSellerId,
                          leadSellerId: l.sellerId ?? null,
                        })
                      : undefined;
                    return (
                      <PipeCard
                        key={l.id}
                        lead={l}
                        go={go}
                        dragging={draggedId === l.id}
                        onDragStart={setDraggedId}
                        onDragEnd={endDrag}
                        capabilities={isRemoteLeadsActive ? capabilities : undefined}
                        moveAuthorized={moveAuthorized}
                        isPending={isRemoteLeadsActive ? moveController.isLeadPending(l.id) : false}
                        errorMessage={
                          isRemoteLeadsActive && moveController.errorCodeByLead[l.id] !== undefined
                            ? remoteLeadMoveErrorMessage(moveController.errorCodeByLead[l.id])
                            : null
                        }
                      />
                    );
                  })
                    : <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--t-400)', fontSize: 12.5, textAlign: 'center', padding: 20 }}>Nenhum cliente nesta etapa</div>}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <LightScreen>
      <PageHead title="Em progresso" sub="Onde cada cliente está no caminho até a venda. Arraste de etapa quando avançar." />
      {!isSeller && !isMisconfigured && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Chip active={sellerFilter === 'Todos'} onClick={() => setSellerFilter('Todos')}>Todos</Chip>
          {isRemoteLeadsActive
            ? remote.sellerLabels.sellerLabels.map((s) => <Chip key={s.seller_id} active={sellerFilter === s.seller_id} onClick={() => setSellerFilter(s.seller_id)}>{s.name}</Chip>)
            : (sellers ?? []).map((s: any) => <Chip key={s.id} active={sellerFilter === s.id} onClick={() => setSellerFilter(s.id)}>{s.first}</Chip>)}
        </div>
      )}
      {body}
    </LightScreen>
  );
}

// M1-F S8-C2-B2: router de "Em progresso" — mesmo molde de ScreenClientes
// acima (zero hooks próprios, switch por QUAL componente montar).
export function ScreenAndamento({ go }: any) {
  const currentUser = AuthService.getCurrentUser();
  const isSuperAdmin = currentUser?.platformRole === 'super_admin';
  if (isSuperAdmin && isSuperAdminCommercialReadEnabled()) {
    return <PlatformCommercialPipelineView userId={currentUser!.id} platformRole={currentUser!.platformRole} />;
  }
  return <ScreenAndamentoLegacy go={go} />;
}

const PRIO: Record<string, { c: string; label: string }> = {
  alta: { c: 'var(--red)', label: 'Alta' },
  media: { c: 'var(--amber)', label: 'Média' },
  baixa: { c: 'var(--t-400)', label: 'Baixa' },
};

// COMMERCIAL-REMOTE-B1-B3-C1/C2: `remoteActive` vem SEMPRE de
// ScreenPendencias (derivado de remoteTasksScreen.mode) — nunca inferido
// por duck-typing em cima de task.version/task.dueAt. Em remoteActive:
//   - concluir: useCompleteTask({taskId, expectedVersion: task.version}),
//     nunca TaskService.update — montado INCONDICIONALMENTE (Rules of
//     Hooks), uma instância por row (isPending/error isolados por Task);
//   - Reagendar: sempre visível desde o B1-B3-E — FlowReagendarPendencia
//     decide local/remoto sozinho (useUpdateTask full-replace no branch
//     remoto, nunca mais TaskService.update fora de task_local);
//   - nome do Lead: texto não-clicável — LeadService.getAll() remoto pode
//     LANÇAR se o snapshot de Leads ainda não estiver populado (achado do
//     precheck C, §0/§22), e FlowVerCliente exige o Lead completo (não
//     aceita só leadId, confirmado por leitura direta de
//     components/flows/FlowsShared.tsx:840) — nenhum caminho comprovadamente
//     seguro existe ainda para abrir o Lead a partir daqui.
function TaskRow({ task, go, remoteActive, currentUser, readOnly }: any) {
  // No local "done" state — a task marked TASK_STATE.DONE stops matching any
  // of the 3 active groups in ScreenPendencias and simply stops rendering
  // here, via the real store mutation + F5-safe persistence (M0-K2, was a
  // cosmetic-only useState before that reset on every reload).
  const late = task.state === TASK_STATE.LATE;
  const p = PRIO[task.prio];

  // Mesma derivação de identidade já usada por useRemoteTasksScreenState/
  // useTasksRemoteBridgeLifecycle/useCreateTask — não existe um helper
  // compartilhado de identidade de Tasks a reusar (resolveLeadFlowContext é
  // específico de Leads); reimplementar essas 4 linhas é o padrão já
  // estabelecido pelos outros consumidores de Tasks, não duplicação indevida.
  const completeHook = useCompleteTask({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: currentUser?.activeMembership?.role ?? null,
    userIsActive: Boolean(currentUser),
  });
  const [completeError, setCompleteError] = useState<string | null>(null);

  const handleComplete = async () => {
    if (completeHook.isPending) return;
    // task.version já vem validado pelo adapter (Number.isInteger >= 1) —
    // nunca fabricar um valor aqui (nunca `?? 1`/`Number(...) || 1`); se por
    // algum motivo ele não for um inteiro válido, a mutation simplesmente
    // não é chamada.
    const expectedVersion = task.version;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      setCompleteError('Não foi possível concluir a pendência. Tente novamente.');
      return;
    }
    setCompleteError(null);
    try {
      await completeHook.completeTask({ taskId: task.id, expectedVersion });
    } catch (err) {
      // identity_changed nunca vem do backend — só do próprio hook quando a
      // geração do cache muda em voo (logout/troca de empresa). Não é um
      // erro da identidade ATUAL: nunca mostrado, a nova identidade/query já
      // assume a renderização sozinha.
      if (isRemoteTasksError(err) && err.code === 'remote_tasks_mutation_identity_changed') return;
      setCompleteError(remoteTaskCompleteErrorMessage(err));
    }
  };

  const completeDisabled = remoteActive && completeHook.isPending;
  return (
    <>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
      background: late ? 'var(--red-bg)' : 'var(--surface)',
      border: `1px solid ${late ? 'var(--red-line)' : 'var(--border)'}`,
      borderRadius: 11, transition: 'all .2s',
    }}>
      {/* SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §18/§22 — "Concluir
          pendência" é mutation entry point: HIDE (nunca só disabled) para
          Super Admin contextual — nenhum flow escape possível por aqui. */}
      {!readOnly && (
        <button
          onClick={remoteActive ? handleComplete : () => TaskService.update(task.id, { state: TASK_STATE.DONE })}
          disabled={completeDisabled}
          className="focus-ring" title="Concluir pendência" style={{
          width: 24, height: 24, borderRadius: 7, flexShrink: 0, cursor: completeDisabled ? 'default' : 'pointer',
          opacity: completeDisabled ? 0.5 : 1,
          border: `2px solid ${late ? 'var(--red)' : 'var(--border)'}`,
          background: 'transparent', display: 'grid', placeItems: 'center', color: '#fff',
        }} />
      )}
      <div style={{ width: 4, height: 34, borderRadius: 3, background: p.c, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--t-900)' }}>{task.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{task.note}</div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: late ? 'var(--red)' : 'var(--t-500)', whiteSpace: 'nowrap' }}>{task.when}</span>
      {/* COMMERCIAL-REMOTE-B1-B3-E: sempre visível — por construção, este
          ponto só é alcançado em task_local ou task_remote_active pronto.
          FlowReagendarPendencia decide sozinho local/remoto (FlowLayer não
          bloqueia mais 'reagendar-pendencia' fora do modo local). HIDE
          para Super Admin contextual (§18/§22 do EXEC V2A). */}
      {!readOnly && (
        <button onClick={() => (window as any).__openFlow('reagendar-pendencia', { task })} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--t-500)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <Icon name="refresh" size={14} stroke={2} /> Reagendar
        </button>
      )}
      {remoteActive ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--t-500)', whiteSpace: 'nowrap' }}>
          <Icon name="user" size={14} stroke={2} /> {task.lead.split(' ')[0]}
        </span>
      ) : (
        <button onClick={() => {
          const lead = LeadService.getAll().find((l: any) => l.name === task.lead);
          (window as any).__openFlow('ver-cliente', { lead: lead ?? LeadService.getAll()[0] });
        }} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--t-500)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <Icon name="user" size={14} stroke={2} /> {task.lead.split(' ')[0]}
        </button>
      )}
    </div>
    {completeError && (
      <div data-testid="task-complete-error" style={{ fontSize: 12, color: 'var(--red)', padding: '0 4px' }}>{completeError}</div>
    )}
    </>
  );
}

// COMMERCIAL-REMOTE-B1-B3-C1: gate de página inteira passou de
// isLocalCommercialDataAllowed() (modo de LEADS, achado do precheck B — Task
// já tem backend remoto próprio) para remoteTasksScreen.mode
// (resolveTaskRemoteMode(), via useRemoteTasksScreenState — chamado
// INCONDICIONALMENTE, antes de qualquer return, mesmo padrão de
// ScreenClientesLegacy/ScreenAndamentoLegacy no mesmo arquivo). currentUser
// não chega por prop (App.tsx só passa isso para Home) — resolvido aqui do
// mesmo jeito que ScreenClientes/ScreenAndamento já fazem.
export function ScreenPendencias({ go }: any) {
  useStore();
  const [tab, setTab] = useState('Atrasadas');
  const currentUser = AuthService.getCurrentUser();
  // SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — bridge exclusivo do
  // Super Admin contextual: ambos os hooks são SEMPRE chamados (Rules of
  // Hooks), mas só um produz rede real por vez (o membership-based fica
  // 'task_remote_unavailable_identity' para Super Admin — sem
  // activeMembership; o platform-based fica desabilitado sem companyId
  // operacional — §11/§12 do EXEC: nenhum dos dois "vaza" para o papel
  // errado).
  const operational = useOperationalCompanyContext();
  const isOperationalSuperAdmin = operational.mode === 'super_admin';
  const membershipTasksScreen = useRemoteTasksScreenState(currentUser);
  const platformTasksScreen = usePlatformTasksScreenState(isOperationalSuperAdmin ? operational.companyId : null);
  const remoteTasksScreen = isOperationalSuperAdmin ? platformTasksScreen : membershipTasksScreen;
  const mode = remoteTasksScreen.mode;

  if (mode === 'task_blocked' || mode === 'task_remote_misconfigured') {
    return (
      <LightScreen>
        <PageHead title="Pendências" sub="O que você precisa fazer e o que já passou da hora." />
        <KanbanStateCard testId="pendencias-state-unavailable">Pendências indisponíveis nesta sessão.</KanbanStateCard>
      </LightScreen>
    );
  }
  if (mode === 'task_remote_unavailable_identity') {
    return (
      <LightScreen>
        <PageHead title="Pendências" sub="O que você precisa fazer e o que já passou da hora." />
        <KanbanStateCard testId="pendencias-state-unavailable-identity">Pendências indisponíveis nesta sessão.</KanbanStateCard>
      </LightScreen>
    );
  }

  const remoteActive = mode === 'task_remote_active';
  if (remoteActive && remoteTasksScreen.isLoading) {
    return (
      <LightScreen>
        <PageHead title="Pendências" sub="O que você precisa fazer e o que já passou da hora." />
        <KanbanStateCard testId="pendencias-state-loading">Carregando pendências…</KanbanStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteTasksScreen.isError) {
    return (
      <LightScreen>
        <PageHead title="Pendências" sub="O que você precisa fazer e o que já passou da hora." />
        <KanbanStateCard testId="pendencias-state-error" onRetry={remoteTasksScreen.refetch}>Não foi possível carregar as pendências.</KanbanStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteTasksScreen.configError !== null) {
    return (
      <LightScreen>
        <PageHead title="Pendências" sub="O que você precisa fazer e o que já passou da hora." />
        <KanbanStateCard testId="pendencias-state-config-error">Uma ou mais pendências remotas estão com configuração inválida.</KanbanStateCard>
      </LightScreen>
    );
  }

  // Daqui em diante: mode === 'task_local' OU (remoteActive && pronto —
  // não-loading/não-erro/sem configError). Fonte única em cada caso — nunca
  // TaskService.getAll() no branch remoto, nunca remoteTasksScreen.tasks no
  // local.
  const tasks = remoteActive ? [...remoteTasksScreen.tasks] : TaskService.getAll();
  const groups: Record<string, any[]> = {
    'Atrasadas': tasks.filter((t: any) => t.state === TASK_STATE.LATE),
    'Hoje': tasks.filter((t: any) => t.state === TASK_STATE.TODAY),
    'Próximas': tasks.filter((t: any) => t.state === TASK_STATE.UPCOMING),
  };
  const late = groups['Atrasadas'].length;
  const view = tab === 'Todas' ? Object.entries(groups) : [[tab, groups[tab]]];
  return (
    <LightScreen>
      {/* COMMERCIAL-REMOTE-B1-B3-D: botão sempre visível aqui — por
          construção, este ponto só é alcançado em task_local ou
          task_remote_active pronto (blocked/misconfigured/unavailable-
          identity/loading/erro/configError já retornaram antes, acima).
          FlowNovaPendencia decide sozinho local/remoto (FlowLayer não
          bloqueia mais 'nova-pendencia' fora do modo local). */}
      {/* SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §18 — "Nova
          pendência" é mutation entry point: HIDE para Super Admin
          contextual (READ ONLY neste V2A), preservado para Manager/Seller. */}
      <PageHead title="Pendências" sub="O que você precisa fazer e o que já passou da hora." actions={!isOperationalSuperAdmin && <LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('nova-pendencia')}>Nova pendência</LBtn>} />
      <Guide tone="red" icon="alert" text={<span>Você tem <b>{late} pendências atrasadas</b>. Resolva primeiro as vermelhas. Cada dia parado é uma venda mais distante.</span>} action="Ver atrasadas" onAction={() => setTab('Atrasadas')} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {['Atrasadas', 'Hoje', 'Próximas', 'Todas'].map(t => (
          <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t === 'Atrasadas' ? `Atrasadas (${late})` : t}</Chip>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {(view as [string, any[]][]).map(([name, items]) => (
          <div key={name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              {name === 'Atrasadas' && <Icon name="alert" size={17} stroke={2.4} style={{ color: 'var(--red)' }} />}
              <span style={{ fontSize: 14, fontWeight: 700, color: name === 'Atrasadas' ? 'var(--red)' : 'var(--t-900)' }}>{name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--t-400)' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.length ? items.map((t: any) => <TaskRow key={t.id} task={t} go={go} remoteActive={remoteActive} currentUser={currentUser} readOnly={isOperationalSuperAdmin} />)
                : <LCard style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 600 }}>Tudo em dia por aqui. Ótimo trabalho!</LCard>}
            </div>
          </div>
        ))}
      </div>
    </LightScreen>
  );
}
