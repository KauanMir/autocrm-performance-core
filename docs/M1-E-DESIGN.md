# M1-E — DESIGN FINAL CONSOLIDADO — Revisão 3

Objetivo do módulo: migrar a fonte de verdade dos leads/cards do localStorage
para o Supabase, com isolamento total entre empresas, permissões por role,
cache via TanStack Query, feature flag com rollback seguro e nenhum dual-write
permanente. Toda escrita em leads acontece exclusivamente por RPC — o frontend
não recebe nenhum grant de escrita nas tabelas.

Base: decisões aprovadas nas revisões anteriores deste design, o design do
M1-C (Revisão 4) e a infraestrutura de cache/identidade do M1-D.

## 1. Decisões de produto fechadas

Visibilidade:

- Admin vê todos os leads da empresa.
- Manager vê todos os leads da empresa.
- Seller vê somente leads com `seller_id` igual ao seu próprio.
- Seller não vê leads sem vendedor atribuído.
- Seller nunca vê leads arquivados.
- Admin e manager consultam arquivados numa visualização dedicada.
- "Assumir lead sem vendedor" fica fora do M1-E; será RPC futura (`claim_lead`).

Criação e vendedor:

- Todos os roles criam lead, exclusivamente via RPC `create_lead`.
- Seller cria lead automaticamente atribuído a si.
- Admin e manager criam atribuído a um seller ativo da empresa ou sem vendedor.
- Seller não desatribui nem reatribui lead.
- Apenas admin e manager atribuem, trocam ou removem vendedor
  (RPC `assign_lead_seller`).

Duplicidade:

- Telefone repetido não é bloqueado por UNIQUE.
- `phone_digits` é usado para detecção e indexação.
- A checagem respeita RLS via RPC dedicada `check_lead_phone_duplicate`
  (§6.9), que não presume unicidade e pode retornar vários duplicados.
- Duplicado acessível: a interface oferece abrir cliente existente, criar
  mesmo assim ou cancelar.
- Duplicado não acessível ao seller: mensagem "Já existe um cliente com este
  telefone, mas ele não está na sua carteira.", com as opções criar mesmo
  assim ou cancelar — sem revelar nome, ID, vendedor ou qualquer detalhe.
- Nenhuma importação ou merge automático.

Movimentação:

- Admin e manager movem qualquer lead da empresa; seller move somente os seus.
- Stage terminal não tem comportamento especial no M1-E.
- Voltar de Fechamento para outra etapa é permitido (o cancelamento de venda
  depende disso).
- Drag de card é last-write-wins na primeira versão.

Arquivamento:

- Apenas via RPC, apenas admin e manager. Nunca há exclusão física.

Campos de sistema:

- `urgency`, `last_activity_label` e `alert_label` são controlados pelo
  servidor. O cliente nunca envia esses valores: eles são derivados de um
  evento fechado pela RPC `apply_lead_event` (§6.4). Não entram em
  `create_lead` nem em `update_lead` e não possuem grant de escrita.

Valor do veículo:

- `value_amount` permanece no schema, nullable, e **nenhuma RPC do M1-E a
  altera**. O formulário atual não captura valor (grava o placeholder "—"),
  então a coluna nasce e permanece null até existir um fluxo de produto real
  que a edite. Não há parâmetro reservado "para uso futuro".

## 2. Schema `public.leads`

Pré-requisito: enums `lead_urgency ('red','amber','green')`,
`lead_temperature ('hot','warm','cold')`, `lead_event_type` (§6.4) e
`lead_duplicate_status ('none','accessible','restricted')` (§6.9).

| Coluna | Tipo | Null | Default | Constraint | Motivo |
|---|---|---|---|---|---|
| `id` | `uuid` | não | `gen_random_uuid()` | PK | ID nasce no banco; frontend nunca fabrica |
| `company_id` | `uuid` | não | — | FK para `companies(id)` ON DELETE CASCADE; `unique (company_id, id)` | isolamento; unique composta é alvo das FKs futuras e da timeline |
| `name` | `text` | não | — | `check (btrim(name) <> '')` | campo essencial nunca vazio |
| `phone` | `text` | não | — | `check (btrim(phone) <> '')` | formato de exibição preservado (máscara é da UI) |
| `phone_digits` | `text` | — | `generated always as (regexp_replace(phone, '\D', '', 'g')) stored` | `check (phone_digits <> '')` | duplicidade e busca; exige ao menos um dígito real; sem tamanho fixo, sem UNIQUE |
| `car` | `text` | não | — | `check (btrim(car) <> '')` | obrigatório no fluxo atual |
| `stage_id` | `uuid` | não | — | FK composta `(company_id, stage_id)` para `pipeline_stages(company_id, id)` ON DELETE RESTRICT | vínculo por id, nunca por name; estágio de outra empresa é impossível |
| `seller_id` | `text` | sim | `null` | FK composta `(company_id, seller_id)` para `sellers(company_id, id)` ON DELETE RESTRICT | `text` porque `sellers.id` é text nesta fase; null = sem vendedor |
| `urgency` | `lead_urgency` | não | `'red'` | — | controlado pelo servidor; lead novo sem contato é sempre red |
| `temperature` | `lead_temperature` | sim | `null` | — | intenção de compra; seeds antigos não têm |
| `last_activity_label` | `text` | sim | `null` | — | rename de `last`; escrito só por `create_lead` (default) e `apply_lead_event` |
| `alert_label` | `text` | sim | `null` | — | rename de `alert`; idem |
| `payment_preference` | `text` | sim | `null` | — | rename de `pay` |
| `value_amount` | `numeric(12,2)` | sim | `null` | `check (value_amount >= 0)` | substitui a string de valor; nenhuma RPC do M1-E escreve nela (§1) |
| `source` | `text` | sim | `null` | — | rename de `origem` |
| `created_by_profile_id` | `uuid` | sim | — | FK composta de auditoria (§4) | quem cadastrou |
| `updated_by_profile_id` | `uuid` | sim | — | FK composta de auditoria (§4) | quem alterou por último; sempre definido pelo servidor |
| `archived_at` | `timestamptz` | sim | `null` | — | arquivamento soft |
| `version` | `integer` | não | `1` | `check (version >= 1)` | token de concorrência (§5); incrementado por trigger a cada UPDATE efetivo |
| `created_at` | `timestamptz` | não | `now()` | — | auditoria |
| `updated_at` | `timestamptz` | não | `now()` | trigger `set_updated_at` | somente auditoria; não é token de concorrência |

O adapter (`lib/leads/adapter.ts`) mantém compatibilidade temporária com o
tipo `Lead` atual: expõe `last`, `alert`, `pay`, `origem`, `stage` (name
derivado do cache de stages) e `value` (string formatada) enquanto os
consumidores legados existirem.

## 3. Schema `public.lead_timeline_entries`

Derivado do `TimelineEntry` atual (`{icon, c, t, d?, when}` em
`lib/data.ts`). O "tipo do evento" atual é a própria apresentação (ícone e
rótulo); um enum semântico exigiria re-mapear todos os flows e fica fora do
escopo.

| Coluna | Tipo | Null | Default | Constraint | Motivo |
|---|---|---|---|---|---|
| `id` | `uuid` | não | `gen_random_uuid()` | PK | identificador |
| `company_id` | `uuid` | não | — | garantido pela FK composta | isolamento |
| `lead_id` | `uuid` | não | — | FK composta `(company_id, lead_id)` para `leads(company_id, id)` ON DELETE CASCADE | timeline não vive sem o lead; lead de outra empresa é impossível |
| `actor_profile_id` | `uuid` | sim | — | FK composta `(company_id, actor_profile_id)` para `profiles(company_id, id)` ON DELETE SET NULL (`actor_profile_id`) | quem registrou, derivado de `auth.uid()`; sobrevive à remoção do usuário |
| `icon` | `text` | não | — | `check (btrim(icon) <> '')` | campo `icon` atual |
| `color` | `text` | não | — | `check (btrim(color) <> '')` | campo `c` atual |
| `label` | `text` | não | — | `check (btrim(label) <> '')` | campo `t` atual |
| `detail` | `text` | sim | `null` | — | campo `d` atual |
| `occurred_at` | `timestamptz` | não | `now()` | definido somente pelo servidor | substitui `when`; rótulos relativos são calculados na UI em render; texto relativo nunca é persistido |
| `created_at` | `timestamptz` | não | `now()` | — | auditoria |

Append-only: sem `updated_at`, sem UPDATE, sem DELETE. Nada de timeline
embutida na linha de `leads`. Timeline completa (paginação, edição, tipos
ricos) permanece fora do M1-E.

## 4. Foreign keys e índices

FKs de auditoria (leads e timeline), sintaxe compatível com PostgreSQL 17
(lista de colunas no SET NULL é suportada desde o PostgreSQL 15):

```sql
foreign key (company_id, created_by_profile_id)
  references public.profiles (company_id, id)
  on delete set null (created_by_profile_id)

foreign key (company_id, updated_by_profile_id)
  references public.profiles (company_id, id)
  on delete set null (updated_by_profile_id)

foreign key (company_id, actor_profile_id)
  references public.profiles (company_id, id)
  on delete set null (actor_profile_id)
```

Comportamento exigido e testado explicitamente na fase de Database: o profile
precisa pertencer à mesma empresa (alvo é a unique `profiles_company_id_uidx`
do m1c_01); ao remover o profile, somente a coluna de profile vai a null —
`company_id` nunca é tocado.

Demais FKs: `company_id` para `companies(id)` CASCADE;
`(company_id, stage_id)` para `pipeline_stages(company_id, id)` RESTRICT;
`(company_id, seller_id)` para `sellers(company_id, id)` RESTRICT;
`(company_id, lead_id)` para `leads(company_id, id)` CASCADE (timeline).

Índices: `(company_id) where archived_at is null` (listagem padrão) ·
`(company_id, stage_id)` (Kanban) · `(company_id, seller_id)` (RBAC e
filtros) · `(company_id, phone_digits)` (duplicidade, não-único) · timeline:
`(lead_id)` e `(company_id)`.

## 5. Concorrência — `version`

- `version integer not null default 1` é o único token de concorrência.
  `updated_at` permanece apenas para auditoria e não é usado como
  precondition.
- Trigger `BEFORE UPDATE` incrementa `NEW.version := OLD.version + 1` sempre
  que um UPDATE efetivo acontece. O frontend nunca escreve `version`.
- `update_lead`: `p_expected_version` é obrigatório; divergência gera o erro
  estável `stale_write`. Mensagem na UI: "Este lead foi alterado por outra
  pessoa. Atualize os dados e tente novamente.", seguida de refetch.
- `archive_lead` e `unarchive_lead`: `p_expected_version` obrigatório, com a
  ordem de idempotência definida no §6.6 — quando o estado desejado já está
  alcançado, não há UPDATE, não há incremento de `version` e não há
  `stale_write`, mesmo com versão antiga.
- `assign_lead_seller`: `p_expected_version` obrigatório; divergência gera
  `stale_write`. Atribuição de vendedor nunca é last-write-wins.
- `move_lead_to_stage`: `p_expected_version` opcional (`default null`) —
  quando informado e divergente, `stale_write`; quando null (drag do
  Kanban), aplica sem precondition.
- Movimentação de card: last-write-wins na primeira versão (o drag não envia
  versão; entre dois gestores movendo o mesmo card, o segundo vence, sem
  erro).
- `apply_lead_event`: sem precondition — é escrita de sistema disparada por
  eventos reais (ligação, visita, venda); last-write-wins é o comportamento
  correto.

### Atomicidade das RPCs

Nenhuma RPC faz SELECT de versão e depois UPDATE sem lock — verificação e
escrita são a mesma operação atômica:

- `update_lead` usa UPDATE condicional:
  `where id = p_lead_id and company_id = <company derivada> and
  version = p_expected_version returning *`. Zero linhas depois da
  autorização significa `stale_write`.
- `assign_lead_seller` usa exatamente o mesmo padrão condicional.
- `archive_lead` e `unarchive_lead` usam `select ... for update`, porque
  precisam verificar primeiro o estado idempotente: se o estado desejado já
  estiver alcançado, retornam sem UPDATE; se precisarem alterar, validam
  `p_expected_version` ainda sob o lock e só então executam o UPDATE.
- `move_lead_to_stage` é UPDATE atômico sem precondition quando usado pelo
  drag last-write-wins (e condicional quando `p_expected_version` vier
  preenchido).
- `apply_lead_event` atualiza urgency, labels, `stage_id` quando aplicável e
  `updated_by_profile_id` na mesma transação.
- Os triggers de `version` e `updated_at` executam dentro da mesma operação.

## 6. Contratos das RPCs (9 no total)

Padrões comuns a todas: `SECURITY DEFINER`; `set search_path = ''`; profile
derivado de `auth.uid()`; profile ativo obrigatório (inativo recebe
`forbidden`); `company_id` derivada do profile; nunca aceitam `company_id`,
role ou user_id enviados pelo cliente; `REVOKE ALL FROM public, anon` +
`GRANT EXECUTE TO authenticated`; erros com mensagens estáveis (`forbidden`,
`lead_not_found`, `stage_not_found`, `seller_not_found`, `stale_write`,
`lead_archived`, `initial_stage_missing`, `invalid_event`), mapeadas para
PT-BR na UI como no reorder do M1-D. Toda RPC que altera a linha define
`updated_by_profile_id` no servidor e retorna a linha completa.

### 6.1 `create_lead`

```sql
create_lead(
  p_name               text,
  p_phone              text,
  p_car                text,
  p_seller_id          text             default null,
  p_temperature        lead_temperature default null,
  p_payment_preference text             default null,
  p_source             text             default null
) returns public.leads
```

