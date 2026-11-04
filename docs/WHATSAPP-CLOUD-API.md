# Integração WhatsApp Cloud API — W1 (webhook) + W2A (conexão + ledger)

Rota: `https://crm.assessoriakapa.com.br/api/webhooks/whatsapp`
Implementação: `app/api/webhooks/whatsapp/route.ts` + `lib/server/whatsapp-webhook/*`
+ `lib/server/whatsapp-connection/*` (W2A). A W2A está descrita na seção
[W2A](#w2a--conexão-multiempresa--ledger-de-eventos) abaixo.

## Arquitetura inicial (W1)

```
Meta (WhatsApp Cloud API)
   │  GET  ?hub.mode&hub.verify_token&hub.challenge   (handshake)
   │  POST X-Hub-Signature-256 + JSON                  (eventos)
   ▼
app/api/webhooks/whatsapp/route.ts      runtime nodejs, force-dynamic
   ├─ lib/server/whatsapp-webhook/env.ts      WHATSAPP_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET
   ├─ lib/server/meta-webhook/signature.ts    verifyMetaSignature (função pura, reaproveitada)
   ├─ lib/server/whatsapp-webhook/events.ts   classificação tolerante, sem PII
   └─ lib/server/whatsapp-webhook/logger.ts   log com allowlist de campos
```

- Módulo **isolado**: não importa Graph, `waitUntil`, ingestão ou
  processamento do Lead Ads, OAuth, cron. Do Lead Ads só reaproveita a
  função pura `verifyMetaSignature` (HMAC + `timingSafeEqual`, sem I/O).
  Supabase só entra pela ingestão da W2A, atrás de `WHATSAPP_INGESTION_ENABLED`.
- `/api/webhooks/meta` não foi alterado e não conhece o WhatsApp.
- Não há middleware no projeto; a rota é pública por necessidade (a Meta
  chama sem sessão). A proteção é o verify token (GET) e o HMAC (POST).

## Variáveis de ambiente (server-only)

| Variável | Uso | Regras |
|---|---|---|
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | **Nova.** Comparada com `hub.verify_token` no GET (timing-safe). | Própria do WhatsApp — **não** reutilizar `META_WEBHOOK_VERIFY_TOKEN` (rotação independente). Gerar com `openssl rand -hex 32`. Nunca `NEXT_PUBLIC_`, nunca logada/retornada. |
| `META_APP_SECRET` | **Existente, reaproveitada.** Chave HMAC do `X-Hub-Signature-256`. | Mesma credencial já usada no Lead Ads e no OAuth. Nenhum segredo novo. |

Por que reutilizar `META_APP_SECRET`: o produto WhatsApp foi adicionado ao
**mesmo app Meta "KAPA CRM"**, e a Meta assina todos os webhooks do app
(Page/leadgen e whatsapp_business_account) com `X-Hub-Signature-256 =
HMAC-SHA256(App Secret, raw body)`. Mesmo mecanismo, mesma chave. Se um dia
o WhatsApp for para **outro app** Meta, aí sim será preciso um segredo
dedicado (ex.: `WHATSAPP_APP_SECRET`).

Ausente/vazia → a rota **falha fechado** (`500 server misconfigured`). O
GET **não** cai no token do Lead Ads quando o do WhatsApp falta.

## Handshake (GET)

| Situação | Resposta |
|---|---|
| `hub.mode=subscribe` + token correto + `hub.challenge` | `200` `text/plain`, corpo = challenge exato |
| `hub.mode`/`hub.verify_token`/`hub.challenge` ausente | `400` |
| token incorreto ou `hub.mode` ≠ `subscribe` | `403` |
| env ausente | `500` |

Sempre `Cache-Control: no-store`. O token nunca é logado nem devolvido.

## Assinatura (POST)

1. Lê o **raw body** (`request.text()`) **antes** do `JSON.parse`.
2. Header `X-Hub-Signature-256: sha256=<64 hex>`.
3. `expected = HMAC_SHA256(META_APP_SECRET, rawBody)`.
4. Comparação `crypto.timingSafeEqual` sobre os 32 bytes.
5. Header ausente / formato inválido / divergente → `403`.
6. A assinatura é verificada **antes** do parse: corpo não assinado nunca
   é interpretado.

## Eventos suportados (classificação apenas)

Aceita somente `object = "whatsapp_business_account"`. Percorre **todos**
os `entry[]` → `changes[]` → itens de `value.messages[]` e
`value.statuses[]`.

| Origem | Classificação | Metadados logados |
|---|---|---|
| `changes[].field = "messages"`, item em `value.messages[]` | `message_received` | `hasPhoneNumberId`, `hasMessageId`, `messageType` (allowlist) |
| `changes[].field = "messages"`, item em `value.statuses[]` | `message_status` | `hasPhoneNumberId`, `hasMessageId`, `status` (allowlist), `hasErrors` |
| outro `field` (ex.: `message_template_status_update`), `value` só com `errors[]`, formas inesperadas | ignorado (`ignoredChangeCount`) | só contagem |
| outro `object`, corpo vazio, `{}` | `ignored_non_whatsapp` | nada do payload |

Allowlists: `messageType` ∈ {text, image, audio, video, document, sticker,
location, contacts, interactive, button, reaction, order, system,
request_welcome, unsupported}; `status` ∈ {sent, delivered, read, failed,
deleted, warning}. Qualquer outro valor vira `"other"`.

Respostas: assinatura válida + JSON válido → sempre `200 ok` rápido (sem
I/O). JSON inválido → `400`.

### Exemplos de log (sanitizados)

```json
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"event","result":"classified","eventType":"message_received","hasPhoneNumberId":true,"hasMessageId":true,"messageType":"text"}
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"event","result":"classified","eventType":"message_status","hasPhoneNumberId":true,"hasMessageId":true,"status":"delivered","hasErrors":false}
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"event","result":"accepted","messageReceivedCount":1,"messageStatusCount":1,"ignoredChangeCount":0,"durationMs":1}
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"event","result":"signature_mismatch"}
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"verify","result":"ok"}
```

`requestId` é gerado localmente (não vem da Meta). No máximo 50 linhas
`classified` por entrega; o resumo `accepted` sempre traz as contagens
totais.

**Nunca** logado nem armazenado: conteúdo da mensagem, `from`,
`recipient_id`, `wa_id`, nome do contato, `display_phone_number`,
`phone_number_id`, WABA id, `wamid`, valor de `object` desconhecido,
payload bruto, assinatura, tokens, App Secret.

## Configuração no painel Meta (W1 — já feita pelo usuário)

1. Vercel: `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (Production). `META_APP_SECRET`
   já existia.
2. Meta for Developers > app KAPA CRM > WhatsApp > Configuração > Webhook:
   Callback URL = rota acima; Verify token = mesmo valor.
3. Campo `messages` assinado.

---

## W2A — conexão multiempresa + ledger de eventos

### Arquitetura

```
POST /api/webhooks/whatsapp  (assinatura → parse → classificação, igual W1)
   │
   └─ WHATSAPP_INGESTION_ENABLED === "true" e há eventos?
        não → resumo + 200 (exatamente a W1, zero banco)
        sim → lib/server/whatsapp-webhook/ingestion.ts
                ├─ owner_by_phone_number(phone_number_id)  (1x por número/entrega)
                │     desconhecido → conta unknownNumber, 200
                ├─ hash SHA-256 do wamid (event-hashes.ts)
                └─ whatsapp_webhook_event_register(...)  (idempotente)
              falha de infraestrutura → 503 (Meta reentrega)

lib/server/whatsapp-connection/
   ├─ env.ts                    WHATSAPP_TOKEN_ENCRYPTION_KEY_V1
   ├─ token-crypto.ts           AAD whatsapp-access-token:v1:<company>:<phone_number_id>
   ├─ connection-rpc.ts         upsert / owner_by_phone_number (service_role)
   └─ connection-persistence.ts persistWhatsAppConnection (sem rota/UI ainda)
lib/server/crypto/aead-envelope.ts   primitiva AES-256-GCM genérica
```

Nada cria conversa, mensagem CRM, lead ou tarefa. Nenhuma chamada Graph.

### Migrations

- `20261103100000_whatsapp_connections_w2a.sql` — `whatsapp_connections` +
  4 RPCs.
- `20261103110000_whatsapp_webhook_events_w2a.sql` — `whatsapp_webhook_events`
  + RPC de registro.

Ambas as tabelas: RLS habilitado, **zero policies**, `revoke all` de
`public/anon/authenticated/service_role` (nem service_role lê direto). Acesso
somente por RPC `SECURITY DEFINER`, `search_path = ''`, EXECUTE só
`service_role`.

`whatsapp_connections`: `UNIQUE (company_id, phone_number_id)` (reconnect
idempotente) + índice único parcial `phone_number_id WHERE status =
'connected'` (um número conectado pertence a uma única company). Conectado
exige ciphertext e `connected_at`. Sem coluna de token em plaintext.

### RPCs

| RPC | Retorna | Ciphertext? |
|---|---|---|
| `whatsapp_connection_upsert(company, waba, phone_number_id, display, ciphertext, key_version, connected_at, connected_by)` | id, company, waba, phone_number_id, display, status, connected_at | **não** (só entrada) |
| `whatsapp_connection_status(company)` | metadados da(s) conexão(ões) | **não** |
| `whatsapp_connection_owner_by_phone_number(phone_number_id)` | connection_id, company_id, status (só connected) | **não** |
| `whatsapp_connection_lookup_for_processing(phone_number_id)` | + access_token_ciphertext, token_key_version | **sim — a única** |
| `whatsapp_webhook_event_register(...)` | out_event_id, out_processing_status, out_created | — |

Erros controlados: `invalid_input`, `phone_number_already_connected`,
`connection_not_connected`. O upsert audita em `audit_log` só `status`
(sem WABA/phone_number_id/token).

### Criptografia

- **Chave própria**: `WHATSAPP_TOKEN_ENCRYPTION_KEY_V1` (64 hex), separada de
  `META_TOKEN_ENCRYPTION_KEY_V1`. Vazamento/rotação de uma integração não
  afeta a outra.
- **Primitiva genérica** `lib/server/crypto/aead-envelope.ts`: AES-256-GCM,
  IV aleatório de 12 bytes, tag 16 bytes, envelope
  `v<N>.<iv>.<tag>.<ct>` (base64url) — **mesmo formato** do envelope da Meta.
- **AAD por domínio**: `whatsapp-access-token:v1:<company_id>:<phone_number_id>`.
  Ciphertext movido para outra company/número não decifra; ciphertext da Meta
  não abre como WhatsApp e vice-versa.
- `lib/server/meta-oauth/token-crypto.ts` **não foi alterado** (pode migrar
  para a primitiva genérica numa fase própria, sem mudar o formato).

### Idempotência do ledger

O **wamid não é armazenado**: ele codifica o telefone do contato em base64.
O app calcula em memória (`lib/server/whatsapp-webhook/event-hashes.ts`):

- `message_id_hash = sha256('whatsapp-message-id:v1:' + wamid)`
- `status_key_hash = sha256('whatsapp-status-key:v1:' + 's:' + status_bruto)`
  (valor não-string: prefixo `j:` + JSON, para não colidir com a string)

A RPC deriva `event_key` (UNIQUE) de forma determinística:

| Evento | Material da chave |
|---|---|
| mensagem recebida | `wa-webhook-event:v1:message:<phone_number_id>:<message_id_hash>:-` |
| status | `wa-webhook-event:v1:status:<phone_number_id>:<message_id_hash>:<status_key_hash>` |

- Reentrega da mesma mensagem ou da mesma transição de status → `out_created
  = false`, nenhuma linha nova.
- Mensagem e status com o mesmo wamid **não colidem** (kind na chave).
- Cada transição (`sent` → `delivered` → `read`) é um evento distinto.
- O **status bruto** entra só no hash: nunca vai ao banco (a RPC rejeita
  `p_status_key_hash` que não seja 64 hex), nunca é logado nem devolvido. O
  ledger guarda apenas a classificação (`status_value` da allowlist ou
  `other`). Dois statuses desconhecidos distintos do mesmo wamid ficam ambos
  `other`, mas com `event_key` diferentes.
- O owner (`phone_number_id → company`) é resolvido no máximo uma vez por
  `phone_number_id` distinto em cada entrega (cache por request; nada
  persiste entre requests).

Colunas do ledger: só metadados (kind, hash, tipo/status da allowlist,
timestamps, processing_status). **Nunca** texto, telefone/nome do contato,
wamid cru, mídia ou payload.

### Flags

| Flag | Default | Efeito |
|---|---|---|
| `WHATSAPP_INGESTION_ENABLED` | `false` | Só `"true"` exato liga. OFF = W1 idêntica (nenhum client Supabase criado). |

Com a flag ON e nenhuma conexão cadastrada (estado atual), todos os eventos
caem em `unknownNumberCount` e a resposta continua `200`.

### Logs da ingestão (só contagens)

```json
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"event","result":"ingestion","registeredCount":1,"duplicateCount":0,"unknownNumberCount":0,"unusableCount":0,"durationMs":12}
[whatsapp-webhook] {"operation":"whatsapp_webhook","requestId":"<uuid>","phase":"event","result":"ingestion_infra_failure","registeredCount":0,"duplicateCount":0,"unknownNumberCount":0,"unusableCount":0,"durationMs":3}
```

### Bootstrap da conexão de teste (one-shot, manual)

**Objetivo:** persistir a PRIMEIRA conexão WhatsApp — **somente** o número de
TESTE da Meta, **somente** na TEST COMPANY
(`0dfc73ee-bca9-4fdf-aa50-b227940b2869`) — para provar em produção a
persistência + cifragem da W2A. **Não é o fluxo definitivo de onboarding:** o
futuro Embedded Signup multiempresa substitui este bootstrap.
**PROIBIDO usar com número, WABA ou token de cliente real.**

| Arquivo | Papel |
|---|---|
| `scripts/whatsapp/bootstrap-test-connection.ps1` | launcher (jeito recomendado de rodar) |
| `scripts/whatsapp/bootstrap-test-connection.ts` | entrada Node (`npm run whatsapp:bootstrap-test-connection`, via `tsx` fixo) |
| `scripts/whatsapp/bootstrap-test-connection-core.ts` | lógica testável (validação, preflight, Graph, escrita, round-trip, saída) |

Nenhum arquivo de `app/`, `lib/` ou `components/` importa `scripts/` (teste
garante). Não há endpoint, Server Action nem UI. Fixos no código (não vêm da
sessão): URL `https://qglirrsyhdfbgkmchwcw.supabase.co`, TEST COMPANY, Graph
`v26.0`.

