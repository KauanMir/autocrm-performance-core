# Meta Lead Ads — MVP-2 (multiempresa)

> **NÃO LIBERADO PARA PRODUÇÃO.** Este código existe só em commits locais da branch
> `audit/mvp-basico`, sem upstream e sem push. Aprovado para preservação local, não para
> publicação. A publicação depende de autorização própria e do checklist da seção 8.

Estado: implementado e validado **localmente**. Nada publicado, nenhuma migration aplicada
fora de banco descartável, nada alterado na Meta, na Vercel ou no Supabase remoto. A
Liberação B segue congelada, e as migrations deste pacote não fazem parte dela.

Migration: `supabase/migrations/20261109110000_meta_leadads_mvp2_multicompany.sql`.
pgTAP: `supabase/tests/91_meta_leadads_mvp2_multicompany.sql`.
Ponta a ponta local: `tests/integration/meta/mvp2-multicompany-local.test.ts`.

## 1. Fluxo multiempresa

```
Super Admin habilita a empresa (desligada por padrão; exige empresa ativa)
        │
Manager ── Ajustes > Integrações > Conectar Meta
        │  POST /oauth/start: sessão real, Manager da empresa ou Super Admin,
        │  empresa habilitada; state assinado com usuário e empresa + cookie de binding
        ▼
Meta (Login do Facebook para Empresas)
        ▼
GET /oauth/callback: state + binding → troca do code → token de longa duração →
        quatro permissões → Páginas com a task ADVERTISE → tokens cifrados com
        AAD empresa+Página → seleção de uso único, válida por 10 minutos
        │  navegador recebe só: cookie HttpOnly com o token assinado da seleção
        │  e o marcador sem segredo ?meta_select=1
        ▼
Tela lista id e nome das Páginas → usuário escolhe
        ▼
POST /oauth/page-selection: Bearer do MESMO usuário → autorização relida no banco →
        Página oferecida? → Página livre? → consome a seleção → debug_token →
        leitura da Página → inscreve leadgen → grava a conexão
```

```
Meta ── POST /api/webhooks/meta (HMAC)
   Página conectada numa empresa habilitada ──▶ ledger da empresa ──▶ processor ──▶ lead
   qualquer outro caso ──▶ evento RETIDO sem empresa (seção 5)
```

A empresa do lead vem **só** da conexão da Página no banco. Nada do payload do webhook,
da URL ou do corpo das requisições escolhe empresa.

## 2. Habilitação da concessionária

- Tabela `company_meta_lead_ads_access`, desligada por padrão. Ausência de linha é
  desligado. Nenhuma empresa é habilitada pela migration.
- Só o Super Admin liga ou desliga (`meta_lead_ads_set_company_access`), em
  Ajustes > Integrações da empresa aberta. A alteração vai para o `audit_log`.
- **Só empresa `ativa` recebe leads.** A policy de leitura de `leads` exige esse status:
  lead criado em empresa em implantação ou suspensa ficaria invisível para todos. Ligar
  fora de `ativa` é recusado (`company_not_active`), e uma empresa suspensa depois de
  habilitada passa a ser tratada como desligada: os eventos ficam retidos.
- Manager lê o estado e só vê a aba Integrações com a empresa habilitada. Seller nunca
  vê a aba nem consulta o estado.

## 3. Conexão e seleção da Página

Garantias, todas validadas no servidor e no banco:

| Garantia | Como |
|---|---|
| Mesmo usuário | `meta_page_selection_*` filtram por usuário e empresa; a rota compara o Bearer com o usuário do token assinado |
| Mesma empresa | Empresa e usuário saem do token assinado, nunca do corpo. O corpo só aceita `page_id` |
| Permissão relida | A cada chamada, `meta_lead_ads_company_access` como o usuário. Perder o papel ou a habilitação bloqueia |
| 10 minutos | TTL na RPC, constraint na tabela, `exp` do token e `Max-Age` do cookie |
| Uso único | `FOR UPDATE` no consumo; ciphertexts apagados ao consumir; replay → `selection_already_used` |
| Página oferecida | Conferida antes do dono, para ninguém sondar Páginas de outras empresas |
| Posse da Página | Conexão `connected` **ou** `error` de outra empresa recusa, na rota e em `meta_connection_upsert_v2`, com lock por Página |
| Sem token no navegador | Tokens da Meta nunca saem do servidor. O token assinado da seleção fica em cookie HttpOnly, `SameSite=Strict`, restrito à rota |
| Sem token em URL ou log | A URL carrega só `meta_select=1` ou `meta_error=<código do catálogo>`. Logs não têm token, Page ID, empresa ou usuário |
| Retenção mínima | Novo OAuth apaga a seleção anterior do mesmo usuário na empresa; seleção vencida sai no próximo OAuth, na tentativa de uso ou no sweep |