- Estágio inicial resolvido pelo `pipeline_stages.code = 'new'` da empresa;
  falha com `initial_stage_missing` se não existir exatamente um. O frontend
  não envia stage em nenhuma forma (§9).
- Seller: `p_seller_id` deve ser null ou o próprio; o efetivo é sempre o
  próprio `seller_id` (outro valor recebe `forbidden`). Admin e manager:
  null ou seller ativo da própria empresa (senão `seller_not_found`).
- Defaults de sistema definidos no servidor, compatíveis com o comportamento
  atual do FlowNovoCliente: `urgency = 'red'`,
  `last_activity_label = 'Sem contato ainda'`,
  `alert_label = 'Fazer primeiro contato'`. Não são parâmetros.
- `value_amount` não é parâmetro (§1); a coluna nasce null.
- `created_by_profile_id` e `updated_by_profile_id` = profile derivado.
  Retorna a linha criada (o UUID real alimenta a Task local e a tela de
  sucesso).

### 6.2 `update_lead`

```sql
update_lead(
  p_lead_id            uuid,
  p_expected_version   integer,
  p_name               text,
  p_phone              text,
  p_car                text,
  p_temperature        lead_temperature default null,
  p_payment_preference text             default null,
  p_source             text             default null
) returns public.leads
```

- Admin e manager editam leads ativos da empresa; seller edita somente lead
  ativo atribuído a ele; lead arquivado recebe `lead_archived`.
- `p_expected_version` obrigatório; divergência gera `stale_write`.
- Semântica de substituição integral dos campos editáveis: o frontend envia o
  estado completo do formulário (null limpa os opcionais) — determinístico
  sob a precondition de versão.
- Não aceita urgency, labels de health, stage, seller, archived nem
  `value_amount` — cada um tem RPC própria ou não é editável no M1-E.

**Correção pós-M1-F (E4-A0/E4-A1):** as assinaturas de `create_lead` e
`update_lead` acima são as **originais** (`20260719202010_m1e_03_lead_rpcs.sql`),
publicadas antes do M1-F. `profiles.role`/`profiles.seller_id` — que essas
duas RPCs liam diretamente — foram removidas em
`20260729200000_m1f_s8e2b_drop_profile_legacy_columns.sql`. Antes do drop,
`20260729110000_m1f_s8c2c1_lead_create_update_duplicate_commercial.sql` já
havia feito `DROP FUNCTION` + `CREATE FUNCTION` das duas (e de
`check_lead_phone_duplicate`, §6.9) com identidade nova — Postgres trata um
parâmetro a mais como assinatura diferente, não como `CREATE OR REPLACE` da
mesma função. As assinaturas **realmente vigentes** ganham um parâmetro
final `p_company_id uuid default null`:

```sql
create_lead(
  p_name               text,
  p_phone              text,
  p_car                text,
  p_seller_id          text             default null,
  p_temperature        lead_temperature default null,
  p_payment_preference text             default null,
  p_source             text             default null,
  p_company_id         uuid             default null
) returns public.leads

update_lead(
  p_lead_id            uuid,
  p_expected_version   integer,
  p_name               text,
  p_phone              text,
  p_car                text,
  p_temperature        lead_temperature default null,
  p_payment_preference text             default null,
  p_source             text             default null,
  p_company_id         uuid             default null
) returns public.leads
```

Toda a autorização passa agora por `resolve_lead_mutation_context(p_company_id,
p_read_only default false)` (`20260729100000_m1f_s8c2c1_lead_mutation_context_resolver.sql`,
nunca exposta a `authenticated` — só chamada internamente por RPCs
`SECURITY DEFINER`): deriva sempre de `auth.uid()` via
`current_membership_company_id()`/`current_membership_role()` (Manager/
Seller) ou `is_platform_super_admin()` (Super Admin), nunca mais lê
`profiles.role`/`profiles.seller_id`.

- **Manager/Seller**: `p_company_id` é **100% ignorado** pelo resolver — a
  empresa vem sempre da membership ativa (`current_membership_company_id()`),
  nunca do parâmetro. O frontend do M1-E (E4+) nunca deve enviar
  `p_company_id` nestas RPCs — o parâmetro existe só para a superfície
  Platform do Super Admin (M1-F), que sempre o envia explícito
  (`selectedCompanyId` capturado no formulário, nunca a empresa "atual" no
  momento da resposta).
- **Super Admin**: `p_company_id` é obrigatório na prática (`company_required`
  se null); `created_by_profile_id`/`updated_by_profile_id` ficam `NULL` para
  esse ator (Super Admin nunca tem `profiles.company_id`, e as FKs de
  auditoria de `leads` exigem mesma empresa) — autoria real preservada em
  `audit_log`, nunca perdida.
- O comportamento observável para Manager/Seller descrito no restante deste
  §6.1/§6.2 (stage inicial, seller autoatribuído, `stale_write`, campos não
  aceitos) permanece **integralmente válido** — só a identidade da função e o
  mecanismo interno de autorização mudaram, nunca o contrato visível ao
  caminho M1-E. `move_lead_to_stage`/`apply_lead_event`/`assign_lead_seller`
  (`20260729140000`) e `archive_lead`/`unarchive_lead`/
  `add_lead_timeline_entry` (`20260729150000`) também migraram para
  `resolve_lead_mutation_context` antes do drop das colunas legadas — nenhuma
  RPC de leads ficou lendo coluna inexistente.

### 6.3 `move_lead_to_stage`

**Atualizado no M1-F (migração `20260729140000`, confirmado na auditoria
E5-A0): assinatura real abaixo, não a original desta seção.**

```sql
move_lead_to_stage(
  p_lead_id          uuid,
  p_stage_id         uuid,
  p_expected_version integer default null,
  p_company_id       uuid default null
) returns public.leads
```

- Deriva contexto via `resolve_lead_mutation_context(p_company_id)` — mesmo
  resolver de `create_lead`/`update_lead`. Manager/Seller nunca enviam
  `p_company_id` (a empresa vem sempre da membership ativa; qualquer valor
  enviado é ignorado); Super Admin sempre envia `p_company_id` explícito
  (`company_required` se ausente) via a superfície Platform separada
  (`useMovePlatformLead`), nunca pelo caminho deste documento.
- Valida lead e stage na empresa resolvida; ownership (seller move somente
  lead próprio, `forbidden` caso contrário); lead não-arquivado
  (`lead_archived`); stage de outra empresa ou inexistente (`stage_not_found`).
  Atualiza `stage_id` e `updated_by_profile_id`.
- **E5-A1 (decisão humana, ver §15/E5):** o caminho Manager/Seller nunca
  envia `p_expected_version` — drag do Kanban é sempre last-write-wins, sem
  optimistic locking. Optimistic locking com `p_expected_version` continua
  disponível na RPC e é usado pela superfície Platform (Super Admin).

### 6.4 `apply_lead_event`

**Atualizado no M1-F (migração `20260729140000`, confirmado na auditoria
E5-A0): assinatura real abaixo, não a original desta seção.**

```sql
apply_lead_event(
  p_lead_id    uuid,
  p_event_type lead_event_type,
  p_company_id uuid default null
) returns public.leads
```

Mesmo resolver/omissão de `p_company_id` do §6.3 para Manager/Seller. A RPC
**nunca teve, e continua sem, parâmetro de versão** — é sempre
last-write-wins, sem exceção, em qualquer caminho (Manager/Seller ou
Platform). A RPC **nunca grava em `lead_timeline_entries`** (confirmado na
auditoria E5-A0) — timeline é responsabilidade exclusiva de
`add_lead_timeline_entry`, uma RPC separada, reservada ao E7 neste caminho
(ver limitação conhecida abaixo e §15/E5).

O cliente envia somente o lead e o tipo do evento. Urgency, labels e estágio
são derivados no servidor a partir do mapeamento fechado abaixo — o cliente
não envia urgency, não envia `last_activity_label`, não envia `alert_label` e
não envia stage_code. Sem jsonb livre, sem labels arbitrárias do navegador.

Enum `lead_event_type` — conjunto fechado com exatamente os eventos hoje
existentes em `calculateLeadHealth` (`lib/services.ts`). Os três eventos que
hoje carregam dados dinâmicos (`call.outcome`, `visit_scheduled.hasDate/
hasTime`, `deal_created.needsApproval`) são achatados em variantes do enum na
borda do frontend, por função pura — depois disso nenhum dado dinâmico cruza
para o servidor. Nenhum evento novo foi inventado.

| `lead_event_type` | urgency | stage code | `alert_label` | `last_activity_label` |
|---|---|---|---|---|
| `call_outcome_visit` | amber | `qualified` | Agendar visita | Aguardando agendamento |
| `call_outcome_proposal` | amber | `negotiation` | Montar proposta | Agora |
| `call_outcome_callback` | amber | — | Fazer follow-up | Agora |
| `call_outcome_no_answer` | amber | — | Tentar contato novamente | Agora |
| `visit_scheduled_complete` | green | `visit_scheduled` | Visita agendada | No prazo |
| `visit_scheduled_incomplete` | amber | `qualified` | Agendar visita | Aguardando agendamento |
| `visit_confirmed` | green | — | Visita confirmada | Cliente confirmou presença |
| `visit_canceled` | red | — | Visita cancelada — retomar contato | Cliente cancelou a visita |
| `visit_rescheduled` | amber | — | Visita remarcada — confirmar novo horário | Aguardando nova confirmação |
| `deal_created_needs_approval` | amber | `negotiation` | Acompanhar proposta | Proposta enviada |
| `deal_created_direct` | green | `negotiation` | Proposta enviada | Aguardando resposta do cliente |
| `deal_approved` | green | — | Proposta aprovada — fechar venda | Aprovada pelo gestor |
| `deal_rejected` | amber | — | Renegociar proposta | Recusada pelo gestor |
| `sale_registered` | green | `closing` | Venda registrada | Concluído |
| `sale_canceled` | amber | `negotiation` | Venda cancelada | Retomar negociação |
| `visit_result_done` | green | `negotiation` | Próximo passo comercial | Visita realizada |
| `visit_result_thinking` | amber | `negotiation` | Acompanhar cliente | Cliente ficou de pensar |
| `visit_result_no_interest` | amber | — | Sem interesse no momento | Registrar motivo de perda futuramente |

Regras da RPC:

- valida usuário ativo, company e ownership (seller somente no próprio lead);
- rejeita lead arquivado (`lead_archived`);
- evento fora do enum é rejeitado pelo próprio tipo (`invalid_event` cobre
  cast inválido);
- quando o evento mapeia para um stage code, resolve o code na própria
  empresa (`stage_not_found` se o code não existir) e atualiza health e
  estágio atomicamente, na mesma transação; quando não mapeia ("—"), atualiza
  somente urgency e labels;
- define `updated_by_profile_id`;
- retorna a linha atualizada.

Seam dos flows (estado alvo, ainda não conectado — ver E5-A1/B2 abaixo): a
função de health que os flows já chamam hoje no `LeadService` permanece com a
mesma assinatura pública. Com flag OFF ela aplica `calculateLeadHealth` na
store local, como sempre; com flag ON ela converte o `LeadHealthEvent` atual
para `lead_event_type` (achatamento puro descrito acima) e dispara a RPC via
hook `useApplyLeadEvent`. Os call sites dos flows não mudam de forma.

**Status real ao fim do E5-A1:** o achatamento puro existe e está testado
exaustivamente (`lib/leads/leadEventMapper.ts`,
`mapLeadHealthEventToRemoteEventType`, os 18 valores do enum), assim como o
hook `useApplyLeadEvent` (`lib/hooks/useApplyLeadEvent.ts`) e o hook de
movimento `useMoveLeadToStage` (`lib/hooks/useMoveLeadToStage.ts`) — mas
nenhum dos dois está conectado a `LeadService`/flows/Kanban ainda:
`canMoveStage`/`canApplyEvents` continuam `false` em
`resolveLeadMutationCapabilities`, `LeadService.updateHealth`/
`addToTimeline` continuam bloqueando sob flag ON (`_assertLocalLeadWriteAllowed`)
exatamente como antes, e `PipeCard`/`PipelineService.moveCard` não foram
tocados. A conexão real é escopo do E5-B1 (Kanban) e E5-B2 (flows de
evento).

`FlowCriarAcompanhamento` não tem, e não terá neste momento, nenhum
`LeadHealthEvent`/`lead_event_type` correspondente (decisão humana confirmada
na auditoria E5-A0/E5-A1): não foi criado enum novo, não foi criada RPC nova,
e o fluxo não foi forçado a mapear para nenhum dos 18 valores existentes —
permanece com o comportamento local atual (sem efeito de saúde) até o E7.

Limitação conhecida e aceita no M1-E: os eventos são fechados e os
resultados são derivados no servidor, mas visitas, propostas, negociações e
vendas ainda são entidades locais neste módulo — o banco ainda não consegue
comprovar que a entidade comercial correspondente ao evento existe. Um
usuário autorizado pode aplicar um evento permitido a um lead que ele pode
operar. Por isso esses eventos não são prova financeira nem auditoria
completa: não concedem comissão, não comprovam venda e não podem ser usados
isoladamente em indicadores financeiros. Quando os módulos relacionados
forem remotos, as mudanças de estado deverão ser originadas pelas próprias
RPCs transacionais desses módulos. Risco conhecido, temporário e registrado
no §17. O enum não deve ser modificado sem divergência real encontrada em
`calculateLeadHealth`.

### 6.5 `assign_lead_seller`

```sql
assign_lead_seller(
  p_lead_id          uuid,
  p_seller_id        text,
  p_expected_version integer
) returns public.leads
```

- Somente `is_manager_or_admin()`; `p_seller_id` null remove o vendedor, ou
  seller ativo da própria empresa; lead não-arquivado.
