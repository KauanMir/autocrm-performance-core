// Testes do adapter de leads remotos (M1-E, fase E2).
// Fixtures tipadas como LeadRow (derivado de Database) — sem rede, sem mock
// de Supabase, sem store, sem snapshots, sem `as any` estrutural.
import { describe, expect, it, vi } from 'vitest';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import type {
  ApplyLeadEventArgs,
  ArchiveLeadArgs,
  AssignLeadSellerArgs,
  CheckLeadPhoneDuplicateResult,
  CreateLeadArgs,
  LeadEventType,
  LeadDuplicateStatus,
  LeadRow,
  MoveLeadToStageArgs,
  UnarchiveLeadArgs,
  UpdateLeadArgs,
} from '@/lib/supabase/types';
import {
  adaptLeadRow,
  adaptLeadRows,
  LEAD_EMPTY_DISPLAY_VALUE,
  type AdaptLeadRowResult,
  type LeadAdapterContext,
  type LeadAdapterError,
  type LeadModel,
} from '@/lib/leads/adapter';

// ── Fixtures ─────────────────────────────────────────────────────────────

function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1',
    company_id: 'company-1',
    name: 'Carlos Andrade',
    phone: '(11) 99421-1190',
    phone_digits: '11994211190',
    car: 'Golf GTI 2022',
    stage_id: 'stage-negotiation',
    seller_id: 's1',
    urgency: 'red',
    temperature: null,
    last_activity_label: 'Sem contato há 3 dias',
    alert_label: 'Responder agora',
    payment_preference: 'Financiamento',
    value_amount: null,
    source: null,
    created_by_profile_id: 'profile-1',
    updated_by_profile_id: 'profile-2',
    archived_at: null,
    version: 1,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-19T13:30:00+00:00',
    ...overrides,
  };
}

function stage(overrides: Partial<PipelineStage> & { id: string; code: string; name: string }): PipelineStage {
  return { sortOrder: 0, isTerminal: false, ...overrides };
}

function makeContext(): LeadAdapterContext {
  return {
    stagesById: {
      'stage-new': stage({ id: 'stage-new', code: 'new', name: 'Novo', sortOrder: 0 }),
      'stage-negotiation': stage({ id: 'stage-negotiation', code: 'negotiation', name: 'Em negociação', sortOrder: 3 }),
    },
    sellersById: {
      s1: { id: 's1', name: 'Marcos Silva' },
      s2: { id: 's2', name: 'Ana Souza' },
    },
  };
}

function expectOk(result: AdaptLeadRowResult): LeadModel {
  if (!result.ok) throw new Error(`esperava ok, veio erro: ${JSON.stringify(result)}`);
  return result.lead;
}

function expectError(result: { ok: boolean }): LeadAdapterError {
  if (result.ok) throw new Error('esperava erro de configuração, veio ok');
  return result as LeadAdapterError;
}

// ── Mapeamento ───────────────────────────────────────────────────────────