Uma empresa pode ter mais de uma Página. Conectar outra não desconecta a anterior. A mesma
Página só pertence a uma empresa por vez.

Falhas depois de consumir a seleção (token recusado pela Meta, inscrição recusada, gravação
falhou) exigem um novo "Conectar Meta": a tela tira a lista e explica. Falhas antes de
consumir (Página de outra empresa, Página fora da lista) mantêm a lista para escolher outra.

No fluxo pela tela, falha no retorno da Meta volta para Integrações com uma mensagem. O
código da URL só seleciona texto de um catálogo fechado: nada da Meta é refletido.

## 4. Recebimento e atribuição de leads

1. Lead novo entra sem vendedor, na etapa `new`, com as respostas do formulário.
2. Tela Clientes do Manager: filtro **Sem vendedor (N)** e aviso com a quantidade. Enquanto a
   leitura não termina ou falha sem dados, a tela não mostra número.
3. O Manager abre o lead e atribui (`assign_lead_seller`, que já existia).
4. O Seller passa a ver o lead e as respostas. Antes disso a RLS esconde o lead dele.
5. Funil e histórico atualizam pelo fluxo normal.

Atribuição usa `expected_version`: duas atribuições simultâneas não corrompem nada, a segunda
recebe `stale_write`. Falha de atribuição não altera o lead, que continua na fila.

## 5. Eventos sem dono (Página inscrita sem conexão ativa)

**O problema.** A inscrição `leadgen` é da Página na Meta, e não some quando a conexão deixa de
existir no CRM. Antes do MVP-2, o webhook respondia 200 sem registrar nada: a Meta não reenvia,
e o lead ficava perdido em silêncio. As causas possíveis:

- gravação da conexão falhou depois de a Meta aceitar a inscrição;
- corrida entre duas empresas pela mesma Página;
- empresa desligada ou suspensa com a Página ainda inscrita;
- conexão removida do banco manualmente;
- Página inscrita por testes antigos, sem conexão salva.

**O tratamento local.** Evento com assinatura válida e sem dono utilizável vai para
`meta_leadgen_unrouted_events`, com motivo `no_connection`, `company_disabled` ou
`ambiguous_owner`. Se a gravação falhar, o webhook responde 503 e a Meta reentrega.

- Só metadados técnicos: IDs de Página, lead e formulário. Sem PII.
- **Sem empresa de propósito:** reter o evento não decide de quem ele é.
- Reentrega não duplica. Evento que já está no ledger não é retido.
- Visível só para o Super Admin, em Ajustes > Integrações.
- **Liberar é ato humano e auditado** (`meta_leadgen_unrouted_adopt`). Exige a Página conectada
  na empresa aberta, empresa habilitada e nenhuma outra dona. O evento entra no fluxo normal,
  com a janela de 7 dias reiniciada.
- Retenção de 90 dias, o prazo em que a Meta mantém o lead. Depois disso o sweep remove.

Quando a conexão falha depois da inscrição, o log traz o sinal `subscribed_without_connection`,
sem IDs.

**Procedimento recomendado (operação externa, não executado).** Nenhuma inscrição ou
cancelamento foi feito na Meta.

1. Super Admin confere "Eventos retidos". Página conhecida: Manager da empresa certa conecta
   a Página e o Super Admin libera.
2. Página que não deve mais enviar leads: a pessoa responsável cancela a inscrição do app na
   Página, no Business Manager, e os eventos retidos expiram.
3. Antes de cada piloto, levantar as Páginas inscritas no app e comparar com as conexões. Esse
   levantamento exige Graph real e autorização sua.

Não há cancelamento automático de inscrição: uma falha de banco cancelaria a inscrição de uma
Página em uso.

## 6. Tratamento de falhas