**Variáveis da sessão** (o launcher preenche; o script não carrega `.env*` e
recusa argumentos de linha de comando):

| Variável | Classe | Regra |
|---|---|---|
| `WA_BOOTSTRAP_ACCESS_TOKEN` | **SECRET** | 20–2048 chars, sem espaço |
| `WA_BOOTSTRAP_SERVICE_ROLE_KEY` | **SECRET** | JWT `role=service_role` + `ref=qglirrsyhdfbgkmchwcw`, ou `sb_secret_…` (anon e outros projetos são recusados) |
| `WA_BOOTSTRAP_ENCRYPTION_KEY` | **SECRET** | 64 hex minúsculo — **mesmo valor** de `WHATSAPP_TOKEN_ENCRYPTION_KEY_V1` na Vercel (pegar do Bitwarden) |
| `WA_BOOTSTRAP_WABA_ID` | non-secret | `^[0-9]{1,30}$`, diferente do phone_number_id |
| `WA_BOOTSTRAP_PHONE_NUMBER_ID` | non-secret | `^[0-9]{1,30}$` |
| `WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER` | non-secret, opcional | `^[0-9 +()-]{1,32}$`; os dígitos têm de bater com a Graph |
| `WA_BOOTSTRAP_CONNECTED_BY` | non-secret, opcional | UUID de `profiles` existente (vai para `audit_log`) |
| `WA_BOOTSTRAP_CONFIRM` | non-secret | exatamente `TEST_COMPANY_ONLY` (o launcher sempre define) |
| `WA_BOOTSTRAP_MODE` | non-secret | ausente/vazio/`dry-run` → nunca grava; `write` → grava após TODOS os preflights; outro valor → aborta |

