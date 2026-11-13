# KAPA Leads → KAPA CRM (simuladores e landing pages)

Status: **implementado e validado só localmente** (2026-11-11; auditoria final 2026-11-12, §5). Nada publicado, nenhuma migration
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
| CRM migration `20261111130000_lgpd_subject_erasure.sql` | eliminação LGPD de titular (só operador do banco); a recuperação de cursor `kapa_leads_link_rewind` fica na 86 |
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

## 5. Auditoria final (2026-11-12) — o que mudou

| Ponto | Achado | Correção (local) |
|---|---|---|
| Entrega confiável | um lead fora do contrato (ex.: formData com objeto) recusava a página inteira **para sempre**: o cursor não andava e a loja parava de sincronizar | lead identificável (id, loja, data, campanha) mas com conteúdo inválido entra como falha visível `invalid_payload` (sem dados pessoais) e o cursor segue; só um item sem identificação recusa a página |
| Paginação | não havia conferência de ordem dentro da página | `source_invalid_order`: a página precisa vir estritamente crescente em (data com microssegundos, id) e depois do cursor |
| Retomada | divergência na conferência de contagem só gerava alerta, sem como buscar de novo | `kapa_leads_link_rewind(link, desde)` (só operador do banco): volta o cursor, nunca antes da ativação; reimportação é idempotente (testado) |
| Deduplicação | ok: `source_lead_id` único, cursor com compare-and-set, LP com `clientSubmissionId` | — |
| Isolamento | ok: loja → 1 empresa (único), allow-list no KAPA Leads, loja conferida no cliente e no banco | — |
| Autenticação | ok: HMAC v1 sobre método+caminho+query, 300 s, comparação em tempo constante, segredo anterior para troca, rota 404 sem configuração, fora do proxy de sessão | — |
| LGPD | o CRM não tinha como eliminar um titular | migration 87 + `docs/LGPD-ELIMINACAO.md` |

**Cada simulação fica registrada individualmente** (confirmado no código e nos testes): no KAPA Leads cada envio é
um lead novo (o bloqueio de CPF impede repetição na mesma loja por 10 dias úteis); no CRM cada lead do KAPA
Leads vira **uma linha própria** em `lead_form_submissions` (única por evento) + um registro na linha do tempo.
Quando o telefone já existe no CRM (Meta, cadastro manual, importação), o lead existente **não é alterado**
(nome, origem, vendedor, etapa ficam como estão) — a simulação é anexada. Com 2+ leads ativos do mesmo
telefone, vai para revisão: arquivar o duplicado e "Tentar de novo" anexa sem perder nada (descartar apaga
só a cópia do CRM; o original continua no KAPA Leads).

**Meta Lead Ads não é afetado:** rota, agendamento e tabelas próprias; mesma trava por telefone (as duas origens
nunca criam dois leads do mesmo contato ao mesmo tempo); a restrição de origem de `lead_form_submissions` só
ganhou o valor `kapa_leads`; a tela usa a v2 com volta automática à v1. Testes de integração do Meta com as
migrations 86+87: **9 arquivos / 92 PASS** (igual à linha de base).

Ensaio de liberação (2026-11-12, banco descartável com as **mesmas 85 migrations de produção**, hash idêntico): kit `aplicar-migration.ps1` aplicou 86 e 87 com as conferências `02`/`03` em `all_pass`; rollback 87→86 com COMMIT voltou a 85 migrations e à restrição original; reaplicação PASS. O ensaio achou e corrigiu a falta de `kapa_leads_link_rewind` no rollback da 86. Backup + restauração ensaiados: KAPA Leads PASS, CRM PASS.

Validação desta rodada (bancos descartáveis, dados fictícios): pgTAP 88 arquivos / 4827 PASS; unidade da
sincronização 27/27; ponta a ponta real 9/9 (LP 201 com o CRM parado); `tsc` 0.

## 6. Identificadores (consultas somente leitura em produção, 2026-11-12, sem dados pessoais)

| | KAPA Leads (loja / campanha) | KAPA CRM (empresa) |
|---|---|---|
| RCAR | `0a07506a-672e-4ee8-84d8-6962878e059a` "RCAR Seminovos" / `fabrica-de-aprovacao` (origem fabricadeaprovacao.assessoriakapa.com.br) | `6894656c-5d31-4d1d-8c5c-d3522892dcb7` "Rcar Seminovos Gama", ativa, etapa inicial ok |
| Vitrine | `2e174292-c3de-402a-9d64-8f91d2e5b1da` "Vitrine Veículos" / `duelo-de-aprovacoes` (duelo.assessoriakapa.com.br) | `f110488b-3e31-4583-8b75-87cadd0b0b2a` "Vitrine Veículos", ativa, 0 leads |

