# M1-C — Design Técnico (Revisão 4 — arquitetura aprovada)

> Status: **ARQUITETURA APROVADA — implementação ainda não iniciada.**
> Nenhuma migration, nenhum código de aplicação e nenhum objeto de banco foi criado a partir deste documento.
> Substitui integralmente as Revisões 1–3. A Revisão 4 incorpora as decisões
> finais: `visits.scheduled_at`, auditoria de cancelamento em `sales`,
> RPC `get_seller_ranking()`, ocultação de growth/move na UI, timeline com
> `occurred_at` puro e auditoria final de SECURITY DEFINER (§6.3).

Escopo do M1-C: migrar os dados comerciais (leads, visitas, propostas, vendas,
tarefas, timeline, estágios do pipeline) do `localStorage` (`lib/store.ts`) para
o Supabase/Postgres, mantendo o Auth/profiles/sellers já entregues no M1-B.

Pré-requisito de plataforma: **PostgreSQL ≥ 15** (necessário para
`ON DELETE SET NULL (coluna)` em FKs compostas — seção 4.1). Projetos Supabase
novos atendem; confirmar com `select version();` antes da primeira migration.

---

## 1. Decisões arquiteturais herdadas (já aprovadas)

1. **IDs** — `sellers.id` continua `text` (`s1`..`s12`, compatível com M1-B).
   Todas as entidades novas (`leads`, `visits`, `deals`, `sales`, `tasks`,
   `lead_timeline_entries`, `pipeline_stages`) usam `uuid` gerado pelo
   Postgres. No TypeScript, uuid é `string`.
2. **Estatísticas de vendedor** — nunca em colunas mutáveis; sempre derivadas
   por view/agregação (`seller_performance`, seção 8). `sellers` guarda apenas
   identidade, vínculo, equipe e status.
3. **Dados locais** — começamos limpo no Supabase; nada do localStorage é
   importado. Seed controlado para testes (seção 14).
4. **Estratégia** — migração por fases com chaveamento de fonte de dados por
   módulo durante o desenvolvimento; **sem dual-write**; fallback local
   removido após o cutover completo (seção 13).
5. **Obrigatórios já acordados** — `sale_create`/`sale_cancel` como RPCs
   transacionais; constraints únicas parciais contra venda ativa duplicada;
   `deal_approve`/`deal_reject` como RPCs com auditoria via `auth.uid()`;
   `seller_performance` como view derivada; timeline como tabela filha;
   `company_id` obrigatório em todas as tabelas comerciais; audit fields
   referenciam `profiles.id`; contrato canônico enum Postgres ↔ constantes TS;
   `resetAll()` não existe como ação destrutiva em produção.

---

## 2. Enums e contrato canônico de status

```sql
create type lead_urgency     as enum ('red', 'amber', 'green');
create type lead_temperature as enum ('hot', 'warm', 'cold');
create type visit_status     as enum ('pendente','agendada','confirmada','remarcada',
                                      'cancelada','sem_resultado','realizada','sem_interesse');
create type deal_status      as enum ('aberta','aprovacao','aprovada','recusada','vendida');
create type sale_status      as enum ('aguardando','entregue','cancelada');
create type task_priority    as enum ('alta','media','baixa');
create type task_state       as enum ('atrasada','hoje','proxima','concluida');
```

Contrato: os labels dos enums são **idênticos byte-a-byte** aos valores de
`VISIT_STATUS`, `DEAL_STATUS`, `SALE_STATUS` e `TASK_STATE` em `lib/data.ts`,
que continua sendo a fonte da verdade textual do lado TS. Antes de cada
cutover, um teste de CI compara `pg_enum` com os objetos TS e falha se houver
qualquer divergência (histórico: divergência de status já causou crash em
Visitas e sumiço silencioso de Propostas — ver comentário em `lib/data.ts:222`).

**Estágio de pipeline não é enum** — é tabela (`pipeline_stages`) com **código
estável** (`code`) separado do rótulo exibido (`name`). Ver seção 4.2.

---

## 3. Integridade multiempresa — princípio geral

FK simples (`lead_id references leads(id)`) não impede que um `lead_id` de uma
empresa apareça numa linha com `company_id` de outra. A defesa estrutural é:

- toda tabela **referenciada** ganha `unique (company_id, id)`;
- toda tabela **filha** referencia o par `(company_id, X_id) →
  parent(company_id, id)` (FK composta).

Assim o próprio banco recusa a mistura de empresas — sem depender de RLS nem
de disciplina da aplicação. Como as colunas referenciadoras são em geral
nullable e as FKs compostas usam `MATCH SIMPLE` (padrão do Postgres), uma
linha com `seller_id is null` simplesmente não aciona a checagem — comportamento
desejado.

Tabelas-alvo de FK composta (recebem `unique (company_id, id)`):
`sellers`, `profiles`, `pipeline_stages`, `leads`, `deals`.

Tabelas folha (ninguém as referencia; não precisam da unique composta):
`visits`, `sales`, `tasks`, `lead_timeline_entries`.

```sql
alter table sellers  add constraint sellers_company_id_uidx  unique (company_id, id);
alter table profiles add constraint profiles_company_id_uidx unique (company_id, id);
```

---

## 4. Schema completo por tabela

### 4.1 Política de `ON DELETE` — decisão individual por FK

Regra sintática (motivo da Revisão 3): numa FK composta, `on delete set null`
sem lista de colunas tentaria anular **as duas** colunas — inclusive
`company_id`, que é `not null` — e o DELETE do pai falharia sempre. Portanto:

- `SET NULL` sempre com lista explícita de coluna: `on delete set null (lead_id)`
  — anula só a coluna de relacionamento, preserva `company_id` (exige PG ≥ 15);
- para `sellers`, **`RESTRICT`** em todas as FKs: vendedor nunca é apagado
  fisicamente enquanto houver dado comercial apontando para ele — o caminho
  correto é soft delete via `sellers.is_active = false` (a coluna já existe
  desde o M1-B);
- para `profiles` (auditoria), `SET NULL (coluna)`: apagar um usuário do Auth
  (cascateia o profile) não pode travar nem apagar o histórico comercial — o
  registro sobrevive com o campo de auditoria anulado;
- `companies` mantém `on delete cascade` simples via a FK direta de
  `company_id` (apagar a empresa derruba tudo dela — operação de operador,
  nunca exposta ao app).

Tabela de decisões (cada FK documentada individualmente):

| Tabela filha | FK composta | Alvo | ON DELETE | Justificativa |
|---|---|---|---|---|
| `leads` | `(company_id, seller_id)` | `sellers` | `restrict` | vendedor sai via `is_active=false`; nunca apagar com carteira ativa |
| `leads` | `(company_id, stage_id)` | `pipeline_stages` | `restrict` | estágio com leads não pode ser removido; UI deve mover os leads antes |
| `leads` | `(company_id, created_by_user_id)` | `profiles` | `set null (created_by_user_id)` | histórico sobrevive à remoção do usuário |
| `lead_timeline_entries` | `(company_id, lead_id)` | `leads` | `cascade` | timeline não tem vida própria sem o lead |
| `visits` | `(company_id, lead_id)` | `leads` | `set null (lead_id)` | visita vira registro órfão legível, não é apagada junto |
| `visits` | `(company_id, seller_id)` | `sellers` | `restrict` | idem regra de sellers |
| `deals` | `(company_id, lead_id)` | `leads` | `set null (lead_id)` | proposta sobrevive como histórico |
| `deals` | `(company_id, seller_id)` | `sellers` | `restrict` | idem regra de sellers |
| `deals` | `(company_id, created_by_user_id)` | `profiles` | `set null (created_by_user_id)` | auditoria não trava remoção de usuário |
| `deals` | `(company_id, approved_by_user_id)` | `profiles` | `set null (approved_by_user_id)` | idem |
| `deals` | `(company_id, rejected_by_user_id)` | `profiles` | `set null (rejected_by_user_id)` | idem |
| `sales` | `(company_id, lead_id)` | `leads` | `set null (lead_id)` | venda é registro contábil; nunca some com o lead |
| `sales` | `(company_id, deal_id)` | `deals` | `set null (deal_id)` | idem |
| `sales` | `(company_id, seller_id)` | `sellers` | `restrict` | idem regra de sellers |
| `sales` | `(company_id, created_by_user_id)` | `profiles` | `set null (created_by_user_id)` | idem auditoria |
| `sales` | `(company_id, canceled_by_user_id)` | `profiles` | `set null (canceled_by_user_id)` | idem auditoria |
| `tasks` | `(company_id, lead_id)` | `leads` | `set null (lead_id)` | tarefa continua listável sem o lead |
| `tasks` | `(company_id, assigned_to)` | `sellers` | `restrict` | idem regra de sellers |

Nota sobre `RESTRICT` + soft delete: com essas FKs, um `delete from sellers`
com dado comercial falha por design. A operação de "remover vendedor" no
produto é `update sellers set is_active = false` — e as telas/queries filtram
`is_active` onde fizer sentido. Nenhuma RPC de delete de seller é criada no M1-C.

