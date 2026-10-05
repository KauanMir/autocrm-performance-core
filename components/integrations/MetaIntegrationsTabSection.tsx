'use client';
// components/integrations/MetaIntegrationsTabSection.tsx — META-OAUTH-
// REVIEW-UI. Aba "Integrações" de Ajustes: UI mínima e isolada só para o
// vídeo do App Review da Meta. Renderizada SOMENTE quando o chamador
// (ScreenAjustes, via canAccessMetaIntegrationsReviewTab) já autorizou
// Super Admin + company de teste — este componente não reautoriza nada,
// só consome o /start já publicado e existente.
//
// Nunca duplica lógica server-side, nunca monta a URL OAuth aqui, nunca
// coloca segredo no browser: o botão só chama POST /start (useStartMetaOAuth)
// e navega para a `authorizationUrl` devolvida. O estado de sucesso vem de
// um token EFÊMERO e assinado na querystring (`meta_review`, só presente
// quando o callback redirecionou de volta pra cá) — verificado aqui via GET
// /review-status. Nenhuma persistência: um F5 depois de a URL já ter sido
// limpa (feito abaixo, na primeira leitura) volta para "Conectar Meta".
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LBadge, LCard } from '@/components/ui/kit';
import { AuthService } from '@/lib/services';
import { useStartMetaOAuth, getStartMetaOAuthErrorMessage } from '@/lib/hooks/useStartMetaOAuth';
import { fetchMetaReviewStatusRequest } from '@/lib/integrations/metaReviewStatusRequest';

export type MetaIntegrationsTabSectionProps = {
  companyId: string;
};

const META_TEST_PAGE_LABEL = 'KAPA CRM Teste';
const GENERIC_STATUS_ERROR = 'Não foi possível confirmar a autorização.';
const MISSING_SESSION_ERROR = 'Sua sessão expirou. Entre novamente.';

type ReviewStatusState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'verified' }
  | { kind: 'status_error'; message: string };

export function MetaIntegrationsTabSection({ companyId }: MetaIntegrationsTabSectionProps) {
  const [status, setStatus] = useState<ReviewStatusState>({ kind: 'idle' });
  const [startError, setStartError] = useState<string | null>(null);
  const checkedRef = useRef(false);

  const getAccessToken = useCallback(async () => {
    const { data } = await AuthService.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const { startMetaOAuth, isPending } = useStartMetaOAuth({
    companyId,
    authorized: true,
    flow: 'review_ui',
    getAccessToken,
  });

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const token = url.searchParams.get('meta_review');
    if (!token) return;

    // O token é de uso único/efêmero (TTL curto no servidor) — a URL é
    // limpa imediatamente, antes mesmo da verificação, pra nunca sobrar
    // numa barra de endereço copiada/recarregada.
    url.searchParams.delete('meta_review');
    window.history.replaceState(null, '', url.toString());

    setStatus({ kind: 'checking' });
    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setStatus({ kind: 'status_error', message: MISSING_SESSION_ERROR });
        return;
      }
      const result = await fetchMetaReviewStatusRequest(token, accessToken);
      setStatus(result.outcome === 'ok' ? { kind: 'verified' } : { kind: 'status_error', message: GENERIC_STATUS_ERROR });
    })();
  }, [getAccessToken]);

  const handleConnect = () => {
    if (isPending) return;
    setStartError(null);
    startMetaOAuth()
      .then((result) => {
        if (result.outcome !== 'ok') {
          setStartError(getStartMetaOAuthErrorMessage(result));
        }
      })
      .catch((err) => {
        setStartError(getStartMetaOAuthErrorMessage(err));
      });
  };

  const verified = status.kind === 'verified';

  return (
    <LCard style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Icon name="bolt" size={18} stroke={2} style={{ color: 'var(--t-500)' }} />
        <div style={{ fontWeight: 700, fontSize: 15 }}>Meta Lead Ads</div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 18 }}>
        Conecte sua Página do Facebook para autorizar o recebimento de leads no KAPA CRM.
      </div>

      {verified ? (
        <div data-testid="meta-integration-verified">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Icon name="checkCircle" size={16} stroke={2.2} style={{ color: 'var(--green)' }} />
            <LBadge tone="green">Autorização Meta validada</LBadge>
          </div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            <strong>Página de teste:</strong> {META_TEST_PAGE_LABEL}
          </div>
          <div style={{ fontSize: 13, color: 'var(--t-700)', display: 'grid', gap: 4, marginBottom: 16 }}>
            <span>pages_show_list: Validado</span>
            <span>pages_read_engagement: Validado</span>
            <span>pages_manage_metadata: Validado</span>
            <span>leads_retrieval: Validado</span>
            <span>leadgen webhook: Assinado</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 18 }}>
            <Icon name="shield" size={14} stroke={2} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Fluxo de teste concluído. O token não é salvo nesta etapa.</span>
          </div>
          <LBtn kind="ghost" icon="refresh" onClick={handleConnect}
            style={{ opacity: isPending ? 0.6 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}>
            {isPending ? 'Conectando…' : 'Conectar novamente'}
          </LBtn>
        </div>
      ) : (
        <>
          {status.kind === 'checking' && (
            <div data-testid="meta-integration-checking" style={{ fontSize: 12.5, color: 'var(--t-500)', marginBottom: 14 }}>
              Verificando autorização…
            </div>
          )}
          {status.kind === 'status_error' && (
            <div role="alert" data-testid="meta-integration-status-error"
              style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12.5 }}>
              {status.message}
            </div>
          )}
          <LBtn kind="primary" icon="bolt" onClick={handleConnect}
            style={{ opacity: isPending ? 0.6 : 1, cursor: isPending ? 'not-allowed' : 'pointer' }}>
            {isPending ? 'Conectando…' : 'Conectar Meta'}
          </LBtn>
          {startError && (
            <div role="alert" data-testid="meta-integration-start-error"
              style={{ marginTop: 10, fontSize: 12.5, color: 'var(--red)' }}>
              {startError}
            </div>
          )}
        </>
      )}
    </LCard>
  );
}
