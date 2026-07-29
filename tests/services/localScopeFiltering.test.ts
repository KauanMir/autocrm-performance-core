// M1-F S8-D2-A: cobertura dedicada do escopo local M0 (Tasks/Visits/Deals/
// Sales/Leads mock + SellerService.getCurrentSeller) após a migração de
// User.role/User.sellerId para activeMembership.role/activeMembership.
// sellerId. Store REAL (localStorage do jsdom, seed de lib/data.ts) —
// nenhuma dependência de ordem entre testes (cada um só lê, nunca muta).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/data';
import {
  AuthService,
  TaskService,
  VisitService,
  DealService,
  SaleService,
  LeadService,
  SellerService,
} from '@/lib/services';

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { signOut: vi.fn() } },
  isSupabaseConfigured: false,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: () => false };
});

function baseUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', name: 'Teste', email: 'teste@a.com', ...overrides };
}

function setUser(user: User | null) {
  vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue(user);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('escopo local M0 — Manager', () => {
  beforeEach(() => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } }));
  });

  it('Manager vê todos os Leads/Visits/Deals/Sales/Tasks locais, sem filtro por sellerId', () => {
    expect(LeadService.getAll().some((l) => l.sellerId === 's1')).toBe(true);
    expect(LeadService.getAll().some((l) => l.sellerId === 's2')).toBe(true);
    expect(VisitService.getAll().length).toBeGreaterThan(1);
    expect(DealService.getAll().length).toBeGreaterThan(1);
    expect(SaleService.getAll().length).toBeGreaterThan(0);
    expect(TaskService.getAll().length).toBeGreaterThan(0);
  });

  it('SellerService.getCurrentSeller: null (Manager não tem seller próprio, por definição)', () => {
    expect(SellerService.getCurrentSeller()).toBeNull();
  });
});

describe('escopo local M0 — Seller com sellerId válido', () => {
  it('Seller vê SOMENTE seus próprios Leads/Visits/Deals/Sales (nunca dados de outro Seller)', () => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }));
    const leads = LeadService.getAll();
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.sellerId === 's1')).toBe(true);

    const visits = VisitService.getAll();
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((v) => v.sellerId === 's1')).toBe(true);

    const deals = DealService.getAll();
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d) => d.sellerId === 's1')).toBe(true);

    const sales = SaleService.getAll();
    expect(sales.length).toBeGreaterThan(0);
    expect(sales.every((s) => s.sellerId === 's1')).toBe(true);
  });

  it('Seller B nunca vê os dados do Seller A (troca de identidade muda o recorte inteiro)', () => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }));
    const leadsA = LeadService.getAll().map((l) => l.id).sort();

    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's2' } }));
    const leadsB = LeadService.getAll().map((l) => l.id).sort();

    expect(leadsA).not.toEqual(leadsB);
    expect(LeadService.getAll().every((l) => l.sellerId === 's2')).toBe(true);
  });

  it('Tasks: não-atribuídas continuam visíveis a qualquer Seller, mas atribuídas a outro Seller nunca aparecem', () => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }));
    const tasks = TaskService.getAll();
    expect(tasks.every((t) => !t.assignedTo || t.assignedTo === 's1')).toBe(true);
  });

  it('SellerService.getCurrentSeller: retorna a linha real do próprio Seller', () => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }));
    expect(SellerService.getCurrentSeller()?.id).toBe('s1');
  });

  it('transferência: sellerId novo da empresa de destino decide o recorte, nunca o antigo', () => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }));
    const before = LeadService.getAll().map((l) => l.id).sort();

    // Mesma sessão, membership transferida: sellerId muda para o da empresa nova.
    setUser(baseUser({ activeMembership: { companyId: 'company-b', role: 'seller', sellerId: 's2' } }));
    const after = LeadService.getAll().map((l) => l.id).sort();

    expect(after).not.toEqual(before);
    expect(LeadService.getAll().every((l) => l.sellerId === 's2')).toBe(true);
  });
});

describe('escopo local M0 — Seller SEM linha válida em sellers (M1-F S8-D2-A, decisão #8)', () => {
  beforeEach(() => {
    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } }));
  });

  it('Leads/Visits/Deals/Sales/Tasks locais: listas vazias, nunca todos os dados', () => {
    expect(LeadService.getAll()).toEqual([]);
    expect(VisitService.getAll()).toEqual([]);
    expect(DealService.getAll()).toEqual([]);
    expect(SaleService.getAll()).toEqual([]);
    expect(TaskService.getAll()).toEqual([]);
  });

  it('SellerService.getCurrentSeller: null (nunca inventa, nunca usa profile.id/membership.id)', () => {
    expect(SellerService.getCurrentSeller()).toBeNull();
  });
});

describe('escopo local M0 — Super Admin', () => {
  it('Super Admin vê tudo, mesmo sem activeMembership (identidade global via platformRole)', () => {
    setUser(baseUser({ platformRole: 'super_admin', activeMembership: null }));
    expect(LeadService.getAll().length).toBeGreaterThan(1);
    expect(VisitService.getAll().length).toBeGreaterThan(1);
    expect(DealService.getAll().length).toBeGreaterThan(1);
    expect(SaleService.getAll().length).toBeGreaterThan(0);
    expect(TaskService.getAll().length).toBeGreaterThan(0);
  });

  it('SellerService.getCurrentSeller: null (Super Admin nunca tem seller próprio)', () => {
    setUser(baseUser({ platformRole: 'super_admin', activeMembership: null }));
    expect(SellerService.getCurrentSeller()).toBeNull();
  });
});

describe('escopo local M0 — sem identidade empresarial atual (decisão humana S8-D2-A)', () => {
  it('nem platformRole nem activeMembership: todas as listas locais vazias — cobre membership suspensa/offboarded/sessão residual', () => {
    setUser(baseUser({ platformRole: null, activeMembership: null }));
    expect(LeadService.getAll()).toEqual([]);
    expect(VisitService.getAll()).toEqual([]);
    expect(DealService.getAll()).toEqual([]);
    expect(SaleService.getAll()).toEqual([]);
    expect(TaskService.getAll()).toEqual([]);
    expect(SellerService.getCurrentSeller()).toBeNull();
  });

  it('membership suspensa (activeMembership null) de um ex-Seller: nenhuma informação do Seller anterior', () => {
    setUser(baseUser({ activeMembership: null }));
    expect(LeadService.getAll()).toEqual([]);
    expect(SellerService.getCurrentSeller()).toBeNull();
  });

  it('reativação: assim que activeMembership volta, o Seller recupera o filtro pelo sellerId real', () => {
    setUser(baseUser({ activeMembership: null }));
    expect(LeadService.getAll()).toEqual([]);

    setUser(baseUser({ activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' } }));
    const leads = LeadService.getAll();
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.sellerId === 's1')).toBe(true);
  });

  it('usuário null (sem sessão): todas as listas locais vazias', () => {
    setUser(null);
    expect(LeadService.getAll()).toEqual([]);
    expect(TaskService.getAll()).toEqual([]);
    expect(SellerService.getCurrentSeller()).toBeNull();
  });
});