**dry-run × write:**

- **dry-run** (default): validação local → preflight Supabase somente leitura
  → Graph somente leitura. **Zero escrita** (nenhum upsert, nenhum lookup de
  ciphertext). `createdOrUpdated: false`.
- **write**: o mesmo e, só então, **uma** escrita funcional —
  `whatsapp_connection_upsert` (via `persistWhatsAppConnection`) — gravando
  company_id, waba_id, phone_number_id, display (se informado), ciphertext,
  `token_key_version = 1`, `status = connected`, connected_by (se informado).
  A única escrita adicional é o `audit_log` que a própria RPC grava
  (`after_data` só com `status`). Nada é escrito em `whatsapp_webhook_events`.
- **dry-run é obrigatório antes do write:** o launcher sempre roda o dry-run
  primeiro; o write só roda se o dry-run passar **e** você digitar a
  confirmação `GRAVAR TEST COMPANY`.

**Ordem (qualquer falha aborta antes da escrita):**

1. validação local (sem rede; erro → exit 2);
2. preflight somente leitura: TEST COMPANY existe; `connected_by` existe;
   `owner_by_phone_number` — outra company → aborta; TEST COMPANY →
   `alreadyConnected: true` (o write atualiza a mesma linha);
   `whatsapp_webhook_events` responde `42501` (existe e o acesso direto é
   negado, como a migration define);
