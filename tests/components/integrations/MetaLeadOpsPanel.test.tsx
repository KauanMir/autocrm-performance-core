// META-MVP1 — painel de operação Lead Ads. Repositório e sessão mockados.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient } from '@/tests/helpers/renderWithQueryClient';

const mocks = vi.hoisted(() => ({
  fetchMetaConnectionHealth: vi.fn(),
  fetchMetaLeadReview: vi.fn(),
  fetchMetaFormMappings: vi.fn(),
  requeueMetaLeadEventRequest: vi.fn(),
  dismissMetaLeadEvent: vi.fn(),
  setMetaFormMapping: vi.fn(),
  deleteMetaFormMapping: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/integrations/metaLeadOps', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/metaLeadOps')>();
  return {
    ...original,
    fetchMetaConnectionHealth: mocks.fetchMetaConnectionHealth,
    fetchMetaLeadReview: mocks.fetchMetaLeadReview,
    fetchMetaFormMappings: mocks.fetchMetaFormMappings,
    requeueMetaLeadEventRequest: mocks.requeueMetaLeadEventRequest,
    dismissMetaLeadEvent: mocks.dismissMetaLeadEvent,
    setMetaFormMapping: mocks.setMetaFormMapping,
    deleteMetaFormMapping: mocks.deleteMetaFormMapping,
  };
});
vi.mock('@/lib/services', () => ({ AuthService: { getSession: mocks.getSession } }));

import { MetaLeadOpsPanel } from '@/components/integrations/MetaLeadOpsPanel';

const COMPANY = 'c1';
const HEALTH = {
  integrationId: 'i1', pageId: '1', pageName: 'Página Teste', status: 'error', lastErrorCode: 'token_invalid',
  lastErrorAt: null, connectedAt: null, leadgenSubscribedAt: null, tokenOrigin: 'exchanged_long_lived',
  tokenExpiresAt: null, tokenDataAccessExpiresAt: null, tokenCheckedAt: '2026-11-01T00:00:00.000Z',
};
const FAILED = {
  eventId: 'e1', reviewState: 'failed', status: 'failed', lastErrorCode: 'missing_phone', errorKind: 'terminal',
  attempts: 1, requeueCount: 0, receivedAt: '2026-11-05T12:00:00.000Z', nextAttemptAt: '2026-11-05T12:00:00.000Z',
  updatedAt: '2026-11-05T12:00:00.000Z', formId: '1086', leadgenId: '9990001', canRequeue: true, canDismiss: true,
};
const SUMMARY = { failedOpen: 1, retrying: 0, stuck: 0, pending: 0, processedLast7d: 3, dismissedLast30d: 0, lastReceivedAt: null, lastProcessedAt: null };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.fetchMetaConnectionHealth.mockResolvedValue([HEALTH]);
  mocks.fetchMetaLeadReview.mockResolvedValue({ summary: SUMMARY, items: [FAILED] });
  mocks.fetchMetaFormMappings.mockResolvedValue([{ formId: '1086', target: 'vehicle', fieldKey: 'qual_carro', updatedAt: '' }]);
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'fake-jwt' } } });
});

describe('MetaLeadOpsPanel', () => {
  it('mostra conexão em erro, resumo, item da fila com ação sugerida e mapeamento', async () => {
    renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} />);
    expect(await screen.findByText('Reconexão necessária')).toBeInTheDocument();
    expect(await screen.findByTestId('meta-review-item')).toBeInTheDocument();
    expect(screen.getByText('Formulário sem telefone brasileiro válido')).toBeInTheDocument();
    expect(screen.getByText(/Eventos técnicos de recebimento\. Não são leads/)).toBeInTheDocument();
    expect(screen.getByTestId('meta-review-summary')).toHaveTextContent('Falhas abertas: 1');
    expect(await screen.findByTestId('meta-form-mapping')).toHaveTextContent('qual_carro');
  });

  it('Reprocessar chama a rota com o token da sessão e mostra o resultado', async () => {
    mocks.requeueMetaLeadEventRequest.mockResolvedValue({ outcome: 'requeued', processingScheduled: true });
    renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} />);
    fireEvent.click(await screen.findByText('Reprocessar'));
    expect(await screen.findByText('Reprocessamento agendado.')).toBeInTheDocument();
    expect(mocks.requeueMetaLeadEventRequest).toHaveBeenCalledWith(COMPANY, 'e1', 'fake-jwt');
  });

  it('Encerrar envia o motivo escolhido', async () => {
    mocks.dismissMetaLeadEvent.mockResolvedValue('dismissed');
    renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} />);
    fireEvent.change(await screen.findByLabelText('Motivo do encerramento'), { target: { value: 'test_event' } });
    fireEvent.click(screen.getByText('Encerrar'));
    await waitFor(() => expect(mocks.dismissMetaLeadEvent).toHaveBeenCalledWith(COMPANY, 'e1', 'test_event'));
  });

  it('mapeamento: valida o ID do formulário antes de enviar', async () => {
    renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} />);
    fireEvent.change(await screen.findByLabelText('ID do formulário'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Nome do campo no formulário'), { target: { value: 'carro' } });
    fireEvent.click(screen.getByText('Salvar'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o ID numérico do formulário');
    expect(mocks.setMetaFormMapping).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('ID do formulário'), { target: { value: '1086' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(mocks.setMetaFormMapping).toHaveBeenCalledWith(COMPANY, { formId: '1086', target: 'vehicle', fieldKey: 'carro' }));
  });

  it('fila vazia mostra estado vazio; sem autorização não consulta nada', async () => {
    mocks.fetchMetaLeadReview.mockResolvedValue({ summary: SUMMARY, items: [] });
    const view = renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} />);
    expect(await screen.findByTestId('meta-review-empty')).toBeInTheDocument();
    view.unmount();
    for (const fn of Object.values(mocks)) fn.mockClear();
    renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} authorized={false} />);
    expect(mocks.fetchMetaLeadReview).not.toHaveBeenCalled();
    expect(mocks.fetchMetaConnectionHealth).not.toHaveBeenCalled();
  });
});

describe('MetaLeadOpsPanel — evento parado', () => {
  it('não promete nova tentativa automática quando o evento está parado', async () => {
    mocks.fetchMetaLeadReview.mockResolvedValue({
      summary: { ...SUMMARY, stuck: 1 },
      items: [{ ...FAILED, reviewState: 'stuck', status: 'received', lastErrorCode: 'graph_error', canDismiss: false }],
    });
    renderWithQueryClient(<MetaLeadOpsPanel companyId={COMPANY} />);
    expect(await screen.findByText('Parado')).toBeInTheDocument();
    expect(screen.getByText(/verifique o agendador ou reprocesse agora/)).toBeInTheDocument();
    expect(screen.queryByText('Nova tentativa automática.')).not.toBeInTheDocument();
  });
});
