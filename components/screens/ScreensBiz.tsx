'use client';
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBtn, LBadge, Chip, Guide, LightScreen, PageHead, LCard, Stat } from '@/components/ui/kit';
import { VISIT_STATUS, DEAL_STATUS, SALE_STATUS, USERS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { LeadService, VisitService, DealService, SaleService, SellerService, PipelineService, CompanyService, AuthService } from '@/lib/services';
import { PLACE } from '@/components/podiums/Podiums';
import { usePipelineStages } from '@/lib/hooks/usePipelineStages';
import { useReorderStages, getReorderStagesErrorMessage } from '@/lib/hooks/useReorderStages';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import { canAccessFullSettings, canAccessStageSettings, canReorderPipelineStages, canManageInvites } from '@/lib/capabilities';
import { UsersTabSection } from '@/components/users/UsersTabSection';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';
import { isActiveUsersEnabled, isUserEmailEditEnabled, isUserLifecycleEnabled } from '@/lib/flags';
import { isLocalCommercialDataAllowed } from '@/lib/leads/localCommercialAccess';
import { useRemoteVisitsScreenState } from '@/lib/hooks/useRemoteVisitsScreenState';
import { useCurrentCompanySellerLabels } from '@/lib/hooks/useCurrentCompanySellerLabels';
import { useConfirmVisit } from '@/lib/hooks/useConfirmVisit';
import { useCancelVisit } from '@/lib/hooks/useCancelVisit';
import { isRemoteVisitsError } from '@/lib/visits/errors';
import type { RemoteVisitModel } from '@/lib/visits/adapter';
import {
  groupVisitsForScreen,
  formatVisitTime,
  formatVisitShortDate,
  VISIT_REMOTE_STATUS_LABEL,
  resolveVisitSellerDisplayName,
} from '@/lib/visits/visitScreenGrouping';
import { useRemoteDealsScreenState } from '@/lib/hooks/useRemoteDealsScreenState';
import type { RemoteDealModel } from '@/lib/deals/adapter';
import { formatCentsToBRL } from '@/lib/deals/money';
import {
  groupDealsForScreen,
  resolveDealSellerDisplayName,
  formatDealUpdatedAt,
} from '@/lib/deals/dealScreenGrouping';
import { DEAL_PAYMENT_METHOD_LABELS_PT } from '@/lib/deals/labels';
import { useRemoteSalesScreenState } from '@/lib/hooks/useRemoteSalesScreenState';
import type { RemoteSaleModel } from '@/lib/sales/adapter';
import { buildSalesRanking } from '@/lib/sales/salesRanking';
import type { SalesRankingRow as SalesRankingRowT } from '@/lib/sales/salesRanking';

// M1-E E5-B2-A1 — Barreira 1 (UI) para Visitas/Propostas/Vendas: Visit/Deal/
// Sale não têm company_id nem backend remoto (auditoria E5-B2-A0). Fora do
// modo local, a tela não monta nenhuma lista/contagem local — resolvido
// ANTES de qualquer chamada a VisitService/DealService/SaleService.getAll().
function LocalCommercialUnavailableCard() {
  return (
    <LCard style={{ maxWidth: 640 }}>
      <div data-testid="local-commercial-unavailable" style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
        Visitas, propostas, vendas e acompanhamentos serão disponibilizados após a migração deste módulo.
      </div>
    </LCard>
  );
}

// COMMERCIAL-REMOTE-VISITS-B3 — mesmo padrão de KanbanStateCard
// (ScreensOps.tsx, módulo-privado lá também): card neutro para
// loading/erro/config-erro/identidade-indisponível do modo remoto de
// Visits. Não exportado — reimplementar aqui em vez de importar de
// ScreensOps.tsx segue a mesma independência de domínio já documentada em
// lib/visits/remoteVisitsMode.ts.
function VisitStateCard({ testId, children, onRetry }: { testId: string; children: React.ReactNode; onRetry?: () => void }) {
  return (
    <LCard style={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
      <div data-testid={testId} style={{ display: 'grid', placeItems: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ color: 'var(--t-500)', fontSize: 14, maxWidth: 420 }}>{children}</div>
        {onRetry && <LBtn kind="primary" icon="refresh" onClick={onRetry}>Tentar novamente</LBtn>}
      </div>
    </LCard>
  );
}

// Every value VISIT_STATUS can produce must have an entry here — a status
// missing from this map is what made VisitRow crash (M0-J audit, M0-K1 fix).
const VST: Record<string, { tone: string; label: string; solid?: boolean }> = {
  [VISIT_STATUS.PENDING]:         { tone: 'red',   label: 'Não confirmada' },
  [VISIT_STATUS.SCHEDULED]:       { tone: 'amber', label: 'Agendada' },
  [VISIT_STATUS.CONFIRMED]:       { tone: 'green', label: 'Confirmada' },
  [VISIT_STATUS.RESCHEDULED]:     { tone: 'amber', label: 'Remarcada' },
  [VISIT_STATUS.CANCELED]:        { tone: 'red',   label: 'Cancelada' },
  [VISIT_STATUS.AWAITING_RESULT]: { tone: 'amber', label: 'Registrar resultado' },
  [VISIT_STATUS.DONE]:            { tone: 'green', label: 'Realizada', solid: true },
  [VISIT_STATUS.NO_INTEREST]:     { tone: 'amber', label: 'Sem interesse' },
};
const VST_FALLBACK: { tone: string; label: string; solid?: boolean } = { tone: 'amber', label: 'Status desconhecido' };

function VisitRow({ v, go }: any) {
  const s = VST[v.status] || VST_FALLBACK;
  const pend = v.status === VISIT_STATUS.PENDING; const noRes = v.status === VISIT_STATUS.AWAITING_RESULT;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 11,
      background: pend ? 'var(--red-bg)' : noRes ? 'var(--amber-bg)' : 'var(--surface)',
      border: `1px solid ${pend ? 'var(--red-line)' : noRes ? 'var(--amber-line)' : 'var(--border)'}`,
    }}>
      <div className="display tnum" style={{ width: 62, textAlign: 'center', fontSize: 18, fontWeight: 800, color: 'var(--t-900)' }}>{v.time}</div>
      <div style={{ width: 1, height: 34, background: 'var(--border)' }} />
      <Avatar name={v.client} size={38} ring={pend ? 'var(--red)' : '#6B7280'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{v.client}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', gap: 10, marginTop: 2 }}>
          <span><Icon name="car" size={12} stroke={2} style={{ verticalAlign: -2 }} /> {v.car}</span>
          <span>· {v.seller.split(' ')[0]}</span>
        </div>
      </div>
      <LBadge tone={s.tone} solid={s.solid}>{pend && <Icon name="alert" size={12} stroke={2.4} />}{s.label}</LBadge>
      <LBtn size="sm" kind={pend ? 'danger' : noRes ? 'primary' : 'ghost'} icon={pend ? 'phone' : noRes ? 'edit' : 'arrowRight'}
        onClick={() => {
          if (pend) { (window as any).__openFlow('confirmar-visita', { visit: v }); return; }
          if (noRes) { (window as any).__openFlow('registrar-resultado', { visit: v }); return; }
          const lead = v.leadId
            ? LeadService.getAll().find((l: any) => l.id === v.leadId)
            : LeadService.getAll().find((l: any) => l.name === v.client);
          (window as any).__openFlow('ver-cliente', { lead: lead ?? LeadService.getAll()[0] });
        }}>
        {pend ? 'Confirmar' : noRes ? 'Registrar' : 'Ver'}
      </LBtn>
    </div>
  );
}

// COMMERCIAL-REMOTE-VISITS-B3 — linha de uma Visit remota. Somente leitura:
// nenhum botão de mutation (Confirmar/Remarcar/Cancelar/Registrar) —
// nenhum deles está conectado neste lote (B4-B6, fora de escopo). Cliente
// é texto não-clicável de propósito (§25 do EXEC): abrir o Lead exigiria
// resolver o Lead COMPLETO (FlowVerCliente exige o objeto inteiro, não só
// id/nome — leadsById do adapter só carrega {id,name}), uma segunda
// dependência de hook que este lote deliberadamente não introduz — mesma
// decisão já tomada por TaskRow (ScreensOps.tsx) para o mesmo motivo.
// COMMERCIAL-REMOTE-VISITS-B6-A — mensagens sanitizadas fixas de
// Confirmar/Cancelar remoto — mesmo modelo de remoteTaskCompleteErrorMessage
// (ScreensOps.tsx, ação inline de row, não compartilhado com os mappers de
// Flows2.tsx) e dos mappers próprios de cada flow desta série. Cobrem
// exatamente os códigos reais das respectivas RPCs (migration #52,
// comentário "Erros estáveis" de cada função) — confirm_visit inclui
// invalid_status_transition, cancel_visit NÃO (confirmado por leitura
// direta, nunca adivinhado).
function remoteVisitConfirmErrorMessage(error: unknown): string {
  const code = isRemoteVisitsError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_visits_mutation_forbidden':
      return 'Você não tem permissão para confirmar esta visita.';
    case 'remote_visits_mutation_visit_not_found':
      return 'Esta visita não está mais disponível.';
    case 'remote_visits_mutation_visit_closed':
      return 'Esta visita já foi encerrada.';
    case 'remote_visits_mutation_invalid_status_transition':
      return 'Esta visita não está mais aguardando confirmação.';
    case 'remote_visits_mutation_stale_write':
      return 'Esta visita foi alterada. Os dados foram atualizados.';
    default:
      return 'Não foi possível confirmar a visita. Tente novamente.';
  }
}