3. Graph somente leitura, token **só** no header `Authorization`, sem seguir
   redirect: `GET /<phone_number_id>?fields=id,display_phone_number` (token
   válido + número encontrado) e `GET /<waba_id>/phone_numbers?fields=id&limit=100`
   (WABA acessível + número pertence à WABA) + display confere;
4. (write) `whatsapp_connection_upsert` — uma vez;
5. (write) round-trip: `lookup_for_processing`, ciphertext só em memória,
   decifra com a chave da sessão, compara com o token original →
   `roundTripOk`. Se `false`: exit ≠ 0, **sem** segundo upsert e sem
   correção automática.

**Criptografia:** exatamente a da W2A, sem crypto duplicada no script —
AES-256-GCM, envelope `v1.<iv>.<tag>.<ct>`, key version 1, AAD
`whatsapp-access-token:v1:<company_id>:<phone_number_id>`, tudo dentro de
`persistWhatsAppConnection` / `decryptWhatsAppAccessToken`. O token plaintext
só existe em memória; a chave da sessão nunca é persistida; ciphertext e AAD
nunca são impressos.

**Saída** (única linha `[whatsapp-bootstrap] {...}`):

```json
{
  "success": true,
  "mode": "write",
  "company": "TEST_COMPANY",
  "failedStep": null,
  "code": null,
  "alreadyConnected": false,
  "connectionStatus": "connected",
  "graphTokenValid": true,
  "graphWabaAccessible": true,
  "graphPhoneFound": true,
  "graphPhoneMatchesWaba": true,
  "graphDisplayMatches": true,
  "graphHttpStatus": null,
  "graphCode": null,
  "roundTripOk": true,
  "keyVersion": 1,
  "createdOrUpdated": true,
  "durationMs": 1234
}
```

