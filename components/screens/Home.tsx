'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, CountUp, FitBox } from '@/components/ui/kit';
import { PLACE, Podium } from '@/components/podiums/Podiums';
import { useStore } from '@/lib/store';
import { AuthService, SellerService, LeadService, VisitService, DealService, SaleService, TaskService } from '@/lib/services';
import { VISIT_STATUS, DEAL_STATUS, TASK_STATE } from '@/lib/data';
import type { User } from '@/lib/data';
import { useRemoteLeadsScreenState } from '@/lib/hooks/useRemoteLeadsScreenState';
import { usePlatformLeads } from '@/lib/hooks/usePlatformLeads';
import { useRemoteTasksScreenState, type UseRemoteTasksScreenStateResult } from '@/lib/hooks/useRemoteTasksScreenState';
import { usePlatformTasksScreenState } from '@/lib/hooks/usePlatformTasksScreenState';
import { useRemoteVisitsScreenState, type UseRemoteVisitsScreenStateResult } from '@/lib/hooks/useRemoteVisitsScreenState';
import { usePlatformVisitsScreenState } from '@/lib/hooks/usePlatformVisitsScreenState';
import { useRemoteDealsScreenState, type UseRemoteDealsScreenStateResult } from '@/lib/hooks/useRemoteDealsScreenState';
import { usePlatformDealsScreenState } from '@/lib/hooks/usePlatformDealsScreenState';
import { useCurrentCompanySellerLabels } from '@/lib/hooks/useCurrentCompanySellerLabels';
import { useRemoteSalesScreenState, type UseRemoteSalesScreenStateResult } from '@/lib/hooks/useRemoteSalesScreenState';
import { usePlatformSalesScreenState } from '@/lib/hooks/usePlatformSalesScreenState';
import { useCurrentCompanyTimezone } from '@/lib/hooks/useCurrentCompanyTimezone';
import { useCompanySellerLeaderboard } from '@/lib/hooks/useCompanySellerLeaderboard';
import { usePodiumViewPreference } from '@/lib/hooks/usePodiumViewPreference';
import {
  resolveMyCompetitionState,
  buildMinhaDisputaLines,
  buildCompetitionTickerMessages,
} from '@/lib/podium/competition';
import { useSellerCompetitionEvents } from '@/lib/hooks/useSellerCompetitionEvents';
import { useMarkCompetitionEventsSeen } from '@/lib/hooks/useMarkCompetitionEventsSeen';
import { selectPrimaryCompetitionEvent, buildCompetitionCelebration } from '@/lib/podium/competitionCelebration';
import { CompetitionCelebration } from '@/components/podiums/CompetitionCelebration';
import { resolvePresetRange, resolveCustomRange, type PeriodPreset, type ResolvedPeriod } from '@/lib/date/companyPeriod';
import { isLocalCommercialDataAllowed } from '@/lib/leads/localCommercialAccess';
import { useOperationalCompanyContext } from '@/lib/operational/OperationalCompanyContext';
import { groupLateTasksBySeller, groupOpenDealsBySeller, type SellerAttentionRow } from '@/lib/home/managerAttention';
import type { RemoteTaskModel } from '@/lib/tasks/taskAdapter';
import type { RemoteDealModel } from '@/lib/deals/adapter';

const PERIODS = ['Hoje', '7 dias', '15 dias', '30 dias', 'Personalizado'];
// HOME-FILTERS-R1-EXEC — mesmos 4 presets de PERIODS, sem 'Personalizado'
// (tratado à parte pelo popover de range custom do Pódio real).
const PODIUM_PRESETS: PeriodPreset[] = ['Hoje', '7 dias', '15 dias', '30 dias'];

const DEFAULT_SELLER = {
  id: '', name: 'Equipe', first: 'Equipe', team: '',
  leads: 0, scheduled: 0, visits: 0, sales: 0, conv: 0, move: 0,
};

// M1-E E7-A1 — resumo seguro de Leads para os widgets de UrgentAttention/
// ConversionFunnel. Nunca chama LeadService.getAll() como seam síncrona
// (essa chamada lança remote_leads_invalid_context para Super Admin e
// remote_leads_snapshot_unavailable para Manager/Seller antes da bridge
// popular o snapshot — achado do E7-A0). Usa useRemoteLeadsScreenState
// (a mesma composição já usada por ScreenClientesLegacy/ScreenAndamentoLegacy)
// como única fonte remota — nunca uma segunda fonte, nunca leitura direta
// do remoteSnapshot. Mesma cascata de estados já provada em
// ScreenClientesLegacy (stages→leads), reduzida ao que este resumo precisa:
// um status discriminado, nunca um número inventado.
//
// 'unavailable' cobre tanto remote_misconfigured (fail-closed) quanto
// remote_unavailable_identity (Super Admin sem companyId operacional, ou
// Manager/Seller sem membership ativa/operacional) — em ambos os casos: sem
// número, sem chamada a serviço local, sem seleção automática de empresa.
type HomeLeadsSummary =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; totalLeads: number; delayedLeads: number };

function useHomeLeadsSummary(currentUser: User | null): HomeLeadsSummary {
  const remote = useRemoteLeadsScreenState(currentUser);
  const { mode, pipeline, leads } = remote;

  if (mode === 'local') return { status: 'local' };
  if (mode === 'remote_misconfigured') return { status: 'unavailable' };
  if (mode === 'remote_unavailable_identity') return { status: 'unavailable' };

  // mode === 'remote_active' daqui em diante — mesma cascata de
  // ScreenClientesLegacy (stages primeiro, leads depois).
  const stagesConfigError = pipeline.configError !== null;
  const stagesBlockingError = pipeline.isError && !pipeline.hasData && !stagesConfigError;
  const stagesEmpty = pipeline.isEmpty && !pipeline.isError && !stagesConfigError;
  const stagesLoading = !pipeline.hasData && !stagesConfigError && !stagesBlockingError && !stagesEmpty;
  if (stagesConfigError || stagesEmpty) return { status: 'unavailable' };
  if (stagesBlockingError) return { status: 'error', retry: pipeline.refetch };
  if (stagesLoading) return { status: 'loading' };

  const leadsConfigError = leads.configError !== null;
  const leadsBlockingError = !leadsConfigError && leads.isError && !leads.hasData && !leads.isEmpty;
  const leadsLoading = !leadsConfigError && !leadsBlockingError && leads.isLoading && !leads.hasData && !leads.isEmpty;
  if (leadsConfigError) return { status: 'unavailable' };
  if (leadsBlockingError) return { status: 'error', retry: leads.refetch };
  if (leadsLoading) return { status: 'loading' };

  return {
    status: 'ready',
    totalLeads: leads.leads.length,
    delayedLeads: leads.leads.filter((l) => l.urgency === 'red').length,
  };
}

// SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — fonte de Leads do
// Funil comercial para Super Admin contextual: usePlatformLeads (M1-F
// S8-C2-B2, já usado por ScreenClientes via PlatformCommercialClientsView),
// NUNCA useRemoteLeadsScreenState (membership-only, sempre
// remote_unavailable_identity para Super Admin — activeMembership é
// sempre null). Shape de entrada bem mais simples que o membership
// (usePlatformLeads não tem pipeline/stages, só leads company-wide) — por
// isso uma derivação própria, nunca uma tentativa de encaixar no cascade
// de useHomeLeadsSummary acima. Mesmo campo `urgency` usado ali.
function deriveHomeLeadsSummaryFromPlatformLeads(platform: ReturnType<typeof usePlatformLeads>): HomeLeadsSummary {
  if (!platform.queryEnabled) return { status: 'unavailable' };
  if (platform.isLoading) return { status: 'loading' };
  if (platform.isError) return { status: 'error', retry: platform.refetch };
  return {
    status: 'ready',
    totalLeads: platform.leads.length,
    delayedLeads: platform.leads.filter((l) => l.urgency === 'red').length,
  };
}

// COMMERCIAL-REMOTE-B1-B3-G — resumo de Tasks da Home, independente de
// leadsSummary (achado do G-PRECHECK: o card de pendências usava
// leadsSummary.status como proxy incorreto — Tasks tem modo remoto
// próprio, resolveTaskRemoteMode(), desde B1-B3-A). Mesmo padrão de
// useHomeLeadsSummary: wrapper fino sobre a composição já pronta
// (useRemoteTasksScreenState → useTasks/useAdaptedRemoteTasks), chamada
// SEMPRE (Rules of Hooks), nenhuma query nova, nenhum dado local dentro
// do hook — 'local' só sinaliza o modo; a contagem local continua sendo
// lida no ponto visual (UrgentAttention), igual ao padrão de Leads.
type HomeTasksSummary =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; lateCount: number; lateTasks: readonly RemoteTaskModel[] };

// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §24/§33 — extraído para
// função pura reaproveitável tanto pelo caminho membership (hook abaixo)
// quanto pelo caminho platform do Super Admin contextual (Home chama
// usePlatformTasksScreenState diretamente e passa o resultado aqui) —
// mesma derivação, nunca duas lógicas de "o que é atrasado" divergindo.
function deriveHomeTasksSummary(remote: UseRemoteTasksScreenStateResult): HomeTasksSummary {
  if (remote.mode === 'task_local') return { status: 'local' };
  if (remote.mode === 'task_blocked') return { status: 'unavailable' };
  if (remote.mode === 'task_remote_misconfigured') return { status: 'unavailable' };
  if (remote.mode === 'task_remote_unavailable_identity') return { status: 'unavailable' };

  // mode === 'task_remote_active' daqui em diante.
  if (remote.isLoading) return { status: 'loading' };
  if (remote.isError) return { status: 'error', retry: remote.refetch };
  if (remote.configError !== null) return { status: 'unavailable' };

  // COMMERCIAL-REMOTE-DEALS-B7-B2 — lateTasks expõe o MESMO array já
  // filtrado usado para lateCount (nenhum cálculo adicional, nenhuma
  // segunda leitura de remote.tasks) — reaproveitado pela seção Manager
  // "Equipe precisa de atenção" (ManagerTeamAttentionSection) para agrupar
  // por Seller sem chamar useRemoteTasksScreenState uma segunda vez.
  const lateTasks = remote.tasks.filter((task) => task.state === TASK_STATE.LATE);
  return {
    status: 'ready',
    lateCount: lateTasks.length,
    lateTasks,
  };
}

function useHomeTasksSummary(currentUser: User | null): HomeTasksSummary {
  const remote = useRemoteTasksScreenState(currentUser);
  return deriveHomeTasksSummary(remote);
}

// COMMERCIAL-REMOTE-VISITS-B7 — resumo de Visits da Home, independente de
// leadsSummary (mesmo raciocínio de useHomeTasksSummary/G-PRECHECK: Visits
// tem modo remoto próprio, resolveVisitRemoteMode(), desde o B2).
// "Leads local ⟹ Visits local" é estruturalmente garantido por
// resolveVisitRemoteMode() (visit_local só existe quando
// resolveRemoteLeadsFlagMode()==='local') — mas o inverso NÃO vale: Leads
// remote_active pode conviver com Visits blocked/misconfigured/loading/
// error (cada domínio comercial resolve seu próprio estado, nunca um proxy
// do outro — B7-PRECHECK §18). Wrapper fino sobre
// useRemoteVisitsScreenState, a mesma composição já usada por ScreenVisitas
// — nenhuma query nova, nenhuma segunda fonte.
type HomeVisitsSummary =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; unconfirmedCount: number; openCount: number };

// SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — extraída para função
// pura (mesmo padrão de deriveHomeTasksSummary no V2A), reaproveitada tanto
// pelo caminho membership (hook abaixo) quanto pelo caminho platform do
// Super Admin contextual (Home chama usePlatformVisitsScreenState
// diretamente e passa o resultado aqui).
function deriveHomeVisitsSummary(remote: UseRemoteVisitsScreenStateResult): HomeVisitsSummary {
  if (remote.mode === 'visit_local') return { status: 'local' };
  if (remote.mode === 'visit_blocked') return { status: 'unavailable' };
  if (remote.mode === 'visit_remote_misconfigured') return { status: 'unavailable' };
  if (remote.mode === 'visit_remote_unavailable_identity') return { status: 'unavailable' };

  // mode === 'visit_remote_active' daqui em diante.
  if (remote.isLoading) return { status: 'loading' };
  if (remote.isError) return { status: 'error', retry: remote.refetch };
  if (remote.configError !== null) return { status: 'unavailable' };

  // Definições congeladas no B7-PRECHECK §9/§10 — só RemoteVisitModel/
  // status (nunca legacy PENDING/SCHEDULED/RESCHEDULED/AWAITING_RESULT),
  // sem dependência de scheduledAt/now (B7-PRECHECK §11 — nenhum relógio
  // novo só para a Home; groupVisitsForScreen/pending-result permanecem
  // fora de escopo).
  return {
    status: 'ready',
    unconfirmedCount: remote.visits.filter((v) => v.status === 'scheduled').length,
    openCount: remote.visits.filter((v) => v.status === 'scheduled' || v.status === 'confirmed').length,
  };
}

function useHomeVisitsSummary(currentUser: User | null): HomeVisitsSummary {
  const remote = useRemoteVisitsScreenState(currentUser);
  return deriveHomeVisitsSummary(remote);
}

// COMMERCIAL-REMOTE-DEALS-B7-B1 — resumo de Deals da Home, independente de
// leadsSummary/tasksSummary/visitsSummary (mesmo raciocínio de
// useHomeTasksSummary/useHomeVisitsSummary — B7-B-PRECHECK §5: cada domínio
// comercial resolve seu próprio estado, nunca um proxy de outro). Wrapper
// fino sobre useRemoteDealsScreenState, a mesma composição já usada por
// ScreenPropostas/Negociações — nenhuma query nova, nenhuma segunda fonte,
// nenhuma contagem por Seller (isso é B7-B2, fora de escopo aqui).
type HomeDealsSummary =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; openCount: number; openDeals: readonly RemoteDealModel[] };

// SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — extraída para função
// pura (mesmo padrão de deriveHomeTasksSummary/deriveHomeVisitsSummary),
// reaproveitada tanto pelo caminho membership (hook abaixo) quanto pelo
// caminho platform do Super Admin contextual.
function deriveHomeDealsSummary(remote: UseRemoteDealsScreenStateResult): HomeDealsSummary {
  if (remote.mode === 'deal_local') return { status: 'local' };
  if (remote.mode === 'deal_blocked') return { status: 'unavailable' };
  if (remote.mode === 'deal_remote_misconfigured') return { status: 'unavailable' };
  if (remote.mode === 'deal_remote_unavailable_identity') return { status: 'unavailable' };

  // mode === 'deal_remote_active' daqui em diante.
  if (remote.isLoading) return { status: 'loading' };
  if (remote.isError) return { status: 'error', retry: remote.refetch };
  if (remote.configError !== null) return { status: 'unavailable' };

  // COMMERCIAL-REMOTE-DEALS-B7-B2 — openDeals expõe o MESMO array já
  // filtrado usado para openCount (mesmo raciocínio de lateTasks acima) —
  // reaproveitado pela seção Manager sem chamar useRemoteDealsScreenState
  // uma segunda vez.
  const openDeals = remote.deals.filter((deal) => deal.status === 'open');
  return {
    status: 'ready',
    openCount: openDeals.length,
    openDeals,
  };
}

function useHomeDealsSummary(currentUser: User | null): HomeDealsSummary {
  const remote = useRemoteDealsScreenState(currentUser);
  return deriveHomeDealsSummary(remote);
}

// HOME-CONVERSION-FUNNEL-R1-EXEC — resumo de Sales da Home ("Funil
// comercial", etapa Vendas), independente de leadsSummary/tasksSummary/
// visitsSummary/dealsSummary (mesmo raciocínio de useHomeDealsSummary
// acima). Wrapper fino sobre useRemoteSalesScreenState — a MESMA
// composição já REMOTE VERIFIED usada por ScreenResultados — nenhuma
// query nova, nenhuma segunda fonte, nenhuma agregação por vendedor (isso
// é o Pódio — PODIUM-COMPETITION-R1-EXEC, useCompanySellerLeaderboard,
// agregado 100% server-side — fora de escopo aqui: só a contagem total já
// autorizada pela RLS).
type HomeSalesSummary =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; totalSales: number };

// SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — extraída para função
// pura (mesmo padrão de deriveHomeTasksSummary/deriveHomeVisitsSummary/
// deriveHomeDealsSummary), reaproveitada tanto pelo caminho membership
// (hook abaixo) quanto pelo caminho platform do Super Admin contextual
// (usePlatformSalesScreenState, mesma fonte já usada por ScreenVendas/
// ScreenResultados).
function deriveHomeSalesSummary(remote: UseRemoteSalesScreenStateResult): HomeSalesSummary {
  if (remote.mode === 'sale_local') return { status: 'local' };
  if (remote.mode === 'sale_blocked') return { status: 'unavailable' };
  if (remote.mode === 'sale_remote_misconfigured') return { status: 'unavailable' };
  if (remote.mode === 'sale_remote_unavailable_identity') return { status: 'unavailable' };

  // mode === 'sale_remote_active' daqui em diante.
  if (remote.isLoading) return { status: 'loading' };
  if (remote.isError) return { status: 'error', retry: remote.refetch };
  if (remote.configError !== null) return { status: 'unavailable' };

  return { status: 'ready', totalSales: remote.sales.length };
}

function useHomeSalesSummary(currentUser: User | null): HomeSalesSummary {
  const remote = useRemoteSalesScreenState(currentUser);
  return deriveHomeSalesSummary(remote);
}

