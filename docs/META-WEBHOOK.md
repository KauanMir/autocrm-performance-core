# Integração Meta — Webhook oficial (Fase 1: infraestrutura)

Rota: `https://crm.assessoriakapa.com.br/api/webhooks/meta`
Implementação: `app/api/webhooks/meta/route.ts` + `lib/server/meta-webhook/*`

## Escopo desta fase

Somente a **infraestrutura mínima e segura de recebimento**. Nada de
comportamento comercial.

- **GET** — handshake de verificação do webhook (`hub.mode`,
  `hub.verify_token`, `hub.challenge`).
- **POST** — recebimento de eventos, com validação HMAC do header
  `X-Hub-Signature-256` sobre o **raw body exato**.
- Após assinatura válida: aceita apenas o objeto `page`; identifica
  mudanças com `field === 'leadgen'`; **registra só metadados técnicos**
  (`page_id`, `form_id`, `leadgen_id`, `created_time`) e responde `200`.
- Eventos `page` não-leadgen e outros objetos: ignorados com `200`.
- Payloads desconhecidos ou JSON inválido: tolerados sem quebrar.

### O que esta fase NÃO faz (proposital)

- Não consulta a Graph API nem busca os dados completos do lead.
- Não implementa OAuth.
- Não cria Lead, tarefa, visita, negociação, timeline; não atribui
  vendedor; não mexe em ranking/pódio; não dispara notificação nem
  automação; não persiste conteúdo pessoal do lead.
- Não adiciona UI, menu, badge, navegação ou configuração visível.
- Não altera middleware (não existe), RLS, policies, tabelas, migrations,
  dependências, nem contratos de backend existentes.
- Não ativa nada para nenhuma company — não há feature flag porque não há
  comportamento visível nem automação nesta fase.

## Variáveis de ambiente (server-only)

| Variável | Uso | Regras |
|---|---|---|
| `META_WEBHOOK_VERIFY_TOKEN` | Comparado com `hub.verify_token` no GET (timing-safe). | Nunca `NEXT_PUBLIC_`, nunca client-side, nunca logado/retornado. |
| `META_APP_SECRET` | Chave HMAC SHA-256 do `X-Hub-Signature-256` no POST. | Idem. **Extremamente sensível.** Configurar direto na Vercel. |

Enquanto qualquer uma estiver ausente/vazia, a rota **falha fechado**
(`500 server misconfigured` no GET/POST) — nunca vaza o motivo nem o valor.

## Como a assinatura é validada (POST)

1. Lê o **raw body** com `request.text()` **antes** de qualquer
   `JSON.parse`.
2. Header esperado: `X-Hub-Signature-256: sha256=<hex de 64 chars>`.
3. `expected = HMAC_SHA256(META_APP_SECRET, rawBody)` em hex.
4. Comparação **timing-safe** (`crypto.timingSafeEqual`) entre os 32 bytes
   recebidos e os calculados.
5. Rejeita com `403` quando: header ausente, prefixo/formato inválido, ou
   assinatura incorreta.
6. Nunca loga: app secret, verify token, assinatura recebida ou calculada
   (nem parcial), access tokens, payload bruto ou PII.

---

## Dívida técnica / pré-requisitos das próximas fases

### 1. Idempotência (OBRIGATÓRIA antes de criar leads reais)

Nesta fase nada é persistido, então não há tabela de idempotência — e não
se deve criar uma só para isso agora.

Quando a criação de Lead real entrar, será **obrigatório** deduplicar
antes de qualquer escrita:

- Chave natural: `leadgen_id` (único por submissão de formulário na Meta).
  Alternativa/complemento: par (`form_id`, `leadgen_id`).
- A Meta **reenvia** o mesmo evento em caso de timeout/erro (retry com
  backoff, até ~36h). Sem dedupe → leads duplicados.
- Estratégia sugerida: tabela dedicada (ex.: `meta_leadgen_events`) com
  `leadgen_id` como `UNIQUE`, gravada **na mesma transação** que cria o
  Lead, ou um `INSERT ... ON CONFLICT DO NOTHING` como guarda antes de
  processar. Registrar também `received_at` e `status` para reprocesso.
- O endpoint deve continuar respondendo `200` rápido para um evento já
  visto (senão a Meta continua tentando).

### 2. Feature flag / rollout controlado (clientes pilotos)

Nenhuma integração Meta pode ficar ativa globalmente por padrão.

- Qualquer tela/superfície de integração Meta nasce com **default OFF**
  (padrão do projeto: `NEXT_PUBLIC_FF_*=false` em `.env.local.example`,
  ativada só em rollout controlado).
- A automação de **criação de lead a partir do webhook** deve ser
  habilitada **por company** (ex.: coluna/flag em `companies` ou tabela
  de conexão Meta por tenant), nunca por variável global booleana.
- **Clientes pilotos existentes não podem receber a integração
  automaticamente** — nenhuma Página/Instagram/conta de anúncios/WhatsApp
  é conectada sem ação explícita por empresa.
- Testes reais começam **apenas com um tenant controlado pela Assessoria
  KAPA**.
- Ativação posterior é **gradual, empresa por empresa**.

### 3. Fases seguintes (fora do escopo atual)

- OAuth / conexão de Página por empresa (Facebook Login for Business,
  `pages_manage_metadata`, `leads_retrieval`).
- Assinatura do campo `leadgen` no app Meta.
- Busca do lead completo via Graph API (`GET /{leadgen_id}`) com o page
  access token da empresa.
- Mapeamento `page_id`/`form_id` → company/pipeline/vendedor.
- Criação de Lead + timeline + (opcional) tarefa, tudo atrás da flag por
  company e da idempotência do item 1.
- Instagram / WhatsApp: só depois, cada um com seu próprio gate.

## Próximo passo operacional (após aprovação do código)

1. commit/push controlado.
2. Configurar `META_WEBHOOK_VERIFY_TOKEN` na Vercel.
3. Configurar `META_APP_SECRET` na Vercel.
4. Redeploy.
5. Testar o GET publicamente (handshake).
6. No Meta for Developers: Callback URL
   `https://crm.assessoriakapa.com.br/api/webhooks/meta` + verify token.
7. Validar o webhook.
8. Assinar **somente** o campo `leadgen`.