- `p_expected_version` é obrigatório; divergência gera `stale_write`.
  Atribuição de vendedor nunca é last-write-wins.

### 6.6 `archive_lead` e 6.7 `unarchive_lead`

```sql
archive_lead(p_lead_id uuid, p_expected_version integer)   returns public.leads
unarchive_lead(p_lead_id uuid, p_expected_version integer) returns public.leads
```

Somente admin e manager. Ordem de comportamento, documentada e testada
exatamente assim:

1. localizar e autorizar o lead;
2. se o estado desejado já estiver alcançado (arquivar lead já arquivado;
   restaurar lead ativo): retornar a linha atual, sem executar UPDATE, sem
   incrementar `version` e sem gerar `stale_write`, mesmo que
   `p_expected_version` esteja antigo;
3. se for necessário alterar o estado: exigir `p_expected_version` igual ao
   atual (divergência gera `stale_write`), atualizar `archived_at` e
   `updated_by_profile_id`, e o trigger incrementa `version`.

### 6.8 `add_lead_timeline_entry`

```sql
add_lead_timeline_entry(
  p_lead_id uuid,
  p_icon    text,
  p_label   text,
  p_color   text,
  p_detail  text default null
) returns public.lead_timeline_entries
```

- `occurred_at = now()` no servidor — o frontend não envia horário (não
  existe parâmetro).
- Actor derivado de `auth.uid()`; company derivada; profile ativo; ownership
  (seller somente em lead próprio); lead arquivado não aceita nova entrada;
  `btrim <> ''` para icon, label e color. Append-only; sem UPDATE e sem
  DELETE.
- Escrita por RPC (e não INSERT direto) porque o actor precisa ser derivado
  no servidor, a validação de escopo fica num único lugar e a tabela fica com
  o menor privilégio possível.

### 6.9 `check_lead_phone_duplicate`

```sql
check_lead_phone_duplicate(p_phone text)
returns table (
  status        lead_duplicate_status,  -- 'none' | 'accessible' | 'restricted'
  lead_id       uuid,                   -- somente em linhas 'accessible'
  lead_name     text,                   -- somente em linhas 'accessible'
  lead_archived boolean                 -- somente em linhas 'accessible'
)
```

Resolve a incompatibilidade entre a checagem de duplicidade e a RLS (o seller
só enxerga os próprios leads, mas o aviso precisa considerar a empresa
inteira):

- normaliza o telefone no servidor (mesma regra de `phone_digits`);
  normalização que não produza nenhum dígito gera o erro estável
  `invalid_phone`;
- não presume unicidade do telefone: pode retornar várias linhas;
- procura leads da empresa do profile inteira, inclusive arquivados;
- não aceita `company_id`;
- retorno tipado e não ambíguo:
  - nenhum duplicado: exatamente uma linha `('none', null, null, null)`;
  - uma linha `'accessible'` para cada duplicado que o chamador pode
    acessar, com `lead_id`, `lead_name` e `lead_archived` preenchidos;
  - duplicados que o chamador não pode acessar são representados por, no
    máximo, uma única linha `('restricted', null, null, null)` — sem ID,
    nome, vendedor, detalhe algum e sem revelar a quantidade de leads
    restritos;
  - se existirem acessíveis e restritos ao mesmo tempo, retorna as linhas
    acessíveis e uma única linha `'restricted'`;
- ordenação determinística das linhas acessíveis: `archived_at` null
  primeiro; depois `created_at` mais recente primeiro; `id` como desempate;
- admin e manager: todos os duplicados da empresa vêm como `'accessible'`
  (ativos e arquivados; arquivados com `lead_archived = true`, abertos pela
  visualização de arquivados);
- seller: recebe dados somente de leads próprios e ativos; lead alheio, lead
  sem vendedor definido, ou lead próprio porém arquivado, entra apenas na
  linha `'restricted'` (conta para o aviso, mas não pode ser aberto pelo
  seller);
- a RPC nunca bloqueia `create_lead`; "criar mesmo assim" permanece
  permitido.

Comportamento da interface:

- A. Um ou mais duplicados acessíveis: a interface lista os duplicados na
  ordem retornada e oferece abrir o cliente selecionado · criar mesmo assim
  · cancelar.
- B. Duplicado não acessível ao seller (linha `'restricted'` presente):
  mensagem "Já existe um cliente com este telefone, mas ele não está na sua
  carteira." · criar mesmo assim · cancelar — sem nome, ID, vendedor ou
  quantidade. Quando houver também linhas acessíveis, a lista do caso A é
  exibida junto do aviso restrito.

**Correção pós-M1-F (E4-A0) e extensão E4-A1:** a assinatura acima
(`check_lead_phone_duplicate(p_phone text)`) é a original. A mesma migration
`20260729110000_m1f_s8c2c1_lead_create_update_duplicate_commercial.sql`
citada em §6.1/§6.2 fez `DROP FUNCTION`/`CREATE FUNCTION` também desta RPC,
acrescentando `p_company_id uuid default null` (ignorado para Manager/Seller,
obrigatório na prática para Super Admin via `resolve_lead_mutation_context(...,
p_read_only=true)` — Super Admin pode checar duplicidade em qualquer status de
empresa, inclusive suspensa/cancelada, nunca podendo escrever). O E4-A1
(`20260730040000_m1e_e4a1_assignable_sellers_and_duplicate_exclusion.sql`)
estendeu a assinatura mais uma vez, de forma aditiva, para permitir excluir o
próprio Lead da busca durante a edição (sem isso, o formulário de edição
acusaria o próprio registro como duplicado do seu telefone atual):

```sql
check_lead_phone_duplicate(
  p_phone           text,
  p_company_id      uuid default null,
  p_exclude_lead_id uuid default null
)
returns table (
  status        lead_duplicate_status,
  lead_id       uuid,
  lead_name     text,
  lead_archived boolean
)
```

- `p_exclude_lead_id` (novo, opcional, default `null`): quando informado,
  remove **somente esse Lead** do conjunto pesquisado — a busca continua
  escopada pela empresa já resolvida (nunca pelo ID excluído: um ID de outra
  empresa não amplia acesso; um ID inexistente não altera o resultado nem
  gera erro); qualquer outro Lead com o mesmo telefone continua sendo
  retornado normalmente.
- Todo o restante do contrato (normalização, `accessible`/`restricted`/
  `none`, ordenação, `invalid_phone`, Manager/Seller/Super Admin, arquivados)
  permanece **integralmente preservado** — a exclusão nunca é usada como
  autoridade (não valida se o chamador pode acessar o Lead excluído, só o
  remove da busca).
- Uso pretendido (E4-B2, ainda não implementado): criação chama sem
  `p_exclude_lead_id`; edição chama com o `leadId` do Lead em edição, nunca
  com um filtro somente no frontend — filtrar só no cliente esconderia um
  outro Lead duplicado sempre que a RPC devolvesse primeiro a própria linha
  do registro em edição.

## 7. Grants finais

`public.leads`: SELECT para authenticated; sem INSERT; sem UPDATE; sem
DELETE.

`public.lead_timeline_entries`: SELECT para authenticated; sem INSERT; sem
UPDATE; sem DELETE.

Antes dos grants: `REVOKE ALL` de public, anon e authenticated nas duas
tabelas. Não existe nenhuma escrita direta proposta em nenhuma seção deste
documento.

O módulo expõe 9 RPCs públicas autenticadas: 8 RPCs de escrita
(`create_lead`, `update_lead`, `move_lead_to_stage`, `apply_lead_event`,
`assign_lead_seller`, `archive_lead`, `unarchive_lead`,
`add_lead_timeline_entry`) e 1 RPC de leitura controlada
(`check_lead_phone_duplicate`). Todas as escritas acontecem exclusivamente
pelas 8 RPCs de escrita. Cada uma das 9 com `REVOKE ALL FROM public, anon` e
`GRANT EXECUTE TO authenticated`.

## 8. Matriz RLS

RLS habilitada nas duas tabelas. Como as RPCs são SECURITY DEFINER, as
policies existem para leitura — e, junto da ausência de grants, formam a
segunda camada de negação para escrita.

`public.leads`:

- SELECT (`TO authenticated`):
  `company_id = current_profile_company_id() and (is_manager_or_admin() or
  (seller_id = current_profile_seller_id() and archived_at is null))`
  - admin e manager: todos os leads da própria empresa, inclusive arquivados
    (a listagem padrão filtra `archived_at is null` na query; a visualização
    de arquivados consulta o restante);
  - seller: somente `seller_id` igual ao próprio — não vê lead sem vendedor,
    não vê arquivado;
  - profile inativo: helpers do m1c_01 retornam NULL — zero linhas.
- INSERT: sem policy (criação só por `create_lead`).
- UPDATE: sem policy destinada ao frontend (toda alteração é por RPC).
- DELETE: sem policy.

`public.lead_timeline_entries`:

- SELECT (`TO authenticated`): `company_id = current_profile_company_id()
  and exists (select 1 from public.leads l where l.id = lead_id and
  l.company_id = company_id and (is_manager_or_admin() or
  (l.seller_id = current_profile_seller_id() and l.archived_at is null)))` —
  espelho exato da visibilidade do lead relacionado.
- INSERT, UPDATE e DELETE: sem policies (escrita só por
  `add_lead_timeline_entry`; append-only).

## 9. Estágio inicial

Toda criação usa `pipeline_stages.code = 'new'` da empresa do profile,
resolvido dentro da RPC. O frontend não envia `stage_id`, `stage_name` nem
`stage_code` na criação. A RPC falha com `initial_stage_missing` caso a
empresa não possua exatamente um estágio `code = 'new'`.

## 10. Snapshot remoto (`lib/leads/remoteSnapshot.ts`)

Espelho somente-leitura em memória, que serve os call sites síncronos
legados através do seam `LeadService`:

- particionado por `companyId` — snapshot de outra empresa nunca é servido;
- nunca persistido: memória volátil; nunca escreve em localStorage;
- nenhuma mutation: a UI jamais escreve nele; toda escrita remota é
  assíncrona pelos hooks (RPC, invalidation, nova query, novo snapshot) —
  fluxo em sentido único;
- recebe somente respostas remotas válidas (resultado adaptado de query
  bem-sucedida);
- mantém os dados anteriores durante refetch da mesma identidade (sem piscar
  para vazio);
- limpo imediatamente em logout, troca de usuário, troca de company e
  profile inativo — dirigido pela infraestrutura do M1-D (AuthCacheBoundary,
  useQueryCacheIdentity, resetQueryCache);
- a geração de cache (M1-D) é gravada junto do snapshot: resposta que chegue
  com geração antiga é descartada e nunca repovoa;
- erro remoto nunca provoca fallback local: o snapshot fica como estava (ou
  vazio) — dados locais jamais o substituem;
- loading inicial nunca exibe leads locais: com flag ON e snapshot ainda
  vazio, as telas mostram estados reais de loading/vazio;
- `LeadService.getAll()/getById()` leem o snapshot quando a flag está ON (e a
  store quando OFF); todas as escritas permanecem assíncronas via hooks — o
  service nunca escreve no caminho remoto.

Bridge sem segunda fonte de verdade: um componente `LeadsRemoteBridge`
(montado no App apenas com flag ON) subscreve o QueryCache filtrando a key de
leads da empresa atual; a cada resultado novo substitui o snapshot por
inteiro e dispara a mesma notificação que a store usa (função
`notifyStoreSubscribers()` exportada de `lib/store.ts` — única mudança na
store, sem efeito no caminho local). Os consumidores legados re-renderizam
pelo `useStore()` que já usam e releem o seam. O snapshot não é fonte de
verdade porque ninguém escreve nele além do bridge, todo o seu conteúdo é
derivado 1:1 do cache do TanStack (que deriva do banco), e apagá-lo a
qualquer momento apenas força os consumidores ao estado "carregando/vazio" —
nenhuma informação existe só nele.

## 11. Rollback e IDs — as duas direções

Direção A — ID local antigo inexistente no remoto (`leadId: 'l1'` com flag
ON): as telas exibem "cliente indisponível" (estado seguro novo); nunca
`getAll()[0]`; sem crash. A correção dos fallbacks
`?? LeadService.getAll()[0]` (ScreensBiz, ScreenPendencias, Flows3, e os
`payload.lead || getAll()[0]` de FlowLigar e FlowVerCliente) faz parte do
escopo (§15, fase de cache/erros/regressão).

Direção B — UUID remoto referenciado por módulo local após flag OFF: o UUID
continua armazenado em visits, deals, sales e tasks locais; o lead pode ficar
indisponível no caminho local — as mesmas telas exibem "cliente
indisponível"; nada é apagado nem reatribuído automaticamente; religar a flag
restaura os vínculos. O rollback preserva 100% dos dados (locais e remotos),
podendo ocultar vínculos até a flag ser religada.

Explícito: não existe importação automática nem mapeamento automático de IDs
entre local e remoto, em nenhuma direção. Importação, se um dia existir, será
ferramenta separada, explícita e auditável, fora do fluxo normal.

## 12. Feature flag

`NEXT_PUBLIC_FF_REMOTE_LEADS` + `isRemoteLeadsEnabled()` clonando o contrato
do M1-D: OFF por padrão; somente as strings exatas `'true'`/`'false'`;
override `localStorage['autocrm_ff_remote_leads']` reconhecido somente em
`NODE_ENV === 'development'`; produção ignora o override; flag OFF mantém o
caminho local intacto; ON usa exclusivamente o remoto; nenhum dual-write
permanente, nenhuma mistura silenciosa, nenhum fallback local quando o remoto
falhar; cache limpo em mudanças de identidade reutilizando a infraestrutura
do M1-D. Leads demo: o remoto começa vazio; seed de exemplo apenas no
`supabase/seed.sql` de desenvolvimento local; testes usam mocks e seeds
próprios.

