# M1-F E0 — Arquitetura de Super Admin, Empresas, Convites e Ciclo de Vida de Usuários

> Status: **SOMENTE DESIGN — nenhum código, migration, RLS, RPC ou commit foi criado a partir deste documento.**
> Etapa de auditoria e arquitetura. Pausa oficial do M1-E antes do E4.
> **Revisão 2** — substitui integralmente o mecanismo de "empresa
> selecionada" da Revisão 1. A Revisão 1 persistia a empresa ativa do Super
> Admin em `super_admin_active_company`, uma linha por profile — estado
> global compartilhado que quebra com múltiplas abas, dispositivos ou
> sessões simultâneas do mesmo Super Admin (bloqueante, detalhado em §7.2).
> A Revisão 2 elimina esse estado: a empresa alvo passa a ser **explícita
> por operação**, validada no servidor a cada chamada contra a autorização
> real do Super Admin, nunca lida de um registro mutável compartilhado. Ver
> §7 (design corrigido) e §7.7 (cenários de concorrência entre abas/
> dispositivos que motivaram a mudança).
> Base: M1-B (`20260708120000_m1b_auth_profiles_sellers.sql`), M1-C Revisão 4
> (`docs/M1-C-DESIGN.md`), M1-D (cache de identidade — `lib/query/`,
> `lib/hooks/useQueryCacheIdentity.ts`, `components/providers/AuthCacheBoundary.tsx`)
> e M1-E Revisão 3 (`docs/M1-E-DESIGN.md`, E0–E3 aplicados, E4 não iniciado).

---

## 0. Resumo executivo

O AutoCRM deixa de ser um CRM de empresa única e passa a ser produto SaaS
multiempresa da KAPA. Isso introduz um quarto nível de acesso — a própria
KAPA administrando várias empresas clientes — que **não existe hoje em
nenhuma forma**, nem como role, nem como tabela, nem como conceito de UI.

Diagnóstico central: o `ADMIN` atual **não é global**. É um perfil preso a
uma única empresa (`profiles.company_id`), com o mesmo raio de ação do
`MANAGER` no banco (RLS e RPCs tratam os dois de forma idêntica via
`is_manager_or_admin()`), diferindo apenas na UI (`canAccessFullSettings`
libera a aba "Empresa" além de "Etapas"/"Usuários"). Não existe nenhum
Super Admin funcional, nenhuma seleção de empresa, nenhuma tabela de
convites, nenhuma auditoria administrativa e nenhum mecanismo de suspensão/
desligamento/transferência.

Arquitetura recomendada (§4, Opção C — híbrida): `profiles` continua sendo a
identidade única da pessoa (1 conta = 1 login), mas perde `company_id`,
`role` operacional e `seller_id`. Uma nova tabela `company_memberships`
passa a carregar o vínculo empresa+função de gerentes e vendedores;
`sellers` passa a referenciar a **membership** (não mais o profile
diretamente — §5), preservando a identidade histórica de autoria sempre em
`profiles`, nunca em membership nem em seller (§5.3). Super Admin não é
membership de empresa nenhuma — é uma característica global da própria
`profiles` (`platform_role = 'super_admin'`).

**Correção desta revisão:** a Revisão 1 fazia o Super Admin operar dentro
de uma empresa por meio de uma seleção **persistida no servidor**, uma
linha por profile. Esse desenho tem um defeito bloqueante — duas abas (ou
dois dispositivos, ou duas sessões) do mesmo Super Admin compartilhariam a
mesma linha: selecionar a Empresa B numa aba mudaria silenciosamente o
contexto de uma operação em andamento noutra aba que ainda mostra a
Empresa A (cenário completo em §7.2). A Revisão 2 elimina esse estado
global: **a empresa alvo é explícita por operação**, validada no servidor
a cada chamada contra a autorização real do Super Admin — nunca lida de um
registro mutável compartilhado, nunca herdada implicitamente de uma
seleção anterior (§7).

O papel `ADMIN` atual é **absorvido pelo `MANAGER`** (§5.4) — não sobra
nenhuma capacidade que distinga os dois na visão de produto aprovada.

O impacto prático em RLS e RPC do M1-C/M1-E permanece pequeno em volume,
mas muda de forma em relação à Revisão 1. Toda policy e toda RPC lê hoje
`current_profile_company_id()`; a nova arquitetura introduz um pequeno
conjunto de helpers (§7.4) — `current_membership_company_id()` (empresa da
membership ativa, comportamento idêntico ao helper antigo para
`MANAGER`/`SELLER`), `is_platform_super_admin()`,
`can_access_company(target_company_id)` e
`require_company_access(target_company_id)` (validam e devolvem a empresa
alvo, aceitando-a como parâmetro explícito quando quem chama é Super
Admin; para `MANAGER`/`SELLER` a mesma checagem nega qualquer empresa que
não seja a da própria membership, então não há como escalar privilégio
enviando outro id). Das 9 RPCs do M1-E, **7 já recebem `p_lead_id`** e
passam a derivar a empresa alvo do próprio lead (consultando-o por id
antes de validar acesso) — sem nenhum parâmetro novo; só `create_lead` e
`check_lead_phone_duplicate` (que não partem de uma entidade existente)
ganham um parâmetro opcional `p_target_company_id`, obrigatório apenas
para Super Admin (tabela completa em §15.2). O mesmo vale para
`is_manager_or_admin()`, que passa a se chamar `is_manager_or_platform(target_company_id)`.

**Recomendação sobre o E4: permanece pausado.** Retomar o E4 antes de S1–S2
deste documento (schema de memberships/sellers + helpers de validação de
empresa) significa escrever `create_lead`/`update_lead` contra
`current_profile_company_id()`, que será removida/redefinida na próxima
migration de identidade — todo trabalho do E4 teria que ser tocado de
novo. O ponto correto de retomada é após S2 (helpers prontos e RLS
redefinida), tratado como **E4 do M1-E, sem renumerar**, porque o contrato
de `create_lead`/`update_lead` não muda para `MANAGER`/`SELLER` — só a
função interna que eles chamam para obter e validar a empresa (§16).

---

## 1. Estado do repositório nesta etapa

Executado antes de qualquer leitura/design:

```
git status --porcelain -uall   → (vazio)
git status -sb                 → ## main...origin/main
git rev-parse HEAD             → 919f990d8e090b4248884668bea6030b72614768
git diff --check                → (vazio)
git diff --stat                 → (vazio)
git diff --name-status          → (vazio)
git rev-parse origin/main       → 919f990d8e090b4248884668bea6030b72614768
```

`HEAD` e `origin/main` coincidem em `919f990`, working tree limpa, nenhum
arquivo do E4 foi criado ou alterado. Condição para prosseguir com o design
estava satisfeita.

---

## 2. Diagnóstico do sistema atual

### 2.1 O `ADMIN` de hoje

- `profiles.role` é o enum `user_role ('admin','manager','seller')` — **um
  profile pertence a exatamente uma empresa** (`profiles.company_id`, FK
  para `companies`) e tem exatamente um role.
- No banco, `admin` e `manager` são **indistinguíveis**: toda RLS e toda RPC
  do M1-C/M1-E chamam `is_manager_or_admin()`, que retorna
  `role in ('manager','admin')`. Não há nenhuma policy, nenhuma RPC e
  nenhum helper que trate `admin` de forma diferente de `manager`.
- A única diferença observável é de **UI**: `lib/capabilities.ts` define
  `canAccessFullSettings(user) = role === 'admin'`, que libera as abas
  "Empresa" e "Usuários" em Ajustes (`components/screens/ScreensBiz.tsx:418-422`).
  `MANAGER` só vê "Etapas" (e só com a flag remota de stages ligada).
  "Usuários" nessa tela é gestão **local** de vendedores (`SellerService`,
  store), não um fluxo de convite real — não cria conta no Supabase Auth,
  não envia e-mail, não tem estado de convite.
- Conclusão: **`ADMIN` é hoje "gerente com acesso à aba Empresa dentro da
  própria empresa"**, não um super-usuário multiempresa. Ele não vê, não
  administra e não tem qualquer meio de acessar outra empresa. Presumir que
  o `ADMIN` atual já é global seria um erro — auditado explicitamente e
  descartado.

### 2.2 Tabelas e funções que assumem uma única empresa por usuário

Toda a base multiempresa construída em M1-B/M1-C/M1-E assume **1 profile =
1 company_id fixo**, lido direto da linha:

| Objeto | Onde assume 1 empresa |
|---|---|
| `profiles.company_id` | coluna única, sem histórico, sem múltiplos vínculos |
| `profiles.seller_id` | idem — vendedor é do profile, não de um vínculo por empresa |
| `current_profile_company_id()` (m1c_01) | `select company_id from profiles where id = auth.uid()` — uma linha, um valor |
| `current_profile_role()`, `current_profile_seller_id()` | mesma leitura direta de `profiles` |
| `is_manager_or_admin()` | deriva de `current_profile_role()` |
| Todas as 9 RPCs do M1-E (`create_lead` … `check_lead_phone_duplicate`) | fazem `select p.id, p.company_id, p.role, p.seller_id from public.profiles p where p.id = auth.uid() and p.is_active` — a empresa do profile é a autoridade, sem parâmetro, sem seleção |
| RPCs do M1-C (`sale_create`, `sale_cancel`, `deal_approve`, `deal_reject`, `reorder_pipeline_stages`) | mesmo padrão |
| Todas as policies RLS de `leads`, `visits`, `deals`, `sales`, `tasks`, `lead_timeline_entries`, `pipeline_stages`, `companies`, `profiles`, `sellers` | comparam `company_id = current_profile_company_id()` |
| `AuthService._loadProfile` (`lib/services.ts:30-45`) | monta `User` com um único `companyId`/`sellerId` |
| `useQueryCacheIdentity` (`lib/hooks/useQueryCacheIdentity.ts`) | identidade = `{userId, companyId, isActive}`, um valor de `companyId` |
| `leadQueryKeys` (`lib/leads/queryKeys.ts`) | particiona cache por `companyId` único, resolvido do profile |
| `remoteSnapshot`/`bridge` (`lib/leads/remoteSnapshot.ts`, `lib/leads/bridge.ts`) | partição por `(companyId, identityKey)` |

Nenhuma dessas peças quebra com o modelo de dados do M1-C/M1-E em si — todas
continuam corretas para `MANAGER`/`SELLER`, que continuarão tendo **um** e
somente um vínculo de empresa ativo. O que quebraria é tentar encaixar o
Super Admin nesse mesmo esquema fazendo `company_id = null` significar
"acesso total": toda comparação `company_id = current_profile_company_id()`
vira `company_id = NULL`, que o Postgres nunca avalia como verdadeiro — o
Super Admin ficaria **sem acesso a nada**, não com acesso total. Não é gambiarra
viável; é preciso um caminho de resolução de empresa diferente para quem
não tem vínculo fixo (§4, §7).

### 2.3 Riscos de continuar o E4 antes desta etapa

O E4 (`useCreateLead`, `useUpdateLead`, `useCheckLeadPhoneDuplicate`,
`Flows2.tsx`, `FlowsShared.tsx`) consome exclusivamente as RPCs já
publicadas (`create_lead`, `update_lead`, `check_lead_phone_duplicate`),
cujo contrato de parâmetros **não muda** neste redesenho — a autoridade de
empresa continua vindo do servidor. O risco não está no contrato da RPC; está
em:

1. A função interna que essas RPCs chamam (`current_profile_company_id()`)
   será redefinida ou substituída em S2. Se o E4 for concluído, testado e
   validado manualmente **antes** dessa migration, toda a validação manual
   (§16-D do M1-E) precisa ser refeita depois, porque a fonte de verdade de
   empresa mudou de tabela.
2. Front-end do E4 lê `AuthService.getCurrentUser()?.companyId` como
   partição de cache (`lib/services.ts:304`, query keys). Esse campo migra
   de `profiles.company_id` para a resolução via membership — o formato do
   `User` (`lib/data.ts`) muda (§6.3), então qualquer código do E4 escrito
   contra o formato atual do `User` precisa de ajuste, ainda que pequeno.
3. Nenhum dado seria perdido nem nenhuma migration destrutiva aconteceria —
   o risco é **retrabalho e reteste**, não corrupção. Por isso a decisão é
   pausa, não rollback.

**Decisão: o E4 não pode continuar isoladamente.** Ele deve esperar S1–S2
deste documento (schema de memberships/sellers, helpers
`require_company_access()`/`can_access_company()`/`is_manager_or_platform()`,
§7.4) para não duplicar trabalho. Detalhamento em §15 e §16.

---

## 3. Visão do produto (referência)

```
KAPA
└── administra várias empresas clientes
    ├── Empresa A → Gerentes, Vendedores
    ├── Empresa B → Gerentes, Vendedores
    └── Empresa C → Gerentes, Vendedores
```

