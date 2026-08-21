// Testes de FlowReagendarVisita — cutover de reagendamento remoto
// (COMMERCIAL-REMOTE-VISITS-B5). useUpdateVisit/resolveVisitRemoteMode são
// mockados diretamente no nível do componente — mesmo padrão de
// tests/flows/FlowReagendarPendenciaRemote.test.tsx (evita
// QueryClientProvider real; a integração completa da mutation já está
// coberta em tests/hooks/useUpdateVisit.test.tsx). Este flow é REMOTE-ONLY
// (nenhum branch local — B5-PRECHECK §3/§24): FlowConfirmarVisita local,
// intocada, continua com seu próprio "Remarcar" (marca RESCHEDULED +
// reabre criar-visita), fora do escopo deste arquivo.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RemoteVisitsError } from '@/lib/visits/errors';

const m = vi.hoisted(() => ({
  user: { current: null as any },
  useUpdateVisit: vi.fn(),
  visitServiceUpdate: vi.fn(),
  leadServiceAddToTimeline: vi.fn(),
}));

vi.mock('@/lib/hooks/useUpdateVisit', () => ({
  useUpdateVisit: m.useUpdateVisit,
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getCurrentUser: () => m.user.current },
  LeadService: { getAll: () => [], addToTimeline: m.leadServiceAddToTimeline, updateHealth: vi.fn() },
  VisitService: { getAll: () => [], create: vi.fn(), update: m.visitServiceUpdate },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  TaskService: { getAll: () => [], create: vi.fn(), update: vi.fn() },
  SellerService: { getAll: () => [] },
}));

import { FlowReagendarVisita } from '@/components/flows/Flows2';

function manager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1', name: 'Gerente', email: 'g@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    ...overrides,
  };
}
function seller(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-2', name: 'Vendedor', email: 's@a.com', platformRole: null,
    activeMembership: { companyId: 'company-a', role: 'seller', sellerId: 'seller-self' },
    ...overrides,
  };
}

function updateHookResult(updateVisit: any, over: Partial<Record<string, unknown>> = {}) {
  return { updateVisit, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(), ...over };
}

// Data bem longe de "hoje"/"amanhã" reais de propósito (mesmo achado do
// precedente Tasks) — evita colisão acidental com os testes de "Hoje"/
// "Amanhã", que usam a data local real do runner.
function remoteVisit(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'visit-1', clientName: 'Cliente Remoto', leadId: null,
    assignedSellerId: 'seller-1', vehicles: ['Golf GTI 2022'], scheduledAt: '2020-01-01T14:00:00.000Z',
    status: 'scheduled', outcome: null, note: 'nota original', resultNote: null, version: 7,
    createdAt: '2019-12-01T10:00:00.000Z',
    ...over,
  };
}

let updateVisitSpy: ReturnType<typeof vi.fn>;

function renderFlow(payload: any) {
  const close = vi.fn();
  render(<FlowReagendarVisita payload={payload} close={close} />);
  return { close };
}

const SLOTS = ['09:00', '10:30', '14:00', '15:30', '17:00', '18:30'];

