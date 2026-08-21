// Testes de lib/visits/adapter.ts (COMMERCIAL-REMOTE-VISITS-B2-A). Puro —
// nenhum mock necessário. Mesmo padrão de tests/tasks/taskAdapter.test.ts.
import { describe, expect, it } from 'vitest';
import {
  adaptRemoteVisitRow,
  adaptRemoteVisitRows,
  isVisitAdapterError,
  VISIT_LEAD_UNAVAILABLE_DISPLAY_VALUE,
  type RemoteVisitRow,
  type VisitAdapterContext,
} from '@/lib/visits/adapter';

function visitRow(overrides: Partial<RemoteVisitRow> = {}): RemoteVisitRow {
  return {
    id: 'visit-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    client_name: null,
    assigned_seller_id: 's1',
    vehicles: ['Golf GTI 2022'],
    scheduled_at: '2026-08-21T17:00:00+00:00',
    status: 'scheduled',
    outcome: null,
    note: 'Cliente quer ver o Golf',
    result_note: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    closed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
    closed_at: null,
    version: 1,
    ...overrides,
  };
}

function makeContext(): VisitAdapterContext {
  return {
    leadsById: { 'lead-1': { id: 'lead-1', name: 'Carlos Andrade' } },
  };
}

describe('adaptRemoteVisitRow — caminho feliz', () => {
  it('mapeia todos os campos corretamente', () => {
    const result = adaptRemoteVisitRow(visitRow(), makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.id).toBe('visit-1');
    expect(result.visit.leadId).toBe('lead-1');
    expect(result.visit.clientName).toBe('Carlos Andrade');
    expect(result.visit.assignedSellerId).toBe('s1');
    expect(result.visit.vehicles).toEqual(['Golf GTI 2022']);
    expect(result.visit.scheduledAt).toBe('2026-08-21T17:00:00+00:00');
    expect(result.visit.status).toBe('scheduled');
    expect(result.visit.outcome).toBeNull();
    expect(result.visit.note).toBe('Cliente quer ver o Golf');
    expect(result.visit.resultNote).toBeNull();
    expect(result.visit.version).toBe(1);
    expect(result.visit.createdAt).toBe('2026-08-20T10:00:00+00:00');
  });

  it('múltiplos vehicles preservados na ordem original', () => {
    const result = adaptRemoteVisitRow(visitRow({ vehicles: ['Golf GTI 2022', 'Civic 2023'] }), makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.vehicles).toEqual(['Golf GTI 2022', 'Civic 2023']);
  });
});

describe('adaptRemoteVisitRow — resolução de client (Lead vs. avulsa)', () => {
  it('lead_id presente e resolvido em leadsById → clientName = nome do Lead', () => {
    const result = adaptRemoteVisitRow(visitRow({ lead_id: 'lead-1', client_name: null }), makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.clientName).toBe('Carlos Andrade');
  });

  it('lead_id presente mas AUSENTE de leadsById (Lead arquivado depois, ou cache ainda não carregou) → placeholder neutro', () => {
    const result = adaptRemoteVisitRow(
      visitRow({ lead_id: 'lead-2', client_name: null }),
      { leadsById: {} },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.clientName).toBe(VISIT_LEAD_UNAVAILABLE_DISPLAY_VALUE);
    expect(result.visit.clientName).not.toMatch(/arquivad/i);
  });

  it('lead_id null → clientName vem de row.client_name (Visit avulsa)', () => {
    const result = adaptRemoteVisitRow(
      visitRow({ lead_id: null, client_name: 'Cliente Avulso' }),
      { leadsById: {} },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.leadId).toBeNull();
    expect(result.visit.clientName).toBe('Cliente Avulso');
  });
});

