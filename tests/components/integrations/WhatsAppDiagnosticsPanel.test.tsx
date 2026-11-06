// tests/components/integrations/WhatsAppDiagnosticsPanel.test.tsx — W2B-2.
// Gates de visibilidade, Authorization Bearer, renderização do relatório
// sanitizado, erros e ausência de token. fetch mockado: nenhuma rede.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  AuthService: { getSession: m.getSession, getCurrentUser: m.getCurrentUser },
}));

import { WhatsAppDiagnosticsPanel } from '@/components/integrations/WhatsAppDiagnosticsPanel';
import { META_OAUTH_REVIEW_TEST_COMPANY_ID } from '@/lib/capabilities';

const TEST_COMPANY = META_OAUTH_REVIEW_TEST_COMPANY_ID;
const PILOT_COMPANY = '22222222-2222-4222-8222-222222222222';
const JWT = 'fake.jwt.must-never-render-123456';
const BUTTON = 'Executar diagnóstico WhatsApp';

const okBody = {
  ok: true,
  integrationStatus: 'awaiting_waba_confirmation',
  ingestion: 'disabled',
  config: { webhookVerifyToken: true, appSecret: true, tokenEncryptionKey: true },
  connection: { state: 'connected', count: 1, connectedAt: '2026-11-04T20:42:29.164Z', lastErrorCode: null },
  capture: { enabledConnections: null, contentEncryptionKey: false, contactHmacKey: false },
  events: { availability: 'unavailable', count: null },
  wabaSubscription: 'not_confirmed',
  deployment: { environment: 'production', commitSha: '4b59e4b' },
  warnings: [],
};

let fetchMock: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

async function runDiagnostics() {
  render(<WhatsAppDiagnosticsPanel companyId={TEST_COMPANY} />);
  fireEvent.click(screen.getByText(BUTTON));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'true');
  m.getCurrentUser.mockReturnValue({ platformRole: 'super_admin' });
  m.getSession.mockResolvedValue({ data: { session: { access_token: JWT } } });
  fetchMock = vi.spyOn(globalThis, 'fetch');
  respond(okBody);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  m.getSession.mockReset();
  m.getCurrentUser.mockReset();
});