function remoteVisitCancelErrorMessage(error: unknown): string {
  const code = isRemoteVisitsError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_visits_mutation_forbidden':
      return 'Você não tem permissão para cancelar esta visita.';
    case 'remote_visits_mutation_visit_not_found':
      return 'Esta visita não está mais disponível.';
    case 'remote_visits_mutation_visit_closed':
      return 'Esta visita já foi encerrada.';
    case 'remote_visits_mutation_stale_write':
      return 'Esta visita foi alterada. Os dados foram atualizados.';
    default:
      return 'Não foi possível cancelar a visita. Tente novamente.';
  }
}

// COMMERCIAL-REMOTE-VISITS-B6-A — Confirmar/Cancelar viram ações INLINE
// desta row (nenhum flow id novo, B6-PRECHECK §6/§8/§11):
//   - Confirmar segue o padrão real de TaskRow/useCompleteTask
//     (ScreensOps.tsx) — hook chamado direto da row, erro exibido inline,
//     identity_changed nunca mostrado (a nova identidade/query já assume a
//     renderização sozinha).
//   - Cancelar NÃO reusa o FlowConfirmar genérico (Flows3.tsx): aquele
//     fecha o diálogo ANTES de aguardar onConfirm, incompatível com uma
//     mutation assíncrona e falível como cancelVisit (um erro real seria
//     engolido em silêncio) — confirmado por leitura direta do componente
//     no B6-PRECHECK §8. Em vez disso, um estado de confirmação em DUAS
//     ETAPAS inteiramente dentro da própria row (clique 1: "Cancelar" só
//     alterna para o estado de confirmação, zero mutation; clique 2: "Sim"
//     dispara cancelVisit; "Voltar" descarta sem mutation nenhuma).
//
// Identidade: mesma derivação de sempre (userId/companyId/membershipRole/
// userIsActive via AuthService.getCurrentUser()) — não existe helper
// compartilhado de identidade de Visits a reusar (mesmo raciocínio já
// registrado para TaskRow); reimplementar estas 4 linhas é o padrão já
// estabelecido, não duplicação indevida.
function RemoteVisitRow({ visit, sellersById, showDate, isPendingResult }: {
  visit: RemoteVisitModel;
  sellersById: Readonly<Record<string, { id: string; name: string }>>;
  showDate: boolean;
  isPendingResult: boolean;
}) {
  const scheduledAtDate = new Date(visit.scheduledAt);
  const statusInfo = VISIT_REMOTE_STATUS_LABEL[visit.status];
  const sellerDisplay = resolveVisitSellerDisplayName(visit.assignedSellerId, sellersById);
  const vehicleDisplay = visit.vehicles.length > 1 ? visit.vehicles.join(' + ') : (visit.vehicles[0] ?? '');

  const user = AuthService.getCurrentUser();
  const identityUserId = user?.id ?? null;
  const identityCompanyId = user?.activeMembership?.companyId ?? null;
  const identityMembershipRole = user?.activeMembership?.role ?? null;
  const identityUserIsActive = Boolean(user);

  const confirmHook = useConfirmVisit({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  const cancelHook = useCancelVisit({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });

  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // B6-PRECHECK §5/§23: backend (confirm_visit) só aceita status===
  // 'scheduled', mas confirmar uma visita já passada (Pendentes de
  // resultado) não faz sentido de produto — narrado aqui na UI, backend
  // continua a autoridade real caso algo escape esta checagem.
  const canConfirm = visit.status === 'scheduled' && !isPendingResult;

  const handleConfirm = async () => {
    if (confirmHook.isPending) return;
    setConfirmError(null);
    try {
      await confirmHook.confirmVisit({ visitId: visit.id, expectedVersion: visit.version });
    } catch (err) {
      if (isRemoteVisitsError(err) && err.code === 'remote_visits_mutation_identity_changed') return;
      setConfirmError(remoteVisitConfirmErrorMessage(err));
    }
  };

  const handleCancelConfirm = async () => {
    if (cancelHook.isPending) return;
    setCancelError(null);
    try {
      await cancelHook.cancelVisit({ visitId: visit.id, expectedVersion: visit.version });
      setCancelConfirming(false);
    } catch (err) {
      if (isRemoteVisitsError(err) && err.code === 'remote_visits_mutation_identity_changed') {
        setCancelConfirming(false);
        return;
      }
      setCancelError(remoteVisitCancelErrorMessage(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 11,
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        <div style={{ width: 62, textAlign: 'center' }}>
          {showDate && <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t-400)', marginBottom: 2 }}>{formatVisitShortDate(scheduledAtDate)}</div>}
          <div className="display tnum" style={{ fontSize: 18, fontWeight: 800, color: 'var(--t-900)' }}>{formatVisitTime(scheduledAtDate)}</div>
        </div>
        <div style={{ width: 1, height: 34, background: 'var(--border)' }} />
        <Avatar name={visit.clientName} size={38} ring="#6B7280" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{visit.clientName}</div>
          <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', gap: 10, marginTop: 2 }}>
            <span><Icon name="car" size={12} stroke={2} style={{ verticalAlign: -2 }} /> {vehicleDisplay}</span>
            <span>· {sellerDisplay}</span>
          </div>
        </div>
        <LBadge tone={statusInfo.tone} solid={statusInfo.solid}>{statusInfo.label}</LBadge>
        {canConfirm && (
          <LBtn size="sm" kind="primary" icon="checkCircle" onClick={handleConfirm} style={{ opacity: confirmHook.isPending ? 0.6 : 1 }}>
            {confirmHook.isPending ? 'Confirmando…' : 'Confirmar'}
          </LBtn>
        )}
        {/* COMMERCIAL-REMOTE-VISITS-B6-B: "Registrar resultado" aparece
            SOMENTE em Pendentes de resultado (isPendingResult, já derivado
            centralmente por groupVisitsForScreen — nunca recalculado aqui,
            mesmo padrão de canConfirm/B6-A). Abre um flow dedicado
            REMOTE-ONLY (registrar-resultado-remoto) — nunca o
            'registrar-resultado' local. */}
        {isPendingResult && (
          <LBtn size="sm" kind="primary" icon="clipboard" onClick={() => (window as any).__openFlow('registrar-resultado-remoto', { visit })}>Registrar resultado</LBtn>
        )}
        <LBtn size="sm" kind="ghost" icon="refresh" onClick={() => (window as any).__openFlow('reagendar-visita', { visit })}>Remarcar</LBtn>
        {!cancelConfirming ? (
          <LBtn size="sm" kind="ghost" icon="xCircle" onClick={() => setCancelConfirming(true)}>Cancelar</LBtn>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--t-500)', whiteSpace: 'nowrap' }}>Cancelar esta visita?</span>
            <LBtn size="sm" kind="danger" onClick={handleCancelConfirm} style={{ opacity: cancelHook.isPending ? 0.6 : 1 }}>
              {cancelHook.isPending ? 'Cancelando…' : 'Sim'}
            </LBtn>
            <LBtn size="sm" kind="ghost" onClick={() => { setCancelConfirming(false); setCancelError(null); }}>Voltar</LBtn>
          </>
        )}
      </div>
      {confirmError && (
        <div data-testid="visit-confirm-error" style={{ fontSize: 12, color: 'var(--red)', padding: '0 4px' }}>{confirmError}</div>
      )}
      {cancelError && (
        <div data-testid="visit-cancel-error" style={{ fontSize: 12, color: 'var(--red)', padding: '0 4px' }}>{cancelError}</div>
      )}
    </div>
  );
}

// COMMERCIAL-REMOTE-VISITS-B3 — gate de página inteira passou de
// isLocalCommercialDataAllowed() (modo de LEADS) para
// remoteVisitsScreen.mode (resolveVisitRemoteMode(), via
// useRemoteVisitsScreenState — chamado INCONDICIONALMENTE, antes de
// qualquer return, mesmo padrão de ScreenPendencias/ScreenClientes/
// ScreenAndamento). visit_local implica, por construção,
// leadsMode==='local' (resolveVisitRemoteMode: visitsEnabled=false +
// leadsMode==='local' é o ÚNICO caminho para 'visit_local') — logo
// isLocalCommercialDataAllowed() nunca poderia ser false neste ramo; o
// gate antigo não é reproduzido aqui de propósito (checagem redundante
// para um estado inalcançável), mesma decisão já tomada por
// ScreenPendencias (que não reproduz nenhuma checagem análoga no ramo
// task_local). isLocalCommercialDataAllowed continua em uso por
// ScreenPropostas/ScreenVendas/ScreenResultados (Deal/Sale/SellerService
// ainda não migraram) — intocado.
export function ScreenVisitas({ go }: any) {
  useStore();
  const currentUser = AuthService.getCurrentUser();
  const remoteVisitsScreen = useRemoteVisitsScreenState(currentUser);
  const mode = remoteVisitsScreen.mode;

  // Mesma identidade (userId/companyId/membershipRole/userIsActive) já
  // usada por useRemoteVisitsScreenState internamente — chamado SEMPRE,
  // antes de qualquer return (Rules of Hooks). Fora de visit_remote_active
  // a query interna fica desabilitada (remoteLeadsEnabled/hasCompany/
  // hasUser/userIsActive/isManagerOrSeller), zero chamadas de rede.
  const sellerLabels = useCurrentCompanySellerLabels({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: currentUser?.activeMembership?.role ?? null,
    userIsActive: Boolean(currentUser),
  });

  const pageHeadSub = 'A agenda do dia e o que precisa ser confirmado.';

  if (mode === 'visit_blocked' || mode === 'visit_remote_misconfigured') {
    return (
      <LightScreen>
        <PageHead title="Visitas" sub={pageHeadSub} />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  if (mode === 'visit_remote_unavailable_identity') {
    return (
      <LightScreen>
        <PageHead title="Visitas" sub={pageHeadSub} />
        <VisitStateCard testId="visitas-state-unavailable-identity">Visitas indisponíveis nesta sessão.</VisitStateCard>
      </LightScreen>
    );
  }

  const remoteActive = mode === 'visit_remote_active';
  if (remoteActive && remoteVisitsScreen.isLoading) {
    return (
      <LightScreen>
        <PageHead title="Visitas" sub={pageHeadSub} />
        <VisitStateCard testId="visitas-state-loading">Carregando visitas…</VisitStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteVisitsScreen.isError) {
    return (
      <LightScreen>
        <PageHead title="Visitas" sub={pageHeadSub} />
        <VisitStateCard testId="visitas-state-error" onRetry={remoteVisitsScreen.refetch}>Não foi possível carregar as visitas.</VisitStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteVisitsScreen.configError !== null) {
    return (
      <LightScreen>
        <PageHead title="Visitas" sub={pageHeadSub} />
        <VisitStateCard testId="visitas-state-config-error">Uma ou mais visitas remotas estão com configuração inválida.</VisitStateCard>
      </LightScreen>
    );
  }

  // Daqui em diante: mode === 'visit_local' OU (remoteActive && pronto —
  // não-loading/não-erro/sem configError, já tratados acima). Fonte única
  // em cada caso — nunca VisitService.getAll() no ramo remoto, nunca
  // remoteVisitsScreen.visits no local.
  if (remoteActive) {
    const now = new Date();
    const groups = groupVisitsForScreen(remoteVisitsScreen.visits, now);
    const sellersById = sellerLabels.sellersById;
    const remoteGroups = [
      { key: 'today', name: 'Hoje', items: groups.today, showDate: false, isPendingResult: false },
      { key: 'tomorrow', name: 'Amanhã', items: groups.tomorrow, showDate: false, isPendingResult: false },
      { key: 'future', name: 'Próximos dias', items: groups.future, showDate: true, isPendingResult: false },
      { key: 'pendingResult', name: 'Pendentes de resultado', items: groups.pendingResult, warn: true, showDate: true, isPendingResult: true },
    ];
    return (
      <LightScreen>
        {/* COMMERCIAL-REMOTE-VISITS-B4/B5/B6: "Agendar visita"
            (create_visit), "Confirmar"/"Cancelar" inline por row
            (confirm_visit/cancel_visit), "Remarcar" por row (update_visit)
            e "Registrar resultado" em Pendentes de resultado
            (register_visit_result) estão todos conectados. Confirmar/
            Cancelar são ações INLINE desta tela (nenhum flow id) —
            FlowCriarVisita/FlowReagendarVisita/FlowRegistrarResultadoRemoto
            decidem sozinhos (os três que SÃO flows) via
            resolveVisitRemoteMode()/gates dedicados em FlowLayer.
            Registrar resultado NUNCA abre registrar-venda/nova-proposta/
            criar-acompanhamento (nenhum dos três tem backend remoto,
            B6-PRECHECK §14-16) — sucesso mostra mensagem de continuidade
            adiada. FlowLayer continua bloqueando 'confirmar-visita'/
            'registrar-resultado' (os flows LOCAIS) fora do modo local. */}
        <PageHead title="Visitas" sub={pageHeadSub} actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('criar-visita')}>Agendar visita</LBtn>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {remoteGroups.map((g) => (
            <div key={g.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                {g.warn && <Icon name="alert" size={16} stroke={2.4} style={{ color: 'var(--amber)' }} />}
                <span style={{ fontSize: 14, fontWeight: 700, color: g.warn ? 'var(--amber)' : 'var(--t-900)' }}>{g.name}</span>
                <span style={{ fontSize: 12.5, color: 'var(--t-400)' }}>{g.items.length} {g.items.length === 1 ? 'visita' : 'visitas'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.items.map((v) => <RemoteVisitRow key={v.id} visit={v} sellersById={sellersById} showDate={g.showDate} isPendingResult={g.isPendingResult} />)}
              </div>
            </div>
          ))}
        </div>
      </LightScreen>
    );
  }

  // visit_local: caminho legado, inalterado.
  const visits = VisitService.getAll();
  const KNOWN_DAYS = ['hoje', 'amanha', 'passado'];
  const groups = [
    { name: 'Hoje — 14 de junho', items: visits.filter((v: any) => v.day === 'hoje') },
    { name: 'Amanhã — 15 de junho', items: visits.filter((v: any) => v.day === 'amanha') },
    // Catches visits scheduled for any other day (custom dates, "Qui 18", etc.) so they
    // never silently disappear from this screen just for not matching hoje/amanha/passado.
    { name: 'Próximos dias', items: visits.filter((v: any) => !KNOWN_DAYS.includes(v.day)) },
    { name: 'Pendentes de resultado', items: visits.filter((v: any) => v.day === 'passado'), warn: true },
  ];
  const unconfirmed = visits.filter((v: any) => v.status === VISIT_STATUS.PENDING).length;
  return (
    <LightScreen>
      <PageHead title="Visitas" sub={pageHeadSub} actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('criar-visita')}>Agendar visita</LBtn>} />
      <Guide tone="red" icon="calendar" text={<span>Você tem <b>{unconfirmed} visitas não confirmadas</b> para hoje. Ligue para confirmar antes do horário — visita confirmada vende mais.</span>} action="Confirmar agora" onAction={() => { const v = visits.find((x: any) => x.status === VISIT_STATUS.PENDING); (window as any).__openFlow('confirmar-visita', { visit: v }); }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {groups.map((g: any) => (
          <div key={g.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              {g.warn && <Icon name="alert" size={16} stroke={2.4} style={{ color: 'var(--amber)' }} />}
              <span style={{ fontSize: 14, fontWeight: 700, color: g.warn ? 'var(--amber)' : 'var(--t-900)' }}>{g.name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--t-400)' }}>{g.items.length} {g.items.length === 1 ? 'visita' : 'visitas'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.items.map((v: any) => <VisitRow key={v.id} v={v} go={go} />)}
            </div>
          </div>
        ))}
      </div>
    </LightScreen>
  );
}

function SubHead({ icon, tone, children }: any) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
    <Icon name={icon} size={16} stroke={2.2} style={{ color: tone || 'var(--t-500)' }} />
    <span style={{ fontSize: 14, fontWeight: 700, color: tone || 'var(--t-900)' }}>{children}</span>
  </div>;
}

function DealRow({ d, go, approval, decided, canDecide }: any) {
  const decidedApproved = decided && d.status === DEAL_STATUS.APPROVED;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '15px 18px', borderRadius: 11,
      background: approval ? 'var(--amber-bg)' : 'var(--surface)', border: `1px solid ${approval ? 'var(--amber-line)' : 'var(--border)'}`,
    }}>
      <Avatar name={d.client} size={40} ring="#6B7280" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{d.client}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="car" size={13} stroke={2} /> {d.car} · {d.seller.split(' ')[0]}
        </div>
        {approval && <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, marginTop: 5 }}>{d.disc}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600 }}>{d.value}</div>
        <div style={{ fontSize: 11, color: 'var(--t-400)' }}>atualizada {d.last}</div>
      </div>
      {decided && <LBadge tone={decidedApproved ? 'green' : 'red'} solid>{decidedApproved ? 'Aprovada' : 'Recusada'}</LBadge>}
      {approval
        // Seller cannot approve/reject — not even their own proposal (Correção 1,
        // M0-K4.1). Only a badge here; the real gate lives in FlowAprovarProposta
        // and DealService.approve/reject, so this is UI-only convenience.
        ? (canDecide
            ? <LBtn size="sm" kind="primary" icon="check" onClick={() => (window as any).__openFlow('aprovar-proposta', { deal: d })}>Aprovar</LBtn>
            : <LBadge tone="amber"><Icon name="clock" size={12} stroke={2.4} />Aguardando gestor</LBadge>)
        : <LBtn size="sm" kind="ghost" icon="arrowRight" onClick={() => {
            const lead = d.leadId
              ? LeadService.getAll().find((l: any) => l.id === d.leadId)
              : LeadService.getAll().find((l: any) => l.name === d.client);
            (window as any).__openFlow('ver-cliente', { lead: lead ?? LeadService.getAll()[0] });
          }}>Ver</LBtn>}
    </div>
  );
}

// COMMERCIAL-REMOTE-DEALS-B3 — card neutro para loading/erro/config-erro/
// identidade-indisponível/vazio do modo remoto de Deals. Mesmo padrão
// exato de VisitStateCard (não exportado, reimplementado aqui em vez de
// importado — mesma independência de domínio já documentada em
// lib/visits/remoteVisitsMode.ts).
function DealStateCard({ testId, children, onRetry }: { testId: string; children: React.ReactNode; onRetry?: () => void }) {
  return (
    <LCard style={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
      <div data-testid={testId} style={{ display: 'grid', placeItems: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ color: 'var(--t-500)', fontSize: 14, maxWidth: 420 }}>{children}</div>
        {onRetry && <LBtn kind="primary" icon="refresh" onClick={onRetry}>Tentar novamente</LBtn>}
      </div>
    </LCard>
  );
}

// COMMERCIAL-REMOTE-DEALS-B3 — linha de uma Deal remota. Somente leitura:
// nenhum botão de ação (create/update/mark-lost entram em B4/B5, fora de
// escopo deste lote, B3-PRECHECK §11/§12/§19). Cliente é texto
// não-clicável de propósito — mesma decisão já tomada por
// RemoteVisitRow/TaskRow (abrir o Lead completo exigiria uma segunda
// dependência de hook que este lote deliberadamente não introduz). Sem
// badge de status (B3-PRECHECK §10/§16): cada seção da tela já corresponde
// a exatamente um status, diferente de Visits (onde uma mesma seção pode
// misturar scheduled/confirmed) — repetir o status no card seria
// informação duplicada.
// COMMERCIAL-REMOTE-DEALS-B5 — "Abrir" presente nos três status (open/
// lost/sold), mesmo label/estilo/posição do "Ver" local (LBtn ghost) —
// nunca o card inteiro clicável (B5-PRECHECK §6/§41). Abre o flow remoto
// dedicado 'ver-negociacao' com a própria row já carregada (nenhuma query
// nova, B5-PRECHECK §2/§9/§38) — nunca LeadService/DealService.
function RemoteDealRow({ deal, sellersById, showSeller, now }: {
  deal: RemoteDealModel;
  sellersById: Readonly<Record<string, { id: string; name: string }>>;
  showSeller: boolean;
  now: Date;
}) {
  const sellerDisplay = resolveDealSellerDisplayName(deal.assignedSellerId, sellersById);
  const updatedDisplay = formatDealUpdatedAt(deal.updatedAt, now);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '15px 18px', borderRadius: 11,
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      <Avatar name={deal.clientName} size={40} ring="#6B7280" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{deal.clientName}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="car" size={13} stroke={2} /> {deal.vehicle}{showSeller && <> · {sellerDisplay}</>}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600 }}>{formatCentsToBRL(deal.valueCents)}</div>
        <div style={{ fontSize: 11, color: 'var(--t-400)' }}>atualizada {updatedDisplay}</div>
      </div>
      <LBtn size="sm" kind="ghost" icon="arrowRight" onClick={() => (window as any).__openFlow('ver-negociacao', { deal })}>Abrir</LBtn>
    </div>
  );
}

