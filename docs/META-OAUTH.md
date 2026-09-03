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
| `POST /start` (autenticado) | ✅ **Existe** — autentica, resolve company, autoriza, seta cookie de binding, devolve `authorizationUrl`. Não redireciona, não chama Graph API, não persiste. |
| `GET /callback` | ✅ **Existe** — valida assinatura + expiração + **binding do cookie** + contexto; trata erro da Meta; **e (nova etapa) troca o `code` por access token server-side**; nunca expõe `code` nem token; limpa o cookie ao consumir. |
| Facebook Login for Business Configuration | ✅ **Criada** no painel Meta; `META_LOGIN_CONFIG_ID` **configurada** em Production. Testada no fluxo real (ambiente controlado — ver "Primeiro teste real"). |
| Redirect URI | ✅ **Cadastrada** na Meta e validada no fluxo real: `https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`. |
| `state` / binding anti-CSRF | ✅ **Existe e testado** — `state` HMAC-SHA256 stateless (`uid`/`cid`/`b`), cookie `kapa_meta_oauth_binding` HttpOnly/SameSite=Lax/Max-Age 600s/Secure em produção. |
| `authorization code` recebido | ✅ **Testado** — `{ ok: true, stage: "callback_received"|"token_exchange_verified", context: {...} }`. |
| **`code` → access token** | ✅ **Esta etapa** — troca SERVER-ONLY via **`GET graph.facebook.com/v26.0/oauth/access_token`** (método da doc oficial), `META_APP_SECRET` como `client_secret`, timeout 8 s, **sem retries**. **Token nunca devolvido/logado/persistido/em cookie; nunca aparece em log/Error mesmo estando na query da request.** |
| Authorization URL | **Fluxo FLB** — `config_id` + `response_type=code` + `override_default_response_type=true`; **sem `scope`**. |
| Envs de Production | ✅ **Configuradas na Vercel**: `APP_URL`, `META_OAUTH_STATE_SECRET`, `META_APP_ID`, `META_LOGIN_CONFIG_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION=v26.0`. `.env.local.example` mantém placeholders só para dev local. |
| Persistência de token / integração | **Não existe** (sem tabela, sem migration) — e **não é feita nesta etapa**. |
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
| 5 | **só então**: `error` presente → `400 provider_error` (sanitizado, sem `error_description`), limpa cookie, **não chama o endpoint de token** |
| 6 | `code` presente → lê `META_APP_ID`/`META_APP_SECRET`/`APP_URL` (faltando → `500 server_misconfigured`, limpa cookie) → **troca `code` por access token** (ver abaixo) |
| 7 | troca OK → `200 { ok:true, stage:"token_exchange_verified", context:{ userIdPresent, companyIdPresent }, token:{ received:true } }`, limpa cookie |
| 7 | troca falha (4xx/5xx/timeout/rede/JSON inválido/sem `access_token`) → `502 token_exchange_failed`, limpa cookie |

O cookie de binding é **consumido (limpo, `Max-Age=0`)** em todos os ramos
a partir do passo 4 — sucesso ou erro (anti-replay do binding).

`code` nunca na resposta nem em log (só `codeLength`); `state` integral,
binding, cookies, JWT, `error_description` bruto e **corpo bruto de
resposta da Meta** **nunca** logados (só marcadores sanitizados: `error`
da Meta em `[A-Za-z0-9._-]` cortado; `reason` interno da troca; status
HTTP da Meta; `token_type`/`expires_in`, que **não** são sensíveis).

### Troca `code` → access token (`lib/server/meta-oauth/token-exchange.ts`)

- **Método: `GET`, EXATAMENTE como a documentação oficial atual da Meta.**
  Confirmado em 3 páginas oficiais — nenhuma documenta `POST` /
  `x-www-form-urlencoded` para `/oauth/access_token`:
  - [*Manually Build a Login Flow*](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)
    — "*make an HTTP **GET** request to the following OAuth endpoint*"
    `GET https://graph.facebook.com/<version>/oauth/access_token?client_id=…&redirect_uri=…&client_secret=…&code=…`
  - [*Facebook Login for Business*](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/)
    — mesmo endpoint, `GET …?client_id=…&client_secret=…&code=…`
  - [*Access Token Guide*](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/)
    — `curl -X GET` para `/oauth/access_token`
- **Endpoint**: `https://graph.facebook.com/<version>/oauth/access_token`
  (`<version>` = `META_GRAPH_API_VERSION`, `v26.0` em Production).
- **Query params**: `client_id` (`META_APP_ID`), `client_secret`
  (`META_APP_SECRET`), `redirect_uri` (idêntica à do `/start`, derivada de
  `APP_URL` + `CALLBACK_PATH`), `code`.