Três papéis conceituais: `SUPER_ADMIN` (exclusivo KAPA, global, sem
impersonação), `MANAGER` (uma empresa, administra vendedores da própria
empresa), `SELLER` (opera dentro dos próprios limites, nunca cria usuário).
Fluxo normal: KAPA cria empresa → KAPA convida o primeiro gerente → gerente
aceita e cria senha → gerente convida vendedores → KAPA mantém capacidade de
suporte/administração global. Detalhado nas seções seguintes.

---

## 4. Modelo de identidade e acesso

### 4.1 Três opções avaliadas

**Opção A — `company_id` direto em `profiles`, Super Admin com `company_id null`**

| Critério | Avaliação |
|---|---|
| Segurança | Ruim: NULL não vira "acesso total" em SQL — cada policy/RPC precisaria de um `OR is_super_admin()` explícito espalhado por toda a base (M1-B+M1-C+M1-E), risco alto de esquecer um ponto |
| Simplicidade | Mudança mínima de schema, mas complexidade empurrada para dentro de cada policy/RPC existente |
| Multiempresa futura (pessoa em 2 empresas) | Impossível sem reintroduzir uma segunda tabela — a opção não escala para o próprio requisito que o design pede para não fechar a porta |
| RLS | Cada policy das ~9 tabelas comerciais + as 3 de M1-B precisaria ser reescrita duas vezes (uma vez por tabela) |
| RPCs | Todas as RPCs de M1-C/M1-E (10+) precisariam ganhar um parâmetro de empresa explícito, quebrando a garantia atual de "nunca aceitam company_id do cliente" (§6 do M1-E), ou reimplementar a leitura de company_id internamente com lógica condicional duplicada |
| Migração de dados atuais | Trivial (nenhuma) |
| Risco de inconsistência | Alto — a mesma regra de negócio ("quem pode ver o quê") passa a existir em dois lugares divergentes por tabela |

**Rejeitada.** Resolve o caso "Super Admin" às custas de reabrir e reauditar
toda a superfície de RLS/RPC já validada em M1-C/M1-E, e ainda assim não
suporta multiempresa por pessoa.

**Opção B — `profiles` + `company_memberships` (identidade separada do
vínculo)**

`profiles` vira identidade pura (nome, email, status da conta). Uma nova
tabela `company_memberships` guarda `(company_id, profile_id, role,
seller_id, is_active)` — zero ou mais linhas por profile. `SUPER_ADMIN` é
uma função global armazenada em `profiles`, sem membership nenhuma.

| Critério | Avaliação |
|---|---|
| Segurança | Boa: separa "quem a pessoa é" de "o que ela pode fazer em qual empresa"; nenhuma policy precisa saber sobre Super Admin diretamente — só o helper de resolução de empresa muda |
| Simplicidade | Uma tabela nova, um novo padrão de FK composta (já dominado desde M1-C §3) |
| Multiempresa futura | Suportada nativamente — múltiplas linhas de membership por profile |
| RLS | Ponto único de mudança: os 4 helpers de `m1c_01`. As predicates das tabelas comerciais continuam idênticas (comparam contra o retorno do helper) |
| RPCs | Nenhum parâmetro novo de empresa nas RPCs de negócio — continuam derivando do helper. Só as RPCs administrativas novas (criar empresa, convidar, etc.) são novas |
| Migração de dados atuais | Uma migration: para cada `profiles` com `role in ('manager','seller')`, criar 1 membership ativa com os mesmos `company_id`/`role`/`seller_id`; `admin` remapeia para `role='manager'` (§5.4) |
| Risco de inconsistência | Baixo, com uma ressalva: nada impede hoje, estruturalmente, mais de uma membership ativa por profile — precisa de constraint explícita (§6.2) enquanto o produto não suportar de fato multiempresa por pessoa |

**Opção C — Híbrido: função global em `profiles` + `company_memberships`
operacional + `sellers` vinculado à membership**

Igual à Opção B, com duas decisões adicionais que a tornam a recomendação
final:

1. `sellers.profile_id` (hoje FK direta) passa a ser referenciado a partir
   da **membership**, não do profile — porque `seller_id` é um dado
   *por empresa*, não da pessoa. Isso é o que de fato habilita "uma pessoa
   trabalhar em duas empresas no futuro" sem colisão: cada membership tem
   seu próprio `seller_id`, mesmo que seja a mesma pessoa (`profile_id`)
   nas duas.
2. `SUPER_ADMIN` nunca ganha uma linha em `company_memberships` — é
   estruturalmente impossível confundir um Super Admin com um
   manager/seller de alguma empresa, porque a tabela de memberships é, por
   definição, só de gente-de-empresa-cliente. Isso é o mesmo tipo de defesa
   estrutural (constraint, não convenção) já usado em M1-C §3 para FKs
   compostas.

| Critério | Avaliação |
|---|---|
| Segurança | Melhor das três: isolamento estrutural entre "identidade de plataforma" e "identidade de empresa cliente" |
| Simplicidade | Marginalmente mais complexa que B (uma FK a mais), custo baixo |
| Multiempresa futura | Suportada, e sem ambiguidade de "seller_id de qual empresa" |
| RLS | Mesmo ponto único de mudança da Opção B |
| RPCs de negócio (M1-C/M1-E) | Impacto mínimo (§15) |
| Migração de dados atuais | Mesma migration da Opção B, mais o remapeamento de `sellers.profile_id` → membership |
| Risco de inconsistência | Mais baixo que B: a separação estrutural elimina uma classe inteira de bug ("super admin apareceu como seller de uma empresa") |

### 4.2 Recomendação final

**Opção C.** Não é a mais simples de implementar (Opção A) nem a mais
rápida de migrar (também A) — é a mais segura e a única que não reabre a
superfície de RLS/RPC já auditada e validada em M1-C/M1-E. Ver detalhamento
de schema em §6.

---

## 5. Papéis e permissões definitivos

### 5.1 Papel de plataforma — `platform_role`

Novo enum, separado do papel operacional, vive em `profiles.platform_role`
(nullable — a imensa maioria dos profiles nunca tem valor aqui):

```
platform_role: 'super_admin'
```

Modelado como enum com um único valor de propósito, não como
`profiles.is_super_admin boolean`, para deixar espaço documentado (não
implementado — §13.3) a `PLATFORM_ADMIN`/`PLATFORM_SUPPORT`/`PLATFORM_ANALYST`
sem precisar trocar o tipo da coluna depois.

### 5.2 Papel operacional — `company_role`

Novo enum para `company_memberships.role`, substituindo o uso de
`user_role` nesse contexto:

```
company_role: 'manager', 'seller'
```

Duas opções apenas — `admin` não existe mais como valor possível de
membership (§5.4). O enum antigo `user_role` (`admin`,`manager`,`seller`)
não é apagado (Postgres não remove valor de enum de forma simples, e apagar
o tipo quebraria qualquer referência histórica) — fica marcado como
**deprecated, não referenciado por nenhuma tabela nova**, e sai de uso
assim que a migration de dados (§16, S1) remapear todo `profiles.role`
existente.

### 5.3 Matriz de permissões

| Ação | SUPER_ADMIN | MANAGER | SELLER |
|---|---|---|---|
| Criar empresa | ✅ | ❌ | ❌ |
| Convidar Super Admin | ✅ | ❌ | ❌ |
| Convidar Manager | ✅ | ❌ | ❌ |
| Convidar Seller da própria empresa | ✅ (qualquer empresa) | ✅ (só a própria) | ❌ |
| Selecionar empresa para operar | ✅ | — (implícito, sempre a própria) | — (implícito) |
| Ver dados de qualquer empresa | ✅ (uma por vez, via seleção) | ❌ | ❌ |
| Administrar usuários de qualquer empresa | ✅ | ❌ (só da própria) | ❌ |
| Suspender/reativar conta | ✅ (qualquer) | ✅ (sellers da própria empresa) | ❌ |
| Suspender/reativar empresa | ✅ | ❌ | ❌ |
| Transferir leads/tarefas de vendedor desligado | ✅ | ✅ (própria empresa) | ❌ |
| Criar/remover Super Admin | ✅ (com regras de §13) | ❌ | ❌ |
| Operar módulos comerciais (leads, etc.) na empresa selecionada | ✅ (equivalente a manager) | ✅ (própria empresa) | ✅ (escopo próprio) |

### 5.4 Destino do `ADMIN` atual

**`ADMIN` é absorvido por `MANAGER`.** Justificativa:

- No banco, hoje `admin` e `manager` já são idênticos (`is_manager_or_admin()`
  trata os dois igual em toda RLS/RPC de M1-C/M1-E — §2.1).
- Na visão de produto aprovada (§3), `MANAGER` já recebe exatamente as
  capacidades que distinguiam `ADMIN` hoje: administra a própria empresa
  por completo, convida/administra vendedores, acessa todas as
  configurações da própria empresa. Não sobra nenhuma capacidade
  exclusiva de `ADMIN` que `MANAGER` não deva ter.
- Manter `ADMIN` como quarto papel criaria uma pergunta sem resposta de
  produto: "o que um `ADMIN` de empresa pode fazer que um `MANAGER` não
  pode?" — a resposta correta, dado o texto do requisito, é "nada".
- Migração de dados (S1): todo `profiles.role = 'admin'` existente
  (inclusive o seed `u1`/`admin@autocrm.com`) remapeia para
  `company_memberships.role = 'manager'` na mesma empresa, preservando
  `seller_id` (hoje null para admins) e `is_active`. Sem perda de acesso —
  quem era `admin` continua com acesso total à própria empresa como
  `manager`.
- `canAccessFullSettings` (`lib/capabilities.ts`) deixa de existir como
  distinção — `MANAGER` passa a ter o que hoje é `canAccessFullSettings`
  **na própria empresa**; Super Admin tem o equivalente **na empresa
  selecionada** (§7).

---

## 6. Schema conceitual (sem DDL de aplicação — conceitual, para S1)

### 6.1 `profiles` (identidade — alterada)

| Coluna | Hoje | Depois | Motivo |
|---|---|---|---|
| `id` | `uuid` PK → `auth.users` | inalterado | — |
| `name`, `email` | inalterado | inalterado | — |
| `company_id` | `uuid`, FK `companies` | **removida** | vínculo passa a viver em `company_memberships` |
| `role` | `user_role` | **removida** (coluna nova opcional `platform_role`) | papel operacional passa a viver na membership; papel global é outra coisa |
| `seller_id` | `text`, FK `sellers` | **removida** | seller é por empresa, não por pessoa — vive na membership |
| `is_active` | `boolean` | inalterado, mas passa a significar **"a conta existe e não foi desativada globalmente"** — não mais "está ativo nesta empresa" (isso vira `company_memberships.is_active`) |
| `platform_role` | — | **nova**, `platform_role` enum nullable | `'super_admin'` para contas KAPA; null para todo o resto |

### 6.2 `company_memberships` (nova)

```
company_memberships
  id            uuid primary key default gen_random_uuid()
  company_id    uuid not null references companies(id) on delete cascade
  profile_id    uuid not null references profiles(id) on delete cascade
  role          company_role not null            -- 'manager' | 'seller'
  is_active     boolean not null default true
  invited_at    timestamptz
  joined_at     timestamptz
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()

  unique (company_id, id)                         -- alvo de FK composta, padrão M1-C §3

  -- Enquanto multiempresa-por-pessoa não é um requisito ativo de produto:
  -- no máximo 1 membership ATIVA por profile. Índice único parcial —
  -- removível em uma migration futura sem redesenho, quando o produto
  -- decidir suportar múltiplas empresas por pessoa de verdade.
  -- (implementado como unique index parcial, não como constraint de tabela,
  -- exatamente para ficar isolado e removível)
```

