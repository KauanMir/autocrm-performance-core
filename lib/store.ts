'use client';
// store.ts — client-only module: uses localStorage and React hooks.
// Do NOT import from Server Components.
import { useState, useEffect } from 'react';
import {
  SELLERS as DEFAULT_SELLERS,
  LEADS   as DEFAULT_LEADS,
  VISITS  as DEFAULT_VISITS,
  DEALS   as DEFAULT_DEALS,
  SALES   as DEFAULT_SALES,
  TASKS   as DEFAULT_TASKS,
  STAGES  as DEFAULT_STAGES,
} from './data';
import type { Seller, Lead, Visit, Deal, Sale, Task, TimelineEntry } from './data';

// ── Input types (id is auto-generated when omitted) ───────────────────

export type LeadInput  = Omit<Lead,  'id'> & { id?: string };
export type VisitInput = Omit<Visit, 'id'> & { id?: string };
export type DealInput  = Omit<Deal,  'id'> & { id?: string };
export type SaleInput  = Omit<Sale,  'id'> & { id?: string };
export type TaskInput  = Omit<Task,  'id'> & { id?: string };

// ── State shape ───────────────────────────────────────────────────────

export interface StoreState {
  leads:             Lead[];
  visits:            Visit[];
  deals:             Deal[];
  sales:             Sale[];
  tasks:             Task[];
  sellers:           Seller[];
  stages:            string[];
  pipelineOverrides: Record<string, string>;
}

// ── Module-level singleton ────────────────────────────────────────────

let _s: StoreState = {
  leads:             [...DEFAULT_LEADS],
  visits:            [...DEFAULT_VISITS],
  deals:             [...DEFAULT_DEALS],
  sales:             [...DEFAULT_SALES],
  tasks:             [...DEFAULT_TASKS],
  sellers:           [...DEFAULT_SELLERS],
  stages:            [...DEFAULT_STAGES],
  pipelineOverrides: {},
};

let _ready = false;

// ── Subscriber pattern ────────────────────────────────────────────────

const _subs = new Set<() => void>();

export function subscribeStore(fn: () => void): () => void {
  _subs.add(fn);
  return () => { _subs.delete(fn); };
}

function _notify(): void {
  _subs.forEach(fn => fn());
}

// ── React hook ────────────────────────────────────────────────────────

export function useStore(): StoreState {
  _ensureInit();
  const [, tick] = useState(0);
  useEffect(() => subscribeStore(() => tick(n => n + 1)), []);
  return _s;
}

// ── Non-React read (for services) ─────────────────────────────────────

export function getStore(): StoreState {
  _ensureInit();
  return _s;
}

// ── localStorage keys + schema version ───────────────────────────────

const V = '2';
const K = {
  ver:      'autocrm_v',
  leads:    'autocrm_leads',
  visits:   'autocrm_visits',
  deals:    'autocrm_deals',
  sales:    'autocrm_sales',
  tasks:    'autocrm_tasks',
  sellers:  'autocrm_sellers',
  pipeline: 'autocrm_pipeline',
  stages:   'autocrm_stages',
} as const;

// ── Initialization ────────────────────────────────────────────────────

function _ensureInit(): void {
  if (_ready || typeof window === 'undefined') return;
  _ready = true;
  _hydrate();
}

function _load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function _saveAll(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(K.ver,      V);
    localStorage.setItem(K.leads,    JSON.stringify(_s.leads));
    localStorage.setItem(K.visits,   JSON.stringify(_s.visits));
    localStorage.setItem(K.deals,    JSON.stringify(_s.deals));
    localStorage.setItem(K.sales,    JSON.stringify(_s.sales));
    localStorage.setItem(K.tasks,    JSON.stringify(_s.tasks));
    localStorage.setItem(K.sellers,  JSON.stringify(_s.sellers));
    localStorage.setItem(K.pipeline, JSON.stringify(_s.pipelineOverrides));
    localStorage.setItem(K.stages,   JSON.stringify(_s.stages));
  } catch {}
}

function _clearStorage(): void {
  Object.values(K).forEach(k => { try { localStorage.removeItem(k); } catch {} });
}

// ── V1 → V2 migration: add FK fields to old saved data ───────────────

function _migrate(data: {
  leads?:   any[] | null;
  visits?:  any[] | null;
  deals?:   any[] | null;
  sales?:   any[] | null;
  tasks?:   any[] | null;
  sellers?: any[] | null;
}): typeof data {
  const nameToId: Record<string, string> = {};
  DEFAULT_SELLERS.forEach(s => { nameToId[s.name] = s.id; });

  const clientToLeadId: Record<string, string> = {};
  (data.leads || []).forEach((l: any) => { if (l.id && l.name) clientToLeadId[l.name] = l.id; });

  (data.leads || []).forEach((l: any) => {
    if (!l.sellerId && l.seller) l.sellerId = nameToId[l.seller] ?? null;
  });
  (data.visits || []).forEach((v: any) => {
    if (!v.sellerId && v.seller) v.sellerId = nameToId[v.seller] ?? null;
    if (!v.leadId)               v.leadId   = clientToLeadId[v.client] ?? null;
  });
  (data.deals || []).forEach((d: any) => {
    if (!d.sellerId && d.seller) d.sellerId = nameToId[d.seller] ?? null;
    if (!d.leadId)               d.leadId   = clientToLeadId[d.client] ?? null;
  });
  (data.sales || []).forEach((s: any) => {
    if (!s.sellerId && s.seller) s.sellerId = nameToId[s.seller] ?? null;
    if (!('leadId' in s))        s.leadId   = clientToLeadId[s.client] ?? null;
    if (!('dealId' in s))        s.dealId   = null;
  });
  (data.tasks || []).forEach((t: any) => {
    if (!t.assignedTo) {
      const lid = clientToLeadId[t.lead];
      if (lid && data.leads) {
        const lead = (data.leads as any[]).find((l: any) => l.id === lid);
        if (lead?.sellerId) t.assignedTo = lead.sellerId;
      }
    }
  });
  return data;
}