- **`redirect_uri`**: obrigatória e idêntica à do login dialog no fluxo de
  token de usuário; inofensiva no fluxo *System User Access Token* (SUAT).
  Enviada sempre. Em Production resolve para
  `https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`.
- **Segurança do `GET`** (a query da request server-to-server carrega
  `client_secret` + `code`): a URL é construída **só em memória**
  server-side e passada ao `fetch`; **nunca** é logada (o módulo não faz
  `console.*`), **nunca** entra em `Error`/exceção (o `catch` do `fetch`
  só classifica `timeout`/`network_error`, sem tocar `err.message`/a URL),
  **nunca** aparece na resposta.
- **SUAT / Business Integration System User**: o **mesmo** endpoint
  devolve o token de usuário OU o SUAT conforme a Configuration — sem
  passo extra. `token_type`/`expires_in` podem faltar (SUAT) → parse
  tolerante; exige apenas `access_token` string não-vazia.
- **Timeout** explícito (8 s, `AbortController`), **sem retries** (o `code`
  é descartável). `redirect: 'error'` (não segue 3xx com o segredo no
  corpo).
- **Não lê o corpo de erro da Meta** (`!response.ok` → só a faixa do
  status). Nunca propaga a exceção do `fetch` (poderia carregar
  URL/inputs) — só classifica em `timeout`/`network_error`.
- **O access token** existe apenas num `const` local dentro de
  `exchangeCodeForToken()` e é **descartado no `return`** — o módulo
  devolve só `{ ok, tokenType?, expiresInSeconds?, httpStatus }` ou
  `{ ok:false, reason, httpStatus? }`. **Nunca** devolve, loga, persiste
  ou coloca em erro o token, o `code` ou o `client_secret`.
- **NÃO** usa o token para nenhuma chamada de negócio (`GET /me`, Pages,
  businesses, forms, `leads_retrieval`, `subscribe_apps`, `debug_token`…).

## Env vars

| Var | Papel | Regras |
|---|---|---|
| `META_OAUTH_STATE_SECRET` | Chave HMAC INTERNA do `state` (64 hex / 32 bytes) | server-only, sem `NEXT_PUBLIC_`, **não** reutilizar `META_APP_SECRET`. Ausente → `/start` e `/callback` 500. |
| `META_APP_ID` | App ID **público** da Meta (só dígitos) → `client_id` (URL de autorização **e** troca de token) | server-only. Ausente → `/start` **e** a troca no `/callback` falham com 500. |
| `META_APP_SECRET` | App Secret da Meta → `client_secret` na troca `code` → token. **A MESMA** variável já em Production para o webhook (`X-Hub-Signature-256`) — reutilizada aqui (é autenticação com a Meta); **não** se cria outro segredo. | **EXTREMAMENTE SENSÍVEL.** server-only, **nunca** `NEXT_PUBLIC_`, nunca client-side, nunca devolvida/logada, nunca em cookie/URL. Ausente → troca no `/callback` 500 (fail closed). Não entra na URL de autorização. |
| `META_LOGIN_CONFIG_ID` | ID da **Configuration** do FLB (só dígitos) → `config_id` na URL. Define as permissões (no painel Meta), **substitui `scope`**. | server-only, sem `NEXT_PUBLIC_`, público (não é segredo). Ausente → `/start` 500. |
| `META_GRAPH_API_VERSION` | **Opcional.** Versão da Graph API (`v<major>.<minor>`) → path do diálogo **e** do endpoint de token | ausente/inválida → default de `config.ts` (`v26.0`, igual ao valor de Production). |
| `APP_URL` (já existente) | Origem confiável; deriva `redirect_uri` (URL de autorização **e** troca de token) e valida Origin | Production: `https://crm.assessoriakapa.com.br` (já configurada). |