### 4.2 `pipeline_stages`

Novidade da Revisão 3: coluna **`code`** — identificador estável usado por
regra de negócio (Lead Health Engine, `calculateLeadHealth` em
`lib/services.ts`), enquanto `name` é apenas rótulo editável de exibição.
O motivo: hoje a Health Engine devolve nomes exibidos (`stage: 'Qualificado'`);
se um gestor renomear a coluna do Kanban, a regra quebraria silenciosamente.
Com `code`, renomear `name` nunca afeta regra.

```sql
create table pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  code         text not null,          -- contrato de regra de negócio, estável
  name         text not null,          -- rótulo exibido, editável
  sort_order   int  not null,
  is_terminal  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (company_id, code),
  unique (company_id, name),
  unique (company_id, sort_order) deferrable initially deferred,
  unique (company_id, id)
);
create index pipeline_stages_company_id_idx on pipeline_stages(company_id);
```

Codes iniciais (contrato com a Lead Health Engine — o TS ganha um objeto
`STAGE_CODE` espelhando exatamente estes valores):

| `code` | `name` inicial | `sort_order` | `is_terminal` |
|---|---|---|---|
| `new` | Novo | 0 | false |
| `qualified` | Qualificado | 1 | false |
| `visit_scheduled` | Visita agendada | 2 | false |
| `negotiation` | Em negociação | 3 | false |
| `closing` | Fechamento | 4 | true |

A Health Engine passa a devolver `stageCode: 'qualified'` (etc.) em vez do
nome exibido; o repositório resolve `code → stage_id` da empresa atual antes
do update. O nome exibido nunca mais participa de regra.

### 4.3 `leads`

```sql
create table leads (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  name               text not null,
  phone              text not null,
  car                text not null,
  stage_id           uuid not null,
  seller_id          text,
  urgency            lead_urgency not null default 'green',
  temperature        lead_temperature,
  last               text,
  alert              text,
  pay                text,
  value_amount       numeric(12,2) check (value_amount >= 0),
  origem             text,
  created_by_user_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (company_id, id),
  foreign key (company_id, seller_id)
    references sellers(company_id, id) on delete restrict,
  foreign key (company_id, stage_id)
    references pipeline_stages(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references profiles(company_id, id) on delete set null (created_by_user_id)
);
create index leads_company_id_idx      on leads(company_id);
create index leads_seller_id_idx       on leads(seller_id);
create index leads_stage_id_idx        on leads(stage_id);
create index leads_company_seller_idx  on leads(company_id, seller_id);
```

### 4.4 `lead_timeline_entries`

```sql
create table lead_timeline_entries (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null,
  company_id   uuid not null,
  icon         text not null,
  color        text not null,   -- campo 'c' atual
  label        text not null,   -- campo 't' atual
  detail       text,            -- campo 'd' atual
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  -- Garante estruturalmente que company_id da timeline É o do lead:
  -- não é convenção nem trigger — é FK composta; INSERT divergente falha.
  foreign key (company_id, lead_id)
    references leads(company_id, id) on delete cascade
);
create index lead_timeline_lead_id_idx    on lead_timeline_entries(lead_id);
create index lead_timeline_company_id_idx on lead_timeline_entries(company_id);
```

Sem `updated_at` — tabela é somente-inserção (mesmo comportamento de hoje).

**Decisão final (Revisão 4):** o banco armazena **somente** `occurred_at`.
Rótulos relativos ("Agora", "Ontem", "Há 3 dias") são calculados no frontend
em tempo de render — texto relativo **nunca** é persistido (o modelo antigo
gravava `when: 'Agora'` congelado, que mentiria para sempre).

### 4.5 `visits`

```sql
create table visits (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  lead_id      uuid,
  seller_id    text,
  client       text not null,
  car          text,
  status       visit_status not null default 'pendente',
  scheduled_at timestamptz,  -- ÚNICA fonte de verdade de data/horário (UTC)
  vehicles     text[],
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  foreign key (company_id, lead_id)
    references leads(company_id, id) on delete set null (lead_id),
  foreign key (company_id, seller_id)
    references sellers(company_id, id) on delete restrict
);
create index visits_company_id_idx   on visits(company_id);
create index visits_lead_id_idx      on visits(lead_id);
create index visits_seller_id_idx    on visits(seller_id);
create index visits_status_idx       on visits(status);
create index visits_scheduled_at_idx on visits(scheduled_at);
```

**Decisão final (Revisão 4):** as antigas colunas `day text` / `time text`
(strings de exibição `'hoje'`, `'09:00'`) **não existem** no schema —
`scheduled_at timestamptz` é a única fonte de verdade de data e horário.
`scheduled_at` é nullable porque uma visita pode nascer da intenção "agendar"
antes de dia+hora estarem definidos (o fluxo atual só considera a visita
"agendada de verdade" com ambos — ver `visit_scheduled` na Health Engine).

**Timezone — contrato de conversão:**

- `companies.timezone text not null default 'America/Sao_Paulo'` **já existe
  desde o M1-B** (`supabase/migrations/20260708120000...sql:28`) — nenhuma
  alteração de schema em `companies` é necessária; a decisão apenas o promove
  a contrato oficial de fuso da empresa.
- **Escrita:** a UI captura data/hora como horário local *da empresa* (não do
  dispositivo), converte para UTC usando `companies.timezone` e grava o
  `timestamptz`.
- **Leitura:** o render converte UTC → fuso da empresa
  (`Intl.DateTimeFormat(..., { timeZone: company.timezone })`) para exibir
  horário e para derivar agrupamentos "hoje / amanhã / passado" — sempre
  calculados no fuso da empresa, nunca no do dispositivo, para que dois
  usuários em fusos diferentes vejam a mesma agenda.
- O banco nunca armazena horário local nem rótulos ("hoje"): só UTC.

### 4.6 `deals`

```sql
create table deals (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  lead_id              uuid,
  seller_id            text,
  client               text not null,
  car                  text,
  value_amount         numeric(12,2) not null check (value_amount >= 0),
  status               deal_status not null default 'aberta',
  discount_note        text,     -- campo 'disc' atual
  last                 text,
  payment              text,
  down_payment         text,
  installments         text,
  note                 text,
  created_by_user_id   uuid,
  approved_by_user_id  uuid,
  approved_at          timestamptz,
  rejected_by_user_id  uuid,
  rejected_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (company_id, id),
  foreign key (company_id, lead_id)
    references leads(company_id, id) on delete set null (lead_id),
  foreign key (company_id, seller_id)
    references sellers(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references profiles(company_id, id) on delete set null (created_by_user_id),
  foreign key (company_id, approved_by_user_id)
    references profiles(company_id, id) on delete set null (approved_by_user_id),
  foreign key (company_id, rejected_by_user_id)
    references profiles(company_id, id) on delete set null (rejected_by_user_id)
);
create index deals_company_id_idx on deals(company_id);
create index deals_lead_id_idx    on deals(lead_id);
create index deals_seller_id_idx  on deals(seller_id);
create index deals_status_idx     on deals(status);
```

As FKs compostas de auditoria para `profiles(company_id, id)` são a resposta a
"como auditores serão validados dentro da mesma empresa": um profile de outra
empresa é rejeitado pelo próprio banco, não por convenção.

### 4.7 `sales`

```sql
create table sales (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  lead_id             uuid,
  deal_id             uuid,
  seller_id           text,
  client              text not null,
  car                 text,
  value_amount        numeric(12,2) not null check (value_amount > 0),
  sold_at             date not null default current_date,
  status              sale_status not null default 'aguardando',
  payment             text,
  created_by_user_id  uuid,
  canceled_by_user_id uuid,          -- auditoria de cancelamento (Revisão 4)
  canceled_at         timestamptz,   -- idem; ambos preenchidos SÓ por sale_cancel()
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  foreign key (company_id, lead_id)
    references leads(company_id, id) on delete set null (lead_id),
  foreign key (company_id, deal_id)
    references deals(company_id, id) on delete set null (deal_id),
  foreign key (company_id, seller_id)
    references sellers(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id)
    references profiles(company_id, id) on delete set null (created_by_user_id),
  foreign key (company_id, canceled_by_user_id)
    references profiles(company_id, id) on delete set null (canceled_by_user_id)
);
create index sales_company_id_idx on sales(company_id);
create index sales_seller_id_idx  on sales(seller_id);
create index sales_status_idx     on sales(status);

-- Proteção final contra venda ativa duplicada (concorrência incluída):
create unique index sales_active_lead_uidx
  on sales(lead_id) where status <> 'cancelada' and lead_id is not null;
create unique index sales_active_deal_uidx
  on sales(deal_id) where status <> 'cancelada' and deal_id is not null;
```

Nota: o `check (value_amount > 0)` (estrito, não `>= 0`) implementa a
validação de valor pedida na Revisão 3 no nível de constraint, além da
checagem dentro da RPC.

### 4.8 `tasks`