describe('WhatsAppDiagnosticsPanel — gates de visibilidade', () => {
  it('outra empresa, mesmo Super Admin → nada renderizado', () => {
    render(<WhatsAppDiagnosticsPanel companyId={PILOT_COMPANY} />);
    expect(screen.queryByTestId('whatsapp-diagnostics-panel')).toBeNull();
  });

  it.each([
    ['Manager', { platformRole: null, role: 'manager' }],
    ['Seller', { platformRole: null, role: 'seller' }],
    ['usuário ausente', null],
  ])('%s na company de teste → nada renderizado', (_label, user) => {
    m.getCurrentUser.mockReturnValue(user);
    render(<WhatsAppDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.queryByText(BUTTON)).toBeNull();
  });

  it('flag da aba desligada → nada renderizado', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    render(<WhatsAppDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.queryByText(BUTTON)).toBeNull();
  });

  it('Super Admin + company de teste → botão visível, sem chamada automática', () => {
    render(<WhatsAppDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.getByText(BUTTON)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WhatsAppDiagnosticsPanel — chamada e renderização', () => {
  it('GET com Authorization Bearer no header; JWT fora da URL', async () => {
    await runDiagnostics();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/integrations/whatsapp/diagnostics?company_id=${TEST_COMPANY}`);
    expect(url).not.toContain(JWT);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
  });

  it('mostra o estado sanitizado, sem declarar a inscrição confirmada', async () => {
    await runDiagnostics();
    const result = await screen.findByTestId('whatsapp-diagnostics-result');
    expect(result).toHaveTextContent('Status: Aguardando confirmação da inscrição na WABA');
    expect(result).toHaveTextContent('Ingestão: Desabilitada');
    expect(result).toHaveTextContent('Chave de criptografia: Formato válido');
    expect(result).toHaveTextContent('Conexão da TEST COMPANY: Conectada');
    expect(result).toHaveTextContent('Eventos no ledger: Não disponível');
    expect(result).toHaveTextContent('Inscrição do KAPA CRM na WABA: Não confirmada (verificação manual)');
    expect(result).toHaveTextContent('Deployment: Production · 4b59e4b');
    expect(screen.queryByTestId('whatsapp-diagnostics-ingestion-warning')).toBeNull();
  });

  it('ingestão habilitada → alerta visível', async () => {
    respond({ ...okBody, ingestion: 'enabled', warnings: ['ingestion_enabled'] });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-ingestion-warning')).toBeInTheDocument();
    expect(screen.getByTestId('whatsapp-diagnostics-result')).toHaveTextContent('Ingestão: Habilitada');
  });

  it('API dizendo inscrição confirmada não muda o texto: valor é ignorado', async () => {
    respond({ ...okBody, wabaSubscription: 'confirmed' });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-result')).toHaveTextContent('Não confirmada');
  });

  it.each([
    ['disconnected', 'Desconectada'],
    ['error', 'Com erro'],
    ['absent', 'Não encontrada'],
    ['unavailable', 'Não disponível'],
  ])('conexão %s não é apresentada como conectada', async (state, label) => {
    respond({
      ...okBody,
      integrationStatus: state === 'unavailable' ? 'unavailable' : 'connection_not_ready',
      connection: { ...okBody.connection, state },
    });
    await runDiagnostics();
    const result = await screen.findByTestId('whatsapp-diagnostics-result');
    expect(result).toHaveTextContent(`Conexão da TEST COMPANY: ${label}`);
    expect(result).not.toHaveTextContent('Conexão da TEST COMPANY: Conectada');
  });

  it('estado de conexão desconhecido invalida o relatório', async () => {
    respond({ ...okBody, connection: { ...okBody.connection, state: 'healthy' } });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-error')).toBeInTheDocument();
    expect(screen.queryByTestId('whatsapp-diagnostics-result')).toBeNull();
  });

  it('sem resumo no banco, eventos e captura ficam "Não disponível"', async () => {
    await runDiagnostics();
    const result = await screen.findByTestId('whatsapp-diagnostics-result');
    expect(result).toHaveTextContent('Eventos no ledger: Não disponível');
    expect(result).toHaveTextContent('Mensagens capturadas: Não disponível');
    expect(result).toHaveTextContent('Captura de mensagens: Não disponível');
    expect(result).toHaveTextContent('Chave de conteúdo: Ausente ou inválida');
  });

  it('com resumo, mostra contagens e o estado da captura', async () => {
    respond({
      ...okBody,
      capture: { enabledConnections: 1, contentEncryptionKey: true, contactHmacKey: true },
      events: {
        availability: 'available', count: 7, pending: 1, failed: 2, messages: 4, lastEventAt: null,
        refused: { wabaMismatch: 1, contactUnresolved: 1, groupMessage: 0 },
      },
    });
    await runDiagnostics();
    const result = await screen.findByTestId('whatsapp-diagnostics-result');
    expect(result).toHaveTextContent('Eventos no ledger: 7 (1 pendentes, 2 com falha)');
    expect(result).toHaveTextContent('Mensagens capturadas: 4');
    expect(result).toHaveTextContent('Captura de mensagens: Habilitada');
    expect(result).toHaveTextContent('Recusadas por WABA divergente: 1');
    expect(result).toHaveTextContent('Recusadas por contato não identificado: 1');
    expect(result).toHaveTextContent('Recusadas por serem de grupo: 0');
  });

  it('recusas geram alerta sem expor valores', async () => {
    respond({ ...okBody, warnings: ['messages_refused'] });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-refused-warning')).toHaveTextContent('Há mensagens recusadas');
  });

  it('contagem inválida vira "Não disponível", nunca 0', async () => {
    respond({
      ...okBody,
      events: {
        availability: 'available', count: '7', pending: 1, failed: 2, messages: 4,
        refused: { wabaMismatch: 0, contactUnresolved: 0, groupMessage: 0 },
      },
    });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-result')).toHaveTextContent('Eventos no ledger: Não disponível');
  });

  it('captura sem chaves válidas → alerta visível', async () => {
    respond({ ...okBody, warnings: ['capture_keys_invalid'] });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-capture-keys-warning')).toBeInTheDocument();
  });

  it('deployment desconhecido → "Não identificado"', async () => {
    respond({ ...okBody, deployment: { environment: null, commitSha: null } });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-result')).toHaveTextContent('Deployment: Não identificado');
  });

  it('campos extras e valores fora do formato não chegam ao DOM', async () => {
    respond({
      ...okBody,
      waba_id: 'LEAK-WABA',
      connection: { ...okBody.connection, lastErrorCode: 'LEAK Bearer abc', connectedAt: 'LEAK-DATE' },
      deployment: { environment: 'production', commitSha: 'LEAK-SHA' },
    });
    await runDiagnostics();
    await screen.findByTestId('whatsapp-diagnostics-result');
    expect(document.body.textContent).not.toContain('LEAK');
  });

  it('enum desconhecido invalida o relatório → erro genérico', async () => {
    respond({ ...okBody, integrationStatus: 'success' });
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-error')).toHaveTextContent('Não foi possível executar o diagnóstico.');
    expect(screen.queryByTestId('whatsapp-diagnostics-result')).toBeNull();
  });
});

describe('WhatsAppDiagnosticsPanel — erros e sigilo', () => {
  it.each([
    [401, 'unauthenticated', 'Sua sessão expirou'],
    [403, 'forbidden', 'Não foi possível executar o diagnóstico.'],
    [500, 'server_misconfigured', 'Não foi possível executar o diagnóstico.'],
  ])('HTTP %s → mensagem segura', async (status, error, message) => {
    respond({ ok: false, error }, status);
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-error')).toHaveTextContent(message);
  });

  it('sem sessão → não chama a API', async () => {
    m.getSession.mockResolvedValue({ data: { session: null } });
    render(<WhatsAppDiagnosticsPanel companyId={TEST_COMPANY} />);
    fireEvent.click(screen.getByText(BUTTON));
    expect(await screen.findByTestId('whatsapp-diagnostics-error')).toHaveTextContent('Sua sessão expirou');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha de rede → erro genérico', async () => {
    fetchMock.mockRejectedValue(new Error('boom-detail'));
    await runDiagnostics();
    expect(await screen.findByTestId('whatsapp-diagnostics-error')).toHaveTextContent('Não foi possível executar o diagnóstico.');
    expect(document.body.textContent).not.toContain('boom-detail');
  });

  it('JWT nunca aparece no DOM, em logs ou no storage', async () => {
    await runDiagnostics();
    await screen.findByTestId('whatsapp-diagnostics-result');
    const logs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');
    expect(document.body.innerHTML).not.toContain(JWT);
    expect(logs).not.toContain(JWT);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(JWT);
  });
});
