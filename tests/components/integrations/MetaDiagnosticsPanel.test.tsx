// tests/components/integrations/MetaDiagnosticsPanel.test.tsx — P2.6A.
// Gates (flag + Super Admin + company de teste), Authorization Bearer,
// renderização do relatório sanitizado, erros 401/403/500 e ausência de
// token no DOM/log/storage. fetch mockado: nenhuma rede, nenhuma Graph.
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

import { MetaDiagnosticsPanel } from '@/components/integrations/MetaDiagnosticsPanel';
import { META_OAUTH_REVIEW_TEST_COMPANY_ID } from '@/lib/capabilities';

const TEST_COMPANY = META_OAUTH_REVIEW_TEST_COMPANY_ID;
const PILOT_COMPANY = '22222222-2222-4222-8222-222222222222';
const JWT = 'fake.jwt.must-never-render-123456';

const okBody = {
  ok: true,
  connection: 'ok',
  tokenDecrypt: 'ok',
  pageIdentity: 'ok',
  appSubscribed: true,
  leadgenSubscribed: true,
  leadgenFormsAccessible: true,
  formsCount: 2,
  formsCountTruncated: false,
  smokeFormAccessible: true,
  smokeFormActive: true,
  graphErrors: {},
  graphVersion: 'v26.0',
  appMode: 'verify_manually',
};

let fetchMock: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
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

async function runDiagnostics() {
  fireEvent.click(screen.getByText('Executar diagnóstico'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe('MetaDiagnosticsPanel — gates de visibilidade', () => {
  it('piloto (outra company, mesmo Super Admin) → nada renderizado', () => {
    render(<MetaDiagnosticsPanel companyId={PILOT_COMPANY} />);
    expect(screen.queryByText('Executar diagnóstico')).toBeNull();
    expect(screen.queryByTestId('meta-diagnostics-panel')).toBeNull();
  });

  it('não Super Admin (manager na company de teste) → nada renderizado', () => {
    m.getCurrentUser.mockReturnValue({ platformRole: null });
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.queryByText('Executar diagnóstico')).toBeNull();
  });

  it('usuário ausente → nada renderizado', () => {
    m.getCurrentUser.mockReturnValue(null);
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.queryByText('Executar diagnóstico')).toBeNull();
  });

  it('flag desligada → nada renderizado', () => {
    vi.stubEnv('NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW', 'false');
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.queryByText('Executar diagnóstico')).toBeNull();
  });

  it('Super Admin + company de teste + flag → botão visível, sem chamada automática', () => {
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    expect(screen.getByText('Executar diagnóstico')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MetaDiagnosticsPanel — chamada e renderização', () => {
  it('GET com company_id na query e Authorization Bearer no header; JWT fora da URL', async () => {
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/integrations/meta/diagnostics?company_id=${TEST_COMPANY}`);
    expect(url).not.toContain(JWT);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JWT}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renderiza o relatório sanitizado', async () => {
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-result')).toBeInTheDocument());
    const text = screen.getByTestId('meta-diagnostics-result').textContent ?? '';
    for (const expected of [
      'Conexão: OK',
      'Token: OK',
      'Página: OK',
      'App inscrito: Sim',
      'leadgen inscrito: Sim',
      'Formulários acessíveis: Sim',
      'Formulário smoke: Ativo',
      'Graph: v26.0',
      'Modo do app: Verificar manualmente',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('erro Graph sanitizado aparece só como tipo/código numérico', async () => {
    respond({
      ...okBody,
      leadgenFormsAccessible: false,
      formsCount: null,
      formsCountTruncated: null,
      smokeFormAccessible: null,
      smokeFormActive: null,
      graphErrors: {
        leadgenForms: { kind: 'http', httpStatus: 400, graphCode: 100, graphSubcode: 33, graphType: 'GraphMethodException' },
      },
    });
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-graph-error-leadgenForms')).toBeInTheDocument());
    expect(screen.getByTestId('meta-diagnostics-graph-error-leadgenForms')).toHaveTextContent(
      'tipo http · HTTP 400 · código 100 · subcódigo 33 · GraphMethodException',
    );
    expect(screen.getByText(/Formulários acessíveis: Não/)).toBeInTheDocument();
  });

  it('descarta campos fora do catálogo (nada bruto chega ao DOM)', async () => {
    respond({
      ...okBody,
      graphVersion: 'v26.0',
      rawMessage: 'RAW-META-MESSAGE',
      access_token: 'LEAKED-TOKEN',
      graphErrors: { leadgenForms: { kind: 'http', graphType: 'Bad Type <script>', message: 'RAW-META-MESSAGE' } },
    });
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-result')).toBeInTheDocument());
    const html = document.body.innerHTML;
    expect(html).not.toContain('RAW-META-MESSAGE');
    expect(html).not.toContain('LEAKED-TOKEN');
    expect(html).not.toContain('<script>');
  });
});

describe('MetaDiagnosticsPanel — erros', () => {
  it.each([
    [401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.'],
    [403, 'forbidden', 'Não foi possível executar o diagnóstico.'],
    [500, 'server_misconfigured', 'Não foi possível executar o diagnóstico.'],
  ])('HTTP %i (%s) → mensagem sanitizada, sem resultado', async (status, code, message) => {
    respond({ ok: false, error: code }, status);
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-error')).toBeInTheDocument());
    expect(screen.getByTestId('meta-diagnostics-error')).toHaveTextContent(message);
    expect(screen.queryByTestId('meta-diagnostics-result')).toBeNull();
  });

  it('500 com corpo não-JSON → mensagem genérica, nenhum corpo bruto', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Internal Server Error SECRET-STACK</html>', { status: 500 }));
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-error')).toHaveTextContent('Não foi possível executar o diagnóstico.'));
    expect(document.body.innerHTML).not.toContain('SECRET-STACK');
  });

  it('falha de rede → mensagem genérica', async () => {
    fetchMock.mockRejectedValue(new Error(`boom ${JWT}`));
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-error')).toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain(JWT);
  });

  it('sem sessão → erro de sessão e nenhuma chamada de rede', async () => {
    m.getSession.mockResolvedValue({ data: { session: null } });
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    fireEvent.click(screen.getByText('Executar diagnóstico'));
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-error')).toHaveTextContent('Sua sessão expirou. Entre novamente.'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MetaDiagnosticsPanel — sem segredo', () => {
  it('JWT nunca no DOM, em logs ou em storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<MetaDiagnosticsPanel companyId={TEST_COMPANY} />);
    await runDiagnostics();
    await waitFor(() => expect(screen.getByTestId('meta-diagnostics-result')).toBeInTheDocument());
    const logs = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');
    expect(document.body.innerHTML).not.toContain(JWT);
    expect(logs).not.toContain(JWT);
    expect(setItem).not.toHaveBeenCalled();
  });
});