```sql
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  lead_id      uuid,
  assigned_to  text,
  title        text not null,
  due_at       timestamptz,
  when_label   text,             -- texto de exibição atual ('Hoje, 14:00')
  prio         task_priority not null default 'media',
  state        task_state not null default 'proxima',
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  foreign key (company_id, lead_id)
    references leads(company_id, id) on delete set null (lead_id),
  foreign key (company_id, assigned_to)
    references sellers(company_id, id) on delete restrict
);
create index tasks_company_id_idx  on tasks(company_id);
create index tasks_assigned_to_idx on tasks(assigned_to);
create index tasks_lead_id_idx     on tasks(lead_id);
create index tasks_state_idx       on tasks(state);
```

### 4.9 `sellers` e `profiles` — sem colunas novas

Apenas as uniques compostas da seção 3. `sellers` permanece só com identidade,
vínculo (`profile_id`), equipe e `is_active` (decisão nº 2). `profiles` já tem
`is_active` desde o M1-B (`supabase/migrations/20260708120000_m1b_auth_profiles_sellers.sql:45`).

---

## 5. RLS

### 5.1 Helpers endurecidos — `is_active` + `search_path` seguro

`profiles.is_active` **já existe** (M1-B). O problema: as funções auxiliares do
M1-B não o consultam — um profile desativado ainda resolve
`company_id`/`role`/`seller_id`. A única barreira hoje é `_loadProfile()` no
cliente (`lib/services.ts:33`), que é UX, não segurança.

Correção (redefinição na migration `m1c_02`), já aplicando também o padrão de
`search_path` seguro da Revisão 3 (string vazia + nomes qualificados):

```sql
create or replace function public.current_profile_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.current_profile_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.current_profile_seller_id() returns text
language sql stable security definer set search_path = '' as $$
  select seller_id from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_profile_role() in ('manager', 'admin');
$$;

revoke all on function public.current_profile_company_id() from public;
revoke all on function public.current_profile_role()       from public;
revoke all on function public.current_profile_seller_id()  from public;
revoke all on function public.is_manager_or_admin()        from public;
grant execute on function public.current_profile_company_id() to authenticated;
grant execute on function public.current_profile_role()       to authenticated;
grant execute on function public.current_profile_seller_id()  to authenticated;
grant execute on function public.is_manager_or_admin()        to authenticated;
```

Efeito para profile inativo: helpers retornam `NULL` → toda comparação
`company_id = current_profile_company_id()` avalia como `NULL` → RLS nega
(SELECT filtra a linha; INSERT/UPDATE falham o `WITH CHECK`). Vale
retroativamente para as policies do M1-B também.

**Distinção importante (correção nº 5):** `is_active=false` **não** impede a
autenticação no Supabase Auth — `signInWithPassword` continua emitindo sessão,
porque o GoTrue não conhece a tabela `profiles`. O fluxo real é:

1. usuário autentica no Auth (sucesso);
2. `_loadProfile()` lê o profile, vê `is_active=false` (ou zero linhas, já que
   a RLS com helpers endurecidos nem retorna a linha), retorna `null`;
3. `AuthService.login` detecta profile ausente/inativo → **nega a entrada e
   executa `signOut()`** (o código do M1-B já faz exatamente isso em
   `lib/services.ts:54`);
4. para uma sessão **já aberta** de um profile desativado no meio do caminho,
   a RLS endurecida garante **zero linhas** em qualquer tabela protegida, mesmo
   com o JWT ainda válido.

A matriz de testes (seção 15) reflete essa distinção — o critério não é mais
"login falha", e sim "autentica no Auth, aplicação nega entrada + signOut" e
"sessão aberta lê zero linhas".

### 5.2 Policies — todas com `TO authenticated`, separadas por operação

Padrões da Revisão 3 aplicados a todas: `to authenticated` explícito; uma
policy por operação (`for select` / `for insert` / `for update` — **sem
`for all`**); `USING` controla as linhas alcançáveis e `WITH CHECK` re-valida a
linha **resultante** (é o que impede reatribuição de dono por um seller).
DELETE não ganha policy em nenhuma tabela comercial — sem policy e sem grant,
DELETE é negado duas vezes.

#### `leads`, `visits`, `deals`, `sales` (padrão com `seller_id`)

```sql
-- exemplo com leads; visits/deals/sales seguem o mesmo molde trocando a tabela
create policy leads_select on leads for select to authenticated using (
  company_id = current_profile_company_id()
  and (is_manager_or_admin() or seller_id = current_profile_seller_id())
);

create policy leads_insert on leads for insert to authenticated with check (
  company_id = current_profile_company_id()
  and (is_manager_or_admin()
       or seller_id = current_profile_seller_id()
       or seller_id is null)
);

create policy leads_update on leads for update to authenticated using (
  company_id = current_profile_company_id()
  and (is_manager_or_admin() or seller_id = current_profile_seller_id())
) with check (
  company_id = current_profile_company_id()
  and (is_manager_or_admin()
       or seller_id = current_profile_seller_id()
       or seller_id is null)
);
```

Semântica garantida:
- seller **não cria** linha atribuída a outro seller (`WITH CHECK` do INSERT);
- seller **não reatribui** linha própria para outro seller: o `USING` do UPDATE
  aceita a linha original (dele), mas o `WITH CHECK` reavalia contra a linha
  **pós-update** — `seller_id = 's99'` ≠ `current_profile_seller_id()` → rejeita;
- seller pode "des-atribuir" (`seller_id is null`) — espelho do comportamento
  atual em que leads sem dono existem e são visíveis;
- manager/admin: escopo total dentro da própria empresa, nada além dela.

Observação sobre `sales`: as policies acima existem, mas INSERT direto e UPDATE
de colunas sensíveis são adicionalmente bloqueados por **grant** (seção 6) —
criação só via `sale_create()`, status só via `sale_cancel()`.

#### `tasks` (regra própria: tarefa sem dono é visível/criável por seller)

```sql
create policy tasks_select on tasks for select to authenticated using (
  company_id = current_profile_company_id()
  and (is_manager_or_admin()
       or assigned_to is null
       or assigned_to = current_profile_seller_id())
);

create policy tasks_insert on tasks for insert to authenticated with check (
  company_id = current_profile_company_id()
  and (is_manager_or_admin()
       or assigned_to = current_profile_seller_id()
       or assigned_to is null)
);

create policy tasks_update on tasks for update to authenticated using (
  company_id = current_profile_company_id()
  and (is_manager_or_admin()
       or assigned_to is null
       or assigned_to = current_profile_seller_id())
) with check (
  company_id = current_profile_company_id()
  and (is_manager_or_admin()
       or assigned_to = current_profile_seller_id()
       or assigned_to is null)
);
```

#### `lead_timeline_entries` (correção nº 5 da Revisão 2, mantida)

```sql
create policy lead_timeline_select on lead_timeline_entries
for select to authenticated using (
  company_id = current_profile_company_id()
  and exists (
    select 1 from leads l
    where l.id = lead_id
      and (is_manager_or_admin() or l.seller_id = current_profile_seller_id())
  )
);

create policy lead_timeline_insert on lead_timeline_entries
for insert to authenticated with check (
  company_id = current_profile_company_id()
  and exists (
    select 1 from leads l
    where l.id = lead_id
      and l.company_id = current_profile_company_id()
      and (is_manager_or_admin() or l.seller_id = current_profile_seller_id())
  )
);
-- sem policy de UPDATE nem DELETE: timeline é somente-inserção.
```

Dupla camada intencional: a **FK composta** garante consistência de empresa no
nível de dado; a **policy** garante autorização (lead dentro do escopo de quem
insere). Nenhuma substitui a outra.

#### `pipeline_stages`

```sql
create policy stages_select on pipeline_stages for select to authenticated using (
  company_id = current_profile_company_id()
);

create policy stages_insert on pipeline_stages for insert to authenticated with check (
  company_id = current_profile_company_id() and is_manager_or_admin()
);

create policy stages_update on pipeline_stages for update to authenticated using (
  company_id = current_profile_company_id() and is_manager_or_admin()
) with check (
  company_id = current_profile_company_id() and is_manager_or_admin()
);
-- sem policy de DELETE nesta fase (remoção de estágio: decisão de produto futura;
-- a FK restrict de leads.stage_id bloquearia estágio em uso de qualquer forma).
```

---

## 6. Grants — explícitos, sem depender dos defaults do Supabase

O Supabase concede por padrão privilégios amplos ao role `authenticated` e
EXECUTE a `PUBLIC` em funções novas. Nada aqui depende desses defaults — tudo
é revogado e re-concedido explicitamente, na **mesma transação** da criação de
cada objeto (cada migration é uma transação; o `create function` + `revoke` +
`grant` vivem juntos no mesmo arquivo).