function _hydrate(): void {
  const ver = _load<string | null>(K.ver, null);

  if (ver === V) {
    const leads   = _load<Lead[]   | null>(K.leads,   null); if (leads)   _s.leads   = leads;
    const visits  = _load<Visit[]  | null>(K.visits,  null); if (visits)  _s.visits  = visits;
    const deals   = _load<Deal[]   | null>(K.deals,   null); if (deals)   _s.deals   = deals;
    const sales   = _load<Sale[]   | null>(K.sales,   null); if (sales)   _s.sales   = sales;
    const tasks   = _load<Task[]   | null>(K.tasks,   null); if (tasks)   _s.tasks   = tasks;
    const sellers = _load<Seller[] | null>(K.sellers, null); if (sellers) _s.sellers = sellers;
    _s.pipelineOverrides = _load(K.pipeline, {});
    _s.stages            = _load(K.stages,   [...DEFAULT_STAGES]);

  } else if (ver === '1') {
    // Migrate V1 data: add FK fields that were missing
    const m = _migrate({
      leads:   _load(K.leads,   null),
      visits:  _load(K.visits,  null),
      deals:   _load(K.deals,   null),
      sales:   _load(K.sales,   null),
      tasks:   _load(K.tasks,   null),
      sellers: _load(K.sellers, null),
    });
    if (m.leads)   _s.leads   = m.leads;
    if (m.visits)  _s.visits  = m.visits;
    if (m.deals)   _s.deals   = m.deals;
    if (m.sales)   _s.sales   = m.sales;
    if (m.tasks)   _s.tasks   = m.tasks;
    if (m.sellers) _s.sellers = m.sellers;
    _s.pipelineOverrides = _load(K.pipeline, {});
    _s.stages            = _load(K.stages,   [...DEFAULT_STAGES]);
    _saveAll(); // persist as V2

  } else {
    // First run or unknown schema — start fresh from defaults
    if (ver !== null) _clearStorage();
    _s.pipelineOverrides = {};
    _s.stages = [...DEFAULT_STAGES];
    _saveAll();
  }
}

// ── Helper: find by id and apply changes in-place ────────────────────

function _patch<T extends { id: string }>(arr: T[], id: string, changes: Partial<T>): void {
  const idx = arr.findIndex(item => item.id === id);
  if (idx >= 0) Object.assign(arr[idx], changes);
}

// ── Mutation API ──────────────────────────────────────────────────────

export const store = {

  // LEADS
  addLead(lead: LeadInput): void {
    _ensureInit();
    if (!lead.id)       lead.id       = 'l' + Date.now();
    if (!lead.timeline) lead.timeline = [];
    _s.leads.unshift(lead as Lead);
    _saveAll(); _notify();
  },
  updateLead(id: string, changes: Partial<Lead>): void {
    _ensureInit();
    _patch(_s.leads, id, changes);
    _saveAll(); _notify();
  },

  // VISITS
  addVisit(visit: VisitInput): void {
    _ensureInit();
    if (!visit.id) visit.id = 'v' + Date.now();
    _s.visits.unshift(visit as Visit);
    _saveAll(); _notify();
  },
  updateVisit(id: string, changes: Partial<Visit>): void {
    _ensureInit();
    _patch(_s.visits, id, changes);
    _saveAll(); _notify();
  },

  // DEALS
  addDeal(deal: DealInput): void {
    _ensureInit();
    if (!deal.id) deal.id = 'd' + Date.now();
    _s.deals.unshift(deal as Deal);
    _saveAll(); _notify();
  },
  updateDeal(id: string, changes: Partial<Deal>): void {
    _ensureInit();
    _patch(_s.deals, id, changes);
    _saveAll(); _notify();
  },

  // SALES
  addSale(sale: SaleInput): void {
    _ensureInit();
    if (!sale.id) sale.id = 'sa' + Date.now();
    _s.sales.unshift(sale as Sale);
    // Increment seller ranking count
    if (sale.sellerId) {
      const seller = _s.sellers.find(s => s.id === sale.sellerId);
      if (seller) seller.sales = (seller.sales || 0) + 1;
    }
    _saveAll(); _notify();
  },

  // TASKS
  addTask(task: TaskInput): void {
    _ensureInit();
    if (!task.id) task.id = 't' + Date.now();
    _s.tasks.unshift(task as Task);
    _saveAll(); _notify();
  },
  updateTask(id: string, changes: Partial<Task>): void {
    _ensureInit();
    _patch(_s.tasks, id, changes);
    _saveAll(); _notify();
  },

  // LEAD TIMELINE
  addToTimeline(leadId: string, entry: Omit<TimelineEntry, 'when'> & { when?: string }): void {
    _ensureInit();
    const lead = _s.leads.find(l => l.id === leadId);
    if (lead) {
      if (!lead.timeline) lead.timeline = [];
      lead.timeline.unshift({ when: 'Agora', ...entry } as TimelineEntry);
      _saveAll(); _notify();
    }
  },

  // PIPELINE
  setPipelineOverride(leadId: string, stage: string): void {
    _ensureInit();
    _s.pipelineOverrides[leadId] = stage;
    _saveAll(); _notify();
  },

  // STAGES ORDER
  setStagesOrder(order: string[]): void {
    _ensureInit();
    _s.stages = order;
    _saveAll(); _notify();
  },

  // RESET
  resetAll(): void {
    _clearStorage();
    if (typeof window !== 'undefined') window.location.reload();
  },
};