Em dry-run: `createdOrUpdated: false`, `roundTripOk`/`keyVersion` `null`,
`connectionStatus` `null` (ou `"connected"` se já existir). Em falha:
`failedStep` + `code` fixos e, na Graph, só `graphHttpStatus`/`graphCode`
numéricos. Nunca: token, service role, chave, ciphertext, AAD, WABA ID,
phone_number_id, número exibido, resposta bruta da Graph/Supabase, header
Authorization ou env vars. `createdOrUpdated: null` = erro inesperado em
write: conferir com o SQL abaixo antes de qualquer nova ação.

**Token temporário:** o token da tela "Testar a API" da Meta expira (~24h).
Depois disso a conexão continua `connected` com um token morto (Graph 190).
Serve só para este smoke; antes da W2B trocar por token de System User
(rodar o bootstrap de novo atualiza a mesma linha).

**Execução** — janela **nova e dedicada** do PowerShell, na raiz do repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\whatsapp\bootstrap-test-connection.ps1
```

O launcher pergunta o modo (Enter = dry-run), WABA ID, Phone Number ID,
display e connected_by (input normal, non-secret) e os três segredos por
`Read-Host -AsSecureString` (não vão para o histórico). Não aceita parâmetros.
SecureString → BSTR → env do processo; o BSTR é liberado com `ZeroFreeBSTR`.

**Cleanup:**

- script Node: apaga `WA_BOOTSTRAP_*` do `process.env` ao ler e de novo no
  `finally`; zera o buffer da chave; solta as referências;
- launcher: o `finally` remove todas as `WA_BOOTSTRAP_*` do processo e
  sobrescreve o clipboard;
- **limite:** strings JS/.NET (token, service role, a string intermediária
  do BSTR) são imutáveis e **não podem ser zeradas com garantia** — ficam no
  heap até o GC. Por isso: janela dedicada, **fechar a janela** no fim e, se
  o histórico do clipboard (Win+V) estiver ligado, apagar as entradas com
  segredo. Não rodar com `Start-Transcript` ativo.

**Ingestão continua OFF:** o bootstrap não lê nem altera
`WHATSAPP_INGESTION_ENABLED`. Com a flag OFF, a existência da conexão não
registra eventos.

**Validação pós-bootstrap** (somente leitura,
`npx supabase@2.116.0 db query --linked -f <arquivo>`; nenhuma coluna de
ciphertext é devolvida, só formato/tamanho):

```sql
select
  (select count(*) from public.whatsapp_connections) as connections,
  (select count(*) from public.whatsapp_connections
     where company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869' and status = 'connected'
       and token_key_version = 1 and connected_at is not null) as test_company_connected,
  (select bool_and(access_token_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
                   and char_length(access_token_ciphertext) between 1 and 4096)
     from public.whatsapp_connections) as ciphertext_envelope_ok,
  (select count(*) from public.audit_log where action = 'whatsapp_connection_upserted') as audit_rows,
  (select bool_and(after_data = '{"status": "connected"}'::jsonb)
     from public.audit_log where action = 'whatsapp_connection_upserted') as audit_after_data_status_only,
  (select count(*) from public.whatsapp_webhook_events) as events;