### 6.1 Tabelas

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `pipeline_stages` | ✅ | ✅ (RLS: manager/admin) | ✅ colunas: `name`, `is_terminal` — `sort_order` só via RPC; `code` imutável | ❌ |
| `leads` | ✅ | ✅ | ✅ todas as colunas de negócio | ❌ |
| `lead_timeline_entries` | ✅ | ✅ | ❌ | ❌ |
| `visits` | ✅ | ✅ | ✅ todas | ❌ |
| `tasks` | ✅ | ✅ | ✅ todas | ❌ |
| `deals` | ✅ | ✅ | ✅ colunas: `client, car, value_amount, discount_note, last, payment, down_payment, installments, note` — **exclui** `status` e todos os campos de auditoria | ❌ |
| `sales` | ✅ | ❌ (só via `sale_create`) | ✅ colunas: `client, car, payment` — **exclui** `status`, `canceled_by_user_id`, `canceled_at` (só via `sale_cancel`) | ❌ |

```sql
revoke all on table pipeline_stages, leads, lead_timeline_entries,
                    visits, tasks, deals, sales from public;
revoke all on table pipeline_stages, leads, lead_timeline_entries,
                    visits, tasks, deals, sales from anon;

grant select on pipeline_stages, leads, lead_timeline_entries,
                visits, tasks, deals, sales to authenticated;

grant insert on pipeline_stages, leads, lead_timeline_entries,
                visits, tasks, deals to authenticated;
-- sales: SEM grant de insert — criação exclusivamente via sale_create()

grant update (name, is_terminal) on pipeline_stages to authenticated;
grant update on leads, visits, tasks to authenticated;
grant update (client, car, value_amount, discount_note, last, payment,
              down_payment, installments, note) on deals to authenticated;
grant update (client, car, payment) on sales to authenticated;
-- sales: status/canceled_by_user_id/canceled_at fora do grant — mudam
--        exclusivamente via sale_cancel()
-- lead_timeline_entries: SEM grant de update (somente-inserção)
-- DELETE: nenhum grant em nenhuma tabela comercial
```

### 6.2 Funções (RPCs e helpers)

Para **cada** função: `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO
authenticated`, sempre com **assinatura completa**, no mesmo arquivo/transação
do `CREATE FUNCTION`:

```sql
revoke all on function public.sale_create(uuid, uuid, text, text, text, numeric, text) from public;
revoke all on function public.sale_cancel(uuid)                  from public;
revoke all on function public.deal_approve(uuid)                 from public;
revoke all on function public.deal_reject(uuid)                  from public;
revoke all on function public.reorder_pipeline_stages(uuid[])    from public;
revoke all on function public.get_seller_ranking()               from public;

grant execute on function public.sale_create(uuid, uuid, text, text, text, numeric, text) to authenticated;
grant execute on function public.sale_cancel(uuid)               to authenticated;
grant execute on function public.deal_approve(uuid)              to authenticated;
grant execute on function public.deal_reject(uuid)               to authenticated;
grant execute on function public.reorder_pipeline_stages(uuid[]) to authenticated;
grant execute on function public.get_seller_ranking()            to authenticated;
```

(Os helpers de RLS recebem o mesmo tratamento — já listado na seção 5.1.)

### 6.3 Auditoria final de SECURITY DEFINER — checklist obrigatório

Toda função `SECURITY DEFINER` do projeto deve cumprir, sem exceção:
`set search_path = ''`; **todos** os objetos totalmente qualificados
(`public.*`, `auth.uid()`); `revoke all on function public.<nome>(assinatura)
from public`; `grant execute on function public.<nome>(assinatura) to
authenticated`; e `CREATE OR REPLACE` + `REVOKE` + `GRANT` no **mesmo arquivo
de migration (mesma transação)**. Checklist das 10 funções:

| Função (assinatura completa) | Tipo | Migration |
|---|---|---|
| `public.current_profile_company_id()` | helper RLS | `m1c_02` |
| `public.current_profile_role()` | helper RLS | `m1c_02` |
| `public.current_profile_seller_id()` | helper RLS | `m1c_02` |
| `public.is_manager_or_admin()` | helper RLS | `m1c_02` |
| `public.reorder_pipeline_stages(uuid[])` | RPC | `m1c_03` |
| `public.deal_approve(uuid)` | RPC | `m1c_08` |
| `public.deal_reject(uuid)` | RPC | `m1c_08` |
| `public.sale_create(uuid, uuid, text, text, text, numeric, text)` | RPC | `m1c_10` |
| `public.sale_cancel(uuid)` | RPC | `m1c_10` |
| `public.get_seller_ranking()` | RPC | `m1c_12` |

A revisão de cada migration confere este checklist antes do apply — nenhuma
função pode ficar com o `EXECUTE` default que o Postgres concede a `PUBLIC`.

---

## 7. RPCs

Padrões comuns a todas (correção nº 2): `security definer`;
`set search_path = ''` com **todos** os objetos qualificados
(`public.sales`, `public.leads`, `public.current_profile_company_id()`,
`auth.uid()`); criação + revoke + grant na mesma transação; `updated_at` nunca
setado manualmente (trigger da seção 9 cobre qualquer UPDATE, inclusive os
internos às RPCs); auditoria sempre `auth.uid()`.

### 7.1 `sale_create` — assinatura corrigida (correção nº 3)

**Assinatura: 7 parâmetros** (a Revisão 2 dizia "4 parâmetros" com uma
assinatura de 5 e sem `client`/`car` para venda avulsa — ambos os defeitos
corrigidos aqui):

```sql
create or replace function public.sale_create(
  p_lead_id      uuid,      -- nullable
  p_deal_id      uuid,      -- nullable
  p_seller_id    text,      -- SÓ aceito em venda avulsa (sem lead e sem deal)
  p_client       text,      -- SÓ aceito em venda avulsa
  p_car          text,      -- SÓ aceito em venda avulsa
  p_value_amount numeric,
  p_payment      text
) returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid           := public.current_profile_company_id();
  v_role       public.user_role := public.current_profile_role();
  v_own_seller text           := public.current_profile_seller_id();
  v_lead       public.leads;
  v_deal       public.deals;
  v_seller_id  text;
  v_client     text;
  v_car        text;
  v_sale       public.sales;
begin
  if v_company_id is null then
    raise exception 'no active profile for current user';
  end if;
  if p_value_amount is null or p_value_amount <= 0 then
    raise exception 'value_amount must be greater than zero';
  end if;

  -- ── Caminho 1: venda ancorada em lead e/ou deal ──────────────────────
  -- client/car/seller_id vêm SEMPRE do banco; valores client-side para esses
  -- campos são REJEITADOS (não silenciosamente ignorados) para o erro de
  -- integração aparecer cedo em vez de mascarar um bug do chamador.
  if p_lead_id is not null or p_deal_id is not null then
    if p_seller_id is not null or p_client is not null or p_car is not null then
      raise exception 'seller/client/car are derived from lead/deal and must be null';
    end if;

    if p_deal_id is not null then
      select * into v_deal from public.deals
        where id = p_deal_id and company_id = v_company_id
        for update;
      if v_deal is null then raise exception 'deal not found in company'; end if;
      if v_deal.status = 'vendida' then raise exception 'deal already sold'; end if;
      if p_lead_id is not null and v_deal.lead_id is not null
         and v_deal.lead_id <> p_lead_id then
        raise exception 'p_lead_id does not match deal.lead_id';
      end if;
      v_seller_id := v_deal.seller_id;
      v_client    := v_deal.client;
      v_car       := v_deal.car;
      p_lead_id   := coalesce(p_lead_id, v_deal.lead_id);
    end if;

    if p_lead_id is not null then
      select * into v_lead from public.leads
        where id = p_lead_id and company_id = v_company_id
        for update;
      if v_lead is null then raise exception 'lead not found in company'; end if;
      if v_seller_id is not null and v_lead.seller_id is not null
         and v_lead.seller_id <> v_seller_id then
        raise exception 'lead.seller_id does not match deal.seller_id';
      end if;
      v_seller_id := coalesce(v_seller_id, v_lead.seller_id);
      v_client    := coalesce(v_client, v_lead.name);
      v_car       := coalesce(v_car, v_lead.car);
    end if;

  -- ── Caminho 2: venda avulsa (sem lead, sem deal) ─────────────────────
  else
    if p_client is null or btrim(p_client) = '' then
      raise exception 'client is required for a standalone sale';
    end if;
    v_client := p_client;
    v_car    := p_car;

    if v_role = 'seller' then
      -- Seller fica automaticamente limitado ao próprio seller_id;
      -- informar outro é erro, não sobrescrita silenciosa.
      if p_seller_id is not null and p_seller_id <> v_own_seller then
        raise exception 'seller cannot register a sale for another seller';
      end if;
      v_seller_id := v_own_seller;
    else
      -- Manager/admin DEVEM informar um seller válido em venda avulsa.
      if p_seller_id is null then
        raise exception 'seller_id is required for a standalone sale';
      end if;
      v_seller_id := p_seller_id;
    end if;

    perform 1 from public.sellers
      where id = v_seller_id and company_id = v_company_id and is_active;
    if not found then
      raise exception 'seller not found or inactive in company';
    end if;
  end if;

  -- ── Regra de posse (também para o Caminho 1) ─────────────────────────
  if v_role = 'seller' and v_seller_id is not null
     and v_seller_id <> v_own_seller then
    raise exception 'seller cannot register a sale for another seller';
  end if;

  -- ── Insert — constraint única parcial é a proteção final de corrida ──
  begin
    insert into public.sales
      (company_id, lead_id, deal_id, seller_id, client, car,
       value_amount, payment, created_by_user_id)
    values
      (v_company_id, p_lead_id, p_deal_id, v_seller_id, v_client, v_car,
       p_value_amount, p_payment, auth.uid())
    returning * into v_sale;
  exception when unique_violation then
    raise exception 'lead or deal already has an active sale';
  end;

  if p_deal_id is not null then
    update public.deals set status = 'vendida' where id = p_deal_id;
  end if;

  return v_sale;
end;
$$;
```

