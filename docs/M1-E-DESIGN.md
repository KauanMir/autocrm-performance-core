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

### 6.3 `move_lead_to_stage`

```sql
move_lead_to_stage(
  p_lead_id          uuid,
  p_stage_id         uuid,
  p_expected_version integer default null
) returns public.leads
```

- Valida lead e stage na empresa do profile; ownership (seller move somente
  lead próprio); lead não-arquivado. Atualiza `stage_id` e
  `updated_by_profile_id`.

### 6.4 `apply_lead_event`

```sql
apply_lead_event(
  p_lead_id    uuid,
  p_event_type lead_event_type
) returns public.leads
```

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

Seam dos flows: a função de health que os flows já chamam hoje no
`LeadService` permanece com a mesma assinatura pública. Com flag OFF ela
aplica `calculateLeadHealth` na store local, como sempre; com flag ON ela
converte o `LeadHealthEvent` atual para `lead_event_type` (achatamento puro
descrito acima) e dispara a RPC via hook `useApplyLeadEvent`. Os call sites
dos flows não mudam de forma.

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