Por que `unique (profile_id) where is_active` e não permitir múltiplas
desde já: o requisito (§4, item "possibilidade de uma pessoa trabalhar em
mais de uma empresa futuramente") pede que o modelo **não feche a porta**,
não que a funcionalidade exista agora. Nenhuma tela, nenhuma RPC deste
design assume múltiplas memberships ativas simultâneas — construir para
esse caso agora seria escopo não pedido. A constraint parcial documenta a
decisão atual sem exigir uma segunda migration estrutural para reverter,
apenas `drop index`.

`company_memberships` **não** carrega `seller_id` — o vínculo
seller↔pessoa vive na direção oposta, descrita em §6.3.

### 6.3 `sellers` (alterada — referencia a membership, não mais o profile)

```
sellers
  id            text primary key default gen_random_uuid()::text   -- inalterado desde M1-B
  company_id    uuid not null references companies(id) on delete cascade
  membership_id uuid not null                      -- NOVA: substitui profile_id
  name          text not null
  first_name    text not null
  team          text
  is_active     boolean not null default true       -- mantida (M1-B); ver nota de sincronização abaixo
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()

  unique (company_id, id)                           -- inalterada (M1-C §3), alvo das FKs de leads/tasks/etc.
  foreign key (company_id, membership_id)
    references company_memberships(company_id, id) on delete restrict
```

Por que a FK aponta de `sellers` para `company_memberships` (e não o
contrário, como a Revisão 1 propunha): `sellers.id` é o identificador
**estável e de longa duração** já referenciado por `leads.seller_id`,
`tasks.assigned_to`, `visits.seller_id`, `deals.seller_id`,
`sales.seller_id` desde M1-C. Ele nunca deve mudar quando a pessoa é
suspensa e reativada — só `is_active` muda. Fazendo `sellers` apontar para
a membership (e não o inverso), a cadeia de identidade fica em três elos,
cada um não-destrutivo:

```
leads.seller_id ──▶ sellers(company_id,id) ──▶ company_memberships(company_id,id) ──▶ profiles(id)
   (nunca muda)         (RESTRICT, nunca apagado)     (nunca apagada, só is_active)     (nunca apagado)
```

**Identidade histórica de autoria** (`created_by_profile_id`,
`updated_by_profile_id`, `actor_profile_id` em `leads`,
`lead_timeline_entries`, `deals`, `sales` — M1-C §4, M1-E §3) **continua
apontando direto para `profiles(id)`**, nunca para `company_memberships`
nem para `sellers` — nenhuma dessas FKs de auditoria muda neste
documento. Isso responde diretamente ao requisito de §5: suspender ou
encerrar uma membership jamais apaga autoria histórica, porque a autoria
nunca passou pela membership.

**Sincronização `is_active`:** `sellers.is_active` (M1-B, já lido por
`assign_lead_seller`/`create_lead` em M1-E — "seller ativo da empresa") e
`company_memberships.is_active` (nova) são dois booleans distintos que
precisam ficar coerentes. A decisão é **não fundi-los em uma única coluna**
(o primeiro é uma marca operacional específica de "vendedor disponível
para receber lead", o segundo é o vínculo empresa/pessoa em si) — em vez
disso, toda RPC que suspende ou desliga um seller (`suspend_membership`,
`offboard_seller`, §11) grava as duas colunas **na mesma transação**. Não
existe janela em que uma esteja `true` e a outra `false` como resultado de
uma operação bem-sucedida; um teste de integração dedicado cobre essa
invariante (§17).

`current_profile_seller_id(target_company_id)` (§7.4) resolve
`sellers.id` fazendo `sellers ⋈ company_memberships` pelo `membership_id`,
filtrando por `profile_id = auth.uid()` e `company_id = target_company_id`
— nenhuma leitura direta de `profiles.seller_id` (que deixou de existir).

### 6.4 `companies` (estendida)

| Coluna | Hoje | Depois |
|---|---|---|
| `id`, `name`, `cnpj`, `phone`, `timezone`, `created_at`, `updated_at` | existentes | inalteradas |
| `status` | — | nova, enum `company_status ('implantacao','ativa','suspensa','cancelada')`, default `'implantacao'` |
| `created_by_profile_id` | — | nova, FK `profiles(id) on delete set null` — sempre um Super Admin |
| `trade_name` (nome comercial) | — | nova, nullable |
| `plan` | — | **não criada agora** — fora de escopo por decisão explícita do requisito (§8: "não implementar cobrança ou planos agora") |

**Nenhuma tabela de "empresa ativa/selecionada" é criada.** A Revisão 1
propunha `super_admin_active_company` (uma linha por Super Admin,
sobrescrita a cada troca) — **rejeitada nesta revisão** por quebrar com
múltiplas abas/dispositivos/sessões do mesmo Super Admin (§7.2, §7.3
Opção A).
A empresa alvo passa a ser parâmetro explícito de cada operação,
validado no servidor a cada chamada — nunca um registro persistido e
compartilhado. Desenho completo em §7.

### 6.5 `invites` (nova — convites por e-mail)

```
invites
  id                uuid primary key default gen_random_uuid()
  company_id        uuid references companies(id) on delete cascade   -- null só para convite de Super Admin
  email             text not null
  name              text not null
  role_kind         invite_role_kind not null   -- 'super_admin' | 'manager' | 'seller'
  token_hash        text not null unique         -- hash do token; o token em si nunca fica em texto plano no banco
  status            invite_status not null default 'pending'
                     -- 'pending' | 'accepted' | 'expired' | 'canceled' | 'superseded'
  invited_by_profile_id uuid references profiles(id) on delete set null
  expires_at        timestamptz not null
  accepted_at       timestamptz
  accepted_profile_id uuid references profiles(id) on delete set null
  created_at        timestamptz not null default now()
  updated_at        timestamptz not null default now()

  -- reenvio: o convite antigo vira 'superseded', nunca é apagado (auditoria)
```

### 6.6 `audit_log` (nova — auditoria administrativa)

Detalhada em §14.

---

## 7. Contexto de empresa do Super Admin

### 7.1 Princípios (inalterados)

- Super Admin **sempre autentica com a própria conta KAPA** — nunca existe
  um "entrar como" que troque o JWT ou a sessão para a identidade do
  cliente. Isso já é garantido estruturalmente por não existir nenhum
  mecanismo de impersonação no design (nenhuma tabela, nenhuma RPC, nenhum
  helper de "assumir identidade").
- "Empresa alvo" é **contexto de operação**, não identidade. Toda ação
  continua sendo executada e auditada como tendo sido feita pelo profile
  do Super Admin — nunca em nome do gerente/vendedor da empresa alvo.

### 7.2 Problema identificado na Revisão 1 (bloqueante)

A Revisão 1 guardava a empresa ativa do Super Admin numa linha única por
`profile_id` (`super_admin_active_company`), lida implicitamente por
`effective_company_id()` a cada RLS/RPC. Isso funciona para **um** Super
Admin com **uma** sessão. Quebra assim que existe mais de um contexto
simultâneo do mesmo profile:

```
1. Aba A: Super Admin abre a Empresa A (grava a linha: company_id = A).
2. Aba B (mesmo login, outra aba/dispositivo): Super Admin abre a Empresa B
   (sobrescreve a MESMA linha: company_id = B).
3. Aba A, sem saber da troca em B, continua mostrando "Empresa A" na tela.
4. Usuário na Aba A clica "criar lead". A RPC lê effective_company_id() no
   servidor — que agora resolve para B, não para A, porque a linha é
   compartilhada por profile_id, não por aba/sessão.
5. Resultado: lead criado na Empresa B, com a UI da Aba A mostrando
   "Empresa A" — o autor achou que operou em A, mas operou em B.
```

Isso é inaceitável por vários motivos ao mesmo tempo: a UI mente sobre a
empresa afetada; a auditoria fica correta quanto ao autor (`auth.uid()`
nunca muda) mas **errada quanto ao contexto percebido** por quem executou
a ação; é uma race condition genuína (a ordem de duas trocas concorrentes
decide o resultado de operações que não têm relação entre si); e é
difícil de testar de forma determinística, porque o bug só aparece com
duas sessões vivas ao mesmo tempo — exatamente o cenário que testes de
integração de aba única não cobrem. **Rejeitada nesta revisão.**

### 7.3 Comparação formal das opções

**A. Estado global persistido por Super Admin** (`super_admin_active_company`,
Revisão 1)

| Critério | Avaliação |
|---|---|
| Conflito entre abas/dispositivos | Sim — demonstrado em §7.2, é o defeito que motivou esta revisão |
| Estado escondido | Sim — a UI de uma aba não tem como saber que outra aba mudou o contexto sem poll ativo |
| Race conditions | Sim — duas trocas concorrentes decidem por ordem de chegada, não por intenção de quem opera |
| Operação executada em empresa diferente da mostrada | Sim — cenário central de §7.2 |
| Auditoria | Autor sempre correto (`auth.uid()`); contexto de operação pode divergir do que a UI mostrava no momento do clique |
| Testabilidade | Ruim — exige simular duas sessões vivas para expor o defeito |
| Contexto mutável fora da requisição | Sim — é exatamente esse o problema: o contexto vive numa tabela, não na requisição |

**Rejeitada.**

**B. `company_id` explícito por operação** (adotada)

O frontend informa a empresa alvo em cada operação administrativa; para
RPCs de negócio já ligadas a uma entidade (`p_lead_id`), a empresa é
derivada da própria entidade, não de um parâmetro adicional (§7.4, §15.2).
O banco valida, a cada chamada, que quem chama tem acesso real àquela
empresa — nunca confia no valor recebido sem checagem.

**Deixado explícito, porque é o ponto central da correção:** receber
`company_id` do frontend **não é automaticamente inseguro**. O erro seria
confiar nele sem validar. Um Super Admin já possui permissão global — o
que o servidor precisa fazer é validar a identidade de quem chama e
**restringir a operação exatamente à empresa solicitada**, nunca aceitar o
valor como autoridade por si só. `MANAGER`/`SELLER` continuam sem poder
ampliar o próprio acesso enviando outra empresa: a validação
(`require_company_access`, §7.4) checa a membership real deles, então um
valor forjado simplesmente falha — não amplia nada.

| Critério | Avaliação |
|---|---|
| Segurança | Boa, com a ressalva acima — depende inteiramente do servidor nunca pular a validação; nenhuma RPC devolve dado nem executa escrita antes de `require_company_access` resolver com sucesso |
| Impacto nas RPCs | Baixo — 7 das 9 RPCs de M1-E já recebem `p_lead_id` e não precisam de parâmetro novo (§15.2); só 2 ganham `p_target_company_id` opcional |
| Impacto nos SELECTs | RLS troca o predicado de `company_id = current_profile_company_id()` para `can_access_company(company_id)` — mesma forma, sem parâmetro extra na query (o predicado lê a própria linha) |
| Auditoria | Cada `audit_log` grava a empresa alvo **da chamada específica**, não uma "empresa atual" ambígua — mais preciso que a Revisão 1, não menos |
| Cache | Cada operação carrega sua própria empresa alvo — não há estado de cache a invalidar por causa do contexto administrativo em si (§7.7) |
| Risco de adulteração | Mitigado por validação server-side em toda chamada, nunca por confiança no valor recebido |
| Simplicidade | Marginalmente mais verboso (parâmetro extra em 2 RPCs, coluna extra de contexto na UI) — custo pequeno e localizado |

**Adotada.**

**C. Contexto por sessão** (isolar por aba/dispositivo dentro do próprio
Supabase)

Avaliada e **rejeitada por não ser tecnicamente confiável** com a
arquitetura atual (Next.js + Supabase Auth via `@supabase/supabase-js` no
navegador):

- O JWT do Supabase Auth é **por login, não por aba** — todas as abas do
  mesmo navegador com o mesmo usuário compartilham a mesma sessão/token
  (mesmo `localStorage` de auth, na configuração padrão do SDK). Não há
  como duas abas do mesmo login carregarem dois JWTs distintos sem
  reimplementar o armazenamento de sessão do zero.
- Alterar `app_metadata`/claims do JWT a cada troca de empresa exigiria
  reemitir o token a cada clique (custo de rede e latência), e ainda assim
  não resolveria abas **já abertas** com o token antigo em memória —
  voltaria a ter duas fontes de verdade divergentes, só que dentro do
  próprio JWT.
- Uma conexão PostgreSQL persistente por aba do navegador (o que daria um
  contexto de sessão de banco realmente isolado, via `SET
  LOCAL`/`set_config`) não existe nesta arquitetura — o Supabase expõe
  PostgREST/RPC por HTTP sem conexão persistente do navegador ao Postgres.
- `localStorage` como diferenciador por aba também não funciona —
  `localStorage` é compartilhado entre todas as abas da mesma origem no
  mesmo navegador (diferente de `sessionStorage`, que é por aba mas
  também não resolve o caso "dois dispositivos").

**Rejeitada.**

**D. RLS global para Super Admin + filtro explícito na aplicação**

Avaliada como **complementar à Opção B**, não como alternativa
substituta:

- É segura contra escalada porque o Super Admin já é global — a RLS pode
  legitimamente permitir leitura de qualquer empresa ativa para quem tem
  `platform_role = 'super_admin'`.
- Risco reconhecido: uma consulta **sem filtro** de `company_id` pode
  retornar dados de todas as empresas de uma vez — não é uma falha de
  segurança (o Super Admin está autorizado a ver tudo), mas é um risco de
  **correção de produto** (a tela mostraria dados misturados de várias
  empresas).
- Aceitável para telas verdadeiramente globais (§7.8) — lista de empresas,
  auditoria global.
- Para telas operacionais (Kanban, listas de leads/tarefas/vendas), a
  defesa recomendada é dupla: RLS permite globalmente **e** a aplicação
  sempre filtra explicitamente (`.eq('company_id', selectedCompanyId)`),
  reforçada por RPCs parametrizadas para escrita (Opção B). A ausência do
  filtro em uma tela operacional é bug de aplicação a ser pego em teste de
  integração (§17), não uma falha de isolamento entre empresas.

### 7.4 Solução escolhida — helpers

Nenhum estado mutável compartilhado. `MANAGER`/`SELLER` continuam
derivando a empresa da própria membership (idêntico à Revisão 1); Super
Admin informa a empresa alvo em cada operação, sempre validada:

```sql
-- current_membership_company_id(): empresa da membership ativa do
-- chamador. Só relevante para MANAGER/SELLER — Super Admin nunca tem
-- membership (§4.2, §6.2), então recebe NULL aqui, por design.
create function public.current_membership_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select cm.company_id from public.company_memberships cm
  where cm.profile_id = auth.uid() and cm.is_active
  limit 1;
$$;

create function public.is_platform_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.platform_role = 'super_admin' from public.profiles p
     where p.id = auth.uid() and p.is_active),
    false
  );
$$;

-- can_access_company(): leitura pura, nunca falha alto — TRUE se o
-- profile autenticado pode operar na empresa informada, seja porque é
-- Super Admin e a empresa não está cancelada, seja porque tem membership
-- ativa naquela empresa específica. A checagem é sempre contra o estado
-- REAL do chamador (profiles/company_memberships), nunca contra o valor
-- de p_target_company_id em si — é isso que impede um Manager de escalar
-- privilégio só por enviar outro id.
create function public.can_access_company(p_target_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      public.is_platform_super_admin()
      and exists (
        select 1 from public.companies c
        where c.id = p_target_company_id and c.status <> 'cancelada'
      )
    )
    or exists (
      select 1 from public.company_memberships cm
      where cm.profile_id = auth.uid()
        and cm.company_id = p_target_company_id
        and cm.is_active
    ),
    false
  );
$$;

-- require_company_access(): mesma checagem, mas falha alto — usada dentro
-- de RPCs de escrita para encadear "valide e devolva a empresa" numa
-- única expressão.
create function public.require_company_access(p_target_company_id uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target_company_id is null or not public.can_access_company(p_target_company_id) then
    raise exception 'forbidden';
  end if;
  return p_target_company_id;
end;
$$;

-- is_manager_or_platform(): substitui is_manager_or_admin(), agora
-- avaliada POR EMPRESA (nunca contra um "contexto atual" implícito) —
-- pode ser chamada tanto com a company_id de uma LINHA (dentro de uma
-- policy de RLS) quanto com a empresa já validada por
-- require_company_access() (dentro de uma RPC).
create function public.is_manager_or_platform(p_target_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_super_admin()
    or coalesce(
      exists (
        select 1 from public.company_memberships cm
        where cm.profile_id = auth.uid()
          and cm.company_id = p_target_company_id
          and cm.role = 'manager'
          and cm.is_active
      ),
      false
    );
$$;

-- current_profile_seller_id(): agora recebe a empresa alvo explicitamente
-- — nada de resolução implícita de "qual é a empresa atual". Resolve via
-- sellers.membership_id (§6.3). Super Admin recebe sempre NULL.
create function public.current_profile_seller_id(p_target_company_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.id from public.sellers s
  join public.company_memberships cm on cm.id = s.membership_id
  where cm.profile_id = auth.uid()
    and cm.company_id = p_target_company_id
    and cm.is_active
    and s.is_active;
$$;
```

Ponto central: **nenhum desses helpers lê um "contexto atual" implícito**.
`current_membership_company_id()` não tem parâmetro porque
`MANAGER`/`SELLER` têm no máximo uma empresa possível (a própria
membership) — não há ambiguidade a resolver. Todo o resto que envolve
Super Admin exige a empresa explicitamente, em todo ponto de entrada.

Uma policy de RLS típica (`leads`, por exemplo) passa a ler, no lugar de
`company_id = current_profile_company_id()`:

```sql
using ( public.can_access_company(company_id) and ( ... ) )
```

— o predicado é avaliado **por linha**, então uma única query sem filtro
de `.eq('company_id', ...)` já respeita corretamente o acesso de cada
linha individualmente (Super Admin vê linhas de qualquer empresa ativa;
`MANAGER`/`SELLER` só as da própria). O filtro explícito na aplicação
(Opção D, §7.3) continua recomendado por correção de produto, não por
segurança — a segurança já está garantida pela RLS linha a linha.

### 7.5 `selectedCompanyId` — papel na UI e no `localStorage`

- `selectedCompanyId` é **estado de UI**, guardado no React da aplicação
  (por instância de aba/navegador — cada aba já tem sua própria árvore de
  componentes e seu próprio `QueryClient` em memória, então já é
  naturalmente isolado por aba sem nenhum código extra).
- Alimenta a query key de tudo que é lido (`['company', selectedCompanyId,
  'leads']`, mesmo padrão de `leadQueryKeys` já existente) e é enviado
  explicitamente em toda mutação (`p_target_company_id`, ou implicitamente
  via `p_lead_id` nas 7 RPCs que derivam a empresa da entidade, §15.2).
- **Nunca é autoridade de acesso.** Nenhuma RLS, nenhuma RPC lê
  `selectedCompanyId` — ele só existe no cliente; o servidor sempre revalida
  contra `company_memberships`/`platform_role` (§7.4).
- `localStorage` pode lembrar a **última empresa vista**, só como
  conveniência de UI para pré-selecionar no próximo login — nunca como
  prova de acesso. Ver §7.6 para a validação obrigatória ao reabrir.

### 7.6 Validação ao selecionar/reabrir uma empresa

```
1. UI lê a última empresa vista (state em memória ou, na ausência,
   localStorage como sugestão).
2. Antes de qualquer query de dados, a UI chama can_access_company(id)
   (RPC leve, só leitura) OU tenta a primeira query já sabendo que RLS
   nega linhas fora do acesso — qualquer uma das duas é segura; a
   primeira dá feedback mais rápido e explícito à UI.
3. Se negado (empresa cancelada, membership perdida, ou o id não existe
   mais): volta para o estado "nenhuma empresa selecionada" — NUNCA
   dispara a query de dados com um id não validado.
4. Só com acesso confirmado a UI passa a montar queries/mutations com
   aquele companyId.
```

Nenhuma consulta de dados é feita antes da validação — é o oposto do
comportamento da Revisão 1, em que `effective_company_id()` era resolvido
implicitamente a cada chamada sem um passo de confirmação explícito no
cliente.

### 7.7 Concorrência entre abas, dispositivos e sessões

| Cenário | Comportamento com a solução adotada |
|---|---|
| Duas abas do mesmo Super Admin, cada uma com uma empresa diferente selecionada | Cada aba tem seu próprio `selectedCompanyId` em memória (React state) e seu próprio `QueryClient` — não compartilham nada entre si. Uma operação disparada na Aba A carrega a empresa da Aba A (via `p_target_company_id` ou via `p_lead_id` de um lead daquela empresa); o servidor valida contra a autorização real do Super Admin, não contra nenhum estado global. A Aba B nunca é afetada |
| Dois dispositivos (ex.: notebook e celular) logados como o mesmo Super Admin | Mesmo caso acima — cada dispositivo é um processo de UI independente com seu próprio estado de UI; não há registro compartilhado a sobrescrever |
| Duas sessões simultâneas (dois logins independentes do mesmo usuário) | Idem — sessões distintas não compartilham `selectedCompanyId`; o JWT de cada sessão identifica o mesmo `auth.uid()`, mas a empresa alvo vem sempre da chamada, nunca da sessão |
| Tarefas em paralelo para empresas diferentes (ex.: criar lead na Empresa A enquanto revisa auditoria da Empresa B) | Cada chamada carrega sua própria empresa alvo — não há ordem de "última seleção vence"; as duas operações são independentes e corretas simultaneamente |
| Cenário do §7.2 (a Aba A executa uma ação depois que a Aba B trocou de empresa) | Deixa de existir — não há mais uma linha compartilhada para a Aba B sobrescrever. A ação da Aba A carrega a empresa da Aba A em todos os casos |
| Resposta atrasada de uma query/mutation iniciada antes de uma troca de empresa **na mesma aba** | Coberto pela geração de cache do M1-D (`bumpQueryCacheGeneration`/`resetQueryCache`, já usada por `remoteSnapshot`/`bridge`) — ao trocar `selectedCompanyId` dentro da mesma aba, a geração é incrementada e qualquer resposta cuja geração não bate é descartada, nunca repovoando o cache da empresa nova com dado da empresa antiga |
| Duas abas tentando a mesma escrita administrativa ao mesmo tempo (ex.: dois cliques de offboarding do mesmo vendedor) | Resolvido no nível da RPC, não no nível de UI — `FOR UPDATE`/transação única (§11) serializa; a segunda chamada opera sobre o estado já resultante da primeira, sem duplicar nem corromper |

Conclusão: o problema da Revisão 1 nunca foi "cache de frontend vazando
entre abas" (o `QueryClient` já era por aba desde M1-D) — era o
**servidor** ter uma única fonte de verdade mutável e compartilhada por
profile para "qual é a empresa agora". Removendo essa fonte compartilhada
e tornando a empresa alvo parte de cada chamada, o problema desaparece
estruturalmente, sem precisar de nenhuma coordenação entre abas.

### 7.8 Telas globais vs. telas que exigem empresa alvo

| Tela | Escopo |
|---|---|
| Lista de empresas, criar empresa | global — sem empresa alvo |
| Lista de todos os Super Admins | global |
| Auditoria global (todas as empresas) | global |
| Kanban de leads, visitas, propostas, vendas, tarefas, Ajustes da empresa, usuários da empresa | exige `selectedCompanyId` válido (§7.6) — telas de `MANAGER`/`SELLER` continuam idênticas, porque para eles a empresa é sempre a da própria membership, sem seleção manual |
| Painel do Super Admin sem empresa selecionada | mostra lista de empresas para escolher; nenhum módulo comercial renderiza |

### 7.9 Tabela de operações e validação de empresa alvo

| Operação | Ator | Empresa alvo | Como é validada | Como é auditada |
|---|---|---|---|---|
| Ler leads/tarefas/etc. (SELECT direto) | `MANAGER`/`SELLER` | própria membership | RLS: `can_access_company(company_id)` resolve pela membership | não audita leitura (fora do escopo de `audit_log`, §14) |
| Ler leads/tarefas/etc. (SELECT direto) | `SUPER_ADMIN` | `selectedCompanyId` da UI, aplicado via `.eq()` | RLS: `can_access_company(company_id)` autoriza qualquer empresa ativa; filtro de aplicação restringe ao alvo pretendido (§7.3, Opção D) | não audita leitura |
| `create_lead` | `MANAGER`/`SELLER` | própria membership (parâmetro omitido ou igual à própria) | `require_company_access` checa a membership real; valor divergente é negado | `company_id` = empresa resolvida; ator = `auth.uid()` |
| `create_lead` | `SUPER_ADMIN` | `p_target_company_id` obrigatório | `require_company_access(p_target_company_id)` | `company_id` = `p_target_company_id`; ator = Super Admin real |
| `update_lead`/`move_lead_to_stage`/`apply_lead_event`/`assign_lead_seller`/`archive_lead`/`unarchive_lead`/`add_lead_timeline_entry` | qualquer papel autorizado | derivada de `p_lead_id` (`select company_id from leads where id = p_lead_id`) | `require_company_access(v_lead.company_id)` | `company_id` = empresa do lead; ator real |
| `check_lead_phone_duplicate` | `MANAGER`/`SELLER` | própria membership | idem `create_lead` | não é ação de escrita — sem entrada em `audit_log` |
| `check_lead_phone_duplicate` | `SUPER_ADMIN` | `p_target_company_id` obrigatório | `require_company_access` | idem — leitura, sem auditoria |
| `create_company` | `SUPER_ADMIN` | a própria empresa nova (criada pela RPC) | `is_platform_super_admin()` | `action='company_created'`, `company_id` = a nova empresa |
| `create_invite` (Manager) | `MANAGER` | própria membership | `require_company_access` + checagem de `role_kind` permitido (§9.2) | `action='invite_sent'`, `company_id` = alvo |
| `create_invite` (Super Admin) | `SUPER_ADMIN` | `p_target_company_id` (ou `null` para `role_kind='super_admin'`) | `is_platform_super_admin()` (+ `require_company_access` quando não é convite de Super Admin) | idem |
| `offboard_seller`/`offboard_manager` | `MANAGER` ou `SUPER_ADMIN` | empresa da membership alvo do desligamento | `require_company_access(membership.company_id)` | `action='seller_offboarded'`/`'manager_offboarded'`, `company_id` = alvo, quantidade transferida |
| Suspender/reativar empresa | `SUPER_ADMIN` | `p_target_company_id` obrigatório | `is_platform_super_admin()` | `action='company_status_changed'` |

---

## 8. Criação de empresas

Fluxo: Super Admin cria empresa → sistema cria `pipeline_stages` padrão
(os 5 codes já definidos em M1-C §4.2: `new`, `qualified`,
`visit_scheduled`, `negotiation`, `closing`) → Super Admin convida o
primeiro gerente → gerente aceita e cria senha → gerente convida
vendedores.

Dados mínimos (justificativa "nenhum campo futuro sem necessidade atual"):

| Campo | Obrigatório | Motivo |
|---|---|---|
| `name` | sim | já existe |
| `trade_name` | não | já pedido no requisito, uso comercial |
| `cnpj` | não | já existe, "somente se necessário" — mantido opcional |
| `status` | sistema define `'implantacao'` no create | ver abaixo |
| `timezone` | sim, default `'America/Sao_Paulo'` | já existe (M1-C §4.5) |
| `created_by_profile_id` | sistema define, Super Admin autor | auditoria |
| `created_at` | sistema | já existe |
| `plan` | **não criado** | fora de escopo (§8 do requisito) |

Estados de empresa e efeito no acesso:

| Status | Efeito |
|---|---|
| `implantacao` | empresa existe, dados preservados, uso normal liberado — é o estado inicial enquanto KAPA configura e convida o primeiro gerente |
| `ativa` | uso normal |
| `suspensa` | `can_access_company()`/`require_company_access()` continuam resolvendo `true` para Super Admin (para não quebrar suporte/auditoria/histórico — §7.4), mas negam para `MANAGER`/`SELLER` cuja empresa não está `ativa`/`implantacao` (checagem de `companies.status` embutida no mesmo helper, não repetida em cada policy). Dados 100% preservados, nada é apagado |
| `cancelada` | mesmo efeito de `suspensa` para `MANAGER`/`SELLER`; `can_access_company()` também passa a negar para Super Admin (§7.4 — `status <> 'cancelada'` é parte da própria checagem), então nenhuma operação (leitura ou escrita) atravessa mais a RLS/RPC operacional para essa empresa, nem para Super Admin; dados preservados indefinidamente (nenhuma exclusão física prevista neste documento). Acesso forense a empresa cancelada (auditoria pontual, não operação normal) não é resolvido neste documento — se vier a ser necessário, é uma RPC/relatório separado, restrito a `is_platform_super_admin()` sem passar por `can_access_company()`, fora do escopo desta etapa |

A checagem de status entra no mesmo ponto único —
`can_access_company()`/`require_company_access()` (§7.4) — sem reescrever
cada policy individualmente.

---

## 9. Convites por e-mail

### 9.1 Fluxo

1. Quem convida informa nome, e-mail, função e empresa (empresa é implícita
   quando quem convida é `MANAGER` — sempre a própria).
2. Sistema cria linha em `invites` (`status='pending'`, `token_hash`,
   `expires_at`), e dispara envio de e-mail com link contendo o token em
   texto plano (só existe em texto plano no e-mail e na URL — nunca
   persistido; o banco guarda só o hash).
3. Convidado abre o link, valida o token (RPC pública restrita, sem
   autenticação prévia — precisa existir para alguém que ainda não tem
   conta).
4. Convidado define a própria senha via **Supabase Auth** diretamente
   (fluxo padrão de `signUp`/definição de senha do GoTrue) — a senha nunca
   passa pelo backend da aplicação em texto plano além do que o próprio
   SDK do Supabase já processa no navegador do convidado.
5. Conta ativada: uma RPC de "aceitar convite" cria `profiles` (se não
   existir) e a `company_memberships` correspondente, marca o convite como
   `accepted`.

### 9.2 Quem pode convidar quem

| Quem convida | Pode convidar |
|---|---|
| `SUPER_ADMIN` | `SUPER_ADMIN`, `MANAGER` (qualquer empresa), `SELLER` (qualquer empresa) |
| `MANAGER` | `SELLER`, somente da própria empresa (`current_membership_company_id()`) |
| `SELLER` | ninguém |

Regra de negação explícita: `MANAGER` tentando `role_kind IN
('super_admin','manager')` ou informando qualquer empresa diferente da
própria recebe `forbidden` na RPC (`require_company_access` nega, porque a
membership real do `MANAGER` não corresponde ao valor enviado) — nunca é
uma checagem só de UI.

### 9.3 Regras de ciclo do convite

| Caso | Comportamento |
|---|---|
| Prazo de expiração | `expires_at`, sugestão 7 dias; convite expirado não pode ser aceito, RPC de aceite falha com `invite_expired` |
| Uso único | `status='accepted'` trava o convite; token reapresentado recebe `invite_already_used` |
| Reenvio | cria novo convite com novo token; o antigo vira `status='superseded'` — nunca apagado (auditoria), nunca reativado |
| E-mail já cadastrado (na mesma empresa) | RPC recusa com `already_member`, não cria convite duplicado pendente para o mesmo e-mail+empresa |
| E-mail convidado para empresa errada | não existe "errada" automaticamente — é responsabilidade de quem convida; a correção é cancelar o convite (`status='canceled'`) e criar um novo, nunca editar o convite existente |
| Usuário existente convidado para outra empresa | permitido apenas para `SUPER_ADMIN` convidar; ao aceitar, uma nova `company_memberships` é criada para o `profile_id` já existente — sujeito à constraint de "1 membership ativa" (§6.2) até multiempresa-por-pessoa ser um requisito real; se a constraint estiver ativa, a RPC de aceite recusa com `member_single_company_limit` |
| Convite cancelado | `status='canceled'`, link para de funcionar, nunca apagado |
| Usuário que nunca aceitou | fica `pending` até expirar; não bloqueia nada, é só sujeira visível na lista de convites de quem convidou |
| Alteração de e-mail | fora de escopo de convite — é edição de `profiles.email`, tratada como ação administrativa separada (S5), sempre auditada |
| Proteção contra enumeração de usuários | a RPC de "aceitar convite" nunca revela se um e-mail existe ou não fora do fluxo do próprio token; mensagens de erro genéricas ("convite inválido ou expirado") para token incorreto vs. expirado, para não permitir sondagem |
| Rate limit | limite de convites enviados por `invited_by_profile_id`/hora — implementação concreta fica para a fase de implementação (S4), citada aqui como requisito não-negociável |
| Auditoria | toda transição de `invites` gera entrada em `audit_log` (§14) |

### 9.4 Onde a operação administrativa segura roda

**Nunca no navegador, nunca com `service_role` no cliente.** As opções
compatíveis com Next.js + Supabase, na ordem de preferência para este
projeto:

1. **Route handler / server action do Next.js** chamando o Supabase Admin
   API (`service_role`) **só no servidor** — é a opção recomendada aqui,
   porque o projeto já é Next.js e evita introduzir uma peça de
   infraestrutura nova (Edge Function separada) só para isso.
2. Alternativa equivalente: Supabase Edge Function dedicada, se um dia o
   backend deixar de rodar em Next.js server-side. Mesma garantia de
   segurança, peça de infraestrutura adicional.

Em qualquer uma das duas, a chave `service_role` só existe em variável de
ambiente do lado servidor, nunca em `NEXT_PUBLIC_*`, nunca embutida em
bundle de cliente — mesmo princípio já seguido pelo projeto para
`.env.local` (`[[memory: prefs-execucao-comandos]]` — o usuário já pediu
para nunca ler `.env.local`, reforçando que segredos não circulam fora do
servidor).

A criação de convite em si (inserir linha em `invites`) **não** precisa de
`service_role` — é uma RPC `SECURITY DEFINER` comum, como as do M1-C/M1-E,
porque não mexe em `auth.users`. Só a etapa que efetivamente cria a conta
em `auth.users` (ou dispara o e-mail via um provedor) precisa da rota
server-side com `service_role`/Admin API.

---

## 10. Ciclo de vida do usuário

### 10.1 Estados

```
invited → active → suspended → deactivated
             ↑___________|
invited → invite_expired (terminal, sem transição de volta — precisa de novo convite)
```

| Estado | Onde vive | Significado |
|---|---|---|
| `invited` | `invites.status='pending'` (não é estado do profile — profile não existe ainda) | convite enviado, aguardando aceite |
| `invite_expired` | `invites.status='expired'` | prazo estourado, sem profile criado |
| `active` | `profiles.is_active=true` **e** `company_memberships.is_active=true` (para não-Super Admin) | conta e vínculo operacionais |
| `suspended` | `company_memberships.is_active=false`, `profiles.is_active=true` | vínculo com aquela empresa suspenso; a conta em si (login) permanece, mas sem nenhuma empresa ativa a pessoa não acessa nada comercial |
| `deactivated` | `profiles.is_active=false` | conta inteira desativada — cobre saída definitiva, inclusive de KAPA |

### 10.2 Diferenças

- **Suspender**: reversível, granular por empresa (uma `company_memberships`
  específica vira inativa). A pessoa pode logar, mas sem membership ativa
  `current_membership_company_id()` retorna `null` e `can_access_company()`
  nega — não vê nada (§7.4).
- **Desativar**: `profiles.is_active=false` — reversível tecnicamente
  (é um boolean), mas tratado como decisão administrativa mais grave
  (offboarding completo, credenciais comprometidas). Bloqueia login por
  completo (mesma mecânica já existente desde M1-B/M1-C §5.1: helpers
  retornam NULL, RLS nega, e a aplicação já faz `signOut()` quando
  `_loadProfile` retorna null).
- **Remover vínculo**: apagar (ou marcar `is_active=false` — na prática o
  mesmo mecanismo de suspensão) uma `company_memberships` sem afetar o
  `profiles`. Usado quando alguém sai de uma empresa mas continua Super
  Admin ou continua tendo outra membership (multiempresa futura).
- **Excluir definitivamente**: **não existe** neste design para contas com
  histórico. `profiles` nunca é `DELETE`d fisicamente uma vez que tenha
  qualquer referência em `leads.created_by_profile_id`,
  `lead_timeline_entries.actor_profile_id`, RPCs de M1-C (`sale_create` etc.)
  — a própria política de FK `ON DELETE SET NULL (coluna)` já adotada
  desde M1-C existe exatamente para isso. Um profile sem nenhum histórico
  (convite aceito e imediatamente desfeito, por engano) poderia em teoria
  ser removido fisicamente — mas este design não cria um fluxo de exclusão
  física; `deactivated` cobre o caso operacional.

### 10.3 Casos específicos

| Caso | Comportamento |
|---|---|
| Vendedor sai | fluxo de desligamento completo (§11) — nunca simples `is_active=false` sem antes tratar leads/tarefas |
| Gerente sai | ver "último gerente" (§12); se há mais de um gerente na empresa, é suspensão/desligamento comum, sem transferência de leads (gerente não é dono de leads como seller é) |
| Funcionário da KAPA sai | `profiles.is_active=false` imediato (§13); se era o único Super Admin, bloqueado (§13) |
| Usuário troca de e-mail | ação administrativa (S5), audita valor anterior e novo em `audit_log`, não afeta `auth.users` diretamente sem o fluxo de confirmação do próprio Supabase Auth |
| Usuário muda de vendedor para gerente | dentro da mesma empresa: a `company_memberships.role` muda de `'seller'` para `'manager'`; `seller_id` permanece na linha por integridade histórica de leads antigos (leads continuam referenciando o mesmo `seller_id` — a pessoa não "vira outra"); auditado como `membership_role_changed` |
| Gerente volta a ser vendedor | mesmo mecanismo inverso; exige que não seja o último gerente ativo da empresa no momento da troca (mesma regra de §12) |
| Conta comprometida | `profiles.is_active=false` imediato por qualquer Super Admin (ou pelo próprio manager, se for uma conta da própria empresa); revogação de sessão via Supabase Auth (invalidar refresh tokens) tratada no mesmo fluxo — S5 |
| Convite enviado para pessoa errada | `invites.status='canceled'` antes do aceite; se já aceito por engano, é tratado como offboarding imediato (`deactivated` + desligamento, §11), não como "desfazer convite" |
| Usuário pertence a mais de uma empresa (futuro) | fora de escopo de implementação agora; schema já suporta (§6.2), só a constraint parcial de 1-membership-ativa precisa ser removida quando o produto decidir suportar |

---

## 11. Saída de vendedor e transferência

Fluxo transacional (uma única RPC `SECURITY DEFINER`, uma única transação,
tudo ou nada):

```
offboard_seller(p_seller_membership_id, p_successor_seller_id | null, p_note)
```

1. Resolver a empresa a partir da própria `p_seller_membership_id`
   (`select company_id from company_memberships where id =
   p_seller_membership_id`) e validar o chamador com
   `require_company_access(v_company_id)` (§7.4) — mesmo padrão das 7 RPCs
   de leads que derivam a empresa por `lead_id` (§15.2): nenhum parâmetro
   de empresa a mais, nenhuma confiança em estado implícito.
2. Suspender novos acessos: `company_memberships.is_active = false` para o
   vendedor — feito **primeiro**, dentro da mesma transação, então mesmo
   que o restante falhe e a transação seja revertida, o suspenso permanece
   suspenso (nota: como é uma única transação, um `ROLLBACK` desfaz tudo
   igualmente — a ordem importa para leitura do código, não para atomicidade,
   que é garantida pela transação como um todo).
3. `SELECT ... FOR UPDATE` de todos os leads ativos (`archived_at is null`)
   com `seller_id` = o do vendedor saindo — trava as linhas antes de decidir
   o que fazer com elas, prevenindo duas transferências concorrentes do
   mesmo vendedor (§11, item "duas pessoas tentando transferir
   simultaneamente").
4. Se `p_successor_seller_id` informado: `UPDATE leads SET seller_id =
   p_successor_seller_id` para todos os leads ativos travados. Se não
   informado: leads ficam com `seller_id = null` (permitido — já é o
   comportamento hoje de "lead sem vendedor", §1 do M1-E).
5. Tarefas abertas (`tasks.assigned_to`) seguem a mesma regra do passo 4.
6. Negociações (`deals`) e visitas (`visits`) **abertas** (status não
   terminal) seguem a mesma regra — reatribuídas ao sucessor ou ficam sem
   `seller_id`, nunca apagadas.
7. Vendas (`sales`) e negociações/visitas já concluídas/canceladas **não
   são tocadas** — preservam `seller_id` original como autoria histórica
   (mesmo princípio de M1-C: `RESTRICT` em `sellers`, nunca apagar).
8. Concluir: se o vendedor desligado também era `MANAGER` em outra
   membership (raro, mas possível estruturalmente), essa outra membership
   não é afetada por este fluxo — desligamento de seller e desligamento de
   manager são RPCs diferentes (§12).
9. Gravar `audit_log`: ação `seller_offboarded`, quantidade de leads/tarefas/
   deals/visits transferidos, sucessor (ou "sem sucessor"), autor real.

### 11.1 Casos de borda

| Caso | Comportamento |
|---|---|
| Vendedor sem substituto | permitido — passo 4/5/6 setam `null`; UI deve avisar mas não bloquear, espelhando o comportamento já existente de leads sem vendedor |
| Múltiplos vendedores de destino (divisão dos leads) | fora do escopo desta RPC única — se o produto quiser divisão manual lead-a-lead, isso é feito **antes** do offboarding via `assign_lead_seller` normal (já existe, M1-E §6.5) enquanto o vendedor original ainda está ativo, ou como uma ferramenta futura de "distribuir N leads entre M vendedores"; a RPC de offboarding em si só suporta um sucessor único ou nenhum, para manter a operação simples e auditável |
| Leads arquivados | não são tocados — permanecem com o `seller_id` original, são histórico |
| Tarefas vencidas | tratadas igual a qualquer tarefa aberta (passo 5) — vencida não é um estado diferente de "aberta" para este fluxo |
| Negociações abertas | passo 6 |
| Registros já vendidos | passo 7, preservados |
| Vendedor que também é gerente | offboarding de seller não desliga a membership de manager; são ações independentes, cada uma auditada separadamente |
| Vendedor suspenso no meio do processo | não pode acontecer por definição — o passo 2 suspende antes de qualquer transferência, e tudo roda em uma única transação; não há "meio do processo" observável de fora |
| Duas pessoas tentando transferir simultaneamente | `SELECT ... FOR UPDATE` no passo 3 serializa — a segunda chamada bloqueia até a primeira commitar; ao continuar, ela relê o estado (agora já sem leads elegíveis, porque a primeira já moveu tudo) e efetivamente vira no-op sobre o que sobrou, sem erro nem duplicação |
| Falha durante transferência | `ROLLBACK` da transação inteira — nada é aplicado parcialmente; a RPC não retorna sucesso parcial |

Não apagar `sellers` nem `profiles` em nenhum ponto deste fluxo — é
inteiramente reatribuição/soft-suspend.

---

## 12. Saída de gerente

Regra recomendada: **impedir suspensão/desligamento do único `MANAGER`
ativo de uma empresa sem indicar substituto na mesma operação.**

```
offboard_manager(p_manager_membership_id, p_successor_profile_id | null, p_note)
```

- Se existir outro `MANAGER` ativo na mesma empresa: `p_successor_profile_id`
  é opcional; a RPC suspende a membership normalmente.
- Se for o **único** `MANAGER` ativo: `p_successor_profile_id` é
  **obrigatório** e precisa referenciar uma membership de `MANAGER` já
  ativa na mesma empresa (ou seja: promover um vendedor a gerente é uma
  operação separada e anterior — §10.3 "usuário muda de vendedor para
  gerente" —, não algo que este offboarding faz implicitamente). Sem isso,
  a RPC recusa com `last_manager_requires_successor`.
- `SELLER` **nunca** vira `MANAGER` automaticamente — precisa de uma ação
  explícita e auditada de promoção antes, feita por outro `MANAGER` da
  mesma empresa ou por Super Admin.
- Toda essa mudança (promoção prévia + offboarding do gerente antigo)
  gera entradas de `audit_log` separadas e ligadas pelo mesmo `company_id`.
- Este é o comportamento mais seguro porque nunca deixa uma empresa sem
  responsável administrativo ativo, sem exigir que o produto invente um
  "gerente fantasma" ou volte a depender só de Super Admin para toda
  operação do dia a dia daquela empresa.

---

## 13. Super Admins da KAPA

- **Primeiro Super Admin**: criado fora do fluxo de convite normal — é um
  bootstrap único, operação de operador (mesma categoria de "seed manual"
  já usada em M1-B para os primeiros dados), não uma RPC exposta ao
  produto. Documentado aqui como decisão, sem procedimento de execução
  (isso é implementação, S1/S4).
- **Outros Super Admins**: convidados por um Super Admin existente, mesmo
  fluxo de §9, com `role_kind='super_admin'` e `company_id=null`.
- **Quem pode promover**: só Super Admin convida Super Admin — nunca
  `MANAGER`, nunca uma promoção "silenciosa" de conta existente sem passar
  pelo fluxo de convite auditado.
- **Confirmação adicional**: recomendado exigir reautenticação (senha ou
  2FA, quando existir) imediatamente antes de qualquer convite de novo
  Super Admin ou de suspensão de outro Super Admin — ação de alto
  privilégio, não implementado agora, registrado como requisito para S4/S6.
- **Proibição de o último Super Admin se desativar**: mesma lógica de §12 —
  `deactivate_profile`/`suspend` para um `platform_role='super_admin'`
  falha com `last_super_admin_cannot_be_removed` se for o único
  `platform_role='super_admin'` com `is_active=true` no sistema.
- **Suspensão imediata ao sair da KAPA**: `profiles.is_active=false`,
  mesma mecânica de qualquer desativação (§10.2) — sem necessidade de
  mecanismo extra, porque já corta todo acesso (RLS nega, sessão viva
  também para de enxergar linhas).
- **Auditoria global**: toda ação de Super Admin passa por `audit_log`
  com `company_id` afetado quando aplicável, e sem exceção nenhuma para
  ações "internas" — nada de bypass de log para KAPA.
- **2FA**: não implementado agora; registrado como requisito futuro
  obrigatório antes do primeiro cliente pagante real (recomendação, não
  bloqueio deste design).
- **Sessões ativas / revogação**: revogar acesso de um Super Admin
  desativado deve invalidar sessões vivas — usar a API de revogação de
  refresh tokens do Supabase Auth no mesmo route handler/Edge Function que
  desativa o profile (S6), não apenas depender de RLS negar na próxima
  requisição (RLS já cobre isso por padrão, a revogação ativa é reforço
  operacional, não é a única camada).
- **Menor privilégio**: reforça a recomendação de §13.3 abaixo — nem todo
  funcionário da KAPA precisa ser Super Admin com acesso irrestrito.

### 13.3 Papel único vs. papéis diferenciados na KAPA

Recomendação: **manter `SUPER_ADMIN` único por enquanto.** O time da KAPA
hoje é pequeno o suficiente para não justificar o custo de projetar e
manter quatro papéis de plataforma (`PLATFORM_OWNER`, `PLATFORM_ADMIN`,
`PLATFORM_SUPPORT`, `PLATFORM_ANALYST`) sem um caso de uso concreto e
atual que exija diferenciação (por exemplo, alguém que só deveria ver
métricas sem poder suspender empresas). A decisão de modelar
`platform_role` como enum (§5.1), em vez de um boolean solto, é
exatamente o que permite adicionar esses papéis depois **sem migração
estrutural** — só `ALTER TYPE ... ADD VALUE` e novas checagens nos
helpers. Registrado como recomendação para reavaliar quando o time KAPA
crescer ou quando surgir a primeira necessidade real de privilégio
reduzido (ex.: um analista de dados que só deveria ler `audit_log`/
métricas agregadas).

---

## 14. Auditoria

### 14.1 Tabela `audit_log`

```
audit_log
  id                  uuid primary key default gen_random_uuid()
  actor_profile_id    uuid references profiles(id) on delete set null   -- autor REAL, nunca a identidade "efetiva"
  company_id          uuid references companies(id) on delete set null  -- empresa afetada; null para ações de plataforma (ex.: criar empresa)
  action              text not null            -- ver catálogo abaixo
  entity_type         text not null            -- 'company' | 'invite' | 'membership' | 'profile' | 'lead' | ...
  entity_id           text                     -- id da entidade afetada (text para acomodar uuid e ids legados)
  occurred_at         timestamptz not null default now()
  result              text not null            -- 'success' | 'failure'
  reason              text                     -- opcional, motivo informado por quem executou
  before_data         jsonb                    -- estado anterior, SÓ campos seguros (nunca senha/token)
  after_data          jsonb                    -- estado novo, mesma restrição
  origin              text                     -- 'web_app' | 'invite_accept' | 'system', etc.
```

Regra inegociável: **nunca** grava senha, token de convite em texto plano,
nem qualquer segredo — `before_data`/`after_data` são preenchidos por uma
lista explícita de colunas permitidas por tipo de entidade, nunca um
`row_to_json` genérico da linha inteira (que poderia acidentalmente incluir
uma coluna sensível futura).

Escrita **somente** por RPCs `SECURITY DEFINER` (as mesmas RPCs
administrativas de §8–§13) — nunca INSERT direto do cliente, mesmo padrão
de "zero grants de escrita direta" já usado em toda tabela comercial desde
M1-C.

### 14.2 Catálogo mínimo de ações

`company_created`, `company_status_changed`, `invite_sent`,
`invite_resent`, `invite_canceled`, `invite_accepted`, `invite_expired`
(gravado por job/consulta, não por ação humana), `user_activated`,
`user_suspended`, `user_deactivated`, `membership_role_changed`,
`seller_offboarded`, `manager_offboarded`, `leads_transferred`,
`super_admin_promoted`, `super_admin_removed`, `company_status_changed`
(suspensão/reativação de empresa), `settings_changed`.

Não existe ação `super_admin_entered_company`/"selecionar empresa" — na
Revisão 2 (§7) selecionar uma empresa na UI não é mais uma operação
privilegiada de servidor (não escreve nada), é só estado de interface;
cada ação administrativa real já grava sua própria empresa alvo (§7.9),
o que é auditoria mais precisa do que um evento de "entrada" separado.

### 14.3 Retenção e acesso

- Retenção: indefinida por padrão (é o mesmo padrão já adotado para
  histórico comercial — "contas com histórico não devem ser apagadas
  definitivamente" se aplica igualmente a log administrativo). Uma política
  de arquivamento/expurgo pode ser definida depois, fora deste design.
- Acesso: leitura de `audit_log` de uma empresa é permitida a `MANAGER`
  da própria empresa (só linhas com aquele `company_id`) e a `SUPER_ADMIN`
  (qualquer linha). `SELLER` nunca lê `audit_log`. RLS segue o mesmo
  padrão de `public.can_access_company(company_id)` (§7.4) — nenhuma
  policy nova de exceção; Super Admin já está coberto pelo mesmo helper
  usado em toda a base.

---

## 15. Impacto no M1-E (detalhado)

### 15.1 O que permanece exatamente como está

- Schema de `public.leads` e `public.lead_timeline_entries` (M1-E §2, §3) —
  nenhuma coluna nova, nenhuma FK composta nova. `company_id` continua
  sendo a partição correta; o que muda é só **como** a empresa alvo do
  chamador é obtida e validada.
- Para `MANAGER`/`SELLER`, o comportamento observável das 9 RPCs é
  **idêntico ao de hoje** — mesma assinatura na prática (parâmetro novo
  opcional, nunca obrigatório para eles), mesmo contrato de erro, mesma
  matriz de visibilidade (§1 do M1-E: manager vê tudo da empresa, seller
  vê só o próprio). `ADMIN` é lido como `MANAGER` (§5.4).
- `LeadService`, `remoteSnapshot`/`bridge`, query keys (`leadQueryKeys`),
  `useLeads` — nenhuma mudança de forma; continuam recebendo `companyId`
  como partição de cache. A diferença é que esse `companyId` passa a vir
  do `selectedCompanyId` da UI (§7.5) para Super Admin, e da membership
  para `MANAGER`/`SELLER`, nunca de uma leitura implícita de servidor.

### 15.2 As 9 RPCs, uma a uma

Princípio adotado (§7.3, Opção B): **não duplicar as 9 RPCs**, e **não**
esconder a empresa alvo em estado global. Sete delas já recebem
`p_lead_id` — a empresa é derivada do próprio lead (`select company_id
from public.leads where id = p_lead_id`, sem filtrar por empresa
conhecida ainda) e só depois validada com `require_company_access()`. Só
as duas RPCs sem entidade de partida ganham um parâmetro novo.

| RPC | Mantém contrato p/ Manager/Seller | `p_target_company_id` | Deriva empresa por `lead_id`? | Impede UUID de outra empresa | Audita empresa alvo |
|---|---|---|---|---|---|
| `create_lead` | Sim — parâmetro omitido = comportamento atual | **Novo, opcional; obrigatório para Super Admin** | Não (não há entidade prévia) | N/A (empresa é o próprio alvo, validado por `require_company_access`) | Sim — `company_id` resolvido |
| `update_lead` | Sim, inalterado | Não precisa | **Sim** — busca o lead por `id`, resolve `company_id`, valida | Sim — `require_company_access(v_lead.company_id)` nega lead de empresa sem acesso | Sim — `company_id` do lead |
| `move_lead_to_stage` | Sim, inalterado | Não precisa | Sim | Sim (idem) — e o `stage_id` também é validado contra a mesma empresa resolvida | Sim |
| `apply_lead_event` | Sim, inalterado | Não precisa | Sim | Sim (idem) | Sim |
| `assign_lead_seller` | Sim, inalterado | Não precisa | Sim | Sim — `p_seller_id` validado contra a MESMA empresa resolvida do lead, não contra o parâmetro | Sim |
| `archive_lead` | Sim, inalterado | Não precisa | Sim | Sim (idem) | Sim |
| `unarchive_lead` | Sim, inalterado | Não precisa | Sim | Sim (idem) | Sim |
| `add_lead_timeline_entry` | Sim, inalterado | Não precisa | Sim | Sim (idem) | Não é ação administrativa — timeline comercial já tem seu próprio rastro (`actor_profile_id`); não duplica em `audit_log` |
| `check_lead_phone_duplicate` | Sim — parâmetro omitido = comportamento atual | **Novo, opcional; obrigatório para Super Admin** | Não (busca é company-wide, não por lead) | N/A | Não é ação de escrita — sem entrada em `audit_log` |

Nuance de erro deliberada: quando `MANAGER`/`SELLER` tenta operar um lead
de outra empresa (por engano ou tentativa de sondagem), o erro permanece
`lead_not_found` — não revela que o lead existe em outra empresa. Quando
**Super Admin** informa um `p_target_company_id`/lead cuja empresa não
está mais acessível (cancelada, por exemplo), o erro é `forbidden` — a
distinção entre "não existe" e "existe mas negado" só é aceitável para
quem já é global por natureza.

### 15.3 Helpers — o que muda de nome e por quê

| Item antigo | Item novo | Adaptação |
|---|---|---|
| `current_profile_company_id()` | `current_membership_company_id()` (Manager/Seller) + `require_company_access()`/`can_access_company()` (validação explícita) | Não é uma troca 1-para-1 de nome — é uma troca de **modelo**: não existe mais "a empresa atual" resolvida sem parâmetro para todo mundo; `MANAGER`/`SELLER` continuam com resolução implícita (a própria membership), Super Admin sempre valida uma empresa explícita (§7.4) |
| `current_profile_seller_id()` | `current_profile_seller_id(p_target_company_id)` | Ganha parâmetro — resolve via `sellers.membership_id` (§6.3); Super Admin sempre `null` |
| `is_manager_or_admin()` | `is_manager_or_platform(p_target_company_id)` | Ganha parâmetro — avaliada por empresa, nunca contra um "contexto atual" implícito (§7.4). **Único ponto que exige tocar texto** das RPCs/policies existentes, porque muda de nome e de assinatura. Lista exata de objetos a editar: policies `leads_select`/`leads_insert`/`leads_update` (M1-E §8, herdam o padrão de M1-C §5.2), `tasks_*`, `stages_insert`/`stages_update`, e as RPCs `assign_lead_seller`, `archive_lead`, `unarchive_lead`, `deal_approve`, `deal_reject`, `sale_cancel`, `reorder_pipeline_stages` — todas já catalogadas em §2.2 |
| RPCs que liam `p.company_id, p.role, p.seller_id` direto de `profiles` | passam a ler `company_id` via `require_company_access`/derivação por `lead_id`, e `role`/`seller_id` via `company_memberships`/`sellers` | mudança de implementação interna; contrato de erro para `MANAGER`/`SELLER` não muda |
| `AuthService._loadProfile` / tipo `User` (`lib/data.ts`) | `User.companyId` deixa de ser um valor fixo por profile — vira o `selectedCompanyId` corrente da UI para Super Admin, ou a empresa da membership para `MANAGER`/`SELLER`. O **formato** do objeto `User` no frontend pode continuar igual (mesmos campos); o que muda é como/quando é populado — ponto relevante para o E4: código de tela escrito contra `User.companyId` não precisa mudar |
| `useQueryCacheIdentity` | inalterado de forma — passa a receber `selectedCompanyId` (§7.5) no lugar de um valor fixo do profile |

### 15.4 Decisões de design pedidas explicitamente (revisadas)

- **O contexto de empresa deve ser parâmetro explícito nas RPCs para Super
  Admin?** **Sim — invertendo a resposta da Revisão 1.** Receber
  `company_id` do cliente não é inseguro por si só; o erro seria confiar
  nele sem validar (§7.3, Opção B). Para `MANAGER`/`SELLER` nada muda: o
  parâmetro, quando presente, precisa bater com a própria membership real
  ou é negado — não há caminho de escalada. Para Super Admin, o parâmetro
  é obrigatório (2 RPCs) ou implícito via `lead_id` já validado (7 RPCs).
- **Deve existir helper de resolução de empresa efetiva?** Sim, mas não
  como um valor único sem parâmetro — como um par leitura/validação
  (`can_access_company`/`require_company_access`, §7.4) que sempre recebe
  a empresa a testar.
- **Deve existir função segura de validar empresa alvo?** Sim —
  `require_company_access(target_company_id)` (§7.4) é essa função,
  chamada em toda RPC administrativa e em toda RPC de negócio que precisa
  validar acesso de Super Admin.
- **Devem existir RPCs separadas para plataforma?** Sim, para ações que
  não fazem sentido para `MANAGER`/`SELLER` (criar empresa, convidar Super
  Admin, suspender empresa, ver auditoria global) — as RPCs de **negócio**
  (leads, visitas, propostas, vendas, tarefas) permanecem únicas e
  compartilhadas.
- **O Super Admin deve respeitar a mesma API dos Managers?** Sim — usa
  exatamente `create_lead`/`move_lead_to_stage`/etc., só que informando
  (ou tendo derivada de `lead_id`) a empresa alvo. A RPC sempre grava
  `updated_by_profile_id = v_profile.id`, o profile real do Super Admin
  autenticado — nunca um profile "emprestado".
- **Como evitar que `company_id` enviado pelo frontend permita escalada de
  privilégio?** Validando sempre no servidor contra a autorização real de
  quem chama (`require_company_access`), nunca aceitando o valor
  recebido como prova de acesso. Para `MANAGER`/`SELLER`, qualquer valor
  que não seja a própria membership é negado — o parâmetro não amplia
  nada, só direciona uma operação que já seria negada de qualquer forma se
  divergisse.

---

## 16. Plano de migração por etapas

| Etapa | Objetivo | Tabelas | Funções | Políticas | Frontend | Testes | Riscos | Rollback | Dependências |
|---|---|---|---|---|---|---|---|---|---|
| **S0** | Este documento — design final aprovado | — | — | — | — | — | design errado custa retrabalho em S1+ | revert do doc | nenhuma |
| **S1** | Schema de roles/memberships/empresa | `company_memberships` nova (§6.2); `profiles` perde `company_id`/`role`/`seller_id`, ganha `platform_role`; `sellers` ganha `membership_id`, perde `profile_id` (§6.3); `companies` ganha `status`/`created_by_profile_id`/`trade_name` (§6.4); migration de dados (remapeia `admin`→`manager`, cria 1 membership + linka `sellers.membership_id` por profile existente) | — | — | — | migração de dados idempotente; contagem de profiles antes/depois; nenhum profile órfão sem membership (exceto Super Admins, que não têm); nenhum `sellers` órfão de `membership_id` | migration de dados incorreta perde vínculo empresa↔pessoa | migration aditiva teria que ser revertida manualmente com script de "desfazer" — testar exaustivamente em local antes do remoto, padrão já seguido em M1-C/M1-E | nenhuma (primeira migration estrutural) |
| **S2** | Helpers de validação de empresa alvo + RLS | — | `current_membership_company_id()`, `is_platform_super_admin()`, `can_access_company()`, `require_company_access()`, `is_manager_or_platform(target)`, `current_profile_seller_id(target)` (§7.4) | policies de M1-B/M1-C/M1-E redefinidas: `company_id = current_profile_company_id()` → `can_access_company(company_id)`; `is_manager_or_admin()` → `is_manager_or_platform(company_id)` | — | reexecutar a suíte de RLS do M1-C e M1-E contra os helpers novos — comportamento para `MANAGER`/`SELLER` deve ser bit-a-bit idêntico ao anterior; teste novo: Super Admin lê múltiplas empresas sem `.eq()`, nega empresa cancelada | quebrar silenciosamente uma policy existente | reverter para os helpers antigos (nomes antigos ficam como alias temporário até S2 estar 100% validado) | S1 |
| **S3** | Criação de empresas | — (schema já entrou em S1) | `create_company()` (cria stages padrão) | RLS de `companies` usando `can_access_company` | tela mínima de lista/criação de empresas (admin da KAPA) | criar empresa cria os 5 stages padrão; `create_company` só para `is_platform_super_admin()` | — | flag `NEXT_PUBLIC_FF_PLATFORM_ADMIN` (ou equivalente) controla exposição da UI nova; desligar a flag some com a tela, dados preservados | S2 |
| **S4** | Convites | `invites` nova | `create_invite()`, `accept_invite()`, `cancel_invite()`, `resend_invite()` + route handler/Edge Function com `service_role` para criação em `auth.users` | RLS de `invites` (quem convidou vê os próprios; Super Admin vê todos) | fluxo de convite (formulário + tela de aceite pública) | expiração, uso único, reenvio invalida antigo, `forbidden` para role errado, rate limit | vazamento de e-mail existente via enumeração | flag controla exposição; convites pendentes não afetam nada em produção com flag OFF | S2, S3 |
| **S5** | Gestão de usuários | — | `update_membership_role()`, `change_email()` (fluxo Auth) | RLS de `company_memberships`/`profiles` para leitura/edição por `MANAGER`/`SUPER_ADMIN` | tela de usuários da empresa (lista, editar função) | manager não edita usuário de outra empresa; troca de role respeita "último gerente" (S6 antecipa a regra, mas a UI de troca simples pode nascer aqui) | edição de role sem checar último gerente | flag | S1, S2 |
| **S6** | Suspensão e transferência | — | `suspend_membership()` (sincroniza `sellers.is_active`, §6.3), `offboard_seller()`, `offboard_manager()`, revogação de sessão (route handler) | — | fluxo de desligamento (seleção de sucessor, confirmação) | toda a matriz de §17 relativa a offboarding; teste dedicado de sincronização `company_memberships.is_active`/`sellers.is_active` | falha no meio da transferência deixa leads sem dono | transação única — falha reverte tudo; sem rollback manual necessário | S1, S2, S5 |
| **S7** | Seletor de empresa (UI) | — | — | — | `selectedCompanyId` como estado de UI (§7.5), validado via `can_access_company` ao selecionar/reabrir (§7.6), integrado a `useQueryCacheIdentity` | troca de empresa dentro da mesma aba limpa cache e snapshot (reuso do teste de identidade do M1-D); teste novo: duas abas simuladas com empresas diferentes não interferem entre si (§7.7) | — | flag | S3; infraestrutura de identidade do M1-D (já concluída) |
| **S8** | Adaptação dos módulos (M1-E, retomada do E4) | — | RPCs de M1-E adaptadas conforme §15.2 (7 derivam empresa por `lead_id`; `create_lead`/`check_lead_phone_duplicate` ganham `p_target_company_id` opcional) | policies de M1-E redefinidas com `is_manager_or_platform(company_id)` | E4 do M1-E retomado aqui: `useCreateLead`, `useUpdateLead`, `useCheckLeadPhoneDuplicate` | suíte completa do M1-E reexecutada do zero + matriz de §15.2 (UUID de lead de outra empresa por Manager/Seller vs. por Super Admin) | regressão silenciosa em `MANAGER`/`SELLER` por causa da troca de helper | flag de leads remotos já existente (`NEXT_PUBLIC_FF_REMOTE_LEADS`) continua sendo o rollback | S2, S7 |
| **S9** | Testes e rollout | — | — | — | — | matriz completa de §17 | rollout prematuro sem 2FA/rate limit | flags OFF em produção até 100% validado | todas anteriores |

**Onde o M1-E E4 deve ser retomado: início de S8.** Não antes — porque S2
é exatamente a etapa que troca os helpers internos que `create_lead`/
`update_lead` chamam; fazer o E4 antes disso significa escrevê-lo contra
funções que vão ser redefinidas/removidas, sem ganho real (o contrato de
fora para `MANAGER`/`SELLER` não muda, mas a validação manual de §16-D do
M1-E precisaria ser refeita do zero de qualquer forma depois de S2).

---

## 17. Testes necessários

| Cenário | Cobertura |
|---|---|
| Super Admin acessa empresa A | `require_company_access(A)` sucede; leads/etc. de A visíveis via RLS `can_access_company(company_id)` |
| Super Admin acessa empresa B | `require_company_access(B)` sucede; dados de A não aparecem na query de B (partição de query key + RLS por linha) |
| **Duas abas do mesmo Super Admin, empresas A e B simultaneamente** | cada aba opera com seu `selectedCompanyId` independente; ação disparada na Aba A não é afetada por uma troca de empresa feita na Aba B (§7.7) — teste de integração simulando dois `QueryClient`/dois estados de UI no mesmo processo de teste, cada um chamando RPC com sua própria empresa alvo |
| Manager A não acessa empresa B | `require_company_access` nega qualquer empresa que não seja a da própria membership — não há RPC de seleção para não-Super Admin manipular |
| Seller A não acessa Seller B | matriz de RLS de M1-E já testada, reexecutada após S2 sem regressão |
| Troca de empresa limpa cache (mesma aba) | reuso do teste de identidade do M1-D (`useQueryCacheIdentity`/`resetQueryCache`) com `companyId` variando por `selectedCompanyId`, não só por login |
| Resposta atrasada de uma troca de empresa anterior não repopula o cache da empresa nova | geração de cache (M1-D) incrementada na troca; resposta com geração antiga é descartada, nunca aplicada ao snapshot da empresa atual (§7.7) |
| Contexto de empresa forjado é negado | Manager enviando `p_target_company_id` de outra empresa (nas 2 RPCs que aceitam o parâmetro) recebe `forbidden` de `require_company_access`; nas 7 RPCs restantes, lead de outra empresa recebe `lead_not_found` |
| SELECT sem filtro `.eq('company_id', ...)` por Super Admin retorna múltiplas empresas | comportamento esperado (Opção D, §7.3) — validado como "não é falha de segurança"; teste de integração confirma que toda tela operacional real sempre aplica o filtro (bug de aplicação, não de RLS, se faltar) |
| Manager não cria Manager | `create_invite(role_kind='manager')` por um `MANAGER` recebe `forbidden` |
| Manager não cria Super Admin | idem para `role_kind='super_admin'` |
| Manager cria Seller da própria empresa | sucesso |
| Manager não cria Seller de outra empresa | `company_id` implícito sempre a própria; parâmetro divergente é negado por `require_company_access` |
| Convite expirado | `accept_invite()` além de `expires_at` recebe `invite_expired` |
| Convite usado duas vezes | segunda chamada com o mesmo token recebe `invite_already_used` |
| Reenvio | convite antigo vira `superseded`, link antigo para de funcionar |
| Suspensão | `company_memberships.is_active=false` remove acesso imediatamente (RLS); `sellers.is_active` sincronizado na mesma transação (§6.3) |
| Vendedor desligado | leads/tarefas/deals/visits abertos movidos ou nulos conforme §11; vendas e histórico preservados com autoria original |
| Transferência total | todos os leads elegíveis movidos ao sucessor |
| Transferência parcial | leads sem sucessor ficam `seller_id=null`, nada é perdido |
| Falha durante transferência faz rollback | erro forçado no meio da RPC reverte a transação inteira, nenhum lead fica órfão de estado |
| Duas transferências simultâneas do mesmo vendedor não duplicam nem perdem atribuições | `SELECT ... FOR UPDATE` serializa (§11); segunda chamada opera sobre o que sobrou, sem erro nem duplicação |
| Último gerente não pode sair sem substituto | `offboard_manager` sem sucessor falha com `last_manager_requires_successor` quando é o único ativo |
| Último Super Admin não pode se suspender | `last_super_admin_cannot_be_removed` |
| Super Admin recupera empresa sem gerente ativo | convite de novo `MANAGER` ou promoção de `SELLER` existente, RPCs que só adicionam gerente — não passam pela guarda de "último gerente" (que só protege remoção), §12 |
| Logs de auditoria | cada ação do catálogo (§14.2) gera exatamente uma linha, com `actor_profile_id` correto e `company_id` = empresa alvo daquela chamada específica (§7.9) |
| Nenhuma senha ou token nos logs | `audit_log.before_data`/`after_data` nunca contém coluna de segredo — validado por whitelist de colunas, não por convenção |
| Snapshots nunca atravessam usuário ou empresa | reuso e extensão dos testes de `remoteSnapshot`/`bridge` do M1-E, agora também cobrindo troca de `selectedCompanyId` dentro da mesma aba (não só troca de usuário) |

---

## 18. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Migration de dados (S1) perder vínculo empresa↔pessoa | migração testada exaustivamente em local antes do remoto (mesmo padrão de M1-C/M1-E); validação de contagem antes/depois |
| Esquecer um ponto que ainda chama `is_manager_or_admin()` (nome antigo) | lista fechada e auditada nesta etapa (§2.2, §15.3); grep de `is_manager_or_admin` como gate de CI antes de aplicar S2 |
| Estado de "empresa selecionada" persistido globalmente (defeito da Revisão 1) | eliminado estruturalmente nesta revisão — não existe mais tabela/registro compartilhado por profile para isso (§7.2, §7.3); a empresa alvo é sempre parte da chamada |
| Super Admin sem empresa selecionada travando telas | tratado como estado de UI válido (§7.6), não como erro |
| `company_id` forjado pelo cliente | não amplia acesso — toda chamada é revalidada contra a autorização real de quem chama via `require_company_access`; para `MANAGER`/`SELLER` um valor divergente da própria membership é sempre negado (§7.3, §7.4) |
| Tela operacional esquecer o filtro `.eq('company_id', selectedCompanyId)` para Super Admin | não é falha de segurança (RLS já restringe corretamente por linha) — é risco de correção de produto (dados de várias empresas na mesma tela), coberto por teste de integração dedicado (§17) |
| `sellers.is_active` e `company_memberships.is_active` divergirem | ambas gravadas na mesma transação por `suspend_membership`/`offboard_seller` (§6.3); teste de integração dedicado |
| Cache/snapshot vazando entre empresas | dentro da mesma aba: infraestrutura de identidade do M1-D (geração de cache), já testada, estendida a `selectedCompanyId` (§7.7); entre abas/dispositivos: não há mecanismo compartilhado a vazar, porque não há mais estado compartilhado (§7.7) |
| Offboarding deixando dados inconsistentes | transação única, `FOR UPDATE`, sem exclusão física, comportamento idempotente documentado (§11) |
| Empresa sem gerente ativo | bloqueio estrutural na RPC de offboarding (§12); recuperação via convite/promoção pelo Super Admin, que não passa pela mesma guarda (§17) |
| Plataforma sem Super Admin | bloqueio estrutural (§13) |
| Retrabalho do E4 se implementado antes de S8 | decisão explícita de pausa (§2.3, §16) |
| Escopo crescer para cobrança/planos antes da hora | explicitamente fora de escopo (§8), citado para não ser reintroduzido por acidente numa fase futura |
| 2FA/rate limit não implementados nesta fase | registrados como requisito para S4/S6, não bloqueiam o design, mas bloqueiam o rollout de produção real (S9) |

---

## 19. Decisões finais (síntese exigida em §18 do prompt)

1. **Papéis definitivos**: `SUPER_ADMIN` (global, plataforma), `MANAGER`
   (uma empresa), `SELLER` (uma empresa, escopo próprio). `ADMIN` atual é
   absorvido por `MANAGER` (§5.4) — não sobrevive como papel distinto.
2. **Estrutura**: `profiles` (identidade + `platform_role` opcional) +
   `company_memberships` (vínculo empresa/role, N por profile, limitado a
   1 ativa por ora) + `sellers` (referenciando `membership_id`, não mais
   `profile_id`) + `companies` (com `status`) — Opção C (§4.2, §6.3).
3. **Empresa alvo do Super Admin (revisado)**: **sem estado persistido no
   servidor.** A empresa alvo é explícita por operação — parâmetro
   `p_target_company_id` (2 RPCs) ou derivada de `p_lead_id` já existente
   (7 RPCs) — sempre validada contra a autorização real via
   `require_company_access()`/`can_access_company()`. `selectedCompanyId`
   vive só como estado de UI, por aba, nunca como autoridade (§7). A
   Revisão 1 (tabela `super_admin_active_company`) foi rejeitada por
   quebrar com múltiplas abas/dispositivos/sessões (§7.2).
4. **Criação de empresas**: RPC restrita a Super Admin, cria stages padrão,
   estado inicial `implantacao` (§8).
5. **Convites por e-mail**: tabela `invites`, token com hash, RPC para
   criar/aceitar/cancelar/reenviar, criação de conta real via route handler
   server-side com Supabase Admin API — nunca `service_role` no navegador
   (§9).
6. **Quem pode criar quem**: matriz de §9.2 — Super Admin cria qualquer
   papel em qualquer empresa; Manager só cria Seller da própria empresa;
   Seller não cria ninguém.
7. **Estados de usuário**: `invited`/`invite_expired` (só convite),
   `active`/`suspended` (por membership), `deactivated` (conta inteira)
   (§10).
8. **Suspensão e desligamento**: granular por membership para suspensão;
   `profiles.is_active=false` para desativação total; nunca exclusão física
   de conta com histórico (§10.2).
9. **Transferência de leads e tarefas**: RPC transacional única
   `offboard_seller`, com ou sem sucessor, preservando histórico e vendas
   já concluídas (§11).
10. **Saída do último gerente**: bloqueada sem sucessor explícito; seller
    nunca vira gerente automaticamente (§12).
11. **Criação e remoção de Super Admins**: só Super Admin convida Super
    Admin; último Super Admin não pode se remover (§13).
12. **Auditoria**: tabela `audit_log` central, escrita só por RPC, nunca
    grava segredos, cobre toda a lista de ações administrativas do §14.2.
13. **Impacto no M1-E**: baixo em volume — 7 das 9 RPCs derivam a empresa
    alvo de `p_lead_id` já existente, sem parâmetro novo; só `create_lead`
    e `check_lead_phone_duplicate` ganham `p_target_company_id` opcional
    (obrigatório apenas para Super Admin); contrato de erro para
    `MANAGER`/`SELLER` não muda (§15).
14. **Momento correto para retomar o E4**: início de S8, depois do schema
    de memberships/sellers (S1), dos helpers de validação de empresa alvo
    e da RLS redefinida (S2) estarem prontos e testados (§16).

---

## 20. Arquivos alterados nesta etapa

Somente este documento:

```
docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md   (novo)
```

Nenhum outro arquivo do repositório foi criado, editado ou removido.
Nenhuma migration, nenhuma alteração de RLS, nenhuma RPC, nenhum código de
aplicação, nenhuma variável de ambiente, nenhum segredo, nenhum comando do
Supabase CLI, nenhum Docker, nenhum commit e nenhum push foram executados
nesta etapa.