// COMMERCIAL-REMOTE-DEALS-B3 — gate de página inteira, mesmo padrão exato
// de ScreenVisitas (COMMERCIAL-REMOTE-VISITS-B3): useRemoteDealsScreenState
// chamado INCONDICIONALMENTE, antes de qualquer return. Branches remotos
// (blocked/misconfigured/unavailable_identity/loading/error/configError)
// tratados primeiro; deal_local cai no bloco legado ao final, sem checagem
// explícita de mode === 'deal_local' — o mesmo raciocínio já registrado
// para visit_local se aplica aqui (deal_local implica, por construção,
// Leads também local, então isLocalCommercialDataAllowed() nunca seria
// false neste ramo). Read-only: nenhum CTA de criação, nenhuma ação "Ver",
// nenhuma mutation (B3-PRECHECK §11/§12/§17/§18/§19) — B4/B5 conectarão
// create/update/mark-lost e um detalhe remoto futuramente.
export function ScreenPropostas({ go }: any) {
  useStore();
  const currentUser = AuthService.getCurrentUser();
  const remoteDealsScreen = useRemoteDealsScreenState(currentUser);
  const mode = remoteDealsScreen.mode;

  // Mesma identidade já usada por useRemoteDealsScreenState internamente —
  // chamado SEMPRE, antes de qualquer return (Rules of Hooks). Fora do
  // modo remoto a query interna fica desabilitada, zero chamadas de rede
  // (mesmo padrão exato de ScreenVisitas, linha ~326).
  const sellerLabels = useCurrentCompanySellerLabels({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: currentUser?.activeMembership?.role ?? null,
    userIsActive: Boolean(currentUser),
  });

  const pageHeadTitle = 'Negociações';
  const pageHeadSub = 'Acompanhe as negociações em andamento e o histórico.';

  if (mode === 'deal_blocked' || mode === 'deal_remote_misconfigured') {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  if (mode === 'deal_remote_unavailable_identity') {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="negociacoes-state-unavailable-identity">Negociações indisponíveis nesta sessão.</DealStateCard>
      </LightScreen>
    );
  }

  const remoteActive = mode === 'deal_remote_active';
  if (remoteActive && remoteDealsScreen.isLoading) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="negociacoes-state-loading">Carregando negociações…</DealStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteDealsScreen.isError) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="negociacoes-state-error" onRetry={remoteDealsScreen.refetch}>Não foi possível carregar as negociações.</DealStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteDealsScreen.configError !== null) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="negociacoes-state-config-error">Uma ou mais negociações remotas estão com configuração inválida.</DealStateCard>
      </LightScreen>
    );
  }

  // Daqui em diante: mode === 'deal_local' OU (remoteActive && pronto —
  // não-loading/não-erro/sem configError, já tratados acima).
  if (remoteActive) {
    const now = new Date();
    const groups = groupDealsForScreen(remoteDealsScreen.deals);
    const sellersById = sellerLabels.sellersById;
    const isManager = currentUser?.activeMembership?.role === 'manager';
    return (
      <LightScreen>
        {/* COMMERCIAL-REMOTE-DEALS-B4: "Nova negociação" abre o mesmo flow
            id local ('nova-proposta'), que decide sozinho local/remoto via
            resolveDealRemoteMode() (FlowNovaProposta) — nunca chama
            DealService. Ausente nos demais 5 modos desta tela (blocked/
            misconfigured/unavailable_identity/loading/error/configError),
            herdado do B3 (nenhum deles renderiza actions no PageHead). */}
        <PageHead title={pageHeadTitle} sub={pageHeadSub} actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('nova-proposta')}>Nova negociação</LBtn>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <SubHead icon="handshake">Em negociação · {groups.open.length}</SubHead>
            {groups.open.length === 0
              ? <DealStateCard testId="negociacoes-open-empty">Nenhuma negociação em andamento.</DealStateCard>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {groups.open.map((d) => <RemoteDealRow key={d.id} deal={d} sellersById={sellersById} showSeller={isManager} now={now} />)}
                </div>}
          </div>
          {groups.lost.length > 0 && <div>
            <SubHead icon="xCircle">Perdidas · {groups.lost.length}</SubHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.lost.map((d) => <RemoteDealRow key={d.id} deal={d} sellersById={sellersById} showSeller={isManager} now={now} />)}
            </div>
          </div>}
          {groups.sold.length > 0 && <div>
            <SubHead icon="trophy">Vendidas · {groups.sold.length}</SubHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.sold.map((d) => <RemoteDealRow key={d.id} deal={d} sellersById={sellersById} showSeller={isManager} now={now} />)}
            </div>
          </div>}
        </div>
      </LightScreen>
    );
  }

  // deal_local: caminho legado, inalterado.
  if (!isLocalCommercialDataAllowed()) {
    return (
      <LightScreen>
        <PageHead title="Propostas" sub="As negociações em aberto e o que precisa de aprovação." />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  const deals = DealService.getAll();
  const canDecide = AuthService.isManager();
  const open = deals.filter((d: any) => d.status === DEAL_STATUS.OPEN);
  const appr = deals.filter((d: any) => d.status === DEAL_STATUS.APPROVAL);
  const decided = deals.filter((d: any) => d.status === DEAL_STATUS.APPROVED || d.status === DEAL_STATUS.REJECTED);
  return (
    <LightScreen>
      <PageHead title="Propostas" sub="As negociações em aberto e o que precisa de aprovação." actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('nova-proposta')}>Nova proposta</LBtn>} />
      {appr.length > 0 && <Guide tone="amber" icon="clock" text={<span><b>{appr.length} propostas</b> aguardam aprovação do gestor por desconto acima do limite.</span>} action={canDecide ? 'Revisar' : undefined} onAction={canDecide ? () => (window as any).__openFlow('aprovar-proposta', { deal: appr[0] }) : undefined} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {appr.length > 0 && <div>
          <SubHead icon="clock" tone="var(--amber)">Aguardando aprovação · {appr.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{appr.map((d: any) => <DealRow key={d.id} d={d} go={go} approval canDecide={canDecide} />)}</div>
        </div>}
        <div>
          <SubHead icon="handshake">Em aberto · {open.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{open.map((d: any) => <DealRow key={d.id} d={d} go={go} />)}</div>
        </div>
        {decided.length > 0 && <div>
          <SubHead icon="history">Decididas · {decided.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{decided.map((d: any) => <DealRow key={d.id} d={d} go={go} decided />)}</div>
        </div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 11, background: 'var(--green-bg)', border: '1px solid var(--green-line)' }}>
          <Icon name="trophy" size={20} stroke={2} style={{ color: 'var(--green)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>8 propostas fechadas este mês</span>
          <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>— continue assim para subir no ranking.</span>
        </div>
      </div>
    </LightScreen>
  );
}

// Every value SALE_STATUS can produce must have an entry here (same discipline
// as VST for Visits) — CANCELED added in M0-K4.2.
const SST: Record<string, { tone: string; label: string }> = {
  [SALE_STATUS.PENDING]:   { tone: 'amber', label: 'Ag. entrega' },
  [SALE_STATUS.DELIVERED]: { tone: 'green', label: 'Entregue' },
  [SALE_STATUS.CANCELED]:  { tone: 'red',   label: 'Cancelada' },
};

// COMMERCIAL-REMOTE-SALES-A2 — linha de uma Sale remota. Somente leitura:
// Sale é imutável neste V1 (nenhum botão de ação — sem cancelar, sem
// editar, SALES-A1-PRECHECK §19). Cliente/Veículo NÃO existem na própria
// row de Sales (só deal_id/lead_id) — resolvidos via a Deal correspondente
// já carregada por useRemoteDealsScreenState (mesmo dado que alimenta
// Negociações, zero query nova por linha, SALES-A2-PRECHECK §7). `deal`
// pode ser null (Deals ainda carregando/erro nesta sessão, ou Sale mais
// antiga que o batch atual) — nunca quebra a linha, cai num rótulo neutro.
function RemoteSaleRow({ sale, deal, sellersById, showSeller, now }: {
  sale: RemoteSaleModel;
  deal: RemoteDealModel | null;
  sellersById: Readonly<Record<string, { id: string; name: string }>>;
  showSeller: boolean;
  now: Date;
}) {
  const sellerDisplay = resolveDealSellerDisplayName(sale.assignedSellerId, sellersById);
  const soldDisplay = formatDealUpdatedAt(sale.soldAt, now);
  const clientName = deal?.clientName ?? 'Cliente indisponível';
  const vehicle = deal?.vehicle ?? 'Veículo indisponível';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '15px 18px', borderRadius: 11,
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      <Avatar name={clientName} size={40} ring="#15924B" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{clientName}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="car" size={13} stroke={2} /> {vehicle}{showSeller && <> · {sellerDisplay}</>}
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)' }}>{DEAL_PAYMENT_METHOD_LABELS_PT[sale.paymentMethod]}</div>
      <div style={{ textAlign: 'right' }}>
        <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600 }}>{formatCentsToBRL(sale.soldValueCents)}</div>
        <div style={{ fontSize: 11, color: 'var(--t-400)' }}>vendida {soldDisplay}</div>
      </div>
    </div>
  );
}

