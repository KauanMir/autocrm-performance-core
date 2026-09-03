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
// ⚠️  A CONFIRMAR NO META FOR DEVELOPERS ANTES DE PRODUÇÃO / APP REVIEW
//     (ver docs/META-OAUTH.md):
//   1. VERSÃO DA GRAPH API — DEFAULT_GRAPH_API_VERSION é um ponto de
//      partida explícito; confirme a versão configurada no app "KAPA CRM"
//      (ou defina META_GRAPH_API_VERSION).
//   2. PERMISSÕES DA CONFIGURATION — a Configuration criada no painel
//      deverá contemplar o conjunto mínimo necessário ao nosso caso
//      (Lead Ads), abaixo em PRODUCT_PERMISSIONS_UNDER_REVIEW, conforme a
//      confirmação final de App Review. NÃO solicitar Instagram / WhatsApp
//      / Messenger.
//   3. `override_default_response_type` — confirmar/alinhar com o
//      "response type" default escolhido ao criar a Configuration.
import { getMetaGraphApiVersionOverride } from '@/lib/server/meta-oauth/env';

// Host fixo do diálogo OAuth da Meta (a versão entra no path).
export const OAUTH_DIALOG_HOST = 'https://www.facebook.com';

// Ver item (1). Ponto de partida explícito — NÃO é definitivo.
export const DEFAULT_GRAPH_API_VERSION = 'v21.0';

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