describe('adaptLeadRow — mapeamento de campos', () => {
  it('mapeia todos os campos do LeadModel (compatibilidade + metadados remotos)', () => {
    const lead = expectOk(adaptLeadRow(leadRow(), makeContext()));
    expect(lead).toEqual({
      id: 'lead-1',
      name: 'Carlos Andrade',
      phone: '(11) 99421-1190',
      car: 'Golf GTI 2022',
      stage: 'Em negociação',
      stageId: 'stage-negotiation',
      stageCode: 'negotiation',
      seller: 'Marcos Silva',
      sellerId: 's1',
      urgency: 'red',
      last: 'Sem contato há 3 dias',
      alert: 'Responder agora',
      pay: 'Financiamento',
      value: LEAD_EMPTY_DISPLAY_VALUE,
      valueAmount: null,
      origem: undefined,
      temperature: undefined,
      createdByUserId: 'profile-1',
      createdAt: '2026-07-19T12:00:00+00:00',
      archivedAt: null,
      version: 1,
      updatedAt: '2026-07-19T13:30:00+00:00',
      updatedByProfileId: 'profile-2',
    });
  });

  it('renames: last_activity_label→last, alert_label→alert, payment_preference→pay, source→origem', () => {
    const lead = expectOk(adaptLeadRow(
      leadRow({
        last_activity_label: 'Agora',
        alert_label: 'Fazer follow-up',
        payment_preference: 'À vista',
        source: 'Indicação',
      }),
      makeContext(),
    ));
    expect(lead.last).toBe('Agora');
    expect(lead.alert).toBe('Fazer follow-up');
    expect(lead.pay).toBe('À vista');
    expect(lead.origem).toBe('Indicação');
    expect(lead).not.toHaveProperty('last_activity_label');
    expect(lead).not.toHaveProperty('alert_label');
    expect(lead).not.toHaveProperty('payment_preference');
    expect(lead).not.toHaveProperty('source');
  });

  it('stage: id preservado, name e code resolvidos pelo índice (nunca hardcoded)', () => {
    const lead = expectOk(adaptLeadRow(leadRow({ stage_id: 'stage-new' }), makeContext()));
    expect(lead.stageId).toBe('stage-new');
    expect(lead.stage).toBe('Novo');
    expect(lead.stageCode).toBe('new');
  });

  it('seller: id preservado e nome resolvido pelo índice', () => {
    const lead = expectOk(adaptLeadRow(leadRow({ seller_id: 's2' }), makeContext()));
    expect(lead.sellerId).toBe('s2');
    expect(lead.seller).toBe('Ana Souza');
  });

  it('seller_id null ⇒ sellerId null e rótulo "—" (padrão aprovado da UI)', () => {
    const lead = expectOk(adaptLeadRow(leadRow({ seller_id: null }), makeContext()));
    expect(lead.sellerId).toBeNull();
    expect(lead.seller).toBe(LEAD_EMPTY_DISPLAY_VALUE);
  });

  it('urgency é preservada', () => {
    for (const urgency of ['red', 'amber', 'green'] as const) {
      expect(expectOk(adaptLeadRow(leadRow({ urgency }), makeContext())).urgency).toBe(urgency);
    }
  });

  it('temperature null ⇒ undefined (opcional legado); preenchida é preservada', () => {
    expect(expectOk(adaptLeadRow(leadRow({ temperature: null }), makeContext())).temperature)
      .toBeUndefined();
    expect(expectOk(adaptLeadRow(leadRow({ temperature: 'hot' }), makeContext())).temperature)
      .toBe('hot');
  });

  it('value_amount null ⇒ value "—" e valueAmount null', () => {
    const lead = expectOk(adaptLeadRow(leadRow({ value_amount: null }), makeContext()));
    expect(lead.value).toBe('—');
    expect(lead.valueAmount).toBeNull();
  });

  it('value_amount numérico ⇒ formato pt-BR já usado no projeto e valueAmount preservado', () => {
    const inteiro = expectOk(adaptLeadRow(leadRow({ value_amount: 120000 }), makeContext()));
    expect(inteiro.value).toBe('R$ ' + (120000).toLocaleString('pt-BR'));
    expect(inteiro.valueAmount).toBe(120000);

    const decimal = expectOk(adaptLeadRow(leadRow({ value_amount: 1234.56 }), makeContext()));
    expect(decimal.value).toBe('R$ ' + (1234.56).toLocaleString('pt-BR'));
    expect(decimal.valueAmount).toBe(1234.56);
  });

  it('labels de compatibilidade nulas caem no placeholder "—"', () => {
    const lead = expectOk(adaptLeadRow(
      leadRow({ last_activity_label: null, alert_label: null, payment_preference: null }),
      makeContext(),
    ));
    expect(lead.last).toBe(LEAD_EMPTY_DISPLAY_VALUE);
    expect(lead.alert).toBe(LEAD_EMPTY_DISPLAY_VALUE);
    expect(lead.pay).toBe(LEAD_EMPTY_DISPLAY_VALUE);
  });

  it('created_by_profile_id → createdByUserId (inclusive null)', () => {
    expect(expectOk(adaptLeadRow(leadRow(), makeContext())).createdByUserId).toBe('profile-1');
    expect(expectOk(adaptLeadRow(leadRow({ created_by_profile_id: null }), makeContext())).createdByUserId)
      .toBeNull();
  });

  it('timestamps permanecem em ISO, sem transformação', () => {
    const lead = expectOk(adaptLeadRow(leadRow(), makeContext()));
    expect(lead.createdAt).toBe('2026-07-19T12:00:00+00:00');
    expect(lead.updatedAt).toBe('2026-07-19T13:30:00+00:00');
  });

  it('archived_at: null preservado; preenchido preservado em ISO', () => {
    expect(expectOk(adaptLeadRow(leadRow(), makeContext())).archivedAt).toBeNull();
    const archived = expectOk(adaptLeadRow(
      leadRow({ archived_at: '2026-07-19T15:00:00+00:00' }),
      makeContext(),
    ));
    expect(archived.archivedAt).toBe('2026-07-19T15:00:00+00:00');
  });

  it('version e updated_by_profile_id preservados', () => {
    const lead = expectOk(adaptLeadRow(leadRow({ version: 7, updated_by_profile_id: null }), makeContext()));
    expect(lead.version).toBe(7);
    expect(lead.updatedByProfileId).toBeNull();
  });

  it('timeline NUNCA é inventada (ausente/undefined)', () => {
    const lead = expectOk(adaptLeadRow(leadRow(), makeContext()));
    expect(lead.timeline).toBeUndefined();
    expect(Object.keys(lead)).not.toContain('timeline');
  });
});

