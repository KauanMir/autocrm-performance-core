// services.ts — Backend abstraction layer.
// Components, screens and flows must call Services — never access the store or
// localStorage directly. When a real backend arrives, only StoreAdapter changes.
import { VISIT_STATUS, DEAL_STATUS, SALE_STATUS } from './data';
import type { User, Lead, Visit, Deal, Sale, Task, TimelineEntry, Company } from './data';
import { store, getStore } from './store';
import type { LeadInput, VisitInput, DealInput, SaleInput, TaskInput } from './store';
import { supabase, isSupabaseConfigured } from './supabase/client';
import type { ProfileRow, CompanyMembershipRow } from './supabase/types';
import { isRemoteLeadsEnabled } from './flags';
import { getRemoteLeadSnapshot, type RemoteLeadSnapshot } from './leads/remoteSnapshot';
import { RemoteLeadsError } from './leads/errors';

// ── AuthService — Supabase Auth + profiles (M1-B) ───────────────────────
// Login/logout/session now talk to Supabase Auth for real; the old
// USERS.find() + localStorage 'acrm_session' comparison is gone. Role,
// company and sellerId always come from the `profiles` row read back from
// the database after auth succeeds — never trusted from anything the client
// itself sets, so nobody can hand-edit their way into a different role.
//
// getCurrentUser() stays synchronous on purpose: every screen/flow in this
// app already calls it mid-render (17 call sites audited before this
// change), and none of that was rewritten in this phase. The actual async
// Supabase calls only happen inside login()/logout()/restoreSession(); their
// result is cached in _cachedUser so every other read is instant, exactly
// like the old localStorage version behaved.

let _cachedUser: User | null = null;

// M1-F S4-F1: membership ATIVA do próprio usuário (company_memberships),
// nunca profiles.role legado. RLS (company_memberships_select_own) só deixa
// ler linhas onde profile_id = auth.uid() — nenhum filtro de empresa/outro
// usuário é possível aqui, mesmo que alguém tentasse. is_active=true filtra
// no próprio SELECT: no máximo 1 linha pode satisfazer isso por profile
// (unique index parcial), então .maybeSingle() nunca ambiguidade. Erro ou
// ausência de linha ativa vira null — nunca lança, login não pode falhar
// por causa de membership.
//
// CORREÇÃO (M1-F S4-F2, bug real encontrado em validação E2E contra
// Supabase local): esta função filtrava explicitamente por
// `.eq('profile_id', profileId)` — mas profile_id NUNCA foi concedido a
// authenticated (o GRANT de m1f_s4f1_01 cobre só company_id/role/
// is_active, de propósito, ver migration). Referenciar profile_id em
// QUALQUER parte da query — inclusive só no WHERE, nunca no SELECT —
// exige privilégio SELECT nessa coluna; sem ele, o PostgREST nega a
// query INTEIRA com 42501 (permission denied for table
// company_memberships), não um erro silencioso. Resultado real: TODO
// Manager real tinha activeMembership sempre null (o catch envolta
// disso mascarava o erro), então canManageInvites nunca autorizava
// ninguém — bug presente desde o S4-F1, invisível nos testes porque
// tests/services/authService.test.ts mockava o Supabase por completo
// (mock não aplica GRANT/RLS reais). A RLS já restringe a QUALQUER
// select nesta tabela à própria linha (profile_id = auth.uid()) —
// filtrar por profile_id no cliente era redundante E quebrava a
// permissão. Sem esse filtro (só is_active=true, coluna concedida), a
// consulta funciona exatamente como pretendido.
async function _loadActiveMembership(): Promise<{ companyId: string; role: 'manager' | 'seller' } | null> {
  const { data, error } = await supabase
    .from('company_memberships')
    .select('company_id, role, is_active')
    .eq('is_active', true)
    .maybeSingle<CompanyMembershipRow>();
  if (error || !data) return null;
  return { companyId: data.company_id, role: data.role };
}

