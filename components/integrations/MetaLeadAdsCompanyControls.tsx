'use client';
// components/integrations/MetaLeadAdsCompanyControls.tsx — META-MVP2.
//
// MetaLeadAdsAccessToggle: Super Admin habilita/desabilita Lead Ads para a
//   empresa aberta (desligado por padrão). O banco recusa qualquer outro papel.
// MetaUnroutedEventsPanel: Super Admin vê os eventos retidos sem empresa e libera
//   os da Página conectada à empresa aberta.
// MetaPageSelectionPanel: depois do OAuth, o callback volta com o marcador
//   `meta_select=1` (sem segredo). O painel lista as Páginas elegíveis (só id e
//   nome) e conecta a escolhida. O token assinado da seleção fica num cookie
//   HttpOnly e nenhum token da Meta passa pelo navegador.
import { useEffect, useRef, useState } from 'react';
import { LBadge, LBtn } from '@/components/ui/kit';
import {
  useAdoptMetaUnrouted,
  useMetaLeadAdsAccess,
  useMetaUnroutedEvents,
  useSelectablePages,
  useSelectMetaPage,
  useSetMetaLeadAdsAccess,
} from '@/lib/hooks/useMetaLeadOps';
import { MetaLeadOpsError, MetaPageSelectionError, type AdoptUnroutedOutcome, type MetaUnroutedGroup, type UnroutedReason } from '@/lib/integrations/metaLeadOps';

const muted: React.CSSProperties = { fontSize: 12.5, color: 'var(--t-500)' };
const alertStyle: React.CSSProperties = {
  marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--red-bg)',
  border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12.5,
};

export const PAGE_SELECTION_ERRORS: Record<string, string> = {
  selection_expired: 'A seleção expirou. Conecte a Meta novamente.',
  selection_invalid: 'Link de seleção inválido. Conecte a Meta novamente.',
  selection_unavailable: 'Esta seleção não está mais disponível. Conecte a Meta novamente.',
  selection_already_used: 'Esta seleção já foi usada. Conecte a Meta novamente para trocar de Página.',
  page_not_offered: 'Esta Página não estava entre as autorizadas.',
  page_already_connected: 'Esta Página já está vinculada a outra empresa no CRM.',
  company_access_disabled: 'Lead Ads não está habilitado para esta empresa.',
  page_token_invalid: 'A Meta não confirmou a credencial desta Página.',
  page_token_short_lived: 'A credencial desta Página vence em breve. Conecte novamente.',
  page_token_inspection_failed: 'Não foi possível verificar a credencial na Meta. Conecte a Meta novamente.',
  page_read_engagement_failed: 'A Meta não liberou a leitura desta Página. Conecte a Meta novamente.',
  page_subscription_failed: 'A Meta recusou a inscrição da Página para receber leads. Conecte a Meta novamente.',
  connection_lookup_failed: 'Não foi possível conferir esta Página agora. Tente de novo.',
  connection_persist_failed: 'A conexão não foi salva. Os leads desta Página ficam guardados até você conectar a Meta novamente.',
  token_decrypt_failed: 'Não foi possível concluir a conexão. Conecte a Meta novamente.',
  forbidden: 'Você não tem permissão para concluir esta conexão.',
  unavailable: 'Não foi possível concluir a conexão. Tente de novo.',
};

// Falhas que não consomem a seleção: a lista continua na tela. Nas demais a
// seleção já foi usada e o único caminho é um novo OAuth.
const SELECTION_STILL_OPEN = new Set(['page_not_offered', 'page_already_connected', 'connection_lookup_failed', 'unavailable']);

export function pageSelectionErrorMessage(err: unknown): string {
  const code = err instanceof MetaPageSelectionError ? err.code : 'unavailable';
  return PAGE_SELECTION_ERRORS[code] ?? 'Não foi possível concluir a conexão. Conecte a Meta novamente.';
}

function isSelectionStillOpen(err: unknown): boolean {
  return err instanceof MetaPageSelectionError && SELECTION_STILL_OPEN.has(err.code);
}

