'use client';
// components/integrations/WhatsAppDiagnosticsPanel.tsx — W2B-2. Diagnóstico do
// WhatsApp na aba "Integrações". Defesa em profundidade: além de o pai
// (ScreenAjustes) só montar a aba para Super Admin + company de teste + flag, o
// painel reavalia a MESMA capability e renderiza null se qualquer gate falhar.
// A autorização real é do endpoint.
//
// O JWT vem de AuthService.getSession, vai SÓ no header Authorization e nunca é
// renderizado, logado ou guardado. O browser só exibe o view-model sanitizado.
import React, { useCallback, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LCard } from '@/components/ui/kit';
import { canAccessMetaIntegrationsReviewTab } from '@/lib/capabilities';
import { isMetaIntegrationsReviewEnabled } from '@/lib/flags';
import {
  fetchWhatsAppDiagnosticsRequest,
  type WhatsAppConnectionState,
  type WhatsAppDiagnosticsReport,
  type WhatsAppIntegrationStatus,
} from '@/lib/integrations/whatsappDiagnosticsRequest';
import { AuthService } from '@/lib/services';

const MISSING_SESSION_ERROR = 'Sua sessão expirou. Entre novamente.';
const GENERIC_ERROR = 'Não foi possível executar o diagnóstico.';
const NOT_AVAILABLE = 'Não disponível';

const INTEGRATION_LABELS: Record<WhatsAppIntegrationStatus, string> = {
  awaiting_waba_confirmation: 'Aguardando confirmação da inscrição na WABA',
  connection_not_ready: 'Conexão não está pronta',
  misconfigured: 'Configuração incompleta',
  unavailable: 'Não foi possível consultar a conexão',
};

const CONNECTION_LABELS: Record<WhatsAppConnectionState, string> = {
  connected: 'Conectada',
  disconnected: 'Desconectada',
  error: 'Com erro',
  absent: 'Não encontrada',
  multiple: 'Mais de uma conexão',
  unavailable: NOT_AVAILABLE,
};

const ENVIRONMENT_LABELS = { production: 'Production', preview: 'Preview', development: 'Development' } as const;

type PanelState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: WhatsAppDiagnosticsReport }
  | { kind: 'error'; message: string };

function errorMessageFor(code: string): string {
  if (code === 'unauthenticated') return `${MISSING_SESSION_ERROR} (${code})`;
  return `${GENERIC_ERROR} (${code})`;
}

function deploymentLabel({ environment, commitSha }: WhatsAppDiagnosticsReport['deployment']): string {
  const parts = [environment ? ENVIRONMENT_LABELS[environment] : null, commitSha].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Não identificado';
}

function captureLabel(enabledConnections: number | null): string {
  if (enabledConnections === null) return NOT_AVAILABLE;
  return enabledConnections > 0 ? 'Habilitada' : 'Desabilitada';
}

function ReportRows({ report }: { report: WhatsAppDiagnosticsReport }) {
  const { capture, connection, config, events } = report;
  return (
    <div data-testid="whatsapp-diagnostics-result" style={{ marginTop: 14, fontSize: 13, display: 'grid', gap: 4 }}>
      {report.ingestionWarning && (
        <div role="alert" data-testid="whatsapp-diagnostics-ingestion-warning"
          style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12.5 }}>
          Ingestão habilitada antes do smoke autorizado da W2B-7. Mensagens podem ser perdidas sem conteúdo.
        </div>
      )}
      {report.captureKeysWarning && (
        <div role="alert" data-testid="whatsapp-diagnostics-capture-keys-warning"
          style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12.5 }}>
          Captura habilitada sem chaves válidas. As entregas serão recusadas para reentrega.
        </div>
      )}
      {report.refusedWarning && (
        <div role="alert" data-testid="whatsapp-diagnostics-refused-warning"
          style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12.5 }}>
          Há mensagens recusadas pela captura. O conteúdo delas não foi guardado.
        </div>
      )}
      <span>Status: {INTEGRATION_LABELS[report.integrationStatus]}</span>
      <span>Ingestão: {report.ingestion === 'enabled' ? 'Habilitada' : 'Desabilitada'}</span>
      <span>Captura de mensagens: {captureLabel(capture.enabledConnections)}</span>
      <span>Token de verificação do webhook: {config.webhookVerifyToken ? 'Configurado' : 'Ausente'}</span>
      <span>App Secret: {config.appSecret ? 'Configurado' : 'Ausente'}</span>
      <span>Chave de criptografia: {config.tokenEncryptionKey ? 'Formato válido' : 'Ausente ou inválida'}</span>
      <span>Conexão da TEST COMPANY: {CONNECTION_LABELS[connection.state]}</span>
      {connection.connectedAt && <span>Última conexão em: {new Date(connection.connectedAt).toLocaleString('pt-BR')}</span>}
      {connection.lastErrorCode && <span>Último erro: {connection.lastErrorCode}</span>}
      <span>Chave de conteúdo: {capture.contentEncryptionKey ? 'Formato válido' : 'Ausente ou inválida'}</span>
      <span>Chave de contato: {capture.contactHmacKey ? 'Formato válido' : 'Ausente ou inválida'}</span>
      <span>Eventos no ledger: {events ? `${events.count} (${events.pending} pendentes, ${events.failed} com falha)` : NOT_AVAILABLE}</span>
      <span>Mensagens capturadas: {events ? events.messages : NOT_AVAILABLE}</span>
      <span>Recusadas por WABA divergente: {events ? events.refused.wabaMismatch : NOT_AVAILABLE}</span>
      <span>Recusadas por contato não identificado: {events ? events.refused.contactUnresolved : NOT_AVAILABLE}</span>
      <span>Recusadas por serem de grupo: {events ? events.refused.groupMessage : NOT_AVAILABLE}</span>
      <span>Inscrição do KAPA CRM na WABA: Não confirmada (verificação manual)</span>
      <span>Deployment: {deploymentLabel(report.deployment)}</span>
    </div>
  );
}

export function WhatsAppDiagnosticsPanel({ companyId }: { companyId: string }) {
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
      const result = await fetchWhatsAppDiagnosticsRequest(companyId, accessToken);
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
    <LCard style={{ maxWidth: 560, marginTop: 16 }}>
      <div data-testid="whatsapp-diagnostics-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Icon name="shield" size={18} stroke={2} style={{ color: 'var(--t-500)' }} />
          <div style={{ fontWeight: 700, fontSize: 15 }}>Diagnóstico WhatsApp</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 14 }}>
          Verificação somente leitura da integração da TEST COMPANY.
        </div>
        <LBtn kind="ghost" icon="refresh" onClick={() => { if (!running) void run(); }}
          style={{ opacity: running ? 0.6 : 1, cursor: running ? 'not-allowed' : 'pointer' }}>
          {running ? 'Executando…' : 'Executar diagnóstico WhatsApp'}
        </LBtn>

        {state.kind === 'error' && (
          <div role="alert" data-testid="whatsapp-diagnostics-error"
            style={{ marginTop: 10, fontSize: 12.5, color: 'var(--red)' }}>
            {state.message}
          </div>
        )}

        {state.kind === 'done' && <ReportRows report={state.report} />}
      </div>
    </LCard>
  );
}