async function _loadProfile(authUserId: string, fallbackEmail?: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, company_id, name, email, role, seller_id, is_active, platform_role')
    .eq('id', authUserId)
    .single<ProfileRow>();
  if (error || !data || !data.is_active) return null;
  const activeMembership = await _loadActiveMembership();
  return {
    id: data.id,
    name: data.name,
    email: data.email || fallbackEmail || '',
    role: data.role,
    sellerId: data.seller_id,
    companyId: data.company_id,
    platformRole: data.platform_role,
    activeMembership,
  };
}

export const AuthService = {
  async login(email: string, password: string): Promise<User | null> {
    if (!isSupabaseConfigured) {
      // eslint-disable-next-line no-console
      console.error('[AutoCRM] Supabase não configurado — preencha .env.local antes de logar (ver .env.local.example).');
      return null;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) { _cachedUser = null; return null; }
    const user = await _loadProfile(data.user.id, data.user.email);
    if (!user) { await supabase.auth.signOut(); } // authenticated but no active profile — don't leave a half session
    _cachedUser = user;
    return user;
  },

  async logout(): Promise<void> {
    await supabase.auth.signOut();
    _cachedUser = null;
    // Trigger any registered logout handler (set by App.tsx via window.__logout)
    if (typeof window !== 'undefined' && (window as any).__logout) {
      (window as any).__logout();
    }
  },

  // Synchronous — reads the in-memory cache populated by login()/restoreSession().
  // Returns null until restoreSession() has resolved at least once; App.tsx
  // awaits that on boot before it will render anything that depends on it.
  getCurrentUser(): User | null {
    return _cachedUser;
  },

  getSession() {
    return supabase.auth.getSession();
  },

  // Called once on app boot (components/App.tsx) to recover an existing
  // Supabase session — e.g. after F5 — before deciding whether to show the
  // login screen or the app.
  async restoreSession(): Promise<User | null> {
    if (!isSupabaseConfigured) { _cachedUser = null; return null; }
    const { data } = await supabase.auth.getSession();
    const authUser = data.session?.user;
    if (!authUser) { _cachedUser = null; return null; }
    const user = await _loadProfile(authUser.id, authUser.email);
    _cachedUser = user;
    return user;
  },

  isAuthenticated(): boolean {
    return !!_cachedUser;
  },

  currentRole(): 'admin' | 'manager' | 'seller' | null {
    return _cachedUser ? _cachedUser.role : null;
  },

  isAdmin(): boolean {
    return AuthService.currentRole() === 'admin';
  },

  isManager(): boolean {
    const r = AuthService.currentRole();
    return r === 'manager' || r === 'admin';
  },

  // Fixed while rewriting this function for M1-B: the old version returned
  // `!!AuthService.currentRole()`, which is true for ANY authenticated user
  // (admin/manager included), not specifically a seller. Audited as unused
  // by any current call site, so this was a dormant bug, not a behavior
  // change anything relies on.
  isSeller(): boolean {
    return AuthService.currentRole() === 'seller';
  },

  // M1-F S3-B: platform_role, independente de role/companyId (um Super
  // Admin nunca tem empresa). UX/exibição apenas — nunca a autoridade real
  // (RLS + is_platform_super_admin() no banco decidem de verdade).
  isPlatformSuperAdmin(): boolean {
    return _cachedUser?.platformRole === 'super_admin';
  },
};

// ── StoreAdapter — single seam between services and data source ───────
// Future backend swap: replace internals with Supabase/API calls.
// Services never call store directly — always via StoreAdapter.