Resumo do contrato:
- `value_amount > 0` validado na RPC **e** por `check` na tabela (§4.7);
- lead/deal presentes ⇒ `client`/`car`/`seller_id` derivados do banco;
  qualquer valor client-side para eles é **rejeitado** com erro claro;
- venda avulsa ⇒ `p_client` obrigatório; seller é travado no próprio
  `seller_id`; manager/admin precisam informar seller válido e ativo da empresa;
- `for update` nas linhas de lead/deal reduz a janela de corrida; a constraint
  única parcial é a garantia final;
- Revoke/grant conforme §6.2, assinatura completa
  `(uuid, uuid, text, text, text, numeric, text)`.

### 7.2 `sale_cancel`

```sql
create or replace function public.sale_cancel(p_sale_id uuid) returns public.sales
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_profile_company_id();
  v_sale public.sales;
  v_deal public.deals;
begin
  if v_company_id is null then raise exception 'no active profile for current user'; end if;
  if not public.is_manager_or_admin() then raise exception 'forbidden: manager/admin only'; end if;

  select * into v_sale from public.sales
    where id = p_sale_id and company_id = v_company_id
    for update;
  if v_sale is null then raise exception 'sale not found in company'; end if;
  if v_sale.status = 'cancelada' then
    -- repetição → erro controlado; o repositório trata como no-op idempotente (§11)
    raise exception 'sale already canceled';
  end if;

  update public.sales
    set status = 'cancelada',
        canceled_by_user_id = auth.uid(),   -- NUNCA vindo do cliente
        canceled_at = now()
    where id = p_sale_id returning * into v_sale;

  if v_sale.deal_id is not null then
    select * into v_deal from public.deals where id = v_sale.deal_id for update;
    if v_deal.status = 'vendida' then
      update public.deals
        set status = case when v_deal.approved_by_user_id is not null
                          then 'aprovada' else 'aberta' end
        where id = v_deal.id;
    end if;
  end if;

  if v_sale.lead_id is not null then
    update public.leads
      set urgency = 'amber', alert = 'Venda cancelada', last = 'Retomar negociação'
      where id = v_sale.lead_id;
    insert into public.lead_timeline_entries (lead_id, company_id, icon, color, label)
      values (v_sale.lead_id, v_sale.company_id, 'xCircle', '#FF3B3B', 'Venda cancelada');
  end if;

  return v_sale;
end;
$$;
```

Validações: empresa (`company_id = v_company_id` no SELECT), autorização
(`is_manager_or_admin()`), estado atual (`status = 'cancelada'` → erro
controlado, nunca dupla reversão), `FOR UPDATE` nas linhas de `sales` e
`deals` envolvidas. Auditoria de cancelamento (Revisão 4): a própria RPC
preenche `canceled_by_user_id = auth.uid()` e `canceled_at = now()` — nenhum
identificador de auditoria vem do cliente, e as colunas estão fora do grant de
UPDATE de `authenticated` (§6.1), então não existe outro caminho de escrita.

### 7.3 `deal_approve` / `deal_reject`

```sql
create or replace function public.deal_approve(p_deal_id uuid) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_profile_company_id();
  v_deal public.deals;
begin
  if v_company_id is null then raise exception 'no active profile for current user'; end if;
  if not public.is_manager_or_admin() then raise exception 'forbidden: manager/admin only'; end if;

  select * into v_deal from public.deals
    where id = p_deal_id and company_id = v_company_id
    for update;
  if v_deal is null then raise exception 'deal not found in company'; end if;
  if v_deal.status not in ('aberta','aprovacao') then
    raise exception 'deal not in an approvable state';
  end if;

  update public.deals
    set status = 'aprovada', approved_by_user_id = auth.uid(), approved_at = now()
    where id = p_deal_id returning * into v_deal;
  return v_deal;
end;
$$;

create or replace function public.deal_reject(p_deal_id uuid) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_profile_company_id();
  v_deal public.deals;
begin
  if v_company_id is null then raise exception 'no active profile for current user'; end if;
  if not public.is_manager_or_admin() then raise exception 'forbidden: manager/admin only'; end if;

  select * into v_deal from public.deals
    where id = p_deal_id and company_id = v_company_id
    for update;
  if v_deal is null then raise exception 'deal not found in company'; end if;
  if v_deal.status not in ('aberta','aprovacao') then
    raise exception 'deal not in a rejectable state';
  end if;

  update public.deals
    set status = 'recusada', rejected_by_user_id = auth.uid(), rejected_at = now()
    where id = p_deal_id returning * into v_deal;
  return v_deal;
end;
$$;
```

Repetição (`deal_approve` num deal já aprovado) → erro controlado
`'deal not in an approvable state'`; o repositório o classifica como conflito
de estado, não como falha inesperada (§11). Auditoria: sempre `auth.uid()`.

### 7.4 `reorder_pipeline_stages` — com lock explícito (correção nº 6)

```sql
create or replace function public.reorder_pipeline_stages(p_ordered_ids uuid[])
returns setof public.pipeline_stages
language plpgsql security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_profile_company_id();
  v_id uuid;
  v_idx int := 0;
  v_matching int;
  v_total int;
begin
  if v_company_id is null then raise exception 'no active profile for current user'; end if;
  if not public.is_manager_or_admin() then raise exception 'forbidden: manager/admin only'; end if;

  -- LOCK EXPLÍCITO E DETERMINÍSTICO: trava TODAS as linhas da empresa em
  -- ordem estável (ORDER BY id) antes de qualquer validação/UPDATE.
  -- Duas reordenações concorrentes da mesma empresa se enfileiram aqui —
  -- e como ambas travam na MESMA ordem, não há deadlock possível entre elas.
  perform 1 from public.pipeline_stages
    where company_id = v_company_id
    order by id
    for update;

  select count(distinct s.id) into v_matching
    from public.pipeline_stages s
    where s.id = any(p_ordered_ids) and s.company_id = v_company_id;
  select count(*) into v_total
    from public.pipeline_stages
    where company_id = v_company_id;

  if v_matching <> coalesce(array_length(p_ordered_ids, 1), 0) then
    -- também rejeita ids duplicados no array (count(distinct) < array_length)
    raise exception 'one or more stages do not belong to the current company (or duplicated ids)';
  end if;
  if v_matching <> v_total then
    raise exception 'ordered list must include every stage of the company';
  end if;

  foreach v_id in array p_ordered_ids loop
    update public.pipeline_stages
      set sort_order = v_idx
      where id = v_id and company_id = v_company_id;
    v_idx := v_idx + 1;
  end loop;

  return query
    select * from public.pipeline_stages
    where company_id = v_company_id
    order by sort_order;
end;
$$;
```

Mecânica de concorrência, documentada explicitamente (sem afirmar serialização
que não existe):

- a constraint `unique (company_id, sort_order) deferrable initially deferred`
  continua — permite os estados intermediários do laço dentro da transação;
- o `SELECT ... ORDER BY id FOR UPDATE` é o que **de fato** serializa: a
  segunda chamada concorrente **bloqueia** nessa linha até a primeira
  transação commitar;
- resultado de duas reordenações concorrentes: a segunda **não falha** — ela
  espera, revalida contra o estado já commitado pela primeira e aplica a sua
  própria ordem por cima. **Vence a última que commitar** (last-writer-wins).
  Isso é aceitável para reordenação de Kanban (a intenção mais recente do
  gestor prevalece); se um dia for necessário detectar conflito em vez de
  sobrescrever, o caminho é passar um token de versão esperado e falhar quando
  divergir — fora do escopo do M1-C;
- exceção à espera: se a lista da segunda chamada referenciar um estágio que a
  primeira não tinha, as validações pós-lock capturam e falham com erro claro.

---

## 8. View `seller_performance`

### 8.1 Definição (CTEs agregadas — sem inflação)

Agregação separada por fonte, cada CTE já na granularidade
`(company_id, seller_id)` — o join final é 1-para-1 e não multiplica linhas
nem infla `sum(value_amount)`:

