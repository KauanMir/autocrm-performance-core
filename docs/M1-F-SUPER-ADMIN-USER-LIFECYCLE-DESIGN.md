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

---

## 21. Estado de implementação — S4 (fechamento oficial, pós-implementação)

> Adendo pós-implementação, registrado no fechamento do estágio S4
> (M1-F S4-F4). O texto acima (§0–§20) é o design original, preservado sem
> alteração — nenhum requisito histórico foi reescrito para parecer que a
> implementação sempre foi idêntica ao plano. Esta seção registra o que foi
> de fato implementado, testado e publicado para a linha **S4** da tabela
> de §16.

### 21.1 Status

**S4 concluído** em 2026-07-23. `origin/main` em
`3ed936772a9dcdabb85b1106326166eca37d2b5a`. Auditoria completa (código,
testes, contratos, segurança) não encontrou lacuna bloqueante — ver
relatório de fechamento M1-F S4-F4 para o detalhamento requisito a
requisito.

### 21.2 Principais capacidades entregues

- **Criação de convite**: Super Admin convida qualquer papel em qualquer
  empresa; Manager convida somente `seller` da própria
  `activeMembership.companyId`. Prevenção de duplicidade (índices únicos
  parciais), rate limit por ator e por e-mail+escopo, auditoria completa,
  envio de e-mail real via Supabase Auth Admin API com fallback automático
  para magic link quando o e-mail já possui conta (sem revelar a
  diferença ao chamador).
- **Listagem administrativa real**: Super Admin em escopo de plataforma,
  Manager restrito à própria membership ativa (nunca `profiles.company_id`
  legado), Seller sem nenhum acesso. Whitelist de colunas por GRANT
  (`token_hash` nunca legível por `authenticated`, mesmo em linha
  visível por RLS).
- **Reenvio**: invalida o convite anterior (`superseded`), nunca expõe
  token/link à UI, somente via Route Handler server-side.
- **Cancelamento**: somente via RPC `cancel_invite`, histórico preservado,
  nunca exclusão física.
- **Aceite público**: validação de token sem autenticação prévia,
  autenticação via `verifyOtp` em cliente Supabase temporário, definição de
  senha, criação transacional de `profiles`/`company_memberships`/`sellers`,
  transferência de sessão ao cliente principal (com estado terminal
  dedicado `activated_but_login_failed` quando a transferência falha após
  a conta já ter sido provisionada).
- **Auditoria administrativa** (`audit_log`) para toda transição real de
  convite, nunca grava segredo.
- **Rate limiting em três camadas**: criação/reenvio (por ator e por
  e-mail+escopo, com validação de autorização *antes* da reserva de cota —
  correção aplicada em S4-A2B.1), validação de token (por IP e por token),
  aceite (por ator e por convite).

### 21.3 Subestágios de implementação (decomposição interna do S4 oficial)

Os nomes abaixo são divisão de trabalho usada durante a implementação —
**não são novos estágios oficiais**; todos pertencem à linha **S4** da
tabela de §16.

| Subestágio | Função |
|---|---|
| S4-A1 | Schema `invites`/`audit_log`, RLS de leitura própria/plataforma |
| S4-A2A | RPCs `create_invite`/`resend_invite`/`cancel_invite` |
| S4-A2A.1 | `delivery_status`, rate limit bruto, auditoria de sucesso movida para a finalização de delivery (evita gravar `invite_sent` antes do e-mail sair de fato) |
| S4-A2B / S4-A2B.1 | Route Handler de criação (`POST /api/platform/invites`); correção de vulnerabilidade — autorização passa a ser revalidada *antes* de reservar cota de rate limit |
| S4-C1 | `validate_invite_token`/`accept_invite`, rate limit de validação e de aceite |
| S4-C2A / S4-C2B | Fluxo público de aceite (fragmento de URL, sessão temporária, senha, transferência de sessão) |
| S4-C2C | Leitura do próprio profile pelo usuário autenticado (suporte ao login pós-aceite) |
| S4-F1 | Leitura da própria membership pelo frontend; grants de coluna de `invites` (hardening do SELECT amplo de S4-A1 para 10 colunas nomeadas) |
| S4-F2 | Modal de criação de convite (frontend administrativo) |
| S4-F3 | Listagem real, reenvio e cancelamento (frontend administrativo) |
| S4-F4 | Este fechamento — auditoria final, reconciliação de status, documentação |

### 21.4 Testes finais

TypeScript: **1010/1010** (62 arquivos, incluindo ~330 testes específicos
de convites entre hooks/componentes/API routes/server). SQL: **1245/1245**
(30 arquivos `no_plan()`, 8 deles específicos de S4 — schema, RPCs de
ciclo de vida, delivery/rate limit, rate limit autorizado, aceite, grants
de coluna). Build: verde. Nenhuma migration nova nesta etapa (S4-F4 é
auditoria e documentação, não implementação).

### 21.5 Deploy

Nenhuma migration do S4 foi aplicada ao Supabase remoto. Deploy remoto
permanece reservado ao **S9** (§16) — fora do escopo de qualquer
subestágio de S4, sem exceção.

### 21.6 Próximo estágio oficial

**S5** (gestão de usuários — edição de função/e-mail, `update_membership_role`).
**S7** (seletor de empresa) continua sendo pré-requisito estrutural do
**S8** (retomada do M1-E E4, §2.3/§16) — nenhum dos dois foi iniciado
nesta etapa.

### 21.7 Pendências não bloqueantes

| Item | Classificação |
|---|---|
| `profiles_update_admin`, edição de nome/e-mail, mudança de papel | S5 |
| Suspensão/reativação de membership, transferência entre empresas | S6 |
| Seletor global de empresa (`selectedCompanyId` como estado de UI) | S7 |
| RCAR como empresa demonstrativa persistente | operação futura |
| Deploy remoto, SMTP remoto de produção | S9 |
| Retenção/limpeza de `invite_rate_limit_events`/`invite_activation_rate_limit_events` | operação futura — sem política definida, não bloqueia S4 |
| 2FA obrigatório para Super Admin | S6 para o mecanismo; S9 para exigi-lo no rollout real |

---

## 22. Decisões congeladas — S5 (M1-F S5-D0)

> Adendo de arquitetura, registrado no congelamento de decisões do S5
> (M1-F S5-D0), após a auditoria E0 (§21 cobre o fechamento do S4; esta
> seção não o altera). Nenhum código, migration, RPC, Route Handler ou
> teste foi criado a partir desta seção — somente desenho de contrato,
> pendente de implementação em S5-A+.

### 22.1 Correção em relação ao E0

A auditoria E0 havia classificado "alterar empresa"/"segunda membership"
como fora do M1-F ou proibido pela arquitetura, sem nomear o estágio
correto. **Correção**: transferência de usuário entre empresas pertence
ao **S6**, não está fora do M1-F. A arquitetura atual (índice único
parcial `company_memberships_profile_single_active_uidx`, no máximo 1
membership ativa por profile) permanece inalterada até o S6 definir o
contrato de transferência (desativar vínculo anterior, criar/ativar novo,
nunca duas memberships ativas simultâneas, nunca `DELETE` físico).

A arquitetura de leitura recomendada no E0 (§9 do relatório de auditoria
— SELECT direto sob RLS nova em `company_memberships`) é **substituída**
pela decisão congelada abaixo: RPC estreita de listagem. Motivo: evita
grants amplos em `profiles`, centraliza autorização e paginação num único
ponto, e não depende da policy legada `profiles_update_admin`.

### 22.2 Matriz de atores (congelada)

| Ator | Pode | Não pode |
|---|---|---|
| **Super Admin** | listar usuários globalmente (empresa como filtro visual, nunca autorização); visualizar Managers e Sellers de qualquer empresa; editar nome; alterar papel `seller ↔ manager`; alterar e-mail somente pela operação server-side específica (S5-E1) | alterar `platform_role`; remover outro Super Admin; alterar o próprio papel; usar `selectedCompanyId` como fonte de autorização; atravessar tenant sem empresa explícita revalidada no servidor |
| **Manager** | listar Sellers da própria empresa; visualizar outros Managers da própria empresa **somente leitura**; editar nome de Sellers da própria empresa | editar outro Manager; editar e-mail; alterar qualquer papel (nem promover Seller, nem ser rebaixado, nem editar o próprio papel); agir sobre Super Admin; agir fora de `activeMembership.companyId` |
| **Seller** | nada | zero listagem administrativa, zero edição administrativa |
| **Sem profile/membership ou inativo** | nada | falha fechada |

Motivo congelado da restrição de Manager sobre papel: o S4 já não permite
que Manager convide outro Manager (§9.2); permitir que Manager promova um
Seller a Manager por edição seria uma forma indireta de contornar essa
mesma regra. Por isso a troca de papel é **exclusiva de Super Admin**.

### 22.3 Alteração de papel — ponte temporária com `profiles.role`

`company_memberships.role` é a autoridade do M1-F; `profiles.role`
(legado, `user_role`) continua sendo lido por RLS/helpers pré-M1-F de
`leads`/`sellers` (`current_profile_role()`, `is_manager_or_admin()`, não
migrados por este estágio — migração real fica para o S8, junto da
retomada do E4 do M1-E). Até lá, `update_membership_role` deve atualizar
**atomicamente**, na mesma transação:

- `company_memberships.role`
- `profiles.role`, pelo mapeamento fechado `manager → 'manager'`,
  `seller → 'seller'` — **nunca** produz `profiles.role = 'admin'`.

Esta sincronização é compatibilidade temporária, não torna `profiles.role`
autoridade do M1-F, precisa de teste de consistência dedicado, e será
removida no S8 quando as RLS antigas de `leads`/`sellers` migrarem para os
helpers novos (`is_manager_or_platform`). A RPC nunca pode autorizar a
própria ação usando o papel recém-gravado na mesma transação.

### 22.4 Guarda do último Manager (entra no S5)

Mesmo com offboarding completo reservado ao S6, `update_membership_role`
não pode deixar uma empresa sem Manager ativo:

- `seller → manager`: sempre permitido (Super Admin).
- `manager → seller`: permitido somente se restar ao menos um Manager
  ativo na empresa após a troca; caso contrário, falha com
  `last_manager_requires_successor`.
- Contagem de Managers ativos da empresa protegida por lock (mesma linha
  de raciocínio de `SELECT ... FOR UPDATE` já usada em `offboard_seller`,
  §11), para impedir corrida entre duas trocas simultâneas.
- Nenhuma criação automática de sucessor.

Esta guarda **não inicia o S6** — protege apenas a invariante necessária
para a própria operação do S5.

### 22.5 Arquitetura de listagem (revisada)

RPC estreita `SECURITY DEFINER` (nome provisório `list_company_users`,
mesmo padrão de owner/`search_path` fixo/`REVOKE PUBLIC`/`EXECUTE` restrito
a `authenticated` já usado por `create_company`/`accept_invite`), em vez
de SELECT direto ampliado sobre `profiles`. Combina `profiles` +
`company_memberships` + `companies` internamente; nunca expõe
`auth.users`, `platform_role`, `profiles.role` legado ou `seller_id` ao
chamador.

- **Super Admin**: escopo global; `company_id` só como filtro opcional,
  nunca autorização; lista Managers e Sellers; não retorna Super Admins na
  listagem empresarial comum (reservado a uma futura tela global
  separada, fora deste estágio).
- **Manager**: `company_id` sempre derivado server-side de
  `current_membership_company_id()`/membership ativa — qualquer
  `company_id` enviado pelo cliente é ignorado/rejeitado; lista Sellers;
  recebe Managers da própria empresa marcados como somente leitura; nunca
  recebe usuários de outra empresa.
- **Seller**: chamada proibida (`forbidden`).

**Campos de retorno (fechado)**: `profile_id`, `membership_id`, `name`,
`email`, `company_id`, `company_name`, `company_role`,
`profile_is_active`, `membership_is_active`, `created_at`. Nunca:
`profiles.role` legado, `platform_role`, `seller_id`, metadados de
`auth.users`, último login, tokens, `audit_log`, campos internos de
convite. IDs nunca renderizados como conteúdo visual — só chave interna
de cache/ação. Para Manager, a coluna de empresa pode ser omitida
visualmente; `company_id` continua disponível internamente quando
necessário para query key/contrato.

**Paginação/busca/ordenação**: a listagem global do Super Admin nasce com
paginação **server-side** (cursor estável `created_at + membership_id`,
`limit` com máximo seguro, busca normalizada por nome/e-mail, filtro
opcional por `company_id` — só Super Admin — e por `company_role`,
ordenação determinística, sem contagem total obrigatória nesta primeira
versão). Query keys futuras carregam `userId`, tipo de ator, escopo,
filtro de empresa, filtro de papel, busca normalizada e cursor/página —
nenhum cache mistura identidades ou empresas, mesmo padrão de isolamento
já usado por `adminInviteQueryKeys`/`platformCompanyQueryKeys`.

### 22.6 Contratos conceituais do S5 (fechados, não combináveis)

| Contrato | Responsabilidade | Ator |
|---|---|---|
| `list_company_users` | leitura paginada e autorizada | Super Admin (global) / Manager (própria empresa) |
| `update_profile_name` | altera somente `name` | self (se a superfície de perfil pessoal já permitir) / Manager sobre Seller da própria empresa / Super Admin sobre Manager ou Seller |
| `update_membership_role` | altera somente `seller ↔ manager`, sincroniza `profiles.role` temporariamente, guarda último Manager | Super Admin apenas |
| `update_user_email` | fluxo server-side, Route Handler + Admin API | Super Admin apenas — subetapa própria (§22.7), não entra na primeira leva de migrations |

Explicitamente **não criar**: `update_user`, `update_profile_admin`,
payload genérico, PATCH arbitrário, update de colunas dinâmicas. Cada
contrato é estreito e de responsabilidade única.

### 22.7 E-mail — subetapa própria antes de implementar

Edição administrativa de e-mail permanece no escopo do S5, mas **não
entra na primeira migration**. Requer um E0 técnico dedicado
(`S5-E0`, distinto do `M1-F S5-E0` que gerou este documento — é uma
auditoria específica de e-mail, escopo menor) que confirme, antes de
qualquer implementação: versão real da API de Admin do Supabase Auth
instalada, estratégia de duplicidade, tratamento de falha parcial entre
`auth.users.email` e `profiles.email`, e desenho de auditoria. Nenhuma
estratégia de compensação é escolhida nesta etapa. Permissões já
congeladas para quando a subetapa avançar: somente Super Admin, nunca
Manager, nunca edição direta pelo browser, nunca update isolado de
`profiles.email` sem tocar `auth.users`, nunca reutilização de
`profiles_update_admin`.

### 22.8 `profiles_update_admin` — direção aprovada

Continua sendo uma **RLS policy legada** (não uma RPC), com superfície
ampla (qualquer coluna de `profiles` da linha-alvo, sem whitelist),
dependente de `profiles.role = 'admin'` (papel legado) e sem consumidor
atual conhecido (§4 do relatório E0). Permanece **congelada** nesta
etapa: nenhuma alteração, nenhum novo consumidor, nenhuma ampliação de
grants. Direção para S5-A: avaliar (não executar agora) a neutralização
ou remoção explícita da policy, e avaliar `REVOKE` explícito de `UPDATE`
direto em `profiles` para `authenticated` — condicionado a auditoria do
estado real de grants em produção (a ambiguidade de GRANT já documentada
em `20260720100000_m1f_s1_01_platform_memberships.sql` para
`platform_role` se aplica igualmente ao restante da policy) e protegido
por testes de grants/policies dedicados.

### 22.9 Frontend congelado

Aba "Usuários" passa a ter duas seções distintas, na ordem: **Usuários
ativos** (nova), depois **Convites** (`InviteList`, sem regressão).
Colunas da lista de usuários: Nome, E-mail, Papel, Empresa (só Super
Admin), Ações. Manager vê Sellers com ação de editar nome e Managers da
própria empresa em modo somente leitura; Super Admin vê Managers e
Sellers, edita nome e papel, e-mail fica desabilitado até `S5-E1`. Nenhum
controle de suspensão/reativação/transferência/exclusão/revogação de
sessão nesta etapa — pertencem ao S6. Nenhum seletor global de empresa
persistente — pertence ao S7.

### 22.10 Divisão interna do S5 (revisada)

| Subetapa | Escopo |
|---|---|
| S5-A | Hardening (avaliação de `profiles_update_admin`/grants) + RPC `list_company_users` + grants + testes SQL de ACL/escopo/paginação/colunas |
| S5-B | RPC `update_profile_name` + auditoria + testes SQL + repository/hook + integração mínima |
| S5-C | RPC `update_membership_role` (Super Admin apenas) + sincronização temporária de `profiles.role` + guarda do último Manager + concorrência + auditoria + testes SQL |
| S5-D | `MemberList` no frontend + busca + filtros + paginação + modal de edição + integração com `InviteList` + testes TypeScript/acessibilidade |
| S5-E0 | Auditoria específica de edição de e-mail (versão real do Supabase, contratos Admin API, duplicidade, compensação, sincronização, auditoria) |
| S5-E1 | Edição de e-mail — só após aprovação do S5-E0; Route Handler; testes server-side; frontend Super Admin |
| S5-F | E2E, documentação e fechamento — matriz de atores, cross-tenant, cache, concorrência, decisão formal de encerramento do S5 |

Estas divisões são decomposição interna do estágio oficial **S5** — não
são novos estágios do roadmap de §16.

### 22.11 Fronteira S5/S6/S7 (reafirmada)

- **S5**: listagem, edição de nome, troca de papel `seller ↔ manager`
  (Super Admin apenas), edição de e-mail (subetapa própria).
- **S6**: suspensão/reativação de membership, `offboard_seller`,
  `offboard_manager`, **transferência de usuário entre empresas**
  (corrigido nesta seção — pertence ao S6, não está fora do M1-F),
  revogação de sessão.
- **S7**: seletor global de empresa (`selectedCompanyId` como estado de
  UI), sem início nesta etapa.

## 23. Fechamento do S5 — Gestão de Usuários Ativos

> Registrado no fechamento oficial do S5 (M1-F S5-F, auditoria integrada de
> encerramento). Esta seção é um registro factual do que está **implementado
> e publicado no código-fonte** — não implica ativação em produção. As
> migrations deste estágio ainda não foram aplicadas ao banco remoto (§23.7)
> e as duas feature flags que protegem o frontend continuam desligadas por
> padrão em todo ambiente (§23.6). §0–§22 não foram alterados nesta seção.

### 23.1 Estado oficial

S5 (Gestão de Usuários Ativos) está **concluído no código-fonte**, publicado
em `origin/main`, HEAD oficial:

```
49ca55c8633922505d923d469992cb96539305c6
```

### 23.2 Entregas por subetapa (S5-A a S5-E1-B)

| Subetapa | Contrato/entrega | Situação |
|---|---|---|
| S5-A1 | Remoção de `profiles_update_admin` como superfície de escrita; nenhum `UPDATE` direto em `profiles` reaberto ao navegador; defesa por grants/RLS revalidada | Implementado, publicado |
| S5-A2 | `list_company_users` — listagem segura, escopo por ator (Super Admin global / Manager própria empresa), busca normalizada, filtro por papel/empresa, paginação por cursor (`created_at`+`membership_id`, sem `has_more`/total) | Implementado, publicado |
| S5-B | `update_profile_name` — edição estreita de `profiles.name`, autorização por ator (self/Super Admin/Manager sobre Seller), auditoria, idempotência sem escrita/auditoria quando já é o valor final | Implementado, publicado |
| S5-C | `update_membership_role` — troca `seller ↔ manager` exclusiva de Super Admin, guarda do último Manager, preservação de `sellers.id`/histórico, sincronização temporária de `profiles.role` (nunca produz `admin`) | Implementado, publicado |
| S5-D | Frontend "Usuários ativos" (`ActiveUserList`/`EditUserModal`) — busca, filtros, paginação, edição de nome/papel, `InviteList` preservado sem regressão, flag `NEXT_PUBLIC_FF_ACTIVE_USERS` | Implementado, publicado |
| S5-E0 | Auditoria técnica do fluxo de e-mail — versão real da Admin API auditada empiricamente, estratégia de consistência definida, achado crítico documentado (`updateUserById` não classifica conflito de e-mail de forma confiável) | Concluída (somente pesquisa, sem código) |
| S5-E1-A | Backend seguro de e-mail — `get_auth_email_update_state`/`get_profile_email_update_state` (leitura estreita, `service_role`)/`commit_profile_email_update` (compare-and-set, `authenticated`) + Route Handler `POST /api/admin/users/[profileId]/email`, sequência Auth→profiles com compensação, auditoria sem e-mail completo, flag `NEXT_PUBLIC_FF_USER_EMAIL_EDIT` | Implementado, publicado |
| S5-E1-B | Frontend separado de alteração de e-mail (`ChangeUserEmailModal`) — ação própria (nunca no mesmo formulário de nome/papel), confirmação obrigatória, mensagens sanitizadas, integração com a lista, ambas as flags exigidas | Implementado, publicado |

Nenhuma entrega oficial do S5 (design §16/§22.10) está faltando.

### 23.3 Matriz final de atores (confirmada na implementação real)

**Super Admin** — pode: listar Managers e Sellers globalmente
(`list_company_users`, escopo `platform`); filtrar por empresa (filtro
visual, nunca autorização); editar nome de qualquer usuário empresarial;
alterar papel `seller ↔ manager`; alterar e-mail de outro usuário
empresarial (`NEXT_PUBLIC_FF_USER_EMAIL_EDIT` habilitada). Não pode, por
este estágio: alterar o próprio papel; alterar o próprio e-mail por este
fluxo; alterar outro Super Admin (nome, papel ou e-mail); alterar
`platform_role`; suspender, transferir, excluir ou revogar sessões
(S6).

**Manager** — pode: listar Managers (somente leitura) e Sellers (edição de
nome) da própria empresa; editar o próprio nome (`update_profile_name`,
ramo `self`, disponível a qualquer ator ativo). Não pode: alterar qualquer
papel; alterar e-mail (nem o próprio, nem de terceiros, por este fluxo);
editar outro Manager; agir fora da própria empresa.

**Seller** — não acessa a interface administrativa de gestão de usuários
(`ActiveUserList`); pode editar o próprio nome pelo contrato de backend
(`update_profile_name` permite `self` para qualquer profile ativo,
independente de papel) — sem superfície de UI dedicada a isso nesta etapa.

Confirmado por leitura direta das três RPCs e do Route Handler, e reforçado
pelos testes SQL 30–34 e pelos testes TypeScript do S5-D/S5-E1-B: o backend
é a proteção real em todos os casos — a visibilidade de botões na UI é
defesa em profundidade, nunca a única barreira.

### 23.4 Invariantes de segurança (reconfirmadas)

- Nenhuma autorização por `selectedCompanyId` (conceito não existe em
  código — reservado ao S7).
- Nenhuma autorização por `profiles.company_id` ou `profiles.role` legado.
- `company_memberships.role` é a única autoridade de papel empresarial;
  `platform_role` é a única autoridade de plataforma.
- Nenhum `SELECT`/`UPDATE` direto ampliado em `profiles` a partir do
  navegador — toda leitura/escrita passa por RPC `SECURITY DEFINER`
  estreita.
- Nenhuma leitura de `auth.users` a partir do frontend; nenhuma
  `service_role` no navegador.
- Nenhuma RPC genérica, nenhum `PATCH` genérico, nenhuma alteração
  arbitrária de campo — cada contrato altera exatamente as colunas que seu
  nome descreve.
- Nenhum e-mail completo, senha, token ou dado de sessão em `audit_log` —
  o evento `user_email_updated` carrega somente `{"changed": false}` /
  `{"changed": true}`.

### 23.5 Ciclo Seller ↔ Manager e alteração de e-mail

Ciclo `seller → manager`: cadastro de `sellers` preservado (nunca
`DELETE`), `sellers.id` preservado, histórico de leads/tarefas/negociações
preservado (referência direta a `sellers.id`), seller desvinculado
(`membership_id = null`) e inativado (`is_active = false`), nenhuma nova
atribuição possível como Seller enquanto nesse estado, `profiles.role`
sincronizado. Ciclo `manager → seller`: cadastro histórico reaproveitado
por `(company_id, profile_id)` quando existe, religado e reativado; novo
cadastro criado somente quando nunca existiu; nenhuma duplicação
silenciosa (`seller_state_conflict` em qualquer ambiguidade). Proteções:
último Manager, autoalteração, outro Super Admin, conflito de cadastro —
todas com rollback integral (transação única) e auditoria única (nunca
parcial).

Alteração de e-mail: exclusiva de Super Admin, nunca o próprio e-mail,
nunca outro Super Admin; e-mail em `profiles` e em `auth.users`
pré-validados e comparados antes de qualquer escrita (divergência
pré-existente bloqueia com `user_email_state_conflict`, nunca reconcilia
silenciosamente); conflito do novo e-mail verificado dos dois lados antes
de tocar o Auth; sequência obrigatória Auth primeiro, `profiles` depois;
compensação (reversão do Auth) quando `profiles` falha; falha da própria
compensação vira `email_compensation_failed` com alerta operacional
sanitizado; `email_confirm=true`; nenhuma sessão revogada (fora de escopo,
pertence ao S6); modal de e-mail (`ChangeUserEmailModal`) permanece
estrutural e visualmente separado de `EditUserModal` (nome/papel) — nunca
compartilham formulário, sequência de salvamento ou confirmação.

### 23.6 Feature flags

`NEXT_PUBLIC_FF_ACTIVE_USERS` — padrão `false`; controla a existência da
seção "Usuários ativos" no bundle. `NEXT_PUBLIC_FF_USER_EMAIL_EDIT` —
padrão `false`; separada da flag principal; a ação "Alterar e-mail" exige
**ambas** habilitadas (`activeUsersEnabled && isUserEmailEditEnabled()`)
além de Super Admin. Nenhuma das duas foi ativada em nenhum arquivo
versionado nem em configuração remota nesta etapa. Com as flags
desligadas, nenhuma RPC de S5-A2/S5-B/S5-C é chamada e nenhuma requisição
chega ao Route Handler de e-mail; a aba "Usuários" continua funcional
apenas com `InviteList` (convites), exatamente como antes do S5-D — sem
regressão confirmada pelos testes de `ScreenAjustesInvites`.

### 23.7 Migrations do S5 ainda não aplicadas no banco remoto

Nenhuma migration abaixo foi aplicada remotamente. Ordem de aplicação =
ordem de criação (nome do arquivo, timestamp crescente):

| # | Migration | Finalidade | Depende de |
|---|---|---|---|
| 1 | `20260723150000_m1f_s5a1_profiles_hardening.sql` | Remove/neutraliza superfície de escrita legada em `profiles` | S1–S4 (já teoricamente aplicadas antes do S5, também pendentes se o remoto nunca recebeu M1-F) |
| 2 | `20260723160000_m1f_s5a2_list_company_users.sql` | RPC `list_company_users` | #1 |
| 3 | `20260723170000_m1f_s5b_update_profile_name.sql` | RPC `update_profile_name` | #1, #2 (mesmo padrão de helpers) |
| 4 | `20260723180000_m1f_s5c_update_membership_role.sql` | RPC `update_membership_role` | #1–#3 |
| 5 | `20260727120000_m1f_s5e1a_email_update_backend.sql` | `get_auth_email_update_state` / `get_profile_email_update_state` / `commit_profile_email_update` | #1–#4 (reaproveita `can_access_company`/padrão de auditoria) |

Estas 5 migrations do S5 fazem parte de uma cadeia maior: **todo o M1-F**
(S1 a S5, 27 arquivos de migration no total, ver `supabase/migrations/`)
ainda não foi confirmado como aplicado no banco remoto — o escopo desta
auditoria (S5-F) cobre apenas a parte do S5, mas a ordem de aplicação real
precisa necessariamente incluir as migrations de S1–S4 antes das 5 acima,
já que elas dependem de `company_memberships`, `is_platform_super_admin()`
e demais helpers criados nessas etapas anteriores. O código de frontend
(`ActiveUserList`, `ChangeUserEmailModal`) permanece protegido pelas duas
feature flags (§23.6) enquanto essas migrations não existirem no ambiente
remoto — nenhuma RPC nova é alcançável em produção até o deploy real.

### 23.8 Plano de rollout futuro (documentado, não executado)

1. Confirmar backup e janela de mudança combinada com o time.
2. Confirmar que o commit oficial (`49ca55c8633922505d923d469992cb96539305c6`
   ou posterior) é o que será promovido ao remoto.
3. Aplicar as migrations do M1-F na ordem correta (S1→S5, ver §23.7).
4. Executar verificações de catálogo e grants no remoto (mesmo espírito dos
   testes SQL 10–34: nenhuma função inesperada, grants exatamente como
   esperado).
5. Testar login e convites existentes no remoto antes de tocar em qualquer
   flag nova.
6. Testar as RPCs de listagem/nome/papel (`list_company_users`/
   `update_profile_name`/`update_membership_role`) diretamente, com um
   usuário de controle, flags ainda desligadas.
7. Testar o backend de e-mail (`get_auth_email_update_state`/
   `get_profile_email_update_state`/`commit_profile_email_update`/Route
   Handler) com um usuário sintético controlado, flags ainda desligadas.
8. Ativar `NEXT_PUBLIC_FF_ACTIVE_USERS` em produção.
9. Realizar smoke test da seção "Usuários ativos" (listagem, busca,
   filtros, edição de nome/papel) com um Super Admin real.
10. Somente depois, ativar `NEXT_PUBLIC_FF_USER_EMAIL_EDIT`.
11. Realizar smoke test específico de alteração de e-mail (idempotência,
    conflito, compensação) com um usuário de controle.
12. Manter e documentar o plano de rollback das duas flags (reverter a
    variável de ambiente é suficiente — nenhuma migration precisa ser
    revertida para desativar a UI).

Nenhum passo deste plano foi executado nesta etapa (S5-F) — é documentação
para uma etapa futura e separada de deploy.

### 23.9 Totais finais de validação local (S5-F)

- Migrations aplicadas localmente: 27 (todas as migrations do repositório,
  incluindo as 5 do S5).
- SQL: 35 arquivos, **1539/1539** asserções (`supabase test db`).
- TypeScript: 76 arquivos, **1273/1273** testes (`npm run test:run`).
- Build: verde (`npm run build`), 8/8 páginas geradas, rota
  `/api/admin/users/[profileId]/email` presente.