describe('adaptRemoteVisitRow — status/outcome válidos', () => {
  it.each(['scheduled', 'confirmed', 'canceled', 'completed'] as const)('status=%s é aceito', (status) => {
    const result = adaptRemoteVisitRow(
      visitRow({
        status,
        outcome: status === 'completed' ? 'sold' : null,
        closed_at: status === 'completed' || status === 'canceled' ? '2026-08-21T18:00:00Z' : null,
        closed_by: status === 'completed' || status === 'canceled' ? 'profile-1' : null,
      }),
      makeContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.status).toBe(status);
  });

  it.each(['sold', 'negotiating', 'thinking', 'no_interest'] as const)('outcome=%s é aceito quando completed', (outcome) => {
    const result = adaptRemoteVisitRow(
      visitRow({ status: 'completed', outcome, closed_at: '2026-08-21T18:00:00Z', closed_by: 'profile-1', result_note: 'ok' }),
      makeContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.outcome).toBe(outcome);
    expect(result.visit.resultNote).toBe('ok');
  });

  it('outcome null enquanto status aberto (scheduled/confirmed) é válido', () => {
    const result = adaptRemoteVisitRow(visitRow({ status: 'confirmed', outcome: null }), makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visit.outcome).toBeNull();
  });
});

describe('adaptRemoteVisitRow — runtime guards (dado externo nunca confiado cegamente)', () => {
  it('status fora do enum conhecido → invalid_status', () => {
    const result = adaptRemoteVisitRow(visitRow({ status: 'rescheduled' as never }), makeContext());
    expect(isVisitAdapterError(result)).toBe(true);
    if (!isVisitAdapterError(result)) return;
    expect(result.code).toBe('invalid_status');
    expect(result.visitId).toBe('visit-1');
  });

  it('outcome fora do enum conhecido → invalid_outcome', () => {
    const result = adaptRemoteVisitRow(visitRow({ outcome: 'lost' as never }), makeContext());
    expect(isVisitAdapterError(result)).toBe(true);
    if (!isVisitAdapterError(result)) return;
    expect(result.code).toBe('invalid_outcome');
  });

  it('vehicles vazio → invalid_vehicles', () => {
    const result = adaptRemoteVisitRow(visitRow({ vehicles: [] }), makeContext());
    expect(isVisitAdapterError(result)).toBe(true);
    if (!isVisitAdapterError(result)) return;
    expect(result.code).toBe('invalid_vehicles');
  });

  it('scheduled_at inválido → invalid_scheduled_at', () => {
    const result = adaptRemoteVisitRow(visitRow({ scheduled_at: 'nao-e-data' }), makeContext());
    expect(isVisitAdapterError(result)).toBe(true);
    if (!isVisitAdapterError(result)) return;
    expect(result.code).toBe('invalid_scheduled_at');
  });

  it('version < 1 → invalid_version', () => {
    const result = adaptRemoteVisitRow(visitRow({ version: 0 }), makeContext());
    expect(isVisitAdapterError(result)).toBe(true);
    if (!isVisitAdapterError(result)) return;
    expect(result.code).toBe('invalid_version');
  });
});

describe('adaptRemoteVisitRows — lote', () => {
  it('preserva ordem recebida', () => {
    const rows = [visitRow({ id: 'visit-a' }), visitRow({ id: 'visit-b', lead_id: null, client_name: 'Outro' })];
    const result = adaptRemoteVisitRows(rows, makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits.map((v) => v.id)).toEqual(['visit-a', 'visit-b']);
  });

  it('falha determinística no primeiro registro inválido — nunca lista parcial silenciosa', () => {
    const rows = [visitRow({ id: 'visit-ok' }), visitRow({ id: 'visit-bad', vehicles: [] })];
    const result = adaptRemoteVisitRows(rows, makeContext());
    expect(isVisitAdapterError(result)).toBe(true);
    if (!isVisitAdapterError(result)) return;
    expect(result.visitId).toBe('visit-bad');
    expect(result.rowIndex).toBe(1);
  });

  it('lista vazia → visits vazio, ok', () => {
    const result = adaptRemoteVisitRows([], makeContext());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.visits).toEqual([]);
  });
});