export function MetaLeadAdsAccessToggle({ companyId }: { companyId: string }) {
  const access = useMetaLeadAdsAccess(companyId, true);
  const setAccess = useSetMetaLeadAdsAccess(companyId);
  const [error, setError] = useState<string | null>(null);
  const enabled = access.data === true;
  // Sem leitura confirmada não há botão: a ação depende do estado real.
  const ready = !access.isLoading && !access.isError;
  return (
    <div data-testid="meta-lead-ads-access" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Lead Ads para esta empresa:</strong>
        {access.isLoading && <span style={muted}>Carregando…</span>}
        {ready && <LBadge tone={enabled ? 'green' : 'amber'}>{enabled ? 'Habilitado' : 'Desabilitado'}</LBadge>}
        {ready && (
          <LBtn kind="ghost" size="sm"
            onClick={() => {
              if (setAccess.isPending) return;
              setError(null);
              setAccess.mutate(!enabled, {
                onError: (err) => setError(err instanceof MetaLeadOpsError && err.code === 'company_not_active'
                  ? 'A empresa precisa estar ativa para receber leads.'
                  : 'Não foi possível alterar a habilitação.'),
              });
            }}>
            {enabled ? 'Desabilitar' : 'Habilitar'}
          </LBtn>
        )}
      </div>
      <div style={{ ...muted, marginTop: 4 }}>Somente o Super Admin altera. Desabilitado, nenhum lead é criado para a empresa.</div>
      {access.isError && <div role="alert" style={alertStyle}>Não foi possível ler a habilitação desta empresa.</div>}
      {error && <div role="alert" style={alertStyle}>{error}</div>}
    </div>
  );
}

const UNROUTED_REASON_LABEL: Record<UnroutedReason, string> = {
  no_connection: 'Página sem conexão ativa',
  company_disabled: 'Empresa desabilitada',
  ambiguous_owner: 'Mais de uma empresa com esta Página',
};

const ADOPT_MESSAGE: Record<Exclude<AdoptUnroutedOutcome, 'adopted'>, string> = {
  nothing_pending: 'Não há eventos retidos para esta Página.',
  not_connected: 'A Página não está conectada a esta empresa.',
  company_disabled: 'Habilite o Lead Ads para esta empresa antes de liberar.',
  owner_conflict: 'Esta Página está vinculada a outra empresa.',
};

interface UnroutedPage {
  pageId: string;
  pending: number;
  reasons: UnroutedReason[];
  canAdopt: boolean;
}

function groupByPage(groups: readonly MetaUnroutedGroup[]): UnroutedPage[] {
  const pages = new Map<string, UnroutedPage>();
  for (const group of groups) {
    const page = pages.get(group.pageId) ?? { pageId: group.pageId, pending: 0, reasons: [], canAdopt: false };
    page.pending += group.pending;
    page.reasons.push(group.reason);
    page.canAdopt = page.canAdopt || group.canAdopt;
    pages.set(group.pageId, page);
  }
  return [...pages.values()];
}

export function MetaUnroutedEventsPanel({ companyId }: { companyId: string }) {
  const unrouted = useMetaUnroutedEvents(companyId, true);
  const adopt = useAdoptMetaUnrouted(companyId);
  const [message, setMessage] = useState<string | null>(null);

  if (unrouted.isError) {
    return <div role="alert" style={{ ...alertStyle, marginBottom: 16 }}>Não foi possível ler os eventos retidos.</div>;
  }
  const pages = groupByPage(unrouted.data ?? []);
  if (pages.length === 0 && !message) return null;

  return (
    <div data-testid="meta-unrouted-events" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      {pages.length > 0 && (
        <>
          <strong style={{ fontSize: 13 }}>Eventos retidos</strong>
          <div style={{ ...muted, marginTop: 4 }}>
            Leads que chegaram sem empresa responsável. Ficam guardados por até 90 dias e só entram no CRM quando liberados.
          </div>
        </>
      )}
      {pages.map((page) => (
        <div key={page.pageId} data-testid="meta-unrouted-page" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 12.5 }}>
          <LBadge tone="amber">{page.pending === 1 ? '1 evento' : `${page.pending} eventos`}</LBadge>
          <span>Página {page.pageId}</span>
          <span style={muted}>{page.reasons.map((reason) => UNROUTED_REASON_LABEL[reason]).join(' · ')}</span>
          {page.canAdopt && (
            <LBtn kind="ghost" size="sm"
              onClick={() => {
                if (adopt.isPending) return;
                setMessage(null);
                adopt.mutate(page.pageId, {
                  onSuccess: (result) => setMessage(result.outcome === 'adopted'
                    ? `Liberados para esta empresa: ${result.adopted}.`
                    : ADOPT_MESSAGE[result.outcome]),
                  onError: () => setMessage('Não foi possível liberar os eventos.'),
                });
              }}>
              {adopt.isPending ? 'Liberando…' : 'Liberar para esta empresa'}
            </LBtn>
          )}
        </div>
      ))}
      {message && <div role="status" style={{ ...muted, marginTop: 8 }}>{message}</div>}
    </div>
  );
}