// Estado compacto de loading/erro/indisponível para os widgets comerciais —
// nunca o cartão de página inteira (LocalCommercialUnavailableCard não se
// encaixa no espaço de uma seção do Home); mesma mensagem sanitizada em
// todo lugar, nunca detalhe técnico/UUID/stack.
function CommercialWidgetNotice({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div style={{ padding: '20px 22px', borderRadius: 14, textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px solid var(--line-dark)', color: 'var(--txt-lo)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <span>{children}</span>
      {onRetry && (
        <button onClick={onRetry} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-mid)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, textDecoration: 'underline' }}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

function getCompetition(sellers: any[]) {
  const currentUser = AuthService.getCurrentUser();
  const sellerId = currentUser?.activeMembership?.sellerId;
  const me = (sellerId ? SellerService.getById(sellerId) : null)
    ?? SellerService.getAll()[0]
    ?? DEFAULT_SELLER;
  const meIdx = sellers.findIndex((s: any) => s.id === me.id);
  const rivalAhead = meIdx > 0 ? sellers[meIdx - 1] : null;
  const chaser = meIdx >= 0 && meIdx < sellers.length - 1 ? sellers[meIdx + 1] : null;
  const third = sellers[2] ?? sellers[sellers.length - 1] ?? null;
  const top3Gap = Math.max(0, (third?.sales ?? 0) - (me.sales ?? 0));
  const aheadGap = Math.max(0, (rivalAhead?.sales ?? 0) - (me.sales ?? 0));
  return { meIdx, me, pos: meIdx >= 0 ? meIdx + 1 : 1, rivalAhead, chaser, third, top3Gap, aheadGap, weeklyDone: 2, weeklyGoal: 3, leader: sellers[0] ?? DEFAULT_SELLER };
}

// HOME-FILTERS-R1-EXEC — período e segmento saem da ControlBar global no
// modo remoto: período vira real e se muda de posição para o cabeçalho do
// próprio Pódio (R1-EXEC §1); segmento (Todos/Novos/Seminovos) some por
// completo — não representa Lead/Deal/Sale/veículo, é Seller.team, um
// conceito sem contrato remoto hoje (A1-PRECHECK §9/§17). Local/fixture
// preserva os dois controles exatamente como estavam, pixel a pixel
// (§18) — nenhuma mudança de comportamento, só a mesma condicional
// `isSellersLocal` já usada pelo resto da Home para decidir o que
// renderizar.
function ControlBar({ period, setPeriod, variant, setVariant, team, setTeam, isSellersLocal }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 26px', borderBottom: '1px solid var(--line-dark)', background: 'rgba(8,8,9,.78)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 8 }}>
      {isSellersLocal && (
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: period === p ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'transparent', color: period === p ? '#2a2104' : 'var(--txt-mid)', transition: 'all .15s' }}>{p}</button>
          ))}
        </div>
      )}
      {isSellersLocal && (
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
          {['Todos', 'Novos', 'Seminovos'].map(tm => (
            <button key={tm} onClick={() => setTeam(tm)} style={{ padding: '8px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: team === tm ? 'rgba(255,255,255,.08)' : 'transparent', color: team === tm ? '#fff' : 'var(--txt-lo)', transition: 'all .15s' }}>{tm}</button>
          ))}
        </div>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Pódio</span>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
          {[['A', 'Pódio'], ['B', 'Líder'], ['C', 'Galeria'], ['D', 'Campeão']].map(([v, name]) => (
            <button key={v} onClick={() => setVariant(v)} title={name} style={{ padding: '8px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'Archivo, sans-serif', background: variant === v ? 'rgba(212,175,55,.16)' : 'transparent', color: variant === v ? '#E8CE72' : 'var(--txt-lo)', boxShadow: variant === v ? 'inset 0 0 0 1px rgba(212,175,55,.4)' : 'none', transition: 'all .15s' }}>{v}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// PODIUM-COMPETITION-R2A-EXEC — no modo remoto, `messages` chega já
// resolvido por buildCompetitionTickerMessages (lib/podium/competition.ts),
// 100% derivado do leaderboard real, sem fixture. Mantém a mesma casca
// visual (scroll infinito, mesmo layout de item) — só a fonte do conteúdo
// muda; local/fixture continua no array `comp`-based abaixo, intocado.
function CompTicker({ comp, messages }: any) {
  const msgs = messages ?? [
    { icon: 'flag', c: '#E8CE72', t: <span>Faltam <b>{comp.top3Gap} vendas</b> para você entrar no <b>TOP 3</b></span> },
    { icon: 'flame', c: '#FF6B3B', t: <span><b>{comp.chaser?.first ?? '-'}</b> subiu 3 posições e empatou com você</span> },
    { icon: 'target', c: '#E23744', t: <span>Seu rival direto: <b>{comp.rivalAhead?.first ?? '-'}</b>, {comp.aheadGap} vendas à frente</span> },
    { icon: 'trophy', c: '#E8CE72', t: <span><b>{comp.leader?.first}</b> lidera com {comp.leader?.sales} vendas</span> },
    { icon: 'zap', c: '#27C75F', t: <span>Meta da semana: <b>+{comp.weeklyGoal} vendas</b></span> },
  ];
  if (messages && messages.length === 0) return null;
  const row = (key: string) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 38, padding: '0 19px', flexShrink: 0 }}>
      {msgs.map((m: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <Icon name={m.icon} size={15} stroke={2.2} style={{ color: m.c }} />
          <span style={{ fontSize: 13, color: 'var(--txt-mid)', whiteSpace: 'nowrap' }}>{m.t ?? m.text}</span>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--line-dark-2)', marginLeft: 18 }} />
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ borderBottom: '1px solid var(--line-dark)', background: 'linear-gradient(180deg,#0d0d0e,#0a0a0b)', overflow: 'hidden', position: 'sticky', top: 57, zIndex: 7, height: 42, display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', width: 'max-content', animation: 'tickerScroll 42s linear infinite' }}>
        {row('a')}{row('b')}
      </div>
    </div>
  );
}

function Col({ label, v }: { label: string; v: any }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 40 }}>
      <div className="tnum" style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-mid)', lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 9, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function RankingRow({ s, pos, active, leader, me, target }: any) {
  const pl = pos <= 3 ? (PLACE as any[])[pos - 1] : null;
  const moveIcon = s.move > 0 ? 'arrowUp' : s.move < 0 ? 'arrowDown' : null;
  const moveColor = s.move > 0 ? '#27C75F' : s.move < 0 ? '#E23744' : 'var(--txt-lo)';
  const bg = leader ? 'linear-gradient(90deg,rgba(212,175,55,.14),rgba(212,175,55,.02))'
    : me ? 'linear-gradient(90deg,rgba(59,130,246,.16),rgba(59,130,246,.02))'
    : target ? 'linear-gradient(90deg,rgba(212,175,55,.07),transparent)' : 'transparent';
  const bd = leader ? 'rgba(212,175,55,.32)' : me ? 'rgba(59,130,246,.45)' : target ? 'rgba(212,175,55,.22)' : 'transparent';
  return (
    <div onClick={() => (window as any).__openFlow && (window as any).__openFlow('perfil-vendedor', { seller: s, pos })}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 12, background: bg, border: `1px solid ${bd}`, transition: 'background .15s', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
      onMouseEnter={(e: any) => { if (!leader && !me) e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
      onMouseLeave={(e: any) => { if (!leader && !me) e.currentTarget.style.background = bg; }}>
      {leader && active && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><div style={{ position: 'absolute', top: 0, left: 0, width: '30%', height: '100%', background: 'linear-gradient(90deg,transparent,rgba(212,175,55,.14),transparent)', animation: 'sweep 6s ease-in-out 1s infinite' }} /></div>}
      <div className="display tnum" style={{ width: 26, textAlign: 'center', fontSize: 19, fontWeight: 900, color: pl ? pl.ring : me ? '#5B9BFF' : 'var(--txt-lo)' }}>{pos}</div>
      {/* PODIUM-MOVEMENT-R1-B1-EXEC §23/§24 — title torna a seta acessível
          (nunca só visual) e deixa explícito que o movimento é do mês
          oficial, mesmo quando o Pódio está filtrado em Hoje/7/15/30 dias
          (§8 do PRECHECK: rank do filtro visual e movement mensal são
          conceitos diferentes, não devem ser confundidos). */}
      <div style={{ width: 13, color: moveColor }} title={s.move > 0 ? `Subiu ${s.move} ${s.move > 1 ? 'posições' : 'posição'} no mês` : undefined}>{moveIcon && <Icon name={moveIcon} size={13} stroke={3} />}</div>
      <Avatar name={s.name} size={34} ring={pl ? pl.ring : me ? '#3B82F6' : '#3a3a40'} gold={pos === 1} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
          {me && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', color: '#fff', background: '#3B82F6', padding: '2px 7px', borderRadius: 999 }}>VOCÊ</span>}
          {target && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', color: '#E8CE72', background: 'rgba(212,175,55,.14)', border: '1px solid rgba(212,175,55,.4)', padding: '1px 7px', borderRadius: 999 }}>SEU ALVO</span>}
        </div>
        {s.team && <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{s.team}</div>}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {typeof s.leads === 'number' && <Col label="Leads" v={s.leads} />}
        {typeof s.visits === 'number' && <Col label="Visitas" v={s.visits} />}
        {typeof s.conv === 'number' && <Col label="Conv." v={s.conv + '%'} />}
        <div style={{ textAlign: 'center', minWidth: 44 }}>
          <div className="display tnum" style={{ fontSize: 23, fontWeight: 900, color: pos === 1 ? '#E8CE72' : me ? '#5B9BFF' : '#fff', lineHeight: 1 }}>{s.sales}</div>
          <div style={{ fontSize: 9, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>vendas</div>
        </div>
      </div>
    </div>
  );
}

function RankingList({ sellers, active, comp }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg,#161618,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, overflow: 'hidden', height: '100%', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '17px 18px', borderBottom: '1px solid var(--line-dark)' }}>
        <Icon name="trophy" size={17} stroke={2} style={{ color: '#D4AF37' }} />
        <span className="display" style={{ fontWeight: 800, fontSize: 15.5, color: '#fff', letterSpacing: '.01em' }}>Ranking completo</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--txt-lo)' }}>{sellers.length} vendedores</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {(sellers as any[]).map((s: any, i: number) => <RankingRow key={s.id} s={s} pos={i + 1} active={active} leader={i === 0} me={s.id === (AuthService.getCurrentUser()?.activeMembership?.sellerId ?? null)} target={comp && s.id === (comp.rivalAhead && comp.rivalAhead.id)} />)}
      </div>
    </div>
  );
}

function RaceMsg({ icon, c, title, children }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderRadius: 13, background: `linear-gradient(180deg, ${c}1f, rgba(0,0,0,.18)), #161618`, border: `1px solid ${c}55` }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: `${c}26`, color: c, display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07)' }}>
        <Icon name={icon} size={19} stroke={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 3 }}>{children}</div>
      </div>
    </div>
  );
}

// PODIUM-COMPETITION-R2A-EXEC — `remote` (quando presente) traz {me, lines}
// já resolvidos por buildMinhaDisputaLines (lib/podium/competition.ts):
// me = row real (sellerId/sellerLabel/saleCount/completedVisitCount/rank),
// lines = RaceMsg reais (rival/liderança/perseguidor/Top 3), nunca meta
// semanal/leads/agendadas/conversão fixture (§4/§6 do EXEC — campos sem
// contrato real desaparecem, não viram 0). Preserva a casca visual do
// card legado (avatar, header, badge de posição, grid de stats, RaceMsg);
// local/fixture (comp-based) permanece intocado abaixo.
function MinhaDisputa({ active, comp, remote }: any) {
  if (remote) {
    const { me, lines } = remote;
    const stats = [
      { label: 'Minhas vendas', v: me.saleCount, icon: 'trophy', gold: true },
      { label: 'Visitas realizadas', v: me.completedVisitCount, icon: 'check' },
    ];
    return (
      <div style={{ background: 'linear-gradient(135deg,#19191c,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, padding: 24, boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
          <Avatar name={me.sellerLabel} size={52} ring="#3B82F6" />
          <div>
            <div style={{ fontSize: 12, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Minha disputa</div>
            <div className="display" style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{me.sellerLabel}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,.35)', border: '1px solid var(--line-dark)', borderRadius: 14, padding: '12px 20px' }}>
            <span style={{ fontSize: 11.5, color: 'var(--txt-lo)' }}>Minha posição</span>
            <span className="display" style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{me.rank}º</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, alignContent: 'start' }}>
            {stats.map((s: any) => (
              <div key={s.label} style={{ background: 'rgba(0,0,0,.3)', border: '1px solid var(--line-dark)', borderRadius: 13, padding: '14px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
                  <Icon name={s.icon} size={14} stroke={2} style={{ color: s.gold ? '#D4AF37' : 'var(--txt-lo)' }} />
                </div>
                <div className="display tnum" style={{ fontSize: 28, fontWeight: 800, color: s.gold ? '#E8CE72' : '#fff', lineHeight: 1 }}>
                  {active ? <CountUp value={s.v} active={active} /> : s.v}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--txt-lo)', fontWeight: 600, marginTop: 6 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(lines as any[]).map((line) => (
              <RaceMsg key={line.id} icon={line.icon} c={line.c} title={line.title}>{line.text}</RaceMsg>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const me = comp.me;
  const stats = [
    { label: 'Meus leads', v: me.leads, icon: 'users' },
    { label: 'Agendadas', v: me.scheduled, icon: 'calendar' },
    { label: 'Visitas feitas', v: me.visits, icon: 'check' },
    { label: 'Minhas vendas', v: me.sales, icon: 'trophy', gold: true },
    { label: 'Conversão', v: me.conv, suf: '%', icon: 'target' },
  ];
  const goalPct = Math.round((comp.weeklyDone / comp.weeklyGoal) * 100);
  return (
    <div style={{ background: 'linear-gradient(135deg,#19191c,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, padding: 24, boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <Avatar name={me.name} size={52} ring="#3B82F6" />
        <div>
          <div style={{ fontSize: 12, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Minha disputa</div>
          <div className="display" style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{me.name}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,.35)', border: '1px solid var(--line-dark)', borderRadius: 14, padding: '12px 20px' }}>
          <span style={{ fontSize: 11.5, color: 'var(--txt-lo)' }}>Minha posição</span>
          <span className="display" style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{comp.pos}º</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, alignContent: 'start' }}>
          {stats.map((s: any) => (
            <div key={s.label} style={{ background: 'rgba(0,0,0,.3)', border: '1px solid var(--line-dark)', borderRadius: 13, padding: '14px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
                <Icon name={s.icon} size={14} stroke={2} style={{ color: s.gold ? '#D4AF37' : 'var(--txt-lo)' }} />
              </div>
              <div className="display tnum" style={{ fontSize: 28, fontWeight: 800, color: s.gold ? '#E8CE72' : '#fff', lineHeight: 1 }}>
                {active ? <CountUp value={s.v} active={active} /> : s.v}{s.suf || ''}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--txt-lo)', fontWeight: 600, marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1', background: 'rgba(0,0,0,.3)', border: '1px solid var(--line-dark)', borderRadius: 13, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--txt-mid)' }}><Icon name="zap" size={13} stroke={2.4} style={{ color: '#27C75F', verticalAlign: -2 }} /> Meta da semana: <b style={{ color: '#fff' }}>+{comp.weeklyGoal} vendas</b></span>
              <span className="tnum" style={{ fontSize: 12.5, color: 'var(--txt-lo)', fontWeight: 700 }}>{comp.weeklyDone}/{comp.weeklyGoal}</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div style={{ width: goalPct + '%', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#1DB954,#27C75F)', boxShadow: '0 0 12px rgba(39,199,95,.6)', animation: 'barFill 1.1s ease-out' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <RaceMsg icon="flag" c="#D4AF37" title="Sua meta agora">Faltam <b style={{ color: '#E8CE72' }}>{comp.top3Gap} vendas</b> para entrar no TOP 3</RaceMsg>
          <RaceMsg icon="target" c="#E23744" title="Rival direto">Ultrapasse <b>{comp.rivalAhead?.first ?? '-'}</b>, está só {comp.aheadGap} vendas à frente</RaceMsg>
          <RaceMsg icon="flame" c="#FF8A00" title="Atenção">{comp.chaser?.first ?? '-'} empatou com você e vem subindo rápido</RaceMsg>
        </div>
      </div>
    </div>
  );
}

// HOME-FILTERS-R1-EXEC §1 — "PERÍODO DO RANKING" vive no cabeçalho do
// próprio Pódio (via SectionTitle right=), nunca mais na ControlBar
// global: deixa claro que só esse bloco muda quando o período muda. Só os
// 4 presets diretos ficam como botão; "Personalizado" abre um popover
// compacto (2 campos de data, sem wizard — §8) só aplicado com "Aplicar"
// (nunca um range inválido em trânsito vira filtro real — §9).
function formatShortDate(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

function PodiumPeriodControl({
  period, onSelectPreset, appliedCustomRange, customDraft, setCustomDraft,
  customOpen, setCustomOpen, customError, onApplyCustom,
}: any) {
  return (
    <div style={{ marginLeft: 'auto', position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Período do ranking</span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
        {PODIUM_PRESETS.map((p) => (
          <button key={p} onClick={() => onSelectPreset(p)} style={{ padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: period === p ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'transparent', color: period === p ? '#2a2104' : 'var(--txt-mid)', transition: 'all .15s' }}>{p}</button>
        ))}
        <button onClick={() => setCustomOpen(!customOpen)} style={{ padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: period === 'Personalizado' ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'transparent', color: period === 'Personalizado' ? '#2a2104' : 'var(--txt-mid)', transition: 'all .15s' }}>Personalizado</button>
      </div>
      {period === 'Personalizado' && appliedCustomRange && (
        <span style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{formatShortDate(appliedCustomRange.start)} a {formatShortDate(appliedCustomRange.end)}</span>
      )}
      {customOpen && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 20, background: '#161618', border: '1px solid var(--line-dark)', borderRadius: 14, padding: 16, boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>Escolha uma data inicial e final.</div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--txt-lo)' }}>
            Data inicial
            <input type="date" value={customDraft.start} onChange={(e: any) => setCustomDraft({ ...customDraft, start: e.target.value })} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--line-dark)', borderRadius: 8, padding: '7px 9px', color: '#fff', fontFamily: 'inherit', fontSize: 13 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--txt-lo)' }}>
            Data final
            <input type="date" value={customDraft.end} onChange={(e: any) => setCustomDraft({ ...customDraft, end: e.target.value })} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--line-dark)', borderRadius: 8, padding: '7px 9px', color: '#fff', fontFamily: 'inherit', fontSize: 13 }} />
          </label>
          {customError && <div style={{ fontSize: 11.5, color: '#FF8A8A' }}>{customError}</div>}
          <button onClick={onApplyCustom} style={{ marginTop: 4, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'linear-gradient(180deg,#E8CE72,#C9A227)', color: '#2a2104' }}>Aplicar</button>
        </div>
      )}
    </div>
  );
}

// PODIUM-COMPETITION-R1-EXEC §16/§21 — empresa com ZERO Sales no período
// oficial: nunca monta um Top 3/Ranking artificial (0 vendas para todos).
// sellerCount vem do roster REAL já devolvido pela RPC (leaderboard.rows
// nunca fica vazio quando existe ao menos 1 seller ativo) — nunca um
// número inventado.
function PodiumEmptyState({ sellerCount }: { sellerCount: number }) {
  return (
    <div style={{ padding: '44px 22px', borderRadius: 18, textAlign: 'center', background: 'linear-gradient(180deg,#161618,#111113)', border: '1px solid var(--line-dark)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <Icon name="trophy" size={30} stroke={1.8} style={{ color: '#D4AF37', opacity: .55 }} />
      <div className="display" style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Aguardando as primeiras vendas</div>
      <div style={{ fontSize: 13.5, color: 'var(--txt-lo)', maxWidth: 420 }}>Assim que a equipe registrar a primeira venda, a disputa começa.</div>
      {sellerCount > 0 && (
        <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--txt-mid)', fontWeight: 600 }}>
          {sellerCount} {sellerCount === 1 ? 'vendedor' : 'vendedores'} na disputa
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, tone, children, right }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      {icon && <Icon name={icon} size={18} stroke={2.2} style={{ color: tone || '#D4AF37' }} />}
      <span className="display" style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '.01em' }}>{children}</span>
      {right}
    </div>
  );
}

function UrgentMetricCard({ it, i, go }: { it: { n: number; label: string; sub: string; icon: string; to: string }; i: number; go: (id: string) => void }) {
  return (
    <button key={i} onClick={() => go(it.to)} style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(160deg,#2a0d0e,#180809)', border: '1px solid rgba(255,46,46,.45)', borderRadius: 16, padding: 18, position: 'relative', overflow: 'hidden', animation: `redScream 2.8s ease-in-out infinite`, animationDelay: (i * .35) + 's' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#FF3B3B' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name={it.icon} size={18} stroke={2.2} style={{ color: '#FF6B6B' }} />
        <span style={{ fontSize: 11, color: '#FF8A8A', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Urgente</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="display tnum" style={{ fontSize: 40, fontWeight: 900, color: '#fff', lineHeight: .9 }}>{it.n}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{it.label}</span>
      </div>
      <div style={{ fontSize: 12, color: '#E5A6A6', marginTop: 8 }}>{it.sub}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 13, fontSize: 12.5, fontWeight: 700, color: '#FF6B6B' }}>
        Resolver agora <Icon name="arrowRight" size={14} stroke={2.5} />
      </div>
    </button>
  );
}

// HOME-ATTENTION-R1-EXEC — "Atenção imediata" é área de EXCEÇÃO ("o que
// exige ação agora?"), não dashboard geral: count=0 → card não existe;
// todos count=0 → seção não existe (R1-EXEC §2/§8). Auditoria do lote sobre
// as 4 métricas legadas (docs no branch remoto abaixo) concluiu que só
// "pendências atrasadas" (Tasks LATE) tem contrato objetivo de atraso real
// — as outras três saem de Attention na V1 (permanecem só onde já viviam
// fora desta seção: funil, Vendas/Visitas/Propostas). Local/fixture
// (isLocal) preserva o comportamento antigo pixel-a-pixel — inclusive
// contagem 0 visível — para não quebrar a demo legada nem os testes
// antigos (R1-EXEC §10: não misturar local + remoto).
function UrgentAttention({ go, leadsSummary, tasksSummary, visitsSummary }: { go: (id: string) => void; leadsSummary: HomeLeadsSummary; tasksSummary: HomeTasksSummary; visitsSummary: HomeVisitsSummary }) {
  const isLocal = leadsSummary.status === 'local';

  // COMMERCIAL-REMOTE-B1-B3-G-R1 — Tasks é resolvido SEMPRE por
  // tasksSummary, NUNCA por leadsSummary.status==='local' (o G-EXEC tinha
  // reintroduzido esse acoplamento por engano). A suposição "Leads local
  // ⟹ Task local" é FALSA quando REMOTE_TASKS=true e REMOTE_LEADS=false:
  // resolveTaskRemoteMode() (lib/tasks/remoteTasksMode.ts) só entra no
  // ramo `leadsMode==='local' ? 'task_local' : 'task_blocked'` quando
  // `tasksEnabled` é false — com tasksEnabled=true e leadsMode local (≠
  // 'remote_ready'), o resultado é 'task_remote_misconfigured', nunca
  // 'task_local'. TaskService.getAll() só pode ser chamado quando
  // tasksSummary.status === 'local'.
  let taskCell: React.ReactNode | null = null;
  if (tasksSummary.status === 'local') {
    const lateCount = TaskService.getAll().filter((t: any) => t.state === TASK_STATE.LATE).length;
    taskCell = <UrgentMetricCard key="tasks" i={0} go={go} it={{ n: lateCount, label: 'pendências atrasadas', sub: 'Resolva o quanto antes', icon: 'check', to: 'pendencias' }} />;
  } else if (tasksSummary.status === 'loading') {
    taskCell = <CommercialWidgetNotice key="tasks">Carregando pendências…</CommercialWidgetNotice>;
  } else if (tasksSummary.status === 'error') {
    taskCell = <CommercialWidgetNotice key="tasks" onRetry={tasksSummary.retry}>Não foi possível carregar as pendências.</CommercialWidgetNotice>;
  } else if (tasksSummary.status === 'ready' && (isLocal || tasksSummary.lateCount > 0)) {
    // HOME-ATTENTION-R1-EXEC — count=0 fora do modo local não é mais
    // atenção real: card omitido (não um "0" vermelho). Local preserva o
    // comportamento antigo (mostra mesmo a 0).
    taskCell = <UrgentMetricCard key="tasks" i={0} go={go} it={{ n: tasksSummary.lateCount, label: 'pendências atrasadas', sub: 'Resolva o quanto antes', icon: 'check', to: 'pendencias' }} />;
  }
  // 'unavailable' (e 'ready' com lateCount=0 fora do local): célula
  // omitida — nunca um card mostrando zero/indisponível como dado real.

  if (isLocal) {
    // Leads/Propostas/Visitas: legado, 100% intocado (fora de escopo deste
    // lote — R1-EXEC §10/§17, preservado só para a demo/testes antigos).
    const leadCells: React.ReactNode[] = [
      <UrgentMetricCard key="leads" i={0} go={go} it={{ n: LeadService.getAll().filter((l: any) => l.urgency === 'red').length, label: 'leads atrasados', sub: 'Sem contato recente', icon: 'flame', to: 'clientes' }} />,
      <UrgentMetricCard key="propostas" i={1} go={go} it={{ n: DealService.getAll().filter((d: any) => d.status === DEAL_STATUS.APPROVAL).length, label: 'propostas aguardando aprovação', sub: 'Desconto acima do limite', icon: 'handshake', to: 'propostas' }} />,
    ];

    // COMMERCIAL-REMOTE-VISITS-B7 — Visitas resolvido SEMPRE por
    // visitsSummary, NUNCA por leadsSummary.status: "Leads local ⟹ Visits
    // local" é garantido por resolveVisitRemoteMode(), mas o inverso não
    // vale — mesmo com Leads local, Tasks (acima) pode não ser
    // 'task_local'; o mesmo switch multi-status vale para Visits.
    // VisitService.getAll() só pode ser chamado quando
    // visitsSummary.status === 'local'.
    let visitCell: React.ReactNode | null = null;
    if (visitsSummary.status === 'local') {
      const unconfirmed = VisitService.getAll().filter((v: any) => v.status === VISIT_STATUS.PENDING).length;
      visitCell = <UrgentMetricCard key="visitas" i={1} go={go} it={{ n: unconfirmed, label: 'visitas não confirmadas', sub: 'Confirme antes do horário', icon: 'calendar', to: 'visitas' }} />;
    } else if (visitsSummary.status === 'loading') {
      visitCell = <CommercialWidgetNotice key="visitas">Carregando visitas…</CommercialWidgetNotice>;
    } else if (visitsSummary.status === 'error') {
      visitCell = <CommercialWidgetNotice key="visitas" onRetry={visitsSummary.retry}>Não foi possível carregar as visitas.</CommercialWidgetNotice>;
    } else if (visitsSummary.status === 'ready') {
      visitCell = <UrgentMetricCard key="visitas" i={1} go={go} it={{ n: visitsSummary.unconfirmedCount, label: 'visitas não confirmadas', sub: 'Confirme antes do horário', icon: 'calendar', to: 'visitas' }} />;
    }

    const cells = [...leadCells, ...(visitCell ? [visitCell] : []), ...(taskCell ? [taskCell] : [])];
    return (
      <div>
        <SectionTitle icon="alert" tone="#FF3B3B">Atenção imediata</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 14 }}>
          {cells}
        </div>
      </div>
    );
  }

  // Remote V1 — auditoria do lote (documentada no relatório final):
  //  - leads atrasados (Lead.urgency==='red'): estado de evento
  //    (calculateLeadHealth/default 'red' na criação), não "sem contato há
  //    N dias" — sem contrato de atraso objetivo. REMOVE.
  //  - visitas não confirmadas (Visit.status==='scheduled'): qualquer
  //    visita futura ainda sem confirmação, sem dimensão de tempo/prazo —
  //    sem contrato de atenção objetivo. REMOVE.
  //  - negociações em andamento (Deal.status==='open'): Deal aberto é
  //    comportamento normal, não é problema por si só — REMOVE (stalled/
  //    stale Deal fica FUTURE, sem contrato definido ainda).
  //  - pendências atrasadas (Task LATE): único caso com contrato real de
  //    overdue — KEEP, único card possível em Attention remoto.
  if (!taskCell) return null;
  return (
    <div>
      <SectionTitle icon="alert" tone="#FF3B3B">Atenção imediata</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        {taskCell}
      </div>
    </div>
  );
}

function SellerAttentionRowView({ row }: { row: SellerAttentionRow }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,.02)', border: '1px solid var(--line-dark)' }}>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{row.sellerLabel}</span>
      <span className="tnum" style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{row.count}</span>
    </div>
  );
}

function ManagerAttentionSubsection({ title, rows, emptyLabel, notice }: { title: string; rows: SellerAttentionRow[] | null; emptyLabel: string; notice: React.ReactNode | null }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--txt-lo)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
      {notice ?? (
        rows && rows.length > 0
          ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{rows.map((row) => <SellerAttentionRowView key={row.sellerId} row={row} />)}</div>
          : <div style={{ fontSize: 13, color: 'var(--txt-lo)', padding: '10px 14px' }}>{emptyLabel}</div>
      )}
    </div>
  );
}

// COMMERCIAL-REMOTE-DEALS-B7-B2 — seção Manager-only "Equipe precisa de
// atenção": DUAS subseções independentes (Tasks/Deals nunca combinadas
// numa mesma linha — B7-B2-PRECHECK §5/§8, cada domínio tem seu próprio
// loading/error/ready). Nenhum score combinado, nenhuma relação Task↔Deal
// apresentada. lateTasks/openDeals já vêm prontos de tasksSummary/
// dealsSummary (linha 6/8 do PRECHECK) — zero query nova aqui, o
// agrupamento em si é 100% lib/home/managerAttention.ts (puro).
function ManagerTeamAttentionSection({ tasksSummary, dealsSummary, sellersById }: {
  tasksSummary: HomeTasksSummary;
  dealsSummary: HomeDealsSummary;
  sellersById: Readonly<Record<string, { id: string; name: string }>>;
}) {
  const isTaskRelevant = tasksSummary.status === 'loading' || tasksSummary.status === 'error' || tasksSummary.status === 'ready';
  const isDealRelevant = dealsSummary.status === 'loading' || dealsSummary.status === 'error' || dealsSummary.status === 'ready';
  // 'local'/'unavailable' em AMBOS: nenhuma seção vazia é montada
  // (B7-B2-PRECHECK §17/§43).
  if (!isTaskRelevant && !isDealRelevant) return null;

  const subsections: React.ReactNode[] = [];
  if (isTaskRelevant) {
    const notice = tasksSummary.status === 'loading'
      ? <CommercialWidgetNotice>Carregando acompanhamentos…</CommercialWidgetNotice>
      : tasksSummary.status === 'error'
        ? <CommercialWidgetNotice onRetry={tasksSummary.retry}>Não foi possível carregar os acompanhamentos.</CommercialWidgetNotice>
        : null;
    const rows = tasksSummary.status === 'ready' ? groupLateTasksBySeller(tasksSummary.lateTasks, sellersById) : null;
    subsections.push(
      <ManagerAttentionSubsection key="tasks" title="Acompanhamentos atrasados" rows={rows} notice={notice} emptyLabel="Nenhum acompanhamento atrasado." />,
    );
  }
  if (isDealRelevant) {
    const notice = dealsSummary.status === 'loading'
      ? <CommercialWidgetNotice>Carregando negociações…</CommercialWidgetNotice>
      : dealsSummary.status === 'error'
        ? <CommercialWidgetNotice onRetry={dealsSummary.retry}>Não foi possível carregar as negociações.</CommercialWidgetNotice>
        : null;
    const rows = dealsSummary.status === 'ready' ? groupOpenDealsBySeller(dealsSummary.openDeals, sellersById) : null;
    subsections.push(
      <ManagerAttentionSubsection key="deals" title="Negociações em andamento" rows={rows} notice={notice} emptyLabel="Nenhuma negociação em andamento." />,
    );
  }

  return (
    <div>
      <SectionTitle icon="users" tone="#5B9BFF">Equipe precisa de atenção</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${subsections.length}, 1fr)`, gap: 20, background: 'linear-gradient(180deg,#161618,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, padding: 20 }}>
        {subsections}
      </div>
    </div>
  );
}

function QuickActions({ go }: { go: (id: string, params?: any) => void }) {
  const actions = [
    { label: 'Novo cliente', icon: 'plus', tone: 'gold', to: 'clientes' },
    { label: 'Agendar visita', icon: 'calendar', to: 'visitas' },
    { label: 'Registrar venda', icon: 'trophy', to: 'vendas' },
    { label: 'Atualizar cliente', icon: 'user', to: 'clientes' },
    // PILOT-UI-TRUTH-FIXES-R1-EXEC §11 — achado do audit: "Ver atrasados"
    // navegava para Clientes sem aplicar nenhum filtro (go() não aceitava
    // parâmetro), prometendo um recorte que não entregava. Passa o mesmo
    // valor de filtro ('Atrasados') que o Guide interno de ScreenClientes já
    // usa (CLIENT_FILTERS em ScreensOps.tsx) via o initialFilter recebido
    // pela tela — nenhum filtro novo, nenhuma rota nova.
    { label: 'Ver atrasados', icon: 'clock', tone: 'red', to: 'clientes', params: { filter: 'Atrasados' } },
    { label: 'Criar proposta', icon: 'handshake', to: 'propostas' },
  ];
  return (
    <div>
      <SectionTitle icon="zap">Ações rápidas</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 14 }}>
        {actions.map((a, i) => {
          const gold = a.tone === 'gold'; const red = a.tone === 'red';
          return (
            <button key={i} onClick={() => go(a.to, (a as any).params)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '24px 12px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', transition: 'transform .14s, box-shadow .14s', background: gold ? 'linear-gradient(180deg,#211b09,#161103)' : red ? 'linear-gradient(180deg,#241011,#170a0b)' : 'linear-gradient(180deg,#1a1a1d,#131315)', border: `1px solid ${gold ? 'rgba(212,175,55,.4)' : red ? 'rgba(255,46,46,.38)' : 'var(--line-dark)'}`, boxShadow: 'var(--shadow-sm)' }}
              onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 16px 32px -16px ${gold ? 'rgba(212,175,55,.5)' : red ? 'rgba(255,46,46,.5)' : 'rgba(0,0,0,.8)'}`; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, display: 'grid', placeItems: 'center', background: gold ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : red ? 'linear-gradient(180deg,#FF4242,#D81F2C)' : 'rgba(255,255,255,.06)', color: gold ? '#2a2104' : '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.2)' }}>
                <Icon name={a.icon} size={25} stroke={2.2} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', textAlign: 'center' }}>{a.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// HOME-CONVERSION-FUNNEL-R1-EXEC — cada etapa do funil é OU um valor real
// pronto (kind:'value') OU um placeholder compacto de loading/erro
// (kind:'loading'/'error') — nunca um zero fingido enquanto o source
// correspondente não está pronto. 'unavailable' não produz stage nenhum
// (a etapa inteira é omitida do array, nunca renderizada como notice).
type FunnelStage =
  | { kind: 'value'; key: string; label: string; sub: string; v: number; icon: string; c: string; gold?: boolean }
  | { kind: 'loading' | 'error'; key: string; label: string; icon: string; c: string; retry?: () => void };

function FunnelStageCell({ stage, isLast, top, active }: { stage: FunnelStage; isLast: boolean; top: number; active: boolean }) {
  const gold = stage.kind === 'value' && stage.gold;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <div className="lift" style={{ flex: 1, height: '100%', borderRadius: 14, padding: '20px 18px', background: gold ? 'linear-gradient(180deg, rgba(212,175,55,.12), rgba(0,0,0,.12)), #161618' : 'rgba(255,255,255,.02)', border: `1px solid ${gold ? 'rgba(212,175,55,.4)' : 'var(--line-dark)'}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, background: `${stage.c}22`, color: stage.c, display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)' }}><Icon name={stage.icon} size={19} stroke={2.2} /></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{stage.label}</div>
            {stage.kind === 'value' && <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{stage.sub}</div>}
          </div>
        </div>
        {stage.kind === 'value' ? (
          <>
            <div className="display tnum" style={{ fontSize: 44, fontWeight: 900, color: stage.gold ? '#E8CE72' : '#fff', lineHeight: 1, letterSpacing: '-.02em' }}>
              {active ? <CountUp value={stage.v} active={active} /> : stage.v}
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
              <div style={{ width: Math.round((stage.v / top) * 100) + '%', height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${stage.c}, color-mix(in srgb, ${stage.c} 65%, #000))`, boxShadow: `0 0 10px ${stage.c}66`, animation: 'barFill 1.1s ease-out' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--txt-lo)' }}>total no sistema</div>
          </>
        ) : (
          <div style={{ flex: 1, minHeight: 66, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
            <div style={{ fontSize: 12.5, color: stage.kind === 'error' ? '#FF8A8A' : 'var(--txt-lo)' }}>
              {stage.kind === 'loading' ? 'Carregando…' : 'Não foi possível carregar.'}
            </div>
            {stage.kind === 'error' && stage.retry && (
              <button onClick={stage.retry} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--txt-mid)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, textDecoration: 'underline', padding: 0 }}>
                Tentar novamente
              </button>
            )}
          </div>
        )}
      </div>
      {!isLast && <div style={{ position: 'absolute', right: -2, top: '50%', transform: 'translate(50%,-50%)', zIndex: 2, width: 26, height: 26, borderRadius: '50%', background: '#1b1b1e', border: '1px solid var(--line-dark-2)', display: 'grid', placeItems: 'center', color: 'var(--txt-lo)' }}><Icon name="arrowRight" size={14} stroke={2.4} /></div>}
    </div>
  );
}

// Barra de cada etapa é só proporção visual em relação ao MAIOR valor real
// exibido (nunca rotulada como % de conversão — A1-PRECHECK §4/§8: os
// datasets são snapshots de populações diferentes, não um cohort
// sequencial). Etapas em loading/error não entram no cálculo do topo.
function FunnelBlock({ title, stages, active }: { title: string; stages: FunnelStage[]; active: boolean }) {
  const values = stages.filter((s): s is Extract<FunnelStage, { kind: 'value' }> => s.kind === 'value').map((s) => s.v);
  const top = Math.max(...values, 1);
  return (
    <div>
      <SectionTitle icon="flow">{title}</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stages.length}, 1fr)`, gap: 0, alignItems: 'stretch', background: 'linear-gradient(180deg,#161618,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, padding: '8px', boxShadow: 'var(--shadow-md)', position: 'relative' }}>
        {stages.map((stage, i) => <FunnelStageCell key={stage.key} stage={stage} isLast={i === stages.length - 1} top={top} active={active} />)}
      </div>
    </div>
  );
}

function ConversionFunnel({ active, leadsSummary, visitsSummary, dealsSummary, salesSummary }: { active: boolean; leadsSummary: HomeLeadsSummary; visitsSummary: HomeVisitsSummary; dealsSummary: HomeDealsSummary; salesSummary: HomeSalesSummary }) {
  if (leadsSummary.status === 'unavailable') {
    return (
      <div>
        <SectionTitle icon="flow">Funil comercial</SectionTitle>
        <CommercialWidgetNotice>Métricas comerciais indisponíveis nesta sessão.</CommercialWidgetNotice>
      </div>
    );
  }
  if (leadsSummary.status === 'loading') {
    return (
      <div>
        <SectionTitle icon="flow">Funil comercial</SectionTitle>
        <CommercialWidgetNotice>Carregando…</CommercialWidgetNotice>
      </div>
    );
  }
  if (leadsSummary.status === 'error') {
    return (
      <div>
        <SectionTitle icon="flow">Funil comercial</SectionTitle>
        <CommercialWidgetNotice onRetry={leadsSummary.retry}>Não foi possível carregar o funil.</CommercialWidgetNotice>
      </div>
    );
  }

  if (leadsSummary.status === 'local') {
    // Local/fixture legado — 100% intocado, inclusive o título original
    // ("Funil de conversão", nunca "Funil comercial" — R1-EXEC §1/§20,
    // preserva os testes antigos).
    const stages: FunnelStage[] = [
      { kind: 'value', key: 'leads', label: 'Leads', sub: 'clientes cadastrados', v: LeadService.getAll().length, icon: 'users', c: '#5B9BFF' },
      { kind: 'value', key: 'visitas', label: 'Visitas', sub: 'agendadas no total', v: VisitService.getAll().length, icon: 'calendar', c: '#A855F7' },
      { kind: 'value', key: 'propostas', label: 'Propostas', sub: 'criadas no total', v: DealService.getAll().length, icon: 'handshake', c: '#27C75F' },
      { kind: 'value', key: 'vendas', label: 'Vendas', sub: 'registradas no total', v: SaleService.getAll().length, icon: 'trophy', c: '#E8CE72', gold: true },
    ];
    return <FunnelBlock title="Funil de conversão" stages={stages} active={active} />;
  }

  // "Funil comercial" — R1-EXEC A1-PRECHECK §1: renomeado porque os 4
  // datasets são snapshots de populações diferentes, nunca um cohort
  // sequencial (nenhum "% da etapa anterior" — §7/§8/§12 do EXEC). Leads é
  // sempre real (leadsSummary já é 'ready' aqui, pelos early-returns
  // acima). Visitas/Negociações/Vendas resolvem CADA UMA seu próprio
  // estado remoto, independente entre si e de Leads (mesmo princípio já
  // usado por UrgentAttention/ManagerTeamAttentionSection): 'unavailable'
  // omite a etapa inteira, 'loading'/'error' mostram um placeholder só
  // NAQUELA etapa (nunca derruba o bloco todo se as outras já resolveram),
  // 'ready' mostra o valor real — 0 incluso, 0 é dado válido depois de
  // ready (§13). ZERO fixture: LeadService/VisitService/DealService/
  // SaleService nunca são chamados aqui.
  const stages: FunnelStage[] = [
    { kind: 'value', key: 'leads', label: 'Leads', sub: 'clientes cadastrados', v: leadsSummary.totalLeads, icon: 'users', c: '#5B9BFF' },
  ];
  if (visitsSummary.status === 'loading') stages.push({ kind: 'loading', key: 'visitas', label: 'Visitas', icon: 'calendar', c: '#A855F7' });
  else if (visitsSummary.status === 'error') stages.push({ kind: 'error', key: 'visitas', label: 'Visitas', icon: 'calendar', c: '#A855F7', retry: visitsSummary.retry });
  else if (visitsSummary.status === 'ready') stages.push({ kind: 'value', key: 'visitas', label: 'Visitas', sub: 'em aberto', v: visitsSummary.openCount, icon: 'calendar', c: '#A855F7' });
  // 'local'/'unavailable': etapa omitida (estruturalmente 'local' nunca
  // ocorre aqui — Leads não-local ⟹ Visits não-local).

  if (dealsSummary.status === 'loading') stages.push({ kind: 'loading', key: 'negociacoes', label: 'Negociações', icon: 'handshake', c: '#27C75F' });
  else if (dealsSummary.status === 'error') stages.push({ kind: 'error', key: 'negociacoes', label: 'Negociações', icon: 'handshake', c: '#27C75F', retry: dealsSummary.retry });
  else if (dealsSummary.status === 'ready') stages.push({ kind: 'value', key: 'negociacoes', label: 'Negociações', sub: 'em aberto', v: dealsSummary.openCount, icon: 'handshake', c: '#27C75F' });

  if (salesSummary.status === 'loading') stages.push({ kind: 'loading', key: 'vendas', label: 'Vendas', icon: 'trophy', c: '#E8CE72' });
  else if (salesSummary.status === 'error') stages.push({ kind: 'error', key: 'vendas', label: 'Vendas', icon: 'trophy', c: '#E8CE72', retry: salesSummary.retry });
  else if (salesSummary.status === 'ready') stages.push({ kind: 'value', key: 'vendas', label: 'Vendas', sub: 'registradas', v: salesSummary.totalSales, icon: 'trophy', c: '#E8CE72', gold: true });

  return <FunnelBlock title="Funil comercial" stages={stages} active={active} />;
}

export function Home({ t, setTweak, go, active, currentUser }: { currentUser?: User | null; [key: string]: any }) {
  const [period, setPeriod] = useState('30 dias');
  const [team, setTeam] = useState('Todos');
  // HOME-FILTERS-R1-EXEC — range custom do Pódio. `customRange` é o range
  // já APLICADO (só existe depois de "Aplicar" com start/end válidos —
  // nunca um range em edição vira filtro real, §9); `customDraft` é só o
  // estado do formulário do popover. V1 fica em state local, sem URL/
  // persistência (A1-PRECHECK §15 — simplicidade).
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [customDraft, setCustomDraft] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [customOpen, setCustomOpen] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 1240);

  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 1240);
    onR(); window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  useStore(); // subscribes to store changes for re-render — sellers read via SellerService below (Correção 9)
  // SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §24/§33 — movido para
  // antes das summaries: tasksSummary abaixo já precisa saber se está em
  // contexto operacional Super Admin para escolher a fonte certa.
  const operational = useOperationalCompanyContext();
  const isOperationalSuperAdmin = operational.mode === 'super_admin';
  // M1-E E7-A1 — chamado SEMPRE (Rules of Hooks), independente do modo;
  // useRemoteLeadsScreenState já gateia local/remote_ready/misconfigured/
  // sem-identidade internamente.
  //
  // SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — Funil comercial
  // agora precisa de Leads reais para Super Admin contextual também (dual-
  // hook, ambos SEMPRE chamados, Rules of Hooks; só a SAÍDA é selecionada
  // condicionalmente — mesmo padrão já usado para tasksSummary no V2A).
  // usePlatformLeads é a MESMA fonte já usada por ScreenClientes via
  // PlatformCommercialClientsView — nenhuma query nova.
  const membershipLeadsSummary = useHomeLeadsSummary(currentUser ?? null);
  const platformLeadsForHome = usePlatformLeads({
    companyId: isOperationalSuperAdmin ? operational.companyId : null,
    archived: false,
    authorized: isOperationalSuperAdmin,
  });
  const leadsSummary = isOperationalSuperAdmin
    ? deriveHomeLeadsSummaryFromPlatformLeads(platformLeadsForHome)
    : membershipLeadsSummary;
  // COMMERCIAL-REMOTE-B1-B3-G — chamado SEMPRE (Rules of Hooks), mesma
  // garantia de leadsSummary acima; independente dela por design
  // (G-PRECHECK §8/§9 — Leads e Tasks nunca voltam a compartilhar um
  // proxy de estado).
  //
  // SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §24/§33 — Atenção
  // imediata passa a usar Tasks company-wide reais para Super Admin
  // contextual (ambos os hooks SEMPRE chamados, Rules of Hooks; só a
  // SAÍDA é selecionada condicionalmente, mesmo padrão já usado em
  // ScreenPendencias/ScreenVisitas/ScreenPropostas).
  const membershipTasksSummary = useHomeTasksSummary(currentUser ?? null);
  const platformTasksScreenForHome = usePlatformTasksScreenState(
    isOperationalSuperAdmin ? operational.companyId : null,
  );
  const tasksSummary = isOperationalSuperAdmin
    ? deriveHomeTasksSummary(platformTasksScreenForHome)
    : membershipTasksSummary;
  // COMMERCIAL-REMOTE-VISITS-B7 — chamado SEMPRE (Rules of Hooks), mesma
  // garantia de leadsSummary/tasksSummary acima; independente de ambas por
  // design (B7-PRECHECK §18 — Leads/Tasks/Visits nunca voltam a
  // compartilhar um proxy de estado).
  //
  // SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — mesmo dual-hook do
  // Funil comercial, reaproveitando usePlatformVisitsScreenState (V2A, já
  // usado por ScreenVisitas) — nenhuma query nova.
  const membershipVisitsSummary = useHomeVisitsSummary(currentUser ?? null);
  const platformVisitsScreenForHome = usePlatformVisitsScreenState(
    isOperationalSuperAdmin ? operational.companyId : null,
  );
  const visitsSummary = isOperationalSuperAdmin
    ? deriveHomeVisitsSummary(platformVisitsScreenForHome)
    : membershipVisitsSummary;
  // COMMERCIAL-REMOTE-DEALS-B7-B1 — chamado SEMPRE (Rules of Hooks), mesma
  // garantia de leadsSummary/tasksSummary/visitsSummary acima; independente
  // de todas por design (B7-B-PRECHECK §5 — cada domínio comercial resolve
  // seu próprio estado, nunca um proxy de outro).
  //
  // SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21 — mesmo dual-hook,
  // reaproveitando usePlatformDealsScreenState (V2A, já usado por
  // ScreenPropostas) — nenhuma query nova.
  const membershipDealsSummary = useHomeDealsSummary(currentUser ?? null);
  const platformDealsScreenForHome = usePlatformDealsScreenState(
    isOperationalSuperAdmin ? operational.companyId : null,
  );
  const dealsSummary = isOperationalSuperAdmin
    ? deriveHomeDealsSummary(platformDealsScreenForHome)
    : membershipDealsSummary;
  // HOME-CONVERSION-FUNNEL-R1-EXEC — chamado SEMPRE (Rules of Hooks), mesma
  // garantia das demais summaries acima; independente de todas por design
  // (etapa "Vendas" do Funil comercial — mesmo useRemoteSalesScreenState já
  // usado pelo Pódio, TanStack Query dedupe por queryKey evita 2ª chamada
  // de rede).
  //
  // SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §14/§21 — mesmo dual-hook,
  // via usePlatformSalesScreenState (nova, mesma fonte já usada por
  // ScreenVendas/ScreenResultados) — nenhuma query nova.
  const membershipSalesSummaryForHome = useHomeSalesSummary(currentUser ?? null);
  const platformSalesScreenForHome = usePlatformSalesScreenState(
    isOperationalSuperAdmin ? operational.companyId : null,
  );
  const salesSummary = isOperationalSuperAdmin
    ? deriveHomeSalesSummary(platformSalesScreenForHome)
    : membershipSalesSummaryForHome;
  // COMMERCIAL-REMOTE-DEALS-B7-B2 — apresentação apenas; RLS/backend
  // continua a única autoridade sobre quais rows cada usuário recebe.
  // membershipRole força 'manager' → null para Seller (nunca 'seller'),
  // desabilitando estruturalmente a query de sellerLabels quando a seção
  // Manager nunca vai renderizar (B7-B2-PRECHECK §11/§15 — zero query
  // desnecessária para Seller).
  const isManager = currentUser?.activeMembership?.role === 'manager';
  // HOME-PODIUM-R1-EXEC — antes desabilitada para Seller (única consumidora
  // era a seção Manager-only de Tasks/Deals). O pódio real precisa resolver
  // o próprio nome do Seller (buildSalesRanking), então o gate passa a
  // cobrir manager E seller — mesmo papel/mesma chamada de ScreenResultados
  // (linha "membershipRole: currentUser?.activeMembership?.role"). Para
  // Seller a RPC (list_current_company_seller_labels) já devolve só a
  // própria linha por RLS — nenhuma ampliação de visão aqui.
  const isSeller = currentUser?.activeMembership?.role === 'seller';
  // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — companyId/flag de leitura do
  // Pódio/Ranking/movement (§18 do EXEC V1). Desde
  // SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §21, TODAS as summaries
  // comerciais da Home (leads/tasks/visits/deals/sales) já recebem o
  // companyId operacional do Super Admin, via seus respectivos
  // platform*ScreenForHome acima — o Funil comercial inteiro (§20) usa a
  // MESMA companyId aqui. sellerLabels (abaixo) continua exclusivamente
  // com activeMembership.companyId — não alimenta o Funil, só a seção
  // Manager (nunca renderiza para Super Admin).
  const podiumCompanyId = isOperationalSuperAdmin
    ? operational.companyId
    : (currentUser?.activeMembership?.companyId ?? null);
  const sellerLabels = useCurrentCompanySellerLabels({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: isManager ? 'manager' : isSeller ? 'seller' : null,
    userIsActive: Boolean(currentUser),
  });
  // HOME-FILTERS-R1-EXEC — chamado SEMPRE (Rules of Hooks), mesma garantia
  // das demais acima; independente de todas por design. Resolve o timezone
  // REAL da empresa ativa (nunca o do navegador) para ancorar o filtro de
  // período do Pódio — reaproveita fetchAccessibleCompanies (RLS já
  // existente), zero RPC nova.
  const companyTimezone = useCurrentCompanyTimezone({
    userId: currentUser?.id ?? null,
    companyId: podiumCompanyId,
    membershipRole: isManager ? 'manager' : isSeller ? 'seller' : null,
    userIsActive: Boolean(currentUser),
    isSuperAdminContext: isOperationalSuperAdmin,
  });
  // Resolve o range de período aplicado ao Pódio — 'loading' enquanto o
  // timezone não chegou (nunca um filtro calculado com timezone errado),
  // 'unavailable'/'error' espelham companyTimezone. 'Personalizado' só
  // produz 'ready' depois de um range aplicado e válido (customRange !=
  // null — resolveCustomRange já validou start<=end no momento do
  // "Aplicar", nunca recalculado aqui a partir de um draft em edição).
  const periodResolution: ResolvedPeriod = useMemo(() => {
    if (companyTimezone.status === 'loading' || companyTimezone.status === 'local') return { kind: 'loading' };
    if (companyTimezone.status === 'unavailable') return { kind: 'unavailable' };
    if (companyTimezone.status === 'error') return { kind: 'error', retry: companyTimezone.retry };

    const timezone = companyTimezone.timezone;
    if (period === 'Personalizado') {
      if (!customRange) return { kind: 'unavailable' };
      const range = resolveCustomRange(customRange.start, customRange.end, timezone);
      return range ? { kind: 'ready', ...range } : { kind: 'unavailable' };
    }
    const range = resolvePresetRange(period as PeriodPreset, timezone, new Date());
    return { kind: 'ready', ...range };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customRange, companyTimezone.status, (companyTimezone as any).timezone]);

  function selectPodiumPreset(p: string) {
    setPeriod(p);
    setCustomOpen(false);
    setCustomError(null);
  }

  function applyCustomRange() {
    if (!customDraft.start || !customDraft.end) {
      setCustomError('Escolha uma data inicial e uma data final.');
      return;
    }
    if (customDraft.start > customDraft.end) {
      setCustomError('A data inicial precisa ser antes da data final.');
      return;
    }
    setCustomError(null);
    setCustomRange({ start: customDraft.start, end: customDraft.end });
    setPeriod('Personalizado');
    setCustomOpen(false);
  }

  // PODIUM-COMPETITION-R1-EXEC — leaderboard company-wide real, agregado
  // server-side (list_company_seller_leaderboard) — substitui o
  // useHomePodiumRanking/RealPodiumTop3 anterior (que só resolvia um Top 3
  // "sozinho", filtrando Sale bruta client-side). Chamado SEMPRE (Rules of
  // Hooks), mesma garantia das demais summaries acima. Manager e Seller
  // recebem o MESMO hook/mesmo shape — a RPC já devolve o roster inteiro
  // da empresa para os dois papéis (§4/§11 do EXEC), nenhum filtro
  // adicional aqui.
  const leaderboard = useCompanySellerLeaderboard({
    userId: currentUser?.id ?? null,
    companyId: podiumCompanyId,
    membershipRole: isManager ? 'manager' : isSeller ? 'seller' : null,
    userIsActive: Boolean(currentUser),
    isSuperAdminContext: isOperationalSuperAdmin,
    period: periodResolution,
  });

  // PODIUM-COMPETITION-R2B-B1-EXEC §25/§32 — cobre o caso "Manager
  // registrou a venda enquanto o Seller estava offline": ao carregar a
  // Home, se existir evento unseen do próprio Seller, mostra a comemoração
  // real UMA vez (nunca no load de Manager/Super Admin — hook já nega por
  // role/RLS). O leaderboard já reflete a posição nova quando isso
  // acontece (mesma invalidation de useRegisterSale, mesmo hook de leitura
  // — nunca dessincroniza).
  const pendingCompetitionEvents = useSellerCompetitionEvents({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: isManager ? 'manager' : isSeller ? 'seller' : null,
    userIsActive: Boolean(currentUser),
  });
  const markPendingCompetitionEventsSeen = useMarkCompetitionEventsSeen({
    companyId: currentUser?.activeMembership?.companyId ?? null,
    userId: currentUser?.id ?? null,
  });
  const [homeCelebrationDismissed, setHomeCelebrationDismissed] = useState(false);
  const primaryPendingCompetitionEvent = pendingCompetitionEvents.status === 'ready'
    ? selectPrimaryCompetitionEvent(pendingCompetitionEvents.events)
    : null;
  const showHomeCelebration = Boolean(primaryPendingCompetitionEvent) && !homeCelebrationDismissed;

  const dismissHomeCelebration = async () => {
    setHomeCelebrationDismissed(true);
    try {
      const idsToMark = pendingCompetitionEvents.status === 'ready'
        ? pendingCompetitionEvents.events.map((e) => e.id)
        : primaryPendingCompetitionEvent ? [primaryPendingCompetitionEvent.id] : [];
      await markPendingCompetitionEventsSeen.markSeen(idsToMark);
    } catch {
      // Mesma tolerância de FlowRegistrarVenda: falha ao marcar "visto"
      // não é crítica — na pior hipótese reaparece 1x no próximo load.
    }
  };

  // Preferência visual A/B/C/D: local/fixture continua 100% no TweaksPanel
  // (t.podium/setTweak, §44 do EXEC — zero mudança de comportamento local);
  // remoto usa a persistência própria por usuário no navegador (§36-§39),
  // nunca a mesma chave (um Manager trocando de variante no Ajustes de QA
  // local nunca deve mexer na preferência real de ninguém).
  const [remoteVariant, setRemoteVariant] = usePodiumViewPreference(currentUser?.id ?? null);

  // M1-E E7-B1 — Podium/Ranking (fixture) dependem exclusivamente do
  // catálogo LOCAL de Sellers (getStore().sellers, sem company_id, sem
  // backend remoto — achado do E7-A0/E7-B1). Fora do modo local nenhuma
  // leitura acontece aqui.
  const isSellersLocal = isLocalCommercialDataAllowed();
  const allSellers = isSellersLocal ? SellerService.getAll() : [];
  const localSellers = isSellersLocal
    ? (team === 'Todos' ? allSellers : allSellers.filter((s: any) => s.team === team))
    : [];
  const localComp = isSellersLocal ? getCompetition(allSellers) : null;

  // Adapta leaderboard.rows (já ordenadas por rank — a própria RPC entrega
  // nesta ordem, ver ORDER BY na migration) para o shape legado que
  // Podiums.tsx/RankingRow já esperam — DELIBERADAMENTE sem
  // team/leads/conv/scheduled/growth: esses componentes agora renderizam
  // cada um desses campos condicionalmente (só quando presentes), então
  // omiti-los aqui É o mecanismo real de "esconder sem quebrar o design"
  // (§20 do EXEC). `move` (PODIUM-MOVEMENT-R1-B1-EXEC) é a ÚNICA exceção:
  // agora vem de row.movement.positionsGained (último evento real do mês
  // oficial, nunca soma, nunca inferido) — `undefined` quando null, nunca
  // 0 fabricado (RankingRow já trata ausência como "sem seta").
  const remoteRankedSellers = leaderboard.status === 'ready'
    ? leaderboard.rows.map((row) => ({ id: row.sellerId, name: row.sellerLabel, sales: row.saleCount, visits: row.completedVisitCount, move: row.movement?.positionsGained ?? undefined }))
    : [];
  // SEU ALVO / Rival direto (§30-§32) — 100% mecânico a partir do próprio
  // array já ranqueado, nenhum backend novo: a linha imediatamente ACIMA
  // da minha. 1º colocado (ou Seller sem posição resolvida) nunca tem
  // alvo.
  const mySellerId = currentUser?.activeMembership?.sellerId ?? null;
  // PODIUM-COMPETITION-R2A-EXEC — fonte única para SEU ALVO (RankingList),
  // Minha Disputa e CompTicker: rows CRUAS do leaderboard (com rank real),
  // nunca o remoteRankedSellers já adaptado (perde `rank`). §1 do EXEC —
  // proibido criar uma segunda fonte de ranking.
  const remoteLeaderboardRows = leaderboard.status === 'ready' ? leaderboard.rows : [];
  const remoteCompetitionState = resolveMyCompetitionState(remoteLeaderboardRows, mySellerId);
  const remoteComp = remoteCompetitionState.status === 'chasing'
    ? { rivalAhead: { id: remoteCompetitionState.rival.sellerId } }
    : null;
  const remoteMinhaDisputaLines = buildMinhaDisputaLines(remoteCompetitionState, remoteLeaderboardRows);
  const remoteTickerMessages = buildCompetitionTickerMessages(remoteCompetitionState, remoteLeaderboardRows);
  const showRemoteMinhaDisputa = isSeller
    && leaderboard.status === 'ready'
    && (remoteCompetitionState.status === 'leading' || remoteCompetitionState.status === 'chasing');

  const variant = isSellersLocal ? t.podium : remoteVariant;
  const sellers = isSellersLocal ? localSellers : remoteRankedSellers;
  const top3 = sellers.slice(0, 3);
  const comp = isSellersLocal ? localComp : remoteComp;

  const podiumStage = (
    <div style={{ position: 'relative', background: 'radial-gradient(120% 80% at 50% 6%, #1d1d21 0%, #131315 48%, #0b0b0c 100%)', border: '1px solid var(--line-dark)', borderRadius: 22, padding: '0 16px 14px', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
      <div className="ambient" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 50% 0%, rgba(212,175,55,.14), transparent 70%), radial-gradient(40% 40% at 12% 92%, rgba(193,18,31,.07), transparent 70%)', pointerEvents: 'none' }} />
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .25, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', textAlign: 'center', padding: '20px 0 6px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <Icon name="medal" size={17} stroke={2} style={{ color: '#D4AF37' }} />
          <span className="display" style={{ fontSize: 13, fontWeight: 800, color: '#E8CE72', letterSpacing: '.22em' }}>PÓDIO DE CAMPEÕES</span>
          <Icon name="medal" size={17} stroke={2} style={{ color: '#D4AF37' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 7 }}>
          <span style={{ height: 1, width: 60, background: 'linear-gradient(90deg, transparent, rgba(212,175,55,.6))' }} />
          <span style={{ fontSize: 12, color: 'var(--txt-mid)', fontWeight: 600 }}>{isSellersLocal ? `${period} · ${team}` : period}</span>
          <span style={{ height: 1, width: 60, background: 'linear-gradient(90deg, rgba(212,175,55,.6), transparent)' }} />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
        {/* PODIUM-VIEWPORT-FIT-R1-EXEC — variante B passou a usar o mesmo
            FitBox das demais (antes tinha um wrapper próprio sem nenhum
            mecanismo de escala, então também podia ultrapassar o
            container em viewports mais curtos, só nunca tinha sido
            notado). FitBox agora escala por largura E altura (ver
            components/ui/kit.tsx) — nunca corta, nunca amplia além do
            tamanho natural do design. */}
        <FitBox naturalWidth={variant === 'A' ? 840 : variant === 'D' ? 900 : 866} align={(variant === 'A' || variant === 'D') ? 'bottom' : 'center'}>
          <Podium variant={variant} top3={top3} anim={t.anim} active={active} />
        </FitBox>
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--ink-900)', position: 'relative' }}>
      <ControlBar
        period={period} setPeriod={setPeriod}
        variant={variant}
        setVariant={(v: string) => { if (isSellersLocal) setTweak('podium', v); else setRemoteVariant(v as any); }}
        team={team} setTeam={setTeam} isSellersLocal={isSellersLocal}
      />
      {isSellersLocal && <CompTicker comp={comp} />}
      {!isSellersLocal && isSeller && leaderboard.status === 'ready' && remoteTickerMessages.length > 0 && (
        <CompTicker messages={remoteTickerMessages} />
      )}

      <div style={{ padding: '22px 26px 44px', position: 'relative' }}>
        {isSellersLocal ? (
          narrow ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 26 }}>
              <div style={{ height: variant === 'A' ? 620 : variant === 'B' ? 540 : variant === 'D' ? 700 : 560 }}>{podiumStage}</div>
              <div style={{ height: 520 }}><RankingList sellers={sellers} active={active} comp={comp} /></div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.9fr) minmax(360px, .92fr)', gap: 20, alignItems: 'stretch', height: 'calc(100vh - 168px)', minHeight: 600, marginBottom: 26 }}>
              {podiumStage}
              <RankingList sellers={sellers} active={active} comp={comp} />
            </div>
          )
        ) : (
          <div style={{ marginBottom: 26 }}>
            <SectionTitle icon="trophy" tone="#D4AF37" right={
              <PodiumPeriodControl
                period={period}
                onSelectPreset={selectPodiumPreset}
                appliedCustomRange={customRange}
                customDraft={customDraft}
                setCustomDraft={setCustomDraft}
                customOpen={customOpen}
                setCustomOpen={setCustomOpen}
                customError={customError}
                onApplyCustom={applyCustomRange}
              />
            }>Pódio de campeões</SectionTitle>
            {leaderboard.status === 'loading' && <CommercialWidgetNotice>Carregando pódio…</CommercialWidgetNotice>}
            {leaderboard.status === 'error' && <CommercialWidgetNotice onRetry={leaderboard.retry}>Não foi possível carregar o pódio.</CommercialWidgetNotice>}
            {(leaderboard.status === 'unavailable' || leaderboard.status === 'local') && <CommercialWidgetNotice>Métricas comerciais indisponíveis nesta sessão.</CommercialWidgetNotice>}
            {leaderboard.status === 'empty' && <PodiumEmptyState sellerCount={leaderboard.sellerCount} />}
            {leaderboard.status === 'ready' && (
              narrow ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div style={{ height: variant === 'A' ? 620 : variant === 'B' ? 540 : variant === 'D' ? 700 : 560 }}>{podiumStage}</div>
                  <div style={{ height: 520 }}><RankingList sellers={sellers} active={active} comp={comp} /></div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.9fr) minmax(360px, .92fr)', gap: 20, alignItems: 'stretch', height: 'calc(100vh - 260px)', minHeight: 600 }}>
                  {podiumStage}
                  <RankingList sellers={sellers} active={active} comp={comp} />
                </div>
              )
            )}
          </div>
        )}

        {/* SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §20/§21 — agora
            habilitado para Super Admin CONTEXTUAL: leads/visitsSummary/
            dealsSummary/salesSummary acima já vêm da company explícita
            (usePlatformLeads/usePlatformVisitsScreenState/
            usePlatformDealsScreenState/usePlatformSalesScreenState) —
            MESMO ConversionFunnel do Manager, zero componente novo.
            Continua ausente para Super Admin GENÉRICO (mode:'none', sem
            /company/[id], zero contrato de company). */}
        {(currentUser?.platformRole !== 'super_admin' || isOperationalSuperAdmin) && (
          <div style={{ marginBottom: 26 }}><ConversionFunnel active={active} leadsSummary={leadsSummary} visitsSummary={visitsSummary} dealsSummary={dealsSummary} salesSummary={salesSummary} /></div>
        )}
        {isSellersLocal && <div style={{ marginBottom: 26 }}><MinhaDisputa active={active} comp={comp} /></div>}
        {showRemoteMinhaDisputa && (
          <div style={{ marginBottom: 26 }}>
            <MinhaDisputa active={active} remote={{ me: (remoteCompetitionState as any).me, lines: remoteMinhaDisputaLines }} />
          </div>
        )}
        {/* SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §24/§33 — Atenção
            imediata agora usa Tasks company-wide reais para Super Admin
            CONTEXTUAL (tasksSummary já aponta para a fonte certa, ver
            acima) — continua ausente para Super Admin GENÉRICO (sem
            /company/[id], zero contrato de company). */}
        {(currentUser?.platformRole !== 'super_admin' || isOperationalSuperAdmin) && (
          <div style={{ marginBottom: 26 }}><UrgentAttention go={go} leadsSummary={leadsSummary} tasksSummary={tasksSummary} visitsSummary={visitsSummary} /></div>
        )}
        {isManager && (
          <div style={{ marginBottom: 26 }}>
            <ManagerTeamAttentionSection tasksSummary={tasksSummary} dealsSummary={dealsSummary} sellersById={sellerLabels.sellersById} />
          </div>
        )}
        {/* Ações rápidas são mutation entry points — continuam ausentes
            para QUALQUER Super Admin, contextual ou não (§27 do EXEC V2A). */}
        {currentUser?.platformRole !== 'super_admin' && <QuickActions go={go} />}
      </div>
      {showHomeCelebration && primaryPendingCompetitionEvent && (
        <CompetitionCelebration
          copy={buildCompetitionCelebration(primaryPendingCompetitionEvent)}
          newRank={primaryPendingCompetitionEvent.newRank}
          saleCount={primaryPendingCompetitionEvent.saleCount}
          onDismiss={dismissHomeCelebration}
          dismissLabel="Continuar"
        />
      )}
    </div>
  );
}
