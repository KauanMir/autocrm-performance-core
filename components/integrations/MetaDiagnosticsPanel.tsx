'use client';
// components/integrations/MetaDiagnosticsPanel.tsx — P2.6A. Botão "Executar
// diagnóstico" do card Meta Lead Ads. Defesa em profundidade: além de o pai
// (ScreenAjustes) já só montar a aba para Super Admin + company de teste +
// flag, o painel reavalia a MESMA capability (canAccessMetaIntegrationsReviewTab)
// e renderiza null se qualquer gate falhar.
//
// O JWT vem de AuthService.getSession (mesmo mecanismo do resto do card), vai
// SÓ no header Authorization via fetchMetaDiagnosticsRequest, e nunca é
// renderizado, logado, guardado ou posto em URL. O browser não chama a Graph:
// só renderiza o view-model sanitizado devolvido pelo endpoint do CRM.
import React, { useCallback, useState } from 'react';
import { LBtn } from '@/components/ui/kit';
import { AuthService } from '@/lib/services';
import { canAccessMetaIntegrationsReviewTab } from '@/lib/capabilities';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import {
  fetchMetaDiagnosticsRequest,
  type DiagnosticGraphFailure,
  type DiagnosticStatus,
  type MetaDiagnosticsReport,
} from '@/lib/integrations/metaDiagnosticsRequest';

const MISSING_SESSION_ERROR = 'Sua sessão expirou. Entre novamente.';
const GENERIC_ERROR = 'Não foi possível executar o diagnóstico.';

type PanelState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: MetaDiagnosticsReport }
  | { kind: 'error'; message: string };

function statusLabel(value: DiagnosticStatus): string {
  return value === 'ok' ? 'OK' : value === 'failed' ? 'Falhou' : 'Não executado';
}

function yesNo(value: boolean | null, yes = 'Sim', no = 'Não'): string {
  return value === null ? 'Não verificado' : value ? yes : no;
}

function failureLabel(failure: DiagnosticGraphFailure): string {
  const parts = [`tipo ${failure.kind}`];
  if (failure.httpStatus !== undefined) parts.push(`HTTP ${failure.httpStatus}`);
  if (failure.graphCode !== undefined) parts.push(`código ${failure.graphCode}`);
  if (failure.graphSubcode !== undefined) parts.push(`subcódigo ${failure.graphSubcode}`);
  if (failure.graphType) parts.push(failure.graphType);
  return parts.join(' · ');
}

function errorMessageFor(code: string): string {
  if (code === 'unauthenticated') return `${MISSING_SESSION_ERROR} (${code})`;
  return `${GENERIC_ERROR} (${code})`;
}

export function MetaDiagnosticsPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  const currentUser = AuthService.getCurrentUser();
  const allowed = canAccessMetaIntegrationsReviewTab({
    platformRole: currentUser?.platformRole ?? null,
    companyId,
    reviewFlagEnabled: isMetaIntegrationsReviewEnabled(),
  });

  const run = useCallback(async () => {
    setState({ kind: 'running' });
    try {
      const { data } = await AuthService.getSession();
      const accessToken = data.session?.access_token ?? null;
      if (!accessToken) {
        setState({ kind: 'error', message: MISSING_SESSION_ERROR });
        return;
      }
      const result = await fetchMetaDiagnosticsRequest(companyId, accessToken);
      if (result.outcome === 'ok') setState({ kind: 'done', report: result.report });
      else if (result.outcome === 'domain_error') setState({ kind: 'error', message: errorMessageFor(result.code) });
      else setState({ kind: 'error', message: GENERIC_ERROR });
    } catch {
      setState({ kind: 'error', message: GENERIC_ERROR });
    }
  }, [companyId]);

  if (!allowed) return null;

  const running = state.kind === 'running';
  return (
    <div data-testid="meta-diagnostics-panel" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line, #e5e7eb)' }}>
      <LBtn kind="ghost" icon="refresh" onClick={() => { if (!running) void run(); }}
        style={{ opacity: running ? 0.6 : 1, cursor: running ? 'not-allowed' : 'pointer' }}>
        {running ? 'Executando…' : 'Executar diagnóstico'}
      </LBtn>

      {state.kind === 'error' && (
        <div role="alert" data-testid="meta-diagnostics-error"
          style={{ marginTop: 10, fontSize: 12.5, color: 'var(--red)' }}>
          {state.message}
        </div>
      )}

      {state.kind === 'done' && (
        <div data-testid="meta-diagnostics-result" style={{ marginTop: 14, fontSize: 13, display: 'grid', gap: 4 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Diagnóstico Meta</div>
          <span>Conexão: {statusLabel(state.report.connection)}{state.report.connectionFailure ? ` (${state.report.connectionFailure})` : ''}</span>
          <span>Token: {statusLabel(state.report.tokenDecrypt)}</span>
          <span>Página: {statusLabel(state.report.pageIdentity)}</span>
          <span>App inscrito: {yesNo(state.report.appSubscribed)}</span>
          <span>leadgen inscrito: {yesNo(state.report.leadgenSubscribed)}</span>
          <span>Formulários acessíveis: {yesNo(state.report.leadgenFormsAccessible)}</span>
          {state.report.formsCount !== null && (
            <span>Formulários encontrados: {state.report.formsCount}{state.report.formsCountTruncated ? ' (lista truncada)' : ''}</span>
          )}
          <span>Formulário smoke: {state.report.smokeFormAccessible === null ? 'Não verificado' : !state.report.smokeFormAccessible ? 'Não encontrado' : state.report.smokeFormActive ? 'Ativo' : 'Inativo'}</span>
          <span>Graph: {state.report.graphVersion}</span>
          <span>Modo do app: Verificar manualmente</span>
          {(Object.entries(state.report.graphErrors) as [string, DiagnosticGraphFailure][]).map(([key, failure]) => (
            <span key={key} data-testid={`meta-diagnostics-graph-error-${key}`} style={{ color: 'var(--red)' }}>
              Erro Graph ({key}): {failureLabel(failure)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