export function ScreenVendas({ go }: any) {
  useStore();
  const currentUser = AuthService.getCurrentUser();
  const remoteSalesScreen = useRemoteSalesScreenState(currentUser);
  const mode = remoteSalesScreen.mode;

  // Mesma identidade já usada por useRemoteSalesScreenState internamente —
  // chamados SEMPRE, antes de qualquer return (Rules of Hooks). remoteDeals
  // resolve Cliente/Veículo por deal_id (mesmo dado de Negociações, zero
  // query nova); sellerLabels resolve o nome do vendedor (mesma
  // infraestrutura batch já usada por ScreenPropostas/ScreenVisitas).
  const remoteDealsForSales = useRemoteDealsScreenState(currentUser);
  const sellerLabels = useCurrentCompanySellerLabels({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: currentUser?.activeMembership?.role ?? null,
    userIsActive: Boolean(currentUser),
  });

  const pageHeadTitle = 'Vendas';
  const pageHeadSub = 'O que importa primeiro: quantas vendas você fechou.';

  if (mode === 'sale_blocked' || mode === 'sale_remote_misconfigured') {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  if (mode === 'sale_remote_unavailable_identity') {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="vendas-state-unavailable-identity">Vendas indisponíveis nesta sessão.</DealStateCard>
      </LightScreen>
    );
  }

  const remoteActive = mode === 'sale_remote_active';
  if (remoteActive && remoteSalesScreen.isLoading) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="vendas-state-loading">Carregando vendas…</DealStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteSalesScreen.isError) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="vendas-state-error" onRetry={remoteSalesScreen.refetch}>Não foi possível carregar as vendas.</DealStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteSalesScreen.configError !== null) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="vendas-state-config-error">Uma ou mais vendas remotas estão com configuração inválida.</DealStateCard>
      </LightScreen>
    );
  }

  // Daqui em diante: mode === 'sale_local' OU (remoteActive && pronto —
  // não-loading/não-erro/sem configError, já tratados acima).
  if (remoteActive) {
    const now = new Date();
    const sellersById = sellerLabels.sellersById;
    const isManager = currentUser?.activeMembership?.role === 'manager';
    const dealsById: Record<string, RemoteDealModel> = {};
    for (const d of remoteDealsForSales.deals) dealsById[d.id] = d;
    return (
      <LightScreen>
        {/* COMMERCIAL-REMOTE-SALES-A2 §10 CRÍTICO: Sale remota NUNCA nasce
            solta — o CTA global aqui navega para Negociações (onde o
            Manager/Seller abre a Deal OPEN que fechou e usa o botão
            "Registrar venda" de dentro dela, FlowVerNegociacao), nunca abre
            um formulário remoto sem Deal. */}
        <PageHead title={pageHeadTitle} sub={pageHeadSub} actions={<LBtn kind="gold" icon="trophy" size="lg" onClick={() => go('propostas')}>Registrar venda</LBtn>} />
        {remoteSalesScreen.sales.length === 0
          ? <DealStateCard testId="vendas-state-empty">Nenhuma venda registrada.</DealStateCard>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {remoteSalesScreen.sales.map((s) => (
                <RemoteSaleRow key={s.id} sale={s} deal={dealsById[s.dealId] ?? null} sellersById={sellersById} showSeller={isManager} now={now} />
              ))}
            </div>
          )}
      </LightScreen>
    );
  }

  // sale_local: caminho legado, inalterado.
  if (!isLocalCommercialDataAllowed()) {
    return (
      <LightScreen>
        <PageHead title="Vendas" sub="O que importa primeiro: quantas vendas você fechou." />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  const sales = SaleService.getAll();
  const canCancel = AuthService.isManager();
  const delivered = sales.filter((s: any) => s.status === SALE_STATUS.DELIVERED).length;
  const pending = sales.filter((s: any) => s.status === SALE_STATUS.PENDING).length;
  return (
    <LightScreen>
      <PageHead title="Vendas" sub="O que importa primeiro: quantas vendas você fechou." actions={<LBtn kind="gold" icon="plus" size="lg" onClick={() => (window as any).__openFlow('registrar-venda')}>Registrar venda</LBtn>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 22 }}>
        <Stat label="Vendas no mês" value={sales.length} icon="trophy" tone="gold" active sub="meta: 30" />
        <Stat label="Entregas pendentes" value={pending} icon="car" tone="amber" active sub="agendar entrega" />
        <Stat label="Entregues" value={delivered} icon="check" tone="green" active />
        <Stat label="Receita do mês" value="R$ 1,38M" icon="bars" tone="ink" sub="indicador secundário" />
      </div>
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>Vendas recentes</span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--t-400)' }}>Junho 2026</span>
        </div>
        {sales.map((s: any, i: number) => {
          const badge = SST[s.status] || SST[SALE_STATUS.PENDING];
          const canceled = s.status === SALE_STATUS.CANCELED;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderTop: i ? '1px solid var(--border-2)' : 'none', opacity: canceled ? .6 : 1 }}>
              <Avatar name={s.client} size={38} ring={canceled ? '#6B7280' : '#15924B'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{s.client}</div>
                <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}><Icon name="car" size={12} stroke={2} style={{ verticalAlign: -2 }} /> {s.car} · {s.pay}</div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--t-500)' }}>{s.seller.split(' ')[0]}</div>
              <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600, width: 100, textAlign: 'right' }}>{s.value}</div>
              <span style={{ fontSize: 12.5, color: 'var(--t-400)', width: 56 }}>{s.date}</span>
              <LBadge tone={badge.tone} solid={s.status !== SALE_STATUS.PENDING}>{badge.label}</LBadge>
              {!canceled && canCancel && (
                <LBtn size="sm" kind="ghost" icon="xCircle" onClick={() => (window as any).__openFlow('confirmar', {
                  title: 'Cancelar esta venda?',
                  message: `A venda de ${s.car} para ${s.client} será desfeita: o ranking do vendedor e a proposta/lead relacionados voltam ao estado anterior.`,
                  confirmLabel: 'Cancelar venda',
                  tone: 'danger',
                  icon: 'xCircle',
                  onConfirm: () => SaleService.cancel(s.id),
                })}>Cancelar</LBtn>
              )}
            </div>
          );
        })}
      </LCard>
    </LightScreen>
  );
}

