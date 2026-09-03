# Integração Meta — OAuth "Login do Facebook para Empresas" (Fase: fundação)

Documento separado de `docs/META-WEBHOOK.md` (webhook leadgen) de propósito
— são fluxos distintos.

Callback planejado na Meta:
`https://crm.assessoriakapa.com.br/api/integrations/meta/oauth/callback`

Implementação:
`app/api/integrations/meta/oauth/callback/route.ts` + `lib/server/meta-oauth/*`

## Status atual

| Item | Status |
|---|---|
| Rota de callback (GET) | **Existe** — valida `state`, trata erro da Meta, responde seguro. |
| Estratégia de `state` | **Existe** — stateless, assinado por HMAC-SHA256, TTL curto. |
| Env `META_OAUTH_STATE_SECRET` | Placeholder vazio em `.env.local.example`. **Não configurada** na Vercel. |
| URI de redirect cadastrada na Meta | **Não** (fora do escopo desta fase). |
| Endpoint público de "start OAuth" | **Não existe.** |
| Troca `code` -> access token | **Não implementada.** |
| Persistência de integração / token | **Não existe** (sem tabela, sem migration). |
| UI / botão "Conectar Meta" | **Não existe.** |
| App Review / Advanced Access | **Não solicitado.** |
| Conexão de qualquer company | **Nenhuma.** |

## O que esta fase entrega

### 1. `state` seguro (`lib/server/meta-oauth/state.ts`)

Formato: `base64url(payloadJSON).base64url(HMAC_SHA256(secret, body))`

`payload = { v:1, p:"meta_oauth", n:<nonce 18 bytes CSPRNG>, iat, exp, b? }`

- **Imprevisível**: nonce de `crypto.randomBytes`.
- **Não manipulável pelo cliente**: qualquer alteração no corpo quebra o
  HMAC (comparado em tempo constante, `timingSafeEqual`).
- **Validade curta**: `exp` obrigatório, default 10 min, teto rígido 15 min.
- **Coerência de contexto**: `p` tem que ser exatamente `"meta_oauth"`;
  `v` tem que ser a versão suportada; guard de clock-skew (`iat` não pode
  estar no futuro além de 60 s).
- **Sem segredo exposto**: o corpo carrega só metadados não sensíveis.
- **Anti-CSRF**: um `state` forjado não tem assinatura válida -> rejeitado
  com `400`.
- Módulo **puro**: sem I/O, sem banco, sem rede. `createOAuthState()` para
  a futura fase de "start"; `verifyOAuthState()` usado pelo callback.

### 2. Callback (`GET .../oauth/callback`)

| Situação | Resposta | Log (`result`) |
|---|---|---|
| `META_OAUTH_STATE_SECRET` ausente/inválida | `500 {ok:false,error:"server_misconfigured"}` | `state_secret_env_missing` |
| `error` presente (Meta negou/falhou) | `400 {ok:false,error:"provider_error"}` | `provider_error` |
| Sem `code` e sem `error` | `400 {ok:false,error:"invalid_request"}` | `missing_code_and_error` |
| `state` ausente/vazio | `400 {ok:false,error:"state_missing"}` | `state_missing` |
| `state` inválido / assinatura não bate | `400 {ok:false,error:"state_invalid"}` | `state_invalid` |
| `state` expirado | `400 {ok:false,error:"state_expired"}` | `state_expired` |
| `state` válido + `code` presente | `200 {ok:true,stage:"callback_received",message:...}` | `validated_no_exchange` |

- **Nunca** troca o `code` por token. **Nunca** persiste nada. **Nunca**
  chama a Graph API.
- O `code` **nunca** aparece na resposta nem em log (só `codeLength`).
- `error_description` da Meta **nunca** é refletido na resposta; no log só
  entra uma forma sanitizada (`[A-Za-z0-9._-]`, cortada curta).
- Todas as respostas: `Cache-Control: no-store`, sem stack trace.

### 3. Logging (`lib/server/meta-oauth/logger.ts`)

Allowlist: `requestId`, `operation`, `result`, `reason` (enum interno),
`providerErrorCode` (sanitizado), `codePresent`, `codeLength`,
`statePresent`, `durationMs`.
**Nunca**: `code` (nem parcial), access/refresh token, App Secret, verify
token, `state` completo, cookies, sessão, `error_description` bruto, PII.

## O que ainda NÃO existe (fases separadas, futuras)

- Endpoint autenticado de "start OAuth" (monta a URL de autorização,
  emite o `state` e **seta o cookie HttpOnly anti-CSRF** — ver abaixo).
- Cadastro da Redirect URI na Meta.
- Troca `code` -> access token (short-lived) e -> long-lived / system user
  / Page token.
- Criptografia e persistência de token em banco.
- Seleção de Página / conta de anúncios / formulário.
- Vínculo `page_id` -> `company_id`.
- Lead retrieval, criação de lead, App Review, Advanced Access.
- Instagram / WhatsApp / Messenger.
- Desautorização e Data Deletion Callback técnico.

## Regra de feature flag — default OFF por company

- A funcionalidade visível de integração Meta (tela, botão "Conectar")
  **nasce desligada** e só aparece atrás de flag em rollout controlado
  (padrão do projeto: `NEXT_PUBLIC_FF_*=false` em `.env.local.example`).
- A **conexão** Meta é **por company**: nenhuma company existente ganha
  configuração automaticamente; clientes pilotos nunca são inscritos sem
  ação explícita.
- Testes reais começam só com um tenant controlado pela Assessoria KAPA.
- Ativação posterior é gradual, empresa por empresa.

## Dívida técnica / itens necessários antes de habilitar clientes

1. **Binding anti-CSRF por cookie (double-submit)** — `verifyOAuthState()`
   já aceita `expectedBinding`; o endpoint de "start OAuth" precisará:
   - gerar um nonce, setar `Set-Cookie` HttpOnly + `Secure` + `SameSite=Lax`
     de vida curta;
   - passar esse nonce como `binding` em `createOAuthState()`;
   - o callback lê o cookie e passa como `expectedBinding`.
   Sem isso, a proteção é só a assinatura (impede `state` forjado, não um
   replay de `state` válido do próprio atacante no browser da vítima).
2. **Contexto no `state`** — quando o "start" for autenticado, incluir no
   payload o identificador de company/usuário que iniciou o fluxo, para o
   callback amarrar a conexão à company certa.
3. **Persistência da integração** — provável migration nova (ex.:
   `company_meta_integrations` com token cifrado, `page_id`, escopos,
   status, `default OFF`), com RLS por company. **Fase própria, com
   revisão de RLS.** Não faz parte desta etapa.
4. **Rotação de `META_OAUTH_STATE_SECRET`** — documentar procedimento;
   girar invalida states em voo (aceitável, janela de 10-15 min).
5. **Rate limiting** do callback (hoje sem limite dedicado; o projeto tem
   o padrão de `reserve_*_rate_limit` via RPC que pode ser reaproveitado).

## Próximos passos (depois da aprovação desta fase)

1. commit/push controlado.
2. Gerar `META_OAUTH_STATE_SECRET` (`openssl rand -hex 32`) e configurar na
   Vercel (server-only).
3. Redeploy.
4. Só então: fase do endpoint de "start OAuth" + cookie anti-CSRF +
   cadastro da Redirect URI na Meta.
5. Depois: fase de troca `code` -> token + persistência (migration + RLS).
