# Integração WhatsApp Cloud API — W1 + W2A implementadas, W2B em planejamento

Rota: `https://crm.assessoriakapa.com.br/api/webhooks/whatsapp`
Implementação: `app/api/webhooks/whatsapp/route.ts` + `lib/server/whatsapp-webhook/*`
+ `lib/server/whatsapp-connection/*` (W2A). A W2A está descrita na seção
[W2A](#w2a--conexão-multiempresa--ledger-de-eventos) abaixo.

## Estado atual (W2B-0, 2026-11-04)

**Receber mensagens reais no CRM ainda não é possível.** Há dois motivos: a
WABA de teste não está inscrita no app KAPA CRM, e o sistema ainda não guarda
o conteúdo das mensagens.

| Item | Estado | Evidência |
|---|---|---|
| Conexão | 1 linha, da TEST COMPANY, `connected`, key version 1 | Auditoria read-only pós-bootstrap (8/8 PASS) |
| Ator e número exibido | `connected_by` e `display_phone_number` vazios; `audit_log` sem ator | Opcionais não informados no bootstrap |
| Ledger | 0 eventos; `whatsapp_webhook_event_register` com 0 chamadas | Consulta read-only |
| Assinatura no app | Callback correto, campo `messages` assinado em v26.0 | Painel da Meta |
| Rota do número | `application` aponta para o nosso callback | `GET <PHONE_NUMBER_ID>?fields=webhook_configuration` |
| **Inscrição da WABA** | **BLOQUEIO:** só `Wa Dev Webhook Events 1P App`; KAPA CRM ausente | `GET <WABA_ID>/subscribed_apps` |
| Número | Confirmado como número de teste | Meta e bootstrap |
| Modo do app | Development; não será alterado nesta fase | Painel da Meta |
| `WHATSAPP_INGESTION_ENABLED` | Ausente nas variáveis Project e Shared da Vercel; **runtime efetivo não confirmado** | Painel da Vercel |
| Entrega real da Meta | Nunca comprovada | Só houve POST de teste do painel |

Pendências:

- confirmar os destinatários autorizados do número de teste;
- comprovar a ausência de overrides: o `GET` do número mostrou `application`, mas
  isso não prova, sozinho, que não existem `override_callback_uri` ou
  `phone_number`;
- confirmar a flag no runtime efetivo;
- identificar o tipo e a validade do token gravado.

Nenhuma empresa além da TEST COMPANY tem conexão. Ver
[duas camadas de assinatura](#duas-camadas-de-assinatura) e
[riscos de perda de mensagens](#riscos-de-perda-de-mensagens).

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
| `WHATSAPP_INGESTION_ENABLED` | **W2A.** Liga o registro no ledger. | Só `"true"` exato liga. Ver [Flags](#flags). |
| `WHATSAPP_TOKEN_ENCRYPTION_KEY_V1` | **W2A.** Cifra o access token. | 64 hex minúsculo. Ver [Criptografia](#criptografia). |

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

Respostas: JSON inválido → `400`. Assinatura válida + JSON válido com a flag
OFF → `200 ok` rápido, sem I/O. Com a flag ON há acesso ao banco, e uma falha
de infraestrutura devolve `503` para a Meta reentregar.

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

## Duas camadas de assinatura

A Meta só entrega mensagens reais quando as **duas** camadas estão ativas.
Elas são configuradas em lugares diferentes:

| Camada | O que define | Onde verificar | Estado |
|---|---|---|---|
| Campo no app | URL de callback e campos recebidos pelo app | Painel do app, em Webhooks | OK |
| Inscrição na WABA | Se o app recebe os eventos daquela WABA | `GET <WABA_ID>/subscribed_apps` | **Pendente**, adiada para depois da W2B-6 |

- O campo `messages` assinado no painel **não** inscreve o app na WABA.
- O botão "Testar" do painel envia direto ao callback. Um `200` nesse teste
  prova que a rota responde, não que mensagens reais vão chegar.
- A inscrição é por WABA. O futuro Embedded Signup terá de inscrever cada WABA.
- A checagem deve comparar o **ID do nosso app**. Verificar só se a lista veio
  preenchida dá falso positivo, porque esta WABA já lista outro app.

### App `Wa Dev Webhook Events 1P App`

É o único app listado na WABA de teste. **Sua identidade não está confirmada
oficialmente:** não encontramos documentação da Meta sobre ele. Relatos de
desenvolvedores indicam que seria um app interno da Meta, ligado ao visualizador
de webhooks de teste, e que WABAs de teste novas já viriam inscritas nele. Trate
essa explicação como hipótese. Não há motivo para removê-lo.

### Inscrição do KAPA CRM (não executada)

**Decisão: adiada até depois da W2B-6.** Só ocorre com a persistência segura já
implementada e validada, antes do smoke da W2B-7 e com **autorização específica**.
Não executar antes disso.

1. Confirmar, em leitura: W2B-6 concluída, flag OFF no runtime efetivo, ausência
   de overrides e destinatários autorizados.
2. Com o app KAPA CRM selecionado e um token com
   `whatsapp_business_management`, fazer `POST <WABA_ID>/subscribed_apps` sem
   corpo, uma única vez. Sucesso: `{"success": true}`.
3. Repetir o `GET` e confirmar o ID do KAPA CRM, sem `override_callback_uri`.

- Somente na WABA de teste. Nunca em WABA de cliente real sem processo próprio.
- O POST sem corpo remove o override do próprio app, se houver.
- A documentação não diz se o POST mantém os outros apps. O exemplo oficial
  mostra dois apps na mesma WABA.
- Pelos relatos, o app inscrito é o do token usado. A Meta não documenta isso.
- `DELETE` no mesmo endpoint desfaz a inscrição. Não usar para "limpar"
  conflitos, e só executar com autorização.

### Limitações do número de teste e do modo de desenvolvimento

- A Meta avisa que alguns webhooks não são enviados em Dev mode, sem listar
  quais. Webhooks de **teste** de `messages` funcionam nos dois modos.
- Não há confirmação oficial de que mensagens reais cheguem em Dev mode. Só o
  smoke da W2B-7 responde. No Lead Ads, o Dev mode foi a causa dominante da falta
  de webhooks.
- Relatos indicam que, em Dev mode, só telefones da lista "Para" da configuração
  da API são encaminhados. Não há confirmação oficial.
- O app permanece em Development e não será alterado nesta fase. Mudar para Live
  é decisão separada: o app é compartilhado com Lead Ads e OAuth.

Referências: [webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/),
[gerenciamento de webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/manage-webhooks/),
[overrides](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/override).

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

Nada cria conversa, mensagem CRM, lead ou tarefa. O caminho do webhook não
chama a Graph.

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

Com a flag ON, um número sem conexão `connected` cai em `unknownNumberCount` e
a resposta continua `200`. **O número da TEST COMPANY agora tem conexão:** com
a flag ON, um evento dele grava no ledger uma linha sem conteúdo. **Não ligar a
flag antes do smoke da W2B-7**, com autorização específica. Concluir a W2B-6 não
autoriza ligá-la (ver
[riscos de perda de mensagens](#riscos-de-perda-de-mensagens)).

**Verificação no deployment efetivo:** mudanças de variável na Vercel só valem
para novos deployments, e um rollback volta à configuração daquele deployment.

1. Em Settings > Environment Variables, ver se a variável existe em Production.
2. Comparar a data da variável com a do deployment marcado como Current.
3. Nos Runtime Logs, uma entrega com evento mostra `classified` e `accepted` com
   a flag OFF. Com ON aparece também `result:"ingestion"`. Use só entregas já
   registradas: gerar uma entrega de teste depende de autorização.

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

**Estado:** executado em `write` em 2026-11-04 (20:42 UTC), com `success`,
`connected` e `roundTripOk` em `true`. A auditoria read-only passou em 8/8 itens.
`connected_by` e `display_phone_number` não foram informados.

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

**Token temporário:** o token da tela "Testar a API" da Meta expira rápido.
Depois disso a conexão continua `connected` com um token morto (Graph 190): nada
detecta isso hoje. Receber texto não usa token. Ele só é necessário para mídia,
envio e chamadas à Graph (ver [token de System User](#token-de-system-user)).

**Rodar `write` de novo** atualiza a mesma linha: troca o ciphertext e sobrescreve
`connected_at`, `connected_by` e `display_phone_number`, que viram `NULL` se
ficarem em branco. Também cria mais uma linha em `audit_log`.

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

**Ingestão:** o bootstrap não lê nem altera `WHATSAPP_INGESTION_ENABLED`. Com a
flag OFF, a existência da conexão não registra eventos.

**Validação pós-bootstrap** (somente leitura,
`npx supabase@2.116.0 db query --linked -f <arquivo>`; nenhuma coluna de
ciphertext é devolvida, só formato/tamanho). A sessão do CLI roda como
`postgres` sem trava de leitura, por isso o arquivo abre com
`begin transaction read only`. O CLI também renova o role temporário
`cli_login_postgres` a cada execução, fora do SQL: declare isso em auditorias
"somente leitura".

```sql
begin transaction read only;
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
`audit_after_data_status_only = true`, `events = 0`. Depois de um novo `write`,
`audit_rows` aumenta em 1 e os demais valores permanecem.

Não há RPC de desconexão ainda: reverter exige SQL manual aprovado.

## O que ainda NÃO está implementado

- Captura do conteúdo: o parser ignora `from`, `contacts[]`, texto e ID de mídia.
- Contatos, conversas, mensagens CRM, Inbox e vínculo com lead.
- Envio de mensagens e templates.
- Chamadas à Graph em runtime (download de mídia, etc.). No WhatsApp, hoje só o
  bootstrap chama a Graph, em leitura.
- Rota/UI que chame `persistWhatsAppConnection` (Embedded Signup). Hoje só o
  bootstrap manual da conexão de TESTE (`scripts/whatsapp/`) a usa.
- Inscrição automática de WABA e checagem de `subscribed_apps`.
- Desconexão (RPC de `disconnect`) e marcação de erro da conexão.
- Assinatura dos campos além de `messages`.
- Agendador: o repositório não tem `vercel.json` nem workflow que dispare sweeps.

## Riscos de perda de mensagens

A Meta reentrega por até 7 dias quando a resposta não é `200`. Depois de um
`200` não se pode contar com nova entrega, e a documentação consultada não traz
endpoint para buscar uma mensagem recebida. **O que não for capturado na entrega
se perde.**

| Situação | Efeito | Mitigação |
|---|---|---|
| WABA sem o nosso app inscrito (estado atual) | A Meta não entrega; nada aparece do nosso lado | Inscrição autorizada depois da W2B-6 e checagem pelo ID do app |
| Flag OFF com WABA inscrita | `200` e descarte | Inscrever só no início da W2B-7, sem usar o número fora do smoke |
| Flag ON antes da W2B-5 estar em produção | Ledger sem conteúdo; a reentrega é deduplicada; conteúdo irrecuperável | Manter a flag OFF até o smoke da W2B-7 |
| Número sem conexão `connected`, flag ON | `unknownNumberCount`, `200` e descarte | Conectar antes de divulgar o número |
| Falha de infraestrutura | `503` e reentrega por até 7 dias; depois disso, perda | Monitorar com o diagnóstico da W2B-2 |
| Token morto | Conexão segue `connected`; afeta mídia e envio, não texto | Detecção de erro de token, fase de mídia |

Hoje o risco atinge só o número de teste. Nenhum cliente real está conectado.

## W2B — arquitetura aprovada e plano

**Status: decisões aprovadas na W2B-1. Nada disto está implementado.** Nomes de
tabelas, colunas e variáveis abaixo são propostas e podem mudar nas fases
seguintes.

| Decisão | Status | Definição |
|---|---|---|
| Modelo de processamento | Aprovada | Captura transacional na entrega |
| Conteúdo | Aprovada | Cifrado na aplicação |
| Isolamento | Aprovada | Rigoroso por empresa |
| Vínculo com lead | Aprovada | Automático só com correspondência única e confiável; casos ambíguos exigem revisão |
| Inscrição da WABA | Aprovada | Depois da W2B-6, antes do smoke, com [autorização específica](#inscrição-do-kapa-crm-não-executada) |
| Token | Aprovada | Não substituir nesta fase; procedimento [preparado](#token-de-system-user) |
| Fases | Aprovada | W2B-9 (lead) separada da W2B-10 (mídia) |
| Modo do app | Mantido | Permanece em Development nesta fase |
| Retenção e exclusão | **Pendente** | [Requisito obrigatório](#retenção-e-exclusão-decisão-pendente) antes de concessionárias reais |
| Agendador para mídia | **Pendente** | Só necessário na W2B-10 |

### Captura transacional

O ledger só guarda metadados, então um worker não consegue criar mensagens a
partir dele. Por isso, esta decisão substitui o worker do plano anterior.

Uma RPC grava, na **mesma transação e antes do `200`**, o evento do ledger, o
contato, a conversa e a mensagem.

- Sem fila de payload com dados pessoais e sem agendador para receber texto.
- Receber texto não usa token.
- Custo: uma RPC a mais por mensagem no webhook. Falha de banco cai no `503`.
- Tipo não suportado vira mensagem com placeholder.
- Statuses seguem em `whatsapp_webhook_event_register` até existir envio.
- Gate duplo: a flag global e `capture_enabled` por conexão (default `false`).
  Conexão sem gate não grava nada e responde `200`, com contagem no log.

### Modelo de dados proposto

| Tabela | Conteúdo | Chave de unicidade |
|---|---|---|
| `whatsapp_contacts` | HMACs de BSUID e telefone; telefone e nome cifrados | Por empresa + HMAC |
| `whatsapp_conversations` | Conexão, contato, lead opcional, datas | Por empresa + conexão + contato |
| `whatsapp_messages` | Direção, tipo, `occurred_at`, envelope cifrado, vínculo com o evento | Por empresa + `message_id_hash` |

**BSUID:** desde abril de 2026 a Meta envia esse identificador por portfólio
(`user_id`, `from_user_id`). Usuários com username podem chegar sem `wa_id` e sem
`from`, então o contato não pode exigir telefone. O valor deve ser mantido
inteiro, e as mudanças em mensagens `system` (`user_changed_number` e
`user_changed_user_id`) precisam de tratamento.
Ver [BSUIDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/).

### Isolamento multiempresa

- A RPC deriva a empresa da conexão, nunca de parâmetro.
- A RPC valida conexão, número e WABA (`entry[].id`, hoje ignorado pelo parser).
- FKs compostas `(company_id, id)` impedem cruzar empresas por construção.
- RLS espelha `leads_select` com os helpers `current_membership_*`: manager vê a
  empresa; seller vê só conversas do próprio lead; conversa sem lead fica para
  manager.

### Proteção de dados

- Conteúdo, telefone, nome e wamid só em envelope AES-256-GCM, usando a primitiva
  `aead-envelope`. O ledger continua sem wamid.
- Chaves novas propostas: `WHATSAPP_CONTENT_ENCRYPTION_KEY_V1` e
  `WHATSAPP_CONTACT_HMAC_KEY_V1`, separadas da chave do token.
- AAD por empresa e conversa. Ciphertext movido de lugar não decifra.
- Busca por contato usa **HMAC com segredo**. SHA-256 puro de telefone é
  reversível por força bruta.
- Payload bruto nunca é guardado. Logs seguem com allowlist e só contagens.
- A descriptografia ocorre em rota server-side autenticada. O conteúdo cifrado
  impede busca por texto no banco.

### Idempotência e recuperação

- Mantém a `event_key` atual e adiciona unicidade por `message_id_hash`.
- A ordem da conversa vem de `occurred_at`, porque a Meta não garante sequência.
- Falha de infraestrutura: `503` e reentrega da Meta.
- Erro permanente: ledger `failed`, com código de conjunto fechado, e `200`.
- Mídia usa worker com lease, backoff de 1, 5, 15 e 60 minutos e até 5
  tentativas, como no Lead Ads. O limite prático é de 7 dias, validade do ID de
  mídia recebido no webhook.

### Rastreabilidade

- `request_id` no ledger liga log, evento, mensagem e conversa.
- Painel sem dados pessoais: contagens por status, evento pendente mais antigo e
  último recebimento.
- `audit_log` para ações administrativas, como vínculo manual.

### Vínculo com lead

Automático **somente com correspondência única e confiável**: exatamente um lead
ativo compatível, na mesma empresa.

| Situação | Resultado |
|---|---|
| Nenhum lead compatível | Conversa fica sem lead |
| Mais de um lead, ou correspondência não confiável | Sem vínculo automático; **exige revisão** |
| Contato sem telefone | Sem vínculo automático |

A primeira versão não cria lead.

Números brasileiros podem chegar sem o nono dígito, e `phone_digits` pode estar
em outro formato. A busca precisa cobrir as variantes, e o que torna uma
correspondência confiável deve ser definido na W2B-9 e validado com número real.

### Retenção e exclusão: decisão pendente

**Nenhuma regra ou prazo foi definido.** Esta decisão é **requisito obrigatório**
antes de liberar a captura para concessionárias reais. Falta definir:

- por quanto tempo guardar mensagens, contatos e eventos do ledger;
- como atender pedidos de exclusão de um contato;
- o que fazer com as mensagens de teste;
- como cifragem, backups e cancelamento de empresa entram na política.

### Token de System User

**O token atual não será substituído nesta fase.** Este procedimento fica pronto
para quando mídia ou envio exigirem a Graph. Receber texto não usa token.

1. Em Business Settings, criar um System User **Employee**. O Admin acessa todas
   as contas por padrão.
2. Atribuir o app e somente as contas WhatsApp e Messaging de teste. A Meta exige
   acesso às duas.
3. Gerar o token com `whatsapp_business_messaging` e
   `whatsapp_business_management`. O guia da Meta também lista
   `business_management`: adicionar só se a Graph recusar.
4. Copiar direto para o Bitwarden. Nunca em chat, `.env`, Vercel ou histórico.
5. Validar com o launcher em dry-run, que não grava.
6. Gravar em `write` só quando for necessário e autorizado, informando
   `connected_by`. Depois apagar a cópia do Bitwarden.

**Nenhum token deve ser tratado como válido para sempre.** A Meta oferece "nunca
expira" e recomenda 60 dias, mas mesmo sem expiração o token pode ser invalidado
(erro 190). O sistema precisa detectar essa falha, e a expiração será escolhida
quando o token for gerado. Clientes via Embedded Signup usarão Business
Integration System User tokens.
Ver [Access Tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/).

### Plano de implementação

Toda fase termina em parada para autorização.

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **W2B-0** Diagnóstico | Verificações read-only | **Concluída**, com o bloqueio da WABA e os itens abertos do [estado atual](#estado-atual-w2b-0-2026-11-04) |
| **W2B-1** Documentação | Este documento | Revisado e aprovado |
| **W2B-2** Diagnóstico | Rota Super Admin: flag em runtime, chave presente, SHA do deployment, contagens; inscrição por ID do app só com token válido, senão `unknown` | Só booleanos e contagens; testes de permissão e de vazamento |
| **W2B-3** Parser | Extração em memória, com e sem `from`/`wa_id` | Testes por tipo e com BSUID; nada novo nos logs |
| **W2B-4** Banco (local) | Tabelas, RLS, RPC transacional, `capture_enabled` | pgTAP de isolamento, idempotência, grants e papéis; tipos com CLI 2.116.0 |
| **W2B-5** Aplicação | Cifragem e RPC atrás dos dois gates | Reentrega não duplica; `503` em falha; Lead Ads sem regressão |
| **W2B-6** Produção | Backup, migrations, chaves, deploy. **Flag segue OFF, WABA não inscrita, gate desligado** | Local igual ao remoto; persistência validada; auditoria read-only; outras empresas intactas |
| **W2B-7** Smoke | Sequência abaixo, só na TEST COMPANY | 1 evento, 1 mensagem cifrada, reentrega sem duplicar, rollback testado |
| **W2B-8** Inbox | Lista e thread somente leitura, para a TEST COMPANY | Testes de manager e seller; isolamento entre empresas |
| **W2B-9** Vínculo com lead | Regra de correspondência única e confiável; revisão de casos ambíguos | Testes de 0, 1 e vários leads; variantes de telefone |
| **W2B-10** Mídia | Token, worker, lease, agendador | Retentativas, expiração de 7 dias, token morto detectado |

**Sequência do smoke (W2B-7).** Cada passo de escrita exige autorização específica:

1. Confirmar em leitura os pré-requisitos da
   [inscrição](#inscrição-do-kapa-crm-não-executada).
2. Inscrever o KAPA CRM na WABA de teste e confirmar pelo `GET`.
3. Habilitar `capture_enabled` só na conexão da TEST COMPANY.
4. Criar a flag em Production e fazer novo deployment. Sem isso ela não vale.
5. Enviar uma mensagem de um telefone autorizado e auditar em leitura.
6. Rollback: desligar `capture_enabled`, retirar a flag e fazer novo deployment.

Se a mensagem não chegar, parar e diagnosticar. Não mudar o modo do app sem
decisão própria.

O pgTAP deve ser comparado com as 46 falhas antigas já conhecidas. Migrations são
aplicadas uma por vez.

Fora da W2B: envio com janela de 24h, templates, Embedded Signup multiempresa e
desconexão. O envio usará `lookup_for_processing` e correlacionará statuses pelo
`message_id_hash`.