function Bar({ label, pct, value, tone }: { label: string; pct: number; value: string; tone?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: 'var(--t-700)', fontWeight: 600 }}>{label}</span>
        <span className="tnum" style={{ color: 'var(--t-500)', fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 9, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', borderRadius: 999, background: tone || 'var(--t-900)' }} />
      </div>
    </div>
  );
}

// Client-side CSV, no dependency — one file, sections separated by a blank
// line (a real multi-sheet export would need a library, out of scope here).
//
// Role scoping happens at the *Service.getAll() layer (same RBAC every
// screen already relies on) — a seller calling this only ever sees their own
// leads/visits/deals/sales. SellerService.getAll() is the one exception
// (unfiltered by design, since Home's podium needs the whole team), so it's
// narrowed by hand here to just the seller's own row (M0-K3.1, correção 6).
function exportResultadosCSV() {
  const user = AuthService.getCurrentUser();
  const isSeller = user?.activeMembership?.role === 'seller';
  const esc = (v: any) => {
    const s = v === null || v === undefined || v === '' ? '-' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const row = (cells: any[]) => cells.map(esc).join(',');
  const rows: string[] = [];

  const fmtDate = (x: any): string => {
    if (x?.createdAt) {
      const d = new Date(x.createdAt);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
    }
    return x?.date || x?.day || x?.last || '-';
  };
  const userName = (id: string | null | undefined): string => {
    if (!id) return '-';
    return USERS.find((u) => u.id === id)?.name || '-';
  };
  const phoneForLead = (leadId: string | null): string => {
    if (!leadId) return '-';
    return LeadService.getById(leadId)?.phone || '-';
  };

  const allSellers = SellerService.getAll();
  const sellers = isSeller ? allSellers.filter((s: any) => s.id === user?.activeMembership?.sellerId) : allSellers;
  rows.push('Vendedores');
  rows.push(row(['Nome', 'Vendas', 'Receita', 'Leads', 'Visitas', 'Conversão']));
  sellers.forEach((s: any) => rows.push(row([s.name, s.sales, s.revenue, s.leads, s.visits, s.conv + '%'])));
  rows.push('');

  const leads = LeadService.getAll();
  rows.push('Leads');
  rows.push(row(['Nome', 'Telefone', 'Veículo de interesse', 'Vendedor responsável', 'Criado por', 'Data de cadastro']));
  leads.forEach((l: any) => rows.push(row([
    l.name, l.phone, l.car, l.seller, userName(l.createdByUserId), fmtDate(l),
  ])));
  rows.push('');

  const sales = SaleService.getAll();
  rows.push('Vendas');
  rows.push(row(['Cliente', 'Telefone', 'Veículo', 'Valor', 'Vendedor responsável', 'Registrado por', 'Status', 'Data']));
  sales.forEach((s: any) => rows.push(row([
    s.client, phoneForLead(s.leadId), s.car, s.value, s.seller, userName(s.createdByUserId), s.status, fmtDate(s),
  ])));
  rows.push('');

  const deals = DealService.getAll();
  rows.push('Propostas');
  rows.push(row(['Cliente', 'Telefone', 'Veículo', 'Valor', 'Vendedor responsável', 'Status', 'Data']));
  deals.forEach((d: any) => rows.push(row([
    d.client, phoneForLead(d.leadId), d.car, d.value, d.seller, d.status, fmtDate(d),
  ])));
  rows.push('');

  const visits = VisitService.getAll();
  rows.push('Visitas');
  rows.push(row(['Cliente', 'Telefone', 'Veículo', 'Vendedor responsável', 'Dia/Data', 'Horário', 'Status']));
  visits.forEach((v: any) => rows.push(row([
    v.client, phoneForLead(v.leadId), v.car, v.seller, fmtDate(v), v.time, v.status,
  ])));

  const BOM = '\uFEFF'; // explicit escape — Excel needs this to read acentos corretamente
  const csv = BOM + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resultados-autocrm-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// COMMERCIAL-REMOTE-RESULTS-R1 — linha do Ranking remoto: SOMENTE saleCount/
// revenueCents (buildSalesRanking), nenhuma métrica de conversão/score
// fabricada. Top 3 reaproveita o mesmo PLACE/ring já usado pela tabela local
// — nenhum componente Podium separado, nenhuma segunda fonte de dado
// (R1-EXEC §10: não misturar ranking real com podium fixture).
function SalesRankingRow({ row, pos }: { row: SalesRankingRowT; pos: number }) {
  return (
    <div data-testid="resultados-ranking-row" style={{ display: 'grid', gridTemplateColumns: '32px 1fr repeat(2, .8fr)', alignItems: 'center', padding: '11px 18px', borderTop: pos ? '1px solid var(--border-2)' : 'none', background: pos === 0 ? 'linear-gradient(90deg, rgba(212,175,55,.12), transparent)' : 'transparent' }}>
      <span className="display tnum" style={{ fontWeight: 800, color: pos < 3 ? (PLACE as any[])[pos].ring : 'var(--t-400)' }}>{pos + 1}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={row.sellerLabel} size={28} ring={pos < 3 ? (PLACE as any[])[pos].ring : '#3a3a40'} gold={pos === 0} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{row.sellerLabel}</span>
      </div>
      <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{row.saleCount}</span>
      <span className="display tnum" style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: pos === 0 ? 'var(--gold-ink)' : 'var(--t-900)' }}>{formatCentsToBRL(row.revenueCents)}</span>
    </div>
  );
}