```

Esperado: `connections = 1`, `test_company_connected = 1`,
`ciphertext_envelope_ok = true`, `audit_rows = 1`,
`audit_after_data_status_only = true`, `events = 0`.

Não há RPC de desconexão ainda: reverter exige SQL manual aprovado.

## O que ainda NÃO está implementado

- Inbox / conversas / mensagens CRM / vínculo com lead.
- Envio de mensagens e templates.
- Chamadas à Graph API (download de mídia, etc.).
- Rota/UI que chame `persistWhatsAppConnection` (Embedded Signup). Hoje só o
  bootstrap manual da conexão de TESTE (`scripts/whatsapp/`) a usa.
- Desconexão (RPC de `disconnect`) e marcação de erro da conexão.
- Processamento do ledger (`processing → processed/failed`, lease, sweep).
- Assinatura dos campos além de `messages`.

## Próximos passos (W2B)

1. **Conversa + mensagem**: tabelas `whatsapp_conversations` (company,
   connection, contato identificado por hash + telefone cifrado ou exibido
   conforme decisão LGPD, vínculo opcional com lead) e `whatsapp_messages`
   (direção, tipo, conteúdo **só após decisão explícita de retenção**,
   `message_id_hash`, status). RLS por company para leitura no browser.
2. **Processamento**: worker que faz claim com lease no ledger
   (`received → processing → processed/failed`), cria conversa/mensagem e
   correlaciona statuses pelo `message_id_hash` (mesmo hash no wamid do
   envio). Sweep para eventos parados, no padrão do Lead Ads.
3. **Inbox**: UI restrita (flag por company), lista de conversas e thread.
4. **Envio**: rota server-only que usa `lookup_for_processing` + decifra o
   token, chama a Graph (janela de 24h), grava a mensagem de saída e o hash do
   wamid devolvido.
5. **Templates**: sincronização e envio fora da janela.
6. **Embedded Signup multiempresa**: onboarding por company chamando
   `persistWhatsAppConnection`, reaproveitando state/binding do OAuth Meta.
