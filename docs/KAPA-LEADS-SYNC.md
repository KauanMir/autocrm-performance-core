# KAPA Leads → KAPA CRM (simuladores e landing pages)

Status: **implementado e validado só localmente** (2026-11-11). Nada publicado, nenhuma migration
aplicada fora de bancos locais descartáveis, nenhum dado real usado.

```
Simulador / LP ──POST──▶ KAPA Leads (grava e responde; INALTERADO)
                              ▲
                              │ GET assinado, somente leitura, a cada 2 min
KAPA CRM (cron) ──────────────┘ → fila durável → lead em Clientes → Sem vendedor
```

## 1. Por que pull (o CRM busca) e não push

| Alternativa | Problema |
|---|---|
| LP grava nos dois | a simulação dependeria de duas gravações; proibido pelo requisito |
| Trigger/outbox no banco do KAPA Leads | muda a transação de gravação do lead real; falha do trigger derruba a captação; exige migration no sistema comercial |
| Push do KAPA Leads após responder (`after()`) | mexe no caminho quente; se a função morrer, perde; precisaria de varredura igual |
| **Pull com cursor (escolhido)** | zero mudança na gravação, zero migration no KAPA Leads; a própria tabela de leads é a fila durável; o CRM fora do ar não afeta nada lá; ao voltar, continua do cursor |

Custo aceito: latência de até ~3 min (agendamento de 2 min + 60 s de confirmação).

## 2. Garantias

- **KAPA Leads protegido:** rota nova somente `SELECT`, desligada por padrão (404), fora do proxy do
  Admin, assinatura HMAC, lojas liberadas por variável, dados mínimos (nunca CPF, nascimento,
  status, responsável, observações). O handler público das LPs não foi tocado.
- **Sem retroativo:** o cursor é gravado no momento em que o Super Admin liga a loja; a rota do
  KAPA Leads exige cursor; o banco do CRM recusa itens anteriores ao cursor.
- **Sem duplicar:** `source_lead_id` único na fila; o cursor avança no mesmo comando que grava a
  página, com compare-and-set; reenvio da LP (mesmo `clientSubmissionId`) já não cria lead no KAPA Leads.
- **Mesmo contato do Meta Lead Ads:** mesmo bloqueio por telefone (`meta_lead_phone:<empresa>:<tel>`);
  com 1 lead ativo do telefone → associa (`linked_existing`), registra a simulação no histórico e na
  linha do tempo, sem mudar nome/origem do lead; com 2+ → revisão manual.
- **Nada some em silêncio:** formato inválido entra como falha visível; erro transitório → nova
  tentativa com espera crescente (até 12); empresa pausada → fica retido sem contar tentativa.
- **Isolamento:** uma loja só alimenta uma empresa; a página com lead de outra loja é recusada inteira;
  leituras por Manager/Super Admin da própria empresa; Seller só vê o lead quando atribuído a ele.
- **PII mínima no CRM:** nome, telefone, e-mail (se houver), respostas do simulador com rótulos,
  valor ilustrativo e validade, data de liberação de nova simulação, consentimento (versão e data),
  UTMs e página. O payload da fila é apagado depois de processado.

## 3. Componentes

| Onde | O quê |
|---|---|
| KAPA Leads `ac2f9e9` (branch `codex/crm-export`) | `GET /api/integrations/crm/leads` e `/count`, `src/lib/crm-export/*`, exceção no `proxy.ts`, `docs/integracao-crm.md` |
| CRM migration `20261111120000_kapa_leads_sync.sql` | `kapa_leads_store_links`, `kapa_leads_inbound_events`, RPCs, `list_lead_form_submissions_v2`, origem em `lead_form_submissions` |
| CRM `lib/server/kapa-leads-sync/*` + `app/api/cron/kapa-leads-sync` | worker (assinatura, cliente, normalização, ciclo) |
| CRM UI | Ajustes → Integrações → "Simuladores e landing pages (KAPA Leads)"; origem no card do formulário do lead |
| `vercel.json` | agendamento `kapa-leads-sync` a cada 2 min (responde `disabled` sem a flag) |

## 4. Validação local (dados fictícios, bancos descartáveis)

- KAPA Leads: unit 197/197 (inclui assinatura, config, export, matcher do proxy), typecheck, lint, build.
- CRM: pgTAP 87 arquivos / 4793 (novo `92_kapa_leads_sync.sql`: 68 asserções), `tsc` 0, suíte
  completa 403 arquivos / 6918 testes, build.
- Ponta a ponta (`tests/integration/kapa-leads/sync-e2e-local.test.ts`, orquestrado fora do repo):
  KAPA Leads real (`next start`) + banco local dele; CRM real (rota cron) + banco local.
  Comprovado: lead entra no KAPA Leads → chega ao CRM na empresa certa, sem vendedor, com origem,
  simulação, consentimento e UTMs; lead anterior à ativação e de outra loja não entram; Manager vê,
  Manager de outra empresa não; Seller vê depois de atribuído; reenvio da LP, novo ciclo e página
  repetida não duplicam; nova simulação do mesmo contato associa; pausa não perde e religar traz o
  lead do período; **com o gateway do CRM parado a LP recebeu 201**; com o KAPA Leads fora do ar o
  cursor não anda e a falha fica registrada; a conferência de contagem mostra KAPA Leads 1 × CRM 1.