```sql
create view public.seller_performance
with (security_invoker = true) as
with leads_agg as (
  select company_id, seller_id, count(*) as leads_count
  from public.leads
  where seller_id is not null
  group by company_id, seller_id
),
visits_agg as (
  select company_id, seller_id,
    count(*) filter (where status in ('agendada','confirmada','remarcada')) as scheduled_count,
    count(*) filter (where status = 'realizada')                           as visits_count
  from public.visits
  where seller_id is not null
  group by company_id, seller_id
),
sales_agg as (
  select company_id, seller_id,
    count(*) filter (where status <> 'cancelada')                       as sales_count,
    coalesce(sum(value_amount) filter (where status <> 'cancelada'), 0) as revenue_amount
  from public.sales
  where seller_id is not null
  group by company_id, seller_id
)
select
  s.id                            as seller_id,
  s.company_id,
  s.name,
  s.first_name,
  s.team,
  s.is_active,
  coalesce(la.leads_count, 0)     as leads_count,
  coalesce(va.scheduled_count, 0) as scheduled_count,
  coalesce(va.visits_count, 0)    as visits_count,
  coalesce(sa.sales_count, 0)     as sales_count,
  coalesce(sa.revenue_amount, 0)  as revenue_amount,
  case when coalesce(la.leads_count, 0) > 0
    then round(100.0 * coalesce(sa.sales_count, 0) / la.leads_count, 1)
    else 0 end                    as conversion_pct,
  rank() over (
    partition by s.company_id
    order by coalesce(sa.sales_count, 0)    desc,
             coalesce(sa.revenue_amount, 0) desc,
             s.name asc
  ) as position
from public.sellers s
left join leads_agg  la on la.company_id = s.company_id and la.seller_id = s.id
left join visits_agg va on va.company_id = s.company_id and va.seller_id = s.id
left join sales_agg  sa on sa.company_id = s.company_id and sa.seller_id = s.id;

revoke all on public.seller_performance from public, anon;
grant select on public.seller_performance to authenticated;
```

### 8.2 Semântica de visibilidade por papel (correção nº 8)

`security_invoker = true` faz a view rodar com a RLS de quem consulta. As
policies de `sellers` (M1-B) definem o resultado:

- **admin/manager** — `sellers_select_company` libera todos os vendedores da
  empresa; leads/visits/sales também são visíveis integralmente para esses
  papéis → **ranking completo, métricas corretas, `position` confiável**;
- **seller** — `sellers_select_own` devolve **apenas a própria linha** de
  `sellers`. Os demais vendedores **não aparecem** na view (nem zerados —
  a linha-base deles é filtrada pela RLS de `sellers` antes de qualquer join).
  As agregações da própria linha usam apenas leads/visits/sales que o seller
  pode ver — que são exatamente os dele → métricas próprias corretas.

**Limitação explícita e assumida:** para um seller, a coluna `position` desta
**view** é calculada só sobre a partição visível (a própria linha) e portanto
será sempre `1` — **não representa a posição real no ranking da empresa**.
Regra para a UI no M1-C: telas de seller não exibem `position` vindo desta
view. O pódio/ranking para o papel seller **continua existindo** (decisão da
Revisão 4), mas é servido pela RPC `get_seller_ranking()` (§8.3), que devolve
apenas agregados.

`growth`/`move` (variação de período) continuam fora do M1-C — não existe
conceito de período anterior no schema. **Decisão da Revisão 4: a UI oculta
esses indicadores por completo** (o componente não renderiza a seta/percentual
de variação) — não exibe zero nem valor simulado, porque um número falso é
pior que a ausência do número.

### 8.3 RPC `get_seller_ranking()` — pódio/ranking para todos os papéis

Motivação: a view (§8.1/§8.2), sob `security_invoker`, nunca mostrará a um
seller a posição real dele nem o pódio da empresa — a RLS de `sellers` esconde
os colegas. O pódio do Home, hoje visível para vendedores com dados locais,
continua no produto — servido por esta RPC, que roda `security definer`
(atravessa a RLS de propósito) mas **retorna somente métricas agregadas**:
nenhum lead, visita, cliente, telefone ou registro individual atravessa a
fronteira.

```sql
create or replace function public.get_seller_ranking()
returns table (
  position       bigint,
  seller_id      text,
  name           text,
  team           text,
  sales_count    bigint,
  revenue_amount numeric,
  conversion_pct numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company_id uuid := public.current_profile_company_id();
begin
  -- Profile ativo obrigatório: helper retorna NULL para inativo (§5.1)
  if v_company_id is null then
    raise exception 'no active profile for current user';
  end if;

  return query
  with leads_agg as (
    select l.seller_id, count(*) as leads_count
    from public.leads l
    where l.company_id = v_company_id and l.seller_id is not null
    group by l.seller_id
  ),
  sales_agg as (
    select sa.seller_id,
      count(*) filter (where sa.status <> 'cancelada')                          as sales_count,
      coalesce(sum(sa.value_amount) filter (where sa.status <> 'cancelada'), 0) as revenue_amount
    from public.sales sa
    where sa.company_id = v_company_id and sa.seller_id is not null
    group by sa.seller_id
  )
  select
    rank() over (order by coalesce(sg.sales_count, 0)    desc,
                          coalesce(sg.revenue_amount, 0) desc,
                          s.name asc)          as position,
    s.id                                        as seller_id,
    s.name,
    s.team,
    coalesce(sg.sales_count, 0)                 as sales_count,
    coalesce(sg.revenue_amount, 0)              as revenue_amount,
    case when coalesce(lg.leads_count, 0) > 0
      then round(100.0 * coalesce(sg.sales_count, 0) / lg.leads_count, 1)
      else 0 end                                as conversion_pct
  from public.sellers s
  left join leads_agg lg on lg.seller_id = s.id
  left join sales_agg sg on sg.seller_id = s.id
  where s.company_id = v_company_id
    and s.is_active                             -- só vendedores ativos
  order by 1;
end;
$$;

revoke all on function public.get_seller_ranking() from public;
grant execute on function public.get_seller_ranking() to authenticated;
```

Contrato de segurança:
- retorna **exatamente** as 7 colunas pedidas (`position`, `seller_id`,
  `name`, `team`, `sales_count`, `revenue_amount`, `conversion_pct`) — nada de
  leads, visitas, clientes, telefones ou linhas individuais;
- escopo: só sellers **ativos** da **empresa do chamador**
  (`current_profile_company_id()`); profile inativo → helper retorna `NULL` →
  exceção antes de qualquer leitura;
- endurecimento padrão da §6.3: `security definer`, `set search_path = ''`,
  objetos qualificados, revoke/grant com assinatura completa na mesma
  transação da criação;
- mesmo critério de ordenação do `_sortSellers()` atual e da view §8.1
  (vendas desc, receita desc, nome asc) — os dois caminhos nunca divergem de
  regra de desempate.

Divisão de responsabilidade final: **view `seller_performance`** = telas de
gestão (admin/manager, linhas completas com métricas operacionais);
**RPC `get_seller_ranking()`** = pódio/ranking exibível a qualquer papel,
inclusive seller.

---

## 9. `updated_at` automático

A função compartilhada `set_updated_at()` **já existe** (M1-B) — M1-C apenas
anexa triggers às tabelas novas que têm `updated_at`:

```sql
create trigger pipeline_stages_set_updated_at before update on pipeline_stages
  for each row execute function set_updated_at();
create trigger leads_set_updated_at  before update on leads
  for each row execute function set_updated_at();
create trigger visits_set_updated_at before update on visits
  for each row execute function set_updated_at();
create trigger deals_set_updated_at  before update on deals
  for each row execute function set_updated_at();
create trigger sales_set_updated_at  before update on sales
  for each row execute function set_updated_at();
create trigger tasks_set_updated_at  before update on tasks
  for each row execute function set_updated_at();
-- lead_timeline_entries: sem trigger — não tem updated_at (somente-inserção)
```

Nenhuma RPC seta `updated_at` manualmente — o trigger cobre todo UPDATE,
inclusive os internos às RPCs. Elimina a classe de bug "esqueceram de atualizar
o campo num caminho novo".

---

## 10. Mapeamento snake_case ↔ camelCase

Camada de repositório por tabela (`lib/supabase/repositories/*.ts`), com
mapeamento **manual e explícito** por entidade — duas funções puras por tabela:

```ts
function toLeadRow(input: LeadInput): LeadInsertRow   // camelCase → snake_case + tipos DB
function fromLeadRow(row: LeadRow): Lead              // snake_case → camelCase (interface de lib/data.ts)
```

Sem conversor genérico de case: vários campos mudam de **forma**, não só de
nome (`value` string `'R$ 120.000'` → `value_amount numeric`; `disc` →
`discount_note`; `timeline[]` embutido → tabela filha; `stage` nome →
`stage_id`/`code`). Um conversor automático não resolveria nenhum desses casos
e mascararia os que "parece" ter resolvido. O padrão é o mesmo já usado em
`_loadProfile()` (`lib/services.ts:27-42`).