const StoreAdapter = {
  // Leads
  addLead:       (data: LeadInput)          => store.addLead(data),
  updateLead:    (id: string, ch: Partial<Lead>)  => store.updateLead(id, ch),
  getLeads:      ()                         => getStore().leads,
  getLeadById:   (id: string)              => getStore().leads.find(l => l.id === id) ?? null,
  addToTimeline: (leadId: string, entry: Omit<TimelineEntry, 'when'> & { when?: string }) =>
                   store.addToTimeline(leadId, entry),

  // Visits
  addVisit:      (data: VisitInput)         => store.addVisit(data),
  updateVisit:   (id: string, ch: Partial<Visit>) => store.updateVisit(id, ch),
  getVisits:     ()                         => getStore().visits,

  // Deals
  addDeal:       (data: DealInput)          => store.addDeal(data),
  updateDeal:    (id: string, ch: Partial<Deal>)  => store.updateDeal(id, ch),
  getDeals:      ()                         => getStore().deals,

  // Sales
  addSale:       (data: SaleInput)          => store.addSale(data),
  cancelSale:    (id: string)               => store.cancelSale(id),
  getSales:      ()                         => getStore().sales,

  // Tasks
  addTask:       (data: TaskInput)          => store.addTask(data),
  updateTask:    (id: string, ch: Partial<Task>)  => store.updateTask(id, ch),
  getTasks:      ()                         => getStore().tasks,

  // Pipeline / UI state
  setStagesOrder: (order: string[]) => store.setStagesOrder(order),

  // Company
  getCompany:    ()                             => getStore().company,
  updateCompany: (changes: Partial<Company>)    => store.updateCompany(changes),

  // System
  resetAll: () => store.resetAll(),
};

// ── Role-aware filter functions ───────────────────────────────────────

function _filteredLeads(): Lead[] {
  const u = AuthService.getCurrentUser();
  const all = StoreAdapter.getLeads();
  if (u?.role === 'seller' && u.sellerId) return all.filter(l => l.sellerId === u.sellerId);
  return all;
}

function _filteredVisits(): Visit[] {
  const u = AuthService.getCurrentUser();
  const all = StoreAdapter.getVisits();
  if (u?.role === 'seller' && u.sellerId) return all.filter(v => v.sellerId === u.sellerId);
  return all;
}

function _filteredDeals(): Deal[] {
  const u = AuthService.getCurrentUser();
  const all = StoreAdapter.getDeals();
  if (u?.role === 'seller' && u.sellerId) return all.filter(d => d.sellerId === u.sellerId);
  return all;
}

function _filteredSales(): Sale[] {
  const u = AuthService.getCurrentUser();
  const all = StoreAdapter.getSales();
  if (u?.role === 'seller' && u.sellerId) return all.filter(s => s.sellerId === u.sellerId);
  return all;
}

function _filteredTasks(): Task[] {
  const u = AuthService.getCurrentUser();
  const all = StoreAdapter.getTasks();
  if (u?.role === 'seller' && u.sellerId) {
    return all.filter(t => !t.assignedTo || t.assignedTo === u.sellerId);
  }
  return all;
}

// ── Lead Health Engine ──────────────────────────────────────────────────
// Single source of truth for how a lead's urgency/stage/alert/last react to
// real interactions. Flows must call LeadService.updateHealth() instead of
// hand-rolling their own urgency/stage/alert patches.

export type LeadHealthEvent =
  | { type: 'call'; outcome: 'visita' | 'proposta' | 'retorno' | 'naoatendeu' }
  | { type: 'visit_scheduled'; hasDate: boolean; hasTime: boolean }
  | { type: 'visit_confirmed' }
  | { type: 'visit_canceled' }
  | { type: 'visit_rescheduled' }
  | { type: 'deal_created'; needsApproval: boolean }
  | { type: 'deal_approved' }
  | { type: 'deal_rejected' }
  | { type: 'sale_registered' }
  | { type: 'sale_canceled' }
  | { type: 'visit_result_done' }
  | { type: 'visit_result_thinking' }
  | { type: 'visit_result_no_interest' };

