// Testes do seam remoto no LeadService (M1-E, E3).
// Store REAL (localStorage do jsdom), flag mockada e controlável, Supabase
// mockado com spies para provar que mutação bloqueada nunca chama rede.
// Cada teste mede deltas localmente — nenhuma dependência de ordem.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/data';
import { getStore } from '@/lib/store';
import {
  AuthService,
  CompanyService,
  DealService,
  LeadService,
  PipelineService,
  SaleService,
  TaskService,
  VisitService,
} from '@/lib/services';
import { isRemoteLeadsError } from '@/lib/leads/errors';
import {
  buildRemoteLeadSnapshot,
  clearAllRemoteLeadSnapshots,
  setRemoteLeadSnapshot,
  type RemoteLeadSnapshotOwner,
} from '@/lib/leads/remoteSnapshot';
import type { LeadAdapterContext } from '@/lib/leads/adapter';
import type { LeadRow } from '@/lib/supabase/types';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  isRemoteLeadsEnabled: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc, auth: { signOut: vi.fn() } },
  isSupabaseConfigured: false,
}));

vi.mock('@/lib/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/flags')>();
  return { ...actual, isRemoteLeadsEnabled: mocks.isRemoteLeadsEnabled };
});

const ADMIN: User = {
  id: 'user-1',
  name: 'Admin Teste',
  email: 'admin@teste.dev',
  role: 'admin',
  sellerId: null,
  companyId: 'company-a',
};

function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'remote-lead-1',
    company_id: 'company-a',
    name: 'Cliente Remoto',
    phone: '(11) 90000-0000',
    phone_digits: '11900000000',
    car: 'Golf GTI 2022',
    stage_id: 'stage-new',
    seller_id: null,
    urgency: 'red',
    temperature: null,
    last_activity_label: 'Sem contato ainda',
    alert_label: 'Fazer primeiro contato',
    payment_preference: null,
    value_amount: null,
    source: null,
    created_by_profile_id: null,
    updated_by_profile_id: null,
    archived_at: null,
    version: 1,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-19T12:00:00+00:00',
    ...overrides,
  };
}

const CONTEXT: LeadAdapterContext = {
  stagesById: {
    'stage-new': { id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0, isTerminal: false },
  },
  sellersById: {},
};

const ADMIN_OWNER: RemoteLeadSnapshotOwner = { companyId: 'company-a', identityKey: ADMIN.id };

function setSnapshotFor(owner: RemoteLeadSnapshotOwner, rows: LeadRow[]): void {
  setRemoteLeadSnapshot(buildRemoteLeadSnapshot(rows, CONTEXT, owner));
}

beforeEach(() => {
  mocks.isRemoteLeadsEnabled.mockReturnValue(false);
  vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue(ADMIN);
  // isManager lê o cache privado de login (não passa por getCurrentUser) —
  // espiado para o caminho de SaleService.cancel, que re-checa o role.
  vi.spyOn(AuthService, 'isManager').mockReturnValue(true);
});

afterEach(() => {
  clearAllRemoteLeadSnapshots();
});

// ── A. Flag OFF — caminho legado intacto ─────────────────────────────────

describe('seam — flag OFF preserva o comportamento local', () => {
  it('getAll/getById continuam lendo da store local', () => {
    const all = LeadService.getAll();
    expect(all.length).toBeGreaterThan(0);
    expect(LeadService.getById(all[0].id)).toEqual(all[0]);
  });

  it('mutações locais continuam funcionando (create/update/health/timeline/moveCard)', () => {
    const before = getStore().leads.length;
    LeadService.create({
      id: 'seam-local-1', name: 'Local', phone: '(11) 91111-1111', car: 'Onix',
      stage: 'Novo', seller: '—', sellerId: null, urgency: 'red',
      last: 'Sem contato ainda', alert: 'Fazer primeiro contato', pay: '—', value: '—',
    });
    expect(getStore().leads.length).toBe(before + 1);

    LeadService.update('seam-local-1', { car: 'Onix Plus' });
    expect(LeadService.getById('seam-local-1')?.car).toBe('Onix Plus');

    LeadService.updateHealth('seam-local-1', { type: 'visit_confirmed' });
    expect(LeadService.getById('seam-local-1')?.urgency).toBe('green');

    LeadService.addToTimeline('seam-local-1', { icon: 'phone', c: '#fff', t: 'Ligação' });
    expect(LeadService.getById('seam-local-1')?.timeline?.length).toBe(1);

    PipelineService.moveCard('seam-local-1', 'Qualificado');
    expect(LeadService.getById('seam-local-1')?.stage).toBe('Qualificado');
  });

  it('SaleService.cancel local continua funcionando', () => {
    expect(SaleService.create({
      id: 'seam-sale-off', client: 'X', car: 'Y', value: 'R$ 1', seller: 'Marcos Silva',
      sellerId: 's1', leadId: null, dealId: null, date: 'hoje', status: 'aguardando', pay: '—',
    })).toBe(true);
    expect(SaleService.cancel('seam-sale-off')).toBe(true);
  });
});

