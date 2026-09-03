// lib/server/meta-oauth/authorize-url.ts — construção SERVER-SIDE da URL
// de autorização do "Login do Facebook para Empresas" (Facebook Login for
// Business). Puro: sem I/O, sem rede. Não redireciona; só devolve a
// string. Nunca coloca segredo na URL.
//
// Parâmetros (fluxo FLB confirmado):
//   client_id                       App ID público
//   config_id                       ID da Configuration (define as permissões)
//   redirect_uri                    APP_URL + CALLBACK_PATH, match exato no painel
//   response_type=code              fluxo authorization-code
//   override_default_response_type  = true, para code prevalecer sobre o
//                                   default da Configuration
//   state                           HMAC assinado (CSRF + contexto)
//
// NÃO é enviado `scope` — no FLB "config_id has replaced scope".
import {
  OAUTH_DIALOG_HOST,
  CALLBACK_PATH,
  resolveGraphApiVersion,
} from '@/lib/server/meta-oauth/config';

export interface BuildAuthorizationUrlInput {
  appId: string;
  configId: string;
  // Origem confiável do deploy (APP_URL). O redirect_uri é derivado dela +
  // CALLBACK_PATH — nunca de Host/Origin da requisição.
  appOrigin: string;
  state: string;
}

export interface BuiltAuthorizationUrl {
  url: string;
  redirectUri: string;
  configId: string;
  responseType: 'code';
  graphApiVersion: string;
}

export function buildMetaAuthorizationUrl(input: BuildAuthorizationUrlInput): BuiltAuthorizationUrl {
  const version = resolveGraphApiVersion();
  const redirectUri = new URL(CALLBACK_PATH, input.appOrigin).toString();

  const params = new URLSearchParams({
    client_id: input.appId,
    config_id: input.configId,
    redirect_uri: redirectUri,
    response_type: 'code',
    override_default_response_type: 'true',
    state: input.state,
  });

  return {
    url: `${OAUTH_DIALOG_HOST}/${version}/dialog/oauth?${params.toString()}`,
    redirectUri,
    configId: input.configId,
    responseType: 'code',
    graphApiVersion: version,
  };
}