export function calculateLeadHealth(event: LeadHealthEvent): Partial<Lead> {
  switch (event.type) {
    case 'call':
      if (event.outcome === 'visita')
        // Intent to visit only — NOT a real Visit record yet. Stage must not jump to
        // "Visita agendada" until FlowCriarVisita actually saves day+time (visit_scheduled).
        return { urgency: 'amber', stage: 'Qualificado', alert: 'Agendar visita', last: 'Aguardando agendamento' };
      if (event.outcome === 'proposta')
        return { urgency: 'amber', stage: 'Em negociação', alert: 'Montar proposta', last: 'Agora' };
      if (event.outcome === 'retorno')
        return { urgency: 'amber', alert: 'Fazer follow-up', last: 'Agora' };
      return { urgency: 'amber', alert: 'Tentar contato novamente', last: 'Agora' }; // naoatendeu

    case 'visit_scheduled':
      // Only a real, complete Visit (day + time both set) earns the "Visita agendada" stage.
      // An incomplete attempt falls back to the same pending state as the call-outcome above.
      return event.hasDate && event.hasTime
        ? { urgency: 'green', stage: 'Visita agendada', alert: 'Visita agendada', last: 'No prazo' }
        : { urgency: 'amber', stage: 'Qualificado', alert: 'Agendar visita', last: 'Aguardando agendamento' };

    case 'visit_confirmed':
      return { urgency: 'green', alert: 'Visita confirmada', last: 'Cliente confirmou presença' };

    case 'visit_canceled':
      return { urgency: 'red', alert: 'Visita cancelada — retomar contato', last: 'Cliente cancelou a visita' };

    case 'visit_rescheduled':
      return { urgency: 'amber', alert: 'Visita remarcada — confirmar novo horário', last: 'Aguardando nova confirmação' };

    case 'deal_created':
      return event.needsApproval
        ? { urgency: 'amber', stage: 'Em negociação', alert: 'Acompanhar proposta', last: 'Proposta enviada' }
        : { urgency: 'green', stage: 'Em negociação', alert: 'Proposta enviada', last: 'Aguardando resposta do cliente' };

    case 'deal_approved':
      return { urgency: 'green', alert: 'Proposta aprovada — fechar venda', last: 'Aprovada pelo gestor' };

    case 'deal_rejected':
      return { urgency: 'amber', alert: 'Renegociar proposta', last: 'Recusada pelo gestor' };

    case 'sale_registered':
      // 'Fechamento' is the existing terminal stage in STAGES (data.ts) — reused here
      // instead of a new stage value so the lead keeps showing up in the Kanban (Em progresso).
      return { urgency: 'green', stage: 'Fechamento', alert: 'Venda registrada', last: 'Concluído' };

    case 'sale_canceled':
      // Venda desfeita — lead volta para negociação em vez de ficar preso em
      // 'Fechamento' com urgência verde (Correção 2, M0-K4.2).
      return { urgency: 'amber', stage: 'Em negociação', alert: 'Venda cancelada', last: 'Retomar negociação' };

    case 'visit_result_done':
      return { urgency: 'green', stage: 'Em negociação', alert: 'Próximo passo comercial', last: 'Visita realizada' };

    case 'visit_result_thinking':
      return { urgency: 'amber', stage: 'Em negociação', alert: 'Acompanhar cliente', last: 'Cliente ficou de pensar' };

    case 'visit_result_no_interest':
      // Motivo de perda ainda não existe como campo — ver Correção 10 (decisão
      // técnica registrada, não implementada agora).
      return { urgency: 'amber', alert: 'Sem interesse no momento', last: 'Registrar motivo de perda futuramente' };

    default:
      return {};
  }
}

// ── Seam remoto de leads (M1-E, E3) ───────────────────────────────────
// Flag OFF: nada abaixo executa — caminho local 100% intacto. Flag ON: a
// leitura vem EXCLUSIVAMENTE do snapshot remoto (espelho do cache TanStack,
// design §10) e toda mutação local de leads é bloqueada com erro tipado —
// mutations remotas chegam via hooks nas fases E4+; o service nunca escreve
// no caminho remoto. Sem fallback local em nenhuma hipótese.

