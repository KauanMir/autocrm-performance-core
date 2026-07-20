-- M1-F / Módulo 1 — m1f_s1_01: platform_role + company_memberships (schema)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §5, §6.2,
-- §6.3, §7.4, §16 (S1). Etapa S1 do plano de §16: fundação de dados, SEM
-- RLS/RPC novas de negócio, SEM alterar helpers (current_profile_company_id,
-- current_profile_seller_id, is_manager_or_admin) e SEM tocar nas 9 RPCs do
-- M1-E — tudo isso é S2+.
--
-- Migração ADITIVA e de COMPATIBILIDADE (design §16, S1): profiles.company_id,
-- profiles.role e sellers.profile_id/sellers.company_id permanecem intactos
-- e continuam sendo a ÚNICA fonte usada pelo runtime atual (AuthService,
-- RLS, RPCs). Nada aqui muda o comportamento observável da aplicação.
--
-- Escopo desta migration (schema apenas — o backfill vem em m1f_s1_02):
--   1. enum platform_role ('super_admin') + coluna profiles.platform_role
--      (nullable, default null — nenhum profile existente é promovido);
--   2. enum company_role ('manager','seller');
--   3. tabela company_memberships (vínculo empresa+pessoa+papel; RLS
--      habilitada e SEM NENHUMA policy/grant — inacessível ao navegador até
--      o S2 definir as policies definitivas com can_access_company()/
--      require_company_access(), design §7.4);
--   4. sellers.membership_id (nullable) + FK composta (company_id,
--      membership_id) -> company_memberships(company_id, id) + trigger de
--      consistência (a membership referenciada precisa ter role = 'seller'
--      e o mesmo profile_id do seller).
--
-- Grants de sellers/profiles/companies para authenticated/anon NÃO são
-- alterados por esta migration — fora de escopo do S1. Verificado
-- localmente antes de escrever esta migration: authenticated/anon não têm
-- SELECT/INSERT/UPDATE/DELETE nessas três tabelas hoje (só
-- REFERENCES/TRIGGER/TRUNCATE, condição pré-existente, não introduzida por
-- este módulo) — a nova coluna sellers.membership_id nasce com exatamente a
-- mesma exposição (nenhuma) de qualquer outra coluna de sellers hoje.

begin;

-- ── platform_role ────────────────────────────────────────────────────────
-- Único valor aprovado nesta fase (design §5.1, §13.3): 'super_admin'.
-- Extensível sem migração estrutural (ALTER TYPE ... ADD VALUE) quando/se
-- PLATFORM_ADMIN/PLATFORM_SUPPORT/PLATFORM_ANALYST forem aprovados no
-- futuro — não implementados agora.

create type public.platform_role as enum ('super_admin');

-- Nullable, default null: a imensa maioria dos profiles nunca tem valor
-- aqui. Nenhum profile existente recebe valor nesta migration — nenhuma
-- promoção automática a SUPER_ADMIN (requisito explícito desta etapa).
alter table public.profiles
  add column platform_role public.platform_role;