CRM produção: 85 migrations (última `20261109110000`), nenhuma tabela `kapa_leads_*`. As LPs não perguntam o
veículo de interesse (Duelo tem `tradeInVehicle` = veículo **na troca**): `vehicle_form_key` fica vazio.

## 7. Publicação — operações de produção (cada uma precisa da sua autorização)

**Situação em 2026-11-12:** P1 e P2 **concluídas** (autorizadas pelo dono). P3–P10 não feitas.

P2 — backup do CRM (`qglirrsyhdfbgkmchwcw`), 2026-11-12T23:38Z, pasta `.codex/backups/crm-20261112T233849Z`:
- 17/17; contagens idênticas antes/depois (4 empresas, 17 leads, 8 usuários, 2 eventos Meta, 83 timeline);
  85 migrations, md5 `ed4994…f8ff8`; 0 bans antes e depois; sem Vault, cron ou gatilhos em auth.
- Restauração isolada PASS com 86+87 aplicadas só na cópia; isolamento entre empresas 7 usuários / 9 tabelas /
  0 vazamentos; `03-pos-87` all_pass; checagens estruturais do `02-pos-86` todas verdadeiras.
- pgTAP comparado com a linha de base sem 86/87: nenhuma regressão (a única diferença, `60_company_identity_logo_r1`,
  foi intermitente e passou 77/77 em 4 repetições na cópia migrada).
- Rollback 87→86 na cópia real: volta a 85 migrations, mesmo md5, mesmas contagens e esquema+grants idênticos
  à restauração limpa (pg_dump de public/private/auth/storage: 0 diferenças).
- Cópia GPG no Google Drive `KAPA CRM/Backups/CRM/2026-11-12` (privada; hashes do download iguais); senha no
  Bitwarden "KAPA CRM — Backup produção 2026-11-12 (GPG)", copiada do Bitwarden decifra a cópia do Drive (PASS).
  Senhas removidas do histórico Win+V. **P2 encerrada.**

P3 — correção de disponibilidade feita na preparação: a 86 começa com `set lock_timeout = '5s'` (o ALTER em
`lead_form_submissions`, gravada pelo Meta Lead Ads, desiste em 5 s e volta inteira em vez de travar a fila).
Provado com trava simulada (desistiu em 5,1 s, nada aplicado; sem trava, aplicou) e pelo caminho real da CLI
(`aplicar-migration.ps1 -TestDbUrl` em banco local com as 85 migrations da produção, tabelas com dono `postgres`).

P1 — backup do KAPA Leads (`scjkyzdagwkscuxydgld`), 2026-11-12T20:01Z:
- 20/20 verificações; contagens idênticas antes/depois (2 lojas, 823 leads, 9 usuários, 10 migrations); 0 bans de IP.
- Restauração em contêiner sem rede: PASS (contagens, md5 do histórico, RLS em todas as tabelas, grants,
  funções LGPD, gatilhos de auth, job do cron; 7 usuários sem ver lead de outra loja; controle negativo detecta vazamento).
- Cópia externa GPG AES-256 no Google Drive (conta contato, `KAPA CRM/Backups/KAPA Leads/2026-11-12`, privada);
  senha só no Bitwarden ("KAPA Leads — Backup produção 2026-11-12 (GPG)"). Os 3 arquivos baixados do Drive têm o
  mesmo SHA-256 dos originais, e a senha copiada do Bitwarden decifra a cópia do Drive sem o DPAPI local (PASS).
- Ensaio do CRM (`scripts/db/rehearse-restore-migrations.ps1`) ganhou o teste de isolamento entre empresas por
  comportamento (todas as tabelas com `company_id` legíveis pelo app) e `-IsolationNegativeControl`.

