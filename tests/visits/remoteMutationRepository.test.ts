// Testes de lib/visits/remoteMutationRepository.ts
// (COMMERCIAL-REMOTE-VISITS-B2-B). Supabase mockado (rpc), nenhuma rede
// real, nenhuma migration remota envolvida. Prova: as 5 funções chamam a
// RPC certa com EXATAMENTE os argumentos do contrato real (migration
// #52), nunca p_company_id/status/outcome-onde-não-cabe/version/actor*;
// update_visit é FULL REPLACE (payload parcial falha em compile-time);
// retorno é sempre RemoteVisitRow cru; erros do backend viram
// RemoteVisitsError via mapRemoteVisitsMutationError; data=null sem erro é
// tratado como erro controlado. Mesmo padrão de
// tests/tasks/remoteTaskMutationRepository.test.ts.
import { describe, expect, it, vi } from 'vitest';
import {
  createRemoteVisit,
  updateRemoteVisit,
  confirmRemoteVisit,
  cancelRemoteVisit,
  registerRemoteVisitResult,
  type UpdateRemoteVisitPayload,
} from '@/lib/visits/remoteMutationRepository';
import { isRemoteVisitsError } from '@/lib/visits/errors';
import type { RemoteVisitRow } from '@/lib/visits/adapter';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

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
    note: '',
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

// ── createRemoteVisit ────────────────────────────────────────────────────

describe('createRemoteVisit', () => {
  it('chama create_visit com EXATAMENTE os 6 argumentos do contrato, nenhum extra', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow(), error: null });
    await createRemoteVisit({
      scheduledAt: '2026-08-21T17:00:00Z',
      vehicles: ['Golf GTI 2022'],
      leadId: 'lead-1',
      clientName: null,
      assignedSellerId: 's1',
      note: 'Cliente quer ver o Golf',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('create_visit', {
      p_scheduled_at: '2026-08-21T17:00:00Z',
      p_vehicles: ['Golf GTI 2022'],
      p_lead_id: 'lead-1',
      p_client_name: null,
      p_assigned_seller_id: 's1',
      p_note: 'Cliente quer ver o Golf',
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(6);
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_company_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('version');
  });

  it('leadId null + clientName → Visit avulsa', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow({ lead_id: null, client_name: 'Cliente Avulso' }), error: null });
    await createRemoteVisit({
      scheduledAt: '2026-08-21T17:00:00Z',
      vehicles: ['Golf'],
      leadId: null,
      clientName: 'Cliente Avulso',
    });
    expect(mocks.rpc.mock.calls[0][1].p_lead_id).toBeNull();
    expect(mocks.rpc.mock.calls[0][1].p_client_name).toBe('Cliente Avulso');
  });

  it('campos opcionais omitidos → lead_id/client_name/assigned_seller_id null, note vazia (espelha os defaults do SQL)', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow(), error: null });
    await createRemoteVisit({ scheduledAt: '2026-08-21T17:00:00Z', vehicles: ['Golf'] });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_lead_id: null,
      p_client_name: null,
      p_assigned_seller_id: null,
      p_note: '',
    });
  });

  it('retorna a RemoteVisitRow crua recebida da RPC — nenhum clientName/assignedSellerId adaptado aqui', async () => {
    const row = visitRow({ id: 'visit-novo' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await createRemoteVisit({ scheduledAt: '2026-08-21T17:00:00Z', vehicles: ['Golf'] });
    expect(result).toEqual(row);
    expect(result).not.toHaveProperty('clientName');
    expect(result).not.toHaveProperty('assignedSellerId');
  });

  it.each([
    ['seller_required', 'remote_visits_mutation_seller_required'],
    ['seller_not_found', 'remote_visits_mutation_seller_not_found'],
    ['lead_not_found', 'remote_visits_mutation_lead_not_found'],
    ['lead_archived', 'remote_visits_mutation_lead_archived'],
    ['client_name_required', 'remote_visits_mutation_client_name_required'],
    ['invalid_vehicles', 'remote_visits_mutation_invalid_vehicles'],
    ['forbidden', 'remote_visits_mutation_forbidden'],
  ] as const)('erro %s do backend vira RemoteVisitsError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = createRemoteVisit({ scheduledAt: '2026-08-21T17:00:00Z', vehicles: ['Golf'] });
    await expect(failure).rejects.toSatisfy((e: unknown) => isRemoteVisitsError(e));
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('mensagem de erro desconhecida → generic_error controlado, nunca texto cru do Postgres exposto', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "visits_pkey"' },
    });
    const failure = createRemoteVisit({ scheduledAt: '2026-08-21T17:00:00Z', vehicles: ['Golf'] });
    await expect(failure).rejects.toMatchObject({ code: 'remote_visits_mutation_generic_error' });
  });

  it('data=null sem erro é anômalo → erro controlado, nunca `undefined as RemoteVisitRow`', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createRemoteVisit({ scheduledAt: '2026-08-21T17:00:00Z', vehicles: ['Golf'] }))
      .rejects.toMatchObject({ code: 'remote_visits_mutation_generic_error' });
  });

  it('não escreve em localStorage durante a mutation', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow(), error: null });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await createRemoteVisit({ scheduledAt: '2026-08-21T17:00:00Z', vehicles: ['Golf'] });
    expect(setItem).not.toHaveBeenCalled();
  });
});