## 13. Realtime

Fora do M1-E. Sincronização por TanStack Query: invalidation após cada
mutation, `refetchOnWindowFocus: true` (default do app), `staleTime` de 5
minutos e ações explícitas de retry. Dois usuários no mesmo Kanban convergem
no foco de janela ou na próxima ação. Realtime será módulo posterior
dedicado, quando a base estiver estável.

## 14. Arquitetura frontend

- Tipos: `LeadRow` e `LeadTimelineEntryRow` derivados de `Database` em
  `lib/supabase/types.ts` (após regenerar `database.types.ts`).
- Modelo de UI: `LeadModel` camelCase com `stageId`, `stageCode` (resolvido
  via cache de stages), `valueAmount: number | null`, mais os campos de
  compatibilidade (`stage` name, `last`, `alert`, `pay`, `origem`, `value`
  string) enquanto os consumidores legados existirem.
- Adapter: `lib/leads/adapter.ts` puro — `LeadRow[]` mais índice de stages
  produz `LeadModel[]`; stage_id órfão é config-error explícito, sem
  fallback.
- Query keys: `['company', companyId, 'leads']` (ativa) e
  `['company', companyId, 'leads', 'archived']` (visualização de
  arquivados). `companyId` é partição de cache, nunca prova de autorização —
  a query não envia `company_id`; RLS decide.
- Hooks: `useLeads` e `useArchivedLeads` (queries), `useLeadTimeline`
  (query), `useCreateLead`, `useUpdateLead`, `useMoveLeadToStage`,
  `useApplyLeadEvent`, `useAssignLeadSeller`, `useArchiveLead`,
  `useUnarchiveLead`, `useAddLeadTimelineEntry`,
  `useCheckLeadPhoneDuplicate`. `useAssignLeadSeller` envia
  `expectedVersion` obrigatório. Todos com identidade por parâmetro e guarda
  de geração (M1-D) antes de escrever no cache; mutations sem optimistic
  update (cache muda no onSuccess com a linha retornada, mais invalidation);
  pending desabilita a ação (drag do card, botões).
- Formulários: criação chama `create_lead` e usa o UUID retornado para a Task
  local e a tela de sucesso (substitui o `'l' + Date.now()`); antes de criar,
  `useCheckLeadPhoneDuplicate` alimenta o aviso com as opções do §6.9;
  edição envia o estado completo com `expected_version`; conflito exibe a
  mensagem padronizada e refaz o fetch.
- Kanban: cards agrupados por `stage_id`; drag chama `move_lead_to_stage`
  (last-write-wins); estados loading, erro, empty e config-error no padrão
  M1-D.
- Edição de etapa fora do Kanban: com flag ON, FlowEditarCliente não exibe
  mais o seletor de etapa (etapa muda só pelo Kanban e pelos eventos de
  health); com flag OFF, comportamento atual intacto.
- Health Engine: §6.4 — achatamento puro do evento no frontend, derivação
  integral no servidor.
- Ponte de compatibilidade: §10.

## 15. Divisão em submódulos

| Fase | Objetivo | Arquivos | Migrations | Testes | Dependências | Critério de aprovação | Rollback |
|---|---|---|---|---|---|---|---|
| **E0** — Design versionado | commitar `docs/M1-E-DESIGN.md` (este documento) antes de qualquer migration | `docs/M1-E-DESIGN.md` | — | — | aprovação desta Revisão 3 | commit do doc aprovado | revert do doc |
| **E1** — Database | enums (`lead_urgency`, `lead_temperature`, `lead_event_type`, `lead_duplicate_status`), tabelas, triggers (version, updated_at, auditoria), RLS, grants, 9 RPCs | `lib/supabase/database.types.ts` (regenerado), `lib/supabase/types.ts` | `m1e_01_lead_enums_leads.sql`, `m1e_02_lead_timeline.sql`, `m1e_03_lead_rpcs.sql` | §16-A completa | fase anterior | validação local 100% + auditoria pós-deploy 100% | não-destrutivo: objetos sem consumidores; flag nem existe |
| **E2** — Flag, tipos, adapter, keys | `isRemoteLeadsEnabled`, `LeadModel`, adapter com camada de compatibilidade, query keys | `lib/flags.ts`, `lib/leads/adapter.ts`, `lib/leads/queryKeys.ts` | — | unit (moldes dos testes de flags e adapter do M1-D) | fase anterior | testes verdes; flag OFF sem efeito algum | desligar flag |
| **E3** — Leitura remota e snapshot | `useLeads`, snapshot, bridge, seam no LeadService, telas Clientes/Andamento com estados | `lib/hooks/useLeads.ts`, `lib/leads/remoteSnapshot.ts`, `lib/store.ts` (notify exportado), `lib/services.ts`, `components/screens/ScreensOps.tsx`, `components/App.tsx` | — | integração de leitura: flag OFF intacto; ON com loading, erro, empty e dados; snapshot limpo por identidade; geração descarta resposta antiga | fase anterior | Kanban e lista renderizam do banco sob flag ON | desligar flag |
| **E4** — Create e Edit | criação e edição por RPC; checagem de duplicidade com três opções quando o duplicado é acessível e duas quando não é; conflito de versão | `useCreateLead`, `useUpdateLead`, `useCheckLeadPhoneDuplicate`, `components/flows/Flows2.tsx`, `FlowsShared.tsx` | — | integração: criação com UUID real na Task; `stale_write` com a mensagem exata; os dois fluxos de duplicidade | leitura remota pronta | criar e editar persistem pós-F5 | desligar flag |
| **E5** — Kanban e Health Engine | drag via `move_lead_to_stage` (last-write-wins, sem optimistic, pending bloqueia card); Health Engine baseado no evento fechado `lead_event_type` | `useMoveLeadToStage`, `useApplyLeadEvent`, `ScreensOps.tsx`, `lib/services.ts` | — | integração de move (molde do reorder M1-D) + health atômico (labels e estágio na mesma transação) | leitura remota pronta (paralelo à fase de Create/Edit) | drag persiste; flows de health funcionam sob flag ON | desligar flag |
| **E6** — Assign, Archive e permissões | atribuição, arquivamento, restauração e visualização de arquivados; capabilities | `lib/capabilities.ts`, `useAssignLeadSeller`, `useArchiveLead`, `useUnarchiveLead`, telas e flows | — | integração de permissões por role (molde do fluxo de permissões do M1-D): seller sem reatribuir, sem arquivar, sem ver arquivados | fases de Create/Edit e Kanban prontas | matriz de roles passa | desligar flag |
| **E7** — Cache, erros e regressão | fallbacks `[0]` viram "cliente indisponível"; ciclo de vida completo de identidade; timeline remota na Central; regressão total | `Flows3.tsx`, `ScreensBiz.tsx`, `FlowsShared.tsx`, `useLeadTimeline`, `useAddLeadTimelineEntry`, `tests/integration/*` | — | molde do ciclo de vida do M1-D; suíte completa 2×; módulos locais com UUID e com id órfão | fase anterior | suíte estável 2×, zero regressão flag OFF | desligar flag |
| **E8** — Rollout | builds com flag OFF, ON e padrão; validação manual multiusuário; push | — | — | §16-D | fase anterior | checklist manual 100% | flag OFF em produção; dados remotos preservados |

Nenhum commit gigante: cada fase é um commit (ou poucos), verde e reversível
por flag.

### 15.1 E3-A1 — Catálogo seguro de Sellers para Manager/Seller

Ao retomar o E3 (leitura remota conectada às telas), a revalidação do
contrato confirmou um bloqueio: `adaptLeadRows` (§14, `lib/leads/adapter.ts`)
exige `context.sellersById: Record<string, { id, name }>` para resolver o
nome exibido de cada Lead, e nenhuma fonte segura existente cobria
Manager/Seller —

- `public.sellers` não tem `SELECT` para `authenticated` (só RPCs narrow têm
  acesso, via `SECURITY DEFINER`);
- `list_platform_sellers_for_company(p_company_id)` (§6 do M1-F) é exclusiva
  de Super Admin/platform e recebe `company_id` explícito — nunca usada por
  Manager/Seller;
- `current_profile_seller_id_for_company(p_target_company_id)` resolve
  somente o próprio Seller do ator, nunca o catálogo da empresa;
- `SellerService` local é mock/local storage — dado local nunca pode
  alimentar uma tela em modo remoto (decisão do E3, item 12).

A decisão humana (2026-07-30) foi criar uma RPC nova e estreita —
`public.list_current_company_seller_labels()` — em vez de ampliar qualquer
uma das anteriores. E3-B1 (montagem da bridge, conexão das telas) permanece
pausado até esta subetapa ser concluída, validada e aprovada. Nenhuma
operação Supabase remota ocorreu nesta subetapa — somente local
(`supabase db reset`/`test db`).

**Contrato final:**

- Sem parâmetro: `p_company_id` não existe — a empresa é resolvida
  inteiramente no servidor a partir de `current_membership_company_id()` /
  `current_membership_role()` (mesmo par que `resolve_lead_mutation_context`
  usa para Manager/Seller), nunca enviada pelo cliente.
- Gate de status: `companies.status = 'ativa'` estrito — mesma regra da RLS
  `leads_select` e do branch Manager/Seller de `resolve_lead_mutation_context`
  (mais restrito que `can_access_company()`).
- **Manager** — catálogo completo (**picker/catálogo histórico**): todas as
  linhas de `public.sellers` da própria empresa, incluindo Sellers
  inativos/desvinculados (`is_active=false`, `membership_id=null`) — um Lead
  antigo pode referenciar um `seller_id` que não é mais operacional; filtrar
  por `is_active` recriaria o próprio bloqueio (`seller_not_found` no
  adapter). Nunca outra empresa. Ordenado por `name, id`.
- **Seller** — **não** recebe o catálogo da empresa: recebe somente a
  própria linha atual, via `current_profile_seller_id_for_company` (reaproveitado,
  nunca reimplementado).
- Retorno: exatamente `seller_id` (`public.sellers.id`) e `name`
  (`public.sellers.name`) — nunca email/telefone/endereço/`membership_id`/
  lifecycle/`platform_role`/credenciais. `sellers.name`/`first_name` são
  gravados uma única vez na criação da linha (`accept_invite`/
  `update_membership_role`) e nunca ressincronizados depois — por isso já são
  o "nome histórico" correto, sem necessidade de juntar com `profiles`.
- Grants: `REVOKE ALL` de `public`/`anon`/`authenticated`, depois
  `GRANT EXECUTE` só para `authenticated` — mesmo padrão de toda RPC narrow
  do projeto. Nenhum `SELECT` direto novo em `sellers`, `profiles` ou
  `company_memberships`.
- Frontend: `lib/leads/sellerLabelsRepository.ts`
  (`fetchCurrentCompanySellerLabels`, `toSellersByIdIndex`) e
  `lib/hooks/useCurrentCompanySellerLabels.ts` — arquivos novos e
  autocontidos, sem alterar `lib/leads/errors.ts` (contrato de 4 códigos do
  E3, congelado) nem `lib/leads/adapter.ts` (comportamento determinístico
  preservado). Query key inclui `companyId` **e** `userId`/identityKey:
  para Manager o resultado é o mesmo catálogo independente de quem pergunta,
  mas para Seller é uma linha própria — dois Sellers da mesma empresa nunca
  podem compartilhar uma entrada de cache.

### 15.2 E3-B1 — Conexão read-only de Leads remotos às telas de Manager e Seller

Conclui o E3: monta o ciclo de vida da bridge e conecta `ScreenClientesLegacy`/
`ScreenAndamentoLegacy` (`components/screens/ScreensOps.tsx`) à infraestrutura
já existente (E2/E3/E3-A1). Somente leitura — nenhuma migration, nenhuma
alteração de RPC/RLS/grants, nenhuma mutation remota. Nenhuma flag foi
ativada por esta etapa.

**Fluxo final de leitura:** `auth/membership` (`AuthService.getCurrentUser()`,
resolvido pelas próprias telas, nunca importado pelos hooks) → `stages`
(`usePipelineStages`) → `seller labels` (`useCurrentCompanySellerLabels`,
E3-A1) → `lead rows` (`useLeads`, que já adapta via `adaptLeadRows`) →
bridge/snapshot (`lib/leads/bridge.ts`/`remoteSnapshot.ts`, para consumidores
síncronos legados fora do escopo desta etapa) → telas.