// ── Erros de configuração (sem fallback silencioso) ──────────────────────

describe('adaptLeadRow — erros de configuração', () => {
  it('stage_id inexistente no índice ⇒ stage_not_found (nunca o primeiro stage)', () => {
    const error = expectError(adaptLeadRow(leadRow({ stage_id: 'stage-orfao' }), makeContext()));
    expect(error).toEqual({
      ok: false,
      reason: 'invalid_lead_configuration',
      code: 'stage_not_found',
      leadId: 'lead-1',
      stageId: 'stage-orfao',
      sellerId: 's1',
      rowIndex: null,
    });
  });

  it('seller_id preenchido mas inexistente no índice ⇒ seller_not_found (nunca o primeiro seller)', () => {
    const error = expectError(adaptLeadRow(leadRow({ seller_id: 's-orfao' }), makeContext()));
    expect(error).toEqual({
      ok: false,
      reason: 'invalid_lead_configuration',
      code: 'seller_not_found',
      leadId: 'lead-1',
      stageId: 'stage-negotiation',
      sellerId: 's-orfao',
      rowIndex: null,
    });
  });

  it('índice de stages vazio ⇒ stage_not_found (estado vazio não vira fallback)', () => {
    const context: LeadAdapterContext = { stagesById: {}, sellersById: {} };
    const error = expectError(adaptLeadRow(leadRow({ seller_id: null }), context));
    expect(error.code).toBe('stage_not_found');
  });
});

// ── Lista ────────────────────────────────────────────────────────────────

describe('adaptLeadRows', () => {
  it('preserva a ordem recebida, sem ordenar, filtrar ou agrupar', () => {
    const rows = [
      leadRow({ id: 'lead-b', stage_id: 'stage-new', seller_id: 's2' }),
      leadRow({ id: 'lead-a', archived_at: '2026-07-19T15:00:00+00:00' }),
      leadRow({ id: 'lead-c', seller_id: null }),
    ];
    const result = adaptLeadRows(rows, makeContext());
    if (!result.ok) throw new Error('esperava ok');
    expect(result.leads.map((l) => l.id)).toEqual(['lead-b', 'lead-a', 'lead-c']);
  });

  it('não oculta leads arquivados (filtragem pertence à query futura)', () => {
    const rows = [leadRow({ id: 'lead-arquivado', archived_at: '2026-07-19T15:00:00+00:00' })];
    const result = adaptLeadRows(rows, makeContext());
    if (!result.ok) throw new Error('esperava ok');
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0].archivedAt).toBe('2026-07-19T15:00:00+00:00');
  });

  it('lista vazia ⇒ ok com zero leads', () => {
    const result = adaptLeadRows([], makeContext());
    if (!result.ok) throw new Error('esperava ok');
    expect(result.leads).toEqual([]);
  });

  it('falha determinística no PRIMEIRO registro inválido, com rowIndex', () => {
    const rows = [
      leadRow({ id: 'lead-ok' }),
      leadRow({ id: 'lead-ruim-1', stage_id: 'stage-orfao' }),
      leadRow({ id: 'lead-ruim-2', seller_id: 's-orfao' }),
    ];
    const error = expectError(adaptLeadRows(rows, makeContext()));
    expect(error.code).toBe('stage_not_found');
    expect(error.leadId).toBe('lead-ruim-1');
    expect(error.rowIndex).toBe(1);
  });
});

// ── Pureza e imutabilidade ───────────────────────────────────────────────