// ── updateRemoteVisit ────────────────────────────────────────────────────

describe('updateRemoteVisit', () => {
  it('chama update_visit com EXATAMENTE os 6 argumentos do full-replace', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow({ version: 2 }), error: null });
    await updateRemoteVisit({
      visitId: 'visit-1',
      expectedVersion: 1,
      scheduledAt: '2026-08-22T18:00:00Z',
      vehicles: ['Civic 2023'],
      note: 'Nota atualizada',
      assignedSellerId: 's2',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('update_visit', {
      p_id: 'visit-1',
      p_expected_version: 1,
      p_scheduled_at: '2026-08-22T18:00:00Z',
      p_vehicles: ['Civic 2023'],
      p_note: 'Nota atualizada',
      p_assigned_seller_id: 's2',
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(6);
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_lead_id');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_status');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_outcome');
  });

  it('FULL-REPLACE type safety — um payload parcial (só visitId/expectedVersion/scheduledAt) é inválido em tempo de compilação', () => {
    mocks.rpc.mockResolvedValue({ data: visitRow(), error: null });
    // @ts-expect-error — update_visit é FULL REPLACE: vehicles/note/
    // assignedSellerId são obrigatórios no payload. Um "reagendamento" que
    // só envie visitId/expectedVersion/scheduledAt precisa falhar aqui,
    // nunca apagar os demais campos em silêncio.
    const invalidPayload: UpdateRemoteVisitPayload = {
      visitId: 'visit-1',
      expectedVersion: 1,
      scheduledAt: '2026-08-22T18:00:00Z',
    };
    // Nunca executado de propósito — o objetivo é o erro de compilação
    // acima, não um comportamento em runtime.
    expect(typeof invalidPayload).toBe('object');
  });

  it.each([
    ['visit_not_found', 'remote_visits_mutation_visit_not_found'],
    ['visit_closed', 'remote_visits_mutation_visit_closed'],
    ['stale_write', 'remote_visits_mutation_stale_write'],
    ['seller_required', 'remote_visits_mutation_seller_required'],
    ['seller_not_found', 'remote_visits_mutation_seller_not_found'],
    ['invalid_vehicles', 'remote_visits_mutation_invalid_vehicles'],
    ['forbidden', 'remote_visits_mutation_forbidden'],
  ] as const)('erro %s do backend vira RemoteVisitsError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = updateRemoteVisit({
      visitId: 'visit-1', expectedVersion: 1, scheduledAt: '2026-08-22T18:00:00Z',
      vehicles: ['Golf'], note: '', assignedSellerId: 's1',
    });
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('stale_write nunca é reenviado automaticamente — repository só propaga o erro mapeado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    await expect(
      updateRemoteVisit({
        visitId: 'visit-1', expectedVersion: 1, scheduledAt: '2026-08-22T18:00:00Z',
        vehicles: ['Golf'], note: '', assignedSellerId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'remote_visits_mutation_stale_write' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1); // nenhuma segunda chamada/retry automático
  });

  it('retorna a RemoteVisitRow crua (version já incrementada pelo trigger, sem reformatação)', async () => {
    const row = visitRow({ version: 2, scheduled_at: '2026-08-22T18:00:00Z' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await updateRemoteVisit({
      visitId: 'visit-1', expectedVersion: 1, scheduledAt: '2026-08-22T18:00:00Z',
      vehicles: ['Golf'], note: '', assignedSellerId: 's1',
    });
    expect(result).toEqual(row);
  });

  it('data=null sem erro → erro controlado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      updateRemoteVisit({
        visitId: 'visit-1', expectedVersion: 1, scheduledAt: '2026-08-22T18:00:00Z',
        vehicles: ['Golf'], note: '', assignedSellerId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'remote_visits_mutation_generic_error' });
  });
});

// ── confirmRemoteVisit ───────────────────────────────────────────────────

