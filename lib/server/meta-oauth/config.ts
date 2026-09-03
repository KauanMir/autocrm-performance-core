// lib/server/meta-oauth/config.ts — configuração EXPLÍCITA do fluxo
// "Login do Facebook para Empresas" (Facebook Login for Business, FLB).
//
// FLUXO CONFIRMADO (documentação oficial atual da Meta):
//   - endpoint do diálogo: https://www.facebook.com/<version>/dialog/oauth
//   - a URL de autorização usa `config_id=<CONFIG_ID>` — NÃO `scope=`.
//     "config_id has replaced scope (which should not be used)".
//   - `response_type=code` (fluxo authorization-code, server-side);
//   - `override_default_response_type=true` para garantir que
//     `response_type=code` prevaleça sobre o default da Configuration;
//   - `redirect_uri` precisa bater EXATAMENTE com uma das "Valid OAuth
//     Redirect URIs" do app;
//   - `state` continua sendo enviado (CSRF), devolvido no redirect.
//   - As PERMISSÕES são definidas DENTRO da Configuration no painel Meta,
//     não na URL.
//
// ESTADO EM PRODUCTION (confirmado): a Configuration do FLB já foi criada,
// a Redirect URI já foi cadastrada e META_GRAPH_API_VERSION=v26.0. O
// fluxo real já foi testado com sucesso (ambiente controlado KAPA CRM
// Teste — nunca com cliente piloto).
//
// ⚠️  Ainda A CONFIRMAR (App Review / Advanced Access) — ver docs/META-OAUTH.md:
//   - PERMISSÕES DA CONFIGURATION — o conjunto necessário ao caso Lead Ads
//     (abaixo em PRODUCT_PERMISSIONS_UNDER_REVIEW) precisa passar por App
//     Review / Advanced Access antes do rollout para clientes. NÃO
//     solicitar Instagram / WhatsApp / Messenger.
import { getMetaGraphApiVersionOverride } from '@/lib/server/meta-oauth/env';

// Host fixo do diálogo OAuth da Meta (a versão entra no path).
export const OAUTH_DIALOG_HOST = 'https://www.facebook.com';

// Default defensivo. Em Production a env META_GRAPH_API_VERSION está
// definida como v26.0 (valor efetivo); este default só é usado se a env
// estiver ausente/mal formada. Mantido igual ao valor de Production para
// não haver divergência silenciosa.
export const DEFAULT_GRAPH_API_VERSION = 'v26.0';

// Path (relativo a APP_URL) do callback já publicado.
export const CALLBACK_PATH = '/api/integrations/meta/oauth/callback';

// PERMISSÕES NECESSÁRIAS AO PRODUTO — em avaliação para o caso Lead Ads.
// Estas NÃO são enviadas na authorization URL (o FLB as define na
// Configuration). Ficam aqui só como registro do que a Configuration
// deverá conter, sujeito à confirmação final de App Review.
export const PRODUCT_PERMISSIONS_UNDER_REVIEW: readonly string[] = [
  'pages_show_list', // listar as Páginas que o usuário administra
  'pages_read_engagement', // ler metadados/conteúdo da Página
  'pages_manage_metadata', // assinar a Página nos webhooks do app (leadgen)
  'leads_retrieval', // ler os dados do lead via Graph (GET /{leadgen_id})
];

export function resolveGraphApiVersion(): string {
  return getMetaGraphApiVersionOverride() ?? DEFAULT_GRAPH_API_VERSION;
}