function _remoteLeadSnapshotOrThrow(): RemoteLeadSnapshot {
  // Identidade obtida do mecanismo real de sessão (cache do Supabase Auth via
  // AuthService) — nunca de um parâmetro vindo da UI. identityKey é o id do
  // usuário autenticado: a RLS entrega conjuntos diferentes por usuário, então
  // o snapshot de um usuário jamais serve outro, mesmo na mesma empresa.
  const user = AuthService.getCurrentUser();
  const companyId = user?.companyId ?? null;
  const identityKey = user?.id ?? null;
  if (!companyId || !identityKey) {
    throw new RemoteLeadsError('remote_leads_invalid_context', {
      operation: 'LeadService.read',
    });
  }
  const snapshot = getRemoteLeadSnapshot(companyId, identityKey);
  if (!snapshot) {
    // Snapshot ausente OU pertencente a outra identidade/empresa: estado
    // explícito, NUNCA os leads locais, NUNCA o snapshot antigo como fallback.
    throw new RemoteLeadsError('remote_leads_snapshot_unavailable', {
      operation: 'LeadService.read',
    });
  }
  return snapshot;
}

function _assertLocalLeadWriteAllowed(operation: string): void {
  if (isRemoteLeadsEnabled()) {
    // Nada acontece: store intacta, localStorage intacto, nenhuma RPC.
    throw new RemoteLeadsError('remote_leads_read_only', { operation });
  }
}

// ── LeadService ───────────────────────────────────────────────────────

export const LeadService = {
  create: (data: LeadInput) => {
    _assertLocalLeadWriteAllowed('LeadService.create');
    return StoreAdapter.addLead(data);
  },
  update: (id: string, changes: Partial<Lead>) => {
    _assertLocalLeadWriteAllowed('LeadService.update');
    return StoreAdapter.updateLead(id, changes);
  },
  updateHealth: (leadId: string, event: LeadHealthEvent) => {
    _assertLocalLeadWriteAllowed('LeadService.updateHealth');
    return StoreAdapter.updateLead(leadId, calculateLeadHealth(event));
  },
  getAll: (): Lead[] => {
    if (isRemoteLeadsEnabled()) {
      // Cópia nova a cada chamada — RLS já decidiu a visibilidade no banco;
      // nenhuma filtragem client-side por role tenta substituí-la.
      return [..._remoteLeadSnapshotOrThrow().leads];
    }
    return _filteredLeads();
  },
  getById: (id: string): Lead | null => {
    if (isRemoteLeadsEnabled()) {
      return _remoteLeadSnapshotOrThrow().leads.find(l => l.id === id) ?? null;
    }
    return StoreAdapter.getLeadById(id);
  },
  addToTimeline: (leadId: string, entry: Omit<TimelineEntry, 'when'> & { when?: string }) => {
    _assertLocalLeadWriteAllowed('LeadService.addToTimeline');
    return StoreAdapter.addToTimeline(leadId, entry);
  },
};

// ── VisitService ──────────────────────────────────────────────────────

export const VisitService = {
  create: (data: VisitInput)                    => StoreAdapter.addVisit(data),
  update: (id: string, changes: Partial<Visit>) => StoreAdapter.updateVisit(id, changes),
  getAll: ()                                    => _filteredVisits(),
};

// ── DealService ───────────────────────────────────────────────────────

