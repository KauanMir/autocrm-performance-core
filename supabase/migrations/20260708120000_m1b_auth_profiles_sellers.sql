-- M1-B — Supabase setup + Auth real + profiles/sellers
-- Escopo: companies, profiles, sellers. NÃO cria leads/visits/deals/sales/tasks
-- (continuam no localStorage até M1-C+, ver M1-A).
--
-- DESVIO DELIBERADO do schema de referência do M1-A: sellers.id é `text`,
-- não `uuid`. O app comercial (leads/visitas/propostas/vendas/tarefas) ainda
-- vive 100% no localStorage e referencia vendedores pelos ids curtos do seed
-- original ('s1'..'s12' — ver lib/data.ts SELLERS). Um uuid novo aqui quebraria
-- imediatamente `currentUser.sellerId` contra esses dados sem um remapeamento
-- completo, que é trabalho de M1-C (quando leads efetivamente migram, junto
-- com o resto do RBAC por seller_id). Novas linhas continuam recebendo um
-- valor com cara de uuid via default — só os 12 vendedores seed usam os ids
-- antigos, de propósito. profiles.seller_id acompanha o mesmo tipo por FK.

create extension if not exists pgcrypto;

-- ── enum ────────────────────────────────────────────────────────────────

create type user_role as enum ('admin', 'manager', 'seller');

-- ── companies ───────────────────────────────────────────────────────────

create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cnpj        text,
  phone       text,
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── profiles ────────────────────────────────────────────────────────────
-- seller_id referencia sellers.id, mas sellers ainda não existe neste ponto
-- do arquivo (dependência circular) — a coluna nasce sem FK e ganha a
-- constraint logo depois de `sellers` ser criada, mais abaixo.

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid references companies(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        user_role not null,
  seller_id   text, -- FK adicionada depois de `sellers` existir (ver abaixo)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_company_id_idx on profiles(company_id);
create index profiles_seller_id_idx  on profiles(seller_id);
create unique index profiles_email_idx on profiles(lower(email));

-- ── sellers ─────────────────────────────────────────────────────────────

create table sellers (
  id           text primary key default gen_random_uuid()::text, -- ver nota de topo
  company_id   uuid references companies(id) on delete cascade,
  profile_id   uuid references profiles(id) on delete set null,
  name         text not null,
  first_name   text not null,
  team         text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index sellers_company_id_idx on sellers(company_id);
create index sellers_profile_id_idx on sellers(profile_id);

-- fecha a referência circular: profiles.seller_id -> sellers.id
alter table profiles
  add constraint profiles_seller_id_fkey
  foreign key (seller_id) references sellers(id) on delete set null;

-- ── updated_at automático ───────────────────────────────────────────────

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();
create trigger profiles_set_updated_at before update on profiles
  for each row execute function set_updated_at();
create trigger sellers_set_updated_at before update on sellers
  for each row execute function set_updated_at();

-- ── funções auxiliares de RLS (SECURITY DEFINER) ───────────────────────
-- Lêem `profiles` por dentro, ignorando a própria RLS de `profiles` — é o
-- jeito padrão de evitar recursão quando uma policy de `profiles` precisaria
-- consultar `profiles` de novo para descobrir o papel/empresa de quem pede.
-- search_path fixo é proteção padrão contra sequestro de search_path em
-- funções SECURITY DEFINER.

create or replace function current_profile_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid();
$$;

create or replace function current_profile_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_profile_seller_id() returns text
language sql stable security definer set search_path = public as $$
  select seller_id from profiles where id = auth.uid();
$$;

create or replace function is_manager_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select current_profile_role() in ('manager', 'admin');
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Regra de ouro: role nunca vem do client. Toda policy abaixo lê o papel de
-- quem está autenticado a partir de `profiles`, nunca de um valor que o
-- request poderia forjar. Sem policy de INSERT/DELETE nas três tabelas nesta
-- fase — criação de company/seller/profile é operação de operador (seed
-- manual, ver supabase/seed.sql), não um fluxo self-serve ainda.

alter table companies enable row level security;
alter table profiles  enable row level security;
alter table sellers   enable row level security;

-- companies
create policy companies_select_own on companies
  for select using (id = current_profile_company_id());

create policy companies_update_admin on companies
  for update using (
    id = current_profile_company_id() and current_profile_role() = 'admin'
  ) with check (
    id = current_profile_company_id() and current_profile_role() = 'admin'
  );

-- profiles
create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_select_company on profiles
  for select using (
    company_id = current_profile_company_id() and is_manager_or_admin()
  );

-- Só admin edita profiles (inclui role/seller_id) — de propósito não existe
-- policy que deixe um seller/manager alterar nem o próprio profile ainda;
-- é a política mínima segura pedida no M1-B. Ampliar (ex.: permitir
-- editar só `name`) é decisão de produto futura, não um requisito desta fase.
create policy profiles_update_admin on profiles
  for update using (
    company_id = current_profile_company_id() and current_profile_role() = 'admin'
  ) with check (
    company_id = current_profile_company_id() and current_profile_role() = 'admin'
  );

-- sellers
create policy sellers_select_own on sellers
  for select using (
    company_id = current_profile_company_id() and id = current_profile_seller_id()
  );

create policy sellers_select_company on sellers
  for select using (
    company_id = current_profile_company_id() and is_manager_or_admin()
  );

create policy sellers_insert_admin on sellers
  for insert with check (
    company_id = current_profile_company_id() and current_profile_role() = 'admin'
  );

create policy sellers_update_admin on sellers
  for update using (
    company_id = current_profile_company_id() and current_profile_role() = 'admin'
  ) with check (
    company_id = current_profile_company_id() and current_profile_role() = 'admin'
  );
