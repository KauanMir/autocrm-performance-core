// lib/hooks/useStartMetaOAuth.ts — mutation do início do fluxo OAuth Meta
// (META-OAUTH-REVIEW-UI). Único caminho: POST /api/integrations/meta/oauth/
// start via lib/integrations/metaOAuthStartRequest.ts — nunca monta a URL
// de autorização no cliente. Mesmo molde de lib/hooks/useUpdateUserEmail.ts
// (identidade por parâmetro, token buscado no momento do submit, geração de
// cache descartada se a identidade mudar).
import { useMutation } from '@tanstack/react-query';
import { startMetaOAuthRequest, type StartMetaOAuthFlow, type StartMetaOAuthResult } from '@/lib/integrations/metaOAuthStartRequest';

export type UseStartMetaOAuthOptions = {
  companyId: string | null;
  // Resolvido pelo chamador (canAccessMetaIntegrationsReviewTab — Super
  // Admin + company de teste). A autoridade real é o Route Handler
  // (revalida Super Admin + company internamente).
  authorized: boolean;
  flow?: StartMetaOAuthFlow;
  // Resolvido pelo chamador (nunca lido aqui via AuthService) — token
  // FRESCO buscado no momento do submit.
  getAccessToken: () => Promise<string | null>;
  // Injetável para teste — default navega o browser de verdade.
  navigate?: (url: string) => void;
};

export const START_META_OAUTH_LOCAL_ERRORS = {
  notAllowed: 'start-meta-oauth-not-allowed',
  missingCompany: 'start-meta-oauth-missing-company',
  missingSession: 'start-meta-oauth-missing-session',
} as const;

function defaultNavigate(url: string): void {
  window.location.href = url;
}

// Nunca texto bruto do backend — só o catálogo fechado de códigos de
// app/api/integrations/meta/oauth/start/route.ts (nunca importado aqui).
export function getStartMetaOAuthErrorMessage(value: unknown): string {
  const localMessage = value instanceof Error ? value.message : undefined;
  switch (localMessage) {
    case START_META_OAUTH_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para iniciar esta conexão.';
    case START_META_OAUTH_LOCAL_ERRORS.missingCompany:
    case START_META_OAUTH_LOCAL_ERRORS.missingSession:
      return 'Sua sessão expirou. Entre novamente.';
    default:
      break;
  }
  // Catálogo fechado do backend (unauthenticated/forbidden/etc.) e falha de
  // rede: mesma mensagem genérica pedida pela especificação — nunca detalhe
  // interno.
  return 'Não foi possível iniciar a conexão com a Meta.';
}

export type UseStartMetaOAuthResult = {
  startMetaOAuth: () => Promise<StartMetaOAuthResult>;
  isPending: boolean;
  reset: () => void;
};

export function useStartMetaOAuth(options: UseStartMetaOAuthOptions): UseStartMetaOAuthResult {
  const { companyId, authorized, flow, getAccessToken, navigate = defaultNavigate } = options;

  const mutation = useMutation<StartMetaOAuthResult, unknown, void>({
    mutationFn: async () => {
      if (!authorized) throw new Error(START_META_OAUTH_LOCAL_ERRORS.notAllowed);
      if (!companyId) throw new Error(START_META_OAUTH_LOCAL_ERRORS.missingCompany);

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(START_META_OAUTH_LOCAL_ERRORS.missingSession);

      const result = await startMetaOAuthRequest(companyId, accessToken, flow);
      if (result.outcome === 'ok') {
        navigate(result.authorizationUrl);
      }
      return result;
    },
  });

  return {
    startMetaOAuth: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