- E2E de navegador: **não executado** — não existe infraestrutura E2E
  neste repositório (nenhuma foi criada nesta etapa); o fechamento se
  apoia na suíte de testes existente (SQL + TypeScript) e nos testes de
  integração local já realizados durante S5-E0/S5-E1-A (usuários Auth
  sintéticos, limpos ao final, nunca em ambiente remoto).
- Módulos legados M0 (tarefas, visitas, negociações, propostas, vendas):
  sem cobertura de teste automatizado dedicada nesta suíte — não fazem
  parte do escopo do M1-F e não foram tocados por nenhuma etapa do S5;
  nenhuma afirmação de regressão é feita sobre eles além de "não
  modificados".

### 23.10 Riscos residuais

- O achado empírico do S5-E0 sobre `identities[].identity_data.email`
  (pode ficar temporariamente desatualizado logo após `updateUserById`,
  convergindo numa leitura subsequente) continua válido como ponto de
  atenção para quando o rollout real acontecer contra o Auth de produção.
- Nenhuma migration do M1-F (S1–S5) foi confirmada como aplicada no
  ambiente remoto — o estado real do banco remoto em relação a essas 27
  migrations não foi verificado nesta etapa (fora de escopo: nenhuma
  operação remota foi executada).

### 23.11 Fronteiras reafirmadas

- **S6 e S7 não foram iniciados** — nenhuma suspensão, reativação,
  transferência entre empresas, revogação de sessão ou seletor global de
  empresa existe em código.
- **M1-E E4 continua pausado**, aguardando o S8 (migração das RLS legadas
  de `leads`/`sellers` para os helpers novos, que também remove a ponte
  temporária `profiles.role` descrita em §22.3).
- Nenhuma operação remota (migration, SQL, alteração de usuário) foi
  executada durante esta auditoria de fechamento (S5-F) — toda validação
  foi local.

---

## 24. Decisões congeladas do S6 — ciclo empresarial

> Registrado em M1-F S6-D0 (congelamento inicial) e consolidado/publicado
> em M1-F S6-D1 (esta revisão). Reconcilia e corrige formalmente a
> proposta de divisão apresentada em M1-F S6-A0 (auditoria factual,
> aprovada) à luz de decisões humanas explícitas tomadas em S6-D0/S6-D1.
> Nenhum código, migration, RPC, Route Handler, frontend ou teste foi
> criado ou alterado nesta seção em nenhuma das duas revisões — é
> documentação de decisão, não implementação. §0–§23 não foram alterados.
> Nenhuma operação remota foi executada em nenhuma das etapas que
> produziram esta seção. **Nenhuma migration do S6 existe no repositório
> — todo nome de coluna/enum/RPC citado abaixo é contrato acordado para
> implementação futura, não código já escrito.**

### 24.1 Estado oficial no momento deste registro

Branch `main`, HEAD local e `origin/main` no momento da consolidação
(S6-D1, antes do commit desta seção):

```
7a97f18f32fe0c9d8f92be78c5d45790bac1f7e3
```

Working tree, no momento da consolidação, continha somente
`docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md` modificado (seção §24
criada em S6-D0, ainda sem commit). S6 sem nenhuma linha de implementação.
S7 e S8 não iniciados. M1-E E4 pausado (aguardando S8, §23.11).

### 24.2 Estado da membership: `active` / `suspended` / `offboarded`

**Decisão**: `company_memberships.is_active` (boolean) sozinho **não é
suficiente** para o S6 — um `false` não diz se o vínculo está suspenso
(temporário, reversível) ou desligado (encerramento, sujeito a regras de
retorno diferentes, §24.5). O S6 precisa de um terceiro estado explícito.

**Menor solução segura**: uma nova coluna
`company_memberships.lifecycle_status`, enum novo
`membership_lifecycle_status` (`'active' | 'suspended' | 'offboarded'`),
seguindo a mesma convenção já usada para `company_status`/`company_role`/
`platform_role` (enum, nunca `text` livre para um conjunto fechado de
estados). Não criada nesta etapa — é decisão de schema para o S6-B.

- **Default**: `'active'` — espelha o default atual de `is_active` (`true`).
- **Compatibilidade com `is_active` (regra temporária até o S8)**:
  `is_active` **permanece a única coluna que os helpers/RLS/índice atuais
  consomem** (`can_access_company`, `current_membership_company_id`,
  `current_membership_role`, `company_memberships_profile_single_active_uidx`)
  — nenhum desses objetos muda no S6. `lifecycle_status` é aditiva. A
  consistência entre as duas é garantida por um `CHECK CONSTRAINT` (não por
  disciplina de aplicação): `check ((lifecycle_status = 'active') = is_active)`.
  Toda RPC nova do S6 escreve as duas colunas na mesma instrução — o
  `CHECK` faz o Postgres rejeitar qualquer gravação que as deixe
  divergentes, mesmo por erro de programação futuro. Preferido a uma
  coluna gerada (`GENERATED ALWAYS AS`) porque não exige recriar a coluna
  `is_active` existente (evita reescrever o índice parcial e os grants já
  auditados) — menor blast radius de migration.
- **Migração dos registros atuais**: hoje toda `company_memberships` real
  tem `is_active=true` (nenhuma suspensão de produção existe — os únicos
  `is_active=false` observados são toggles de fixture/teste, confirmado no
  S6-A0). Backfill trivial e seguro: `lifecycle_status='active'` para 100%
  das linhas existentes no momento da migration do S6-B.
- **Invariantes entre `status` e `is_active`**: só o `CHECK` acima —
  nenhuma outra regra nova. `lifecycle_status='suspended'` **sempre**
  implica `is_active=false`; `lifecycle_status='offboarded'` **sempre**
  implica `is_active=false`; `lifecycle_status='active'` **sempre** implica
  `is_active=true`. Não existe combinação onde `is_active=true` e
  `lifecycle_status` seja `suspended`/`offboarded`, nem o inverso.
- **Impacto nos helpers atuais**: zero. Nenhum helper de S1–S5 lê
  `lifecycle_status` — continuam lendo `is_active`, comportamento
  bit-a-bit idêntico ao de hoje.
- **Impacto no índice único de membership ativa**
  (`company_memberships_profile_single_active_uidx`, parcial sobre
  `is_active`): zero mudança de definição — como `is_active` continua
  sendo a fonte que o índice observa, e o `CHECK` garante que só
  `lifecycle_status='active'` produz `is_active=true`, a regra "no máximo
  1 membership ativa por profile" continua válida automaticamente para
  qualquer combinação dos três estados.
- **Reativação**: `suspended → active` é permitida (sujeita ao índice
  único — não pode haver outra membership `active` do mesmo profile no
  momento). `offboarded → active` **não** é uma transição do mesmo
  contrato — ver §24.5.
- **Transferência**: consome `lifecycle_status` na origem
  (`offboarded`, §24.6) e cria/reaproveita `active` no destino — nunca
  reescreve `company_id` da linha antiga (trigger
  `company_memberships_check_mutation` já proíbe isso, imutabilidade
  preservada).
- **Listagem futura**: `lifecycle_status` é exatamente o campo que uma
  RPC administrativa de leitura de inativos (§24.12) filtraria/agruparia —
  `is_active` sozinho nunca permitiria distinguir "suspenso" de
  "desligado" numa lista.

Nenhuma migration foi criada nesta etapa. Este é o modelo recomendado para
implementação no S6-B.

### 24.3 Permissões por ator — congelado

**Super Admin** pode, sobre `company_memberships` de qualquer empresa:
suspender Manager e Seller empresariais; reativar Manager e Seller
empresariais; desligar Manager e Seller empresariais; transferir usuários
entre empresas (§24.7). Não pode, por essas funções: alterar outro Super
Admin; alterar `platform_role`; agir sobre a própria membership (nenhuma
autossuspensão/autodesligamento/autotransferência por este contrato);
desativar globalmente uma conta da plataforma (`profiles.is_active` —
contrato diferente, §24.8).

**Manager** pode, somente na própria empresa
(`current_membership_company_id()`): suspender Seller; reativar Seller;
desligar Seller. Não pode: agir sobre outro Manager (nenhuma suspensão,
reativação, desligamento ou transferência de um Manager por um Manager —
mesma fronteira já aplicada em `EditUserModal`/`ActiveUserList` desde o
S5, onde um Manager já enxerga outro Manager como linha somente-leitura);
transferir (ação exclusiva de Super Admin); alterar `platform_role`; agir
fora da própria empresa.

**Seller**: nenhuma ação administrativa do S6 — mesma fronteira já
vigente desde o S5 (Seller não acessa `ActiveUserList`).

O backend (RPC `SECURITY DEFINER` + `require_company_access`/
`is_platform_super_admin`) é a proteção real em todos os casos — a
visibilidade de botões no frontend (S6-F) é defesa em profundidade,
nunca a única barreira, mesmo princípio já reconfirmado em §23.3 para o
S5.

### 24.4 Suspensão — congelado

- Ator autorizado: conforme §24.3 (Super Admin sobre Manager/Seller de
  qualquer empresa; Manager sobre Seller da própria empresa).
- Temporária e reversível; afeta **somente** a membership empresarial-alvo
  (`lifecycle_status: active → suspended`, `is_active → false` na mesma
  instrução).
- Não desativa `profiles.is_active` (conta continua existindo e podendo
  logar — só perde acesso comercial daquela empresa via `can_access_company`,
  já pronta para isso desde S2/S11).
- Não altera `platform_role` — suspensão empresarial nunca toca a coluna
  de plataforma.
- Preserva a linha de `company_memberships`, a linha de `sellers`
  vinculada, e todo histórico de leads/tarefas/negociações/propostas/
  vendas — nenhum `DELETE` em nenhum ponto.
- Se a membership suspensa é de um `seller` vinculado: `sellers.is_active`
  é gravado `false` **na mesma transação** (sincronização ainda
  inexistente hoje, §24.13) — vendedor para de receber novas atribuições,
  mas seu `sellers.id` e histórico não mudam.
- Último `manager` ativo da empresa é protegido — suspender a última
  membership `role='manager'` ativa nunca é permitido (mesma regra do
  §24.6, aplicada aqui pela mesma guarda `last_manager_requires_successor`
  estendida à transição de `lifecycle_status`).
- Super Admin como **alvo** de uma ação empresarial de suspensão é
  rejeitado — não é este contrato que gerencia Super Admin (§24.10).
- Nenhuma revogação ou banimento global de Auth — ver §24.8.
- Motivo administrativo **obrigatório** — §24.12.
- RLS (`can_access_company`) e helpers empresariais continuam sendo a
  proteção imediata e suficiente; nenhuma camada nova de enforcement é
  necessária para a suspensão em si fazer efeito.

**Transição**: `active → suspended`.

### 24.5 Reativação — congelado

- Ator autorizado: o mesmo par de §24.3 (Super Admin globalmente; Manager
  só sobre Seller da própria empresa).
- **Transição**: `suspended → active` (nunca `offboarded → active` por
  este mesmo contrato — §24.6). Reversão simétrica de §24.4:
  `lifecycle_status`, `is_active` e `sellers.is_active` (quando aplicável)
  voltam na mesma transação.
- Sujeita ao índice único de membership ativa — se o profile já tiver
  outra membership `active` no momento (cenário hoje impossível dado que
  a constraint de 1-ativa já está em vigor, mas relevante se essa
  constraint for relaxada no futuro), a reativação é negada.
- Motivo administrativo **opcional** — §24.12.

### 24.6 Desligamento (offboarding) — congelado

**Contratos mantidos separados**: `offboard_seller` e `offboard_manager`
permanecem dois contratos distintos — decisão fechada, sem contrato
único genérico `offboard_membership` nesta etapa. Motivo: os dois
protegem invariantes operacionalmente diferentes e não-sobreponíveis —
`offboard_seller` reatribui registros comerciais abertos (leads, tarefas,
negociações, visitas) a um sucessor opcional; `offboard_manager` só
protege a existência de outro Manager ativo na empresa, sem nenhum dado
comercial para mover. Contratos estreitos reduzem ambiguidade de
interpretação em cada RPC; unificá-los custaria uma RPC com ramificação
interna por `role`, sem reduzir a complexidade real.

Regras comuns às duas RPCs:

- Encerra o vínculo empresarial (`lifecycle_status: active|suspended →
  offboarded`, `is_active → false`).
- Não apaga `profiles`, não apaga `company_memberships`, não apaga
  `sellers`, não apaga histórico nenhum — mesmo princípio de "nunca
  exclusão física" já vigente desde M1-C.
- `sellers.is_active` sincronizado para `false` na mesma transação, quando
  aplicável — novas atribuições impedidas.
- Ações históricas (`created_by_profile_id`, `actor_profile_id`,
  `seller_id` em leads/timeline/deals/sales) continuam exibindo o autor/
  vendedor original — cadeia de identidade (`leads.seller_id → sellers →
  company_memberships → profiles`) nunca é rompida por um desligamento.
- `platform_role` nunca é alterado por este contrato.
- Nenhum `DELETE` em nenhum ponto.
- Motivo administrativo **obrigatório** — §24.12.

**Último Manager — regra congelada** (aplica-se igualmente a §24.4
suspensão, a este desligamento, e à saída da origem em §24.7
transferência): o último Manager ativo de uma empresa nunca é suspenso,
nunca é desligado e nunca é transferido para fora da empresa por essas
RPCs. A operação exige que já exista **outro** Manager ativo na mesma
empresa **antes** da chamada — nunca promove um sucessor automaticamente
na mesma operação (promover um Seller a Manager continua sendo uma ação
prévia e separada, já descrita em §12 do documento base). O código de
erro reutilizado é `last_manager_requires_successor` — o mesmo já
implementado e testado por `update_membership_role` (S5-C) para troca de
papel, sem necessidade de um código novo.

**`offboarded` volta a `active`? Decisão: não por `reactivate_membership`.**
Uma reativação **implícita/silenciosa** de um desligamento é
deliberadamente **rejeitada** — desligamento é uma decisão administrativa
de maior gravidade (mesma categoria de "conta comprometida"/"saída
definitiva" já descrita em §10.2 para `deactivated`), e tratar
`offboarded → active` pelo mesmo botão/contrato de "reativar suspensão"
esconderia essa gravidade do ator e do log de auditoria. Uma pessoa que
volta a trabalhar numa empresa depois de desligada deve passar por um
**contrato explícito e distinto** — na prática, o fluxo de convite já
existente (`create_invite`/`accept_invite`), que cria uma nova avaliação
de papel/aceite, não um simples "desfazer" do desligamento anterior. Isso
é consistente com §24.7: a mesma máquina de estados que rejeita "desligar
e simplesmente reativar" é a que sustenta "transferir é sair + entrar de
forma atômica e auditada", nunca um atalho que perde o rastro da decisão
administrativa.

### 24.7 Transferência entre empresas — correção formal do S6-A0

**Correção**: o relatório do S6-A0 recomendou tratar transferência como
fora do escopo de uma RPC dedicada do S6, compondo-a como
`offboard_*` + convite. Essa recomendação foi **revogada em S6-D0 e
permanece revogada** — o próprio §22.11 deste documento já registrava,
antes mesmo do S6-A0, que "transferência de usuário entre empresas...
pertence ao S6, não está fora do M1-F". O S6-A0 deveria ter lido essa
decisão prévia como vinculante e não a revisitou; esta seção formaliza a
correção definitivamente. **Transferência entre empresas permanece
dentro do S6.**

Nome congelado da RPC: **`transfer_membership`**
(`p_source_membership_id, p_target_company_id, p_target_role,
p_successor_id | null, p_note`).

Contrato conceitual congelado:

- Ator: **somente Super Admin** (`is_platform_super_admin()`) — nunca
  Manager, mesmo o da empresa de origem (§24.3).
- Sucessor opcional para reatribuição de leads/tarefas na origem (mesmo
  parâmetro de `offboard_seller`/`offboard_manager`, reaproveitado) —
  sujeito à mesma regra de último Manager de §24.6 quando a origem
  perderia seu último Manager ativo.
- **Ordem determinística de locks**: as duas empresas (origem e destino)
  são bloqueadas em ordem determinística (ex.: `company_id` ascendente),
  não na ordem em que aparecem nos parâmetros — evita deadlock entre duas
  transferências concorrentes envolvendo o mesmo par de empresas em
  direções opostas. Mesmo espírito do "ordered locks (empresa→membership→
  profile→seller)" já usado no backend de e-mail (S5-E1-A).
- Valida último `manager` na origem antes de prosseguir (§24.6) — a saída
  da origem tem exatamente o mesmo efeito de um desligamento sobre a
  empresa de origem.
- A membership de origem **nunca tem `company_id` alterado** — trigger
  `company_memberships_check_mutation` já proíbe isso estruturalmente, e
  esta decisão reforça que a transferência nunca deve tentar contorná-lo.
  A membership de origem é preservada como registro histórico e marcada
  `lifecycle_status='offboarded'`.
