// services.ts — Backend abstraction layer.
// Components, screens and flows must call Services — never access the store or
// localStorage directly. When a real backend arrives, only StoreAdapter changes.
import { USERS } from './data';
import type { User, Lead, Visit, Deal, Sale, Task, TimelineEntry } from './data';
import { store, getStore } from './store';
import type { LeadInput, VisitInput, DealInput, SaleInput, TaskInput } from './store';

// ── Session ───────────────────────────────────────────────────────────

const SESSION_KEY = 'acrm_session';

interface Session {
  userId: string;
  role: 'admin' | 'manager' | 'seller';
  sellerId: string | null;
}

function _readSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw || raw === '1') return null; // '1' is legacy pre-M0 format
    const s = JSON.parse(raw);
    return (s && s.userId) ? s : null;
  } catch { return null; }
}

// ── AuthService ───────────────────────────────────────────────────────

export const AuthService = {
  login(email: string, password: string): User | null {
    const user = USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password,
    ) ?? null;
    if (user) {
      try {
        const session: Session = { userId: user.id, role: user.role, sellerId: user.sellerId };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {}
    }
    return user;
  },

  logout(): void {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    // Trigger any registered logout handler (set by App.tsx via window.__logout)
    if (typeof window !== 'undefined' && (window as any).__logout) {
      (window as any).__logout();
    }
  },

  getCurrentUser(): User | null {
    const s = _readSession();
    if (!s) return null;
    return USERS.find(u => u.id === s.userId) ?? null;
  },

  currentRole(): 'admin' | 'manager' | 'seller' | null {
    const u = AuthService.getCurrentUser();
    return u ? u.role : null;
  },

  isAdmin(): boolean {
    return AuthService.currentRole() === 'admin';
  },

  isManager(): boolean {
    const r = AuthService.currentRole();
    return r === 'manager' || r === 'admin';
  },

  isSeller(): boolean {
    return !!AuthService.currentRole();
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
  getSales:      ()                         => getStore().sales,

  // Tasks
  addTask:       (data: TaskInput)          => store.addTask(data),
  updateTask:    (id: string, ch: Partial<Task>)  => store.updateTask(id, ch),
  getTasks:      ()                         => getStore().tasks,

  // Pipeline / UI state
  setPipelineOverride: (leadId: string, stage: string) => store.setPipelineOverride(leadId, stage),
  setStagesOrder:      (order: string[])               => store.setStagesOrder(order),

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
  | { type: 'deal_created'; needsApproval: boolean }
  | { type: 'sale_registered' };

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

    case 'deal_created':
      return event.needsApproval
        ? { urgency: 'amber', stage: 'Em negociação', alert: 'Acompanhar proposta', last: 'Proposta enviada' }
        : { urgency: 'green', stage: 'Em negociação', alert: 'Proposta enviada', last: 'Aguardando resposta do cliente' };

    case 'sale_registered':
      // 'Fechamento' is the existing terminal stage in STAGES (data.ts) — reused here
      // instead of a new stage value so the lead keeps showing up in the Kanban (Em progresso).
      return { urgency: 'green', stage: 'Fechamento', alert: 'Venda registrada', last: 'Concluído' };

    default:
      return {};
  }
}

// ── LeadService ───────────────────────────────────────────────────────

export const LeadService = {
  create:        (data: LeadInput)                      => StoreAdapter.addLead(data),
  update:        (id: string, changes: Partial<Lead>)   => StoreAdapter.updateLead(id, changes),
  updateHealth:  (leadId: string, event: LeadHealthEvent) => StoreAdapter.updateLead(leadId, calculateLeadHealth(event)),
  getAll:        ()                                     => _filteredLeads(),
  getById:       (id: string)                           => StoreAdapter.getLeadById(id),
  addToTimeline: (leadId: string, entry: Omit<TimelineEntry, 'when'> & { when?: string }) =>
                   StoreAdapter.addToTimeline(leadId, entry),
};

// ── VisitService ──────────────────────────────────────────────────────

export const VisitService = {
  create: (data: VisitInput)                    => StoreAdapter.addVisit(data),
  update: (id: string, changes: Partial<Visit>) => StoreAdapter.updateVisit(id, changes),
  getAll: ()                                    => _filteredVisits(),
};

// ── DealService ───────────────────────────────────────────────────────

export const DealService = {
  create:  (data: DealInput)                   => StoreAdapter.addDeal(data),
  update:  (id: string, changes: Partial<Deal>) => StoreAdapter.updateDeal(id, changes),
  approve: (id: string)                         => StoreAdapter.updateDeal(id, { status: 'aprovada' }),
  reject:  (id: string)                         => StoreAdapter.updateDeal(id, { status: 'recusada' }),
  getAll:  ()                                   => _filteredDeals(),
};

// ── SaleService ───────────────────────────────────────────────────────

export const SaleService = {
  create: (data: SaleInput) => StoreAdapter.addSale(data),
  getAll: ()                => _filteredSales(),
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

export const PipelineService = {
  moveCard:      (leadId: string, stage: string) => StoreAdapter.setPipelineOverride(leadId, stage),
  reorderStages: (order: string[])               => StoreAdapter.setStagesOrder(order),
  getOverrides:  ()                              => getStore().pipelineOverrides,
  getStages:     ()                              => getStore().stages,
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
