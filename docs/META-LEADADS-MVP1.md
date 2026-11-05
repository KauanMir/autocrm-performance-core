# Meta Lead Ads — MVP-1 (confiabilidade)

Estado: implementado e validado **localmente** (branch `audit/mvp-basico`). Nada
publicado, nenhuma migration aplicada fora de banco descartável, nada alterado na
Meta ou na Vercel. A restrição à company/Página de teste (`META_TEST_COMPANY_ID`,
`META_TEST_PAGE_ID`) continua igual; liberar outras concessionárias é o MVP-2.

Migration: `supabase/migrations/20261106100000_meta_leadads_mvp1_reliability.sql`.
pgTAP: `supabase/tests/90_meta_leadads_mvp1_reliability.sql`.

## 1. Fluxo depois do MVP-1

```
Meta ──POST leadgen──▶ /api/webhooks/meta
   HMAC ok → Page de teste? → conexão connected OU error? → ledger (único por page+leadgen)
   responde 200 (ou 503 se o registro durável falhar: a Meta reentrega)
   waitUntil: processa o evento + sweep oportunístico de até 5 eventos vencidos

processor (por evento, com lease):
   conexão → validade salva do token → decrypt → GET /{leadgen_id}
   → mapeamento do formulário (company + form_id) → normalização
   → complete_v2: lead + respostas + histórico + evento processed NA MESMA TRANSAÇÃO
```

## 2. Tokens

- O callback OAuth (somente company de teste) agora:
  1. troca o token de usuário por **longa duração** (`fb_exchange_token`) quando a
     troca do `code` informa `expires_in`; sem `expires_in` usa o token como veio;
  2. deriva o token de Página com esse token;
  3. verifica o token de Página com **`GET /debug_token`** (token de app no header):
     precisa ser válido, do nosso app, do tipo `PAGE`, sem vencer em menos de 7 dias
     e com acesso a dados não vencido. Caso contrário, **não inscreve e não salva**.
- A conexão guarda `token_origin`, `token_expires_at`, `token_data_access_expires_at`
  e `token_checked_at` (nunca o token em claro).
- O processor marca a conexão como `error` quando a Meta recusa o token (código 190),
  quando falta permissão, ou quando a validade salva já passou. A tela mostra
  "Reconexão necessária". Reconectar (novo OAuth) volta a `connected`.
- Conexões criadas antes do MVP-1 aparecem como "Validade não verificada" até uma
  reconexão.

## 3. Retry, falhas definitivas e reprocessamento

| Classe | Exemplos | O que acontece |
|---|---|---|
| retryable | timeout, erro da Graph, lead ainda indisponível | nova tentativa em 1/5/15/60 min, até 5 |
| operational | token inválido/vencido, permissão, etapa "Novo" ausente | nova tentativa a cada 1 h sem consumir tentativa; conexão marcada como erro |
| terminal | sem nome, sem telefone válido, duplicidade ambígua, 5 tentativas, 7 dias | `failed`, aparece na fila |

- **Nada some**: todo evento registrado termina `processed` ou fica visível na fila
  (`failed`, `retrying` ou `stuck`). `stuck` inclui evento vencido há mais de 15 min
  sem processamento — sinal de que o agendador não está rodando.
- Falha na gravação (lead ou respostas) desfaz a transação: o evento **não** vira
  `processed`; o lease expira e ele volta ao claim.
- **Reprocessar** (Manager da company ou Super Admin; hoje a tela só existe para a
  company de teste): volta o evento a `received` com tentativas zeradas e nova janela
  de 7 dias. Recusado para evento já processado, encerrado, com mais de 90 dias
  (limite de retenção da Meta) ou reprocessado 10 vezes. Auditado em `audit_log`.
- **Encerrar** (só falhas): motivo fechado (`tratado manualmente`, `duplicado`,
  `evento de teste`, `não recuperável`), auditado; sai da fila.
- Falhas por dados (sem nome/telefone) podem ser resolvidas mapeando o campo do
  formulário e reprocessando.

## 4. Agendamento (sweep)

- Rota: `GET /api/cron/meta-leadgen-sweep` com `Authorization: Bearer <CRON_SECRET>`.
- **Não existe `vercel.json` nesta rodada** (há teste que garante isso). O plano da
  Vercel não foi verificado. Limites oficiais: Hobby só **uma vez por dia** (expressão
  mais frequente **faz o deploy falhar**); Pro até uma vez por minuto.
- Gere a configuração com `buildVercelCronConfig(plano)` em
  `lib/server/meta-webhook/sweep-schedule.ts`. Pro (recomendado):

  ```json
  { "crons": [{ "path": "/api/cron/meta-leadgen-sweep", "schedule": "*/5 * * * *" }] }
  ```

  Hobby: `"17 6 * * *"` (retry pode atrasar até ~25 h).
- Independente do plano, cada lead novo dispara um sweep oportunístico de até 5
  eventos vencidos, e o "Reprocessar" processa na hora.
- Teste local do agendador (servidor dev do usuário em 127.0.0.1:3000, `CRON_SECRET`
  no shell): `npm run meta:sweep-local -- --interval 30 --runs 10`. Recusa qualquer
  host que não seja loopback.

## 5. Respostas do formulário

- Tabela `lead_form_submissions` (uma linha por evento processado): nome, telefone
  canônico, e-mail (se válido), veículo de interesse (se mapeado), `form_id`, `ad_id`,
  data de envio na Meta e as **demais respostas** em ordem (`[{key, values}]`, até 50
  respostas, 10 valores, 1000 caracteres).
- Nada é inventado: sem mapeamento de veículo, `vehicle_interest` fica vazio e o lead
  recebe "Não informado" (o CRM exige o campo). E-mail inválido não vira e-mail, mas
  fica nas respostas.
- **Lead existente (mesmo telefone) nunca é alterado**: ganha uma nova submissão e a
  entrada "Novo formulário Meta recebido" no histórico.
- **Minimização**: campos de documento (`cpf`, `cnpj`, `rg`, `national_id`,
  `national_id_number`, `documento`) não são guardados. Mudar isso exige decisão.
- Leitura só por `list_lead_form_submissions`, com a mesma visibilidade do lead
  (Seller só vê lead próprio). O ledger continua sem PII.
- Mapeamento por formulário (`meta_lead_form_mappings`): alvo `name`, `phone`,
  `email` ou `vehicle` → nome do campo no formulário. Por company: o mesmo formulário
  em outra company não herda nada.

## 6. Logs

Cada tentativa gera `[meta-leadgen] {operation, trigger, eventRef, outcome, errorCode,
integrationMarked, answersCount, ...}`. `eventRef` é o UUID **interno** da linha do
ledger (liga o log à fila). Nunca token, nome, telefone, e-mail, respostas ou IDs da
Meta.

## 7. Ordem segura de publicação (quando autorizada)

1. Backup real com restauração comprovada (pendência da Liberação B).
2. Aplicar a migration (as funções antigas continuam para o código publicado).
3. Publicar o código.
4. Reconectar a Página de teste (o token antigo não tem validade verificada).
5. Configurar o cron conforme o plano real.