| # | Operação | Sistema | Efeito para o atendimento |
|---|---|---|---|
| P1 | Backup KAPA Leads (`backup-producao.ps1 -System kapa-leads -Execute`) + restauração local comprovada | KAPA Leads | nenhum (só leitura; cria a role temporária da CLI) |
| P2 | Backup CRM (`-System crm`) + restauração com 86+87 aplicadas | CRM | nenhum |
| P3 | Migrations 86 `20261111120000` e 87 `20261111130000` | CRM | nenhum (objetos novos; restrição de origem ampliada) |
| P4 | Push + deploy do CRM (flag desligada) | CRM | cron responde `disabled` |
| P5 | Push + deploy do KAPA Leads **sem** as variáveis | KAPA Leads | rotas novas 404; LP inalterada |
| P6 | Variáveis no KAPA Leads: `CRM_EXPORT_SECRET`, `CRM_EXPORT_STORE_IDS=0a07506a-…` (só RCAR) + redeploy | KAPA Leads | conferir: rota sem assinatura 401, LP 201 |
| P7 | Super Admin vincula a loja RCAR à empresa RCAR (fica pausada) | CRM | nenhum |
| P8 | Variáveis no CRM: `KAPA_LEADS_SYNC_SECRET`, `KAPA_LEADS_API_URL`, `KAPA_LEADS_SYNC_ENABLED=true` + redeploy | CRM | ainda nada entra (vínculo pausado) |
| P9 | Super Admin liga o vínculo (cursor = agora, sem retroativo) | CRM | a partir daqui, leads novos da Fábrica entram em "Sem vendedor" |
| P10 | Depois de dias estáveis: Vitrine (`CRM_EXPORT_STORE_IDS` com as duas, vincular e ligar) | ambos | idem |

Kit de operação: `C:\Users\jaque\Documents\KAPA-Leads-CRM-Liberacao` (LEIA-PRIMEIRO.md).

## 8. Primeiro teste RCAR → KAPA Leads → KAPA CRM (dados fictícios)

Sem lead real como massa e sem tocar no atendimento: o teste usa um **telefone e nome fictícios marcados**
("TESTE KAPA — não atender", telefone de teste combinado), enviado pela própria LP da Fábrica.

1. Antes (P9 feito): combinar com o gestor da RCAR o horário e o nome do teste; painel do CRM mostra "último sucesso".
2. Enviar 1 simulação pela LP com dados fictícios (CPF de teste válido, consentimento marcado).
3. Até ~3 min: o lead aparece no CRM da RCAR em "Sem vendedor", com o card "Origem: Fábrica de Aprovação (KAPA Leads)",
   respostas, valor ilustrativo e consentimento; painel com "recebidos 1".
4. Conferir no KAPA Leads que o lead está lá, igual, e que nada mudou nele (status, responsável).
5. Limpeza: no KAPA Leads, Super Admin exclui o lead de teste liberando o CPF; 5 min depois, no CRM,
   `lgpd_erase_subject('<telefone de teste>', null, 'TESTE-RCAR-01', true)` — isso também prova o procedimento LGPD.
6. Conferência de contagem no painel (KAPA Leads × CRM) na próxima hora.

Atenção: no KAPA Leads o lead de teste aparece na lista da RCAR (para os SDRs) até ser excluído. Por isso o
horário combinado e o nome "não atender". Alternativa sem nenhuma aparição: pular o teste e acompanhar o
primeiro lead real (decisão sua).

## 9. Reverter rapidamente

- **Parar a entrada no CRM, sem afetar as LPs** (segundos): pausar o vínculo no painel do CRM, ou
  `KAPA_LEADS_SYNC_ENABLED=false` + redeploy, ou tirar a loja de `CRM_EXPORT_STORE_IDS`. O cursor fica parado;
  ao religar, os leads do período entram.
- **Código:** CRM volta para `3f60f1a` (seguro com 86/87 aplicadas: objetos novos sem uso, v1 intacta).
  KAPA Leads volta para `50be7a6` (remove só as 2 rotas de leitura).
- **Banco do CRM:** `docs/kapa-leads-sync/rollback-20261111130000.sql` e depois `rollback-20261111120000.sql`
  (só com autorização; normalmente desnecessário).
- Leads já sincronizados ficam no CRM (arquivar se for preciso). O KAPA Leads nunca é alterado pela integração.

## 10. Limites conhecidos

- Lead excluído no KAPA Leads continua no CRM: o pedido LGPD é atendido nos dois (`docs/LGPD-ELIMINACAO.md`).
- Um INSERT que demore mais de 60 s para confirmar no KAPA Leads poderia ficar atrás do cursor: improvável; a
  conferência de contagem mostra e `kapa_leads_link_rewind` busca de novo.
- Simulação anexada a um lead já vendido/perdido fica registrada na linha do tempo, mas não reabre o lead
  (mesmo comportamento do Meta Lead Ads).