// ── B. Flag ON — leitura exclusiva do snapshot ───────────────────────────

describe('seam — flag ON lê somente o snapshot remoto', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
  });

  it('snapshot populado ⇒ getAll retorna somente os leads remotos', () => {
    setSnapshotFor(ADMIN_OWNER, [leadRow({ id: 'r1' }), leadRow({ id: 'r2' })]);
    const all = LeadService.getAll();
    expect(all.map((l) => l.id)).toEqual(['r1', 'r2']);
    // Nenhum lead local misturado (seeds locais têm ids 'l1'..'l12').
    expect(all.some((l) => l.id.startsWith('l'))).toBe(false);
  });

  it('snapshot vazio ⇒ lista vazia, NUNCA os leads locais', () => {
    setSnapshotFor(ADMIN_OWNER, []);
    expect(LeadService.getAll()).toEqual([]);
    expect(getStore().leads.length).toBeGreaterThan(0); // locais existem, mas não vazam
  });

  it('sem snapshot ⇒ erro explícito remote_leads_snapshot_unavailable (sem fallback)', () => {
    const caught = ((): unknown => {
      try { LeadService.getAll(); } catch (e) { return e; }
      return null;
    })();
    expect(isRemoteLeadsError(caught)).toBe(true);
    if (isRemoteLeadsError(caught)) expect(caught.code).toBe('remote_leads_snapshot_unavailable');
  });

  it('snapshot de OUTRA empresa nunca é servido', () => {
    setSnapshotFor({ companyId: 'company-b', identityKey: ADMIN.id }, [leadRow({ id: 'rb' })]);
    expect(() => LeadService.getAll()).toThrow('remote_leads_snapshot_unavailable');
  });

  it('troca admin → seller da MESMA empresa não reutiliza o snapshot do admin', () => {
    const before = JSON.stringify(getStore().leads);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setSnapshotFor(ADMIN_OWNER, [leadRow({ id: 'r-admin' })]);

    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue({
      ...ADMIN, id: 'user-seller-1', role: 'seller', sellerId: 's1',
    });
    const caught = ((): unknown => {
      try { LeadService.getAll(); } catch (e) { return e; }
      return null;
    })();
    expect(isRemoteLeadsError(caught)).toBe(true);
    if (isRemoteLeadsError(caught)) expect(caught.code).toBe('remote_leads_snapshot_unavailable');
    // Mismatch não recorre a leads locais nem toca store/localStorage.
    expect(JSON.stringify(getStore().leads)).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('troca seller A → seller B da mesma empresa não reutiliza snapshot', () => {
    setSnapshotFor({ companyId: 'company-a', identityKey: 'user-seller-1' }, [leadRow({ id: 'r-a' })]);
    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue({
      ...ADMIN, id: 'user-seller-2', role: 'seller', sellerId: 's2',
    });
    expect(() => LeadService.getAll()).toThrow('remote_leads_snapshot_unavailable');
  });

  it('logout (sem usuário) nunca acessa o snapshot anterior', () => {
    setSnapshotFor(ADMIN_OWNER, [leadRow({ id: 'r1' })]);
    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue(null);
    expect(() => LeadService.getAll()).toThrow('remote_leads_invalid_context');
  });

  it('sem companyId na sessão ⇒ remote_leads_invalid_context', () => {
    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue({ ...ADMIN, companyId: null });
    expect(() => LeadService.getAll()).toThrow('remote_leads_invalid_context');
  });

  it('getById busca no snapshot; id desconhecido devolve null', () => {
    setSnapshotFor(ADMIN_OWNER, [leadRow({ id: 'r1' })]);
    expect(LeadService.getById('r1')?.name).toBe('Cliente Remoto');
    expect(LeadService.getById('nao-existe')).toBeNull();
  });

  it('getAll devolve cópia nova — mutar o retorno não afeta o snapshot', () => {
    setSnapshotFor(ADMIN_OWNER, [leadRow({ id: 'r1' })]);
    const first = LeadService.getAll();
    first.pop();
    expect(LeadService.getAll()).toHaveLength(1);
  });
});