export const DealService = {
  create: (data: DealInput) => StoreAdapter.addDeal({ ...data, createdByUserId: AuthService.getCurrentUser()?.id ?? null }),
  update: (id: string, changes: Partial<Deal>) => StoreAdapter.updateDeal(id, changes),
  // Only manager/admin may decide — this is the actual mutation boundary, so
  // it re-checks the role instead of trusting that the UI already hid the
  // buttons for a Seller (Correção 1, M0-K4.1: a Seller could otherwise
  // approve their own high-discount proposal by calling the flow directly).
  approve: (id: string) => {
    if (!AuthService.isManager()) return;
    StoreAdapter.updateDeal(id, {
      status: DEAL_STATUS.APPROVED,
      approvedByUserId: AuthService.getCurrentUser()?.id ?? null,
      approvedAt: new Date().toISOString(),
    });
  },
  reject: (id: string) => {
    if (!AuthService.isManager()) return;
    StoreAdapter.updateDeal(id, {
      status: DEAL_STATUS.REJECTED,
      rejectedByUserId: AuthService.getCurrentUser()?.id ?? null,
      rejectedAt: new Date().toISOString(),
    });
  },
  getAll: () => _filteredDeals(),
};

// ── SaleService ───────────────────────────────────────────────────────

export const SaleService = {
  // A Lead can have only one *active* Sale at a time (active = any status
  // other than CANCELED) — repeated clicks/re-registrations on the same
  // lead must not pile up duplicate Sales (Correção 1, M0-K4.2). A Deal
  // consumed by an active Sale is likewise protected, on top of the
  // already-SOLD check kept from M0-K4.1. Returns false and creates
  // nothing when blocked.
  create: (data: SaleInput): boolean => {
    if (data.leadId) {
      const hasActiveSale = StoreAdapter.getSales().some(
        s => s.leadId === data.leadId && s.status !== SALE_STATUS.CANCELED,
      );
      if (hasActiveSale) return false;
    }
    if (data.dealId) {
      const deal = StoreAdapter.getDeals().find(d => d.id === data.dealId);
      if (deal && deal.status === DEAL_STATUS.SOLD) return false;
      const hasActiveSaleForDeal = StoreAdapter.getSales().some(
        s => s.dealId === data.dealId && s.status !== SALE_STATUS.CANCELED,
      );
      if (hasActiveSaleForDeal) return false;
    }
    StoreAdapter.addSale(data);
    if (data.dealId) StoreAdapter.updateDeal(data.dealId, { status: DEAL_STATUS.SOLD });
    return true;
  },
  // Only manager/admin may cancel — Seller has no cancel path, not even for
  // their own sale (Correção 2, M0-K4.2; same re-check-at-the-boundary
  // pattern as DealService.approve/reject). Reverses everything the Sale
  // touched: ranking count, the linked Deal (back to APPROVED if it had
  // gestor approval on record, otherwise OPEN — using the approvedByUserId
  // audit field from M0-K4.1 instead of guessing), and the Lead's health +
  // timeline. No-ops (returns false) if already canceled, so seller.sales
  // is never decremented twice for the same sale.
  cancel: (id: string): boolean => {
    // Cancelamento reverte health e timeline do LEAD (mutação indireta) — em
    // modo remoto é bloqueado ANTES de tocar qualquer coisa, para nunca
    // deixar venda cancelada com lead intacto. SaleService.create não toca
    // leads e permanece livre.
    _assertLocalLeadWriteAllowed('SaleService.cancel');
    if (!AuthService.isManager()) return false;
    const sale = StoreAdapter.getSales().find(s => s.id === id);
    if (!sale) return false;
    const ok = StoreAdapter.cancelSale(id);
    if (!ok) return false;

    if (sale.dealId) {
      const deal = StoreAdapter.getDeals().find(d => d.id === sale.dealId);
      if (deal && deal.status === DEAL_STATUS.SOLD) {
        StoreAdapter.updateDeal(deal.id, { status: deal.approvedByUserId ? DEAL_STATUS.APPROVED : DEAL_STATUS.OPEN });
      }
    }
    if (sale.leadId) {
      StoreAdapter.updateLead(sale.leadId, calculateLeadHealth({ type: 'sale_canceled' }));
      StoreAdapter.addToTimeline(sale.leadId, { icon: 'xCircle', c: '#FF3B3B', t: 'Venda cancelada' });
    }
    return true;
  },
  getAll: () => _filteredSales(),
};

// ── TaskService ───────────────────────────────────────────────────────