// Volta do OAuth com falha: só textos deste catálogo vão para a tela, nunca o
// valor recebido na URL.
const OAUTH_RETURN_ERRORS: Record<string, string> = {
  provider_error: 'A conexão com a Meta foi cancelada. Conecte novamente quando quiser.',
  missing_required_permission: 'Faltou autorizar uma permissão. Conecte a Meta novamente e aceite todas.',
  no_eligible_page: 'Nenhuma Página com permissão de anúncios foi encontrada nesta conta.',
  company_access_disabled: 'Lead Ads não está habilitado para esta empresa.',
};
const OAUTH_RETURN_GENERIC = 'Não foi possível concluir a conexão com a Meta. Tente novamente.';

interface OAuthReturnMarkers {
  selection: boolean;
  errorMessage: string | null;
}

function readOAuthReturnOnce(): OAuthReturnMarkers {
  if (typeof window === 'undefined') return { selection: false, errorMessage: null };
  const url = new URL(window.location.href);
  const selection = url.searchParams.has('meta_select');
  const errorCode = url.searchParams.get('meta_error');
  if (selection || errorCode !== null) {
    // Remove os marcadores da barra de endereço: recarregar não os repete.
    url.searchParams.delete('meta_select');
    url.searchParams.delete('meta_error');
    window.history.replaceState(null, '', url.toString());
  }
  return { selection, errorMessage: errorCode === null ? null : OAUTH_RETURN_ERRORS[errorCode] ?? OAUTH_RETURN_GENERIC };
}

// Externo: só lê (uma vez) e limpa os marcadores da URL. Os hooks de consulta só
// montam quando há uma seleção de verdade.
export function MetaPageSelectionPanel({ companyId }: { companyId: string }) {
  const markerRef = useRef<OAuthReturnMarkers | undefined>(undefined);
  const [markers, setMarkers] = useState<OAuthReturnMarkers>({ selection: false, errorMessage: null });
  useEffect(() => {
    if (markerRef.current !== undefined) return;
    markerRef.current = readOAuthReturnOnce();
    setMarkers(markerRef.current);
  }, []);
  if (markers.errorMessage) return <div role="alert" style={{ ...alertStyle, marginBottom: 14 }}>{markers.errorMessage}</div>;
  if (!markers.selection) return null;
  return <PageSelectionBody companyId={companyId} />;
}

function PageSelectionBody({ companyId }: { companyId: string }) {
  const pages = useSelectablePages(companyId, true);
  const select = useSelectMetaPage(companyId);
  const [chosen, setChosen] = useState<string | null>(null);

  if (select.isSuccess) {
    return (
      <div data-testid="meta-page-connected" style={{ marginBottom: 16 }}>
        <LBadge tone="green">Página conectada</LBadge>
        <div style={{ ...muted, marginTop: 6 }}>
          {select.data.pageName} passa a enviar os leads dos formulários para esta empresa.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="meta-page-selection" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>Escolha a Página desta empresa</div>
      {pages.isLoading && <div style={muted}>Carregando Páginas autorizadas…</div>}
      {pages.isError && <div role="alert" style={alertStyle}>{pageSelectionErrorMessage(pages.error)}</div>}
      {select.isError && !isSelectionStillOpen(select.error) && (
        <div role="alert" style={alertStyle}>{pageSelectionErrorMessage(select.error)}</div>
      )}
      {pages.data && (!select.isError || isSelectionStillOpen(select.error)) && (
        <>
          <div role="radiogroup" aria-label="Páginas autorizadas" style={{ display: 'grid', gap: 6 }}>
            {pages.data.map((page) => (
              <label key={page.pageId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="radio" name="meta-page" value={page.pageId} checked={chosen === page.pageId}
                  onChange={() => setChosen(page.pageId)} />
                {page.pageName}
              </label>
            ))}
          </div>
          <div style={{ ...muted, marginTop: 6 }}>Só a Página escolhida é conectada. As demais são descartadas.</div>
          <div style={{ marginTop: 10 }}>
            <LBtn kind="primary"
              onClick={() => {
                if (!chosen || select.isPending) return;
                select.mutate(chosen);
              }}
              style={{ opacity: !chosen || select.isPending ? 0.6 : 1 }}>
              {select.isPending ? 'Conectando…' : 'Conectar esta Página'}
            </LBtn>
          </div>
          {select.isError && <div role="alert" style={alertStyle}>{pageSelectionErrorMessage(select.error)}</div>}
        </>
      )}
    </div>
  );
}