export function ScreenResultados({ go }: any) {
  useStore();
  const currentUser = AuthService.getCurrentUser();
  // COMMERCIAL-REMOTE-RESULTS-R1 — mesma fonte já REMOTE VERIFIED de
  // ScreenVendas (useRemoteSalesScreenState), zero SellerService/SaleService
  // remoto, zero query por Seller (useCurrentCompanySellerLabels é o mesmo
  // catálogo batch já usado por Propostas/Visitas/Vendas). Chamados SEMPRE,
  // na mesma ordem (Rules of Hooks), antes de qualquer branch de modo.
  const remoteSalesScreen = useRemoteSalesScreenState(currentUser);
  const mode = remoteSalesScreen.mode;
  const sellerLabels = useCurrentCompanySellerLabels({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: currentUser?.activeMembership?.role ?? null,
    userIsActive: Boolean(currentUser),
  });

  const pageHeadTitle = 'Resultados';
  const pageHeadSub = 'Como a equipe está performando — em números simples.';

  // Mesmo padrão de barreira de ScreenVendas: blocked/misconfigured
  // continuam com o aviso genérico de módulo em migração (conversão por
  // etapa/motivos de perda permanecem fora de escopo neste V1 — nenhum dado
  // remoto equivalente existe ainda); identidade indisponível ganha um
  // estado próprio.
  if (mode === 'sale_blocked' || mode === 'sale_remote_misconfigured') {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  if (mode === 'sale_remote_unavailable_identity') {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="resultados-state-unavailable-identity">Resultados indisponíveis nesta sessão.</DealStateCard>
      </LightScreen>
    );
  }

  const remoteActive = mode === 'sale_remote_active';
  if (remoteActive && remoteSalesScreen.isLoading) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="resultados-state-loading">Carregando resultados…</DealStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteSalesScreen.isError) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="resultados-state-error" onRetry={remoteSalesScreen.refetch}>Não foi possível carregar os resultados.</DealStateCard>
      </LightScreen>
    );
  }
  if (remoteActive && remoteSalesScreen.configError !== null) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <DealStateCard testId="resultados-state-config-error">Uma ou mais vendas remotas estão com configuração inválida.</DealStateCard>
      </LightScreen>
    );
  }

  // Daqui em diante: mode === 'sale_local' OU (remoteActive && pronto).
  if (remoteActive) {
    // Sales já chegam autorizadas pela RLS (Manager: company-wide; Seller:
    // só as próprias, R1-EXEC §20) — buildSalesRanking só agrega o que
    // recebeu, nenhum filtro de role aqui. Sem período: esta tela nunca
    // teve um ControlBar real (o "— Junho" do fixture não era um filtro
    // funcional), então o menor range compatível é "todas as Sales visíveis
    // agora" (R1-EXEC §4) — documentado, não inventado.
    const ranking = buildSalesRanking(remoteSalesScreen.sales, sellerLabels.sellersById);
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        {ranking.length === 0
          ? <DealStateCard testId="resultados-state-empty">Nenhuma venda registrada no período.</DealStateCard>
          : (
            <LCard pad={0} style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>Desempenho por vendedor</div>
              <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr repeat(2, .8fr)', padding: '10px 18px', borderBottom: '1px solid var(--border)', fontSize: 11.5, color: 'var(--t-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <span>#</span><span>Vendedor</span><span style={{ textAlign: 'right' }}>Vendas</span><span style={{ textAlign: 'right' }}>Receita</span>
              </div>
              {ranking.map((row, i) => <SalesRankingRow key={row.sellerId} row={row} pos={i} />)}
            </LCard>
          )}
      </LightScreen>
    );
  }

  // sale_local: caminho legado, inalterado.
  // M1-E E7-B1 — Barreira 1 (UI): esta tela inteira (desempenho por
  // vendedor, conversão por etapa, motivos de perda) depende do catálogo
  // LOCAL de Sellers (SellerService, sem company_id, sem backend remoto —
  // achado do E7-A0/E7-B1), reachable pelo Manager mesmo em modo remoto
  // (NAV_ROLES.manager inclui 'resultados'). Resolvido ANTES de qualquer
  // chamada a SellerService.getAll().
  if (!isLocalCommercialDataAllowed()) {
    return (
      <LightScreen>
        <PageHead title={pageHeadTitle} sub={pageHeadSub} />
        <LocalCommercialUnavailableCard />
      </LightScreen>
    );
  }
  const top = SellerService.getAll();
  // M1-E E5-B2-A1: a exportação combina Leads/Sellers (sempre seguros no
  // modo local) com Vendas/Propostas/Visitas locais (Visit/Deal/Sale) — fora
  // do modo local essas três seções não podem ser lidas, então a exportação
  // inteira fica indisponível em vez de gerar um CSV incompleto/enganoso.
  const canExport = isLocalCommercialDataAllowed();
  return (
    <LightScreen>
      <PageHead title={pageHeadTitle} sub={pageHeadSub} actions={canExport ? <LBtn kind="ghost" icon="file" onClick={exportResultadosCSV}>Exportar</LBtn> : undefined} />
      <LCard pad={0} style={{ overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>Desempenho por vendedor — Junho</div>
        <div style={{ display: 'grid', gridTemplateColumns: '32px 1.6fr repeat(4, .8fr)', padding: '10px 18px', borderBottom: '1px solid var(--border)', fontSize: 11.5, color: 'var(--t-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          <span>#</span><span>Vendedor</span><span style={{ textAlign: 'right' }}>Leads</span><span style={{ textAlign: 'right' }}>Visitas</span><span style={{ textAlign: 'right' }}>Conv.</span><span style={{ textAlign: 'right' }}>Vendas</span>
        </div>
        {top.map((s: any, i: number) => (
          <div key={s.id} onClick={() => (window as any).__openFlow && (window as any).__openFlow('perfil-vendedor', { seller: s, pos: i + 1 })} className="lift" style={{ display: 'grid', gridTemplateColumns: '32px 1.6fr repeat(4, .8fr)', alignItems: 'center', padding: '11px 18px', borderTop: i ? '1px solid var(--border-2)' : 'none', background: i === 0 ? 'linear-gradient(90deg, rgba(212,175,55,.12), transparent)' : 'transparent', cursor: 'pointer', borderRadius: 8 }}>
            <span className="display tnum" style={{ fontWeight: 800, color: i < 3 ? (PLACE as any[])[i].ring : 'var(--t-400)' }}>{i + 1}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={s.name} size={28} ring={i < 3 ? (PLACE as any[])[i].ring : '#3a3a40'} gold={i === 0} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</span></div>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.leads}</span>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.visits}</span>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.conv}%</span>
            <span className="display tnum" style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: i === 0 ? 'var(--gold-ink)' : 'var(--t-900)' }}>{s.sales}</span>
          </div>
        ))}
      </LCard>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <LCard>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Conversão por etapa</div>
          <Bar label="Lead → Qualificado" pct={67} value="67%" tone="var(--green)" />
          <Bar label="Qualificado → Visita" pct={49} value="49%" tone="var(--green)" />
          <Bar label="Visita → Proposta" pct={58} value="58%" tone="var(--amber)" />
          <Bar label="Proposta → Venda" pct={34} value="34%" tone="var(--gold-ink)" />
        </LCard>
        <LCard>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Motivos de perda</div>
          <Bar label="Preço" pct={40} value="40%" tone="var(--red)" />
          <Bar label="Produto" pct={25} value="25%" tone="var(--t-700)" />
          <Bar label="Concorrente" pct={20} value="20%" tone="var(--t-700)" />
          <Bar label="Prazo" pct={10} value="10%" tone="var(--t-400)" />
        </LCard>
      </div>
    </LightScreen>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-700)', marginBottom: 6 }}>{label}</label>
      <input value={value} onChange={(e: any) => onChange(e.target.value)} style={{ width: '100%', padding: '10px 13px', borderRadius: 9, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'var(--surface-2)', outline: 'none' }} />
    </div>
  );
}

