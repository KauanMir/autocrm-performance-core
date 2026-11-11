// KAPA Leads → CRM — painel em Ajustes > Integrações. Camada de dados mockada.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient } from '@/tests/helpers/renderWithQueryClient';

const mocks = vi.hoisted(() => ({
  fetchKapaLeadsSyncHealth: vi.fn(),
  fetchKapaLeadsReview: vi.fn(),
  upsertKapaLeadsLink: vi.fn(),
  setKapaLeadsLinkEnabled: vi.fn(),
  requeueKapaLeadsEvent: vi.fn(),
  dismissKapaLeadsEvent: vi.fn(),
}));

vi.mock('@/lib/integrations/kapaLeadsSync', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/kapaLeadsSync')>();
  return { ...original, ...mocks };
});

import { KapaLeadsSyncPanel } from '@/components/integrations/KapaLeadsSyncPanel';

const COMPANY = 'c1';
const STORE = '11111111-1111-4111-8111-111111111111';
const LINK = {
  linkId: 'l1', kapaStoreId: STORE, storeLabel: 'RCAR Seminovos', vehicleFormKey: null, enabled: true,
  activatedAt: new Date(Date.now() - 3600_000).toISOString(), lastPolledAt: new Date().toISOString(),
  lastSuccessAt: new Date().toISOString(), lastErrorCode: null, consecutiveFailures: 0,
  pendingCount: 0, failedCount: 1, processed7d: 12, oldestPendingAt: null, lastProcessedAt: null,
};
const FAILED = {
  eventId: 'e1', status: 'failed' as const, campaignName: 'Fábrica de Aprovação', sourceCreatedAt: '2026-11-11T12:00:00Z',
  receivedAt: '2026-11-11T12:01:00Z', attempts: 1, lastErrorCode: 'duplicate_phone_ambiguous', nextAttemptAt: null,
};

beforeEach(() => {
  mocks.fetchKapaLeadsSyncHealth.mockResolvedValue([LINK]);
  mocks.fetchKapaLeadsReview.mockResolvedValue([FAILED]);
  mocks.setKapaLeadsLinkEnabled.mockResolvedValue(false);
  mocks.requeueKapaLeadsEvent.mockResolvedValue('requeued');
  mocks.upsertKapaLeadsLink.mockResolvedValue({ linkId: 'l2', enabled: false });
});

describe('KapaLeadsSyncPanel', () => {
  it('Manager vê saúde e revisão, sem controles de vínculo nem dados do cliente', async () => {
    renderWithQueryClient(<KapaLeadsSyncPanel companyId={COMPANY} isSuperAdmin={false} />);
    expect(await screen.findByText('RCAR Seminovos')).toBeTruthy();
    expect(screen.getByText('Sincronizando')).toBeTruthy();
    expect(screen.getByText(/Recebidos \(7 dias\): 12/)).toBeTruthy();
    expect(await screen.findByText(/mais de um lead ativo com este telefone/)).toBeTruthy();
    expect(screen.queryByTestId('kapa-leads-link-form')).toBeNull();
    expect(screen.queryByText('Pausar sincronização')).toBeNull();
  });

  it('Manager pede nova tentativa de um item em revisão', async () => {
    renderWithQueryClient(<KapaLeadsSyncPanel companyId={COMPANY} isSuperAdmin={false} />);
    fireEvent.click(await screen.findByText('Tentar de novo'));
    await waitFor(() => expect(mocks.requeueKapaLeadsEvent).toHaveBeenCalledWith(COMPANY, 'e1'));
    expect(await screen.findByText('Nova tentativa agendada.')).toBeTruthy();
  });

  it('Super Admin pausa e vincula loja (UUID validado antes de enviar)', async () => {
    renderWithQueryClient(<KapaLeadsSyncPanel companyId={COMPANY} isSuperAdmin />);
    fireEvent.click(await screen.findByText('Pausar sincronização'));
    await waitFor(() => expect(mocks.setKapaLeadsLinkEnabled).toHaveBeenCalledWith(COMPANY, 'l1', false));
    expect(await screen.findByText(/simuladores continuam funcionando/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('ID da loja no KAPA Leads'), { target: { value: 'não-é-uuid' } });
    fireEvent.change(screen.getByLabelText('Nome da loja'), { target: { value: 'Vitrine' } });
    fireEvent.click(screen.getByText('Salvar vínculo'));
    expect(mocks.upsertKapaLeadsLink).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('ID da loja no KAPA Leads'), { target: { value: STORE.toUpperCase() } });
    fireEvent.click(screen.getByText('Salvar vínculo'));
    await waitFor(() => expect(mocks.upsertKapaLeadsLink).toHaveBeenCalledWith({ companyId: COMPANY, kapaStoreId: STORE, storeLabel: 'Vitrine', vehicleFormKey: null }));
  });

  it('alerta quando o vínculo ligado não sincroniza há mais de 15 minutos', async () => {
    mocks.fetchKapaLeadsSyncHealth.mockResolvedValue([{ ...LINK, lastSuccessAt: new Date(Date.now() - 20 * 60_000).toISOString(), lastErrorCode: 'source_unauthorized', consecutiveFailures: 3 }]);
    renderWithQueryClient(<KapaLeadsSyncPanel companyId={COMPANY} isSuperAdmin={false} />);
    expect(await screen.findByText('Sem sincronizar')).toBeTruthy();
    expect(screen.getByText(/Assinatura recusada/)).toBeTruthy();
    expect(screen.getByText(/Nenhuma consulta bem-sucedida há mais de 15 minutos/)).toBeTruthy();
  });

  it('Manager sem vínculo não vê o painel', async () => {
    mocks.fetchKapaLeadsSyncHealth.mockResolvedValue([]);
    mocks.fetchKapaLeadsReview.mockResolvedValue([]);
    const { container } = renderWithQueryClient(<KapaLeadsSyncPanel companyId={COMPANY} isSuperAdmin={false} />);
    await waitFor(() => expect(mocks.fetchKapaLeadsSyncHealth).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="kapa-leads-sync-panel"]')).toBeNull());
  });
});
