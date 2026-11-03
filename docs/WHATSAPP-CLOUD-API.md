# Integração WhatsApp Cloud API — Fase W1 (fundação do webhook)

Rota: `https://crm.assessoriakapa.com.br/api/webhooks/whatsapp`
Implementação: `app/api/webhooks/whatsapp/route.ts` + `lib/server/whatsapp-webhook/*`

## Arquitetura inicial

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

- Módulo **isolado**: não importa Supabase, Graph, `waitUntil`, ingestão
  ou processamento do Lead Ads, OAuth, cron. Do Lead Ads só reaproveita a
  função pura `verifyMetaSignature` (HMAC + `timingSafeEqual`, sem I/O).
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

## Configuração no painel Meta (quando for ativar — NÃO feito nesta fase)

1. Vercel: definir `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (Production).
   `META_APP_SECRET` já existe.
2. Meta for Developers > app KAPA CRM > WhatsApp > Configuração > Webhook:
   Callback URL = rota acima; Verify token = mesmo valor.
3. Assinar o campo `messages`.

## O que ainda NÃO está implementado

- Persistência (conexão, WABA, phone number, mensagens, status) — nenhuma
  tabela/migration.
- Inbox / conversas / vínculo com lead.
- Envio de mensagens e templates.
- Chamadas à Graph API (download de mídia, etc.).
- Idempotência por `wamid` (pré-requisito antes de qualquer escrita — a
  Meta reentrega eventos).
- Roteamento multiempresa por `phone_number_id` e Embedded Signup.
- Feature flag por company / rollout de pilotos.
- Assinatura dos campos além de `messages`.

## Próximos passos (W2+)

1. **Conexão**: tabela `whatsapp_connections` (company_id, waba_id,
   phone_number_id, display name/quality, token cifrado com chave
   versionada — padrão de `META_TOKEN_ENCRYPTION_KEY_V1`) + RLS por company
   + RPC de lookup `phone_number_id → company` para o webhook.
2. **Ledger idempotente** de eventos (`UNIQUE (phone_number_id, wamid)` /
   status por `(wamid, status)`), flag default OFF, só company de teste.
3. **Inbox**: conversas + mensagens (conteúdo só após decisão explícita de
   retenção/LGPD), UI restrita.
4. **Enviar/receber**: envio via Graph server-only (janela de 24h), status
   de entrega atualizando o ledger.
5. **Templates**: listagem/sincronização e envio fora da janela.
6. **Embedded Signup multiempresa**: onboarding self-service por company,
   reaproveitando o padrão de state/binding do OAuth Meta.