-- BLOQUEIO DE AUTOPROMOÇÃO (correção pós-auditoria): a policy
-- profiles_update_admin (M1-B, intocada) permite que QUALQUER admin
-- atualize QUALQUER coluna de QUALQUER profile da própria empresa — ela não
-- sabia de platform_role porque a coluna não existia quando foi escrita, e
-- por design não deveria precisar ser reescrita agora (isso seria alterar
-- policy antiga sem necessidade comprovada NA POLICY em si). O problema não
-- é a policy — é o GRANT: M1-B nunca revogou/concedeu explicitamente
-- SELECT/INSERT/UPDATE/DELETE em profiles para authenticated, então a
-- exposição real depende do default de privilégios do projeto Supabase (o
-- ambiente local desta auditoria mostra ZERO grants para authenticated em
-- profiles hoje, mas esse é um comportamento do padrão NOVO da CLI local —
-- projetos remotos mais antigos podem ter sido provisionados sob o default
-- antigo de "auto-expose", que concederia UPDATE amplo via privilégio
-- default de schema). Não é seguro assumir que authenticated não tem UPDATE
-- em profiles no ambiente real só porque não tem localmente.
--
-- Defesa em duas camadas, porque uma auditoria empírica (tentando de fato
-- burlar, não só lendo o código) mostrou que a primeira camada sozinha NÃO
-- é robusta contra ordem de GRANT:
--
-- Camada 1 — REVOKE de coluna: revogar especificamente platform_role, no
-- nível de coluna, para authenticated/anon/public. Barata, rápida, dá o
-- erro mais específico (42501 na própria coluna). MAS: se QUALQUER agente
-- futuro (uma migration, um painel, um default de projeto) emitir
-- `GRANT UPDATE ON profiles TO authenticated` (tabela inteira, sem lista de
-- colunas) DEPOIS desta migration, esse grant amplo RESTABELECE o
-- privilégio na coluna revogada — Postgres não preserva a exclusão de
-- coluna quando um grant de tabela mais amplo é reemitido por cima. Camada
-- 1 sozinha é frágil a essa ordem; verificado empiricamente durante a
-- auditoria desta etapa (teste dedicado em
-- supabase/tests/14_m1f_s1_platform_role_selfpromotion.sql).
--
-- Camada 2 — trigger independente de GRANT: bloqueia a MUDANÇA de
-- platform_role sempre que o role efetivo da sessão for authenticated ou
-- anon, não importa qual privilégio de coluna/tabela essa sessão tenha no
-- momento. Um trigger dispara em qualquer UPDATE bem-sucedido
-- independentemente de COMO o privilégio foi obtido — não há ordem de
-- GRANT que o contorne. Esta é a defesa que efetivamente garante a
-- invariante; a Camada 1 é otimização/defesa antecipada, não a garantia
-- final.
revoke update (platform_role) on public.profiles from public;
revoke update (platform_role) on public.profiles from anon;
revoke update (platform_role) on public.profiles from authenticated;

create function public.profiles_guard_platform_role() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.platform_role is distinct from old.platform_role
     and current_user in ('authenticated', 'anon') then
    raise exception 'profiles.platform_role cannot be changed by role %', current_user;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_platform_role_ck
  before update of platform_role on public.profiles
  for each row execute function public.profiles_guard_platform_role();

-- ── company_role ─────────────────────────────────────────────────────────
-- Papel operacional da membership (design §5.2). ADMIN não é valor possível
-- aqui — é absorvido por MANAGER (design §5.4); o enum legado user_role
-- ('admin','manager','seller') permanece intocado em profiles.role.

create type public.company_role as enum ('manager', 'seller');

-- ── company_memberships ──────────────────────────────────────────────────
-- Schema idêntico ao aprovado em
-- docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §6.2: id, company_id,
-- profile_id, role, is_active, invited_at, joined_at, created_at,
-- updated_at. Sem created_by_profile_id/updated_by_profile_id — não fazem
-- parte do schema aprovado nesta revisão, não inventados aqui. Sem coluna
-- de "status" separada — is_active boolean é exatamente o que o design
-- aprovou; nenhum estado além dos aprovados é adicionado.
--
-- profile_id ON DELETE RESTRICT (não SET NULL, não CASCADE): apagar um
-- profile que ainda tem membership é bloqueado — nenhuma exclusão de
-- profile "com histórico" acontece silenciosamente (requisito desta
-- etapa). company_id ON DELETE CASCADE: mesmo padrão já usado para TODA FK
-- de company_id desde M1-B/M1-C (apagar company é sempre operação de
-- operador, nunca exposta ao app).
--
-- unique(company_id, id): alvo da FK composta que sellers.membership_id usa
-- — (company_id, membership_id) references company_memberships(company_id,
-- id) (padrão M1-C §3). unique(company_id, profile_id): identificação única
-- do vínculo profile+company (nunca duas linhas para o mesmo par, ativa ou
-- não — requisito desta etapa). Índice único PARCIAL em (profile_id) where
-- is_active: no máximo 1 membership ATIVA por profile — decisão do design
-- aprovado (§6.2), mantida nesta auditoria porque o documento a especifica
-- como a regra ATUAL (não como ausência de regra): "no máximo 1 membership
-- ATIVA por profile" é a frase literal do §6.2, e a remoção fica
-- explicitamente condicionada a "quando o produto decidir suportar
-- múltiplas empresas por pessoa de verdade" — uma decisão de produto futura
-- e não pedida nesta etapa, não uma limitação herdada do modelo legado por
-- conveniência. Ver auditoria completa no relatório desta etapa.
--
-- (auditoria pós-implementação removeu unique(company_id, id, profile_id):
-- não era alvo de nenhuma FK — sellers referencia company_memberships só
-- por (company_id, id); a correspondência de profile_id é garantida pelo
-- trigger sellers_check_membership_consistency, não por uma FK de 3
-- colunas. Unique redundante removida — nenhuma constraint sem uso real.)