// ── C. Flag ON — mutações de leads bloqueadas ────────────────────────────

describe('seam — flag ON bloqueia toda mutação local de leads', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    getStore(); // garante hydration ANTES dos spies de localStorage
  });

  const blockedCalls: Array<[string, () => unknown]> = [
    ['LeadService.create', () => LeadService.create({
      name: 'X', phone: '1', car: 'Y', stage: 'Novo', seller: '—', sellerId: null,
      urgency: 'red', last: '-', alert: '-', pay: '-', value: '—',
    })],
    ['LeadService.update', () => LeadService.update('l1', { car: 'Hack' })],
    ['LeadService.updateHealth', () => LeadService.updateHealth('l1', { type: 'visit_confirmed' })],
    ['LeadService.addToTimeline', () => LeadService.addToTimeline('l1', { icon: 'x', c: '#fff', t: 'T' })],
    ['PipelineService.moveCard', () => PipelineService.moveCard('l1', 'Fechamento')],
    ['SaleService.cancel', () => SaleService.cancel('sa1')],
  ];

  for (const [name, call] of blockedCalls) {
    it(`${name} lança remote_leads_read_only sem tocar store/localStorage/Supabase`, () => {
      const leadsBefore = JSON.stringify(getStore().leads);
      const salesBefore = JSON.stringify(getStore().sales);
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      const caught = ((): unknown => {
        try { call(); } catch (e) { return e; }
        return null;
      })();

      expect(isRemoteLeadsError(caught)).toBe(true);
      if (isRemoteLeadsError(caught)) {
        expect(caught.code).toBe('remote_leads_read_only');
        expect(caught.detail.operation).toBe(name);
      }
      expect(JSON.stringify(getStore().leads)).toBe(leadsBefore);
      expect(JSON.stringify(getStore().sales)).toBe(salesBefore);
      expect(setItem).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }
});

// ── D. Flag ON — outros domínios permanecem livres ───────────────────────

describe('seam — flag ON NÃO bloqueia domínios fora de leads', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
  });

  it('visits, deals, sales.create, tasks, reorderStages e company seguem funcionando', () => {
    const s = getStore();
    const visitsBefore = s.visits.length;
    const dealsBefore = s.deals.length;
    const salesBefore = s.sales.length;
    const tasksBefore = s.tasks.length;

    VisitService.create({
      id: 'seam-v1', time: '10:00', client: 'C', seller: 'Marcos Silva', sellerId: 's1',
      leadId: null, car: 'Onix', status: 'confirmada', day: 'Hoje',
    });
    DealService.create({
      id: 'seam-d1', client: 'C', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva',
      sellerId: 's1', leadId: null, status: 'aberta', last: 'hoje',
    });
    SaleService.create({
      id: 'seam-sa1', client: 'C', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva',
      sellerId: 's1', leadId: null, dealId: null, date: 'hoje', status: 'aguardando', pay: '—',
    });
    TaskService.create({
      id: 'seam-t1', title: 'Ligar para C', lead: 'C', leadId: null, assignedTo: 's1',
      when: 'hoje', prio: 'alta', state: 'hoje', note: 'seam',
    });
    PipelineService.reorderStages(['Fechamento', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação']);
    CompanyService.update({ name: 'AutoCRM Teste' });

    expect(getStore().visits.length).toBe(visitsBefore + 1);
    expect(getStore().deals.length).toBe(dealsBefore + 1);
    expect(getStore().sales.length).toBe(salesBefore + 1);
    expect(getStore().tasks.length).toBe(tasksBefore + 1);
    expect(getStore().stages[0]).toBe('Fechamento');
    expect(getStore().company.name).toBe('AutoCRM Teste');
  });
});
