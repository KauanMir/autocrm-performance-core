// Testes de isolamento fail-closed de ScreenPendencias (M1-E, E5-B2-A1) —
// Task é um dos quatro domínios comerciais locais sem company_id/backend
// remoto (auditoria E5-B2-A0). Em modo NÃO local, a tela nunca chama
// TaskService.getAll, nunca mostra tarefas antigas, nunca oferece criar/
// concluir/reagendar. Em modo local, comportamento preservado.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  isLocalCommercialDataAllowed: vi.fn(),
  tasks: vi.fn(() => [] as any[]),
  user: { current: null as any },
}));

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: m.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

vi.mock('@/lib/hooks/useRemoteLeadsScreenState', () => ({
  useRemoteLeadsScreenState: () => ({
    mode: 'local',
    pipeline: { source: 'local', stages: [], byId: {}, byCode: {}, byName: {}, isLoading: false, isFetching: false, isError: false, error: null, configError: null, isEmpty: false, hasData: false, refetch: () => {}, queryEnabled: false, remoteStagesEnabled: false },
    leads: { leads: [], isLoading: false, isFetching: false, isError: false, error: null, configError: null, isEmpty: true, hasData: false, refetch: () => {}, queryEnabled: false, remoteLeadsEnabled: false },
    sellerLabels: { sellerLabels: [], sellersById: {}, isLoading: false, isFetching: false, isError: false, error: null, isEmpty: true, hasData: false, refetch: () => {}, queryEnabled: false, remoteLeadsEnabled: false },
  }),
}));
vi.mock('@/lib/hooks/useRemoteLeadStageMoveController', () => ({
  useRemoteLeadStageMoveController: () => ({
    attemptMove: vi.fn(), isLeadPending: () => false, errorCodeByLead: {}, clearError: vi.fn(),
  }),
}));
vi.mock('@/lib/flags', () => ({ isSuperAdminCommercialReadEnabled: () => false }));
vi.mock('@/components/commercial/PlatformCommercialClientsView', () => ({ PlatformCommercialClientsView: () => <div /> }));
vi.mock('@/components/commercial/PlatformCommercialPipelineView', () => ({ PlatformCommercialPipelineView: () => <div /> }));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => m.tasks(), update: vi.fn() },
  PipelineService: { getStages: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  SellerService: { getAll: () => [] },
}));

import { ScreenPendencias } from '@/components/screens/ScreensOps';

beforeEach(() => {
  m.isLocalCommercialDataAllowed.mockReset();
  m.tasks.mockReset().mockReturnValue([]);
  m.user.current = { id: 'user-1', name: 'Gerente', email: 'g@a.com', activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
});

describe('ScreenPendencias — isolamento por modo', () => {
  it('modo NÃO local: não chama TaskService.getAll, mostra estado indisponível, nenhuma tarefa antiga aparece', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(false);
    m.tasks.mockReturnValue([{ id: 't1', title: 'Ligar para Cliente Antigo', lead: 'Cliente Antigo', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    render(<ScreenPendencias go={() => {}} />);
    expect(m.tasks).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-commercial-unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Cliente Antigo')).toBeNull();
    expect(screen.queryByText('Nova pendência')).toBeNull();
  });

  it('modo local: renderiza pendências normalmente (comportamento preservado)', () => {
    m.isLocalCommercialDataAllowed.mockReturnValue(true);
    m.tasks.mockReturnValue([{ id: 't1', title: 'Ligar para Juliana', lead: 'Juliana', when: 'Hoje', prio: 'alta', state: 'atrasada', note: '' }]);
    render(<ScreenPendencias go={() => {}} />);
    expect(screen.getByText('Ligar para Juliana')).toBeInTheDocument();
    expect(screen.queryByTestId('local-commercial-unavailable')).toBeNull();
  });
});