create table public.company_memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  role        public.company_role not null,
  is_active   boolean not null default true,
  invited_at  timestamptz,
  joined_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (company_id, id),
  unique (company_id, profile_id)
);

create unique index company_memberships_profile_single_active_uidx
  on public.company_memberships (profile_id)
  where is_active;

create index company_memberships_company_id_idx on public.company_memberships(company_id);
create index company_memberships_profile_id_idx on public.company_memberships(profile_id);

create trigger company_memberships_set_updated_at
  before update on public.company_memberships
  for each row execute function public.set_updated_at();

-- ── integridade bidirecional (correção pós-auditoria) ───────────────────
-- O trigger em sellers (mais abaixo) só valida no momento em que o SELLER é
-- gravado — nada impedia, antes desta correção, que alguém alterasse a
-- MEMBERSHIP depois de um seller já apontar para ela, deixando o par
-- sellers/company_memberships inconsistente sem passar por nenhum dos dois
-- triggers. Dois problemas distintos, cada um com a defesa mínima
-- necessária:
--
--   1. company_id e profile_id são IMUTÁVEIS após a criação da membership.
--      Não existe fluxo de produto em que "a mesma membership muda de dono
--      ou de empresa" — isso é sempre criar um vínculo novo, nunca editar o
--      existente. Não há forma declarativa (FK/CHECK) de expressar
--      imutabilidade entre OLD e NEW — exige trigger, é o único mecanismo do
--      Postgres para isso.
--   2. role só pode deixar de ser 'seller' enquanto NENHUM seller ainda
--      referencia esta membership. O design (§10.3) prevê promoção de
--      seller para manager como parte do ciclo de vida — não é bloqueada
--      incondicionalmente — mas até existir uma RPC transacional que
--      desvincule/religue o seller (fora do escopo do S1), a troca crua de
--      role deixaria sellers.membership_id apontando para uma membership
--      MANAGER, exatamente o estado que o trigger de sellers existe para
--      impedir na outra direção.
--   3. is_active NÃO é restringido por este trigger — suspender/reativar
--      uma membership é transição de ciclo de vida normal e esperada (o S6
--      sincroniza sellers.is_active na mesma transação, mas isso não exige
--      bloquear a membership aqui: nenhum dos três invariantes protegidos
--      — mesma empresa, mesmo profile, role seller — é violado só por
--      is_active mudar).

create function public.company_memberships_check_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.company_id <> old.company_id then
    raise exception 'company_memberships.company_id is immutable after creation';
  end if;

  if new.profile_id <> old.profile_id then
    raise exception 'company_memberships.profile_id is immutable after creation';
  end if;

  if new.role <> old.role and old.role = 'seller' then
    if exists (select 1 from public.sellers where membership_id = old.id) then
      raise exception 'company_memberships.role cannot change away from seller while a seller still references this membership (id=%)', old.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger company_memberships_check_mutation_ck
  before update of company_id, profile_id, role on public.company_memberships
  for each row execute function public.company_memberships_check_mutation();