| Situação | Comportamento |
|---|---|
| Empresa desabilitada, suspensa ou em implantação | Nenhum lead. Evento retido como `company_disabled` |
| Página sem conexão | Evento retido como `no_connection` |
| Duas conexões em erro na mesma Página | Evento retido como `ambiguous_owner` |
| Retenção falhou | 503, a Meta reentrega |
| Token revogado (código 190) | Conexão vira `error`, evento na fila de revisão, nenhum lead |
| Evento com conexão em erro | Fica no ledger da dona. Reconectar e reprocessar cria o lead |
| Outra empresa tenta a Página em erro | Recusado: `page_already_connected` |
| Empresa desligada entre o registro e a gravação | `company_access_disabled`, evento visível na fila |
| Telefone igual em empresas diferentes | Um lead em cada, sem cruzar |
| Entrega repetida | Mesmo lead: chave única por Página e lead |

## 7. Limitações que continuam

- **App da Meta em Development Mode.** Enquanto não estiver Live com as permissões aprovadas,
  Páginas e pessoas fora dos papéis do app não funcionam. É o principal bloqueio do piloto.
- **Sem desconexão pelo CRM.** Não há botão nem rota: desconectar localmente sem cancelar a
  inscrição criaria justamente o caso da seção 5. Para interromper uma empresa, o Super Admin
  a desabilita, e os leads ficam retidos.
- **Revogação feita pelo cliente** só é percebida no próximo lead: não há webhook de
  desautorização.
- **Sem cron frequente no plano Hobby.** Novas tentativas e o expurgo andam quando chega um lead
  ou no cron diário. A liberação de eventos retidos agenda o próprio sweep, de até 20 eventos.
- **`META_LEAD_INGESTION_ENABLED` desligada** descarta o evento antes do banco, de propósito.
  Precisa estar ligada antes de qualquer piloto.
- **Até 25 Páginas por seleção**, entre as 100 primeiras da conta. Com mais que isso, o fluxo
  pela tela não avisa. O Login para Empresas costuma limitar às Páginas marcadas pelo usuário.
- **Recarregar a tela durante a seleção** faz o painel sumir. A seleção vale até vencer, mas é
  preciso conectar de novo para vê-la.
- **Limite de 1.000 linhas do PostgREST** em `fetchActiveLeadRows`, anterior ao MVP-2: empresa
  com mais de 1.000 leads ativos não vê os mais antigos, e a contagem de "Sem vendedor" considera
  só os carregados. Leads novos vêm primeiro.
- **Diagnóstico técnico** (`/api/integrations/meta/diagnostics`) continua só para a company de
  teste. A saúde por empresa está no painel Operação Lead Ads.
- **Código legado sem uso:** o fluxo `meta_review` (rota `review-status`, `review-result.ts` e o
  bloco "Página de teste" em `MetaIntegrationsTabSection`) não é mais alcançado pelo callback.
  Pode sair numa limpeza própria.
- **CPF, RG e CNPJ** seguem omitidos das respostas por minimização (decisão pendente do MVP-1).

## 8. Checklist do primeiro piloto

Nada disto foi executado. Cada item exige autorização própria.

Antes de publicar:

- [ ] Revisão e commits locais do MVP-2 aprovados.
- [ ] Backup real com restauração comprovada (exigência da Liberação B).
- [ ] App da Meta Live, com permissões aprovadas no App Review.
- [ ] Levantamento das Páginas inscritas no app (seção 5, passo 3).
- [ ] Decisão sobre cron e plano da Vercel.

Publicação, nesta ordem:

- [ ] Aplicar as migrations `20261106100000` e `20261109110000` (renumerada de 20261107100000 na integração de 2026-11-09: a versão colidia com `whatsapp_conversation_lead_link_w2b9`).
- [ ] **Na mesma janela**, habilitar a company de teste: sem isso, a conexão existente deixa de
      registrar eventos, e eles ficam retidos até a liberação.
- [ ] Publicar o código.
- [ ] Conferir `META_CONNECTION_PERSISTENCE_ENABLED`, `META_LEAD_INGESTION_ENABLED` e
      `NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW`.

Concessionária piloto:

- [ ] Empresa com status `ativa`, Manager e ao menos um Seller ativos, etapa `new` no funil.
- [ ] Super Admin habilita Lead Ads.
- [ ] Manager conecta a Página e confere "Operação Lead Ads".
- [ ] Lead de teste real: chega em "Sem vendedor", é atribuído, aparece para o Seller, avança no
      funil, e o histórico registra.
- [ ] "Eventos retidos" vazio e fila de revisão sem falhas.
- [ ] Manager sabe onde agir em "Reconexão necessária".
- [ ] Combinar quem acompanha a fila "Sem vendedor" e em que horário.