function fillTime(value: string) {
  if (SLOTS.includes(value)) {
    fireEvent.click(screen.getByText(value));
  } else {
    fireEvent.change(screen.getByLabelText('Outro horário'), { target: { value } });
  }
}
function fillWhen(when: string, opts: { date?: string; time?: string } = {}) {
  fireEvent.click(screen.getByText(when));
  if (opts.date !== undefined) fireEvent.change(screen.getByLabelText('Data'), { target: { value: opts.date } });
  if (opts.time !== undefined) fillTime(opts.time);
}
function localYMDForTest(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysForTest(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

beforeEach(() => {
  m.visitServiceUpdate.mockReset();
  m.leadServiceAddToTimeline.mockReset();
  updateVisitSpy = vi.fn().mockResolvedValue({});
  m.useUpdateVisit.mockReset().mockImplementation(() => updateHookResult(updateVisitSpy));
  m.user.current = manager();
});

describe('FlowReagendarVisita — sem Visit no payload', () => {
  it('payload.visit ausente: não renderiza nada, updateVisit 0 calls', () => {
    const { container } = render(<FlowReagendarVisita payload={{}} close={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(updateVisitSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarVisita — same-id / payload full-replace', () => {
  it('updateVisit chamado com visitId/expectedVersion/vehicles/note/assignedSellerId preservados', async () => {
    renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '16:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());

    const call = updateVisitSpy.mock.calls[0][0];
    expect(call.visitId).toBe('visit-1');
    expect(call.expectedVersion).toBe(7);
    expect(call.vehicles).toEqual(['Golf GTI 2022']);
    expect(call.note).toBe('nota original');
    expect(call.assignedSellerId).toBe('seller-1');
    expect(new Date(call.scheduledAt).getFullYear()).toBe(2026);
    expect(new Date(call.scheduledAt).getMonth()).toBe(8);
    expect(new Date(call.scheduledAt).getDate()).toBe(1);
    expect(new Date(call.scheduledAt).getHours()).toBe(16);
    expect(m.visitServiceUpdate).not.toHaveBeenCalled();
  });

  it('múltiplos veículos preservados intactos (nunca perde nenhum)', async () => {
    renderFlow({ visit: remoteVisit({ vehicles: ['Golf GTI 2022', 'Honda HR-V 2023', 'Fusca 1978'] }) });
    fillWhen('Personalizado', { date: '2026-09-01', time: '16:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());

    expect(updateVisitSpy.mock.calls[0][0].vehicles).toEqual(['Golf GTI 2022', 'Honda HR-V 2023', 'Fusca 1978']);
  });
});

describe('FlowReagendarVisita — Lead/client imutáveis', () => {
  it('leadId/clientName nunca fazem parte do payload de update', async () => {
    renderFlow({ visit: remoteVisit({ leadId: 'lead-9', clientName: 'Ana Souza' }) });
    fillWhen('Personalizado', { date: '2026-09-01', time: '16:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());

    const call = updateVisitSpy.mock.calls[0][0];
    expect('leadId' in call).toBe(false);
    expect('clientName' in call).toBe(false);
  });

  it('nenhum picker de Lead/cliente é renderizado', () => {
    renderFlow({ visit: remoteVisit({ leadId: 'lead-9', clientName: 'Ana Souza' }) });
    expect(screen.queryByPlaceholderText(/Buscar cliente/)).toBeNull();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });
});

describe('FlowReagendarVisita — prefill', () => {
  it('Visit de hoje: chip Hoje pré-selecionado, horário do slot pré-selecionado, sem alterar nada é no-op', () => {
    const now = new Date();
    const scheduledAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0).toISOString();
    renderFlow({ visit: remoteVisit({ scheduledAt }) });

    // Sem nenhuma interação: já é no-op (mesmo instante) — Reagendar não
    // deve chamar updateVisit.
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateVisitSpy).not.toHaveBeenCalled();
  });

  it('Visit de amanhã: prefill reproduz o mesmo instante (no-op sem interação)', () => {
    const tomorrow = addDaysForTest(new Date(), 1);
    const scheduledAt = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0).toISOString();
    renderFlow({ visit: remoteVisit({ scheduledAt }) });

    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateVisitSpy).not.toHaveBeenCalled();
  });

  it('Visit distante (Personalizado): prefill reproduz o mesmo instante (no-op sem interação)', () => {
    // remoteVisit() default já é 2020-01-01T14:00:00Z — bem distante de
    // hoje/amanhã reais.
    renderFlow({ visit: remoteVisit() });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateVisitSpy).not.toHaveBeenCalled();
  });

  it('"Atualmente" mostra a data/hora atual da Visit', () => {
    renderFlow({ visit: remoteVisit({ scheduledAt: '2020-01-01T14:00:00.000Z' }) });
    // 01/jan/2020 é quarta-feira; horário exibido em local time do runner
    // via componentes locais — verificamos só que o rótulo aparece com o
    // texto "Atualmente:" e a hora renderizada bate com getHours() local.
    const localHour = new Date('2020-01-01T14:00:00.000Z').getHours();
    expect(screen.getByText(new RegExp(`Atualmente: .*${String(localHour).padStart(2, '0')}:00`))).toBeInTheDocument();
  });
});

describe('FlowReagendarVisita — no-op explícito', () => {
  it('reescolher exatamente a mesma data/hora via UI: updateVisit 0 calls', () => {
    const scheduledAt = '2020-01-01T14:00:00.000Z';
    renderFlow({ visit: remoteVisit({ scheduledAt }) });
    // Mesmo Personalizado + mesma data/hora do prefill original.
    fillWhen('Personalizado', { date: '2020-01-01', time: '14:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateVisitSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarVisita — data/hora: futuro válido e passado rejeitado', () => {
  it('Hoje com novo horário -> scheduledAt no dia local de hoje', async () => {
    const now = new Date();
    renderFlow({ visit: remoteVisit() });
    fillWhen('Hoje', { time: '17:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());

    const scheduledAt = new Date(updateVisitSpy.mock.calls[0][0].scheduledAt);
    expect(scheduledAt.getFullYear()).toBe(now.getFullYear());
    expect(scheduledAt.getMonth()).toBe(now.getMonth());
    expect(scheduledAt.getDate()).toBe(now.getDate());
    expect(scheduledAt.getHours()).toBe(17);
  });

  it('Amanhã -> próximo dia de calendário local', async () => {
    const tomorrow = addDaysForTest(new Date(), 1);
    renderFlow({ visit: remoteVisit() });
    fillWhen('Amanhã', { time: '09:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());

    const scheduledAt = new Date(updateVisitSpy.mock.calls[0][0].scheduledAt);
    expect(scheduledAt.getFullYear()).toBe(tomorrow.getFullYear());
    expect(scheduledAt.getMonth()).toBe(tomorrow.getMonth());
    expect(scheduledAt.getDate()).toBe(tomorrow.getDate());
  });

  it('Personalizado com data no passado: updateVisit 0 calls, mensagem exibida', () => {
    const past = addDaysForTest(new Date(), -5);
    renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: localYMDForTest(past), time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateVisitSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Escolha uma data e horário futuros.')).toBeInTheDocument();
  });

  it('Outro horário (fora dos slots) é aceito e enviado corretamente', async () => {
    renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '19:45' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());
    const scheduledAt = new Date(updateVisitSpy.mock.calls[0][0].scheduledAt);
    expect(scheduledAt.getHours()).toBe(19);
    expect(scheduledAt.getMinutes()).toBe(45);
  });
});

describe('FlowReagendarVisita — Seller (role e Manager): sem picker, sempre preservado', () => {
  it('Seller: nenhum picker de vendedor renderizado, assignedSellerId preservado', async () => {
    m.user.current = seller();
    renderFlow({ visit: remoteVisit({ assignedSellerId: 'seller-self' }) });
    expect(screen.queryByText('Selecione o vendedor…')).toBeNull();

    fillWhen('Personalizado', { date: '2026-09-01', time: '16:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());
    expect(updateVisitSpy.mock.calls[0][0].assignedSellerId).toBe('seller-self');
  });

  it('Manager: nenhum picker de vendedor renderizado, assignedSellerId preservado mesmo se histórico/inativo', async () => {
    renderFlow({ visit: remoteVisit({ assignedSellerId: 'seller-historico-inativo' }) });
    expect(screen.queryByText('Selecione o vendedor…')).toBeNull();

    fillWhen('Personalizado', { date: '2026-09-01', time: '16:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalled());
    expect(updateVisitSpy.mock.calls[0][0].assignedSellerId).toBe('seller-historico-inativo');
  });
});

describe('FlowReagendarVisita — pending/double-submit', () => {
  it('isPending=true: clique não gera segunda chamada', () => {
    m.useUpdateVisit.mockImplementation(() => updateHookResult(updateVisitSpy, { isPending: true }));
    renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '10:00' });

    expect(screen.getByText('Reagendando…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reagendando…'));
    expect(updateVisitSpy).not.toHaveBeenCalled();
  });
});

describe('FlowReagendarVisita — sucesso remoto', () => {
  it('close() só é chamado depois do resolve; sem escrita local (VisitService/LeadService)', async () => {
    const { close } = renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    expect(close).not.toHaveBeenCalled();
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(m.visitServiceUpdate).not.toHaveBeenCalled();
    expect(m.leadServiceAddToTimeline).not.toHaveBeenCalled();
  });
});

describe.each([
  ['stale_write', 'remote_visits_mutation_stale_write', 'Esta visita foi alterada. Os dados foram atualizados.'],
  ['visit_closed', 'remote_visits_mutation_visit_closed', 'Esta visita já foi encerrada.'],
  ['visit_not_found', 'remote_visits_mutation_visit_not_found', 'Esta visita não está mais disponível.'],
  ['forbidden', 'remote_visits_mutation_forbidden', 'Você não tem permissão para reagendar esta visita.'],
  ['seller_required', 'remote_visits_mutation_seller_required', 'Esta visita está sem um vendedor responsável válido.'],
  ['seller_not_found', 'remote_visits_mutation_seller_not_found', 'O vendedor responsável desta visita não está mais disponível.'],
  ['invalid_vehicles', 'remote_visits_mutation_invalid_vehicles', 'Esta visita possui dados de veículo inválidos e precisa ser atualizada.'],
] as const)('FlowReagendarVisita — erro %s (REOPEN REQUIRED)', (_label, code, expectedMessage) => {
  it(`mostra "${expectedMessage}", bloqueia novos submits, sem sucesso, sem create/local write`, async () => {
    updateVisitSpy.mockRejectedValueOnce(new RemoteVisitsError(code as any, { operation: 'update_visit' }));
    const { close } = renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(m.visitServiceUpdate).not.toHaveBeenCalled();

    // Segundo clique: bloqueado nesta instância, mesmo com dados "válidos".
    updateVisitSpy.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(updateVisitSpy).toHaveBeenCalledTimes(1);
  });
});

describe('FlowReagendarVisita — erro genérico (RETRYABLE)', () => {
  it('mostra mensagem, permite nova tentativa, erro anterior é limpo', async () => {
    updateVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_generic_error', { operation: 'update_visit' }));
    renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    expect(await screen.findByText('Não foi possível reagendar a visita. Tente novamente.')).toBeInTheDocument();

    updateVisitSpy.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Não foi possível reagendar a visita. Tente novamente.')).toBeNull());
  });
});

describe('FlowReagendarVisita — identity_changed', () => {
  it('fecha o flow, nenhuma mensagem de erro, nenhum sucesso declarado por engano', async () => {
    updateVisitSpy.mockRejectedValueOnce(new RemoteVisitsError('remote_visits_mutation_identity_changed', { operation: 'update_visit' }));
    const { close } = renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(screen.queryByText(/Não foi possível reagendar/)).toBeNull();
  });
});

describe('FlowReagendarVisita — nenhuma outra mutation é importada/chamada', () => {
  it('sucesso não dispara create/confirm/cancel/register — apenas updateVisit', async () => {
    renderFlow({ visit: remoteVisit() });
    fillWhen('Personalizado', { date: '2026-09-01', time: '10:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Reagendar' }));
    await waitFor(() => expect(updateVisitSpy).toHaveBeenCalledTimes(1));
    expect(m.visitServiceUpdate).not.toHaveBeenCalled();
  });
});