describe('adapter — pureza e imutabilidade', () => {
  it('não muta a row original', () => {
    const row = leadRow();
    const before = JSON.parse(JSON.stringify(row));
    adaptLeadRow(row, makeContext());
    expect(row).toEqual(before);
  });

  it('não muta os índices do context', () => {
    const context = makeContext();
    const before = JSON.parse(JSON.stringify(context));
    adaptLeadRows([leadRow(), leadRow({ id: 'lead-2', seller_id: null })], context);
    expect(context).toEqual(before);
  });

  it('chamadas repetidas produzem resultados equivalentes sem compartilhar objetos', () => {
    const context = makeContext();
    const first = adaptLeadRows([leadRow()], context);
    const second = adaptLeadRows([leadRow()], context);
    if (!first.ok || !second.ok) throw new Error('esperava ok');
    expect(first.leads).toEqual(second.leads);
    expect(first.leads).not.toBe(second.leads);
    expect(first.leads[0]).not.toBe(second.leads[0]);
  });

  it('não depende de window nem de localStorage', () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'getItem');
    vi.stubGlobal('window', undefined);
    try {
      const result = adaptLeadRows([leadRow()], makeContext());
      expect(result.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(storageSpy).not.toHaveBeenCalled();
  });
});

// ── Contratos das RPCs (verificação em tempo de compilação) ──────────────
// {} extends Pick<T, K> testa o modificador `?` independentemente de
// strictNullChecks (desligado no tsconfig atual).

type IsOptionalKey<T, K extends keyof T> = {} extends Pick<T, K> ? true : false;

describe('tipos das RPCs do M1-E (compile-time)', () => {
  it('p_expected_version: obrigatório em update/assign/archive/unarchive, opcional em move', () => {
    const updateRequired: IsOptionalKey<UpdateLeadArgs, 'p_expected_version'> = false;
    const assignRequired: IsOptionalKey<AssignLeadSellerArgs, 'p_expected_version'> = false;
    const archiveRequired: IsOptionalKey<ArchiveLeadArgs, 'p_expected_version'> = false;
    const unarchiveRequired: IsOptionalKey<UnarchiveLeadArgs, 'p_expected_version'> = false;
    const moveOptional: IsOptionalKey<MoveLeadToStageArgs, 'p_expected_version'> = true;
    expect([updateRequired, assignRequired, archiveRequired, unarchiveRequired, moveOptional])
      .toEqual([false, false, false, false, true]);
  });

  it('AssignLeadSellerArgs: seller string OU null válidos sem cast; lead_id e version obrigatórios', () => {
    // Atribuições reais — compilam sem `as any`/`as never`/ts-ignore. null é
    // aceito porque lib/supabase/types.ts corrige a nulabilidade que o
    // gerador do Supabase não representa (null remove o vendedor, §6.5).
    const withSeller: AssignLeadSellerArgs = {
      p_lead_id: 'lead-1',
      p_seller_id: 's1',
      p_expected_version: 1,
    };
    const removingSeller: AssignLeadSellerArgs = {
      p_lead_id: 'lead-1',
      p_seller_id: null,
      p_expected_version: 1,
    };
    // As três chaves continuam obrigatórias (nenhuma virou opcional).
    const leadIdRequired: IsOptionalKey<AssignLeadSellerArgs, 'p_lead_id'> = false;
    const sellerIdRequired: IsOptionalKey<AssignLeadSellerArgs, 'p_seller_id'> = false;
    const versionRequired: IsOptionalKey<AssignLeadSellerArgs, 'p_expected_version'> = false;
    expect(withSeller.p_seller_id).toBe('s1');
    expect(removingSeller.p_seller_id).toBeNull();
    expect([leadIdRequired, sellerIdRequired, versionRequired]).toEqual([false, false, false]);
  });

  it('apply usa lead_event_type; duplicate tem retorno tipado; value_amount fora de create/update', () => {
    const applyUsesEnum: ApplyLeadEventArgs['p_event_type'] extends LeadEventType ? true : false = true;
    const duplicateTyped:
      CheckLeadPhoneDuplicateResult[number]['status'] extends LeadDuplicateStatus ? true : false = true;
    const noValueInCreate:
      Extract<keyof CreateLeadArgs, 'value_amount' | 'p_value_amount'> extends never ? true : false = true;
    const noValueInUpdate:
      Extract<keyof UpdateLeadArgs, 'value_amount' | 'p_value_amount'> extends never ? true : false = true;
    expect([applyUsesEnum, duplicateTyped, noValueInCreate, noValueInUpdate])
      .toEqual([true, true, true, true]);
  });
});