**Flags efetivas** (`lib/leads/remoteLeadsMode.ts`,
`resolveRemoteLeadsFlagMode()`, puro, sem estado): `local`
(`NEXT_PUBLIC_FF_REMOTE_LEADS=false`, qualquer valor de `REMOTE_STAGES`) →
caminho local 100% inalterado; `remote_ready` (`REMOTE_LEADS=true` e
`REMOTE_STAGES=true`) → caminho remoto pode ser efetivo, dependendo ainda da
identidade do ator; `remote_misconfigured` (`REMOTE_LEADS=true` e
`REMOTE_STAGES=false`) → falha fechada explícita (mensagem "As etapas
remotas precisam estar disponíveis para carregar os Leads."), nenhuma
bridge, nenhum dado local, nenhum dado remoto — nunca cai silenciosamente no
caminho local só porque `usePipelineStages` (flag independente) resolveria
`source:'local'` nesse cenário.

**Composição central de leitura** (`lib/hooks/useRemoteLeadsScreenState.ts`):
único hook chamado por `ScreenClientesLegacy` e `ScreenAndamentoLegacy` —
nunca os três hooks (`usePipelineStages`/`useCurrentCompanySellerLabels`/
`useLeads`) chamados separadamente pelas telas, evitando dois caminhos de
adaptação. Resolve um `mode`: `local` | `remote_misconfigured` |
`remote_unavailable_identity` (ator sem membership operacional, não é
Manager/Seller, ou usuário global inativo — Super Admin nunca chega aqui,
pois o router de `ScreenClientes`/`ScreenAndamento` já desvia para as
superfícies Platform antes) | `remote_active`. `stagesReady` (passado a
`useLeads`) exige `pipeline.hasData` (catálogo real não-vazio); `sellersReady`
exige a busca de sellers resolvida (sucesso ou vazio, nunca durante loading
ou erro). Os três hooks internos são **sempre** chamados (Rules of Hooks);
cada um já teria `queryEnabled=false` sozinho se `REMOTE_LEADS` estivesse
desligada — o modo `local` apenas garante que o resultado nunca é consumido
pela tela.

**Ciclo da bridge** (`lib/hooks/useLeadsRemoteBridgeLifecycle.ts`): único
ponto de montagem de `startLeadsRemoteBridge` no projeto, chamado uma vez em
`components/App.tsx`, no mesmo nível de `useQueryCacheIdentity` (próximo ao
ciclo de identidade, nunca dentro de tela). Monta somente quando
`remote_ready` **e** ator é Manager/Seller **e** `activeMembership`/usuário
ativo **e** `companyId`/`identityKey` presentes — nunca para Super Admin (sem
`activeMembership`, por design). `useEffect` com `[queryClient, bridgeActive,
companyId, identityKey]`: qualquer mudança real (logout, troca de
usuário/empresa/membership, desativação da flag) desmonta a anterior antes de
montar a próxima — A→B→A é sempre tratada como 3 ciclos start/stop distintos,
nunca reaproveitados, e o guard de geração já existente em `bridge.ts`
protege contra resposta tardia cruzando identidade mesmo se cleanup e novo
start colidirem no mesmo tick. `notify` fica deliberadamente ausente
(parâmetro opcional): nenhum consumidor `useStore()` fora do escopo desta
etapa (Pendências, Flows abertos fora do card) foi conectado a re-render
reativo — `lib/store.ts` não foi alterado; consumidores dentro do escopo
(Clientes/Andamento) reagem via o próprio TanStack Query/React, não via
`useStore()`.

**Clientes** (`ScreenClientesLegacy`): local usa exclusivamente
`LeadService.getAll()`/`SellerService.getAll()`, corpo original preservado
byte a byte. Remoto usa exclusivamente `remote.leads`/`remote.sellerLabels`
— nunca `LeadService`/`SellerService`/`StoreAdapter`. Estados dedicados
(`data-testid`): `clientes-state-misconfigured`, `clientes-state-disabled`,
`clientes-state-stage-config-error`, `clientes-state-stage-empty`,
`clientes-skeleton` (stages OU leads), `clientes-state-lead-config-error`,
`clientes-state-error` (stages OU leads, sem cache), `clientes-state-empty`,
`clientes-stale-warning` (erro com cache), `clientes-grid` (sucesso). Botão
"Novo cliente" e o filtro de vendedor local (`SellerService`) desaparecem
fora do modo local; o filtro de vendedor remoto usa `sellerLabels.sellerLabels`
(seller_id/name reais). Cards remotos (`LeadCard readOnly`) escondem as ações
rápidas Ligar/Visita; abrir o card sempre passa `readOnly` no payload de
`ver-cliente`.

**Pipeline** (`ScreenAndamentoLegacy`): `pipeline` agora vem de
`remote.pipeline` (mesmo `usePipelineStages`, mesma identidade
`activeMembership.companyId`) — com `REMOTE_LEADS=false` o comportamento é
IDÊNTICO ao anterior a esta etapa, inclusive "Stages remotos + Leads locais
agrupados por `stage.name`" (M1-D, já aprovado, nunca alterado). Só quando
`remote.mode==='remote_active'` o Kanban troca para Leads remotos agrupados
por **`stage.id` real** (nunca `stage.name` — decisão 15); nesse modo,
`PipeCard` fica com `draggable=false`, `onDrop`/`onDragOver` nunca chamam
`PipelineService.moveCard`. Estados novos, avaliados só depois que Stages já
está saudável (`useRemoteLeadsScreenState` só habilita `useLeads` quando
`pipeline.hasData`): `kanban-state-misconfigured`,
`kanban-state-leads-config-error`, `kanban-state-leads-error`,
`kanban-leads-skeleton`, `kanban-leads-stale-warning` — todos distintos dos
testids já existentes de Stages (`kanban-state-error`,
`kanban-state-config-error`, `kanban-stale-warning`), preservando a
distinção de origem exigida (§12 desta subetapa).

**Adapter rígido, sem exceção:** `adaptLeadRows`/`adaptLeadRow`
(`lib/leads/adapter.ts`) permanecem intocados — `stage_id`/`seller_id` sem
correspondência no índice continuam gerando `LeadAdapterError`
(`stage_not_found`/`seller_not_found`), nunca "Etapa indisponível"
inventada, nunca placeholder de Seller, nunca UUID exibido, nunca lista
parcial. As telas traduzem esse erro em `clientes-state-lead-config-error`/
`kanban-state-leads-config-error` — mensagem genérica sanitizada, sem
`leadId`/código técnico no texto visível.

**Detalhe read-only:** `FlowVerCliente` (`components/flows/FlowsShared.tsx`)
recebe `payload.readOnly` — quando `true`, as 5 ações de mutation (Ligar,
Agendar visita, Nova proposta, Acompanhar, Editar dados) e o botão inline
"Ligar agora" somem inteiramente; o restante do detalhe (timeline, veículo,
cadastro) continua visível. `LeadCard`/`PipeCard` sempre passam `readOnly` no
payload de `ver-cliente`; `Flows2.tsx` não foi alterado (nenhum fluxo de
mutation é alcançável a partir do detalhe read-only, então nada ali precisa
mudar).

**Super Admin:** `PlatformCommercialClientsView`/`PipelineView`,
`CommercialCompanyContext`, `lib/commercial/*` — zero alteração, zero
importação de qualquer símbolo novo desta etapa (confirmado por grep). A
bridge nunca monta para Super Admin (sem `activeMembership`).

**Ausência de fallback:** nenhum estado remoto (misconfigured, unavailable
identity, loading, erro, config error) cai para dado local ou para lista
vazia silenciosa — cada um tem um `data-testid`/mensagem próprios.

E3 formalmente concluído após esta subetapa. E4 oficial (create/update/
duplicidade) segue desbloqueado, ainda não iniciado.

### 15.3 E4-A1 — Pré-requisitos de backend para Seller picker e duplicidade na edição

Auditoria prévia (M1-E E4-A0, somente leitura) confirmou dois bloqueios reais
antes de o E4 poder conectar formulários: (1) nenhuma RPC segura devolvia ao
Manager uma lista de Sellers **operacionais** da própria empresa para
escolher na criação de um Lead — `list_current_company_seller_labels` (§15.1)
é deliberadamente um catálogo histórico (inclui inativos/desvinculados, para
resolver nomes de Leads antigos) e `list_platform_sellers_for_company` (M1-F)
é exclusiva de Super Admin; (2) `check_lead_phone_duplicate` não tinha como
excluir o próprio Lead da busca durante a edição, o que empurraria a exclusão
para um filtro só no frontend — inseguro, porque esconderia qualquer *outro*
Lead duplicado sempre que a RPC devolvesse primeiro a linha do próprio
registro em edição.

**`public.list_current_company_assignable_sellers()`** — RPC nova, sem
parâmetros, mesmo par de helpers de `list_current_company_seller_labels`
(`current_membership_company_id()`/`current_membership_role()`, gate de
`companies.status = 'ativa'`):

- **Manager**: Sellers da empresa resolvida que sejam simultaneamente
  `sellers.is_active`, vinculados (`sellers.membership_id`) a uma
  `company_memberships` com `is_active`, `lifecycle_status = 'active'` e
  `role = 'seller'`, cujo `profiles.is_active` também seja verdadeiro — mesmo
  filtro operacional já usado por `list_platform_sellers_for_company`, nunca
  reinventado. Pode retornar conjunto vazio.
- **Seller**: no máximo a própria linha operacional, resolvida via
  `current_profile_seller_id_for_company()` (reaproveitado, nunca
  reimplementado) — nunca enumera colegas.
- **Super Admin**: nunca tem membership ativa — recebe o mesmo erro seguro
  (`insufficient_privilege` / `forbidden`) de `list_current_company_seller_labels`;
  não aceita `company_id` e não delega para `list_platform_sellers_for_company`
  (superfícies permanecem completamente separadas).
- Retorno estrito: `seller_id`, `name` — nenhuma outra PII. Ordenado por
  `name, seller_id`.
- Nenhum `SELECT` direto novo em `sellers`/`profiles`/`company_memberships`;
  mesmo padrão de grants (`REVOKE ALL` de public/anon/authenticated + `GRANT
  EXECUTE` só a authenticated).
- Diferença deliberada de `list_current_company_seller_labels`: aquela é o
  catálogo de **exibição** (nomeia Sellers de Leads existentes, inclusive
  históricos); esta é o catálogo de **atribuição** (só quem pode legitimamente
  receber um Lead novo). As duas convivem — nenhuma substitui a outra.

**`check_lead_phone_duplicate` — extensão aditiva**: ver §6.9 (correção
já registrada ali). `p_exclude_lead_id uuid default null` ao final da
assinatura; chamadas existentes (só `p_phone`, `p_phone`+`p_company_id`,
posicionais ou nomeadas) continuam válidas sem alteração.

**Frontend desta subetapa** (somente leitura/catálogo, nenhuma UI conectada):
`lib/leads/assignableSellersRepository.ts`
(`fetchCurrentCompanyAssignableSellers`) e
`lib/hooks/useCurrentCompanyAssignableSellers.ts` — mesmo molde de
`sellerLabelsRepository.ts`/`useCurrentCompanySellerLabels.ts` (§15.1): sem
parâmetro de empresa, identidade via `userId`/`companyId`/`membershipRole`
passados pelo chamador, query key com `companyId` **e** `identityKey` (mesma
razão do §15.1: para Seller o resultado é uma linha própria, nunca
compartilhável entre dois Sellers da mesma empresa). Nenhum hook de
`create`/`update`/duplicidade é criado nesta subetapa; `SellerPicker`,
`FlowNovoCliente`, `FlowEditarCliente`, `FlowVerCliente`,
`ScreenClientesLegacy`/`ScreenAndamentoLegacy`, capabilities granulares,
bridge e adapter permanecem intocados — conexão de UI é E4-B2.

E4-A1 conclui os pré-requisitos de backend. E4-B1 (repository/hooks de
`create`/`update`/duplicidade + capabilities granulares) segue desbloqueado,
ainda não iniciado.

### 15.4 E4-B1 — Data layer, hooks e capabilities de create/update/duplicidade (sem UI)

Implementa a infraestrutura TypeScript de mutation para Manager/Seller —
nenhum formulário, tela, `SellerPicker`, `StoreAdapter` ou componente
Platform é tocado nesta subetapa (isso é E4-B2). Molde de padrão: os hooks
Platform (`useCreatePlatformLead`/`useUpdatePlatformLead`/
`useCheckPlatformLeadPhoneDuplicate`, M1-F) — nunca importados ou chamados
por este caminho, que é estruturalmente separado (Manager/Seller nunca
enviam `p_company_id`; Super Admin nunca usa estes hooks).

**`lib/leads/remoteMutationRepository.ts`** (novo, arquivo próprio — não
altera `remoteRepository.ts`, que permanece só leitura de listagem):
`createRemoteLead`/`updateRemoteLead`/`checkRemoteLeadPhoneDuplicate`
chamam `create_lead`/`update_lead`/`check_lead_phone_duplicate` **sem**
`p_company_id` — para Manager/Seller o parâmetro é sempre ignorado pelo
resolver (§6.1/6.2/6.9), então nunca é enviado, reforçando que a autoridade
de empresa nunca é fingida pelo cliente neste caminho (diferente da
superfície Platform, que sempre envia `p_company_id` explícito). Seller
nunca envia `p_seller_id` (o backend sempre autoatribui); Manager pode
enviar um `sellerId` resolvido pelo catálogo de assignable sellers (E4-A1)
ou `null`. Erros do Supabase passam pelo mapper aditivo de
`lib/leads/errors.ts` (abaixo) — nunca lançados crus.

**`lib/leads/errors.ts` — extensão aditiva**: os 4 códigos do E3
(`remote_leads_fetch_failed`/`snapshot_unavailable`/`read_only`/
`invalid_context`) permanecem intocados. Novo grupo
`RemoteLeadsMutationErrorCode` (`remote_leads_mutation_forbidden`/
`company_required`/`company_not_found`/`company_read_only`/
`lead_not_found`/`lead_archived`/`seller_not_found`/
`initial_stage_missing`/`invalid_phone`/`stale_write`/`identity_changed`/
`generic_error`) mapeado a partir da mensagem estável que cada RPC lança
(`raise exception '<codigo>'`) por `mapRemoteLeadsMutationError` — mensagem
desconhecida vira sempre `generic_error` (nunca `stale_write`/`forbidden`
por adivinhação). `detail` preserva só `code`/`message`/`operation`, nunca
payload, telefone completo, SQL ou UUID interno.

**Capabilities** (`lib/leads/mutationCapabilities.ts`, novo — módulo
próprio, `lib/capabilities.ts` intocado): `LeadMutationCapabilities`
(`canCreate`/`canEditDetails`/`canApplyEvents`/`canMoveStage`/
`canAssignSeller`/`canArchive`) resolvida por
`resolveLeadMutationCapabilities({ flagMode, profileIsActive, actor })` —
função pura, nunca lê `.env`/flags diretamente (`flagMode` vem de
`resolveRemoteLeadsFlagMode()`, resolvido pelo chamador). Só
`flagMode==='remote_ready'` **e** profile ativo **e** `activeMembership`
presente (Manager, ou Seller com `sellerId` não-nulo) habilita
`canCreate`/`canEditDetails`; todo o resto (`canApplyEvents`/
`canMoveStage`/`canAssignSeller`/`canArchive`) permanece `false` no E4 —
são E5/E6. Super Admin, sem membership, suspenso/desligado (nunca populam
`activeMembership`, por invariante já estabelecido em `canManageInvites`),
Seller sem `sellerId` e modo `local`/`remote_misconfigured`: todas `false`.
Capabilities são controle de **interface**, nunca substituem a autorização
real do backend (RLS/RPC continuam a única autoridade).

**Hooks** (`lib/hooks/useCreateLead.ts`/`useUpdateLead.ts`/
`useCheckLeadPhoneDuplicate.ts`, novos): identidade por parâmetro (mesmo
padrão de `useLeads`/`useCurrentCompanySellerLabels` — `userId`/
`companyId`/`membershipRole`/`sellerId`/`userIsActive`, nunca importam
`AuthService`). `useCreateLead` recebe um input discriminado por
`actorRole` (`'manager' | 'seller'`) — a variante `seller` do tipo
**estruturalmente não tem campo `sellerId`**, então o componente futuro
nunca pode compilar um envio de vendedor arbitrário pelo Seller; o
repository nunca envia `p_seller_id` para esse caminho. `retry: 0` nas
três (nenhuma é idempotente ou tolera reenvio automático).
`useUpdateLead` exige `expectedVersion`; nenhuma escrita otimista no cache
(o valor exibido só muda depois da resposta real, via invalidation).
`useCheckLeadPhoneDuplicate` é imperativo (`useMutation`, nunca
`useQuery` — telefone é PII, nunca vira query key) e devolve
`{ sequence, phone, phoneDigits, rows }`; expõe `getLatestSequence()`
(função estável, não-reativa) para o E4-B2 comparar contra o `sequence` de
uma resposta recebida e descartar respostas de uma chamada mais antiga
(telefone já trocado no meio do debounce) — decisão sobre "criar mesmo
assim" continua inteiramente do E4-B2, o hook nunca decide isso.

**Proteção de identidade** (as três mutations): `getQueryCacheGeneration`/
`lib/query/cacheIdentity.ts` (M1-D) capturada no INÍCIO da `mutationFn`
(antes de chamar a RPC); depois da resposta, a geração é conferida de novo
— se mudou (logout, troca de empresa/membership, `resetQueryCache` correu
no meio), a mutation **lança** `remote_leads_mutation_identity_changed` em
vez de retornar sucesso (a escrita já pode ter concluído no servidor —
nenhuma promessa de cancelamento transacional, nunca um `AbortController`)
e o `onSuccess` correspondente nunca roda, então nenhuma invalidation
contamina a identidade nova. Quando a geração não mudou, `onSuccess`
invalida `leadQueryKeys.active(companyId CAPTURADO)` (create/update) e
`leadQueryKeys.detail(companyId, leadId)` (update, key já reservada por
`queryKeys.ts` desde o E2, sem consumidor ainda — invalidation antecipada e
inofensiva). Nunca um reset global do QueryClient, nunca escrita direta em
`remoteSnapshot`/`StoreAdapter` — o fluxo permanece
mutation→invalidate→refetch→bridge (já provado no E4-A0, §11).

Nenhuma UI conectada nesta subetapa; nenhuma migration; nenhuma alteração
em `database.types.ts`; nenhuma operação Supabase remota. E4-B2 (conectar
formulários, `SellerPicker` remoto, UX de duplicidade/`stale_write`,
capabilities aplicadas às telas) segue desbloqueado, ainda não iniciado.

### 15.5 E4-B2 — Conexão dos formulários remotos de create/update/duplicidade

Conecta a infraestrutura do E4-B1 aos formulários e telas de Manager/
Seller. Escopo estritamente de UI: nenhuma migration, nenhuma RPC, nenhum
`database.types.ts`, zero alteração nos hooks/repository/capabilities
aprovados no E4-B1 (salvo o ajuste de integração previsto ali). `move_lead_
to_stage`/`apply_lead_event`/atribuição de Seller/`archive`/`unarchive`/
timeline manual permanecem fora (E5/E6/E7) — o Kanban remoto continua sem
drag/drop/mudança de Stage.

**Contrato de fonte** (`lib/leads/leadFlowContext.ts`, novo, função pura):
`resolveLeadFlowContext(user: User | null)` combina
`resolveRemoteLeadsFlagMode()` (única chamada a esse helper na camada de
UI — nenhum componente lê `isRemoteLeadsEnabled()`/`isRemoteStagesEnabled()`
diretamente) com `resolveLeadMutationCapabilities()` (E4-B1) e devolve
`{ dataSource: 'local' | 'remote', capabilities, companyId, membershipRole,
sellerId, userId, userIsActive }`. `dataSource` é `'remote'` sempre que a
flag estiver ligada (inclusive `remote_misconfigured`/sem identidade
operacional) — nunca `'local'` nesses casos, para nunca existir fallback
local silencioso sob flag ON (mesmo invariante do E3); a UI distingue os
sub-estados pelas `capabilities` (todas `false` cobre exatamente os casos
sem permissão). Cada tela/flow que precisa da fonte chama esta função com
o `currentUser` que já resolve (mesmo padrão já usado por
`FlowNovoCliente`/`ScreenClientesLegacy`, que já leem `AuthService.
getCurrentUser()`), nunca recebendo-a por payload — `FlowLayer` roteia
flows por id sem contexto próprio, então centralizar na função pura
(chamada nos pontos que já têm `currentUser`) é o único jeito de nunca
espalhar a leitura da flag.

**`SellerPicker` — separação em dois componentes** (`FlowsShared.tsx`):
o componente antigo (`SellerService.getAll()` interno) foi renomeado para
`LocalSellerPicker`, sem nenhuma mudança de comportamento — `FlowNovoCliente`
(ramo local), `FlowRegistrarVenda` e `FlowNovaPendencia` (nunca tocados
pelo escopo do E4) passaram a importar `LocalSellerPicker` no lugar do nome
antigo. `SellerPicker` passou a ser presentacional: recebe `items`
(`{id,name}[]`), `value` (`sellerId | null`), `onChange`, `loading`,
`disabled`, `error`, `allowNone`/`noneLabel` — nunca importa
`SellerService`, nunca faz fallback para ele. Estados: loading (trigger
desabilitado, "Carregando vendedores…"), error (mensagem sanitizada, sem
dropdown), vazio (só a opção "Sem vendedor", quando `allowNone`), sucesso
(itens reais + "Sem vendedor" no topo). O formulário remoto de criação
(Manager) alimenta este componente com `useCurrentCompanyAssignableSellers`
(E4-A1) — nunca `list_current_company_seller_labels` (catálogo histórico,
E3-A1) e nunca `SellerService`.

**Capabilities na UI**: `FlowVerCliente` aceita `payload.capabilities`
(`LeadMutationCapabilities | null`) — quando presente, substitui
inteiramente a decisão antiga por `payload.readOnly` (que continua
funcionando exatamente como antes quando `capabilities` está ausente,
preservando 100% os callers que só passam `readOnly`, sem exigir migração
de nenhum caller existente). Com `capabilities`: "Editar dados" aparece só
com `canEditDetails`; Ligar/Agendar visita/Nova proposta/Acompanhar (e o
botão inline "Ligar agora") aparecem só com `canApplyEvents` (sempre
`false` no E4 remoto — pertencem ao E5). `LeadCard`/`PipeCard`
(`ScreensOps.tsx`) trocam a prop `readOnly` por `capabilities` (mesmo
padrão de fallback: `capabilities` ausente = comportamento local integral)
— ações rápidas de ligação gated por `canApplyEvents`; `PipeCard.draggable`
gated por `canMoveStage` (sempre `false` no E4, drag remoto continua
impossível). `ScreenClientesLegacy` ganha um botão "Novo Lead" no ramo
remoto, visível só quando `capabilities.canCreate`, ausente até aqui.

**Formulário de criação** (`FlowNovoCliente`, `Flows2.tsx`): resolve o
próprio `dataSource` via `resolveLeadFlowContext(AuthService.
getCurrentUser())` (mesmo padrão do resto do arquivo). `dataSource==='local'`
preserva o corpo original byte a byte (incluindo o `SellerPicker` renomeado
para `LocalSellerPicker`, sem mudança de comportamento — Manager continua
obrigado a escolher um Seller localmente, decisão de produto antiga e fora
de escopo desta etapa). `dataSource==='remote'` e `capabilities.canCreate`
falso: estado bloqueado (mensagem sanitizada, sem formulário). `dataSource
==='remote'` e `canCreate` verdadeiro: formulário remoto — Manager vê
`SellerPicker` alimentado por `useCurrentCompanyAssignableSellers` (com
opção "Sem vendedor", diferente do local); Seller não vê nenhum picker.
Campos: nome, telefone, veículo, temperatura, pagamento, origem — nunca
Stage/valor/notas/urgência/arquivado. `useCreateLead` é chamado com o input
discriminado por `actorRole` (nunca constrói `sellerId` no caminho Seller).
Ao salvar, o UUID real retornado alimenta a Task local e a tela de sucesso
(substitui o `'l'+Date.now()` do caminho local, que continua existindo só
para `dataSource==='local'`).

**Formulário de edição** (`FlowEditarCliente`): mesmo `resolveLeadFlowContext`
para decidir o ramo. Remoto: `expectedVersion` vem de `lead.version`
(`LeadModel`, sempre presente — rastreado da leitura remota, adaptador e
snapshot até `FlowVerCliente`/`LeadCard`/`PipeCard`, nenhuma perda
encontrada na auditoria desta etapa); Stage/Seller/valor/notas/urgência/
arquivamento ficam **ocultos** (não apenas desabilitados) — só nome,
telefone, veículo, temperatura, pagamento e origem aparecem. Local:
corpo original intacto, incluindo o seletor de Etapa.

**Duplicidade** (`lib/hooks/useLeadDuplicateGuard.ts`, novo — envolve
`useCheckLeadPhoneDuplicate` do E4-B1, nunca o substitui): debounce de
500 ms após telefone válido e estável; nova checagem obrigatória no
submit (nunca confia só no resultado do debounce); `excludeLeadId` na
edição; confirmação explícita vinculada a `phoneDigits` + `sequence` do
hook base — telefone mudou, fecha formulário ou identidade mudou: a
confirmação é descartada e uma nova checagem é exigida. `none`: segue
direto para a mutation. `accessible`/`restricted`/erro no check: mutation
NUNCA dispara sozinha — exige clique explícito em "Criar/Salvar mesmo
assim". Telefone nunca entra em query key, URL, `localStorage` ou log.

**`stale_write`/`identity_changed`**: mensagens sanitizadas fixas (nunca
UUID/SQL/payload); `stale_write` mantém o formulário aberto com os dados
digitados e nunca repete a mutation sozinho; `identity_changed` fecha/
reseta o formulário da identidade antiga (nenhum sucesso, nenhuma
invalidation, nenhum draft sobrevive à troca de empresa/logout/
suspensão/transferência).

Super Admin: zero import de `PlatformCommercialClientsView`/
`PlatformCommercialPipelineView`/modais Platform/repositories/hooks
Platform/`selectedCompanyId` nestes arquivos — confirmado por grep, como
em toda etapa anterior do M1-E. E4-C (regressão final, builds, fechamento
formal do E4) segue desbloqueado, ainda não iniciado.

### 15.6 E4-C — Regressão final e fechamento formal do E4

Auditoria de encerramento (somente leitura + testes finais, zero código de
aplicação alterado): confirma que a cadeia completa de create/update/
duplicidade do E4 — E4-A0 (auditoria)/E4-A1 (assignable sellers + exclusão
de duplicidade)/E4-B1 (data layer/hooks/capabilities)/E4-B2 (conexão de
UI) — está consistente, sem caminho híbrido, sem vazamento de capability
para E5/E6, e sem regressão no caminho local ou na superfície Platform.

**Esclarecimento de produto (fronteira arquitetural, registrado
formalmente aqui — nenhuma implementação nova)**: a autoatribuição do
Seller em `create_lead` (§6.1, decisão original do M1-E) significa
exclusivamente que o **cadastro continua manual** — Seller abre "Novo
Lead", digita os dados do cliente e o backend atribui esse Lead a si
mesmo; a regra existe para impedir que um Seller atribua o Lead a outro
colega, nunca para simular captação automática. Manager cadastra
manualmente e escolhe um Seller operacional ou deixa sem vendedor. Não
existe, nesta fase, nenhuma integração com Meta (Facebook/Instagram/
WhatsApp) ou qualquer outra fonte externa. Uma futura ingestão automática
de Leads (webhooks, APIs, tokens) será um **módulo inteiramente separado**,
que nunca deve fingir que um Lead capturado automaticamente foi criado por
um Seller humano — Leads de integração precisarão de autoria/origem
próprias (nunca o `actorRole='seller'` deste módulo), entrarão sem Seller
ou por uma regra explícita futura (fila/rodízio/campanha/plantão), e
exigirão decisão de produto e RPC próprias. Nenhum campo, `actor_kind`,
token ou API dessa integração futura é implementado aqui — só a fronteira
é registrada.

**Matriz final de capabilities do E4** (confirmada por
`tests/leads/mutationCapabilities.test.ts`, inalterada desde o E4-B1):

| Ator | canCreate | canEditDetails | canApplyEvents/canMoveStage/canAssignSeller/canArchive |
|---|---|---|---|
| Local (qualquer role, flag OFF) | comportamento antigo integral (não passa por `LeadMutationCapabilities`) | idem | idem |
| Manager operacional (remoto) | true | true | false |
| Seller operacional, `sellerId` válido (remoto) | true | true | false |
| Seller sem `sellerId` (remoto) | false | false | false |
| Super Admin | false (usa superfície Platform) | false | false |
| Sem membership/suspenso/offboarded/profile inativo | false | false | false |
| `remote_misconfigured` (flag ligada, Stages não) | false | false | false |

Capabilities continuam sendo controle de **interface** — a autoridade real
permanece em RLS/grants/RPC (`resolve_lead_mutation_context`), nunca
substituída por esta matriz.

**Mapas de dado confirmados por leitura direta do código**:

```
CREATE MANAGER:  tela → useCurrentCompanyAssignableSellers (E4-A1)
                      → useLeadDuplicateGuard (debounce/submit)
                      → useCreateLead (actorRole='manager', sellerId opcional)
                      → create_lead (sem p_company_id)
                      → invalidateQueries(leadQueryKeys.active) → bridge → tela

CREATE SELLER:   tela → useLeadDuplicateGuard
                      → useCreateLead (actorRole='seller', sem campo sellerId no tipo)
                      → create_lead (sem p_seller_id — backend autoatribui)
                      → invalidateQueries(leadQueryKeys.active) → bridge → tela

UPDATE:          tela → lead.version (LeadModel, presente desde a leitura remota)
                      → useLeadDuplicateGuard (excludeLeadId = lead.id)
                      → useUpdateLead (expectedVersion obrigatório)
                      → update_lead (sem p_company_id/p_seller_id/p_stage_id)
                      → invalidateQueries(active + detail) → bridge → tela
```

Nenhum caminho híbrido existe: `dataSource` (`lib/leads/leadFlowContext.ts`)
nunca mistura local e remoto na mesma renderização — cada flow é
inteiramente roteado para `*Local` (corpo original intocado) ou `*Remote`
(hooks do E4-A1/B1) antes de qualquer campo ser exibido.

**Lacunas de cobertura fechadas nesta etapa** (testes adicionados a
arquivos existentes, nenhum arquivo de aplicação tocado): proteção contra
duplo submit verificada no nível do *flow* (não só do hook — dois cliques
seguidos em "Criar cliente"/"Salvar alterações" nunca disparam duas
chamadas RPC); troca de identidade com formulário aberto verificada no
nível do *flow* (não só do hook — `rerender` com `AuthService.
getCurrentUser()` mudando fecha o formulário sem sucesso, sem invalidar a
empresa nova); dois códigos de erro adicionais de `update_lead`
(`lead_archived`, `forbidden`) confirmados com a mensagem sanitizada
correta. Demais garantias (§16 abaixo) já estavam cobertas pelos testes do
E4-A1/B1/B2 — nenhum teste duplicado foi criado.

**Validação final**: TSC 22 erros preexistentes (inalterado); TypeScript
148 arquivos/2190 testes (+6 sobre o E4-B2, só as lacunas acima); SQL
inalterado (51 arquivos/2601 testes, 49 migrations, zero migration nesta
etapa); 4 builds verdes (padrão, local, `remote_misconfigured`, remoto
efetivo). Super Admin confirmado intacto por grep (zero import cruzado)
e pela suíte Platform completa continuando verde.

**E4 formalmente encerrado.** `create_lead`/`update_lead`/
`check_lead_phone_duplicate` estão implementados, testados e conectados à
UI de Manager/Seller, com caminho local 100% preservado e superfície
Platform intocada. **E5 (Kanban remoto — `move_lead_to_stage` — e Health
Engine — `apply_lead_event`) fica oficialmente desbloqueado, ainda não
iniciado.** E6 (`assign_lead_seller`/`archive_lead`/`unarchive_lead`) e E7
(timeline remota, fallbacks `[0]`, regressão total, rollout) permanecem
igualmente fora deste módulo.

### 15.7 E5-A0 (auditoria) e E5-A1 (data layer) — concluídos

**E5-A0** (somente leitura) confirmou: `move_lead_to_stage`/
`apply_lead_event` prontos no backend (nenhum bloqueio de SQL); Manager
opera Leads da própria empresa, Seller somente os atribuídos a ele; stage
cross-company recusado (`stage_not_found`); movimento é last-write-wins;
`apply_lead_event` nunca teve `expectedVersion` e nunca cria timeline; os 13
`LeadHealthEvent` locais (18 valores expandidos) têm mapeamento remoto
exato, provado byte-a-byte contra `supabase/tests/04_m1e_move_event.sql`;
`FlowCriarAcompanhamento` não tem evento remoto equivalente.

**E5-A1** implementou exclusivamente a infraestrutura TypeScript, sem
conectar nenhuma UI:

- `lib/leads/remoteMutationRepository.ts`: `moveRemoteLeadToStage`
  (`p_lead_id`/`p_stage_id`, sem `p_expected_version`/`p_company_id`) e
  `applyRemoteLeadEvent` (`p_lead_id`/`p_event_type`, sem `p_company_id`).
- `lib/leads/errors.ts`: `stage_not_found` acrescentado de forma aditiva
  (`remote_leads_mutation_stage_not_found`); todos os códigos anteriores
  preservados; `stale_write` continua no contrato geral (usado por
  `update_lead`), mas não é esperado no caminho Manager/Seller de move/event
  (nenhum dos dois envia `p_expected_version` aqui).
- `lib/leads/leadEventMapper.ts`: `mapLeadHealthEventToRemoteEventType`,
  função pura exaustiva (18 valores, `never` em cada `default`
  inalcançável), reutiliza `LeadHealthEvent` real — sem `any`, sem cast, sem
  fallback. `FlowCriarAcompanhamento` não entra (não existe
  `LeadHealthEvent` para ele).
- `lib/leads/leadMutationOwnership.ts`: `canActorMutateLead`, helper puro de
  autorização visual por Lead (Manager: qualquer Lead da empresa; Seller:
  somente quando `leadSellerId === actorSellerId`) — preparado para o
  E5-B1/B2, não consumido por nenhuma tela nesta etapa.
- `lib/hooks/useMoveLeadToStage.ts` e `lib/hooks/useApplyLeadEvent.ts`:
  mesmo padrão de `useCreateLead`/`useUpdateLead` (identidade por parâmetro,
  `retry: 0`, proteção por geração de cache, `identity_changed` quando a
  identidade muda em voo, invalidação exclusiva de
  `leadQueryKeys.active(companyId capturado)`, nunca timeline, zero
  mutation otimista). `useMoveLeadToStage` também exporta `isNoOpStageMove`
  (helper puro, não consumido ainda — reservado ao E5-B1 para não chamar a
  RPC quando o card é solto na própria coluna).
- `canMoveStage`/`canApplyEvents` continuam `false` em
  `resolveLeadMutationCapabilities` — nenhuma mudança de comportamento
  visível. Ativação é gradual: `canMoveStage` no E5-B1 (Kanban conectado),
  `canApplyEvents` no E5-B2 (flows de evento conectados).
- Nenhum arquivo de UI (`ScreensOps.tsx`, `Flows2.tsx`, `FlowsShared.tsx`),
  SQL, `database.types.ts`, `PipelineService`, `StoreAdapter` ou superfície
  Platform foi tocado.

**E5-A1 formalmente encerrado. E5-B1 (conexão do Kanban) desbloqueado, ainda
não iniciado.**

## 16. Plano de testes

### A. Banco local (fase de Database)

- Migrations do zero; seed idempotente; checks de string vazia (name, phone,
  car; icon, label e color na timeline).
- `phone_digits`: gerado corretamente; telefone sem nenhum dígito falha pelo
  check `phone_digits <> ''`.
- FKs compostas: stage, seller e profile de outra empresa falham; FKs de
  auditoria: DELETE de profile anula só a coluna de profile e `company_id`
  fica intacto (leads e timeline).
- RLS de SELECT: matriz role × empresa × dono × arquivado × inativo (seller
  não vê lead sem vendedor nem arquivado; admin e manager veem arquivados;
  profile inativo lê zero linhas).
- Cliente tentando escrever diretamente na tabela: INSERT, UPDATE e DELETE em
  `leads` e `lead_timeline_entries` falham por ausência de grant e de policy.
- `create_lead`: seller auto-atribuído; seller com `p_seller_id` alheio
  recebe `forbidden`; manager com seller válido, null, inválido e inativo;
  empresa sem `code='new'` recebe `initial_stage_missing`; defaults de
  sistema (red, "Sem contato ainda", "Fazer primeiro contato");
  `value_amount` permanece null.
- `update_lead`: sem a versão correta recebe `stale_write`; seller em lead
  alheio recebe `forbidden`; lead arquivado recebe `lead_archived`;
  substituição integral dos campos.
- `updated_by_profile_id` derivado corretamente em toda RPC de escrita.
- `move_lead_to_stage`: lead alheio, outra empresa, arquivado, versão
  divergente quando informada.
- `apply_lead_event`: um teste por evento do enum (18), verificando urgency,
  labels e estágio derivados conforme a tabela do §6.4; health e estágio
  atualizados atomicamente; evento inválido rejeitado; seller aplicando
  evento em lead alheio recebe `forbidden`; lead arquivado rejeitado; code
  ausente na empresa recebe `stage_not_found`.
- `assign_lead_seller`: por seller recebe `forbidden`; sem a versão correta
  recebe `stale_write` (`p_expected_version` obrigatório).
- `archive_lead` e `unarchive_lead`: idempotentes na ordem exata do §6.6 —
  estado já alcançado retorna a linha sem UPDATE, sem bump de `version` e sem
  `stale_write` mesmo com versão antiga; mudança real exige versão atual e
  incrementa `version`.
- Timeline: não aceita horário enviado pelo cliente (parâmetro não existe;
  `occurred_at` é do servidor); rejeita lead arquivado; append-only.
- `check_lead_phone_duplicate`: telefone sem dígito algum recebe
  `invalid_phone`; none, accessible e restricted por role; múltiplos
  acessíveis retornam na ordenação determinística do §6.9; vários restritos
  colapsam numa única linha `'restricted'` sem revelar quantidade; caso
  misto retorna acessíveis mais uma linha restrita; seller nunca recebe
  dados de lead alheio, de lead sem vendedor definido ou de arquivado;
  arquivado conta para o aviso.
- Todas as 9 RPCs indisponíveis para anon (EXECUTE revogado).
- Profile inativo bloqueado em todas as 9 RPCs.
- Trigger de `version` incrementa a cada UPDATE efetivo.
- Concorrência com duas conexões simultâneas para `update_lead`,
  `assign_lead_seller` e `archive_lead`: a segunda operação recebe
  `stale_write` (ou o retorno idempotente, no caso de archive com estado já
  alcançado), conforme a subseção de atomicidade do §5.

### B. Frontend unitário

- Flag (contrato completo, override só em development); adapter (renames,
  camada de compatibilidade, stage órfão, valor null vira "—"); query keys
  por empresa; snapshot (partição, limpeza por identidade, geração, refetch
  mantém dados, erro não faz fallback); hooks de mutation (payloads exatos
  das RPCs, `expected_version`, achatamento do evento de health, mapeamento
  de erros para as mensagens PT-BR).

### C. Integração

- Tela, hook e Supabase mockado: Kanban com cards por `stage_id`; drag
  last-write-wins sem optimistic update (pending bloqueia, erro mantém a
  ordem, identidade obsoleta descarta resposta); formulários (criação gera
  UUID que alimenta a Task; conflito de versão exibe a mensagem exata;
  duplicidade com os dois fluxos do §6.9); health disparado por flow atualiza
  o card; filtros por vendedor; refetch e invalidations; logout, troca de
  empresa e profile inativo limpam snapshot e cache; erros de RLS e RPC
  amigáveis; regressão completa do caminho local (flag OFF); módulos locais
  dependentes (visita criada com leadId UUID; id órfão exibe "cliente
  indisponível", nunca `getAll()[0]`, sem crash).

### D. Manual

- Dois usuários em dois navegadores: criação, edição e movimento persistem
  pós-F5 e convergem no outro navegador (focus ou ação); dados da empresa A
  nunca aparecem na empresa B; seller não vê, edita, move nem arquiva o
  proibido; conflito de edição simultânea mostra a mensagem; arquivado some
  do seller e aparece na visualização de admin e manager; ordem e integridade
  dos dados confirmadas após F5; flag OFF mantém o app atual intacto.

## 17. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Perda de leads locais | flag OFF preserva tudo; o caminho remoto nunca toca o localStorage |
| IDs incompatíveis, cards ou vínculos órfãos | §11: "cliente indisponível" nas duas direções; nada apagado nem reatribuído |
| Stage inválido ou de outra empresa | FK composta + resolução na RPC + RLS (três camadas) |
| Seller de outra empresa | FK composta + validação na RPC |
| `company_id` inválido | derivado do profile no servidor; FK para companies |
| Cache ou snapshot cruzado entre contas | partição por company + reset de identidade M1-D + geração de cache |
| Race conditions e sobrescrita silenciosa | `version` obrigatório em update e archive; `stale_write` com mensagem padronizada; last-write-wins consciente e documentado no drag e no health |
| Escrita direta do cliente na tabela | zero grants de escrita + zero policies de escrita (negado duas vezes), testado |
| Labels ou urgency forjados pelo cliente | impossível: derivados do evento fechado no servidor (§6.4) |
| Filtros e contagens divergentes | seam único (`LeadService`): uma fonte por flag, nunca duas |
| Módulos locais quebrando | testes de regressão flag OFF em todas as fases; adaptações mínimas mapeadas |
| Duplicidade | aviso com as opções do §6.9 via `phone_digits`; merge é escopo futuro |
| Vazamento de dados na checagem de duplicidade | RPC devolve no máximo uma linha `restricted`, sem dados e sem quantidade, quando o chamador não pode acessar o lead |
| Eventos de health sem entidade comercial remota | limitação documentada no §6.4: sem valor de prova financeira ou auditoria; módulos remotos futuros originarão os eventos por RPCs transacionais próprias |
| Performance | índices do §4; uma query por Kanban; paginação futura |
| Erro durante rollout | commits pequenos atrás da flag; migrations aditivas; rollback = desligar a flag |

Plano de rollback: desligar `NEXT_PUBLIC_FF_REMOTE_LEADS` (o caminho local
permanece 100% funcional em qualquer fase); dados remotos nunca são apagados;
migrations nunca são revertidas destrutivamente; commits pequenos permitem
revert cirúrgico.

**Riscos residuais registrados no fechamento do E4 (E4-C, sem esconder):**

- E5 (`move_lead_to_stage` remoto, Kanban com drag, Health Engine/
  `apply_lead_event`) ainda não implementado — Kanban remoto permanece
  somente leitura.
- E6 (`assign_lead_seller`, `archive_lead`/`unarchive_lead`, visualização
  de arquivados) ainda não implementado.
- E7 (timeline remota manual, correção dos fallbacks locais `getAll()[0]`,
  regressão total 2×, rollout) ainda não implementado.
- As migrations do M1-E (incluindo E4-A1) permanecem **somente locais** —
  nenhuma foi aplicada no Supabase remoto nesta fase.
- `NEXT_PUBLIC_FF_REMOTE_LEADS`/`NEXT_PUBLIC_FF_REMOTE_STAGES` permanecem
  **desligadas** em qualquer ambiente publicado; toda a validação do E4 foi
  feita localmente, com as flags ligadas apenas durante builds/testes.
- Nenhum smoke test manual em produção/staging remoto foi executado —
  pendente para quando o rollout (E8) for planejado.
- A futura integração com Meta/outras fontes de captação automática de
  Leads (§15.6) permanece inteiramente fora de escopo — nenhum desenho de
  API, webhook, token ou `actor_kind` de integração existe ainda.
- Mutations já autorizadas pelo backend não possuem rollback client-side
  por mudança de UI/identidade (`identity_changed` impede o efeito visual
  incorreto, mas nunca desfaz a escrita já concluída no servidor) — decisão
  de design já registrada no E4-B1, não um bug pendente.
- Baseline do TSC: 22 erros preexistentes, sempre nos mesmos 4 arquivos,
  não introduzidos nem agravados por nenhuma etapa do M1-E.

## 18. Critérios objetivos de "M1-E pronto"

1. Design versionado (`docs/M1-E-DESIGN.md`) antes da primeira migration.
2. Migrations aplicadas local e remotamente com auditoria pós-deploy 100%
   (incluindo FKs de auditoria, guard de `code='new'`, idempotência de
   archive e negação de escrita direta).
3. Suíte completa passando duas vezes consecutivas com o mesmo total.
4. Build verde com flag OFF, flag ON e padrão.
5. Validação manual em dois navegadores e dois usuários 100% (§16-D).
6. Isolamento entre duas empresas confirmado (banco e UI).
7. Nenhum dual-write (verificado por teste).
8. Nenhum fallback local sob flag ON (verificado por teste).
9. Flag OFF por padrão em produção após o merge.
10. Nenhum warning de act(), nenhum teste pulado, nenhum snapshot ou sleep.
11. Ordem e integridade dos dados confirmadas após F5 na validação manual.

## 19. Arquivos previstos

Novos:

- `docs/M1-E-DESIGN.md`
- `supabase/migrations/m1e_01_lead_enums_leads.sql`
- `supabase/migrations/m1e_02_lead_timeline.sql`
- `supabase/migrations/m1e_03_lead_rpcs.sql`
- `lib/leads/adapter.ts`, `lib/leads/queryKeys.ts`,
  `lib/leads/remoteSnapshot.ts`
- `lib/hooks/useLeads.ts`, `useCreateLead.ts`, `useUpdateLead.ts`,
  `useMoveLeadToStage.ts`, `useApplyLeadEvent.ts`, `useAssignLeadSeller.ts`,
  `useArchiveLead.ts`, `useUnarchiveLead.ts`, `useLeadTimeline.ts`,
  `useAddLeadTimelineEntry.ts`, `useCheckLeadPhoneDuplicate.ts`
- Testes unitários espelhando cada módulo novo
- `tests/integration/remoteLeadsRead.test.tsx`,
  `remoteLeadsCreateEdit.test.tsx`, `remoteLeadsKanbanMove.test.tsx`,
  `remoteLeadsHealth.test.tsx`, `remoteLeadsDuplicate.test.tsx`,
  `remoteLeadsPermissions.test.tsx`, `remoteLeadsLifecycle.test.tsx`

Alterados:

- `lib/flags.ts` · `lib/supabase/database.types.ts` (regenerado) ·
  `lib/supabase/types.ts`
- `lib/store.ts` (somente o export do notify) · `lib/services.ts` (seam de
  leitura e roteamento do health) · `lib/capabilities.ts`
- `components/screens/ScreensOps.tsx` · `components/screens/ScreensBiz.tsx`
- `components/flows/Flows2.tsx` · `components/flows/FlowsShared.tsx` ·
  `components/flows/Flows3.tsx`
- `components/App.tsx` (bridge) · `.env.local.example`

Intocados: caminho local da store (exceto o export do notify), migrations
M1-B e M1-C, infraestrutura de cache do M1-D.

**E3-A1** (§15.1) — novos, fora da lista original acima:

- `supabase/migrations/20260730030000_m1e_e3a1_current_company_seller_labels.sql`
- `lib/leads/sellerLabelsRepository.ts`,
  `lib/hooks/useCurrentCompanySellerLabels.ts`
- `supabase/tests/51_m1e_e3a1_current_company_seller_labels.sql`
- `tests/leads/sellerLabelsRepository.test.ts`,
  `tests/hooks/useCurrentCompanySellerLabels.test.tsx`

Alterado: `lib/supabase/database.types.ts` (regenerado, só a nova função).

**E3-B1** (§15.2) — novos:

- `lib/leads/remoteLeadsMode.ts`
- `lib/hooks/useRemoteLeadsScreenState.ts`,
  `lib/hooks/useLeadsRemoteBridgeLifecycle.ts`
- `tests/leads/remoteLeadsMode.test.ts`,
  `tests/hooks/useRemoteLeadsScreenState.test.tsx`,
  `tests/hooks/useLeadsRemoteBridgeLifecycle.test.tsx`,
  `tests/screens/ScreenClientes.test.tsx`, `tests/flows/FlowVerCliente.test.tsx`

Alterados: `components/App.tsx` (montagem da bridge) ·
`components/screens/ScreensOps.tsx` (`ScreenClientesLegacy`,
`ScreenAndamentoLegacy`, `LeadCard`, `PipeCard`) ·
`components/flows/FlowsShared.tsx` (`FlowVerCliente`, prop `readOnly`) ·
`tests/screens/ScreenAndamento.test.tsx` (mock atualizado para
`useRemoteLeadsScreenState` + cobertura nova de `remote_active`)

Intocados: SQL/migrations/`database.types.ts`/RPC/RLS/grants,
`lib/leads/adapter.ts`, `lib/leads/errors.ts`, `lib/leads/bridge.ts`,
`lib/leads/remoteSnapshot.ts`, `lib/leads/remoteRepository.ts`,
`lib/leads/sellerLabelsRepository.ts`, `lib/store.ts`, `StoreAdapter`,
`SellerService`, `lib/flags.ts`, componentes Platform/`lib/commercial/*`,
`components/flows/Flows2.tsx`, `.env*`.

**E4-A1** (§15.3) — novos:

- `supabase/migrations/20260730040000_m1e_e4a1_assignable_sellers_and_duplicate_exclusion.sql`
- `lib/leads/assignableSellersRepository.ts`,
  `lib/hooks/useCurrentCompanyAssignableSellers.ts`
- `supabase/tests/52_m1e_e4a1_assignable_sellers_and_duplicate_exclusion.sql`
- `tests/leads/assignableSellersRepository.test.ts`,
  `tests/hooks/useCurrentCompanyAssignableSellers.test.tsx`

Alterado: `lib/supabase/database.types.ts` (regenerado — nova RPC
`list_current_company_assignable_sellers` + `p_exclude_lead_id` opcional em
`check_lead_phone_duplicate`; `create_lead`/`update_lead` intactas).

Intocados nesta subetapa: `create_lead`, `update_lead`,
`list_current_company_seller_labels`, `list_platform_sellers_for_company`,
`lib/leads/sellerLabelsRepository.ts`, `lib/leads/errors.ts`,
`lib/leads/adapter.ts`, `lib/leads/bridge.ts`, `lib/capabilities.ts`,
`SellerPicker`, `FlowNovoCliente`, `FlowEditarCliente`, `FlowVerCliente`,
`ScreenClientesLegacy`, `ScreenAndamentoLegacy`, `components/App.tsx`,
`StoreAdapter`, `SellerService`, superfícies Platform/`lib/commercial/*`,
`.env*`. Nenhuma flag ativada; nenhuma operação Supabase remota.

**E4-B1** (§15.4) — novos:

- `lib/leads/remoteMutationRepository.ts`
- `lib/leads/mutationCapabilities.ts`
- `lib/hooks/useCreateLead.ts`, `useUpdateLead.ts`,
  `useCheckLeadPhoneDuplicate.ts`
- `tests/leads/remoteMutationRepository.test.ts`,
  `tests/leads/mutationCapabilities.test.ts`
- `tests/hooks/useCreateLead.test.tsx`, `useUpdateLead.test.tsx`,
  `useCheckLeadPhoneDuplicate.test.tsx`

Alterado (aditivo): `lib/leads/errors.ts` (novo grupo
`RemoteLeadsMutationErrorCode` + `mapRemoteLeadsMutationError`; os 4
códigos do E3 permanecem intocados).

Intocados nesta subetapa: SQL/migrations/`database.types.ts`/RPC/RLS/
grants (nenhuma alteração de backend), `lib/leads/adapter.ts`,
`lib/leads/remoteRepository.ts`, `lib/leads/bridge.ts`,
`lib/leads/remoteSnapshot.ts`, `lib/leads/assignableSellersRepository.ts`,
`lib/leads/sellerLabelsRepository.ts`, `lib/leads/queryKeys.ts`,
`lib/capabilities.ts`, `lib/store.ts`, `StoreAdapter`, `SellerService`,
`SellerPicker`, `FlowNovoCliente`, `FlowEditarCliente`, `FlowVerCliente`,
`ScreenClientesLegacy`, `ScreenAndamentoLegacy`, `components/App.tsx`,
superfícies Platform/`lib/commercial/*`, `lib/flags.ts`, `.env*`. Nenhuma
UI conectada; nenhuma flag ativada; nenhuma operação Supabase remota.

**E4-B2** (§15.5) — novos:

- `lib/leads/leadFlowContext.ts`
- `lib/hooks/useLeadDuplicateGuard.ts`
- `tests/leads/leadFlowContext.test.ts`,
  `tests/hooks/useLeadDuplicateGuard.test.tsx`

Alterados:

- `components/flows/FlowsShared.tsx` (`SellerPicker` original renomeado
  para `LocalSellerPicker`; novo `SellerPicker` presentacional;
  `FlowVerCliente` aceita `payload.capabilities`, preservando
  `payload.readOnly` para callers existentes)
- `components/flows/Flows2.tsx` (`FlowNovoCliente`/`FlowEditarCliente`
  ganham o ramo remoto; `FlowRegistrarVenda`/`FlowNovaPendencia` só trocam
  o nome do import para `LocalSellerPicker`, zero mudança de comportamento)
- `components/screens/ScreensOps.tsx` (`LeadCard`/`PipeCard` trocam
  `readOnly` por `capabilities`; `ScreenClientesLegacy` ganha o botão
  "Novo Lead" remoto)
- `tests/flows/FlowVerCliente.test.tsx`, `tests/screens/ScreenClientes.test.tsx`
  (cobertura nova, sem remover nenhum teste existente)

Intocados: SQL/migrations/`database.types.ts`/RPC/RLS/grants,
`lib/leads/remoteMutationRepository.ts`, `useCreateLead.ts`/
`useUpdateLead.ts`/`useCheckLeadPhoneDuplicate.ts` (E4-B1, só consumidos),
`lib/leads/mutationCapabilities.ts`, `lib/leads/errors.ts`,
`lib/leads/adapter.ts`, `lib/leads/bridge.ts`, `StoreAdapter`,
`SellerService`, componentes Platform/`lib/commercial/*`,
`components/App.tsx`, `lib/flags.ts`, `.env*`. Nenhuma flag ativada;
nenhuma operação Supabase remota.

**E4-C** (§15.6) — auditoria de encerramento, somente documentação e
testes finais:

- `tests/flows/FlowNovoCliente.test.tsx` (+3 testes: duplo submit, troca de
  identidade com formulário aberto)
- `tests/flows/FlowEditarCliente.test.tsx` (+3 testes: dois códigos de erro
  adicionais de `update_lead`, duplo submit, troca de identidade)

Nenhum arquivo de aplicação alterado nesta subetapa (zero código de
produção no diff) — somente `docs/M1-E-DESIGN.md` e os dois arquivos de
teste acima. **E4 formalmente encerrado. E5 desbloqueado, ainda não
iniciado.**