- No destino: cria uma **nova** linha de `company_memberships`
  (`lifecycle_status='active'`) ou reaproveita uma linha histórica já
  existente para o mesmo `(company_id, profile_id)` — mesmo padrão de
  reaproveitamento já implementado no ciclo `manager ↔ seller` do S5-C
  (§23.5: "cadastro histórico reaproveitado... religado e reativado;
  novo cadastro criado somente quando nunca existiu"). **Reutilizar uma
  membership histórica que hoje está `offboarded` no destino é permitido
  exclusivamente dentro deste contrato de transferência** — não é uma
  brecha para `reactivate_membership` reviver um desligamento por outra
  via; é o próprio `transfer_membership`, com sua própria autorização
  (Super Admin) e sua própria auditoria, decidindo explicitamente trazer
  a pessoa de volta àquela empresa como parte da operação de
  transferência, nunca silenciosamente.
- Índice único de membership ativa continua garantindo no máximo uma
  membership `active` por profile — a transferência só é válida se a
  origem sai de `active` **antes ou na mesma instrução** em que o destino
  entra em `active` (mesma transação, sem janela intermediária observável
  de fora).
- **Nenhuma etapa por convite** — `transfer_membership` é atômica e
  autossuficiente; não compõe com `create_invite`/`accept_invite` (essa
  composição foi a recomendação do S6-A0, já revogada acima).
- Nunca usa `DELETE`.
- `sellers` da origem é preservado intacto (histórico de leads/vendas
  daquela empresa não muda de dono). No destino, cria ou reaproveita um
  `sellers` **daquele profile especificamente** — nunca "sequestra" um
  `sellers` que pertence a outro profile, mesmo que aparentemente livre.
- Auditoria: **uma linha** por chamada (`membership_transferred`, §24.13),
  com `before_data`/`after_data` carregando os identificadores de origem
  e destino (`company_id` de cada lado, `membership_id` de cada lado) —
  suficiente para reconstruir o evento sem precisar de linhas coordenadas
  separadas. A auditoria registra explicitamente que o desligamento da
  origem ocorreu **por transferência**, não por um `offboard_*` comum
  (distinção feita pelo próprio `action='membership_transferred'`, não
  por um estado de `lifecycle_status` adicional).
- Motivo administrativo **obrigatório** — §24.12.
- Tudo em uma única transação — falha em qualquer etapa reverte a
  operação inteira (mesmo padrão de `offboard_seller`).

**Nenhum estado `lifecycle_status` adicional (`'transferred'`) é criado —
decisão fechada.** Os identificadores de origem/destino já registrados em
`audit_log` e a própria existência de uma nova membership `active` no
destino para o mesmo `profile_id` já reconstroem completamente "esta
membership foi encerrada porque a pessoa foi transferida" sem precisar de
um quarto valor na máquina de `lifecycle_status`. `offboarded` já é
semanticamente correto: do ponto de vista da empresa de origem, o
vínculo de fato terminou.

Não implementado nesta etapa.

### 24.8 Sessões — congelado

**Suspensão empresarial**:
- Não usar `ban_duration` (API real do Supabase Auth Admin, confirmada no
  S6-A0).
- Não tentar `admin.signOut(jwt)` — exigiria o JWT do usuário-alvo, que o
  servidor não possui.
- Não revogar globalmente a conta.
- Não desativa `profiles.is_active` — suspensão/desligamento/transferência
  empresarial nunca tocam a conta como um todo, só a membership-alvo.
- O bloqueio de acesso empresarial é feito pelo banco (`can_access_company`
  já nega no instante em que `is_active=false`/`lifecycle_status`
  mudam) — nenhuma ação adicional de Auth é necessária para a suspensão
  ter efeito real.
- O frontend deve limpar cache e recarregar identidade quando perceber
  perda de acesso (mesma infraestrutura de geração de cache do M1-D,
  §24.9 trata o gatilho de sessão).

**Desligamento empresarial**: mesma regra — não banir automaticamente a
conta inteira, não desativar `profiles.is_active`. A pessoa pode, no
futuro, pertencer a outra empresa (inclusive via transferência, §24.7);
banir a conta Auth encerraria essa possibilidade sem necessidade.

**Transferência**: não revogar globalmente a conta, não desativar
`profiles.is_active`; invalidar dados/cache da empresa anterior (mesma
infraestrutura de geração de cache); o backend passa a autorizar somente
o novo vínculo assim que a transação da transferência é commitada —
`can_access_company` já reflete isso automaticamente, sem código de
sessão adicional.

**Desativação global de profile** (`profiles.is_active=false`): é um
contrato **diferente**, fora do escopo de qualquer uma das três operações
acima. Pode, no futuro, justificar bloqueio de Auth (`ban_duration`/
`deleteUser`) — mas isso não pertence às operações comuns de membership e
**não é implementado nesta etapa** nem decidido em detalhe aqui.

### 24.9 `AuthService.restoreSession()` — achado registrado, não corrigido

Achado do S6-A0 reafirmado: `AuthService.restoreSession()`
(`lib/services.ts`) não executa `signOut()` quando o carregamento do
profile falha, ao contrário de `login()`, que já faz isso. Classificado
como **hardening separado do S6** — não é uma correção deste estágio nem
bloqueia o início do S6-B.

Definição para quando essa correção for feita (fora desta etapa):
- Limpar a sessão (`signOut()`) quando o `profile` não existir ou
  estiver **globalmente** inativo (`profiles.is_active=false`) — mesmo
  critério que já dispara em `login()`.
- **Não** encerrar a sessão apenas porque uma membership específica foi
  suspensa (`lifecycle_status='suspended'`) — a conta continua válida,
  só o acesso comercial daquela empresa é que cai; encerrar a sessão
  inteira seria mais agressivo do que a decisão de suspensão pretende.
- Limpar o cache empresarial (query cache/generation) quando não houver
  `activeMembership` — independentemente do motivo (suspenso, desligado
  ou nunca teve membership).
- Preservar o comportamento atual de Super Admin sem `activeMembership`
  (`activeMembership: null` é esperado e válido para Super Admin — não
  deve disparar nenhuma lógica de "sessão inválida").

O momento exato de implementar essa correção (dentro do S6-E ou como
hardening totalmente independente da numeração do S6) é um detalhe de
sequenciamento de implementação, não uma decisão que bloqueia o início do
S6-B. Nenhuma alteração de código foi feita nesta etapa.

### 24.10 Super Admin fora do ciclo empresarial — congelado

- As funções empresariais do S6 (suspensão, reativação, desligamento,
  transferência) **nunca alteram `platform_role`**.
- Super Admin não é suspenso nem desligado **da plataforma** por essas
  funções — elas operam exclusivamente sobre `company_memberships`.
- Se um Super Admin possuir uma `company_memberships` (cenário hoje
  incomum, mas estruturalmente possível), ações empresariais do S6 sobre
  essa membership específica são **rejeitadas inicialmente** — mesmo
  padrão já usado em `update_membership_role` (S5-C), que já nega
  qualquer alteração de role/estado quando o alvo é Super Admin.
- Eventual gestão de Super Admin (promoção, remoção, proteção de último
  Super Admin) pertence a uma **superfície global separada**, fora do S6
  empresarial.
- **`last_super_admin_cannot_be_removed` não é criado no S6 empresarial**
  — nem como RPC, nem como trigger, nem como guarda dentro de
  `suspend_membership`/`offboard_seller`/`offboard_manager`/
  `transfer_membership`. Isso corrige a proposta de divisão do S6-A0, que
  havia incluído essa guarda como uma sub-etapa do S6 (S6-C) — não há
  nenhuma sub-etapa dedicada a isso na divisão final (§24.15).

### 24.11 MFA fora de escopo — congelado

- MFA permanece inteiramente fora do S6 (reafirma S6-A0).
- Nenhuma tela de enrollment existe hoje no frontend.
- Nenhuma remoção administrativa de fator (`admin.mfa.deleteFactor`) será
  implementada nesta etapa nem em nenhuma sub-etapa do S6.
- MFA deverá ter uma etapa própria e futura, fora da numeração atual do
  S6 (S9+ ou dedicada, a decidir quando houver requisito real).
- Nenhuma decisão de suspensão, desligamento ou transferência depende de
  MFA nem deve referenciá-lo — os dois assuntos não se misturam em
  nenhum contrato do S6.

### 24.12 Motivo administrativo — congelado

| Operação | Motivo (`p_note`/`reason`) |
|---|---|
| Suspensão (`suspend_membership`) | **Obrigatório** |
| Desligamento (`offboard_seller`/`offboard_manager`) | **Obrigatório** |
| Transferência (`transfer_membership`) | **Obrigatório** |
| Reativação (`reactivate_membership`) | Opcional |

Regras para a implementação futura (não decididas em detalhe numérico
nesta etapa, mas o formato é congelado):
- `trim` antes de qualquer validação/gravação;
- limite mínimo e máximo de tamanho **definidos na implementação** (S6-B/
  S6-C/S6-D) — não é uma decisão bloqueante para começar, é um detalhe de
  migration;
- nunca conter segredos, tokens ou senha (mesmo princípio já vigente para
  todo `audit_log`, §14.1 do documento base);
- armazenado **somente** em `audit_log.reason` — nunca em
  `company_memberships` ou qualquer outra tabela operacional;
- **nunca usado como autorização** — o motivo é texto livre informativo
  para auditoria, jamais uma condição lida por RLS/helper/RPC para decidir
  se a operação é permitida.

### 24.13 Contratos futuros (nomes congelados)

- `suspend_membership(p_membership_id, p_note)` — nome e assinatura
  congelados.
- `reactivate_membership(p_membership_id, p_note)` — nome e assinatura
  congelados.
- `offboard_seller(p_seller_membership_id, p_successor_seller_id | null,
  p_note)` / `offboard_manager(p_manager_membership_id,
  p_successor_profile_id | null, p_note)` — **mantidos separados**,
  decisão fechada em §24.6.
- `transfer_membership(p_source_membership_id, p_target_company_id,
  p_target_role, p_successor_id | null, p_note)` — nome e assinatura
  congelados em §24.7.

**Nunca criar**: `update_user_status` genérico; `PATCH` arbitrário; corpo
JSON de campos livres; `DELETE` em qualquer uma dessas tabelas; alteração
dinâmica de coluna por nome; `offboard_membership` genérico (decisão
fechada, §24.6). `revoke_user_sessions` **não é criado** para suspensão
comum (§24.8 já resolve isso via `can_access_company`, sem precisar de
revogação ativa).

### 24.14 Leitura administrativa de memberships não ativas (listagem futura) — congelado

`list_company_users` (S5-A2) retorna **somente** membros ativos hoje e
**não é ampliado nem tem seu contrato quebrado** por esta decisão — o
filtro de lifecycle não entra nessa RPC.

**Decisão fechada: opção B — RPC separada** dedicada ao ciclo empresarial
(nome a definir na implementação, ex.: `list_company_memberships_by_lifecycle`).
Uma RPC separada preserva o contrato já testado e publicado de
`list_company_users` intacto (nenhum risco de regressão na tela "Usuários
ativos" já em produção-código), e uma tela de ciclo de vida
(suspensos/desligados) é conceitualmente uma superfície diferente, não
uma variação de filtro da mesma lista.

Requisitos congelados para essa RPC nova, sem implementar agora:
- assinatura clara, com paginação server-side (mesmo padrão de cursor já
  usado por `list_company_users`, §23.2);
- aceita filtro de `lifecycle_status` (`suspended`, `offboarded`, ou
  ambos);
- não quebra o contrato atual de `list_company_users`;
- não retorna dados sensíveis além do já exposto hoje (sem e-mail
  completo além do que já é exposto, sem dados de sessão/Auth);
- isolamento empresarial preservado (mesmo `can_access_company`/
  `require_company_access` de sempre).

**Escopo por ator, congelado**:
- **Super Admin**: visualiza Managers e Sellers inativos
  (`suspended`/`offboarded`) globalmente; pode filtrar por empresa.
- **Manager**: visualiza **somente** Sellers suspensos ou desligados da
  própria empresa — **não** visualiza Managers inativos por essa
  superfície (mesma fronteira de §24.3: Manager nunca enxerga outro
  Manager além do que já vê hoje em `list_company_users`).

Não implementado nesta etapa.

### 24.15 Divisão final do S6 (oficial)

Divisão oficial revisada e consolidada — substitui integralmente a
proposta do S6-A0 (que incluía uma sub-etapa dedicada a "último Super
Admin", removida por §24.10, e tratava transferência como fora de uma RPC
dedicada, corrigido por §24.7):

| Sub-etapa | Escopo | Decisão humana pendente antes de iniciar? |
|---|---|---|
| **S6-A** | Auditoria inicial (M1-F S6-A0) | Concluída |
| **S6-D0/S6-D1** | Congelamento e publicação das decisões do ciclo empresarial (esta seção) | Concluída — é a etapa atual |
| **S6-B** | `lifecycle_status`; compatibilidade com `is_active`; `suspend_membership`; `reactivate_membership`; sincronização de `sellers.is_active`; guarda do último Manager; testes SQL; tipos gerados | **Não** — desbloqueada nesta etapa; modelo de schema (§24.2), permissões (§24.3) e nomes dos contratos (§24.13) já congelados |
| **S6-C** | `offboard_seller`; `offboard_manager`; sucessor; reatribuição operacional; auditoria; testes SQL; tipos | **Não** — contratos separados já congelados (§24.6/§24.13) |
| **S6-D** | `transfer_membership`; origem e destino; reutilização histórica; Seller no destino; concorrência; testes SQL; tipos | **Não** — contrato, nome e ausência de estado `'transferred'` já congelados (§24.7/§24.13) |
| **S6-E** | Leitura administrativa de suspensos/desligados; hardening de `restoreSession`; cache e identidade; repositories e hooks | **Não** — opção B de listagem já congelada (§24.14); timing exato da correção de `restoreSession` (§24.9) é detalhe de implementação, não decisão bloqueante |
| **S6-F** | Interface; ações; modais; filtros; flag própria; testes TypeScript | **Não** — segue direto até push, depois que S6-B–S6-E estiverem implementadas |
| **S6-G** | Auditoria integrada; documentação; fechamento (mesmo padrão de S5-F) | **Não** — é fechamento factual, não decisão nova |

**MFA permanece inteiramente fora do S6** (§24.11). **Gestão global de
Super Admin permanece fora do S6** (§24.10) — nenhuma sub-etapa a
referencia.

### 24.16 Decisões pendentes — estado final

Todas as decisões anteriormente listadas como pendentes em S6-D0 foram
resolvidas e congeladas nesta revisão (S6-D1):

1. ~~Nome final de `lifecycle_status`/enum~~ — congelado em §24.2
   (`company_memberships.lifecycle_status`, enum
   `membership_lifecycle_status`).
2. ~~`offboard_seller`/`offboard_manager` separados vs. contrato único~~
   — congelado em §24.6: **mantidos separados**.
3. ~~Nome final de `transfer_membership` e estado `'transferred'`~~ —
   congelado em §24.7: nome fixado, nenhum estado adicional.
4. ~~Opção A vs. B para leitura de inativos, e escopo do Manager~~ —
   congelado em §24.14: **opção B**, Manager só vê Sellers inativos.
5. ~~Timing da correção de `restoreSession`~~ — classificado em §24.9
   como detalhe de sequenciamento de implementação, não decisão
   bloqueante.

**Nenhuma decisão humana bloqueante resta para iniciar o S6-B.** Os
únicos itens em aberto são detalhes de implementação (nomes finais de
RPCs auxiliares não citadas explicitamente aqui, limites numéricos de
`p_note`, nome exato da RPC de listagem de inativos) — nenhum deles muda
o modelo de schema, as permissões ou os contratos já congelados neste
documento, e todos ficam a critério de quem implementar cada sub-etapa.

### 24.17 Confirmações finais

Nenhuma implementação do S6 foi iniciada em nenhuma sub-etapa, em
nenhuma das duas revisões (S6-D0, S6-D1). Nenhuma migration do S6 existe
no repositório. Nenhuma operação remota (migration, SQL, alteração de
usuário, Auth) foi executada durante o congelamento e a consolidação
destas decisões — toda esta seção é documentação de decisão, escrita e
revisada localmente. **O S6-B está desbloqueado** — pode ser iniciado sem
nenhuma decisão humana pendente de aprovação.

## 25. Fechamento do S6 — ciclo empresarial de usuários

Esta seção registra o fechamento factual do S6 (§24 → implementação),
mesmo padrão de §23 (fechamento do S5). Nenhuma decisão nova é tomada
aqui — só o estado real do código-fonte, auditado diretamente (não por
memória de sessão anterior) em 2026-07-28, antes de qualquer commit
desta etapa.

**HEAD oficial imediatamente antes desta etapa (S6-G)**:
`8e5887607a7e74bc853100563a339d504a1d9ab6` — publicado em
`origin/main`, working tree limpa, zero ahead/behind.

### 25.1 Entregas — S6-A até S6-F (incluindo S6-E2)

Todas **implementadas no código-fonte e publicadas no GitHub**:

- **S6-A / S6-D0 / S6-D1**: auditoria inicial e decisões congeladas
  desta seção (§24) — modelo `active`/`suspended`/`offboarded`, matriz
  de permissões, contratos de suspensão/reativação/desligamento/
  transferência, MFA e gestão global de Super Admin fora de escopo.
- **S6-B** (`20260727130000_m1f_s6b_membership_lifecycle.sql`): enum
  `membership_lifecycle_status`, coluna `company_memberships.
  lifecycle_status`, `suspend_membership`/`reactivate_membership`,
  sincronização de `sellers.is_active`, guarda do último Manager ativo.
  `suspend_membership` sobre membership já `offboarded` é rejeitado
  explicitamente (`membership_lifecycle_conflict`), nunca silencioso —
  o único caminho idempotente é `suspended` → `suspended`.
  `reactivate_membership` rejeita `offboarded` pelo mesmo código, na
  direção espelhada.
- **S6-C** (`20260728100000_m1f_s6c_membership_offboarding.sql`):
  `offboard_seller`/`offboard_manager`. Leads abertos (`archived_at is
  null`) do Seller desligado são reatribuídos ao sucessor na mesma
  transação; leads arquivados nunca são tocados (fora do filtro do
  `UPDATE`). `offboard_manager` não reatribui nenhum dado operacional
  (nenhuma tabela referencia Manager como "dono" de forma análoga a
  `leads.seller_id`).
- **S6-D** (`20260728110000_m1f_s6d_membership_transfer.sql`):
  `transfer_membership`, transação única (`begin`/`commit`, sem
  commit parcial). Origem nunca apagada — sempre transicionada para
  `offboarded`. Destino: nova `company_memberships` criada, ou uma
  linha `offboarded` histórica reaproveitada (nunca uma `suspended`,
  tratada como `transfer_state_conflict`). Seller no destino criado ou
  reaproveitado quando o papel final é `seller`. Guarda do último
  Manager também se aplica à origem.
- **S6-E** (`20260728120000_m1f_s6e_inactive_listing.sql` +
  `lib/inactiveUsers/*` + `lib/hooks/useInactiveCompanyUsers.ts`):
  `list_inactive_company_users` (rejeita explicitamente
  `p_lifecycle='active'` com `invalid_lifecycle`).
  `AuthService.restoreSession()` endurecido: profile inexistente ou
  globalmente inativo agora encerram a sessão Auth (`signOut()`) —
  antes só ocorria em `login()`. `useQueryCacheIdentity`/`App.tsx`
  passaram a derivar `companyId`/`membershipRole` de
  `activeMembership`, nunca do `profiles.company_id` legado.
- **S6-E2** (`20260728130000_m1f_s6e2_offboard_seller_successor_
  hardening.sql`): assinatura antiga `offboard_seller(uuid, text,
  text)` removida por `DROP FUNCTION` explícito; nova assinatura
  `offboard_seller(p_seller_membership_id uuid,
  p_successor_membership_id uuid, p_note text)`. `sellers.id`/
  `seller_id` (text) nunca é parâmetro de entrada em nenhuma RPC do
  S6 — só aparece nas colunas de retorno (`seller_id`,
  `successor_seller_id`), informativo, nunca autorização. Sucessor é
  resolvido internamente via `sellers.membership_id =
  p_successor_membership_id`. `successor_required` é levantado quando
  o Seller alvo tem leads abertos e nenhum sucessor foi informado —
  sem leads abertos, sucessor continua opcional (comportamento
  idêntico ao S6-C original).
- **S6-F** (retomada da interface, commits `350785c`..`22af110`,
  testes em `8e58876`): `InactiveUserList` (lista de suspensos/
  desligados, busca, filtros de papel/status/empresa, paginação),
  ações Suspender/Reativar/Desligar/Transferir centralizadas em
  `MembershipLifecycleActions` a partir de
  `membershipLifecycleCapabilities()` (`lib/capabilities.ts`), cinco
  modais dedicados com confirmação explícita, cinco hooks
  (`useSuspendMembership`/`useReactivateMembership`/
  `useOffboardSeller`/`useOffboardManager`/`useTransferMembership`)
  seguindo o molde de invalidação de cache já estabelecido em S5-D/S6-E,
  flag própria `NEXT_PUBLIC_FF_USER_LIFECYCLE` (só tem efeito combinada
  com `NEXT_PUBLIC_FF_ACTIVE_USERS`). Nenhuma RPC de listagem nova foi
  criada para resolver o bloqueio de sucessor identificado na primeira
  tentativa de S6-F — a correção real foi o hardening do contrato de
  `offboard_seller` no S6-E2, e todos os seletores de sucessor
  reaproveitam `list_company_users` (já publicada em S5-A2), nunca
  SELECT direto em `sellers`, nunca o store legado local de Sellers.

Nenhuma entrega oficial do S6 (§24.15) está ausente.

### 25.2 Lifecycle final e matriz de atores

Estado final: `active` / `suspended` / `offboarded`, com
`(lifecycle_status = 'active') = is_active` garantido por CHECK
(`company_memberships_lifecycle_is_active_ck`, S6-B) — nunca por
disciplina de aplicação. `suspended` é reversível (`active` ↔
`suspended`); `offboarded` é definitivo, nunca revertido por
`reactivate_membership`.

| Ator | Alvo `active` | Alvo `suspended` | Alvo `offboarded` |
|---|---|---|---|
| Super Admin | Suspender, Desligar, Transferir | Reativar, Desligar, Transferir | Somente leitura |
| Manager (só Seller da própria empresa) | Suspender, Desligar | Reativar, Desligar | Somente leitura |
| Manager sobre outro Manager | Nunca | Nunca | Nunca |
| Seller | Nenhuma ação administrativa | Nenhuma ação administrativa | Nenhuma ação administrativa |

Nenhum ator (incluindo Super Admin) age sobre a própria membership ou
sobre outro Super Admin — reforçado em profundidade na UI
(`membershipLifecycleCapabilities`), com o backend (as cinco RPCs) como
autoridade real: as RPCs de listagem (`list_company_users`/
`list_inactive_company_users`) nunca devolvem `platform_role` do alvo,
então a UI não pode detectar "alvo é Super Admin" sozinha — a proteção
real contra esse caso específico é inteiramente do backend
(`forbidden`), não da interface.

### 25.3 Sucessores e preservação de histórico

- `offboard_seller`: sucessor = `p_successor_membership_id` (uuid de
  `company_memberships`). Obrigatório somente quando o alvo tem leads
  abertos (`successor_required` quando ausente nesse caso).
- `offboard_manager`: sucessor = `p_successor_profile_id` (uuid de
  `profiles`) — precisa já ser Manager ativo da mesma empresa; nunca
  promovido implicitamente. Obrigatório somente quando o alvo é o
  último Manager ativo (`last_manager_requires_successor`).
- `transfer_membership`: sucessor = `p_successor_id` (uuid de
  `profiles`), sempre da empresa de **origem**, com o mesmo papel do
  alvo — resolvido internamente pela RPC. Obrigatório quando a origem é
  o último Manager ativo, ou quando o Seller de origem tem leads
  abertos.
- Em nenhum dos três contratos `sellers.id`/`seller_id` (text) é
  parâmetro de entrada.
- Preservação de histórico: nenhuma linha de `company_memberships`,
  `sellers` ou `leads` é apagada por nenhuma das cinco RPCs (confirmado
  por grep de `delete from` nas quatro migrations do S6 — zero
  ocorrência). `sellers.membership_id`/`profile_id` são preservados
  após desligamento (`is_active=false`, nunca desvinculados). Leads
  arquivados nunca mudam de dono; leads abertos são reatribuídos só
  quando há sucessor.

### 25.4 Módulos ainda não persistidos no Postgres

Confirmado por leitura de todas as migrations (`grep -i "create
table"`): as únicas tabelas comerciais/operacionais reais no Postgres
são `public.leads` e `public.lead_timeline_entries`. **Não existem**
tabelas `tasks`, `visits`, `deals`, `sales` ou `proposals` — os módulos
correspondentes (`TaskService`, `VisitService`, `DealService`,
`SaleService` em `lib/services.ts`) continuam sendo estado em memória
local (`StoreAdapter`), nunca sincronizado com o Supabase.

Por isso, o S6 (offboarding e transferência) reatribui exclusivamente
`public.leads` — a única tabela real cujo "dono" (`seller_id`) precisa
de reatribuição quando um Seller é desligado ou transferido. Nenhuma
tabela nova, coluna ou RPC placeholder foi criada para simular
reatribuição desses módulos ainda não migrados. Quando
tarefas/visitas/negociações/propostas/vendas forem migradas ao
Postgres (fora do escopo do M1-F), os contratos de `offboard_seller`/
`offboard_manager`/`transfer_membership` precisarão ser estendidos para
cobri-los — isso é trabalho futuro explícito, não uma lacuna do que já
foi entregue sobre os dados que hoje realmente existem no banco.

### 25.5 `restoreSession` e cache

- Profile inexistente **ou** globalmente inativo (`profiles.is_active
  = false`) → `restoreSession()` chama `supabase.auth.signOut()`,
  nunca deixa uma sessão Auth órfã (`lib/services.ts`, hardening do
  S6-E — antes essa checagem só existia em `login()`).
- Membership suspensa ou desligada **não** encerra a conta Auth — o
  usuário continua autenticado, só perde `activeMembership` (e,
  portanto, acesso empresarial). Um usuário sem membership ativa
  (incluindo Super Admin, que nunca tem uma) é um estado normal e
  estável, nunca tratado como sessão inválida.
- `useQueryCacheIdentity` deriva `companyId`/`membershipRole` de
  `activeMembership`, não de `profiles.company_id` legado — troca de
  empresa (via `transfer_membership`), papel (seller↔manager) ou
  perda/ganho de membership ativa aciona `resetQueryCache`, descartando
  os dados da empresa anterior. `logout()` continua limpando o cache
  pelo caminho já existente (`AuthCacheBoundary`).

### 25.6 Interface (S6-F)

Aba "Usuários" na ordem congelada: Usuários ativos → Usuários
suspensos e desligados → Convites. `InactiveUserList` só renderiza sob
`NEXT_PUBLIC_FF_USER_LIFECYCLE` combinada com
`NEXT_PUBLIC_FF_ACTIVE_USERS`; as ações de ciclo de vida em
`ActiveUserList` usam o mesmo par de flags via o prop aditivo
`lifecycleEnabled` (default `false`, zero regressão sobre o S5-D já
publicado).

### 25.7 Feature flags — estado real

| Flag | Default | Depende de | Controla |
|---|---|---|---|
| `NEXT_PUBLIC_FF_ACTIVE_USERS` | `false` | — | Listagem/edição de usuários ativos (S5-D) |
| `NEXT_PUBLIC_FF_USER_EMAIL_EDIT` | `false` | `ACTIVE_USERS` | Edição administrativa de e-mail (S5-E1) |
| `NEXT_PUBLIC_FF_USER_LIFECYCLE` | `false` | `ACTIVE_USERS` | Suspender/reativar/desligar/transferir + listagem de inativos (S6) |

Nenhuma das três está ativada em nenhum arquivo versionado. Com as três
desligadas, nenhum contrato novo do S6/S5-E1 é chamado e o comportamento
de Convites permanece idêntico ao já publicado — confirmado pela
suíte de testes existente (`tests/screens/ScreenAjustes*.test.tsx`).

### 25.8 Migrations ainda não aplicadas remotamente

Nenhuma migration M1-F (S1 até S6-E2, 32 migrations locais no total)
foi confirmada aplicada no Supabase remoto em nenhum momento desta
linha do tempo. Toda a interface do S6-F está **implementada no
código, publicada no GitHub, protegida por flag — banco remoto
pendente**. Nenhuma operação remota de banco foi executada durante o
S6-G.

### 25.9 Totais finais das suítes e build

Validação local desta etapa (S6-G), Docker reiniciado, sem reaproveitar
estado de sessão anterior:

- Migrations locais: 32.
- SQL (pgTAP): 39 arquivos, 1998/1998 — `Result: PASS`.
- TypeScript (vitest): 93 arquivos, 1497/1497.
- Build (`next build`): compilação limpa, 8/8 páginas geradas.

**E2E não foi executado** — não existe infraestrutura de E2E
(Playwright/Cypress ou similar) neste repositório; a suíte de
integração existente (`tests/integration/*.test.tsx`) cobre fluxos
compostos via Testing Library, não navegador real. Isso continua
verdadeiro nesta etapa — nenhuma cobertura de banco/E2E é inventada
para além do que existe de fato.

### 25.10 Riscos residuais

- Nenhuma migration M1-F aplicada remotamente — todo o S6 (e o M1-F
  inteiro) depende de um deploy real futuro para operar em produção.
- `tasks`/`visits`/`deals`/`sales`/`proposals` continuam sem
  persistência real — qualquer desligamento/transferência de usuário
  hoje não afeta esses módulos (correto, pois eles não existem no
  banco), mas isso deixa de ser verdade no dia em que forem migrados,
  e os contratos precisarão ser revisitados nesse momento.
- `.env.local.example` não documentava `NEXT_PUBLIC_FF_ACTIVE_USERS`/
  `NEXT_PUBLIC_FF_USER_EMAIL_EDIT`/`NEXT_PUBLIC_FF_USER_LIFECYCLE`
  antes desta etapa — corrigido nesta mesma etapa (S6-G).
- A UI de ciclo de vida não pode detectar sozinha "alvo é outro Super
  Admin" (as RPCs de listagem não devolvem `platform_role` do alvo) —
  a proteção real contra essa ação continua sendo exclusivamente do
  backend, não uma lacuna nova, mas uma limitação estrutural herdada
  do design já aprovado em §22.5 (lista de usuários nunca expõe
  `platform_role`).

### 25.11 Plano de rollout futuro

Nenhum destes passos foi executado nesta etapa — é só o roteiro para
quando o deploy remoto real acontecer, complementando o plano de 12
passos já registrado em §23.8 com os passos específicos do S6:

1. Backup e definição de janela de manutenção.
2. Confirmar o estado remoto real das migrations M1-F (nenhuma
   aplicada, segundo todo o histórico desta linha do tempo).
3. Aplicar as 32 migrations locais em ordem, sem pular nenhuma.
4. Validar catálogo de funções, grants e RLS no ambiente remoto pós-
   aplicação (mesma checklist já usada nas auditorias locais).
5. Testar login e convites (fluxo já em produção, não deve regredir).
6. Testar a listagem de usuários ativos manualmente contra o remoto.
7. Testar alteração de nome, papel e e-mail manualmente.
8. Ativar `NEXT_PUBLIC_FF_ACTIVE_USERS`.
9. Smoke test da seção "Usuários ativos" em produção.
10. Ativar `NEXT_PUBLIC_FF_USER_EMAIL_EDIT`.
11. Smoke test da alteração de e-mail em produção.
12. Ativar `NEXT_PUBLIC_FF_USER_LIFECYCLE`.
13. Testar suspensão em produção (empresa/usuário de teste controlado).
14. Testar reativação em produção.
15. Testar desligamento de Seller com sucessor controlado (empresa de
    teste, nunca dados reais de cliente).
16. Testar transferência entre duas empresas de teste controladas.
17. Manter rollback imediato das três flags disponível durante toda a
    janela de observação pós-ativação.

### 25.12 Estado dos módulos vizinhos

- **S7** (seletor global de empresa) e **S8** não foram iniciados —
  nenhum arquivo, nenhuma decisão além da fronteira já registrada em
  §22.11.
- **M1-E E4** (create/edit remotos de leads) continua pausado, sem
  alteração nesta etapa.
- **Nenhuma operação remota** (migration, SQL, Auth, alteração de
  usuário) foi executada durante o S6-G — toda a validação desta etapa
  rodou exclusivamente no stack Docker local.

**O S6 está oficialmente encerrado no código-fonte e publicado no
GitHub.** Nenhuma sub-etapa está ativa em produção — todas as flags
permanecem desligadas e nenhuma migration M1-F foi aplicada
remotamente.

## 26. Decisões congeladas do S7 — filtro contextual de empresa

Esta seção congela as decisões de arquitetura do S7 (seletor/filtro de
empresa para Super Admin), com base na auditoria factual do S7-A0
(2026-07-28, leitura direta do código-fonte, não memória de sessão
anterior). Nenhuma implementação foi iniciada nesta etapa (S7-A1) —
só decisão e documentação.

### 26.1 Achado de partida (S7-A0)

Confirmado por auditoria: **nenhuma forma de `selectedCompanyId` existe
em runtime hoje** — o termo aparece somente no design conceitual
pré-S1 (§7.5–§7.9, escrito antes de qualquer implementação do M1-F) e
em testes/SQL que **afirmam sua ausência**. O único precedente real e
testado é o filtro local `companyFilter` já existente em
`ActiveUserList`/`InactiveUserList` — estado React não persistido,
resetado a cada troca de identidade, enviado ao servidor só como
`p_company_id` opcional que a RPC usa para **estreitar** (nunca
ampliar) a visão já autorizada de um Super Admin, e **ignorado por
completo** para Manager. Esta seção parte desse precedente, não do
design conceitual de §7.5–§7.9 tomado ao pé da letra — a arquitetura
real construída em S1–S6 (`company_memberships`, `activeMembership`,
RLS por `can_access_company`/`is_platform_super_admin`) é mais recente
e mais específica que aquele esboço.

### 26.2 Localização — decisão congelada

**O S7 não cria, nesta fase, um seletor no cabeçalho global do CRM.**
O filtro é **contextual**: aparece somente em telas com contrato real
e seguro de filtro por empresa. Primeira superfície: a aba de
**Usuários** do Super Admin (usuários ativos, usuários
suspensos/desligados, e convites **somente se** o contrato atual
aceitar o filtro com segurança — a auditar em S7-B/S7-C, nunca
presumido).

**Nunca aparece em**: Leads, Pipeline, Dashboard, Relatórios, Tarefas,
Visitas, Negociações, Propostas, Vendas, Empresas. Motivo: nenhuma
dessas telas possui hoje suporte completo e seguro a uma visão
contextual de Super Admin (Leads/Pipeline dependem de RLS ainda
baseada em helpers legados de empresa única; Tarefas/Visitas/
Negociações/Propostas/Vendas não são persistidas no Postgres, §25.4;
Empresas já É a visão global, sem "o que filtrar por empresa";
Dashboard/Relatórios não existem em forma Super-Admin-aware). Não criar
a impressão de que a seleção altera toda a plataforma.

### 26.3 Significado — decisão congelada

A seleção de empresa é **somente**: filtro visual, preferência
temporária da tela, parâmetro que estreita consultas já autorizadas.
**Nunca representa**: login em uma empresa, troca de membership,
`activeMembership`, autorização, impersonação, mudança de sessão,
mudança de `platform_role`. Backend/RPCs/RLS continuam sendo a única
proteção real — exatamente o mesmo princípio já provado pelo
`companyFilter` existente (§26.1).

Nomenclatura proibida (carrega semântica de identidade/sessão que este
conceito não tem): `activeCompany`, `currentCompany`, `activeTenant`,
`selectedMembership`. Nomenclatura preferida: `companyFilterId` /
`companyScopeFilter` / `focusedCompanyId` — este último só se
claramente documentado como visual, nunca como identidade.

### 26.4 Visão global — decisão congelada

Estado inicial do Super Admin: **"Todas as empresas"** (`null`). Sem
seleção: usuários ativos e usuários inativos usam visão global;
convites permanecem globais conforme o contrato real já existente
(nenhuma mudança de contrato de convites nesta decisão). Manager e
Seller **não possuem** essa opção, não possuem seletor, continuam
usando exclusivamente `activeMembership` — nenhuma mudança em relação
ao comportamento já auditado no S7-A0.

### 26.5 Estado e persistência — decisão congelada

O filtro vive **apenas em estado React da superfície correspondente**
— mesmo modelo já comprovado por `companyFilter`. **Proibido nesta
fase**: `localStorage`, `sessionStorage`, Zustand/`lib/store.ts`
legado, cookie, banco, `profiles`, URL.

Regras: valor inicial `null` = visão global; troca de usuário limpa o
filtro; logout limpa o filtro; troca de tipo de ator (Super Admin ↔
Manager) limpa o filtro; empresa removida da lista acessível limpa o
filtro; empresa cancelada ou inacessível nunca permanece selecionada;
nova sessão sempre começa em visão global; outra aba do navegador não
herda automaticamente a seleção (mesmo princípio de isolamento por aba
já previsto em §7.7, agora aplicado ao modelo real). Persistência
futura (ex.: "última empresa vista" como conveniência visual) poderá
ser reconsiderada em etapa própria — nunca como autorização.

### 26.6 URL — decisão congelada

O S7 **não** coloca `companyId` na query string, no segmento de rota
ou no hash da URL. Motivos: nenhuma rota atual é escopada por empresa;
não existe necessidade de link compartilhável por empresa hoje; evita
aparência de contexto autorizado; reduz risco de enumeração e de
estados obsoletos. Reavaliação futura só quando existir uma tela real
que precise de link compartilhável por empresa — nesse momento o id na
rota seria parâmetro de página, sempre revalidado por
`can_access_company`, nunca ponteiro de sessão.

### 26.7 Fonte das empresas — decisão congelada

Exclusivamente `useCompanies`/`fetchAccessibleCompanies` (já auditado
em S7-A0) — a RLS determina o retorno, sem filtro client-side algum. O
filtro pode exibir ao Super Admin empresas em `implantação`, `ativa`,
`suspensa`; `cancelada` nunca aparece, conforme o contrato real já
confirmado. Exibir visualmente **nome e status** (o retorno já inclui
`status`). Empresa visível não implica operacional para qualquer ação
— as RPCs continuam validando cada operação (`company_not_operational`
etc.), sem exceção.

### 26.8 Cache — decisão congelada

A preferência visual **não** faz parte da identidade autenticada do
cache. **Não alterar**: `activeMembership`, `useQueryCacheIdentity`,
identidade global do ator, sessão Auth — nenhum desses hooks/objetos
ganha conhecimento do filtro de empresa. `companyFilterId` participa
somente das query keys das consultas que o consomem (mesmo mecanismo já
comprovado: `scope.companyId` dentro da key de `useCompanyUsers`/
`useInactiveCompanyUsers`). Troca Todas → Empresa A → Empresa B produz
chaves de query distintas — **nunca** um `resetQueryCache()` global só
por trocar o filtro visual (esse reset continua reservado a mudanças
reais de identidade — login/logout/mudança de membership). Paginação,
busca e filtros secundários da tela reiniciam quando a empresa muda
(consequência natural de uma chave de query nova, mesmo comportamento
já testado no `companyFilter` atual).

### 26.9 Tela de Usuários — decisão congelada

A implementação futura (S7-C) deve preferir **um único filtro
contextual compartilhado** pela tela de Usuários, controlando
`ActiveUserList` e `InactiveUserList` — e `InviteList` **somente se** o
contrato atual de `fetchInvites` suportar `companyId` com segurança sem
alteração de backend (auditar antes de implementar; ver achado do
S7-A0 de que `fetchInvites` já aplica um `.eq('company_id', ...)`
redundante sobre SELECT direto, nunca substituindo a RLS — precisa
confirmação explícita de que isso é suficiente para o filtro
contextual, não presumir). Se `InviteList` não aceitar o filtro com
segurança: não modificar backend silenciosamente, manter convites
globais, deixar claro visualmente que o filtro afeta só usuários, e
relatar antes de implementar. Não manter dois seletores independentes
de empresa na mesma tela quando um estado compartilhado seguro puder
existir.

### 26.10 `company_id` legado — decisão congelada

A auditoria do S7-A0 encontrou três consumidores restantes de
`currentUser.companyId`/`profiles.company_id` legado:
`components/screens/ScreensBiz.tsx:414` (`usePipelineStages`) e `:480`
(`useReorderStages`), e `lib/services.ts:364` (ponte de leads remotos,
M1-E).

**O S7-B corrigirá somente os dois consumidores de pipeline em
`ScreensBiz.tsx`**, trocando para `activeMembership.companyId`. Regras:
Manager/Seller usam a empresa da própria membership ativa; Super Admin
sem membership não ganha acesso ao pipeline por meio do
`companyFilterId` (o filtro contextual desta etapa nunca autoriza
pipeline — pipeline está fora do escopo visual do S7, §26.2); nenhum
`companyFilterId` é usado como autorização de pipeline em nenhuma
circunstância; mudança de membership/papel deve produzir as query keys
corretas (mesmo padrão já corrigido em `useQueryCacheIdentity` no
S6-E).

**O uso em `lib/services.ts` (ponte antiga de leads) permanece
intocado — fronteira explícita para o S8 e para a retomada do M1-E
E4.** O S7 não modifica essa ponte.

### 26.11 Feature flag futura — decisão congelada (não criada nesta etapa)

`NEXT_PUBLIC_FF_COMPANY_SELECTOR` — padrão `false`; só tem efeito para
Super Admin; sem dependência de segredo; rollback visual imediato;
ativa exclusivamente a superfície contextual aprovada em §26.2 (aba de
Usuários); não transforma nenhuma tela sem suporte em tela global; não
altera autorização. Mesmo molde estrutural das seis flags já
existentes (`lib/flags.ts`). Não criada nesta etapa — pertence ao
S7-B.

### 26.12 Divisão final do S7

| Sub-etapa | Escopo | Decisão humana pendente? |
|---|---|---|
| **S7-A0** | Auditoria factual do estado atual | Concluída |
| **S7-A1** | Congelamento documental (esta seção) | Concluída — é a etapa atual |
| **S7-B** | Corrigir os dois usos legados de `companyId` em `ScreensBiz.tsx`; criar estado/hook compartilhado do filtro contextual; validação contra `useCompanies`; query keys; feature flag; testes de estado/cache; **sem interface visual ampla** | **Não** — desbloqueada por esta seção |
| **S7-C** | Componente visual; integração na tela de Usuários (`ActiveUserList`/`InactiveUserList`/`InviteList` só se compatível); acessibilidade; testes de interface | **Não** — segue direto após S7-B |
| **S7-D** | Auditoria integrada; documentação; fechamento (mesmo padrão de S5-F/S6-G) | **Não** — fechamento factual |

**Depois desta seção (S7-A1), não resta decisão humana bloqueante para
iniciar o S7-B.**

### 26.13 Relação com S8

Congelado: o S7 **não remove** `profiles.company_id`, **não remove**
`profiles.role`, **não remove** nenhuma bridge legada, **não modifica**
o bridge de leads em `lib/services.ts`. A remoção estrutural dessas
dependências legadas é trabalho do **S8**. **M1-E E4 continua pausado
até o S8** — nenhuma alteração desta seção muda essa fronteira.

### 26.14 Confirmações finais

Nenhuma implementação do S7 foi iniciada em nenhuma sub-etapa até
aqui (S7-A0 é auditoria, S7-A1 é esta documentação). Nenhum arquivo de
código, migration, RPC, hook, componente ou teste foi criado ou
alterado. Nenhuma operação remota (migration, SQL, Auth, alteração de
usuário) foi executada. **O S7-B está desbloqueado** — pode ser
iniciado sem nenhuma decisão humana pendente de aprovação além do que
já está congelado nesta seção.

## 27. Fechamento do S7 — filtro contextual de empresa

Esta seção registra o fechamento factual do S7 (§26 → implementação),
mesmo padrão de §23 (fechamento do S5) e §25 (fechamento do S6).
Nenhuma decisão nova é tomada aqui — só o estado real do código-fonte,
auditado diretamente (não por memória de sessão anterior) em
2026-07-28, antes de qualquer commit desta etapa. Esta etapa (S7-D) não
cria funcionalidade nenhuma — só audita, valida e documenta.

**HEAD oficial imediatamente antes desta etapa (S7-D)**:
`bdcfefeb194564bb3c6bbf1334ed4fa19779f485` — publicado em
`origin/main`, working tree limpa, zero ahead/behind, confirmado
idêntico entre local e remoto.

### 27.1 Entregas — S7-A0 até S7-C

Todas **implementadas no código-fonte e publicadas no GitHub**:

- **S7-A0** (auditoria, sem commit de código): levantamento factual de
  todos os padrões de "qual empresa" no código — achado central
  registrado em §26.1 (nenhum `selectedCompanyId` em runtime).
- **S7-A1** (`82e31d4` — `docs(m1-f): freeze contextual company filter
  decisions`): congelamento das 14 decisões de arquitetura (§26.1 a
  §26.14), zero código.
- **S7-B**:
  - `eee12d0` (`feat(admin): add contextual company filter state`, 3
    arquivos, 107 inserções): criação de `lib/hooks/
    useCompanyScopeFilter.ts` e da flag `NEXT_PUBLIC_FF_COMPANY_
    SELECTOR` (`lib/flags.ts` + `.env.local.example`).
  - `e0e14cc` (`fix(query): derive pipeline company from active
    membership`): os dois consumidores legados de `currentUser.
    companyId` em `ScreensBiz.tsx` (`usePipelineStages`,
    `useReorderStages`) trocados para `activeMembership?.companyId ??
    null`, sem fallback ao campo legado.
  - `37e0a64` (`test(admin): cover contextual company filter state`, 7
    arquivos, 550 inserções/16 remoções): cobertura de testes do hook
    e das duas correções de pipeline, incluindo o ajuste pontual e
    direcionado de fixtures em `ScreenAjustesStages.test.tsx`,
    `remoteStagesReorder.test.tsx` e `stagePermissionsFlow.test.tsx`
    (divergências resolvidas por decisão humana explícita, nunca por
    decisão unilateral).
  - Nenhuma interface visual ampla foi criada no S7-B, conforme
    congelado em §26.12.
- **S7-C**:
  - `5c5695a` (`feat(admin): add contextual company selector
    interface`, 4 arquivos, 368 inserções): componente visual
    `CompanyScopeFilter` (dropdown acessível, busca, teclado).
  - `42242ae` (`feat(admin): apply company scope to user surfaces`, 7
    arquivos, 107 inserções/56 remoções): divisão em
    `UsersTabSection`/`LegacyUsersTabContent`/
    `ContextualUsersTabContent`, wiring de `externalCompanyFilterId`
    em `ActiveUserList`/`InactiveUserList`/`InviteList`, extensão de
    `adminInviteQueryKeys.list`/`fetchInvites`/`useInvites` para aceitar
    `companyFilterId` opcional (narrowing-only, sem RPC nova).
  - `bdcfefe` (`test(admin): cover contextual company selector
    interface`, 9 arquivos, 726 inserções): cobertura completa da
    interface nova, incluindo a correção arquitetural mandatória de
    separar o roteador (`UsersTabSection`, sem hooks) dos dois
    conteúdos (`LegacyUsersTabContent`/`ContextualUsersTabContent`,
    cada um com seu próprio conjunto consistente de hooks) para
    resolver o conflito com as Rules of Hooks identificado durante a
    própria etapa.

Nenhuma entrega oficial do S7 (§26.12) está ausente. Nenhum commit do
S7 toca `supabase/` (migration, SQL, seed) — confirmado por grep em
todo o intervalo `82e31d4^..bdcfefe`: zero ocorrência.

### 27.2 Matriz de atores × flag

| Ator | Flag desligada | Flag ligada |
|---|---|---|
| Super Admin | `LegacyUsersTabContent` — comportamento idêntico ao pré-S7 | `ContextualUsersTabContent` — seletor visível, filtro compartilhado |
| Manager | `LegacyUsersTabContent` — nunca vê o seletor | `LegacyUsersTabContent` — nunca vê o seletor, mesmo com a flag ligada |
| Seller | Sem acesso à aba Usuários (inalterado desde S5) | Sem acesso à aba Usuários (inalterado desde S5) |
| `actor` nulo | `LegacyUsersTabContent` | `LegacyUsersTabContent` (mesmo padrão de "sem capability") |

Confirmado por `UsersTabSection.tsx`: a escolha do caminho depende
exclusivamente de `isCompanySelectorEnabled() && actor?.kind ===
'super_admin'` — nenhuma outra combinação monta o caminho contextual.

### 27.3 `InviteList` — confirmação de segurança

`fetchInvites` aplica `.eq('company_id', companyFilterId)` somente
quando `scope.kind !== 'company'` (ou seja, escopo de plataforma) e
`companyFilterId` é truthy — a política `invites_select_own_or_
platform` já concede ao Super Admin leitura irrestrita de convites
independente de empresa, então esse filtro só **estreita** um conjunto
já autorizado, nunca amplia. Nenhuma RPC nova foi criada; nenhuma
alteração de backend foi necessária. `useInvites` só passa
`companyFilterId` adiante quando `scope?.kind === 'platform'` —
Manager (`scope.kind === 'company'`) nunca é afetado pelo parâmetro.

### 27.4 Acessibilidade do componente visual

`CompanyScopeFilter` segue o padrão ARIA combobox/listbox:
`aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`,
`role="listbox"`/`role="option"`, `aria-selected`. Nome acessível do
botão combina rótulo estático ("Empresa") e valor dinâmico via dois
ids em `aria-labelledby` (`company-scope-filter-label
company-scope-filter-value`). Teclado: `Escape` fecha e devolve foco ao
botão; `ArrowUp`/`ArrowDown` navegam; `Enter` confirma. Status de
empresa (`implantação`/`ativa`/`suspensa`) sempre exibido como texto,
nunca só por cor — confirmado por teste dedicado
(`CompanyScopeFilter.test.tsx`).

### 27.5 Estado e persistência — confirmação

Nenhuma escrita em `localStorage`/`sessionStorage` — confirmado por
teste que espiona `Storage.prototype.setItem` e verifica zero chamadas
após seleção. `useCompanyScopeFilter` reseta `companyFilterId` para
`null` na troca de `userId`/`actor?.kind`; um segundo efeito limpa a
seleção se a empresa selecionada sair da lista de `companies`
carregada (removida/cancelada/inacessível). Nenhum valor entra em
query string, segmento de rota ou hash — nenhuma rota foi alterada
nesta etapa.

### 27.6 Pipeline e dependência `activeMembership` — confirmação

`ScreensBiz.tsx` (`usePipelineStages`/`useReorderStages`) usa
exclusivamente `currentUser?.activeMembership?.companyId ?? null`, sem
fallback ao `companyId` legado — confirmado por leitura direta do
código nesta etapa. `companyFilterId` do S7 **nunca** é lido por essas
duas chamadas — pipeline permanece fora do escopo visual do filtro
contextual, exatamente como congelado em §26.10. `lib/services.ts:364`
(ponte legada de leads) permanece intocado, fronteira do S8 preservada.

### 27.7 Superfícies fora de escopo — confirmação

Confirmado por grep de `useCompanyScopeFilter`/`CompanyScopeFilter`/
`externalCompanyFilterId` em todo o código-fonte: nenhuma ocorrência
fora de `lib/hooks/useCompanyScopeFilter.ts`,
`components/users/*`, `components/invites/InviteList.tsx`,
`lib/invites/*` e seus testes correspondentes. Leads, Pipeline,
Dashboard, Relatórios, Tarefas, Visitas, Negociações, Propostas,
Vendas e Empresas permanecem sem qualquer referência ao filtro
contextual — nenhuma dessas telas foi tocada nesta etapa nem nas
anteriores do S7.

### 27.8 Feature flag — estado real

| Flag | Default | Depende de | Controla |
|---|---|---|---|
| `NEXT_PUBLIC_FF_COMPANY_SELECTOR` | `false` | — (só tem efeito para `actor.kind === 'super_admin'`) | Seletor visual de empresa na aba Usuários (S7) |

Confirmado por grep em todo o repositório: nenhum arquivo versionado
define essa flag como `true`. `.env.local.example` documenta
`NEXT_PUBLIC_FF_COMPANY_SELECTOR=false`. Com a flag desligada, a aba
Usuários preserva o comportamento anterior ao S7 byte a byte — nenhum
hook novo é montado (`LegacyUsersTabContent` não importa
`useCompanyScopeFilter`/`useCompanies`), confirmado pelos 98 arquivos/
1598 testes TypeScript desta etapa, incluindo os 5 arquivos
`ScreenAjustes*.test.tsx` que renderizam sem `QueryClientProvider`.

### 27.9 Migrations ainda não aplicadas remotamente

Nenhuma migration M1-F (S1 até S6-E2, 32 migrations locais no total)
foi confirmada aplicada no Supabase remoto em nenhum momento desta
linha do tempo — o S7 não adicionou nenhuma migration nova (zero
alteração em `supabase/`). Toda a interface do S7 está **implementada
no código, publicada no GitHub, protegida por flag — banco remoto
pendente**. Nenhuma operação remota de banco foi executada durante o
S7-D.

### 27.10 Totais finais das suítes e build

Validação local desta etapa (S7-D), stack Docker local reiniciado:

- Migrations locais: 32.
- SQL (pgTAP): 39 arquivos, 1998/1998 — `Result: PASS`.
- TypeScript (vitest): 98 arquivos, 1598/1598.
- Build (`next build`): compilação limpa, 8/8 páginas geradas.

Nenhuma divergência em relação aos números esperados registrados no
início desta etapa. **E2E não foi executado** — não existe
infraestrutura de E2E (Playwright/Cypress ou similar) neste
repositório; a suíte de integração existente
(`tests/integration/*.test.tsx`) cobre fluxos compostos via Testing
Library, não navegador real — mesma limitação já registrada em §25.9,
sem mudança nesta etapa.

### 27.11 Riscos residuais

- Nenhuma migration M1-F aplicada remotamente — todo o S7 (e o M1-F
  inteiro) depende de um deploy real futuro para operar em produção.
- O filtro contextual cobre hoje somente usuários ativos, usuários
  inativos e convites (escopo de plataforma) — não cobre nenhuma outra
  tela, por decisão consciente (§26.2), não por lacuna técnica.
- Persistência de conveniência (ex.: "última empresa vista") continua
  deliberadamente fora de escopo (§26.5) — pode ser reconsiderada em
  etapa própria, nunca como autorização.
- A UI de ciclo de vida continua sem poder detectar sozinha "alvo é
  outro Super Admin" — limitação estrutural herdada, já registrada em
  §25.10, inalterada pelo S7.

### 27.12 Plano de rollout futuro

Nenhum destes passos foi executado nesta etapa — é só o roteiro para
quando o deploy remoto real acontecer, complementando os planos já
registrados em §23.8 e §25.11 com os passos específicos do S7:

1. Backup e definição de janela de manutenção (mesma janela do plano
   já registrado em §25.11, se ainda não executado).
2. Confirmar o estado remoto real das migrations M1-F (nenhuma
   aplicada, segundo todo o histórico desta linha do tempo).
3. Aplicar as 32 migrations locais em ordem, sem pular nenhuma.
4. Executar os passos 1 a 17 do plano de rollout do S6 (§25.11) antes
   de qualquer ativação específica do S7 — o filtro contextual só faz
   sentido com o ciclo de vida de membership já ativo em produção.
5. Testar a aba Usuários manualmente contra o remoto com a flag
   `NEXT_PUBLIC_FF_COMPANY_SELECTOR` ainda desligada (confirmar
   ausência de regressão antes de ativar).
6. Ativar `NEXT_PUBLIC_FF_COMPANY_SELECTOR` em ambiente controlado
   (staging, se existir, ou produção com janela de observação).
7. Smoke test do seletor com um Super Admin de teste: visão global,
   seleção de empresa, troca de empresa, limpeza ao trocar de usuário.
8. Confirmar visualmente que Manager nunca vê o seletor, mesmo com a
   flag ligada.
9. Confirmar que usuários ativos, usuários inativos e convites
   respondem à mesma seleção de empresa de forma consistente.
10. Confirmar que o pipeline (`usePipelineStages`/`useReorderStages`)
    permanece indiferente ao filtro contextual em produção.
11. Manter rollback imediato da flag disponível durante toda a janela
    de observação pós-ativação.

### 27.13 Estado dos módulos vizinhos

- **S8** não foi iniciado — nenhum arquivo, nenhuma decisão além da
  fronteira já registrada em §26.13 (remoção de `profiles.company_id`/
  `profiles.role`/bridge legada de leads continua sendo trabalho do
  S8, não tocado pelo S7).
- **M1-E E4** (create/edit remotos de leads) continua pausado, sem
  alteração nesta etapa.
- **Nenhuma operação remota** (migration, SQL, Auth, alteração de
  usuário) foi executada durante o S7-D — toda a validação desta etapa
  rodou exclusivamente no stack Docker local.

### 27.14 Confirmações finais

Flag-off preserva o comportamento legado byte a byte (§27.8); wiring
flag-on correto e restrito a Super Admin (§27.2); `InviteList` seguro,
sem RPC nova, narrowing-only (§27.3); acessibilidade confirmada
(§27.4); nenhuma persistência indevida (§27.5); pipeline continua
dependente exclusivamente de `activeMembership`, nunca do filtro
contextual (§27.6); nenhuma superfície fora de escopo foi afetada
(§27.7); feature flag desligada em todo arquivo versionado (§27.8).

**O S7 está oficialmente encerrado no código-fonte e publicado no
GitHub.** Nenhuma sub-etapa está ativa em produção — a flag permanece
desligada e nenhuma migration M1-F foi aplicada remotamente.

## 28. Decisões congeladas do S8 — remoção das dependências legadas

Esta seção congela as decisões de arquitetura e a divisão final do S8
(remoção das dependências de empresa/papel/seller do modelo legado),
com base na auditoria factual do S8-A0 (2026-07-28, leitura direta do
código-fonte, não memória de sessão anterior). **Nenhuma implementação
foi iniciada nesta etapa (S8-A1)** — só decisão e documentação. §0–§27
não foram alterados.

### 28.1 Estado oficial no momento deste registro

Branch `main`, HEAD local, `origin/main` e remoto, no momento da
consolidação (S8-A1, antes do commit desta seção):

```
e9ced828e321443b3b6fe08082be4f7f292b0842
```

Working tree limpa; zero ahead/behind; nenhum arquivo alterado além
desta seção. S8-A0 (auditoria) concluído sem nenhuma alteração de
código. S8-B em diante não iniciado. M1-E E4 continua pausado.

### 28.2 Objetivo real do S8 — escopo e não-escopo

**Escopo**: eliminar o uso de `profiles.company_id`, `profiles.role`,
`User.companyId` e `User.role` como fontes de autorização ou contexto
empresarial remoto — tanto no banco (RLS/RPCs) quanto no cliente
(capabilities, bridge de leads).

**Não-escopo**: o S8 **não** migra integralmente Tarefas, Visitas,
Negociações, Propostas ou Vendas para o Postgres. Confirmado pelo
S8-A0: nenhuma dessas tabelas existe hoje (só `public.leads` e
`public.lead_timeline_entries` são reais); migrá-las é projeto de
persistência próprio, fora do M1-F. O S8 documenta e isola a
dependência desses módulos em relação ao modelo legado (§28.6/§28.7),
mas não os desacopla nem os migra.

### 28.3 Capabilities da interface — escopo obrigatório

Achado do S8-A0 (não presumido em nenhuma etapa anterior): três
funções de `lib/capabilities.ts` ainda decidem visibilidade de
superfícies reais usando exclusivamente `User.role` legado —
`canAccessFullSettings`, `canAccessStageSettings`,
`canReorderPipelineStages` (consumidas em `ScreensBiz.tsx` e
`App.tsx`, controlando a seção "Ajustes", a aba "Etapas" e a permissão
de reordenar o pipeline). **Estas três entram no escopo obrigatório do
S8** — não poderão continuar decidindo acesso exclusivamente por
`User.role`.

Fonte futura congelada:

- **Super Admin**: `platformRole` / `actor.kind` (mesmo padrão já usado
  por `canAccessPlatformAdmin`/`canManageInvites`, S3-B/S4-F1).
- **Manager e Seller**: `activeMembership.role` e a existência de
  `activeMembership` ativa (mesmo padrão já usado por
  `canManageInvites`/`membershipLifecycleCapabilities`, S4-F1/S6-F).

Regras esperadas, congeladas para a subetapa que implementar isso
(S8-B1):

- Super Admin acessa Ajustes conforme a matriz global já vigente para
  outras superfícies administrativas.
- Manager com `activeMembership` ativa acessa as superfícies
  empresariais permitidas (Ajustes/Etapas/reorder).
- Seller nunca recebe permissões administrativas.
- Usuário sem `activeMembership` ativa (incluindo Super Admin sem
  membership, por design) não recebe acesso empresarial por essa via.
- `User.role` legado **nunca** concede acesso isoladamente, uma vez
  migrado.

Esta migração é uma subetapa própria (S8-B1) **antes** da remoção de
`User.role` do tipo cliente — não pode acontecer depois, pois
`capabilities.ts` é o único consumidor real restante de `User.role`
fora dos módulos locais (§28.6/§28.7).

### 28.4 Ordem da migração — congelada

1. Migrar capabilities e consumidores visuais (S8-B1).
2. Migrar cliente/bridge remoto de Leads (S8-B2).
3. Migrar RLS e RPCs do banco, em subetapas (S8-C1, S8-C2).
4. Remover leituras e sincronizações legadas (S8-D).
5. Remover fisicamente colunas/helpers somente após zero consumidores
   confirmados por auditoria (S8-E).
6. Fechar o S8 (S8-F).
7. Somente depois, retomar M1-E E4.

**Nenhuma coluna será removida antes que todos os consumidores runtime
identificados no S8-A0 (RLS de 5 tabelas, 1 RPC de reorder, 9 RPCs de
leads, 3 capabilities, `_loadProfile`, `_remoteLeadSnapshotOrThrow`,
`SellerService`, os 5 `_filtered*` de `lib/services.ts`) tenham sido
eliminados ou expressamente aceitos como bridge temporária
documentada.**

### 28.5 Tipo de identidade do cliente — decisão congelada

A identidade futura do `User` será baseada em campos explícitos e
sempre presentes, mesmo quando `null` (nunca `undefined` por omissão
estrutural):

```ts
platformRole: 'super_admin' | null;
activeMembership: { companyId: string; role: 'manager' | 'seller' } | null;
```

Durante a compatibilidade (S8-B/S8-C/S8-D):

- `User.companyId` permanece temporariamente no tipo.
- `User.role` permanece temporariamente no tipo.
- Nenhum dos dois será apenas tornado opcional e esquecido — ambos
  serão marcados explicitamente como legados/depreciados (comentário
  no próprio tipo, mesmo padrão já usado para `LegacyUserRef` em
  `lib/data.ts`).
- Serão removidos do tipo somente quando zero consumidores runtime
  existirem (confirmado por auditoria dedicada, mesmo grep desta
  auditoria repetido no S8-E).

**Não remover campos do tipo cliente na primeira subetapa (S8-B1).**

Fixtures futuras de teste deverão informar explicitamente
`platformRole` e `activeMembership` (mesmo quando `null`), para evitar
usuários fictícios estruturalmente impossíveis (ex.: Manager sem
nenhuma membership ativa, Super Admin com `activeMembership` não-nulo)
— mesma disciplina já aplicada às fixtures corrigidas no S7-B.

### 28.6 `sellerId` — fronteira própria

Fronteira diferente e mais lenta que `companyId`/`role`, congelada
nesta etapa:

**No backend remoto**: autorização e resolução de Seller deverão parar
de depender de `profiles.seller_id` — usar `company_memberships` e
`current_profile_seller_id_for_company()` (já existente desde
`20260720110100_m1f_s2_02_company_access_helpers.sql`) ou contrato
equivalente. Isso se aplica às 9 RPCs de leads (S8-C2), que hoje leem
`v_profile.seller_id` diretamente.

**No cliente local**: `User.sellerId` poderá permanecer temporariamente,
somente como bridge para os módulos locais/mock (§28.7) — nunca como
autorização empresarial. Deve ser documentado explicitamente como
compatibilidade M0 no próprio tipo, quando essa marcação for aplicada
(S8-B/S8-D).

**Não remover fisicamente `profiles.seller_id`** enquanto
`SellerService`, `Home`, Tasks, Visits, Deals, Sales ou outros módulos
locais ainda precisarem dessa ligação (confirmado no S8-A0:
`SellerService.getCurrentSeller()` resolve `getStore().sellers` via
`u.sellerId`; os cinco `_filtered*` de `lib/services.ts` filtram por
`u.role === 'seller' && u.sellerId`). A remoção completa de `sellerId`
fica condicionada à migração desses módulos locais para persistência
real, ou à criação de uma bridge substituta segura — nenhuma das duas
coisas é objetivo do S8.

### 28.7 Módulos locais — fora do escopo de migração integral

Congelado: o S8 **não tentará desacoplar integralmente**
`TaskService`, `VisitService`, `DealService`, `SaleService`,
`SellerService` ou `StoreAdapter` apenas para permitir a remoção
imediata de `sellerId`. Motivo: esses módulos ainda não existem no
PostgreSQL (confirmado no S8-A0 e já registrado em §25.4), não possuem
RLS, não possuem tenant empresarial real — refatorá-los agora
produziria trabalho temporário descartado quando migrarem de fato para
persistência real, em projeto próprio fora do M1-F. O S8 pode
documentar e isolar essa dependência (§28.6), mas não migra esses
módulos.

### 28.8 Frontend e cliente

**S8-B1 — identidade e capabilities**: migrar
`canAccessFullSettings`/`canAccessStageSettings`/
`canReorderPipelineStages` para `platformRole`/`actor.kind`
(Super Admin) e `activeMembership.role`/existência de membership ativa
(Manager/Seller); migrar os consumidores em `App.tsx` e
`ScreensBiz.tsx`; atualizar fixtures/testes afetados (estimativa do
S8-A0: 5–8 arquivos, mesma ordem de grandeza das divergências já
resolvidas no S7-B). Nenhuma migration.

**S8-B2 — bridge cliente de Leads**: migrar
`_remoteLeadSnapshotOrThrow` (`lib/services.ts:364`) de `user.companyId`
para `activeMembership.companyId`; revisar a montagem real de
`startLeadsRemoteBridge` (confirmado no S8-A0: ainda não montado em
`App.tsx`, único consumidor hoje é o próprio teste do bridge); não
alterar módulos locais; não remover ainda o carregamento dos campos
legados em `_loadProfile` se outros consumidores (capabilities,
`_filtered*`, `SellerService`) ainda permanecerem lendo-os.

### 28.9 Banco — divisão segura

Nenhuma migration única e gigante. Dividido em duas subetapas:

**S8-C1 — Profiles, Sellers e Pipeline**: migrar as policies de
`profiles` (`profiles_select_own`/`profiles_select_company`), de
`sellers` (`sellers_select_own`/`sellers_select_company`/
`sellers_insert_admin`/`sellers_update_admin`), de `pipeline_stages`
(`stages_select`/`stages_insert`/`stages_update`) e a RPC
`reorder_pipeline_stages`, todas para os 7 helpers novos de
`20260720110100_m1f_s2_02_company_access_helpers.sql`
(`can_access_company`/`is_manager_or_platform`/
`current_membership_company_id`/`current_membership_role`); preservar
comportamento real observável; testes pgTAP dedicados.

**S8-C2 — Leads**: migrar `leads` (`leads_select`) e
`lead_timeline_entries` (`lead_timeline_select`), e as 9 RPCs de
`20260719202010_m1e_03_lead_rpcs.sql` (`create_lead`, `update_lead`,
`move_lead`, `assign_lead_seller`, `archive_lead`, `unarchive_lead`,
`add_timeline_entry`, `apply_lead_event`, e a leitura controlada) —
substituindo a leitura direta de `profiles.company_id`/`role`/
`seller_id` por `company_memberships`/`can_access_company()`/
`current_profile_seller_id_for_company()`; testes pgTAP completos.

Cada uma das duas exigirá auditoria e decisão humana antes da
implementação — não serão tratadas como uma única tarefa
audit→implement→test→commit→push, dado o volume e a criticidade de
autorização real envolvida (mesmo padrão de cautela já aplicado nas
etapas anteriores desta sessão).

### 28.10 Remoção das pontes

S8-D deverá: parar `_loadProfile` de utilizar `company_id`/`role` para
fins de autorização (a leitura em si pode continuar existindo enquanto
popular campos ainda presentes no tipo, marcados como legados);
remover os consumidores restantes de `User.companyId`/`User.role` que
não sejam os módulos locais explicitamente isentos (§28.7); remover a
sincronização temporária de `profiles.role` em `update_membership_role`
(ponte do S5-C, §22.3); atualizar tipos e testes; manter as colunas
físicas enquanto a auditoria ainda apontar qualquer consumidor. Não
remover `sellerId` se os módulos locais ainda dependerem dele.

### 28.11 Remoção física

S8-E poderá remover `profiles.company_id`, `profiles.role`,
`current_profile_company_id()`, `current_profile_role()`,
`is_manager_or_admin()` e helpers equivalentes sem consumidores,
somente após: grep dedicado (mesmo padrão desta auditoria S8-A0);
catálogo de dependências confirmado vazio; RLS/RPCs migradas (S8-C1/
S8-C2); cliente migrado (S8-B/S8-D); SQL 100% verde; TypeScript 100%
verde; build verde.

`profiles.seller_id` só será removido se a auditoria final confirmar
zero consumidores. Caso os módulos locais ainda dependam dele,
permanecerá temporariamente, será documentado como risco residual fora
da autorização desta remoção, e **não bloqueará** o encerramento do
restante do S8.

### 28.12 M1-E E4 — pausado até o fechamento formal do S8

Congelado: **M1-E E4 continuará pausado durante todo o S8**, mesmo que
o S8-C2 remova o bloqueio técnico das RPCs de leads antes do fim das
demais subetapas. O E4 só será retomado depois do fechamento formal do
S8 (S8-F). Motivo: evitar desenvolvimento paralelo sobre uma identidade
em transição; garantir contratos estáveis antes de construir
`useCreateLead`/`useUpdateLead` sobre eles; reduzir risco de
regressão; manter uma única linha arquitetural ativa por vez — mesmo
princípio já aplicado em todas as fronteiras S5/S6/S7 anteriores deste
documento.

### 28.13 Divisão final do S8

| Sub-etapa | Escopo | Situação |
|---|---|---|
| **S8-A0** | Auditoria factual das dependências legadas | Concluída |
| **S8-A1** | Congelamento das decisões de remoção (esta seção) | Concluída — é a etapa atual |
| **S8-B1** | Identidade e capabilities do frontend (`canAccessFullSettings`/`canAccessStageSettings`/`canReorderPipelineStages`, consumidores em `App.tsx`/`ScreensBiz.tsx`, fixtures/testes) | Desbloqueada após esta seção |
| **S8-B2** | Cliente e bridge de Leads (`_remoteLeadSnapshotOrThrow`, montagem de `startLeadsRemoteBridge`) | Segue após S8-B1 |
| **S8-C1** | RLS de Profiles, Sellers e Pipeline + `reorder_pipeline_stages` | Segue após S8-B2, com decisão humana própria |
| **S8-C2** | RLS e RPCs de Leads (as 9 RPCs de `m1e_03_lead_rpcs.sql`) | Segue após S8-C1, com decisão humana própria |
| **S8-D** | Remoção dos consumidores e pontes de `companyId`/`role` (`_loadProfile`, sincronização de `update_membership_role`) | Segue após S8-C2 |
| **S8-E** | Remoção física segura de colunas/helpers; `sellerId` condicionado à ausência de dependência dos módulos locais | Segue após S8-D, com auditoria dedicada |
| **S8-F** | Auditoria integrada, documentação, fechamento, desbloqueio formal do M1-E E4 | Encerra o S8 |

**Depois desta seção (S8-A1), não resta decisão humana bloqueante para
iniciar o S8-B1.**

### 28.14 Confirmações finais

Nenhuma implementação do S8 foi iniciada em nenhuma sub-etapa até aqui
(S8-A0 é auditoria, S8-A1 é esta documentação). Nenhum arquivo de
código, migration, RPC, hook, componente ou teste foi criado ou
alterado. Nenhuma operação remota (migration, SQL, Auth, alteração de
usuário) foi executada. **O S8-B1 está desbloqueado** — pode ser
iniciado sem nenhuma decisão humana pendente de aprovação além do que
já está congelado nesta seção. **M1-E E4 continua pausado** até o
fechamento formal do S8 (§28.12).

## 29. Decisões do S8-C1 — Profiles, Sellers e Pipeline

Esta seção congela as decisões humanas aprovadas sobre a auditoria
S8-C1-A0 (leitura direta de código-fonte, 2026-07-28) e delimita o
que o S8-C1-A implementa nesta etapa versus o que fica para o futuro
S8-C1-B. §0–§28 não foram alterados.

### 29.1 Auditoria S8-C1-A0 — achados confirmados

- **`profiles_select_company`** (`company_id = current_profile_company_id()
  and is_manager_or_admin()`) não tem nenhum consumidor runtime
  conhecido: grep de todo o repositório (fora de testes) mostra
  exatamente um único acesso client-side a `public.profiles` —
  `lib/services.ts::_loadProfile`, filtrado por `id = auth.uid()` (usa
  só `profiles_select_own`). A listagem administrativa multi-perfil já
  é inteiramente resolvida por `list_company_users`/
  `list_inactive_company_users` (RPCs `SECURITY DEFINER`, S5-A2/S6-E).
- **Exposição desnecessária confirmada**: a `GRANT SELECT` de
  `public.profiles` para `authenticated` (migration
  `20260721150000_m1f_s4c2c_login_profile_read.sql`) cobre `role`,
  `seller_id` e `platform_role` — três colunas que `list_company_users`
  deliberadamente **não** repassa ao chamador (design §22.5). Enquanto
  `profiles_select_company` existisse, qualquer Manager podia obter
  essas três colunas de colegas da própria empresa via REST direto,
  contornando a omissão intencional da RPC. `profiles_select_own`
  continua expondo essas mesmas colunas, mas só da própria linha —
  nunca de terceiros — o que é o comportamento pretendido.
- **`profiles_select_own` preservada integralmente** — único consumidor
  real, sem qualquer achado de risco.
- **As quatro policies legadas de `public.sellers`**
  (`sellers_select_own`, `sellers_select_company`,
  `sellers_insert_admin`, `sellers_update_admin`) são **estruturalmente
  inalcançáveis desde a criação (M1-B)**: `public.sellers` nunca
  recebeu nenhum `GRANT` (SELECT/INSERT/UPDATE/DELETE) para
  `authenticated`/`anon` em nenhuma migration — fato já registrado no
  próprio histórico do repositório (comentário da migration
  `20260721150000_m1f_s4c2c_login_profile_read.sql`: *"public.sellers
  ... NÃO recebe nada nesta migration: nenhum código client-side
  consulta essas tabelas via PostgREST hoje"*). Confirmado por grep de
  todo o código de aplicação: zero `.from('sellers')` em qualquer
  lugar fora de testes SQL. Todo dado de Seller flui exclusivamente por
  RPCs `SECURITY DEFINER` (`list_company_users`,
  `list_inactive_company_users`, `current_profile_seller_id_for_company`,
  e internamente nas RPCs de leads).

### 29.2 Decisão — remover `profiles_select_company`

**Aprovado**: `DROP POLICY profiles_select_company`. Nenhuma policy
substituta é criada — a leitura e administração de terceiros
continuam exclusivamente pelas RPCs estreitas já publicadas
(`list_company_users`, `list_inactive_company_users`, RPCs de ciclo de
vida). `profiles_select_own` permanece sem nenhuma alteração de
expressão.

### 29.3 Decisão — remover as quatro policies legadas de `sellers`

**Aprovado**: `DROP POLICY` de `sellers_select_own`,
`sellers_select_company`, `sellers_insert_admin`,
`sellers_update_admin`. **Nenhuma policy nova é criada em substituição
nesta etapa** — nem com os helpers legados, nem com os helpers novos
do M1-F. `public.sellers` permanece com RLS habilitada e **zero
policy** (mesma postura de dupla negação já usada e comprovada em
`public.company_memberships` desde o S1: RLS habilitada + zero
grant + zero policy = negado duas vezes). **Nenhum GRANT novo é
concedido em `public.sellers`** para `authenticated`/`anon` — a
exposição permanece exatamente a mesma de hoje (nenhuma). Se um
consumidor real de leitura/escrita direta de `sellers` for aprovado no
futuro, a migration que introduzir o GRANT deve introduzir a policy
correta na mesma etapa — não antes.

### 29.4 Pipeline separado para o S8-C1-B — decisão congelada

**Super Admin não deve ler, editar ou reordenar pipeline de empresas
clientes nesta fase.** Motivo (auditoria S8-C1-A0, §8/§9): a interface
já deriva `companyId` exclusivamente de `activeMembership.companyId`
para pipeline desde o S7-B, sem exceção para Super Admin; o filtro
contextual de empresa do S7 nunca entra em Pipeline/Leads (§26.2,
§26.10, §27.6, reafirmado aqui); não existe hoje nenhuma UI que peça
"qual empresa" para operações de pipeline; e o S8 existe para remover
dependências legadas, não para construir uma capacidade nova de Super
Admin sobre dados operacionais de clientes.

**Regra adicional para o S8-C1-B, não implementada nesta etapa**: as
futuras policies de `pipeline_stages`/`reorder_pipeline_stages` **não
devem usar isoladamente** `can_access_company(company_id)` nem
`is_manager_or_platform(company_id)` como autorização suficiente —
ambos os helpers autorizam Super Admin (por design, corretamente, para
os casos em que Super Admin precisa de acesso de plataforma). A
autorização de Pipeline deve exigir **contexto empresarial real por
membership ativa**, excluindo Super Admin da via de autorização
mesmo quando esses helpers retornariam `true` para ele. O desenho
exato dessa regra (nova composição de helpers, ou checagem adicional
explícita de `current_membership_company_id() is not null`) fica para
a auditoria/decisão do S8-C1-B — **não decidido nem implementado
aqui**.

### 29.5 Escopo desta etapa (S8-C1-A)

Implementa exclusivamente: migration aditiva removendo as cinco
policies acima (1 de `profiles` + 4 de `sellers`); atualização
coordenada dos dois testes SQL que afirmavam a existência/comportamento
de `profiles_select_company`; um teste SQL novo dedicado ao estado
resultante. Nenhuma migration antiga é modificada; nenhuma coluna,
constraint, índice, trigger, RPC ou helper é alterado ou removido;
nenhum grant novo é concedido; nenhuma operação remota é executada.

### 29.6 Estado no momento deste registro

HEAD imediatamente antes desta seção: `938cb267a7f5b7b72148a8dea0774a75d296d0b7`.
**S8-C1-A ainda em implementação no restante desta tarefa** — o
restante desta etapa (migration, testes, validação, commits, push)
segue após o registro desta seção. S8-C1-B e S8-C2 não iniciados.
M1-E E4 continua pausado até o fechamento formal do S8.

## 30. Implementação do S8-C1-B — Pipeline e reordenação

Esta seção registra a implementação das decisões humanas aprovadas
sobre `pipeline_stages`/`reorder_pipeline_stages` (auditoria S8-C1-A0,
§28/§29). §0–§29 não foram alterados.

### 30.1 Decisões que esta implementação executa

Todas já aprovadas antes desta etapa, registradas aqui para o registro
factual desta seção: Super Admin não opera Pipeline de empresas
clientes nesta fase; `reorder_pipeline_stages` continua sem
`p_company_id`; Super Admin nunca recebe empresa implícita, primeira
empresa disponível, filtro contextual ou empresa artificial; Pipeline
exige contexto empresarial real derivado de membership ativa; o filtro
contextual do S7 continua restrito à aba Usuários; as policies **não
usam isoladamente** `can_access_company(company_id)` nem
`is_manager_or_platform(company_id)` (ambos autorizam Super Admin) — o
acesso combina `current_membership_company_id()`/
`current_membership_role() = 'manager'` (contexto real de membership,
nunca de plataforma) com `can_access_company(company_id)` (situação
operacional real da empresa: existe, não cancelada/suspensa).

### 30.2 Matriz de SELECT — `stages_select`

```sql
company_id = public.current_membership_company_id()
and public.can_access_company(company_id)
```

`current_membership_company_id()` já retorna `null` para Super Admin
(nunca tem membership, por design) — a cláusula nunca é satisfeita
para ele, independente de `can_access_company` também retornar `true`
para Super Admin em outros contextos. Manager/Seller ativos leem as
etapas da própria empresa; nenhum dos dois lê de outra empresa; sem
membership ativa, nenhuma leitura; membership suspensa/desligada
(`current_membership_company_id()` já filtra por `is_active`), nenhuma
leitura; empresa suspensa/cancelada (`can_access_company` já nega),
nenhuma leitura mesmo com membership ativa.

### 30.3 Matriz de INSERT/UPDATE — `stages_insert`/`stages_update`

```sql
company_id = public.current_membership_company_id()
and public.current_membership_role() = 'manager'
and public.can_access_company(company_id)
```

Só Manager ativo da própria empresa operacional cria/atualiza etapas.
Seller ativo: `current_membership_role() = 'manager'` já nega. Super
Admin: `current_membership_company_id()` já é `null`, nunca satisfaz a
igualdade. Sem membership: mesma negação. Empresa não operacional:
`can_access_company` nega mesmo com membership Manager ativa. Grants
de coluna preservados sem alteração (`INSERT` só nas colunas de
negócio; `UPDATE` só `name`/`is_terminal`; `company_id`/`sort_order`
fora de qualquer grant de escrita direta — transferência de etapa
entre empresas continua estruturalmente impossível pelo cliente).

### 30.4 Contrato final de `reorder_pipeline_stages`

Assinatura preservada integralmente: `reorder_pipeline_stages(p_ordered_ids
uuid[]) returns setof public.pipeline_stages`. Nenhum `p_company_id` —
decisão confirmada, não revisitada. Resolução da empresa trocada de
`current_profile_company_id()` (legado) para
`current_membership_company_id()`; autorização trocada de
`is_manager_or_admin()` (legado) para `current_membership_role() =
'manager'` combinado com `can_access_company(v_company_id)` — nunca
`is_manager_or_platform`, que autorizaria Super Admin. Preservados sem
alteração: locks determinísticos (`ORDER BY id FOR UPDATE`), validação
de array (não nulo, não vazio, unidimensional), validação de
permutação completa (`v_matching = v_total`, sem duplicatas, sem
etapa de outra empresa), atomicidade (transação única da função),
`SECURITY DEFINER`/`search_path=''`, grants (`REVOKE ALL` +
`GRANT EXECUTE` só para `authenticated`).

**Matriz**: Manager ativo de empresa operacional — permitido; Seller
ativo — negado (`current_membership_role()` ≠ `'manager'`); Super
Admin — negado por ausência de contexto empresarial
(`current_membership_company_id()` é sempre `null` para ele, nunca por
`is_manager_or_platform` que o autorizaria); sem membership — negado;
membership suspensa/desligada — negado (`current_membership_company_id()`
já filtra `is_active`); empresa não operacional — negado mesmo com
membership Manager ativa.

### 30.5 Mensagens de erro

`getReorderStagesErrorMessage()` (`lib/hooks/useReorderStages.ts`)
continua reconhecendo os mesmos fragmentos, sem nenhuma alteração de
TypeScript: `message.includes('forbidden')` →
"Você não tem permissão para reordenar as etapas."; `message.includes('no
active profile')` → "Sua sessão não possui um perfil ativo.". As
mensagens internas da função (`'forbidden: manager/admin only'` e
`'no active profile for current user'`) são preservadas literalmente —
nenhuma reformulação foi necessária para expressar a nova autorização,
já que os mesmos fragmentos continuam descrevendo corretamente os dois
casos (ausência de papel Manager habilitado; ausência de contexto
empresarial ativo).

### 30.6 Escopo e preservação

Nenhuma tabela, coluna, índice, constraint ou dado alterado. Nenhuma
RPC de leads tocada. `public.profiles`/`public.sellers` permanecem
exatamente como o S8-C1-A deixou. Os 4 helpers legados
(`current_profile_company_id`, `current_profile_role`,
`current_profile_seller_id`, `is_manager_or_admin`) permanecem
fisicamente no catálogo — nenhum removido. Nenhuma migration antiga
modificada — migration nova, puramente aditiva
(`CREATE OR REPLACE`/`DROP POLICY`+`CREATE POLICY`). Nenhuma operação
remota executada. Implementação protegida por suíte pgTAP dedicada
(`40_m1f_s8c1b_pipeline_access.sql`) cobrindo catálogo, as quatro
matrizes de ator, dados cruzados e atomicidade.

## 31. Arquitetura comercial do Super Admin — decisões congeladas do S8-C2

Esta seção registra as decisões humanas definitivas sobre o acesso
comercial do Super Admin a Leads, tomadas após a reauditoria S8-C2-A1
(que substitui a decisão anterior de bloqueio total, registrada na
primeira auditoria S8-C2-A0). **Nenhuma implementação foi iniciada por
esta seção** — é puramente decisão e planejamento, no mesmo padrão já
usado em §24, §26, §28, §29, §30. §0–§30 não foram alterados.

### 31.1 Contexto de negócio

A KAPA é proprietária e administradora da plataforma, mas também
presta serviços de marketing e acompanhamento comercial às empresas
clientes. Por isso, ao contrário da decisão anterior (Pipeline, §30,
que permanece válida e intocada), o Super Admin **terá** acesso
comercial completo aos Leads — para acompanhar organização de
Manager/Sellers, distribuição e velocidade de atendimento de Leads,
movimentação pelo funil, histórico de contatos e qualidade da operação
comercial gerada pelo marketing da KAPA.

### 31.2 Acesso comercial completo, sempre dentro de empresa explícita — decisão congelada

O Super Admin terá acesso comercial completo aos Leads das empresas
clientes, **sempre** dentro de uma empresa explicitamente selecionada.
Nenhuma empresa poderá ser inferida, escolhida automaticamente ou
herdada de outro filtro. Especificamente **proibido**: empresa
automática; primeira empresa cadastrada; empresa herdada de outro
contexto; `activeMembership` artificial (Super Admin nunca tem
membership, por design — isso não muda); reutilização do
`companyFilterId` da aba Usuários (S7, §26.3) — são estados
conceitualmente diferentes (`null` ali significa "visão global"; aqui
significa "nenhuma empresa selecionada ainda", nunca uma visão
agregada).

### 31.3 Ausência de visão "Todas as empresas" — decisão congelada

Não haverá opção "Todas as empresas" na primeira versão da operação
comercial. Fluxo congelado: abrir Leads → selecionar uma empresa →
acompanhar somente aquela empresa → trocar explicitamente quando
necessário. Nenhuma tela mistura Leads de empresas diferentes na
mesma lista ou no mesmo Kanban. Uma futura visão consolidada
(dashboard, somente leitura, métricas agrupadas) poderá existir como
projeto separado — não faz parte do S8-C2.

### 31.4 Seletor comercial — decisão congelada

Empresas **canceladas** aparecem no seletor comercial, agrupadas como
somente leitura (diferente da aba Usuários/`useCompanies`, cuja RLS
subjacente exclui `cancelada` por completo — por isso o seletor
comercial **não pode** usar somente `useCompanies` como fonte). Será
necessário um contrato estreito próprio (`list_commercial_companies()`
— nome provisório, RPC ainda não criada) que liste as empresas
comercialmente acessíveis ao Super Admin, incluindo no mínimo `id`,
`name`, `status`, e os demais campos estritamente necessários — nunca
mais que isso.

### 31.5 Matriz de status — decisão congelada

**Super Admin:**

| Status | Leitura | Mutation |
|---|---|---|
| ativa | completa | completa |
| implantação | completa | completa, caso exista estrutura comercial válida (etapa inicial da empresa já configurada) |
| suspensa | histórica | nenhuma |
| cancelada | histórica | nenhuma |

**Manager e Seller:** continuam usando exclusivamente
`activeMembership`; **somente empresa `ativa`** permite acesso
comercial (Leads) — `implantação`, `suspensão` e `cancelamento` são
**negados** na área de Leads para eles (mais restritivo que a regra já
aprovada para Pipeline no S8-C1-B, que aceita `implantação` — as duas
áreas têm regras propositalmente diferentes; esta seção não altera
nada do S8-C1-B). Nenhum `p_company_id` eventualmente enviado por
Manager/Seller amplia acesso — a empresa deles vem sempre de
`current_membership_company_id()`.

### 31.6 Estado comercial — decisão congelada

Provider/hook estreito, próprio da área comercial (nome provisório,
ainda não criado): `selectedCompanyId: string | null`, `null`
significando literalmente "nenhuma empresa selecionada" (nunca "visão
global"). Sem `localStorage`/`sessionStorage`/cookie; sem URL na
primeira versão (salvo necessidade técnica futura comprovada); sem
Zustand global; sem alterar `activeMembership`; sem reutilizar
`useCompanyScopeFilter` (S7) — são hooks com contratos semânticos
diferentes e não devem compartilhar implementação. Ao trocar de
empresa: fecha Lead aberto, modais, Seller/Stage selecionados, busca e
paginação; cancela/invalida queries da empresa anterior; nenhuma
resposta tardia da empresa anterior é aplicada na nova. No
logout/troca de ator: o contexto comercial é limpo (mesmo padrão já
usado por `useCompanyScopeFilter` para seu próprio estado).

### 31.7 Leitura de Pipeline para Super Admin — decisão congelada

Por RPC estreita separada, ainda não criada:
`list_pipeline_stages_for_company(p_company_id)` — somente leitura,
exige empresa explícita, valida `platform_role`, retorna somente a
empresa-alvo. **Não altera `stages_select`** (a policy do S8-C1-B
permanece exatamente como publicada — Super Admin continua sem
`current_membership_company_id()`, e portanto sem acesso por essa
via). **Não libera** INSERT/UPDATE em `pipeline_stages` para Super
Admin, nem `reorder_pipeline_stages` — essas permanecem restritas a
Manager, exatamente como o S8-C1-B já decidiu e publicou.

### 31.8 Leitura comercial de Leads/Timeline — decisão congelada

Por RPCs estreitas separadas, ainda não criadas:
`list_commercial_companies()`, `list_platform_leads_for_company(...)`,
`list_platform_lead_timeline(...)`, além de
`list_pipeline_stages_for_company(...)` (§31.7). **Nenhuma RLS global
de Super Admin será criada** em `leads`, `lead_timeline_entries` ou
`pipeline_stages` — motivo: uma consulta direta sem filtro (ex.:
`lib/leads/remoteRepository.ts::fetchActiveLeadRows`, que hoje não
envia nenhum filtro de `company_id`, confiando inteiramente na RLS)
poderia devolver dados de todas as empresas caso uma policy global
existisse. Manager e Seller continuam usando as policies RLS normais,
derivadas da membership, sem nenhuma alteração.

### 31.9 Query keys — decisão congelada

As chaves de cache do caminho de Super Admin precisam conter
`companyId` **e** um segmento de origem `'platform'`, para nunca
compartilhar o mesmo slot de cache do caminho RLS de Manager/Seller —
exemplo conceitual: `['company', companyId, 'leads', 'platform']`,
`['company', companyId, 'pipeline-stages', 'platform']`. Nenhuma
mudança na partição por `companyId` já existente para Manager/Seller.

### 31.10 As nove RPCs de mutation — decisão congelada

`create_lead`, `update_lead`, `move_lead_to_stage`,
`apply_lead_event`, `assign_lead_seller`, `archive_lead`,
`unarchive_lead`, `add_lead_timeline_entry`,
`check_lead_phone_duplicate` — todas preservadas, todas receberão
futuramente `p_company_id uuid default null` no final da assinatura
(nenhuma quebra de chamada existente, já que nenhuma chamada real
existe hoje — E4 nunca foi montado). Para Super Admin:
`p_company_id` é obrigatório na prática (a função rejeita `null`
para esse ator); valida `platform_role`, empresa, status, e que
Lead/Seller/Stage pertencem à mesma empresa-alvo. Para Manager/Seller:
`p_company_id` é **ignorado**; a empresa vem exclusivamente de
`current_membership_company_id()`; o parâmetro nunca amplia acesso
para esses dois papéis, mesmo se informado.

### 31.11 Resolver interno compartilhado — decisão congelada, não implementada

Para evitar repetir de forma divergente a resolução de ator, empresa,
papel, Seller atual, status e permissão de leitura/escrita entre as
9 RPCs, será usado um resolver SQL interno compartilhado (nome e
assinatura ainda não definidos). Regras já congeladas para quando for
criado: não é uma API cliente; não concede autoridade pelo parâmetro
recebido; não aceita `profile_id` arbitrário; sempre deriva de
`auth.uid()`; precisa de `search_path` seguro (mesmo padrão de todos os
helpers já existentes); não deve receber `GRANT` client-side
desnecessário (uso interno, chamado só pelas próprias RPCs
`SECURITY DEFINER`). **Não implementado nesta etapa.**

### 31.12 Auditoria — decisão congelada

Toda mutation executada por Super Admin registrará em `public.audit_log`
(tabela já existente desde `20260720130000_m1f_s4a1_invite_audit_foundation.sql`,
já usada por 11 RPCs administrativas/de ciclo de vida — nenhuma
alteração de schema necessária): `actor_profile_id` real (nunca a
identidade "efetiva"), `company_id` alvo, `entity_type`, `entity_id`,
`action`, `result`, `occurred_at`, `before_data`/`after_data`
sanitizados. **A timeline comercial (`lead_timeline_entries`) não
substitui o `audit_log`** — são propósitos diferentes: timeline é
informação útil à equipe comercial; `audit_log` é prova de quem
executou uma operação privilegiada. Mutations de Manager/Seller
continuam sem escrever em `audit_log`, como sempre.

### 31.13 Política de PII no `audit_log` — decisão congelada

Não registrar telefone completo; não copiar o Lead inteiro; preferir
IDs, status e campos alterados; telefone, quando indispensável, só
mascarado; nunca registrar credenciais, tokens ou payloads genéricos —
mesma disciplina já usada pelas 11 RPCs que hoje escrevem em
`audit_log` (nenhuma delas usa `row_to_json` genérico).

### 31.14 Feature flags — decisão congelada, nenhuma criada nesta etapa

`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ` (padrão `false`):
controla navegação comercial do Super Admin, o seletor, leitura de
empresas/Leads/timeline/Stages. `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE`
(padrão `false`): controla criação, edição, movimentação, atribuição,
arquivamento e timeline nova — só tem efeito combinada com a de
leitura já ativa (mesmo molde de dependência entre flags já usado por
`NEXT_PUBLIC_FF_USER_EMAIL_EDIT`/`NEXT_PUBLIC_FF_USER_LIFECYCLE`
exigirem `NEXT_PUBLIC_FF_ACTIVE_USERS`). Manager e Seller não
dependem de nenhuma das duas. Rollout preferencial: leitura →
acompanhamento real → mutations → auditoria reforçada → rollout
completo. **Nenhuma flag criada nesta etapa.**

### 31.15 Correções futuras necessárias dentro do S8-C2

- `components/screens/ScreensOps.tsx` (`ScreenAndamento`, o Kanban real)
  **ainda usa** `currentUser?.companyId ?? null` (legado) — achado da
  reauditoria S8-C2-A1, nunca corrigido no S7-B/S8-B1 (que só tocaram
  `ScreensBiz.tsx`). Precisará resolver `activeMembership.companyId`
  para Manager/Seller e `selectedCompanyId` (§31.6) para Super Admin.
  **Ainda não corrigido.**
- `components/App.tsx` (`allowedNavIds`) **ainda autoriza** a
  visibilidade de "Clientes"/"Andamento" só por `NAV_ROLES[user.role]`
  (legado, valor arbitrário para Super Admin) — precisará de uma
  capability comercial explícita nova (molde de `canAccessStageSettings`/
  `canAccessPlatformAdmin`, já migradas no S8-B1). `User.role` isolado
  nunca deverá conceder esse acesso. **Ainda não corrigido.**

### 31.16 Divisão final aprovada do S8-C2

| Sub-etapa | Escopo |
|---|---|
| S8-C2-A0 | Auditoria original — concluída |
| S8-C2-A1 | Reauditoria comercial — concluída |
| S8-C2-A2 | Congelamento documental — **esta seção** |
| S8-C2-B1 | Backend de leitura: `list_commercial_companies`, Leads, timeline, Stages; SQL, grants, tipos, pgTAP |
| S8-C2-B2 | Frontend de leitura: contexto comercial, seletor, capability, navegação, correção de `ScreensOps.tsx`, query keys, cache, flag READ, testes TypeScript |
| S8-C2-C1 | Backend de create/update/duplicate: `p_company_id`, resolver interno, status, `audit_log`, testes SQL |
| S8-C2-C2 | Frontend de create/update/duplicate: hooks, formulários, contexto explícito, testes; WRITE continua `false` |
| S8-C2-D1 | Backend de move/assign/archive/unarchive/timeline: locks, atomicidade, `audit_log`, testes críticos |
| S8-C2-D2 | Frontend das mutations restantes: flag WRITE, modais, troca de contexto, testes |
| S8-C2-E | Auditoria integrada, validação, documentação, fechamento do C2 |

### 31.17 Compatibilidade e relação com o restante do S8

`profiles.company_id`, `profiles.role`, `profiles.seller_id`, os 4
helpers legados e `User.companyId`/`role`/`sellerId` permanecem
fisicamente inalterados até auditoria dedicada do S8-D/S8-E — nenhuma
remoção nesta etapa. `User.role` isolado nunca deverá autorizar a
navegação comercial (§31.15) — mesmo princípio já aplicado em todo o
S8. **M1-E E4 permanece pausado até o fechamento formal do S8 (S8-F)**
— a arquitetura comercial do Super Admin, mesmo decidida, ainda não
foi implementada, e o E4 continua sendo trabalho posterior ao
fechamento completo do S8.

### 31.18 Confirmações finais

Nenhuma implementação desta arquitetura foi iniciada em nenhuma etapa
até aqui (S8-C2-A0/A1 são auditoria, S8-C2-A2 é esta documentação).
Nenhum código, migration, RPC, helper, policy, flag ou teste foi
criado ou alterado. Nenhuma operação remota foi executada. O seletor
comercial, as flags, as RPCs estreitas de leitura, o parâmetro
`p_company_id` nas 9 RPCs de mutation e o resolver interno **ainda não
existem** — são decisões e planejamento, não implementação.
**O S8-C2-B1 está desbloqueado** — pode ser iniciado sem nenhuma
decisão humana pendente de aprovação além do que já está congelado
nesta seção. **M1-E E4 continua pausado** até o fechamento formal do
S8 (§31.17).

## 32. Implementação do S8-C2-B1 — backend de leitura comercial

Esta seção registra a implementação (não mais planejamento) do
backend de leitura comercial decidido em §31. §0–§31 não foram
alterados.

### 32.1 RLS de Leads/Timeline migrada para membership

`leads_select`/`lead_timeline_select` (`public.leads`/
`public.lead_timeline_entries`) foram recriadas
(`20260728160000_m1f_s8c2b1_leads_timeline_membership_access.sql`)
combinando `current_membership_company_id()`/
`current_membership_role()` com uma checagem inline de
`companies.status = 'ativa'` — **nunca** `can_access_company()`/
`is_manager_or_platform()` isoladamente (ambos aceitam `implantacao`
também, que a matriz de Leads nega especificamente para Manager/
Seller, diferente do Pipeline). Manager vê todos os Leads da própria
empresa `ativa` (incluindo arquivados, comportamento preservado);
Seller vê somente o próprio Lead (via
`current_profile_seller_id_for_company(company_id)`, nunca
`profiles.seller_id`), nunca arquivado. `implantação`/`suspensão`/
`cancelamento` são negados para Manager/Seller nesta leitura — mais
restritivo que a regra já aprovada para Pipeline (S8-C1-B, intocado).
`lead_timeline_select` reaproveita a mesma estrutura de sempre
(`EXISTS` contra `leads`, nunca uma policy independente), só trocando
os helpers. **Nenhuma policy global de Super Admin foi criada** — ele
continua sem SELECT direto em nenhuma das duas tabelas (confirmado por
teste).

### 32.2 Quatro RPCs estreitas de leitura comercial

Criadas em `20260728170000_m1f_s8c2b1_platform_commercial_read_rpcs.sql`,
todas `SECURITY DEFINER`, `search_path=''`, validando
`is_platform_super_admin()` internamente (nunca confiando só no
`GRANT`), `REVOKE ALL` + `GRANT EXECUTE` só para `authenticated`:

- **`list_commercial_companies()`** — sem parâmetros; devolve `id`,
  `name`, `status` de **todas** as empresas, incluindo `cancelada`
  (por isso não reaproveita `useCompanies`/`companies_select_accessible`,
  que a exclui); ordenação determinística por status
  (ativa→implantação→suspensa→cancelada), depois `name`, depois `id`.
- **`list_platform_leads_for_company(p_company_id uuid, p_archived
  boolean default false)`** — empresa sempre explícita
  (`company_required` se `null`, `company_not_found` se inexistente);
  leitura permitida em qualquer status (`ativa`/`implantacao`/
  `suspensa`/`cancelada` — leitura histórica congelada em §31.5);
  `p_archived` espelha exatamente `archived_at IS NULL`/`IS NOT NULL`,
  mesmo predicado já usado por `lib/leads/remoteRepository.ts`; retorna
  `SETOF public.leads`, mesmo formato já consumido hoje; ordenação
  `created_at DESC, id ASC`, idêntica ao caminho remoto atual.
- **`list_platform_lead_timeline(p_company_id uuid, p_lead_id uuid)`**
  — ambos os parâmetros obrigatórios (`company_required`/
  `lead_required`); Lead de **outra** empresa produz o mesmo
  `lead_not_found` de um Lead genuinamente inexistente — nunca revela
  que o Lead existe em outra empresa; retorna `SETOF public.
  lead_timeline_entries`; ordenação `occurred_at DESC, id ASC`.
- **`list_pipeline_stages_for_company(p_company_id uuid)`** — mesma
  validação de empresa das demais; retorna `SETOF public.
  pipeline_stages`; ordenação `sort_order ASC, id ASC`. **Não altera**
  `stages_select`/`stages_insert`/`stages_update`/
  `reorder_pipeline_stages` (S8-C1-B) — Super Admin continua sem
  poder criar, editar ou reordenar etapas; a coluna `sort_order`
  continua fora de qualquer grant de escrita direta, confirmado por
  teste mesmo após a RPC de leitura existir.

**Nenhuma das quatro grava em `audit_log`** — leitura não é ação
auditável (decisão congelada em §31.12, reafirmada aqui).

### 32.3 Tipos regenerados

`lib/supabase/database.types.ts` regenerado via `supabase gen types
typescript --local` — diff estritamente aditivo (81 inserções, zero
remoção, zero objeto não relacionado alterado): as quatro funções
novas aparecem com assinaturas e `Returns`/`SetofOptions` corretos,
apontando para `leads`/`lead_timeline_entries`/`pipeline_stages`.
Nenhuma edição manual.

### 32.4 Teste antigo atualizado — `01_m1e_grants_rls.sql`

Um único ajuste necessário, causa e garantia documentados: o cenário
"admin B vê somente o lead da empresa B" cria um profile **novo**
dentro do próprio arquivo (`b1111111...`), sem `company_memberships`
— com a policy migrada, isso resolvia `current_membership_company_id()`
como `null`, zerando a visibilidade. Adicionada a membership real
(`role='manager'`, mesmo mapeamento do backfill do M1-F S1) e o
`status='ativa'` explícito da empresa de teste (o `default` da coluna
é `'implantacao'`, negado pela nova policy). Garantia preservada:
"admin B" continua vendo exatamente 1 lead, o da própria empresa,
nunca o de outra — só a fonte da autorização mudou. Nenhuma outra
assertion do arquivo foi tocada.

### 32.5 Novo teste — `41_m1f_s8c2b1_commercial_read_backend.sql`

72 asserções: catálogo (RLS habilitada, exatamente 1 policy por
tabela, ausência de helpers legados, as 4 RPCs com assinatura/grants
corretos, as 9 RPCs de mutation + `reorder_pipeline_stages` + as 3
policies de `pipeline_stages` confirmadas intactas); matriz completa
de Manager/Seller (empresa `ativa` — incluindo Seller não vendo Lead
sem dono, de outro Seller, ou o próprio arquivado; `implantação`/
`suspensa`/`cancelada` — negado); membership ausente/suspensa/
offboarded/profile inativo (zero linhas); legado divergente
(`profiles.company_id`/`role` apontando para outra empresa/papel,
ignorados); Super Admin sem SELECT direto; as quatro RPCs cobertas
individualmente (sucesso, erros `company_required`/`company_not_found`/
`lead_required`/`lead_not_found`, `forbidden` para Manager/Seller,
isolamento entre empresas, empresa cancelada incluída/lida); `anon`
negado em tudo.

### 32.6 Validação local

32.7 — Totais confirmados nesta etapa: 36 migrations; SQL 42 arquivos,
**2154/2154** (2082 + 72 novos); TypeScript 98 arquivos, **1607/1607**
(inalterado); build verde, 8/8 páginas.

### 32.8 Escopo preservado

Nenhum frontend alterado (nenhum componente, hook, repository, query
key, bridge, capability ou feature flag tocado). Nenhuma das 9 RPCs de
mutation de leads alterada. `S8-C1-B` (policies de `pipeline_stages` e
`reorder_pipeline_stages`) permanece exatamente como publicado.
`public.profiles`/`public.sellers` permanecem como o S8-C1-A deixou.
Nenhuma coluna removida, nenhum helper legado removido. Nenhuma
operação remota executada.

**O S8-C2-B2 está desbloqueado.** **M1-E E4 continua pausado** até o
fechamento formal do S8 (S8-F).

## 33. Implementação do S8-C2-B2 — frontend de leitura comercial

Esta seção registra a implementação (não mais planejamento) do
frontend de leitura comercial do Super Admin. §0–§32 não foram
alterados.

### 33.1 Divergência de arquitetura encontrada e decisão humana

Auditoria do frontend real (obrigatória antes de qualquer código)
encontrou uma divergência não prevista nos achados do S8-C2-A1:
`ScreenClientes`/`ScreenAndamento` (`components/screens/ScreensOps.tsx`)
e `FlowVerCliente` (`components/flows/FlowsShared.tsx`) são
integralmente acoplados ao modelo local M0 (`LeadService`/
`StoreAdapter`, tipo `Lead` com `urgency`/`timeline` em formato
próprio) — nenhum deles consome a infraestrutura remota de Leads (nem
as RPCs do M1-E, nem as 4 novas do S8-C2-B1). A ponte remota do M1-E
(`lib/leads/bridge.ts`, E3) também nunca foi montada no `App`, e é
estruturalmente incompatível com Super Admin (exige
`activeMembership.companyId`, que ele nunca tem). Adaptar os quatro
retornos reais para o formato mock exigiria inventar `urgency`/
`health`/vendedor/etapa para dados que nunca tiveram esse conceito do
lado do Super Admin.

Decisão humana (registrada, não revisitável sem nova decisão): **nova
superfície própria, somente leitura, para o Super Admin** — nenhum
adaptador de formato, nenhuma alteração em `LeadService`/
`StoreAdapter`/`LeadCard`/`PipeCard`/`FlowVerCliente`. As telas mock de
Manager/Seller permanecem 100% intocadas; a superfície platform é uma
árvore de componentes nova, montada por um switch explícito dentro de
`ScreenClientes`/`ScreenAndamento`, nunca simultaneamente com a
legada.

### 33.2 Feature flag

`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ` (`lib/flags.ts`,
`isSuperAdminCommercialReadEnabled()`), OFF por padrão, mesmo contrato
de `resolveFlag`/override de desenvolvimento
(`autocrm_ff_super_admin_commercial_read`) das flags existentes.
Independente de todas as outras — Manager/Seller nunca a consultam.
`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE` continua não existindo
(etapa futura).

### 33.3 Capability

`canAccessCommercialWorkspace(user)` (`lib/capabilities.ts`) — Super
Admin sempre `true` (a combinação com a flag é do chamador, mesmo
padrão de `canAccessStageSettings`); Manager/Seller `true` somente com
`activeMembership.role` correspondente; sem identidade/membership,
`false`. `User.role` legado nunca é lido.

### 33.4 Contexto comercial estreito

`CommercialCompanyProvider`/`useCommercialCompanyContext`
(`lib/commercial/CommercialCompanyContext.tsx`) — `selectedCompanyId:
string | null`, sem localStorage/sessionStorage/cookie/URL/Zustand.
Montado **uma única vez** em `components/App.tsx`, envolvendo toda a
área autenticada (acima da troca de tela) — a seleção sobrevive à
navegação entre Clientes/Andamento. Reset automático quando
`identityKey` (currentUser.id) muda (login/logout/troca de usuário).
Na troca de empresa, cancela (`queryClient.cancelQueries`) as queries
platform (`leads`/`pipeline-stages`) da empresa **anterior** — nunca
`resetQueryCache()` global; a correção contra "resposta tardia
cruzando empresa" nunca depende disso (garantida pela partição de
query keys em si).

### 33.5 Data layer (companies/leads/timeline/stages)

`lib/commercial/repository.ts` chama exclusivamente as 4 RPCs do
S8-C2-B1 (`list_commercial_companies`/`list_platform_leads_for_company`/
`list_platform_lead_timeline`/`list_pipeline_stages_for_company`) via
`supabase.rpc` — nenhum SELECT direto, nenhuma leitura de `sellers`
(sem policy alguma desde o S8-C1-A, sem RPC própria nesta etapa).
Hooks dedicados (`lib/hooks/useCommercialCompanies.ts`,
`usePlatformLeads.ts`, `usePlatformLeadTimeline.ts`,
`usePlatformPipelineStages.ts`), mesmo contrato `enabled`/Rules-of-Hooks
dos hooks existentes (`useCompanies`/`useLeads`/`usePipelineStages`).
Query keys (`lib/commercial/queryKeys.ts`) com segmento `'platform'`,
isoladas do caminho RLS de Manager/Seller:

```
['platform-commercial', userId, 'companies']
['company', companyId, 'leads', 'platform', 'active']
['company', companyId, 'leads', 'platform', 'archived']
['company', companyId, 'leads', 'platform', 'timeline', leadId]
['company', companyId, 'pipeline-stages', 'platform']
```

Vendedor: `lib/commercial/leadDisplay.ts` nunca resolve nome — apenas
"Sem vendedor"/"Vendedor atribuído" a partir de `seller_id` (nenhuma
fonte segura existe nesta etapa; documentado como limitação
conhecida, não bloqueante). Etapa: `stage_id` fora do índice recebido
mostra "Etapa indisponível", nunca desaparece silenciosamente.

### 33.6 Componentes platform (somente leitura)

`components/commercial/`: `CommercialCompanySelector` (dropdown
controlado, inclui as 4 empresas de status, nunca uma opção "todas");
`CommercialWorkspaceHeader` (selector + selo "somente leitura",
compartilhado pelas duas telas); `PlatformCommercialClientsView`
("Clientes"); `PlatformCommercialPipelineView` ("Em progresso",
colunas por etapa real, cards sem `draggable`/sem handler de drag,
nunca chama `reorder_pipeline_stages`); `PlatformLeadDetails` (detalhe
+ timeline via `usePlatformLeadTimeline`, nenhum callback de
mutation). Nenhum deles importa `LeadService`/`StoreAdapter`/o tipo
`Lead` mock.

### 33.7 Switch de superfície e correção do achado 1

`ScreensOps.tsx`: os corpos antigos de `ScreenClientes`/
`ScreenAndamento` foram renomeados para `ScreenClientesLegacy`/
`ScreenAndamentoLegacy` (sem nenhuma alteração funcional/visual, exceto
a correção abaixo) e `ScreenClientes`/`ScreenAndamento` passaram a ser
componentes-roteador **sem hooks próprios** (Rules of Hooks — mesmo
molde do `UsersTabSection` do S7-C): `platformRole==='super_admin' &&
isSuperAdminCommercialReadEnabled()` monta a view platform; qualquer
outro caso monta o corpo legado, intocado. Quando a view platform está
montada, `LeadService`/`StoreAdapter`/a ponte remota single-tenant
nunca são acionados (o componente legado simplesmente não é
instanciado).

Achado 1 do S8-C2-A1 corrigido dentro de `ScreenAndamentoLegacy`:
`usePipelineStages` agora recebe `companyId:
currentUser?.activeMembership?.companyId ?? null`, nunca mais
`currentUser?.companyId` (legado). `lib/commercial/resolveCompanyId.ts`
(`resolveCommercialCompanyId`) formaliza a regra geral (Super Admin →
`selectedCompanyId`; Manager/Seller → `activeMembership.companyId`;
nunca fallback cruzado) — usada como referência/testada isoladamente.

### 33.8 Navegação (achado 2 corrigido)

`components/App.tsx::allowedNavIds`: os ids `'clientes'`/`'andamento'`
são removidos de `base` quando o ator é Super Admin (nunca mais
herdados de `NAV_ROLES[user.role]` legado, que hoje resolve para
`'admin'`) e só devolvidos via `canAccessCommercialWorkspace(user) &&
isSuperAdminCommercialReadEnabled()`. Manager/Seller continuam
recebendo os dois ids exatamente como sempre, via `base` — nenhuma
mudança de comportamento, nenhuma dependência da flag nova.
`CommercialCompanyProvider` é montado no mesmo componente, envolvendo
`<Rail>`/`<main>`/`<TweaksPanel>`/`<FlowLayer>`.

### 33.9 Validação local

Revalidação SQL pura (nenhum arquivo `supabase/` tocado nesta etapa):
36 migrations, SQL 42 arquivos/2154 testes, idêntico ao S8-C2-B1.
TypeScript: 116 arquivos, **1699/1699** (1607 + 92 novos: flag,
capability, resolver, leadDisplay, query keys, repository, contexto,
os 4 hooks, navegação, switch de superfície). Build verde, 8/8
páginas.

### 33.10 Escopo preservado

Nenhuma migration, RLS, RPC ou `database.types.ts` alterados. Nenhuma
das 9 RPCs de mutation de leads tocada. `S8-C1-B`
(`pipeline_stages`)/`S8-C1-A` (`profiles`/`sellers`) permanecem
exatamente como publicados. Nenhuma mutação implementada nesta etapa
(sem `audit_log`, sem flag WRITE). Nenhuma operação remota executada.

**O S8-C2-C1/C2 e o S8-D permanecem não iniciados. M1-E E4 continua
pausado** até o fechamento formal do S8 (S8-F).

## 34. Implementação do S8-C2-C1 — create, update e duplicidade com contexto comercial

Esta seção registra a implementação (não mais planejamento) de
`create_lead`/`update_lead`/`check_lead_phone_duplicate` com contexto
comercial explícito. §0–§33 não foram alterados.

### 34.1 Resolver interno compartilhado

`resolve_lead_mutation_context(p_company_id uuid default null, p_read_only
boolean default false)` (`20260729100000_m1f_s8c2c1_lead_mutation_context_
resolver.sql`) — `SECURITY DEFINER`, `search_path=''`, **sem GRANT a
authenticated/anon/public** (nunca API pública de frontend; chamado
exclusivamente de dentro das RPCs `SECURITY DEFINER` que o consomem, cujo
owner já tem privilégio implícito). Deriva sempre de `auth.uid()`; nunca
aceita `profile_id`/`role`/`seller_id` do cliente.

- **Super Admin**: `p_company_id` obrigatório na prática
  (`company_required` se null; `company_not_found` se a empresa não
  existe); `p_read_only=false` (default, usado por `create_lead`/
  `update_lead`) exige status `ativa`/`implantacao`, senão
  `company_read_only`; `p_read_only=true` (usado por
  `check_lead_phone_duplicate`) aceita **qualquer status**, inclusive
  `suspensa`/`cancelada` — leitura histórica nunca é mutation.
  `actor_seller_id` sempre null.
- **Manager/Seller**: `p_company_id` **totalmente ignorado** — a empresa
  vem exclusivamente de `current_membership_company_id()`; status precisa
  ser **exatamente `ativa`** (não `implantacao`, mais restritivo que
  `can_access_company()`/Pipeline, mesma régua já aprovada para
  `leads_select` no S8-C2-B1), senão `forbidden`; Seller sem seller ativo
  resolvido via `current_profile_seller_id_for_company()` também
  `forbidden`; `actor_seller_id` = o próprio para Seller, null para
  Manager.
- Qualquer outro caso (sem profile, profile globalmente inativo):
  `forbidden`.

### 34.2 create_lead/update_lead/check_lead_phone_duplicate

`20260729110000_m1f_s8c2c1_lead_create_update_duplicate_commercial.sql` —
as três funções mudam de identidade (ganham `p_company_id uuid default
null` no final), o que o Postgres trata como assinatura nova; `DROP
FUNCTION` da assinatura antiga + `CREATE` da nova, na mesma transação
(nunca uma janela com as duas coexistindo). Nenhuma lê mais
`profiles.company_id`/`profiles.role`/`profiles.seller_id` — toda
autorização passa por `resolve_lead_mutation_context()`.

- **create_lead**: Seller sempre autoatribuído (nunca escolhe outro,
  `forbidden`); Manager/Super Admin podem criar sem vendedor ou escolher
  um vendedor ativo da **empresa resolvida** (`seller_not_found` se de
  outra empresa ou inativo); estágio inicial resolvido pelo `code='new'`
  da empresa resolvida (`initial_stage_missing` preservado).
- **update_lead**: Seller só edita o próprio lead (`forbidden` para
  alheio); Manager/Super Admin editam qualquer lead da empresa resolvida;
  lead de outra empresa usa o mesmo `lead_not_found` de um lead
  inexistente (nunca revela a outra empresa); `version`/`stale_write`
  preservados integralmente.
- **check_lead_phone_duplicate**: chama o resolver com `p_read_only=true`
  — Super Admin lê duplicidade em qualquer status; Manager/Seller
  continuam restritos a `ativa`. Nunca escreve em `audit_log` (leitura
  não é ação auditável, mesma decisão das 4 RPCs do S8-C2-B1).

### 34.3 Divergência encontrada e decisão humana — FKs de autoria

Divergência descoberta em teste, não prevista no planejamento: `leads_
created_by_fk`/`leads_updated_by_fk` (`m1e_01`) exigem que `created_by_
profile_id`/`updated_by_profile_id` pertençam à **mesma `company_id`** do
lead (`FOREIGN KEY (company_id, created_by_profile_id) REFERENCES
profiles (company_id, id)`). Super Admin nunca tem `profiles.company_id`
(sempre null, por desenho — ator global da KAPA, nunca de uma empresa) —
nenhuma combinação `(empresa real, super_admin_id)` pode satisfazer essa
FK, em nenhuma empresa. `create_lead`/`update_lead` por Super Admin
violavam `leads_created_by_fk`/`leads_updated_by_fk` sempre, confirmado
ao vivo pelo teste pgTAP antes desta decisão.

**Decisão humana (registrada, não revisitável sem nova decisão)**: para
mutations do Super Admin, `created_by_profile_id`/`updated_by_profile_id`
ficam **NULL** (a FK aceita null) — nunca `auth.uid()`/o profile do Super
Admin nesses dois campos. A autoria real continua integralmente
preservada em `audit_log.actor_profile_id` (que não tem essa restrição de
mesma empresa) — não é perda de rastreabilidade, é a coluna certa para um
ator que estrutural e corretamente não pertence a nenhuma empresa.
`create_lead`: os dois campos ficam null na própria inserção. `update_lead`:
somente `updated_by_profile_id` vira null; `created_by_profile_id`
**nunca é tocado** por um update — a autoria original da criação (de um
Manager/Seller, ou já null de uma criação anterior por Super Admin)
permanece intacta. Manager/Seller preservam exatamente o comportamento
atual (profile real sempre) — nenhuma mudança de comportamento, nenhuma
FK alterada, nenhuma coluna/constraint/schema de `public.leads` tocada.

Um segundo caso do mesmo tipo apareceu ao testar "legado divergente"
(profile com membership real numa empresa, mas `profiles.company_id`
legado apontando para outra) — tecnicamente a mesma FK se rompe para
**qualquer** ator cujo `profiles.company_id` divirja da empresa
resolvida pela membership (situação real e possível após uma
transferência, `transfer_membership`/S6-D, que nunca atualiza
`profiles.company_id`). A decisão humana foi explícita em restringir o
tratamento NULL **exclusivamente a Super Admin** ("Manager/Seller
preservam exatamente o comportamento atual") — por isso o fixture de
teste do "legado divergente" foi ajustado para não exercitar essa
combinação específica via `create_lead`/`update_lead` (que escreveriam
nos dois campos); a prova de "`profiles.company_id` nunca autoriza" para
Manager/Seller é feita através dos testes já existentes de `p_company_id`
enviado pelo cliente sendo ignorado (mesma garantia, caminho sem escrita
nos campos protegidos pela FK). Este comportamento pré-existente das FKs
para Manager/Seller com `profiles.company_id` desatualizado **não foi
alterado nem corrigido nesta etapa** — está fora do escopo autorizado
(nenhuma mudança de schema) e é registrado aqui como um risco conhecido,
não resolvido, para uma decisão futura própria.

### 34.4 Auditoria de mutations do Super Admin

Somente `create_lead`/`update_lead` bem-sucedidos com `actor_kind =
'super_admin'` escrevem em `audit_log`, na mesma transação da mutação
comercial (`insert` de auditoria e `insert`/`update` do lead sempre juntos
— uma falha em qualquer um desfaz o outro, por estarem na mesma função/
transação). `check_lead_phone_duplicate` nunca audita (leitura).

- **create**: `action='lead_created'`, `before_data=null`, `after_data =
  {lead_id, stage_id, seller_id, archived:false}` — nunca nome, telefone
  ou veículo.
- **update**: `action='lead_updated'`; `name`/`phone` nunca levam o
  valor, só uma flag (`name_changed`/`phone_changed`); `car`/
  `temperature`/`payment_preference`/`source` levam o valor real de antes
  e depois (não são PII, e a auditoria é sempre a diferença exata entre o
  que existia e o que passou a existir).
- Ambos: `actor_profile_id` = o Super Admin real; `company_id` = a
  empresa explícita resolvida; `entity_type='lead'`; `entity_id` = o lead
  afetado; `result='success'`.

### 34.5 Assinaturas finais e PostgREST

Confirmado via `pg_get_function_arguments`/`pg_proc`: cada uma das três
RPCs tem **uma única assinatura** no catálogo (a antiga foi removida pelo
`DROP FUNCTION`, nunca ficou como overload); `p_company_id` é sempre o
último parâmetro, com `DEFAULT NULL::uuid`. Grants recriados na mesma
migration: `REVOKE ALL` de `public`/`anon`/`authenticated` seguido de
`GRANT EXECUTE` só para `authenticated`, idêntico ao padrão anterior.
`resolve_lead_mutation_context` aparece no catálogo (e em
`database.types.ts`, artefato do gerador) mas **sem nenhum GRANT** —
nunca chamável pelo cliente.

### 34.6 Tipos regenerados

`lib/supabase/database.types.ts` via `supabase gen types typescript
--local` — diff estritamente aditivo (13 inserções, 1 deleção): `p_company_id`
opcional adicionado às três RPCs; `resolve_lead_mutation_context` aparece
como novo `Functions` entry (Args/Returns corretos); nenhum outro objeto
alterado. Nenhuma edição manual.

### 34.7 Testes antigos atualizados

Autorizados e alterados exatamente 3 arquivos:

- **`supabase/tests/02_m1e_create_lead.sql`**: fixture da "Empresa C
  Teste" ganhou `status='ativa'` explícito (o default da coluna é
  `implantacao`, negado pela nova regra de Manager/Seller) e uma
  `company_memberships` real para "Admin C" (legado `role='admin'` ->
  `company_memberships.role='manager'`, mesmo mapeamento já usado em
  `01_m1e_grants_rls.sql`) — sem essa membership,
  `current_membership_company_id()` resolveria null antes mesmo de
  alcançar a checagem de estágio que o arquivo quer exercitar
  (`initial_stage_missing`). Garantia preservada: mesmo conjunto de
  asserções, mesmos erros esperados.
- **`supabase/tests/03_m1e_update_lead.sql`**: nenhuma alteração — os
  atores usados (seed da Empresa A) já têm `company_memberships` reais
  desde o M1-F S1, status `ativa` desde o seed.
- **`supabase/tests/08_m1e_duplicate.sql`**: nenhuma alteração — mesmo
  motivo.

### 34.8 Novo teste — `42_m1f_s8c2c1_lead_create_update_context.sql`

97 asserções: catálogo (assinatura única das 3 RPCs + do resolver,
`p_company_id` como último parâmetro com default, `SECURITY DEFINER`
correto, `resolve_lead_mutation_context` sem grant a `authenticated`/
`anon`, as 6 demais RPCs de mutation + as 4 RPCs de leitura do S8-C2-B1 +
as policies de `leads`/`pipeline_stages` todas confirmadas intactas);
matriz completa de Super Admin (create/update/duplicidade em
`ativa`/`implantacao`/`suspensa`/`cancelada`, `company_required`/
`company_not_found`/`company_read_only`, vendedor de outra empresa/
inativo negado, `initial_stage_missing` preservado, isolamento entre
empresas na duplicidade, `created_by`/`updated_by_profile_id` sempre
null, `created_by_profile_id` original preservado ao editar um lead
criado por Manager, auditoria completa incluindo a política de PII);
Manager/Seller (criação com/sem vendedor, autoatribuição do Seller,
`p_company_id` enviado pelo cliente sempre ignorado, lead de outra
empresa nunca vazado, `created_by`/`updated_by_profile_id` preservados
sem nenhuma mudança de comportamento, zero `audit_log` de plataforma);
empresa não `ativa` nega Manager/Seller em create/update/duplicidade
(`implantacao`/`suspensa`/`cancelada`); membership ausente/suspensa/
offboarded/profile globalmente inativo (todos `forbidden`); legado
divergente (`profiles.role`/`profiles.seller_id` nunca lidos — ver
§34.3 para a limitação conhecida de `profiles.company_id`); `anon`
negado nas três RPCs.

### 34.9 Validação completa

37 migrations locais; SQL 43 arquivos, **2251/2251** (2154 + 97 novos);
TypeScript 108 arquivos, **1699/1699** (inalterado — nenhum frontend
tocado); build verde, 8/8 páginas.

### 34.10 Escopo preservado

Nenhuma outra RPC alterada (as 6 demais RPCs de mutation de leads e as 4
RPCs de leitura comercial do S8-C2-B1 permanecem exatamente como
publicadas). Nenhuma policy de `leads`/`pipeline_stages`/`profiles`/
`sellers` tocada. Nenhuma coluna, constraint ou tabela removida ou
alterada — inclusive as FKs de autoria discutidas em §34.3, deixadas
exatamente como estão. Nenhum helper legado removido. Nenhum frontend,
hook, componente ou flag alterado; `NEXT_PUBLIC_FF_SUPER_ADMIN_
COMMERCIAL_READ` inalterada; `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE`
continua não existindo. Nenhuma operação remota executada.

**O S8-C2-C2 e o S8-C2-D1 permanecem não iniciados. M1-E E4 continua
pausado** até o fechamento formal do S8 (S8-F). Risco conhecido e não
resolvido (§34.3): `leads_created_by_fk`/`leads_updated_by_fk` continuam
estruturalmente incompatíveis com qualquer ator (Manager/Seller incluído)
cujo `profiles.company_id` legado divirja da empresa da membership real —
hoje isso nunca ocorreu em produção para Manager/Seller por coincidência
de dados, mas é alcançável após uma transferência de empresa
(`transfer_membership`, S6-D), que nunca atualiza `profiles.company_id`.

## 35. Autoria empresarial por membership histórica

Esta seção fecha o risco registrado em §34.3/34.10 e na auditoria
S8-C2-C1-AUTH-A0. §0–§34 não foram alterados.

### 35.1 Conflito reproduzido

Reprodução local (rollback, nenhum dado persistido): Seller1 (membership
ativa em A) cria um Lead em A; Super Admin executa `transfer_membership`
para B (com sucessor, pois havia lead aberto); a membership em B fica
`active`, a membership em A fica `offboarded` (nunca apagada);
`profiles.company_id` **permanece A** (`transfer_membership` nunca o
escreve — nenhuma RPC jamais escreveu nele além de `accept_invite`, na
criação inicial do profile). `create_lead` em B, já corretamente
autorizado pela membership real, falhava com
`leads_created_by_fk` (SQLSTATE 23503) — a autorização (membership) e a
integridade referencial (`profiles.company_id`) usavam fontes diferentes
e divergiram exatamente neste ponto.

### 35.2 Decisão: reapontar as FKs para a membership histórica

`leads_created_by_fk`/`leads_updated_by_fk` passam a referenciar
`public.company_memberships(company_id, profile_id)` — nunca mais
`public.profiles(company_id, id)`. `profiles.company_id` permanece
deliberadamente legado, nunca sincronizado, nunca lido por nenhuma RPC ou
constraint nova. As colunas `leads.created_by_profile_id`/
`updated_by_profile_id` são preservadas exatamente como estão (continuam
guardando o `profiles.id` global) — só o **alvo da integridade
referencial** muda, para a mesma fonte que já decide autorização
(`company_memberships`) desde o S8-C2-C1.

### 35.3 Significado final dos dois campos

Representam "o profile que efetuou a ação, provado por ter tido (em
qualquer momento, inclusive hoje offboarded) uma membership na mesma
empresa do Lead" — nunca identidade global pura (Opção A do relatório da
auditoria, rejeitando B, C, D, E). `company_memberships` nunca apaga
fisicamente uma linha (nenhuma RPC do projeto o faz) — por isso a
membership histórica sustenta a autoria de um Lead para sempre, mesmo após
offboarding, suspensão ou transferência para outra empresa.

### 35.4 Offboarding e transferência não apagam autoria

Offboarding: a membership perde `is_active`/`lifecycle_status='active'`
mas a linha permanece — a FK continua satisfeita, a autoria histórica do
Lead nunca é afetada; o usuário só perde autorização **operacional** (via
`resolve_lead_mutation_context`), nunca a prova de autoria passada.
Transferência A→B: a membership de A vira `offboarded` (nunca apagada) —
Leads antigos criados em A continuam com FK válida contra essa linha
histórica; a nova membership em B (criada ou reaproveitada de uma linha
offboarded anterior) autoriza `create_lead`/`update_lead` em B
normalmente, e a nova FK é satisfeita pela membership de B.
`profiles.company_id` pode permanecer A indefinidamente sem interferir em
nada — nem na autorização (já não lido desde o S8-C2-C1), nem agora na
integridade referencial.

### 35.5 Super Admin e audit_log inalterados

`created_by_profile_id`/`updated_by_profile_id` continuam `NULL` para
Super Admin (decisão do S8-C2-C1, §34.3 — Super Admin nunca tem
`company_memberships`, por desenho; nenhuma membership artificial foi
criada). `NULL` satisfaz qualquer FK trivialmente. A autoria real do
Super Admin continua exclusivamente em `audit_log.actor_profile_id`.

### 35.6 Hard delete bloqueado

Nova política: `ON DELETE RESTRICT` (nunca `SET NULL`/`CASCADE`) — mesmo
padrão já usado por `leads_company_seller_fk`/`leads_company_stage_fk`/
`sellers_membership_company_fk` neste mesmo schema. Uma tentativa de
apagar fisicamente uma `company_memberships` referenciada por qualquer
Lead falha imediatamente. Nenhuma RPC do projeto apaga `company_
memberships` hoje — a política é defesa em profundidade contra uma
exclusão manual/futura, nunca um caminho operacional real. `ON UPDATE`
permanece implícito (`NO ACTION`), idêntico às demais FKs compostas de
`leads` — `company_id`/`profile_id` de uma membership são imutáveis após
a criação (trigger de consistência do S1), então a cláusula nunca é
exercitada na prática.

### 35.7 Validação de dados preexistentes

A migration valida, antes de alterar qualquer constraint, que todo
`created_by_profile_id`/`updated_by_profile_id` não nulo já existente
possui uma linha correspondente em `company_memberships(company_id,
profile_id)` — se não, a migration falha fechada com
`authorship_membership_backfill_required` (contagem sanitizada, nenhum
dado pessoal). Localmente, `public.leads` está vazio (seed não cria
nenhum lead) — a validação passa trivialmente, sem necessidade de
backfill.

### 35.8 Escopo preservado

Nenhuma RPC alterada (`create_lead`/`update_lead`/
`check_lead_phone_duplicate`/`resolve_lead_mutation_context` continuam
exatamente como o S8-C2-C1 publicou). Nenhuma coluna adicionada ou
removida. `public.profiles`/`public.company_memberships` sem alteração de
schema. `UNIQUE(company_id, profile_id)` (já existente desde o S1) não é
recriada nem alterada. `database.types.ts` sem diff — a mudança de alvo
da FK não altera coluna, tipo ou assinatura nenhuma; o único efeito
colateral seria a metade descritiva `Relationships.referencedRelation`
(usada por PostgREST embedding), confirmado sem nenhum consumidor real no
código (`created_by_profile_id`/`updated_by_profile_id` só são lidos como
coluna escalar, nunca via embedding) — deixar essa metadata desatualizada
é inerte, não regenerado nesta etapa. Nenhuma operação remota executada.

**O S8-C2-C2 só se desbloqueia com esta etapa publicada e validada. M1-E
E4 continua pausado.**

## 36. Fonte segura de Sellers para a operação comercial

Esta seção registra a implementação (não mais planejamento) da RPC de
leitura que desbloqueia o Seller picker do S8-C2-C2. §0–§35 não foram
alterados. **O S8-C2-C2 (frontend de create/update/duplicidade) continua
pausado** — nenhuma linha de frontend foi tocada nesta etapa.

### 36.1 Bloqueio encontrado

Ao planejar o formulário de criação do S8-C2-C2, nenhuma fonte publicada
fornecia o identificador que `create_lead`/`assign_lead_seller` exigem em
`p_seller_id` (`public.sellers.id`, `text`, independente de
`profiles.id`). `list_company_users`/`list_inactive_company_users`
devolvem `profile_id`/`membership_id` — nunca `sellers.id`. `public.
sellers` não tem nenhuma RLS policy e `authenticated`/`anon` não têm
`SELECT` (apenas os privilégios default `TRUNCATE`/`REFERENCES`/
`TRIGGER`, confirmado ao vivo). Nenhuma RPC publicada retornava um
roster de sellers. `profile_id`, `membership_id` e `seller_id` são três
identidades **distintas**, nunca substituíveis entre si — usar
`profile_id` no lugar de `seller_id` teria feito `create_lead` falhar
sempre com `seller_not_found`, ou pior, atribuído o Lead a um Seller
diferente do pretendido caso algum id colidisse por acaso.

### 36.2 RPC estreita: list_platform_sellers_for_company

`list_platform_sellers_for_company(p_company_id uuid)` — mesmo padrão
das quatro RPCs do S8-C2-B1 (`SECURITY DEFINER`, `search_path=''`,
valida `is_platform_super_admin()` internamente, `REVOKE ALL` + `GRANT
EXECUTE` só para `authenticated`). Empresa sempre explícita
(`company_required`/`company_not_found`); `ativa`/`implantacao`
permitidas (mesma matriz de mutation do S8-C2-C1); `suspensa`/`cancelada`
→ `company_read_only` (é preparação para o Seller picker de escrita,
nunca leitura histórica solta). Qualquer ator que não seja Super Admin
→ `forbidden`, mesmo com empresa válida — Manager/Seller nunca precisam
desta RPC (já resolvem o próprio Seller via
`current_profile_seller_id_for_company()`).

### 36.3 Filtro de "Seller operacional"

Retorna somente sellers que satisfaçam **simultaneamente**:
`sellers.company_id = p_company_id`, `sellers.is_active = true`,
`sellers.membership_id` resolvendo uma `company_memberships` com
`company_id` igual, `role = 'seller'`, `is_active = true`,
`lifecycle_status = 'active'`, e `profiles.is_active = true` (via
`company_memberships.profile_id`). Mesmo padrão defensivo de
`current_profile_seller_id_for_company()` (S2) — `sellers.is_active` já
é mantido em sincronia em **todo** ponto de transição do ciclo de vida
(`suspend_membership`/`reactivate_membership`/`offboard_seller`/
`transfer_membership`/`update_membership_role`, confirmado por auditoria
de todas as migrations que escrevem `sellers.is_active`), mas a checagem
completa da cadeia é redundância deliberada, nunca confiança cega numa
única coluna. `profiles.role`/`profiles.seller_id` legados **nunca** são
lidos. Um Seller promovido a Manager, transferido para outra empresa,
suspenso ou offboarded nunca aparece — a mesma linha física de `sellers`
não desaparece (nunca é apagada), só deixa de satisfazer o filtro.

### 36.4 Retorno mínimo

Somente `seller_id` (tipo real de `sellers.id`, `text`) e `name`
(`sellers.name`, nunca vazio pela constraint já existente na tabela).
Nenhum e-mail, telefone, `platform_role`, `company_role`,
`lifecycle_status`, `membership_id` ou qualquer dado administrativo —
o Seller picker só precisa do valor a enviar em `p_seller_id` e do nome
a exibir. Ordenação determinística: `name`, depois `seller_id` como
desempate.

### 36.5 Grants e segurança

`REVOKE ALL` de `public`/`anon`/`authenticated` seguido de `GRANT
EXECUTE` só para `authenticated` — nenhum `SELECT` novo em `sellers`,
`profiles` ou `company_memberships`; a RPC continua sendo o único
caminho. `database.types.ts` regenerado — diff estritamente aditivo (a
nova função aparece; nenhuma outra assinatura muda).

### 36.6 Escopo preservado

Nenhuma RPC de mutation alterada (`create_lead`/`update_lead`/
`check_lead_phone_duplicate`/`assign_lead_seller`/as demais 5 RPCs de
leads intactas). Nenhuma policy tocada. Nenhum `SELECT` direto concedido
em `sellers`/`profiles`/`company_memberships`. Nenhuma coluna alterada.
Nenhum frontend, hook, componente ou flag criado/alterado — o Seller
picker e o restante do S8-C2-C2 permanecem para a próxima etapa. Nenhuma
operação remota executada.

**O S8-C2-C2 (frontend de create/update/duplicidade) só se desbloqueia
com esta subetapa publicada e validada. M1-E E4 continua pausado.**

## 37. Implementação do S8-C2-C2 — frontend platform de create, update e duplicidade

Esta seção registra a implementação (não mais planejamento) do
frontend de criação/edição/verificação de duplicidade de Leads na
superfície platform do Super Admin. §0–§36 não foram alterados.

### 37.1 Escopo

Conecta a superfície comercial platform (S8-C2-B2) às quatro RPCs já
publicadas e validadas (`create_lead`/`update_lead`/
`check_lead_phone_duplicate`, S8-C2-C1/AUTH-A1;
`list_platform_sellers_for_company`, S8-C2-C2-SELLERS-B1). Exclusivo
de Super Admin — Manager/Seller permanecem 100% nas telas legadas
(`LeadService`/`StoreAdapter`), sem nenhuma alteração. Nenhuma
migration, RLS, RPC, grant ou `database.types.ts` alterados nesta
etapa. Nenhum move/drag, atribuição de vendedor pós-criação,
arquivamento/desarquivamento ou nova timeline — permanecem
indisponíveis em qualquer combinação de flags/status.

### 37.2 Feature flag WRITE

`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE` (`lib/flags.ts`,
`isSuperAdminCommercialWriteEnabled()`), OFF por padrão, mesmo
contrato de `resolveFlag`/override de desenvolvimento
(`autocrm_ff_super_admin_commercial_write`) das demais flags. Só o
valor bruto da própria flag — a combinação "WRITE só é EFETIVA quando
READ também está ligada" é decisão do chamador
(`canMutateCommercialWorkspace`), nunca desta função, mesmo padrão já
usado por `isUserLifecycleEnabled()`/`isActiveUsersEnabled()`.
Independente de todas as outras flags.

### 37.3 Capability de mutation

`canMutateCommercialWorkspace(input)` (`lib/capabilities.ts`) —
capability PRÓPRIA, nunca uma ampliação de
`canAccessCommercialWorkspace` (que só decide se o workspace de
LEITURA existe). `true` somente quando **todas** as condições valem
simultaneamente: `actor.platformRole === 'super_admin'`;
`readEnabled && writeEnabled`; `selectedCompanyStatus` não nulo
(nenhuma empresa selecionada nunca é inferida); status `'ativa'` ou
`'implantacao'` (mesma matriz já aprovada para as RPCs de mutation no
S8-C2-C1 — `'suspensa'`/`'cancelada'` sempre `false`, mesmo com as
duas flags ligadas). `profile.is_active` não é checado (mesmo
raciocínio de `canManageInvites`: um `User` inativo nunca existe em
memória).

### 37.4 Data layer — Sellers

`fetchPlatformSellers(companyId)` (`lib/commercial/repository.ts`)
chama `list_platform_sellers_for_company` — nunca `public.sellers`
direto. Hook `usePlatformSellers` (`lib/hooks/usePlatformSellers.ts`),
mesmo contrato `enabled`/Rules-of-Hooks dos hooks platform existentes.
Query key própria (`platformCommercialQueryKeys.sellers(companyId)` —
`['company', companyId, 'commercial-sellers', 'platform']`), nunca
compartilhada com `leadsRoot`/`stages`. `seller_id` é identidade **por
empresa** (achado da S8-C2-C2-SELLERS-B1: `transfer_membership` cria
uma linha `sellers` nova na empresa destino) — a troca de `companyId`
já invalida a query por si só (key diferente); os formulários de
create/edit adicionalmente limpam a seleção quando o Seller escolhido
some da lista recarregada.

### 37.5 Data layer — create/update

`createPlatformLead`/`updatePlatformLead` (`lib/commercial/
repository.ts`) chamam `create_lead`/`update_lead` com `p_company_id`
sempre o valor explícito recebido por parâmetro — nunca um fallback
implícito. `update_lead` envia **somente** os campos reais do seu
contrato (`name`/`phone`/`car`/`temperature`/`payment_preference`/
`source`/`expected_version`) — nenhum `seller_id`/etapa/
`archived_at`/timeline (a RPC nem os aceita; decisão #8 do S8-C2-C2:
editar nunca move Etapa nem atribui Vendedor). Hooks
`useCreatePlatformLead`/`useUpdatePlatformLead`
(`lib/hooks/`) — `useMutation` sem retry automático (nenhuma das duas
RPCs é idempotente/seguramente reexecutável às cegas). Cada hook
recebe um `isContextStillValid()` resolvido pelo chamador (formulário)
e verificado **imediatamente antes** de enviar a RPC — se a empresa
mudou nesse intervalo, a RPC nunca é chamada. `onSuccess` invalida
somente `leadsActive(companyId capturado)` (nunca `leadsArchived`:
`update_lead` recusa com `lead_archived` qualquer Lead já arquivado,
então a lista arquivada nunca é afetada).

### 37.6 Data layer — duplicidade

`checkPlatformLeadPhoneDuplicate(companyId, phone)`
(`lib/commercial/repository.ts`) chama `check_lead_phone_duplicate`
sempre com `p_company_id` explícito. Hook
`useCheckPlatformLeadPhoneDuplicate` — deliberadamente um
`useMutation` imperativo, nunca `useQuery`: o telefone é PII e nunca
vira parte de uma query key persistida no cache. `check_lead_phone_
duplicate` não tem parâmetro de autoexclusão do próprio Lead — o
formulário de edição resolve isso pulando a checagem quando o
telefone não mudou (o próprio Lead nunca seria encontrado buscando o
valor NOVO contra o `phone_digits` ainda ANTIGO no banco; quando o
telefone muda, a busca pelo valor novo estruturalmente nunca encontra
o próprio Lead, então nenhuma exclusão explícita é necessária). O
`status` retornado (`'accessible'`/`'restricted'`/`'none'`) é usado
apenas como `status !== 'none'` — `lead_id`/`lead_name`/
`lead_archived` da resposta **nunca** são lidos pelo frontend (decisão
§9: dado de outro Lead nunca é revelado); a mensagem exibida é sempre
a genérica "Já existe um Lead com este telefone nesta empresa.".

### 37.7 Formulários platform (create/edit)

`PlatformLeadCreateModal`/`PlatformLeadEditModal`
(`components/commercial/`) — formulários PRÓPRIOS, reaproveitando
apenas os componentes visuais puros e independentes de modelo já
aprovados (`FlowShell`/`FField`/`Segmented`/`LBtn`), nunca os
formulários mock (`Flows2`/`Flows3`) nem `LeadService`. Create expõe
somente campos reais de `create_lead` (`name`/`phone`/`car`
obrigatórios; `temperature`/`payment_preference`/`source`/Seller
opcionais — etapa inicial sempre resolvida pelo servidor, nunca
escolhida na UI). Edit expõe somente campos reais de `update_lead` —
sem Seller/Etapa/arquivamento. Empresa exibida no cabeçalho
(`eyebrow`), nunca editável dentro do formulário. `company`/`lead` são
capturados via prop no momento de abertura (o componente pai só monta
o modal com a empresa/Lead correntes); um `useEffect` fecha o modal
imediatamente se `selectedCompanyId` (lido ao vivo do contexto) deixar
de bater com a empresa capturada.

### 37.8 Proteção de contexto durante a mutation

Cada modal mantém um `useRef` atualizado via `useEffect` com o
`selectedCompanyId` mais recente do `CommercialCompanyContext`
(closures assíncronas não veem re-renders). Imediatamente antes de
chamar `createLead`/`updateLead`, o formulário verifica
`liveCompanyIdRef.current === company.id`; se mudou, a chamada é
abortada sem enviar a RPC. Dentro do próprio hook de mutation, o mesmo
`isContextStillValid()` é reavaliado antes do `mutationFn` chamar o
repository — dupla checagem, nunca confiança single-point. Como as
query keys já são inteiramente particionadas por `companyId`
(`platformCommercialQueryKeys`), uma resposta tardia jamais escreve no
cache da empresa errada mesmo se a UI já tiver mudado de contexto —
a opção escolhida (mais simples e já suficiente) foi nunca bloquear o
seletor de empresa, e sim fechar o formulário aberto quando a empresa
muda, decisão registrada aqui por ser a mais simples que preserva
segurança total.

### 37.9 Integração visual

`CommercialWorkspaceHeader` ganhou a prop `readOnly` (default `true`,
preserva o comportamento do B2) — o selo "Modo comercial — somente
leitura" só aparece quando `readOnly` é `true`. `PlatformCommercial
ClientsView`/`PlatformCommercialPipelineView` calculam `canMutate`
via `canMutateCommercialWorkspace` a cada render e passam `readOnly=
!canMutate`; com `canMutate` verdadeiro, o `PageHead` ganha o botão
"Novo Lead" (via a prop `actions`, sem componente novo) e
`PlatformLeadDetails` ganha uma ação "Editar" (nova prop `canMutate`/
`onEdit`, default `false`/`undefined` — preserva 100% o comportamento
original quando omitida). Nenhum hook de escrita (`usePlatformSellers`
com `authorized: true`, `useCreatePlatformLead`, `useUpdatePlatformLead`)
é montado incondicionalmente fora do fluxo dos modais — eles só existem
dentro de `PlatformLeadCreateModal`/`PlatformLeadEditModal`, que só
são renderizados quando `canMutate` é verdadeiro.

### 37.10 Erros

`getPlatformCommercialErrorMessage` (`lib/commercial/errors.ts`) —
tradutor único e centralizado dos códigos estáveis das quatro RPCs
(`company_required`/`company_not_found`/`company_read_only`/
`forbidden`/`initial_stage_missing`/`seller_not_found`/
`lead_not_found`/`lead_archived`/`stale_write`/`invalid_phone`) mais
os erros LOCAIS dos hooks (autorização/contexto obsoleto,
pré-verificados antes de qualquer chamada de rede). Nenhum componente
compara `detail.message` bruto; nenhuma mensagem expõe SQL, UUID ou
stack.

### 37.11 Manager e Seller

Nenhuma linha de `LeadService`/`StoreAdapter`/`Flows2`/`Flows3`/
`FlowVerCliente` foi tocada. As flags WRITE/READ não são consultadas
em nenhum ponto do caminho legado. `ScreenClientesLegacy`/
`ScreenAndamentoLegacy` permanecem exatamente como no S8-C2-B2.

### 37.12 Validação local

Revalidação SQL pura (nenhum arquivo `supabase/` tocado nesta etapa):
40 migrations, SQL **45 arquivos/2316 testes**, idêntico ao estado
oficial anterior (`supabase db reset` + `supabase test db`,
`Result: PASS`). TypeScript: **118 arquivos, 1808/1808** (108/1699 +
10 arquivos novos/109 testes novos: flag WRITE, capability, Sellers/
create/update/duplicidade no repository e nos hooks, tradutor de
erros, formulários create/edit, integração visual nas duas views,
ação Editar em `PlatformLeadDetails`). Build verde, 8/8 páginas.

### 37.13 Escopo preservado

Nenhuma migration, RLS, grant, `audit_log` ou `database.types.ts`
alterados. Nenhum componente mock modificado. `S8-C2-D1`/`S8-D`/M1-E
E4 continuam não iniciados/pausados. Nenhuma operação remota
executada.

**O S8-C2-C2 (frontend de create/update/duplicidade) está completo.
S8-C2-D1/S8-D permanecem não iniciados. M1-E E4 continua pausado.**

## 38. Implementação do S8-C2-D1 — mutations comerciais restantes

Esta seção registra a implementação (não mais planejamento) de
`move_lead_to_stage`/`apply_lead_event`/`assign_lead_seller`/
`archive_lead`/`unarchive_lead`/`add_lead_timeline_entry` com contexto
comercial explícito, fechando a migração das 9 RPCs de mutation de Leads
iniciada no S8-C2-C1 (§34). §0–§37 não foram alterados.

### 38.1 Seis RPCs migradas, resolver reutilizado sem duplicação

`20260729140000_m1f_s8c2d1_move_event_assign_commercial.sql` (move/event/
assign) e `20260729150000_m1f_s8c2d1_archive_unarchive_timeline_commercial.sql`
(archive/unarchive/timeline) — mesmo molde de `20260729110000` (S8-C2-C1):
`DROP FUNCTION` da assinatura antiga + `CREATE` da nova, na mesma
transação (nenhuma janela com as duas coexistindo, nenhum overload).
Todas as seis chamam exclusivamente `resolve_lead_mutation_context
(p_company_id)` (mesmo resolver do S8-C2-C1, `p_read_only=false` — são
mutation real) — nenhuma lê mais `profiles.company_id`/`profiles.role`/
`profiles.seller_id`. Nenhuma segunda lógica de resolução empresarial foi
criada. Divisão em duas migrations pelo motivo já previsto: isolar
movimentação/atribuição de lifecycle/timeline — nenhuma dependência
circular exigiu migration única.

### 38.2 Regras por ator, preservadas e estendidas

- **Super Admin**: `p_company_id` obrigatório na prática (`company_
  required`/`company_not_found` do resolver); status `ativa`/`implantacao`
  permitido, `suspensa`/`cancelada` nega com `company_read_only`; pode
  mover, aplicar evento e adicionar timeline em qualquer Lead da empresa
  explícita; pode atribuir/trocar/remover Seller e arquivar/desarquivar —
  autoridade que as 6 RPCs nunca concediam antes (a checagem original
  `profiles.company_id is null` bloqueava Super Admin em todas elas, já
  que ele nunca tem `company_id`).
- **Manager**: contrato idêntico ao já publicado (movimenta/atribui/
  arquiva/desarquiva/adiciona timeline em qualquer Lead da própria
  empresa), agora resolvido por `current_membership_company_id()` em vez
  de `profiles.company_id`; `p_company_id` enviado pelo cliente
  **totalmente ignorado**, inclusive apontando para outra empresa
  (provado no teste novo).
- **Seller**: move/aplica evento/adiciona timeline somente no próprio
  Lead (via `actor_seller_id` do resolver, nunca `profiles.seller_id`);
  **nunca** atribui Seller, arquiva ou desarquiva — mesmo contrato
  anterior, checagem de papel adaptada para `actor_kind = 'seller'`.

### 38.3 Status permitidos e isolamento entre empresas

Idêntico à matriz já congelada em §31.5/§34.1: Super Admin `ativa`/
`implantacao`; Manager/Seller exatamente `ativa` (implantação/suspensão/
cancelamento negados, mais restritivo que Pipeline/S8-C1-B). Stage e
Seller de destino sempre validados contra `v_ctx.resolved_company_id` —
Stage/Seller/Lead de outra empresa nunca alcançáveis, mesmo com
`p_company_id` explícito de Super Admin apontando para a empresa
correta (o Lead/Stage/Seller alheio simplesmente não existe dentro do
filtro da empresa resolvida); Lead de outra empresa produz o mesmo
`lead_not_found` de um Lead inexistente, nunca vazando a outra empresa.

### 38.4 Autoria: NULL para Super Admin, preservada para Manager/Seller

`updated_by_profile_id` (leads) e `actor_profile_id`
(`lead_timeline_entries`) seguem exatamente a decisão do §34.3/§35:
`NULL` quando o ator é Super Admin (nenhuma das FKs — `leads_updated_by_
fk`, já reapontada para `company_memberships` no S8-C2-C1-AUTH-A1, e
`lead_timeline_actor_fk`, que **continua** apontando para
`public.profiles(company_id, id)` e não foi tocada nesta etapa — pode
ser satisfeita por um ator sem `company_id`/membership); valor real do
profile para Manager/Seller, sem nenhuma mudança de comportamento ou de
risco em relação ao que já estava publicado (o valor inserido é
idêntico ao de antes, só a origem da leitura mudou de `profiles` para o
resolver). `created_by_profile_id` de Leads nunca é tocado por nenhuma
das seis RPCs (nenhuma delas escreve nesse campo). Nenhuma FK foi
alterada nesta etapa.

### 38.5 Locks, atomicidade, idempotência e eventos preservados

`SELECT ... FOR UPDATE` e o caminho idempotente de `archive_lead`/
`unarchive_lead` (estado já alcançado → devolve a linha, sem `UPDATE`,
sem bump de `version`, sem `stale_write` mesmo com versão antiga)
preservados caractere a caractere do M1-E original. `move_lead_to_stage`
continua last-write-wins quando chamado sem `p_expected_version`;
`assign_lead_seller` continua exigindo `p_expected_version` sempre
(nunca LWW). O mapeamento completo dos 18 valores de
`lead_event_type` em `apply_lead_event` foi preservado integralmente
(mesmo `case`, mesmos textos, mesma ordem) — revalidado pelo teste
antigo `04_m1e_move_event.sql` sem nenhuma alteração de asserção.
Nenhum lock ou garantia de atomicidade foi removida; cada RPC continua
sendo uma única função `SECURITY DEFINER`/uma única transação (mutação
comercial e `audit_log` sempre juntos, quando aplicável).

### 38.6 `audit_log` — somente Super Admin, somente mutação real

Mutations bem-sucedidas de Super Admin gravam em `audit_log` na mesma
transação: `lead_stage_moved` (before/after `stage_id`);
`p_event_type::text` como `action` (o próprio evento, um enum fechado
já livre de PII — before/after com `stage_id`/`urgency`);
`lead_seller_assigned` (before/after `seller_id`, inclusive remoção com
`null`); `lead_archived`/`lead_unarchived` (before/after `archived`,
mais `archived_at` quando aplicável); `lead_timeline_entry_added`
(`entity_type='lead_timeline_entry'`, `after_data` só com `lead_id`/
`timeline_entry_id` — nunca `label`/`detail`, a timeline comercial em si
continua sendo a fonte de verdade do conteúdo). **Decisão desta etapa**:
o caminho idempotente de `archive_lead`/`unarchive_lead` (nenhuma
transição de estado real) **não** grava `audit_log` — não há delta a
registrar, e uma chamada repetida do mesmo Super Admin no mesmo estado
não deve produzir entradas redundantes; a mutação real (a transição
efetiva) é sempre auditada exatamente uma vez. Manager/Seller continuam
sem gravar `audit_log`, como em toda a etapa anterior. Nenhum `row_to_
json` genérico; nenhum telefone, nome completo ou conteúdo integral de
timeline/evento gravado.

### 38.7 Tipos regenerados

`lib/supabase/database.types.ts` via `supabase gen types typescript
--local` — diff estritamente aditivo (16 linhas: `p_company_id?: string`
adicionado aos `Args` das seis RPCs), nenhuma remoção, nenhum objeto não
relacionado alterado.

### 38.8 Testes antigos — apenas um arquivo precisou de ajuste

De `04_m1e_move_event.sql`/`05_m1e_assign.sql`/`06_m1e_archive.sql`/
`07_m1e_timeline_rpc.sql`/`09_m1e_concurrency.sql`, somente
`04_m1e_move_event.sql` precisou de ajuste: o fixture "Admin B" (usado
só no teste de `stage_not_found` de `apply_lead_event`) tinha `profiles`
mas nenhuma `company_memberships` real, e "Empresa B Teste" não tinha
`status` explícito (default `implantacao`) — com a nova autorização via
`resolve_lead_mutation_context`, isso resolvia `forbidden` antes de
alcançar a checagem de estágio que o arquivo quer exercitar. Corrigido
com o mesmo padrão já usado em `01_m1e_grants_rls.sql`/
`02_m1e_create_lead.sql`: `status='ativa'` explícito + membership real
(`role='manager'`, mesmo mapeamento do backfill do S1). Garantia
preservada: mesma asserção final (`stage_not_found`). Os outros quatro
arquivos usam exclusivamente atores do seed (Empresa A, `ativa`,
memberships reais desde o M1-F S1) ou casos que falham antes de
qualquer resolução de empresa (profile globalmente inativo) — nenhuma
alteração foi necessária.

### 38.9 Novo teste — `45_m1f_s8c2d1_remaining_mutations.sql`

98 asserções: catálogo (as 6 RPCs com assinatura única, `p_company_id`
como último parâmetro com default, `SECURITY DEFINER`, `search_path`,
grants, resolver reutilizado sem grant novo, as demais RPCs/policies
confirmadas intactas); Super Admin por RPC (`move`/`event`/`assign`/
`archive`/`unarchive`/`timeline`) cobrindo sucesso, `company_required`/
`company_not_found`/`company_read_only`, isolamento cross-company sem
vazamento, idempotência de archive/unarchive sem duplicar `audit_log`,
e o conteúdo do `audit_log` (ator real, before/after, ausência de PII);
Manager (empresa própria, `p_company_id` de outra empresa ignorado,
autoria preservada); Seller (somente o próprio Lead, `assign`/`archive`/
`unarchive` sempre `forbidden`, `p_company_id` nunca amplia acesso);
membership ausente/suspensa/offboarded/profile globalmente inativo;
matriz de status para Manager (implantação/suspensa/cancelada negados);
legado divergente (`profiles.role`/`company_id`/`seller_id` nunca
decidem — a membership/`sellers.membership_id` reais decidem sempre);
atomicidade (nenhum rastro de tentativas negadas — nem estado, nem
`audit_log` órfão; nenhuma timeline órfã). Concorrência real (duas
conexões via `dblink`) já coberta e revalidada sem alteração por
`09_m1e_concurrency.sql` (`update_lead`/`assign_lead_seller`/
`archive_lead`) — deliberadamente **não duplicada** no arquivo novo com
simulação falsa; locks/idempotência das seis RPCs desta etapa são
provados por asserções de estado (mesmo padrão do `06_m1e_archive.sql`
original), não por concorrência simulada.

### 38.10 Validação completa

42 migrations locais; SQL 46 arquivos, **2414/2414** (2316 + 98 novos);
TypeScript 118 arquivos, **1808/1808** (inalterado — nenhum frontend
tocado); build verde, 8/8 páginas.

### 38.11 Escopo preservado

Nenhuma alteração em `create_lead`/`update_lead`/
`check_lead_phone_duplicate`/`resolve_lead_mutation_context` (S8-C2-C1) ou
nas 5 RPCs de leitura comercial (S8-C2-B1/S8-C2-C2-SELLERS-B1). Nenhuma
policy de `leads`/`lead_timeline_entries`/`pipeline_stages`/`profiles`/
`sellers` tocada. Nenhuma FK alterada — inclusive `lead_timeline_actor_
fk`, que permanece apontando para `profiles(company_id, id)` (mesmo
comportamento pré-existente para Manager/Seller; Super Admin usa `NULL`,
que a FK sempre aceitou). Nenhuma coluna removida, nenhum helper legado
removido. Nenhum frontend, hook, componente ou flag alterado;
`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ`/`_WRITE` inalteradas.
Nenhuma operação remota executada; nenhuma migration aplicada no
Supabase remoto.

**As 9 RPCs de mutation de Leads estão integralmente migradas para
contexto comercial explícito. S8-C2-D2 (frontend das mutations
restantes) permanece não iniciado. M1-E E4 continua pausado** até o
fechamento formal do S8 (S8-F).

## 39. Autoria da timeline por membership histórica

Esta seção fecha o risco registrado em §38.11 (`lead_timeline_actor_fk`
continuava apontando para `profiles(company_id, id)`, ao contrário das
duas FKs equivalentes de `leads`, já corrigidas no S8-C2-C1-AUTH-A1,
§35). §0–§38 não foram alterados.

### 39.1 FK antiga e conflito reproduzido

`lead_timeline_actor_fk` exigia `profiles.company_id = lead_timeline_
entries.company_id` para o ator — `profiles.company_id` nunca é
atualizado por `transfer_membership` (nem por nenhuma outra RPC além de
`accept_invite`, na criação inicial do profile). Reprodução local
(rollback, nenhum dado persistido): Manager com membership ativa em A
cria uma entrada de timeline em A; Super Admin executa
`transfer_membership` para B (com sucessor, pois era o último manager de
A); a membership em B fica `active`, a de A fica `offboarded` (nunca
apagada); `profiles.company_id` **permanece A**. `add_lead_timeline_
entry` em B, já corretamente autorizado pela membership real (via
`resolve_lead_mutation_context`, S8-C2-C1), falhava com
`lead_timeline_actor_fk` (SQLSTATE 23503) — o mesmo conflito estrutural
já corrigido para `leads_created_by_fk`/`leads_updated_by_fk`, agora
confirmado também na timeline.

### 39.2 Decisão: reapontar a FK para a membership histórica

`20260729160000_m1f_s8c2d1timeline_a1_actor_membership_fk.sql` —
`lead_timeline_actor_fk` passa a referenciar `public.company_memberships
(company_id, profile_id)` — nunca mais `public.profiles(company_id,
id)`. Mesmo molde exato de `20260729120000_m1f_s8c2c1auth_a1_lead_
authorship_membership_fk.sql`: validação de dados preexistentes (falha
fechada, sem PII, erro estável `timeline_actor_membership_backfill_
required`) antes de `DROP CONSTRAINT` + `ADD CONSTRAINT` na mesma
transação; `MATCH SIMPLE` (default), não deferrable, `ON UPDATE NO
ACTION`, `ON DELETE RESTRICT` (nunca `SET NULL`/`CASCADE` — mudança
deliberada em relação ao `ON DELETE SET NULL` anterior, para bloquear
hard delete de uma membership referenciada, mesma política já usada por
`leads_created_by_fk`/`leads_updated_by_fk`). `lead_timeline_entries.
actor_profile_id` preservada exatamente como está (continua guardando o
`profiles.id` global, continua nullable) — só o alvo da integridade
referencial muda. `UNIQUE(company_id, profile_id)` de `company_
memberships` (já existente desde o S1) não é recriada. Nenhuma RPC
alterada: `add_lead_timeline_entry` já gravava exatamente o valor certo
(profile real do ator para Manager/Seller, `NULL` para Super Admin,
desde o S8-C2-D1, §38.4) — apenas o destino da checagem referencial
muda.

### 39.3 Significado final da coluna

`actor_profile_id` representa "o profile que efetuou a ação, provado por
ter tido (em qualquer momento, inclusive hoje offboarded) uma membership
na mesma empresa da entrada de timeline" — mesmo significado já adotado
para `leads.created_by_profile_id`/`updated_by_profile_id` desde o §35.
`company_memberships` nunca apaga fisicamente uma linha (nenhuma RPC do
projeto o faz) — a membership histórica sustenta a autoria de uma
entrada de timeline para sempre, mesmo após offboarding, suspensão ou
transferência para outra empresa.

### 39.4 Transferência, offboarding e mudança de papel preservam a autoria

Transferência A→B: a membership de A vira `offboarded` (nunca apagada) —
entradas de timeline antigas criadas em A continuam com FK válida contra
essa linha histórica; a nova membership em B autoriza `add_lead_
timeline_entry` em B normalmente (via `resolve_lead_mutation_context`),
e a nova FK é satisfeita pela membership de B. `profiles.company_id`
pode permanecer A indefinidamente sem interferir em nada — nem na
autorização (já não lido desde o S8-C2-C1), nem agora na integridade
referencial da timeline. Offboarding e suspensão: a membership perde
`is_active`/`lifecycle_status='active'` mas a linha permanece — a FK
continua satisfeita, a autoria histórica nunca é afetada; o ator só
perde autorização **operacional** (via `resolve_lead_mutation_context`),
nunca a prova de autoria passada. Mudança de papel (`update_membership_
role`): a mesma linha de `company_memberships` é atualizada, `profile_
id`/`company_id` permanecem imutáveis (trigger de consistência do S1) —
a FK nunca é afetada por uma troca de `role`.

### 39.5 Super Admin e audit_log inalterados

`actor_profile_id` continua `NULL` para Super Admin (decisão do
S8-C2-D1, §38.4 — Super Admin nunca tem `company_memberships`, por
desenho; nenhuma membership artificial foi criada). `NULL` satisfaz
qualquer FK trivialmente. A autoria real do Super Admin continua
exclusivamente em `audit_log.actor_profile_id`, sem nenhuma alteração
nesta etapa.

### 39.6 Defesa cross-company preservada

Um profile sem membership na empresa-alvo nunca pode ser gravado como
ator de uma timeline daquela empresa: `resolve_lead_mutation_context`
já resolve `actor_profile_id`/`resolved_company_id` exclusivamente a
partir da membership ativa do próprio chamador (Manager/Seller) ou da
empresa explícita validada (Super Admin) — nenhuma RPC aceita um
`actor_profile_id` arbitrário do cliente. A FK é defesa em profundidade
adicional: mesmo uma tentativa hipotética de gravar um ator de outra
empresa falharia pela integridade referencial, nunca só pela lógica da
RPC.

### 39.7 Hard delete bloqueado

`ON DELETE RESTRICT` (nunca `SET NULL`/`CASCADE`) — uma tentativa de
apagar fisicamente uma `company_memberships` referenciada por qualquer
entrada de timeline falha imediatamente. Nenhuma RPC do projeto apaga
`company_memberships` hoje — a política é defesa em profundidade contra
uma exclusão manual/futura, nunca um caminho operacional real. `ON
UPDATE` permanece `NO ACTION`, idêntico ao anterior e às demais FKs
compostas do domínio — `company_id`/`profile_id` de uma membership são
imutáveis após a criação, então a cláusula nunca é exercitada na
prática.

### 39.8 Validação de dados preexistentes

A migration valida, antes de alterar a constraint, que todo
`actor_profile_id` não nulo já existente possui uma linha correspondente
em `company_memberships(company_id, profile_id)` — se não, a migration
falha fechada com `timeline_actor_membership_backfill_required`
(contagem sanitizada, nenhum dado pessoal). Localmente, a validação
passou trivialmente (nenhuma incompatibilidade encontrada).

### 39.9 Teste antigo — ajuste pontual autorizado

`supabase/tests/10_m1f_s1_schema.sql` continha uma asserção `fk_ok`
(escrita durante o S8-C2-C1-AUTH-A1, como controle negativo deliberado)
confirmando que `lead_timeline_entries.actor_profile_id` **ainda**
referenciava `profiles(company_id, id)`, ao contrário das duas FKs de
`leads` já corrigidas naquela etapa. A correção desta migration torna
essa asserção obsoleta por desenho — achado fora da autorização inicial
desta etapa, apresentado e aprovado antes de qualquer alteração. Ajuste
pontual, autorizado e aplicado: o alvo esperado passou a `public.
company_memberships(company_id, profile_id)`, com a mensagem atualizada
para "`lead_timeline_entries.actor_profile_id` referencia membership
histórica da empresa (S8-C2-D1-TIMELINE-AUTH-A1)". Nenhuma outra
asserção do arquivo foi tocada (as duas de `leads_created_by_fk`/
`leads_updated_by_fk` permanecem exatamente como estavam). Garantia
preservada: o arquivo continua provando, para as três FKs de autoria do
domínio (`leads` × 2, `lead_timeline_entries` × 1), que nenhuma aponta
mais para `profiles` — apenas o contrato esperado da terceira mudou,
refletindo a decisão humana desta etapa.

### 39.10 Novo teste — `46_m1f_s8c2d1_timeline_actor_membership_fk.sql`

Cobre: catálogo (`lead_timeline_actor_fk` aponta para `company_
memberships(company_id, profile_id)`, nunca para `profiles`; `UNIQUE
(company_id, profile_id)` existe; `ON DELETE` bloqueia hard delete; `ON
UPDATE` sem ação; `actor_profile_id` continua nullable; nenhuma coluna
nova; nenhuma RPC redefinida); cenário completo de transferência A→B
(membership A histórica, membership B ativa, `profiles.company_id`
permanece A, `add_lead_timeline_entry` em B funciona, timeline antiga de
A permanece válida); offboarding (membership histórica sustenta a
timeline antiga; hard delete da membership referenciada falha; ator
offboarded não executa nova mutation); Super Admin (`actor_profile_id`
`NULL`, `audit_log` com o ator real, nenhuma membership artificial);
defesa cross-company (profile sem membership na empresa-alvo nunca é
gravado como ator); legado divergente (`profiles.company_id`/`role`/
`seller_id` nunca decidem).

### 39.11 Tipos regenerados

`lib/supabase/database.types.ts` via `supabase gen types typescript
--local` — diff estritamente restrito à metadata `Relationships` de
`lead_timeline_actor_fk` (`referencedRelation`/`referencedColumns`
passam de `profiles`/`["company_id","id"]` para `company_memberships`/
`["company_id","profile_id"]`); nenhuma coluna, nenhuma assinatura de
RPC, nenhum outro objeto alterado.

### 39.12 Escopo preservado

Nenhuma RPC alterada (`add_lead_timeline_entry` e as demais 8 RPCs de
mutation de Leads, `resolve_lead_mutation_context`, e as 5 RPCs de
leitura comercial continuam exatamente como publicadas). Nenhuma policy
tocada. Nenhuma coluna adicionada, removida ou com nullability alterada.
`public.leads`/`public.profiles`/`public.company_memberships` sem
alteração de schema. Nenhuma membership artificial criada; `profiles.
company_id` nunca sincronizado. Nenhum helper legado removido. Nenhum
frontend, hook, componente ou flag alterado. Nenhuma operação remota
executada.

**O risco estrutural registrado em §38.11 está fechado. S8-C2-D2 só se
desbloqueia com esta etapa publicada e validada. M1-E E4 continua
pausado** até o fechamento formal do S8 (S8-F).

## 40. Implementação do S8-C2-D2 — mutations comerciais restantes no frontend platform

Esta seção registra a implementação (não mais planejamento) do frontend
platform das seis RPCs restantes de mutation de Leads
(`move_lead_to_stage`/`apply_lead_event`/`assign_lead_seller`/
`archive_lead`/`unarchive_lead`/`add_lead_timeline_entry`), fechando o
S8-C2-D iniciado no backend (§38/§39). §0–§39 não foram alterados.
Nenhuma migration, RPC, RLS, grant, FK ou `database.types.ts` tocados
nesta etapa; nenhuma operação remota executada.

### 40.1 Data layer

`lib/commercial/repository.ts` ganhou seis funções
(`movePlatformLeadToStage`/`applyPlatformLeadEvent`/
`assignPlatformLeadSeller`/`archivePlatformLead`/`unarchivePlatformLead`/
`addPlatformLeadTimelineEntry`), mesmo padrão de `createPlatformLead`/
`updatePlatformLead`: `p_company_id` sempre o valor explícito recebido
por parâmetro, erro sanitizado por operação
(`PlatformCommercialError`), nenhum `supabase.from` direto. Seis hooks
novos em `lib/hooks/` (`useMovePlatformLead`/
`useApplyPlatformLeadEvent`/`useAssignPlatformLeadSeller`/
`useArchivePlatformLead`/`useUnarchivePlatformLead`/
`useAddPlatformLeadTimelineEntry`) — mesmo contrato de
`useCreatePlatformLead`/`useUpdatePlatformLead`: `authorized` resolvido
pelo chamador (`canMutateCommercialWorkspace`, reaproveitada sem
duplicação), `isContextStillValid()` verificado imediatamente antes de
cada RPC, sem retry automático (nenhuma das seis é seguramente
reexecutável às cegas). `lib/commercial/errors.ts` ganhou seis novos
códigos estáveis e as mensagens locais correspondentes, mais duas novas
entradas no tradutor central (`stage_not_found`/`invalid_event`) — o
`stale_write` existente foi mantido com sua redação original (mensagem
compartilhada com create/update, não alterada).

### 40.2 Achado de contrato — nenhuma das seis RPCs escreve timeline automática

Auditoria direta das migrations (`20260729140000`/`20260729150000`,
S8-C2-D1) confirmou que **nenhuma** das seis RPCs, exceto
`add_lead_timeline_entry`, insere em `lead_timeline_entries` — `move_
lead_to_stage`/`apply_lead_event`/`assign_lead_seller`/`archive_lead`/
`unarchive_lead` só afetam `public.leads`. Por isso a invalidação de
cache de cada hook segue exatamente o efeito real: `move`/`event`/
`assign` invalidam somente `leadsActive`; `archive`/`unarchive`
invalidam `leadsActive` **e** `leadsArchived`; `add_lead_timeline_entry`
invalida **somente** a `leadTimeline(companyId, leadId)` específica,
nunca as listas de Leads. Nenhuma key nova foi necessária em
`lib/commercial/queryKeys.ts` — as cinco já existentes (`leadsActive`/
`leadsArchived`/`leadTimeline`/`stages`/`sellers`) cobrem integralmente
as seis mutations.

### 40.3 `p_seller_id` — limitação do gerador de tipos, não da RPC

`assign_lead_seller` aceita `p_seller_id = null` para remover o vendedor
(contrato confirmado no pgTAP do S8-C2-D1), mas `supabase gen types`
marca esse parâmetro como `string` obrigatório (o gerador não reflete
nullability de parâmetros de função, só de colunas de tabela — mesma
limitação já observada para `p_successor_profile_id`/`p_successor_id`
em `offboard_manager`/`transfer_membership`, pré-existente). Resolvido
com um cast local em `assignPlatformLeadSeller`
(`input.sellerId as unknown as string`), documentado no próprio
arquivo — nenhuma edição manual de `database.types.ts`.

### 40.4 Registry de eventos comerciais

`lib/commercial/leadEventRegistry.ts` — inventário direto dos 18
valores reais de `lead_event_type`; nenhum inventado, nenhum
renomeado. `payloadFields` é `[]` em toda entrada: a assinatura real de
`apply_lead_event` não aceita nenhum campo além do próprio tipo do
evento, então nenhum dos 18 eventos exigiu uma decisão de produto
pendente ou formulário adicional. `group` (`contato`/`visita`/
`proposta`/`venda`) é deduzido do prefixo do próprio nome do enum
(`call_outcome_*`/`visit_*`, incluindo `visit_result_*`/`deal_*`/
`sale_*`) — nenhuma classificação nova. `label`/`description`
reaproveitam o vocabulário real já publicado no mapeamento evento →
health/labels/estágio (`alert_label`) da migration do S8-C2-D1 — nenhum
texto de produto inventado.

### 40.5 Contexto — `contextEpoch`

`CommercialCompanyContext` ganhou `contextEpoch: number`, incrementado
a cada troca real de empresa (mesmo gatilho do `cancelQueries` já
existente) e a cada troca de identidade. Aditivo — `selectedCompanyId`/
`setSelectedCompanyId` inalterados, nenhum consumidor existente
quebrado. Motivo: a comparação simples de `companyId` (já usada por
`PlatformLeadCreateModal`/`PlatformLeadEditModal` desde o S8-C2-C2) não
detecta uma troca A→B→A enquanto uma mutation está pendente (o valor
final é igual ao inicial); o epoch captura esse caso. `PlatformLeadDetails`
usa os dois em conjunto (`liveCompanyIdRef`/`liveContextEpochRef`,
comparados contra o valor capturado no momento de montagem) antes de
cada uma das seis RPCs.

### 40.6 Detalhe do Lead — ações conectadas

`components/commercial/PlatformLeadActions.tsx` (novo): cinco widgets
puros e apresentacionais, sem hook de rede próprio —
`PlatformLeadStageMenu`, `PlatformLeadSellerMenu`,
`PlatformLeadArchiveControl`, `PlatformLeadEventMenu`,
`PlatformLeadTimelineForm`. `PlatformLeadDetails.tsx` passou a orquestrar
os seis hooks (`authorized: canMutate`) e a passar callbacks para os
widgets. Regras aplicadas:

- Seletor de etapa explícito (obrigatório, §6 do pedido): lista as
  etapas reais da empresa (`stages`, nova prop opcional, retrocompatível
  — omissão preserva o comportamento somente leitura anterior), exclui a
  etapa atual da lista de destino. **Drag and drop no Kanban não foi
  implementado nesta etapa** — decisão deliberada, dentro da preferência
  explícita do pedido pela "primeira versão" (mutation pessimista,
  bloquear novo movimento durante pendência) e da natureza opcional do
  drag ("pode ser implementado somente quando... tecnicamente seguro");
  o requisito obrigatório (seletor explícito) está integralmente
  entregue, e o Kanban somente leitura do B2 permanece exatamente como
  publicado (nenhum card `draggable`, nenhum handler de drop, em
  qualquer combinação de flags/status).
- Seller picker: usa exclusivamente `list_platform_sellers_for_company`
  (via `usePlatformSellers`, `authorized: canMutate` — nunca montado
  fora do modo mutável); envia `seller_id` real ou `null`, nunca
  `profile_id`/`membership_id`/nome. Vendedor atribuído que não aparece
  mais na lista recarregada mostra "Vendedor anterior ou indisponível"
  (nunca um nome inventado) — mesmo espírito de `leadDisplay.ts`.
- Arquivamento/desarquivamento: confirmação visual em duas etapas
  (clique no botão → confirmação explícita → só então a RPC), ações
  desabilitadas enquanto qualquer mutation do Lead está pendente
  (`anyPending`). Nenhuma exclusão definitiva de Lead foi criada.
- Eventos comerciais: menu agrupado pelo registry (§40.4); nenhum evento
  exigiu payload extra, então nenhum formulário por evento foi
  necessário.
- Timeline manual: formulário próprio (label obrigatório, detail
  opcional) — `icon`/`color` são campos reais aceitos pela RPC, fixados
  para uma entrada manual do Super Admin (`'message'`/`'#3B82F6'`,
  decisão de produto registrada em `PlatformLeadActions.tsx`) em vez de
  expor os dois campos técnicos brutos ao usuário; nenhuma tradução do
  conteúdo para o modelo mock. Submit vazio bloqueado (label em branco
  desabilita o botão).
- Todas as ações (exceto Editar/timeline) somem quando o Lead está
  arquivado, exceto o próprio controle de arquivamento, que vira
  "Desarquivar". Nenhuma ação aparece quando `canMutate=false`
  (`readOnly`/empresa suspensa-cancelada/flags desligadas) —
  comportamento idêntico ao B2/C2 original.
- Feedback: sem biblioteca de toast (nenhuma existe no projeto —
  confirmado por auditoria de `package.json`/código; introduzir uma
  seria escopo além do pedido) — reaproveitado o MESMO padrão de banner
  inline já usado por `PlatformLeadCreateModal`/`PlatformLeadEditModal`
  (`role="alert"` para erro), estendido com um banner de sucesso
  (`role="status"`) igualmente inline, sempre com a mensagem traduzida
  por `getPlatformCommercialErrorMessage` — nunca o erro cru.

### 40.7 Sem atualização otimista

Nenhuma das seis mutations escreve no cache do TanStack Query
antecipando o resultado — todas usam `invalidateQueries` após sucesso
(refetch), mesmo padrão de `useCreatePlatformLead`/`useUpdatePlatformLead`.
Nenhum card do Kanban se move, nenhum vendedor muda localmente, nenhuma
entrada de timeline aparece antes da confirmação do servidor.

### 40.8 Manager e Seller

Nenhum arquivo mock (`LeadService`/`StoreAdapter`/`Flows2`/`Flows3`/
`FlowVerCliente`/`ScreensOps.tsx`) foi tocado. As seis RPCs continuam
exclusivas da árvore platform (Super Admin) — Manager/Seller permanecem
100% nas telas legadas, sem nenhuma mudança de comportamento.

### 40.9 Achado fora do escopo inicial — teste antigo desatualizado pela mensagem de erro

Ao rodar a suíte, `tests/commercial/errors.test.ts` (existente) e
`tests/components/commercial/PlatformLeadDetails.test.tsx` (existente)
precisaram de ajuste: o primeiro porque uma tentativa inicial de reescrever
a mensagem de `stale_write` (para o texto sugerido no pedido desta etapa)
quebraria a asserção já publicada para `create_lead`/`update_lead` —
revertido para o texto original, já aprovado, sem necessidade de duas
mensagens diferentes para o mesmo código estável; o segundo porque
`PlatformLeadDetails` passou a chamar `useCommercialCompanyContext`/
`usePlatformSellers`/seis hooks de mutation, exigindo mocks novos no
teste já existente (nenhuma asserção antiga removida, apenas estendida
com a cobertura das novas ações — arquivo diretamente responsável por
testar o componente desta etapa, dentro do escopo autorizado de "testes
TypeScript").

### 40.10 Validação completa

TypeScript: **125 arquivos, 1921/1921** (1808 + 113 novos: repository,
seis hooks, registry, `CommercialCompanyContext`/`errors` estendidos,
`PlatformLeadDetails`/`PlatformLeadActions`). Build verde, 8/8 páginas.
SQL revalidado sem nenhuma alteração: 43 migrations, 47 arquivos,
2440/2440.

### 40.11 Escopo preservado

Nenhuma migration, RPC, RLS, grant, FK ou `database.types.ts` alterados.
Nenhum componente mock tocado. Nenhuma das duas flags
(`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ`/`_WRITE`) alterada ou
nova criada. Nenhuma operação remota executada.

**S8-C2-D2 está completo. S8-C2-E (auditoria integrada e fechamento do
C2) está desbloqueado. S8-D permanece não iniciado. M1-E E4 continua
pausado** até o fechamento formal do S8 (S8-F).

## 41. Fechamento do S8-C2 — acesso comercial do Super Admin

Esta seção fecha formalmente o S8-C2 (§31–§40) após auditoria integrada
do sistema completo. Nenhum código de aplicação foi alterado nesta
etapa — apenas um teste pgTAP integrado, um teste TypeScript integrado
e esta documentação. §0–§40 não foram alterados.

### 41.1 Subetapas concluídas

S8-C2-A0/A1/A2 (auditoria e congelamento, §31); S8-C2-B1/B2 (leitura
comercial, backend e frontend, §32/§33); S8-C2-C1/C2 (create/update/
duplicidade + Sellers, backend e frontend, §34/§36/§37) — incluindo
S8-C2-C1-AUTH-A1 (autoria de `leads` por membership histórica, §35);
S8-C2-D1/D2 (as seis mutations restantes, backend e frontend, §38/§40)
— incluindo S8-C2-D1-TIMELINE-AUTH-A1 (autoria da timeline por
membership histórica, §39); S8-C2-E (esta seção, auditoria integrada e
fechamento).

### 41.2 Arquitetura final

**RPCs de leitura (5)**: `list_commercial_companies`,
`list_platform_leads_for_company`, `list_platform_lead_timeline`,
`list_pipeline_stages_for_company`, `list_platform_sellers_for_company`
— nenhuma grava `audit_log`.

**RPCs de mutation (9)**: `create_lead`, `update_lead`,
`check_lead_phone_duplicate` (leitura controlada, nunca audita),
`move_lead_to_stage`, `apply_lead_event`, `assign_lead_seller`,
`archive_lead`, `unarchive_lead`, `add_lead_timeline_entry` — todas
recebem `p_company_id uuid DEFAULT NULL`, todas resolvem ator/empresa
via `resolve_lead_mutation_context` (Super Admin: empresa explícita;
Manager/Seller: `current_membership_company_id()`/
`current_membership_role()`, `p_company_id` do cliente sempre
ignorado). Confirmado por auditoria integrada ao vivo (§41.4): das 9,
apenas `create_lead`/`update_lead`/`add_lead_timeline_entry` produzem
efeito colateral fora de `public.leads` (`created_by`/`updated_by`/
`actor_profile_id`); `move`/`event`/`assign`/`archive`/`unarchive`
afetam somente a própria linha de `leads`.

**Contexto comercial**: `CommercialCompanyContext`
(`selectedCompanyId`/`contextEpoch`), montado uma única vez em
`App.tsx`, nunca localStorage/sessionStorage/URL. **Capabilities**:
`canAccessCommercialWorkspace` (leitura) / `canMutateCommercialWorkspace`
(mutation, exclusiva de Super Admin, exige READ+WRITE+empresa
ativa/implantacao). **Flags**: `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ`/
`_WRITE`, ambas `false` por padrão, únicas a gatear a superfície
platform — confirmado que nenhuma outra combinação de código depende
delas.

### 41.3 Auditoria de dependências legadas — zero encontradas

Busca direta em `components/commercial/*`, `lib/commercial/*` e todos
os hooks/repositories platform por `profiles.company_id`/`role`/
`seller_id`, os 4 helpers legados, `User.companyId`/`role`/`sellerId`,
`LeadService`/`StoreAdapter`, `useCompanyScopeFilter`/`companyFilterId`,
`localStorage`/`sessionStorage`: **zero ocorrências operacionais** —
todas as menções encontradas são comentários explicando o que
**não** é usado (documentação do próprio código). `App.tsx`
(`allowedNavIds`/`COMMERCIAL_NAV_IDS`) e `ScreensOps.tsx` (switch
`ScreenClientes`/`ScreenAndamento`, correção do achado 1 em
`ScreenAndamentoLegacy`) revalidados linha a linha — exatamente como
publicados no S8-C2-B2, nenhuma regressão.

### 41.4 Auditoria integrada do backend — fluxo transacional ao vivo

Executado localmente (transação com rollback, nenhum dado persistido)
o fluxo completo de Super Admin em empresa ativa: listar empresas
(5, incluindo suspensa/cancelada) → Stages/Sellers reais → criar Lead
sem Seller → checar duplicidade → editar → mover etapa → atribuir
Seller → aplicar evento → adicionar timeline manual → arquivar →
confirmar na lista `archived=true` → desarquivar → confirmar de volta
em `archived=false`. Resultado: **zero falhas, zero achado crítico**.
`audit_log` do fluxo continha exatamente as 7 mutations de Super Admin
em `entity_type='lead'` + 1 em `entity_type='lead_timeline_entry'`,
todas com `actor_profile_id` real, `company_id` correto,
`created_by_profile_id`/`updated_by_profile_id`/`actor_profile_id`
empresariais `null`.

Cross-company (Lead/Stage/Seller/timeline de A operados com contexto de
B, ou vice-versa): todas as quatro tentativas falharam fechado
(`lead_not_found`/`stage_not_found`/`seller_not_found`), nenhuma
revelando a existência do recurso na outra empresa. Empresa em
implantação: create/move funcionam para Super Admin. Suspensa/
cancelada: leitura funciona, `create_lead` nega com `company_read_only`.
Manager: `create_lead`/`move_lead_to_stage` chamados com `p_company_id`
apontando explicitamente para OUTRA empresa (B) — ambos ignoraram o
parâmetro e operaram corretamente na empresa da própria membership (A);
autoria (`created_by_profile_id`) preservada como o profile real. Seller:
autoatribuído na criação; `assign_lead_seller`/`archive_lead` negados
com `forbidden`, mesmo no próprio Lead. Ao final: zero timelines órfãs,
zero `audit_log` órfãos.

Adversarial de PII: uma segunda rodada injetou deliberadamente um nome
completo sensível, um telefone alternativo e um "CPF" fictício no
`name`/`phone`/`label`/`detail` de um Lead e de uma entrada de timeline
manual — nenhum desses valores apareceu em `before_data`/`after_data`
de nenhuma linha de `audit_log` gerada (confirmado por busca textual
`ilike` direta sobre as colunas). O conteúdo real permanece
exclusivamente em `public.leads`/`public.lead_timeline_entries`, nunca
duplicado no `audit_log`.

Transferência/offboarding: comportamento já revalidado exaustivamente
pelos testes 43/46 (S8-C2-C1-AUTH-A1/S8-C2-D1-TIMELINE-AUTH-A1) —
não repetido aqui; nenhuma regressão encontrada na leitura desses
testes durante esta auditoria.

### 41.5 Novo teste SQL integrado

`47_m1f_s8c2e_commercial_end_to_end.sql` — reproduz em pgTAP o fluxo
acima como um único cenário coerente (não repete as asserções
unitárias de 41–46): fluxo feliz completo de Super Admin em empresa
ativa com auditoria de `audit_log` (contagem exata de ações, ator real,
zero PII via busca textual), cross-company nas quatro entidades,
matriz de status (implantação permitida, suspensa/cancelada
`company_read_only` com leitura histórica preservada), Manager
(`p_company_id` de outra empresa ignorado, autoria real), Seller
(autoatribuição, `assign`/`archive` sempre `forbidden`), atomicidade
(zero timelines/`audit_log` órfãos). Nenhum teste antigo alterado.

### 41.6 Novo teste TypeScript integrado

`tests/commercial/PlatformCommercialEndToEnd.test.tsx` — monta a árvore
REAL (`CommercialCompanyProvider` + `PlatformCommercialClientsView` +
todos os hooks reais), mockando somente `supabase.rpc` (fronteira de
rede) com um dataset mutável que reflete o efeito de cada mutation —
prova a fiação completa do sistema (não cada peça isolada, já coberta
pelos testes unitários existentes). Cobre: fluxo completo (selecionar
empresa → abrir Lead → mover → atribuir Seller real → aplicar evento →
timeline manual → arquivar → aba Arquivados → desarquivar → volta para
Ativos), nenhuma chamada usando `profile_id`/`membership_id` no lugar
de `seller_id`; troca de empresa fecha o detalhe e nunca reaproveita
dado da empresa anterior; matriz de flags a nível de componente real
(READ+WRITE+suspensa: leitura funciona, nenhuma ação; WRITE=false:
leitura funciona, nenhuma ação). Matriz de flags a nível de navegação
(READ off) já coberta por
`tests/navigation/commercialWorkspaceAccess.test.tsx` (existente,
revalidado sem alteração); matriz da capability pura já coberta por
`tests/capabilities.test.ts` (existente, revalidado sem alteração) —
não duplicadas.

### 41.7 Três builds — matriz de flags via variável de processo

Nenhum arquivo `.env` alterado; flags passadas somente no ambiente do
próprio comando (`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ`/`_WRITE`).
Build 1 (ausente/`false`, padrão do repositório), Build 2 (`READ=true`,
`WRITE=false`), Build 3 (`READ=true`, `WRITE=true`) — os três verdes,
8/8 páginas cada. A combinação `READ=false`/`WRITE=true` (WRITE nunca
efetiva sem READ) não exigiu build própria — já demonstrada pela
capability pura (`tests/capabilities.test.ts`) e pelo próprio código
(`allowedNavIds` só considera a flag WRITE dentro do ramo já gateado
por READ).

### 41.8 PII e cache — confirmação final

`audit_log`: zero PII completa em qualquer ação do fluxo integrado
(§41.4). Query keys platform: todas particionadas por `companyId` +
segmento `'platform'` (`leadsActive`/`leadsArchived`/`leadTimeline`/
`stages`/`sellers`), nenhuma contém telefone/nome/conteúdo de timeline.
Troca de empresa: cancela queries da empresa anterior, fecha detalhe/
modais (via reset de estado local nos componentes platform),
incrementa `contextEpoch`, nunca usa `resetQueryCache()` global.
Logout/troca de identidade continua usando o reset já existente
(`useQueryCacheIdentity`/`resetQueryCache`), intocado.

### 41.9 Riscos residuais — transferidos ao S8-F, nenhum bloqueia o fechamento local

Migrations M1-F ainda não aplicadas remotamente (validação de dados de
produção pendente antes do rollout); as duas flags permanecem `false`
em produção até rollout controlado; ausência de paginação nas listagens
de Leads; ausência de realtime; drag and drop no Kanban não
implementado (decisão deliberada, §40.6); Manager/Seller continuam
inteiramente no modelo mock M0, aguardando M1-E E4; monitoramento do
volume de `audit_log` em produção ainda não instrumentado; smoke test
real só é possível após um rollout controlado com a flag READ ligada
para um subconjunto de Super Admins. Nenhum destes riscos, isoladamente
ou em conjunto, impede o fechamento **local** do S8-C2 — todos são
responsabilidade do S8-F (fechamento formal do S8) ou de etapas
futuras (M1-E E4).

### 41.10 Validação completa

SQL: 43 migrations (inalterado), 48 arquivos, **2478/2478 PASS** (2440
+ 38 novos). TypeScript: 126 arquivos, **1925/1925 PASS** (1921 + 4
novos). Três builds verdes, 8/8 páginas cada. Nenhuma migration
aplicada remotamente. Nenhuma operação Supabase remota. Nenhum arquivo
`.env` modificado.

### 41.11 Escopo preservado

Nenhum código de aplicação alterado (nenhum componente, hook,
repository, capability, query key, flag ou RPC). Nenhuma migration.
Nenhuma alteração em `database.types.ts`. Nenhuma flag ativada por
padrão. Manager/Seller intactos.

**O S8-C2 (acesso comercial do Super Admin) está formalmente fechado.
S8-D está desbloqueado, mas não iniciado. M1-E E4 continua pausado**
até o fechamento formal do S8 (S8-F).