As interfaces `Lead`/`Visit`/`Deal`/`Sale`/`Task` de `lib/data.ts` continuam
sendo o contrato da UI — componentes não veem nomes de coluna do banco.

---

## 11. Arquitetura assíncrona — TanStack Query (decisão oficial)

```
Componentes (Screens/Flows)
      │  só chamam HOOKS — nunca Services nem Repositories diretamente
      ▼
Hooks de domínio (useLeadsQuery, useCreateLeadMutation, useCancelSaleMutation…)
      │  useQuery/useMutation (TanStack Query) chamando Services
      ▼
Services (lib/services.ts)  — camada de REGRA (calculateLeadHealth, validações
      │                       client-side como defesa em profundidade; a
      │                       fronteira real de segurança é RLS/RPC)
      ▼
Repositories (lib/supabase/repositories/*) — mapeamento + supabase-js/RPC
      ▼
supabase-js
```

Regras da cadeia:
- **Repositories nunca são importados por componentes** — só por Services;
- **Services nunca são chamados por componentes** no mundo pós-cutover — só
  por hooks (durante a transição, telas ainda não migradas continuam no
  caminho síncrono antigo até o cutover do seu módulo);
- hooks concentram invalidação de cache e tratamento de erro.

Query keys (sempre particionadas por empresa no primeiro nível):

```
['leads', companyId]
['leads', companyId, leadId]
['visits', companyId]
['deals', companyId]
['sales', companyId]
['tasks', companyId]
['pipelineStages', companyId]
['sellerPerformance', companyId]
['company', companyId]
```

Invalidações por mutação:

| Mutação | Invalida |
|---|---|
| `createLead` / `updateLead` | `['leads', companyId]`, `['sellerPerformance', companyId]` |
| `addTimelineEntry` | `['leads', companyId, leadId]` |
| `createVisit` / `updateVisit` | `['visits', companyId]`, `['sellerPerformance', companyId]` |
| `createDeal` / `updateDeal` | `['deals', companyId]` |
| `dealApprove` / `dealReject` | `['deals', companyId]` |
| `saleCreate` | `['sales', companyId]`, `['deals', companyId]` (se `dealId`), `['sellerPerformance', companyId]` |
| `saleCancel` | `['sales', companyId]`, `['deals', companyId]` (se `dealId`), `['leads', companyId]` (health muda), `['sellerPerformance', companyId]` |
| `reorderPipelineStages` | `['pipelineStages', companyId]` |
| `createTask` / `updateTask` | `['tasks', companyId]` |
| `updateCompany` | `['company', companyId]` |

Tratamento de erro: exceções de RPC chegam como `error.message` no
`supabase-js`. Cada hook de mutação mapeia mensagens conhecidas para UI
amigável e classifica:

| Mensagem da RPC | Classe | Comportamento na UI |
|---|---|---|
| `lead or deal already has an active sale` | conflito de negócio | aviso claro, refetch |
| `sale already canceled` | repetição idempotente | tratar como sucesso silencioso + refetch |
| `deal not in an approvable/rejectable state` | conflito de estado | aviso + refetch |
| `forbidden: manager/admin only` | autorização | aviso; indica UI desalinhada com papel |
| `seller cannot register a sale for another seller` | autorização | aviso |
| `seller/client/car are derived from lead/deal and must be null` | bug de integração | log + fallback genérico (não deveria ocorrer em produção) |
| qualquer outra | inesperada | fallback genérico + log |

Substitui o retorno silencioso de `boolean` do `SaleService.create` atual.

**Supabase Realtime: fora do escopo do M1-C** (confirmado). Refetch on focus +
invalidação pós-mutação do TanStack Query são suficientes nesta fase.

---

## 12. Ordem exata das migrations e do cutover

### 12.1 Migrations (a view por último — depende de leads/visits/sales)

```
m1c_01_pipeline_stages.sql        -- tabela (com code) + uniques (incl. deferrable)
                                  --   + RLS + trigger + grants + seed dos 5 estágios
m1c_02_rls_helpers_is_active.sql  -- redefine helpers (is_active + search_path='')
                                  --   + revoke/grant das funções
                                  --   + uniques compostas em sellers/profiles
m1c_03_reorder_stages_rpc.sql     -- reorder_pipeline_stages + revoke/grant
m1c_04_leads.sql                  -- enums lead_* + tabela + FKs compostas + RLS
                                  --   + trigger + grants
m1c_05_lead_timeline.sql          -- tabela filha + FK composta + RLS (sel/ins)
                                  --   + grants
m1c_06_visits_tasks.sql           -- enums visit_status/task_* + 2 tabelas + FKs
                                  --   + RLS + triggers + grants
m1c_07_deals.sql                  -- enum deal_status + tabela + FKs (auditoria)
                                  --   + RLS + trigger + grants de coluna
m1c_08_deal_rpcs.sql              -- deal_approve/deal_reject + revoke/grant
m1c_09_sales.sql                  -- enum sale_status + tabela + uniques parciais
                                  --   + FKs + RLS + trigger + grants restritos
m1c_10_sale_rpcs.sql              -- sale_create/sale_cancel + revoke/grant
m1c_11_seller_performance.sql     -- view (CTEs, security_invoker) + grants
                                  --   >>> depois de leads, visits e sales existirem
m1c_12_get_seller_ranking.sql     -- RPC de ranking agregado + revoke/grant
                                  --   >>> POR ÚLTIMO: depende de sellers/leads/sales
```

Notas de conteúdo (decisões da Revisão 4 já embutidas nos arquivos acima):
`m1c_06` cria `visits` com `scheduled_at timestamptz` (sem `day`/`time`);
`m1c_09` cria `sales` já com `canceled_by_user_id`/`canceled_at` e a FK
composta de auditoria; nenhuma migration toca `companies` — `timezone` já
existe desde o M1-B.

Cada arquivo é uma transação: `CREATE` + `REVOKE` + `GRANT` dos seus objetos
vivem juntos — nunca existe um instante commitado com função criada e grant
default do `PUBLIC` ainda ativo.

### 12.2 Cutover por módulo (cada um só corta com schema+RLS+repositório+serviço+UI+testes aprovados)

1. **Stages** (+ fix `is_active` + RPC reorder) — piloto de menor risco.
2. **Company** — zero schema novo (tabela existe do M1-B); só troca o serviço.
3. **Sellers (leitura)** — `SellerService` passa a ler `seller_performance`.
4. **Leads (+ timeline)** — módulo raiz, maior superfície.
5. **Visits + Tasks** — em paralelo; baixo acoplamento entre si.
6. **Deals** (+ RPCs approve/reject).
7. **Sales** (+ RPCs create/cancel) — por último; mais invariantes cruzadas.

---

## 13. Feature flag e rollback (dispositivo exclusivo de desenvolvimento)

```ts
// lib/config/dataSource.ts — existe SÓ durante o M1-C; removido no fim
export const DATA_SOURCE = {
  stages:  'supabase',
  company: 'local',
  sellers: 'local',
  leads:   'local',
  visits:  'local',
  deals:   'local',
  sales:   'local',
  tasks:   'local',
} as const;
```

- Sem dual-write: cada módulo lê/escreve em **uma** fonte por vez.
- Rollback de um módulo = virar a flag para `'local'`.
- **Caveat explícito:** reverter para `'local'` NÃO traz de volta dados criados
  no Supabase durante o teste — o localStorage reexibe seu estado antigo
  (potencialmente desatualizado), e o dado do Supabase fica invisível até o
  módulo voltar para `'supabase'`. Isso é aceitável **exclusivamente** porque
  não existe produção real: os dados de ambos os lados são seed/teste
  descartáveis por definição (decisão nº 3). Com dados reais de cliente, esse
  mesmo rollback significaria perda funcional de dados — por isso o flag e o
  branch `'local'` inteiro são **removidos antes de qualquer go-live**.

---

## 14. Seed × testes de RPC — separados (correção nº 4)

Problema identificado na Revisão 2: o seed sugeria chamar `sale_create()`
diretamente no SQL Editor. Isso não funciona como esperado — no SQL Editor a
sessão roda como proprietário do banco (`postgres`), **sem** JWT: `auth.uid()`
retorna `NULL`, `current_profile_company_id()` retorna `NULL` e a RPC falha em
`'no active profile for current user'`. Seed e teste de RPC são coisas
distintas:

### 14.1 Seed estrutural (SQL Editor / `supabase db` — privilégios de owner)

Script idempotente (delete escopado à empresa de seed + reinsert), **somente
INSERTs diretos** — nunca RPCs:

- reutiliza a company e os 4 profiles/sellers do M1-B (ids preservados);
- `pipeline_stages`: 5 linhas com os codes da §4.2;
- 8–12 leads (3 urgências × 5 estágios, ≥1 por vendedor semeado) — ids uuid
  capturados via `insert … returning id` em variáveis/CTEs do próprio script;
- 5–7 visits com `scheduled_at` distribuído entre passado, hoje e amanhã
  (relativo à data do seed, em UTC calculado a partir do fuso da empresa),
  cobrindo os status principais — exercita o render de agenda por fuso (§4.5);