-- ── RLS: habilitada, ZERO policy, ZERO grant (postura fechada de propósito) ─
-- Não existe consumidor frontend desta tabela ainda. Dupla negação (mesmo
-- padrão de "sem grant e sem policy = negado duas vezes" já usado em toda a
-- base desde M1-C): RLS habilitada sem NENHUMA policy já nega toda linha a
-- qualquer role que não seja o dono da tabela/superusuário; REVOKE ALL
-- reforça a negação também no nível de grant. O S2 definirá as policies
-- definitivas apoiadas em can_access_company()/require_company_access()
-- (design §7.4) — nenhuma policy provisória é criada aqui para não nascer
-- apoiada em helpers que ainda não existem.

alter table public.company_memberships enable row level security;

revoke all on table public.company_memberships from public;
revoke all on table public.company_memberships from anon;
revoke all on table public.company_memberships from authenticated;

-- ── sellers.membership_id ────────────────────────────────────────────────
-- Nullable nesta etapa, de propósito (não "membership_id not null imediato
-- após backfill"): supabase/seed.sql roda DEPOIS de todas as migrations
-- (mesma ordem que já faz o seed de pipeline_stages em m1c_02 produzir zero
-- linhas contra companies inexistentes na hora da migration — ver
-- comentário lá) e cria sellers sem membership_id, porque seed.sql está
-- fora do escopo de arquivos permitidos nesta etapa. Uma constraint NOT
-- NULL aqui quebraria `supabase db reset` para todo mundo. NOT NULL fica
-- para uma etapa posterior, quando o fluxo de criação de seller
-- (onboarding/convite, S4+) sempre popular a membership junto.

alter table public.sellers
  add column membership_id uuid;

-- FK composta: garante que a membership referenciada é da MESMA empresa do
-- seller (MATCH SIMPLE — company_id ou membership_id nulos não acionam a
-- checagem, mesmo comportamento já documentado desde M1-C §3). ON DELETE
-- RESTRICT: não é possível apagar uma membership ainda referenciada por um
-- seller (requisito desta etapa — "exclusão indevida de membership usada
-- por seller é negada").
alter table public.sellers
  add constraint sellers_membership_company_fk
  foreign key (company_id, membership_id)
  references public.company_memberships (company_id, id)
  on delete restrict;

-- Trigger de consistência: a FK acima só garante "mesma empresa" — não há
-- como expressar com uma FK simples que (a) a membership referenciada tem
-- role = 'seller' (nunca 'manager') e (b) o profile_id da membership é
-- EXATAMENTE o profile_id do seller. As duas checagens exigem ler uma
-- coluna não-chave (role) e comparar contra outra tabela — chave composta
-- sozinha não expressa isso com segurança, por isso o trigger (determinístico
-- e testável, como pedido nesta etapa). Segue o mesmo molde de
-- leads_bump_version() (m1e_01): função de trigger simples, search_path
-- vazio, sem SECURITY DEFINER e sem revoke/grant — funções de trigger não
-- são chamadas via EXECUTE direto do cliente, então esse tratamento (usado
-- nas RPCs/helpers) não se aplica aqui.

create function public.sellers_check_membership_consistency() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_membership public.company_memberships;
begin
  if new.membership_id is null then
    return new;
  end if;

  select * into v_membership
    from public.company_memberships
    where id = new.membership_id;

  if v_membership.id is null then
    raise exception 'sellers.membership_id references a non-existent company_memberships row';
  end if;

  if v_membership.role <> 'seller' then
    raise exception 'sellers.membership_id must reference a membership with role = seller (got %)', v_membership.role;
  end if;

  if new.profile_id is null or new.profile_id <> v_membership.profile_id then
    raise exception 'sellers.membership_id must reference a membership for the same profile_id as the seller';
  end if;

  return new;
end;
$$;

create trigger sellers_membership_consistency_ck
  before insert or update of membership_id, profile_id, company_id on public.sellers
  for each row execute function public.sellers_check_membership_consistency();

commit;
