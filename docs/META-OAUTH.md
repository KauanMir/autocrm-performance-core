# Integração Meta — OAuth "Login do Facebook para Empresas"

Documento separado de `docs/META-WEBHOOK.md` (webhook leadgen) de propósito
— são fluxos distintos.

Rotas:
- `POST /api/integrations/meta/oauth/start` — inicia o fluxo (autenticado).
- `GET  /api/integrations/meta/oauth/callback` — recebe o retorno da Meta.

**Fluxo confirmado: Facebook Login for Business (FLB)** — a URL de
autorização usa `config_id` (que **substitui** `scope`); as permissões são
definidas **dentro da Configuration** no painel Meta, não na URL. Ver
["Fluxo oficial da Meta"](#fluxo-oficial-da-meta-facebook-login-for-business)
e ["Permissões vs parâmetros da URL"](#permissoes-necessarias-ao-produto-vs-parametros-da-authorization-url).

Redirect URI (a cadastrar IDÊNTICA na Meta, ainda **não** cadastrada):
`https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`

Implementação: `app/api/integrations/meta/oauth/{start,callback}/route.ts`
+ `lib/server/meta-oauth/*` (`env`, `config`, `state`, `authorize-url`,
`cookie`, `logger`).

## Status atual

| Item | Status |
|---|---|
| `POST /start` (autenticado) | **Existe** — autentica, resolve company, autoriza, seta cookie de binding, devolve `authorizationUrl`. **Não redireciona, não chama Graph API, não troca code, não persiste.** |
| `GET /callback` | **Existe** — valida assinatura + expiração + **binding do cookie** + contexto; trata erro da Meta; nunca expõe o `code`; limpa o cookie ao consumir. |
| `state` assinado (HMAC-SHA256) | **Existe** — stateless, TTL curto, agora com `uid`/`cid`/`b` opcionais. |
| Cookie anti-CSRF `kapa_meta_oauth_binding` | **Existe** — HttpOnly, SameSite=Lax, Path do fluxo, Max-Age 600s, Secure em produção. |
| Authorization URL | **Fluxo FLB** — `config_id` + `response_type=code` + `override_default_response_type=true`; **sem `scope`**. |
| Envs `META_OAUTH_STATE_SECRET`, `META_APP_ID`, `META_LOGIN_CONFIG_ID`, `META_GRAPH_API_VERSION` (opcional) | Placeholders vazios em `.env.local.example`. **Não configuradas** na Vercel. |
| Configuration do FLB criada na Meta | **Não** — `META_LOGIN_CONFIG_ID` ainda sem valor; `/start` falha fechado sem ela. |
| Redirect URI cadastrada na Meta | **Não.** |
| Troca `code` -> access token | **Não implementada.** |
| Persistência de integração / token | **Não existe** (sem tabela, sem migration). |
| UI / botão "Conectar Meta" | **Não existe.** |
| App Review / Advanced Access | **Não solicitado.** |
| Conexão de qualquer company | **Nenhuma.** |

## Arquitetura do `/start`

`POST /api/integrations/meta/oauth/start` — **só POST** (nunca um GET
público de iniciar OAuth). Body opcional: `{ "company_id"?: "<uuid>" }`.

### Autenticação

Mecanismo real do CRM, reutilizado sem reimplementar:
`requireAuthenticatedActor(request)` (`lib/server/invites/http.ts`) —
exige `Authorization: Bearer <jwt Supabase>` e revalida via
`auth.getUser(jwt)` (nunca decodifica o JWT localmente). Sem Bearer válido
→ `401 unauthenticated`. Também aplica `isOriginAllowed` (mesma postura
CSRF de origem dos outros POSTs do projeto) → `403 invalid_origin`.

### Resolução da company

- Se o body traz `company_id` (UUID) → é o **alvo** a validar (nunca
  aceito como autoridade).
- Senão → `current_membership_company_id()` (RPC `SECURITY DEFINER`,
  deriva de `auth.uid()`; devolve a company da **única** membership ativa;
  `NULL` para Super Admin ou se houver 0/>1).
- Sem company resolvível → `403 company_unresolved`.

### Autorização (papel/permissão)

Roles reais do CRM: plataforma `profiles.platform_role = 'super_admin'`;
company `public.company_role = ('manager','seller')` — **não existe
`admin`/`sdr`/`owner`**.

Permissão mínima usada: **`is_manager_or_platform(p_target_company_id)`**
(RPC `SECURITY DEFINER`, `GRANT EXECUTE` a `authenticated`) → `TRUE` para
**Super Admin da plataforma com acesso à empresa** OU **membership
`manager` ativa daquela empresa**; **`FALSE` para `seller`**. Cobre num
único ponto: "tem acesso à company" + "tem papel para conectar integração
empresarial". Falha → `403 forbidden`.

### Binding anti-CSRF + `state`

1. `binding = randomBytes(32).toString('base64url')` (CSPRNG).
2. Cookie `kapa_meta_oauth_binding = <binding>`:
   `HttpOnly; SameSite=Lax; Path=/api/integrations/meta/oauth; Max-Age=600`
   `; Secure` **apenas** quando `NODE_ENV === 'production'`.
   Valor invisível ao JavaScript.
3. `state = createOAuthState({ secret, binding, userId, companyId, ttlSeconds: 600 })`
   → payload `{ v:1, p:"meta_oauth", n, iat, exp, b: sha256(binding), uid, cid }`.
   **Só o hash do binding entra no state**; o valor bruto só no cookie
   (double-submit). Nunca access token, App Secret, senha ou PII.

### Resposta do `/start`

`200 { ok:true, stage:"authorization_url_ready",
flow:"facebook_login_for_business", authorizationUrl, redirectUri,
responseType:"code", graphApiVersion, expiresInSeconds:600 }` +
`Set-Cookie`. **Sem** campo `scopes` (o fluxo FLB não usa `scope`). **Não**
faz `302` (devolver a URL em JSON simplifica os testes; uma UI futura fará
`window.location = authorizationUrl`).

| Situação | Resposta |
|---|---|
| `META_OAUTH_STATE_SECRET` / `META_APP_ID` / `META_LOGIN_CONFIG_ID` / `APP_URL` ausente/inválida | `500 server_misconfigured` |
| Origin divergente | `403 invalid_origin` |
| Body malformado / `company_id` não-UUID / chave extra | `400 invalid_body` |
| Sem Bearer válido | `401 unauthenticated` |
| Company não resolvível | `403 company_unresolved` |
| Sem papel (seller / sem acesso) | `403 forbidden` |
| OK | `200` + cookie |

## `/callback` — ordem de validação (state + binding gate)

Todo callback — **inclusive quando a Meta devolve `error`** (usuário
cancelou/negou) — passa pelo mesmo gate antes de qualquer tratamento.
Não há caminho que responda sem provar que o retorno pertence a um fluxo
iniciado por `POST .../oauth/start`.

| # | Checagem | Falha → |
|---|---|---|
| 0 | `META_OAUTH_STATE_SECRET` presente/válida | `500 server_misconfigured` |
| 1 | há `code` **ou** `error` | `400 invalid_request` |
| 2 | `state` presente (vale p/ `code` **e** p/ `error`) | `400 state_missing` |
| 3 | cookie `kapa_meta_oauth_binding` presente | `400 binding_missing` |
| 4 | assinatura HMAC do `state` | `400 state_invalid` |
| 4 | `state` não expirado | `400 state_expired` |
| 4 | `sha256(cookie)` == `payload.b` (timing-safe) | `400 binding_invalid` (+ limpa cookie) |
| 5 | **só então**: `error` presente → `400 provider_error` (sanitizado, sem `error_description`), limpa cookie |
| 6 | `code` presente → `200 { ok:true, stage:"callback_received", context:{ userIdPresent, companyIdPresent } }`, limpa cookie |

O cookie de binding é **consumido (limpo, `Max-Age=0`)** em todos os ramos
a partir do passo 4 — sucesso ou erro.

Continua: **não** troca `code` por token, **não** persiste, **não** chama
Graph API; `code` nunca na resposta nem em log (só `codeLength`); `state`
integral, binding, cookies, JWT e `error_description` bruto **nunca**
logados (só um marcador sanitizado do `error` da Meta, `[A-Za-z0-9._-]`,
cortado curto).

## Env vars

| Var | Papel | Regras |
|---|---|---|
| `META_OAUTH_STATE_SECRET` | Chave HMAC INTERNA do `state` (64 hex / 32 bytes) | server-only, sem `NEXT_PUBLIC_`, **não** reutilizar `META_APP_SECRET`. Ausente → `/start` e `/callback` 500. |
| `META_APP_ID` | App ID **público** da Meta (só dígitos) → `client_id` na URL | server-only nesta fase. Ausente → `/start` 500. |
| `META_LOGIN_CONFIG_ID` | ID da **Configuration** do FLB (só dígitos) → `config_id` na URL. Define as permissões (no painel Meta), **substitui `scope`**. | server-only, sem `NEXT_PUBLIC_`, público (não é segredo). **Ainda não criado** na Meta. Ausente → `/start` 500. |
| `META_GRAPH_API_VERSION` | **Opcional.** Versão da Graph API (`v<major>.<minor>`) | ausente/inválida → default de `config.ts`. |
| `APP_URL` (já existente) | Origem confiável; deriva `redirect_uri` e valida Origin | precisa ser exatamente `https://crm.assessoriakapa.com.br` em produção. |

`META_APP_SECRET` **não** entra na construção da URL de autorização (só é
usado, futuramente, na troca server-to-server de `code` por token).

## Fluxo oficial da Meta (Facebook Login for Business)

Determinado pela documentação oficial atual da Meta (`developers.facebook.com`,
seções *Facebook Login for Business* e *Manually Build a Login Flow*):

- **Endpoint do diálogo**: `https://www.facebook.com/<version>/dialog/oauth`
  (mesmo endpoint do Facebook Login clássico; a versão vai no path).
- **`config_id` substitui `scope`.** Citação da doc: *"config_id has
  replaced scope (which should not be used)"* / *"include your
  configuration ID as an optional parameter (although scope can still be
  included, we recommend that you do not use it)"*.
- **`response_type=code`** — fluxo authorization-code, server-side.
- **`override_default_response_type=true`** — para `response_type=code`
  prevalecer sobre o "response type" default definido na Configuration.
- **`redirect_uri`** — precisa bater **exatamente** com uma das *Valid
  OAuth Redirect URIs* do app; o redirect devolve `code` + `state` como
  query params.
- **`state`** — continua sendo enviado (CSRF) e devolvido no redirect.
- **Permissões**: definidas **dentro da Configuration** no App Dashboard
  (*Facebook Login for Business → Configurations*), **não** na URL.

Nosso código **anterior** montava a URL no formato **OAuth clássico**
(`scope=<lista>`), que não é o fluxo correto para o produto "Login do
Facebook para Empresas". **Foi corrigido nesta etapa** para o fluxo FLB.

## Permissões necessárias ao produto  ≠  parâmetros da authorization URL

### Permissões necessárias ao produto (vão na Configuration, no painel Meta)

Em avaliação para o caso **Lead Ads** (registro em
`config.ts` → `PRODUCT_PERMISSIONS_UNDER_REVIEW`), sujeito à confirmação
final de App Review:

| Permissão | Por quê |
|---|---|
| `pages_show_list` | listar as Páginas que o usuário administra |
| `pages_read_engagement` | ler metadados/conteúdo da Página |
| `pages_manage_metadata` | assinar a Página nos webhooks do app (leadgen) |
| `leads_retrieval` | ler os dados do lead via Graph (`GET /{leadgen_id}`) |

**NÃO** solicitar: Instagram, WhatsApp, Messenger. Não acrescentar
permissões extras sem justificativa oficial atual. Estas permissões
**não** são enviadas na URL — deverão ser marcadas na Configuration do
FLB quando ela for criada no painel.

### Parâmetros enviados na authorization URL (montados em `authorize-url.ts`)

`https://www.facebook.com/<version>/dialog/oauth?` +

| Parâmetro | Valor |
|---|---|
| `client_id` | `META_APP_ID` |
| `config_id` | `META_LOGIN_CONFIG_ID` |
| `redirect_uri` | `<APP_URL>` + `/api/integrations/meta/oauth/callback` |
| `response_type` | `code` |
| `override_default_response_type` | `true` |
| `state` | `state` assinado (HMAC + `uid`/`cid` + hash do binding) |

**`scope` NÃO é enviado.** Nenhum segredo na URL (`META_APP_SECRET` nunca
entra aqui).

### ⚠️ A confirmar no Meta for Developers antes de produção / App Review

1. **Criar a Configuration** do FLB no painel e copiar o `config_id` para
   `META_LOGIN_CONFIG_ID` (ver "O que configurar manualmente" no fim).
2. **Permissões da Configuration** — marcar o conjunto acima; confirmar
   com App Review se `leads_retrieval` (e Advanced Access) cobrem o caso,
   e se `business_management`/`ads_management` são necessários conforme a
   propriedade do formulário/negócio da concessionária.
3. **`override_default_response_type`** — alinhar com o "response type"
   default escolhido ao criar a Configuration (mandamos `true` +
   `response_type=code` para garantir o fluxo code de qualquer forma).
4. **Versão da Graph API** — `DEFAULT_GRAPH_API_VERSION` em `config.ts` é
   `v21.0` como ponto de partida explícito; confirmar a versão do app "KAPA
   CRM" e ajustar (ou definir `META_GRAPH_API_VERSION`).
5. **Redirect URI** — cadastrar em *Valid OAuth Redirect URIs* **idêntica**
   a `https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`
   (ver abaixo).

## APP_URL / redirect URI

O `redirect_uri` é montado como `new URL('/api/integrations/meta/oauth/callback', APP_URL.origin)`
— a **única** fonte é a env **`APP_URL`** (nunca Host/Origin da
requisição). Em Production o `redirect_uri` resultante precisa ser
**exatamente**:

`https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`

**Antes do deploy**: confirmar na Vercel que `APP_URL` em Production é
exatamente `https://crm.assessoriakapa.com.br` — sem barra final, sem path
adicional, sem `www.`. `APP_URL` **não** foi alterado nesta etapa.

## Logging (`lib/server/meta-oauth/logger.ts`)

Allowlist: `requestId`, `operation` (`oauth_start` | `oauth_callback`),
`result`, `reason`, `providerErrorCode` (sanitizado), `codePresent`,
`codeLength`, `statePresent`, `bindingCookiePresent`,
`authenticatedUserPresent`, `companyResolved`, `permissionGranted`,
`bindingSet`, `durationMs`.
**Nunca**: header Authorization / JWT, `code` (nem parcial), access/refresh
token, App Secret, verify token, `state` completo, binding (bruto ou
hash), cookies, sessão, `error_description` bruto, PII.

## Feature flag / pilotos

- Integração **inacessível pela UI** — não há tela, botão, menu, card,
  badge nem `GET` público. `POST /start` só responde a Manager/Super Admin
  autenticado e ainda assim só devolve uma URL.
- **Nenhuma company recebe ativação**; nenhuma configuração é criada
  automaticamente.
- A futura funcionalidade visível Meta nascerá **default OFF** (padrão do
  projeto: `NEXT_PUBLIC_FF_*=false`) e a **conexão** será habilitada
  **por company**.
- Primeira ativação real: **tenant controlado pela Assessoria KAPA**.
- Pilotos só recebem depois de **autorização explícita**, gradualmente.

## Sem persistência (nesta fase)

Nenhuma tabela, migration, RLS. Nada é salvo: nem `state`, nem `code`, nem
token, nem `page_id`/`form_id`, nem registro de integração.

## O que ainda NÃO existe (fases separadas, futuras)

- Troca `code` -> access token (short-lived) e -> long-lived / system user
  / Page token.
- Criptografia e **persistência** de token em banco (**migration + RLS por
  company** — fase própria).
- Seleção de Página / conta de anúncios / formulário.
- Vínculo `page_id` -> `company_id`.
- Lead retrieval, criação de lead, App Review, Advanced Access.
- Instagram / WhatsApp / Messenger.
- Desautorização e Data Deletion Callback técnico.
- Rate limiting dedicado das rotas OAuth (o projeto tem o padrão
  `reserve_*_rate_limit` via RPC, reaproveitável).
- UI (tela/botão "Conectar Meta"), atrás de flag default OFF.

## Dívidas técnicas

1. **Criar a Configuration do FLB** no painel Meta e preencher
   `META_LOGIN_CONFIG_ID`; confirmar permissões / versão Graph /
   `override_default_response_type` — ver bloco ⚠️ acima.
2. **Persistência da integração** — migration nova (ex.:
   `company_meta_integrations` com token cifrado, `page_id`, escopos,
   status `default OFF`) + RLS por company. Fase própria.
3. **Amarração forte user↔callback** — hoje o callback confia em
   assinatura + binding do cookie (padrão para fluxo sem sessão de
   servidor). Uma etapa futura pode exigir uma confirmação autenticada
   pós-callback antes de persistir. `verifyOAuthState` já aceita
   `expectedUserId`/`expectedCompanyId` para isso.
4. **Rotação de `META_OAUTH_STATE_SECRET`** — girar invalida states/cookies
   em voo (janela de 10 min, aceitável). Documentar procedimento.
5. **Rate limiting** das rotas `/start` e `/callback`.

## O que teremos que configurar manualmente no painel Meta (depois)

1. **Criar a Configuration** em *Facebook Login for Business →
   Configurations*, marcando as permissões da tabela "Permissões
   necessárias ao produto" (`pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `leads_retrieval`) — **sem** Instagram /
   WhatsApp / Messenger.
2. Definir o **"response type" default** da Configuration (mandamos
   `response_type=code` + `override_default_response_type=true` de todo
   modo).
3. Copiar o **Configuration ID** gerado → env **`META_LOGIN_CONFIG_ID`**
   na Vercel (server-only).
4. Em *Facebook Login → Settings → Valid OAuth Redirect URIs*: adicionar
   **exatamente**
   `https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`.
5. Confirmar a **versão da Graph API** do app (ajustar
   `DEFAULT_GRAPH_API_VERSION` ou `META_GRAPH_API_VERSION`).

## Próximos passos (depois da aprovação desta fase)

1. commit/push controlado.
2. Vercel (server-only): `META_OAUTH_STATE_SECRET` (`openssl rand -hex 32`),
   `META_APP_ID`, `META_LOGIN_CONFIG_ID` (após criar a Configuration).
   Opcional: `META_GRAPH_API_VERSION`. Confirmar `APP_URL` =
   `https://crm.assessoriakapa.com.br`.
3. Redeploy.
4. Configuração manual no painel Meta (bloco acima).
5. Fase seguinte: troca `code` -> token + persistência (migration + RLS).
6. Só então: UI atrás de flag default OFF, ativação por company começando
   pelo tenant da Assessoria KAPA.