## 5. Publicação — plano para aprovação (nada disto foi feito)

**5.1 Projetos alterados:** KAPA Leads (só código: 2 rotas de leitura + 1 linha do `proxy.ts`) e KAPA
CRM (migration + código). As landing pages (Fábrica, Duelo) **não mudam**.

**5.2 Migrations:** só no CRM: `20261111120000_kapa_leads_sync.sql` (produção 85 → 86). KAPA Leads:
nenhuma.

**5.3 Variáveis (Vercel Production, todas server-only/sensitive):**

| Projeto | Variável | Valor |
|---|---|---|
| KAPA Leads | `CRM_EXPORT_SECRET` | 64 hex aleatórios (gerado por script, colado pelo dono, nunca exibido) |
| KAPA Leads | `CRM_EXPORT_STORE_IDS` | UUID da loja RCAR (depois a Vitrine) |
| CRM | `KAPA_LEADS_SYNC_SECRET` | o mesmo segredo |
| CRM | `KAPA_LEADS_API_URL` | `https://leads.assessoriakapa.com.br` |
| CRM | `KAPA_LEADS_SYNC_ENABLED` | `true` só na etapa F |

`CRON_SECRET` do CRM já existe. Os UUIDs das lojas saem de uma consulta somente leitura no KAPA
Leads (`select id, slug from stores`), com autorização.

**5.4 Ativação gradual:**
- A. Backup do CRM + prova de restauração; aplicar a migration (86).
- B. Deploy do CRM com a flag desligada: o cron responde `disabled` e nada muda.
- C. Deploy do KAPA Leads **sem** as variáveis: as rotas novas respondem 404 e nada muda para as LPs.
- D. Variáveis no KAPA Leads (só a RCAR) e redeploy; conferir que a rota sem assinatura responde 401
  e a LP continua 201.
- E. Super Admin vincula a loja RCAR à empresa "Rcar Seminovos Gama" (fica pausada).
- F. Variáveis no CRM com a flag ligada e redeploy; o Super Admin liga o vínculo (cursor = agora).
- G. Primeiro lead: o próximo lead real da Fábrica, ou um teste controlado na LP, se você autorizar.
  Conferir: painel, lead em Sem vendedor, card de origem, KAPA Leads inalterado.
- H. Depois de alguns dias estável, a Vitrine (Duelo): incluir a loja em `CRM_EXPORT_STORE_IDS`,
  vincular e ligar.

**5.5 Falha no CRM não afeta o KAPA Leads:** o KAPA Leads nunca chama o CRM; a LP só fala com o
KAPA Leads; a rota nova só lê; testado com o CRM parado.

**5.6 Monitoramento:** painel em Ajustes → Integrações (último sucesso, na fila, para revisar,
recebidos em 7 dias, alerta de 15 min sem sucesso, conferência de contagem KAPA Leads × CRM); logs
`[kapa-leads-sync]` no CRM e `crm_export` no KAPA Leads, só com contadores.

**5.7 Desligar sem parar os simuladores:** pausar a loja no painel do CRM (por loja) ou
`KAPA_LEADS_SYNC_ENABLED=false` (tudo) ou tirar a loja de `CRM_EXPORT_STORE_IDS` no KAPA Leads. Ao
religar, os leads do período entram (o cursor ficou parado).

**5.8 Rollback:**
- Código do CRM: voltar para `3f60f1a` é seguro com a migration aplicada (objetos novos sem uso;
  `list_lead_form_submissions` v1 intacta; a tela antiga cai para a v1).
- Código do KAPA Leads: voltar para `50be7a6` remove só as rotas novas.
- Banco do CRM: `docs/kapa-leads-sync/rollback-20261111120000.sql` (só com autorização; normalmente
  desnecessário).
- Leads já sincronizados continuam no CRM (arquivar se for preciso).

**5.9 Backups:** CRM: backup novo + prova de restauração antes da etapa A (mesmo kit da RCAR).
KAPA Leads: sem migration; recomendo um backup lógico antes da etapa C, porque o Supabase Free não
tem backup gerenciado e o sistema tem leads reais.

## 6. Limites conhecidos

- Lead apagado no KAPA Leads depois de sincronizado continua no CRM: o pedido LGPD precisa ser
  atendido nas duas plataformas.
- Um INSERT que demore mais de 60 s para confirmar no KAPA Leads poderia ficar atrás do cursor: é
  improvável (INSERT único) e a conferência de contagem mostra a diferença.
- Veículo de interesse: as LPs atuais não perguntam o modelo (Duelo pergunta o valor). O campo fica
  "Não informado" e, se uma LP passar a enviar, basta informar a chave no vínculo.