**Estado em Production (confirmado):** `APP_URL=https://crm.assessoriakapa.com.br`,
`META_OAUTH_STATE_SECRET`, `META_APP_ID`, `META_LOGIN_CONFIG_ID`,
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` **configurados**;
`META_GRAPH_API_VERSION=v26.0`. A **Configuration do FLB já foi criada** e
a **Redirect URI já foi cadastrada**. O `.env.local.example` mantém os
placeholders só para o dev local.

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

### Estado / pendências

- ✅ **Configuration do FLB criada**; `config_id` em `META_LOGIN_CONFIG_ID`
  (Production).
- ✅ **Versão da Graph API**: `META_GRAPH_API_VERSION=v26.0` em Production;
  `DEFAULT_GRAPH_API_VERSION` em `config.ts` igualado a `v26.0`.
- ✅ **Redirect URI** cadastrada em *Valid OAuth Redirect URIs*, idêntica a
  `https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`.
- ⚠️ **Permissões da Configuration** — `pages_show_list`,
  `pages_read_engagement`, `pages_manage_metadata`, `leads_retrieval`
  precisam passar por **App Review / Advanced Access** antes de qualquer
  rollout para clientes. Reavaliar então se `business_management` /
  `ads_management` são necessários conforme a propriedade do
  formulário/negócio da concessionária.
- ℹ️ **`override_default_response_type`** — enviamos `true` +
  `response_type=code` de qualquer forma, independente do "response type"
  default da Configuration.

## APP_URL / redirect URI

O `redirect_uri` é montado como `new URL('/api/integrations/meta/oauth/callback', APP_URL.origin)`
— a **única** fonte é a env **`APP_URL`** (nunca Host/Origin da
requisição), tanto na URL de autorização quanto na troca `code` → token.

Em Production `APP_URL=https://crm.assessoriakapa.com.br` (já configurada),
então o `redirect_uri` resultante é **exatamente**
`https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback` —
idêntico ao cadastrado em *Valid OAuth Redirect URIs*. `APP_URL` **não**
foi alterado nesta etapa.

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

## Primeiro teste real (ambiente controlado — NÃO piloto)

O fluxo completo `start → Facebook Login for Business → Configuration →
seleção Portfolio + Página → callback → state/binding validados → contexto
user/company → code recebido` foi executado com sucesso usando **apenas**:

- CRM company: `[SMOKE-SA-S1] Empresa Teste`
- Meta Business Portfolio: `KAPA CRM Teste`
- Facebook Page: `KAPA CRM Teste`

Resposta observada: `{ "ok": true, "stage": "callback_received",
"context": { "userIdPresent": true, "companyIdPresent": true } }`. A Meta
exibiu "KAPA CRM Teste foi conectada ao KAPA CRM".

**Nenhum cliente piloto foi envolvido.** O `code` daquele teste apareceu
na URL do navegador e é **descartável** — não deve ser reutilizado; um
novo fluxo OAuth será feito para validar a troca `code` → token.

## Sem persistência (nesta fase)

Nenhuma tabela, migration, RLS. Nada é salvo: nem `state`, nem `code`, nem
**access token**, nem `page_id`/`form_id`, nem portfolio/business id, nem
registro de integração. O token obtido na troca existe só em memória
durante a request e é descartado.

## O que ainda NÃO existe (fases separadas, futuras)

- **Persistência** do access token em banco, com **encryption at rest**
  (**migration + RLS por company** — fase própria).
- Troca por token de longa duração / *long-lived* / Page token (a partir
  do token já obtido).
- Seleção de Página / conta de anúncios / formulário (**Page mapping**,
  **Form mapping**).
- Vínculo `page_id` -> `company_id`.
- Lead retrieval, criação de lead, App Review, Advanced Access.
- Lead retrieval, criação de lead.
- Assinatura automática de Página nos webhooks (`subscribe_apps`).
- `debug_token` / qualquer chamada de negócio com o token.
- Instagram / WhatsApp / Messenger.
- Desautorização e Data Deletion Callback técnico.
- Rate limiting dedicado das rotas OAuth (o projeto tem o padrão
  `reserve_*_rate_limit` via RPC, reaproveitável).
- UI (tela/botão "Conectar Meta"), atrás de flag default OFF.
- Rollout para clientes pilotos.

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

## Configuração no painel Meta / Vercel — ✅ CONCLUÍDA

- ✅ Configuration do FLB criada; `META_LOGIN_CONFIG_ID` em Production.
- ✅ `Valid OAuth Redirect URIs` inclui
  `https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`
  (a **mesma** `redirect_uri` é enviada na troca `code` → token).
- ✅ Envs de Production configuradas na Vercel (ver "Estado em Production").
- ✅ `META_GRAPH_API_VERSION=v26.0` (default do código igualado a esse valor).
- ✅ Fluxo real testado com sucesso (ambiente controlado — ver abaixo).

**Ainda pendente:** permissões da Configuration precisam de **App Review /
Advanced Access** antes de qualquer rollout para clientes.

## Próximos passos (depois da aprovação desta fase)

1. commit/push controlado.
2. Redeploy (as envs já estão na Vercel).
3. Novo fluxo OAuth real (o `code` do teste anterior é descartável) para
   confirmar `stage: "token_exchange_verified"`.
4. Fase seguinte: **persistência do token** — migration nova
   (`company_meta_integrations` com token **cifrado**, `page_id`, escopos,
   status `default OFF`) + **RLS por company**. Fase própria: PARAR e
   planejar antes de implementar.
5. Depois: Page/Form mapping, `page_id → company_id`, lead retrieval,
   `subscribe_apps`, App Review / Advanced Access.
6. Só então: UI atrás de flag default OFF, ativação por company começando
   pelo tenant da Assessoria KAPA.
