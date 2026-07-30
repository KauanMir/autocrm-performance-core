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
import { isLocalCommercialDataDisabledError } from '@/lib/leads/localCommercialAccess';
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

// M1-F S8-B2: activeMembership adicionada — todo teste deste arquivo
// representa o MESMO admin empresarial autenticado, com acesso real à
// Empresa A (nenhum cenário aqui testa ausência de membership por padrão;
// os que testam isso de propósito sobrescrevem activeMembership
// explicitamente).
const ADMIN: User = {
  id: 'user-1',
  name: 'Admin Teste',
  email: 'admin@teste.dev',
  activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
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
      ...ADMIN, id: 'user-seller-1',
      activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's1' },
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
      ...ADMIN, id: 'user-seller-2',
      activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 's2' },
    });
    expect(() => LeadService.getAll()).toThrow('remote_leads_snapshot_unavailable');
  });

  it('logout (sem usuário) nunca acessa o snapshot anterior', () => {
    setSnapshotFor(ADMIN_OWNER, [leadRow({ id: 'r1' })]);
    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue(null);
    expect(() => LeadService.getAll()).toThrow('remote_leads_invalid_context');
  });

  it('M1-F S8-B2: usuário SEM membership ativa ⇒ remote_leads_invalid_context', () => {
    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue({
      ...ADMIN, activeMembership: null,
    });
    expect(() => LeadService.getAll()).toThrow('remote_leads_invalid_context');
  });

  // M1-F S8-D1: User.companyId legado foi removido do tipo — o cenário
  // "companyId legado diferente da membership ativa" deixou de ser
  // representável (nada além de activeMembership.companyId existe mais para
  // resolver a empresa). Esta prova ficou redundante com os testes de troca
  // de identidade acima (linhas 187/207) e foi removida.

  it('M1-F S8-B2: Super Admin sem activeMembership não ganha empresa por acidente ⇒ remote_leads_invalid_context', () => {
    vi.spyOn(AuthService, 'getCurrentUser').mockReturnValue({
      ...ADMIN, platformRole: 'super_admin', activeMembership: null,
    });
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

  // M1-E E5-B2-A1: SaleService.cancel saiu desta lista — passou a usar
  // assertLocalCommercialDataAllowed (LocalCommercialDataDisabledError,
  // remote_commercial_local_data_disabled), não mais
  // _assertLocalLeadWriteAllowed/RemoteLeadsError. Testado separadamente
  // abaixo (describe "flag ON bloqueia módulos comerciais locais").
  const blockedCalls: Array<[string, () => unknown]> = [
    ['LeadService.create', () => LeadService.create({
      name: 'X', phone: '1', car: 'Y', stage: 'Novo', seller: '—', sellerId: null,
      urgency: 'red', last: '-', alert: '-', pay: '-', value: '—',
    })],
    ['LeadService.update', () => LeadService.update('l1', { car: 'Hack' })],
    ['LeadService.updateHealth', () => LeadService.updateHealth('l1', { type: 'visit_confirmed' })],
    ['LeadService.addToTimeline', () => LeadService.addToTimeline('l1', { icon: 'x', c: '#fff', t: 'T' })],
    ['PipelineService.moveCard', () => PipelineService.moveCard('l1', 'Fechamento')],
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

// ── D. Flag ON — reorderStages e company permanecem livres ──────────────

describe('seam — flag ON NÃO bloqueia domínios fora de leads/comercial local', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
  });

  it('reorderStages e company seguem funcionando (nunca fizeram parte do isolamento comercial)', () => {
    PipelineService.reorderStages(['Fechamento', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação']);
    CompanyService.update({ name: 'AutoCRM Teste' });

    expect(getStore().stages[0]).toBe('Fechamento');
    expect(getStore().company.name).toBe('AutoCRM Teste');
  });
});

// ── E. Flag ON — módulos comerciais locais (Visit/Deal/Sale/Task) bloqueados
// (M1-E E5-B2-A1) ─────────────────────────────────────────────────────────
// Achado da auditoria E5-B2-A0: Visit/Deal/Sale/Task não têm company_id nem
// backend remoto — mantê-los graváveis sob flag ON (comportamento antigo,
// coberto no describe acima até esta etapa) arriscava registros órfãos
// referenciando um Lead que só existe no Supabase. Bloqueados via
// assertLocalCommercialDataAllowed, ANTES de qualquer acesso ao
// StoreAdapter — nunca RemoteLeadsError (isRemoteLeadsError continua
// exclusivo do domínio de Lead).

describe('seam — flag ON bloqueia módulos comerciais locais (Visit/Deal/Sale/Task)', () => {
  beforeEach(() => {
    mocks.isRemoteLeadsEnabled.mockReturnValue(true);
    getStore();
  });

  const blockedCommercialCalls: Array<[string, () => unknown]> = [
    ['VisitService.create', () => VisitService.create({
      time: '10:00', client: 'C', seller: 'Marcos Silva', sellerId: 's1',
      leadId: null, car: 'Onix', status: 'confirmada', day: 'Hoje',
    })],
    ['VisitService.update', () => VisitService.update('v1', { status: 'confirmada' })],
    ['VisitService.getAll', () => VisitService.getAll()],
    ['DealService.create', () => DealService.create({
      client: 'C', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva',
      sellerId: 's1', leadId: null, status: 'aberta', last: 'hoje',
    })],
    ['DealService.update', () => DealService.update('d1', { last: 'hoje' })],
    ['DealService.approve', () => DealService.approve('d1')],
    ['DealService.reject', () => DealService.reject('d1')],
    ['DealService.getAll', () => DealService.getAll()],
    ['SaleService.create', () => SaleService.create({
      client: 'C', car: 'Onix', value: 'R$ 1', seller: 'Marcos Silva',
      sellerId: 's1', leadId: null, dealId: null, date: 'hoje', status: 'aguardando', pay: '—',
    })],
    ['SaleService.cancel', () => SaleService.cancel('sa1')],
    ['SaleService.getAll', () => SaleService.getAll()],
    ['TaskService.create', () => TaskService.create({
      title: 'Ligar para C', lead: 'C', leadId: null, assignedTo: 's1',
      when: 'hoje', prio: 'alta', state: 'hoje', note: 'seam',
    })],
    ['TaskService.update', () => TaskService.update('t1', { note: 'x' })],
    ['TaskService.getAll', () => TaskService.getAll()],
  ];

  for (const [name, call] of blockedCommercialCalls) {
    it(`${name} lança remote_commercial_local_data_disabled sem tocar store/localStorage/Supabase`, () => {
      const visitsBefore = JSON.stringify(getStore().visits);
      const dealsBefore = JSON.stringify(getStore().deals);
      const salesBefore = JSON.stringify(getStore().sales);
      const tasksBefore = JSON.stringify(getStore().tasks);
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      const caught = ((): unknown => {
        try { call(); } catch (e) { return e; }
        return null;
      })();

      expect(isLocalCommercialDataDisabledError(caught)).toBe(true);
      if (isLocalCommercialDataDisabledError(caught)) {
        expect(caught.code).toBe('remote_commercial_local_data_disabled');
        expect(caught.operation).toBe(name);
      }
      expect(isRemoteLeadsError(caught)).toBe(false);
      expect(JSON.stringify(getStore().visits)).toBe(visitsBefore);
      expect(JSON.stringify(getStore().deals)).toBe(dealsBefore);
      expect(JSON.stringify(getStore().sales)).toBe(salesBefore);
      expect(JSON.stringify(getStore().tasks)).toBe(tasksBefore);
      expect(setItem).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
  }

  it('DealService.approve/reject: bloqueado ANTES da checagem de role (assert sempre primeiro)', () => {
    vi.spyOn(AuthService, 'isManager').mockReturnValue(false);
    expect(() => DealService.approve('d1')).toThrow('remote_commercial_local_data_disabled');
    expect(() => DealService.reject('d1')).toThrow('remote_commercial_local_data_disabled');
  });
});