export function ScreenAjustes({ go }: any) {
  useStore();
  const leads = LeadService.getAll();
  const currentUser = AuthService.getCurrentUser();
  const [tab, setTab] = useState('Empresa');
  const [companyForm, setCompanyForm] = useState(() => CompanyService.get());
  const [saved, setSaved] = useState(false);
  const setField = (k: keyof typeof companyForm, v: string) => { setCompanyForm((f: any) => ({ ...f, [k]: v })); setSaved(false); };

  // Same drag-and-drop pattern as the Pipeline Kanban (M0-K1): lifted React
  // state as the source of truth for what's being dragged, dataTransfer only
  // used to satisfy Firefox's requirement to start a drag at all. No caminho
  // LOCAL o token do drag é o NAME (como sempre); no REMOTO é o stage.id.
  const [draggedStage, setDraggedStage] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  // M1-D (commit 7+8): etapas podem vir do Supabase sob a flag, e o reorder
  // remoto vai pela RPC. Permissões agora vêm de capabilities explícitas
  // (lib/capabilities) combinadas com a flag AQUI, na camada de UI.
  // Boolean(currentUser) significa "profile ativo resolvido" (AuthService
  // rejeita inativos).
  //
  // M1-F S7-B: companyId vem exclusivamente de activeMembership.companyId —
  // nunca do legado currentUser.companyId (profiles.company_id), que não
  // reflete suspensão/transferência de membership (mesma classe de bug já
  // corrigida em useQueryCacheIdentity no S6-E). Sem fallback deliberado:
  // Manager/Seller usam a empresa da própria membership ativa; Super Admin
  // sem membership recebe null (nunca ganha acesso ao pipeline por meio do
  // filtro contextual de empresa — esse filtro é só da aba de Usuários,
  // §26.2/§26.10, e nunca autoriza pipeline).
  const pipeline = usePipelineStages({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    userIsActive: Boolean(currentUser),
    localStageNames: PipelineService.getStages(),
  });

  // Acesso efetivo: admin sempre tem os Ajustes completos; manager só a área
  // de Etapas e SOMENTE com a flag remota ON; seller nada. Flag OFF ⇒
  // stageSettingsAccess=false ⇒ manager não ganha nenhum acesso (legado).
  //
  // M1-F S4-F1: "Usuários" ganhou uma capability PRÓPRIA (canManageInvites —
  // Super Admin OU Manager com membership ativa), independente de
  // canAccessFullSettings/flag de Etapas. fullSettingsAccess (admin) continua
  // liberando Empresa+Usuários+Etapas juntos, exatamente como antes — a
  // capability nova só amplia quem vê Usuários SEM ganhar Empresa/Etapas
  // (decisão explícita do usuário: não ampliar canAccessFullSettings).
  const fullSettingsAccess = canAccessFullSettings(currentUser);
  const invitesAccess = canManageInvites(currentUser);
  // M1-F S4-F2/S4-F3: actor da área Usuários (modal Convidar + escopo da
  // listagem em InviteList) — resolvido a cada render, nunca congelado.
  // Super Admin ganha escolha livre de função/empresa e escopo de
  // plataforma; Manager é travado na própria membership ativa (escopo de
  // empresa). null quando invitesAccess é true por outro caminho que não
  // seja esses dois (ex.: admin legado sem membership real) — nesse caso
  // InviteList não renderiza nada (defesa em profundidade).
  const inviteActor: CreateInviteActor | null = currentUser?.platformRole === 'super_admin'
    ? { kind: 'super_admin' }
    : currentUser?.activeMembership?.role === 'manager'
      ? { kind: 'manager', companyId: currentUser.activeMembership.companyId }
      : null;
  const stageSettingsAccess = pipeline.remoteStagesEnabled && canAccessStageSettings(currentUser);
  // M1-F S5-D: seção "Usuários ativos" — mesma capability de InviteList
  // (invitesAccess), combinada aqui com a flag de rollout PRÓPRIA desta
  // seção (NEXT_PUBLIC_FF_ACTIVE_USERS). As RPCs que ela consome
  // (list_company_users/update_profile_name/update_membership_role) ainda
  // não foram aplicadas no banco remoto no momento em que este código é
  // escrito — a flag mantém a seção fora do bundle ativo em produção até o
  // deploy real das migrations, sem tocar em invitesAccess/InviteList (que
  // continuam exatamente como antes, sem regressão).
  const activeUsersEnabled = isActiveUsersEnabled() && invitesAccess;
  // M1-F S5-E1-B: ação "Alterar e-mail" — exige AMBAS as flags de rollout
  // (NEXT_PUBLIC_FF_ACTIVE_USERS E NEXT_PUBLIC_FF_USER_EMAIL_EDIT) além da
  // capability já exigida por activeUsersEnabled. isSuperAdmin/self são
  // decididos linha a linha dentro de ActiveUserList (rowCapabilities) —
  // aqui só a combinação das duas flags, nunca autorização.
  const userEmailEditEnabled = activeUsersEnabled && isUserEmailEditEnabled();
  // M1-F S6-F: ciclo de vida empresarial (suspender/reativar/desligar/
  // transferir) — flag PRÓPRIA (NEXT_PUBLIC_FF_USER_LIFECYCLE), só tem
  // efeito combinada com activeUsersEnabled (mesmo contrato de
  // userEmailEditEnabled). As RPCs que consome (suspend_membership/
  // reactivate_membership/offboard_seller/offboard_manager/
  // transfer_membership) ainda não foram aplicadas no banco remoto.
  const userLifecycleEnabled = activeUsersEnabled && isUserLifecycleEnabled();
  const allowedTabs: string[] = fullSettingsAccess
    ? ['Empresa', 'Usuários', 'Etapas']
    : [
        ...(invitesAccess ? ['Usuários'] : []),
        ...(stageSettingsAccess ? ['Etapas'] : []),
      ];
  // Derivação SÍNCRONA: aba proibida nunca renderiza, nem por um frame, e o
  // estado antigo de aba não atravessa troca de usuário.
  const activeTab: string | null = allowedTabs.includes(tab) ? tab : (allowedTabs[0] ?? null);

  // Permissão efetiva do reorder REMOTO fornecida ao hook: capability +
  // flag/área de Etapas. (remoteReady e isPending são reavaliados no handler.)
  const canReorderRemote = stageSettingsAccess && canReorderPipelineStages(currentUser);
  // M1-F S7-B: mesma correção de companyId do usePipelineStages acima —
  // activeMembership.companyId, sem fallback para o legado currentUser.companyId.
  const reorder = useReorderStages({
    companyId: currentUser?.activeMembership?.companyId ?? null,
    canReorder: canReorderRemote,
  });

  const isRemote = pipeline.source === 'remote';
  const remoteReady = isRemote && pipeline.queryEnabled && !pipeline.isLoading
    && !pipeline.isError && !pipeline.configError && !pipeline.isEmpty;
  const stages: readonly PipelineStage[] = pipeline.stages;
  const stageDragKey = (s: PipelineStage) => (isRemote ? s.id : s.name);
  const stageDraggable = (s: PipelineStage, index: number) => {
    if (isRemote) {
      // Remoto: qualquer permutação é válida (a regra "Novo fixado" era só
      // frontend e foi removida deste caminho — a RPC aceita qualquer ordem).
      return remoteReady && canReorderRemote && !reorder.isPending;
    }
    return index !== 0; // legado: "Novo" fixado no caminho local
  };

  const handleDropStage = (target: PipelineStage) => {
    const targetKey = stageDragKey(target);
    if (isRemote) {
      // SEM optimistic update: a ordem visual só muda quando o cache é
      // atualizado com o retorno da RPC (onSuccess do hook). Erro ⇒ ordem
      // anterior permanece na tela. O handler REVALIDA a capability.
      if (draggedStage && draggedStage !== targetKey
        && remoteReady && canReorderRemote && !reorder.isPending) {
        const ids = stages.map((s) => s.id);
        const from = ids.indexOf(draggedStage);
        const to = ids.indexOf(targetKey);
        if (from >= 0 && to >= 0 && from !== to) {
          const nextIds = [...ids];
          nextIds.splice(from, 1);
          nextIds.splice(to, 0, draggedStage);
          reorder.reorderStages(nextIds).catch(() => { /* exposto em reorder.error */ });
        }
      }
    } else {
      // Legado intacto: names + "Novo" fixado + persistência local.
      const names = stages.map((s) => s.name);
      const to = names.indexOf(target.name);
      if (draggedStage && draggedStage !== target.name && to !== 0) {
        const order = [...names];
        order.splice(order.indexOf(draggedStage), 1);
        order.splice(to, 0, draggedStage);
        PipelineService.reorderStages(order);
      }
    }
    setDraggedStage(null);
    setOverStage(null);
  };

  return (
    <LightScreen>
      <PageHead title="Ajustes" sub="Configure o sistema para a realidade da sua loja." />
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {allowedTabs.map(t => <Chip key={t} active={activeTab === t} onClick={() => setTab(t)}>{t}</Chip>)}
      </div>
      {activeTab === null && (
        <LCard style={{ maxWidth: 520 }}>
          <div data-testid="settings-denied" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
            Você não tem acesso às configurações.
          </div>
        </LCard>
      )}
      {activeTab === 'Empresa' && (
        <LCard style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Dados da loja</div>
          <Field label="Nome da loja" value={companyForm.name} onChange={(v: string) => setField('name', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="CNPJ" value={companyForm.cnpj} onChange={(v: string) => setField('cnpj', v)} />
            <Field label="Telefone" value={companyForm.phone} onChange={(v: string) => setField('phone', v)} />
          </div>
          <Field label="Fuso horário" value={companyForm.timezone} onChange={(v: string) => setField('timezone', v)} />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <LBtn kind="primary" icon="check" onClick={() => { CompanyService.update(companyForm); setSaved(true); }}>Salvar alterações</LBtn>
            {saved && <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>Salvo.</span>}
          </div>
        </LCard>
      )}
      {/* M1-F S5-D/S6-F/S7-C: composição completa da aba "Usuários"
          (seletor contextual de empresa + Usuários ativos + Usuários
          suspensos/desligados + Convites, nessa ordem) extraída para
          UsersTabSection — só ali o estado compartilhado do filtro de
          empresa (useCompanyScopeFilter) é instanciado, uma única vez.
          currentUser garantido não-nulo neste ponto (activeTab só chega a
          'Usuários' com invitesAccess ou fullSettingsAccess true, ambos
          exigindo currentUser). */}
      {activeTab === 'Usuários' && currentUser && (
        <UsersTabSection
          userId={currentUser.id}
          actor={inviteActor}
          activeUsersEnabled={activeUsersEnabled}
          userLifecycleEnabled={userLifecycleEnabled}
          userEmailEditEnabled={userEmailEditEnabled}
        />
      )}
      {activeTab === 'Etapas' && (
        <LCard style={{ maxWidth: 520 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Etapas do andamento</div>
          <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 16 }}>
            {isRemote
              ? 'Arraste para reordenar as etapas da sua loja.'
              : 'Arraste para reordenar. A primeira etapa é sempre "Novo".'}
          </div>
          {isRemote && !remoteReady ? (
            <div data-testid="stages-remote-state" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
              {!pipeline.queryEnabled ? 'Sessão indisponível. Entre novamente para gerenciar as etapas.'
                : pipeline.isLoading ? 'Carregando etapas…'
                : pipeline.configError ? 'As etapas da loja não correspondem à configuração esperada.'
                : pipeline.isError ? 'Não foi possível carregar as etapas.'
                : 'Nenhuma etapa configurada para sua loja.'}
            </div>
          ) : (
            <>
              {stages.map((s: PipelineStage, i: number) => (
                <div key={s.id} data-testid={`stage-row-${s.code}`}
                  draggable={stageDraggable(s, i)}
                  onDragStart={(e: any) => {
                    if (!stageDraggable(s, i)) return;
                    e.dataTransfer.setData('text/plain', stageDragKey(s));
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedStage(stageDragKey(s));
                  }}
                  onDragEnd={() => { setDraggedStage(null); setOverStage(null); }}
                  onDragOver={(e: any) => { e.preventDefault(); if (draggedStage && overStage !== stageDragKey(s)) setOverStage(stageDragKey(s)); }}
                  onDrop={(e: any) => { e.preventDefault(); handleDropStage(s); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${overStage === stageDragKey(s) ? 'var(--gold-line)' : 'var(--border)'}`, borderRadius: 10, marginBottom: 8, cursor: stageDraggable(s, i) ? 'grab' : 'default', opacity: draggedStage === stageDragKey(s) ? 0.4 : 1, transition: 'opacity .12s, border-color .15s' }}>
                  <Icon name="list" size={16} stroke={2} style={{ color: 'var(--t-400)' }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-400)' }}>{leads.filter((l: any) => l.stage === s.name).length} clientes</span>
                </div>
              ))}
              {isRemote && reorder.isPending && (
                <div data-testid="stages-saving" style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 4 }}>Salvando ordem…</div>
              )}
              {isRemote && reorder.isError && !reorder.isPending && (
                <div data-testid="stages-reorder-error" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 4 }}>
                  {getReorderStagesErrorMessage(reorder.error)}
                </div>
              )}
              {isRemote && reorder.isSuccess && !reorder.isPending && !reorder.isError && (
                <div data-testid="stages-reorder-saved" style={{ fontSize: 12.5, color: 'var(--green)', marginTop: 4 }}>Ordem salva.</div>
              )}
            </>
          )}
        </LCard>
      )}
    </LightScreen>
  );
}