export const TaskService = {
  create: (data: TaskInput)                    => StoreAdapter.addTask(data),
  update: (id: string, changes: Partial<Task>) => StoreAdapter.updateTask(id, changes),
  getAll: ()                                   => _filteredTasks(),
};

// ── SellerService ─────────────────────────────────────────────────────

export const SellerService = {
  getAll: () => getStore().sellers,
  getById: (id: string) => getStore().sellers.find(s => s.id === id) ?? null,
  getCurrentSeller: () => {
    const u = AuthService.getCurrentUser();
    if (!u?.sellerId) return null;
    return getStore().sellers.find(s => s.id === u.sellerId) ?? null;
  },
};

// ── PipelineService ───────────────────────────────────────────────────
// moveCard writes straight to lead.stage — the same field every other screen
// (Clientes, busca, perfil, Ajustes) already reads — so a Kanban move is
// visible everywhere immediately and survives F5. The old pipelineOverrides
// side-table (dead code — no screen ever read it) was removed in M0-K4.1.

export const PipelineService = {
  moveCard: (leadId: string, stage: string) => {
    // Mutação de LEAD (escreve lead.stage) — bloqueada em modo remoto até o
    // move_lead_to_stage chegar via hook (E5). reorderStages/getStages são do
    // domínio de stages e permanecem livres.
    _assertLocalLeadWriteAllowed('PipelineService.moveCard');
    return StoreAdapter.updateLead(leadId, { stage });
  },
  reorderStages: (order: string[])               => StoreAdapter.setStagesOrder(order),
  getStages:     ()                              => getStore().stages,
};

// ── CompanyService — Ajustes → Empresa ────────────────────────────────

export const CompanyService = {
  get:    ()                        => StoreAdapter.getCompany(),
  update: (changes: Partial<Company>) => StoreAdapter.updateCompany(changes),
};

// ── validateRelations (diagnostic tool) ──────────────────────────────
// Call from DevTools: import { validateRelations } from '@/lib/services'; validateRelations()

export function validateRelations(): string[] {
  const { leads, visits, deals, sales, tasks, sellers } = getStore();
  const leadIds   = new Set(leads.map(l => l.id));
  const dealIds   = new Set(deals.map(d => d.id));
  const sellerIds = new Set(sellers.map(s => s.id));
  const warnings: string[] = [];

  visits.forEach(v => {
    if (v.leadId   && !leadIds.has(v.leadId))     warnings.push(`Visit ${v.id}: orphan leadId=${v.leadId}`);
    if (v.sellerId && !sellerIds.has(v.sellerId)) warnings.push(`Visit ${v.id}: orphan sellerId=${v.sellerId}`);
  });
  deals.forEach(d => {
    if (d.leadId   && !leadIds.has(d.leadId))     warnings.push(`Deal ${d.id}: orphan leadId=${d.leadId}`);
    if (d.sellerId && !sellerIds.has(d.sellerId)) warnings.push(`Deal ${d.id}: orphan sellerId=${d.sellerId}`);
  });
  sales.forEach(s => {
    if (s.dealId   && !dealIds.has(s.dealId))     warnings.push(`Sale ${s.id}: orphan dealId=${s.dealId}`);
    if (s.leadId   && !leadIds.has(s.leadId))     warnings.push(`Sale ${s.id}: orphan leadId=${s.leadId}`);
    if (s.sellerId && !sellerIds.has(s.sellerId)) warnings.push(`Sale ${s.id}: orphan sellerId=${s.sellerId}`);
  });
  tasks.forEach(t => {
    if (t.assignedTo && !sellerIds.has(t.assignedTo)) warnings.push(`Task ${t.id}: orphan assignedTo=${t.assignedTo}`);
  });

  if (warnings.length) console.warn('[AutoCRM] Data integrity warnings:', warnings);
  else                 console.info('[AutoCRM] Data integrity: OK — all relations valid');
  return warnings;
}