describe('confirmRemoteVisit', () => {
  it('chama confirm_visit com SOMENTE p_id/p_expected_version', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow({ status: 'confirmed' }), error: null });
    await confirmRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_visit', { p_id: 'visit-1', p_expected_version: 1 });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(2);
  });

  it.each([
    ['visit_not_found', 'remote_visits_mutation_visit_not_found'],
    ['visit_closed', 'remote_visits_mutation_visit_closed'],
    ['invalid_status_transition', 'remote_visits_mutation_invalid_status_transition'],
    ['stale_write', 'remote_visits_mutation_stale_write'],
    ['forbidden', 'remote_visits_mutation_forbidden'],
  ] as const)('erro %s do backend vira RemoteVisitsError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = confirmRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 });
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('retorna a RemoteVisitRow crua já confirmada pelo banco', async () => {
    const row = visitRow({ status: 'confirmed' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await confirmRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 });
    expect(result).toEqual(row);
  });

  it('data=null sem erro → erro controlado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(confirmRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'remote_visits_mutation_generic_error' });
  });
});

// ── cancelRemoteVisit ────────────────────────────────────────────────────

describe('cancelRemoteVisit', () => {
  it('chama cancel_visit com SOMENTE p_id/p_expected_version', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow({ status: 'canceled', closed_at: '2026-08-21T18:00:00Z', closed_by: 'profile-1' }), error: null });
    await cancelRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('cancel_visit', { p_id: 'visit-1', p_expected_version: 1 });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(2);
  });

  it.each([
    ['visit_not_found', 'remote_visits_mutation_visit_not_found'],
    ['visit_closed', 'remote_visits_mutation_visit_closed'],
    ['stale_write', 'remote_visits_mutation_stale_write'],
    ['forbidden', 'remote_visits_mutation_forbidden'],
  ] as const)('erro %s do backend vira RemoteVisitsError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = cancelRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 });
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('retorna a RemoteVisitRow crua já cancelada pelo banco (outcome permanece null)', async () => {
    const row = visitRow({ status: 'canceled', closed_at: '2026-08-21T18:00:00Z', closed_by: 'profile-1' });
    mocks.rpc.mockResolvedValue({ data: row, error: null });
    const result = await cancelRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 });
    expect(result).toEqual(row);
    expect(result.outcome).toBeNull();
  });

  it('data=null sem erro → erro controlado (nenhum DELETE)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(cancelRemoteVisit({ visitId: 'visit-1', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'remote_visits_mutation_generic_error' });
  });
});

// ── registerRemoteVisitResult ────────────────────────────────────────────

describe('registerRemoteVisitResult', () => {
  it('chama register_visit_result com EXATAMENTE os 4 argumentos', async () => {
    mocks.rpc.mockResolvedValue({
      data: visitRow({ status: 'completed', outcome: 'sold', result_note: 'Fechou na hora' }),
      error: null,
    });
    await registerRemoteVisitResult({
      visitId: 'visit-1',
      expectedVersion: 1,
      outcome: 'sold',
      resultNote: 'Fechou na hora',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('register_visit_result', {
      p_id: 'visit-1',
      p_expected_version: 1,
      p_outcome: 'sold',
      p_result_note: 'Fechou na hora',
    });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).toHaveLength(4);
  });

  it.each(['sold', 'negotiating', 'thinking', 'no_interest'] as const)('outcome=%s é aceito e encaminhado tal como recebido', async (outcome) => {
    mocks.rpc.mockResolvedValue({ data: visitRow({ status: 'completed', outcome }), error: null });
    await registerRemoteVisitResult({ visitId: 'visit-1', expectedVersion: 1, outcome });
    expect(mocks.rpc.mock.calls[0][1].p_outcome).toBe(outcome);
  });

  it('resultNote omitido → p_result_note vazio (espelha o default do SQL); note original nunca referenciado aqui', async () => {
    mocks.rpc.mockResolvedValue({ data: visitRow({ status: 'completed', outcome: 'sold' }), error: null });
    await registerRemoteVisitResult({ visitId: 'visit-1', expectedVersion: 1, outcome: 'sold' });
    expect(mocks.rpc.mock.calls[0][1].p_result_note).toBe('');
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_note');
  });

  it.each([
    ['visit_not_found', 'remote_visits_mutation_visit_not_found'],
    ['visit_closed', 'remote_visits_mutation_visit_closed'],
    ['stale_write', 'remote_visits_mutation_stale_write'],
    ['forbidden', 'remote_visits_mutation_forbidden'],
  ] as const)('erro %s do backend vira RemoteVisitsError(%s)', async (backendMessage, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: backendMessage } });
    const failure = registerRemoteVisitResult({ visitId: 'visit-1', expectedVersion: 1, outcome: 'sold' });
    await expect(failure).rejects.toMatchObject({ code: expectedCode });
  });

  it('data=null sem erro → erro controlado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(registerRemoteVisitResult({ visitId: 'visit-1', expectedVersion: 1, outcome: 'sold' }))
      .rejects.toMatchObject({ code: 'remote_visits_mutation_generic_error' });
  });
});