- 1 deal `'aprovacao'`, 1 deal `'aberta'`;
- 2 sales por INSERT direto (owner ignora a ausência de grant de INSERT de
  `authenticated` — grant não se aplica ao owner): 1 `'entregue'`,
  1 `'aguardando'`, e 1 avulsa (sem lead/deal);
- entradas de timeline para ≥1 lead;
- tasks nos 4 estados;
- 1 profile extra com `is_active = false` (para os testes de inatividade).

O seed valida o **schema**; não valida RPC nem RLS — isso é papel dos testes.

### 14.2 Testes de RPC/RLS (com identidade real)

Duas vias aceitas:

a) **Integração via `supabase-js`** (preferida, porque exercita o caminho
   real do app): script/teste que faz `signInWithPassword` com cada um dos 4
   usuários de teste e executa a matriz da §15 — RPCs, leituras cruzadas,
   tentativas de violação;

b) **pgTAP/SQL** simulando o contexto do PostgREST:
   ```sql
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<uuid-do-usuario>","role":"authenticated"}';
   -- agora auth.uid() resolve e as RPCs/policies avaliam como em produção
   ```
   Útil para rodar a matriz inteira dentro de uma transação com rollback.

Nenhum teste de RPC roda "como owner" — resultado de RPC sob owner não prova
nada sobre o comportamento sob `authenticated`.

---

## 15. Matriz de testes — RLS, concorrência, regressão

| # | Categoria | Cenário | Identidade | Esperado |
|---|---|---|---|---|
| 1 | RLS | Ler leads de outro seller via supabase-js direto | seller | 0 linhas |
| 2 | RLS | `UPDATE leads SET seller_id = <outro>` em lead próprio | seller | rejeitado pelo WITH CHECK |
| 3 | RLS | `INSERT lead` com `seller_id` de outro vendedor | seller | rejeitado |
| 4 | RLS | `UPDATE sales SET status = …` direto (sem RPC) | qualquer | negado (sem grant na coluna) |
| 5 | RLS | `INSERT` direto em `sales` | qualquer | negado (sem grant de INSERT) |
| 6 | RLS | `DELETE` em qualquer tabela comercial | qualquer | negado (sem grant, sem policy) |
| 7 | RLS | Timeline: inserir em lead de outro seller | seller | rejeitado pela policy |
| 8 | Integridade | Timeline: `company_id` divergente do lead | owner (SQL) | violação de FK composta |
| 9 | RLS | Ler dado de outra empresa (2ª empresa de teste) | qualquer | 0 linhas |
| 10 | Inativo | `signInWithPassword` de profile `is_active=false` | vendedor desativado | **Auth autentica**; app detecta profile inativo → nega entrada + `signOut()` |
| 11 | Inativo | Sessão já aberta, profile desativado no meio | vendedor desativado | 0 linhas em qualquer tabela protegida (helpers retornam NULL) |
| 12 | Inativo | RPC (`deal_approve`) com sessão de profile inativo | manager desativado | `'no active profile for current user'` |
| 13 | Integridade | `INSERT deal` com `seller_id` válido de outra empresa | owner (SQL) | violação de FK composta |
| 14 | Integridade | `approved_by_user_id` apontando profile de outra empresa | owner (SQL) | violação de FK composta |
| 15 | Integridade | `DELETE seller` com leads/vendas apontando para ele | owner (SQL) | bloqueado por `RESTRICT` |
| 16 | Concorrência | 2× `sale_create` simultâneas, mesmo `lead_id` | 2 sessões | 1 sucesso, 1 erro `active sale` |
| 17 | Concorrência | 2× `sale_create` simultâneas, mesmo `deal_id` | 2 sessões | idem |
| 18 | Concorrência | 2× `sale_cancel` na mesma venda | manager | 1 sucesso, 1 `'sale already canceled'` (repositório trata como no-op) |
| 19 | Concorrência | 2× `deal_approve` no mesmo deal | manager | 1 sucesso, 1 `'not in an approvable state'` |
| 20 | Concorrência | 2× `reorder_pipeline_stages` concorrentes | 2 managers | 2ª bloqueia no lock, aplica após a 1ª; **vence a última que commita**; nenhuma violação de unique |
| 21 | RPC | `sale_create` com lead/deal + `p_client`/`p_car`/`p_seller_id` preenchidos | seller | erro `'must be null'` |
| 22 | RPC | `sale_create` avulsa sem `p_client` | qualquer | erro `'client is required'` |
| 23 | RPC | `sale_create` avulsa: seller informando outro `p_seller_id` | seller | erro `'another seller'` |
| 24 | RPC | `sale_create` avulsa: manager sem `p_seller_id` | manager | erro `'seller_id is required'` |
| 25 | RPC | `sale_create` com `p_value_amount <= 0` | qualquer | erro `'greater than zero'` |
| 26 | View | Ranking: números batem com contagem manual do seed | manager | sem inflação (valida §8.1) |
| 27 | View | Seller consulta `seller_performance` | seller | **apenas a própria linha**; demais vendedores ausentes (não zerados) |
| 28 | View | Coluna `position` da view para seller | seller | sempre 1 (documentado); UI de seller usa `get_seller_ranking()` para pódio, nunca esta coluna |
| 29 | Regressão | Login/F5/logout — 4 perfis | todos | idêntico ao M1-B validado |
| 30 | Regressão | Ciclo lead→visita→proposta→venda completo | seller e manager | comportamento idêntico ao localStorage |
| 31 | Regressão | Reordenar colunas do Kanban | manager | persiste via RPC; reflete em todas as telas |
| 32 | Regressão | Renomear `name` de um estágio | admin | regras (Health Engine via `code`) não quebram |
| 33 | Regressão | Ajustes → Empresa: editar e persistir | admin | grava no Supabase, sobrevive a F5 |
| 34 | CI | Enum Postgres × constantes TS (`pg_enum` vs `data.ts`) | — | falha se divergirem |
| 35 | Revisão | `resetAll()` inacessível em produção | — | confirmado por leitura de código |
| 36 | RPC | `get_seller_ranking()` chamada por seller | seller | ranking completo da empresa; **somente** as 7 colunas agregadas (nenhum lead/cliente/telefone) |
| 37 | RPC | `get_seller_ranking()` — vendedor `is_active=false` no seed | qualquer | ausente do resultado |
| 38 | RPC | `get_seller_ranking()` com sessão de profile inativo | vendedor desativado | `'no active profile for current user'` |
| 39 | RPC | `get_seller_ranking()` × view: mesma ordenação para admin | admin | posições idênticas (mesma regra de desempate) |
| 40 | Auditoria | `sale_cancel` preenche `canceled_by_user_id`/`canceled_at` | manager | ambos preenchidos com `auth.uid()`/`now()`; imutáveis via UPDATE direto (sem grant) |
| 41 | Timezone | Visita gravada às 14:00 (fuso da empresa) | qualquer | banco tem UTC; render devolve 14:00; "hoje/amanhã" calculados no fuso da empresa |
| 42 | Regressão | Indicadores growth/move | todos | ocultos na UI — nenhum zero ou valor simulado renderizado |

---

## 16. Decisões finais (Revisão 4) — nada permanece em aberto

Todos os pontos antes listados como "em aberto" foram decididos e já estão
incorporados nas seções deste documento:

1. **`visits.day`/`time`** → substituídos por `scheduled_at timestamptz`,
   única fonte de verdade de data/horário; conversão UTC ↔ fuso da empresa
   via `companies.timezone` (já existente do M1-B). Ver §4.5.
2. **Auditoria de cancelamento** → `sales.canceled_by_user_id` (FK composta
   para `profiles(company_id, id)`) + `canceled_at`, preenchidos
   exclusivamente por `sale_cancel()` com `auth.uid()`/`now()`. Ver §4.7 e §7.2.
3. **Ranking para sellers** → pódio mantido para todos os papéis via RPC
   `get_seller_ranking()` (agregados apenas, sellers ativos, empresa do
   chamador); a view `seller_performance` permanece restrita por RLS
   (admin/manager: tudo; seller: só a própria linha). Ver §8.2–§8.3.
4. **`growth`/`move`** → fora do M1-C; a UI **oculta** os indicadores — não
   renderiza zero nem valores simulados. Ver §8.2.
5. **Timeline** → banco armazena somente `occurred_at`; rótulos relativos
   ("Agora", "Ontem", "Há 3 dias") calculados no frontend; texto relativo
   nunca é persistido. Ver §4.4.

Não há decisão pendente bloqueando o início da implementação pela ordem da
§12.2.

---

## 17. Confirmações finais

- Este documento é **design aprovado em arquitetura** (Revisão 4); nenhuma
  migration foi criada, nenhum arquivo de código de aplicação foi alterado,
  nenhum objeto existe no Supabase além do que o M1-B já criou.
- A implementação segue a ordem da §12.2, um módulo por vez, cada cutover
  condicionado a schema + RLS + repositório + serviço + UI + testes aprovados.
