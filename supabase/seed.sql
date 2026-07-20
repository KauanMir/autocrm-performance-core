-- M1-B — seed inicial (companies + sellers + profiles) — LOCAL/DEV
-- Aplicado automaticamente pelo `supabase db reset` / `supabase start` locais,
-- depois das migrations.
--
-- Este arquivo tem 3 partes: company, sellers e (auth.users + profiles).
-- A Parte 3 cria usuários locais de referência SEM senha — ver aviso lá.

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 1 — company (não depende de nada)
-- ─────────────────────────────────────────────────────────────────────────

insert into companies (id, name, cnpj, phone, timezone)
values (
  '00000000-0000-0000-0000-000000000001',
  'Revenda Premium Veículos',
  '00.000.000/0001-00',
  '(11) 3000-0000',
  'America/Sao_Paulo'
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 1B — pipeline_stages padrão da company local (LOCAL/DEV)
-- ─────────────────────────────────────────────────────────────────────────
-- A migration 20260717100200_m1c_02_pipeline_stages.sql povoa os 5 estágios
-- oficiais apenas nas companies que EXISTEM no momento em que ela roda. No
-- ambiente local, o `db reset` aplica as migrations ANTES deste seed.sql —
-- ou seja, a company acima ainda não existe quando a migration executa, e o
-- INSERT dela produz zero linhas. Por isso o MESMO conjunto de estágios da
-- migration (mesmos codes, names, sort_order e is_terminal, mesma estratégia
-- idempotente de ON CONFLICT) é inserido aqui, mantendo o reset local
-- reproduzível. Os ids dos stages vêm do default da tabela.

insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal)
select c.id, s.code, s.name, s.sort_order, s.is_terminal
from public.companies c
cross join (
  values
    ('new',             'Novo',            0, false),
    ('qualified',       'Qualificado',     1, false),
    ('visit_scheduled', 'Visita agendada', 2, false),
    ('negotiation',     'Em negociação',   3, false),
    ('closing',         'Fechamento',      4, true)
) as s(code, name, sort_order, is_terminal)
on conflict (company_id, code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 2 — sellers (não depende de auth.users; ids iguais ao seed atual do
-- protótipo em lib/data.ts SELLERS, de propósito — ver nota no topo da
-- migration sobre por que sellers.id é `text` nesta fase, não uuid)
-- ─────────────────────────────────────────────────────────────────────────

insert into sellers (id, company_id, name, first_name, team) values
  ('s1',  '00000000-0000-0000-0000-000000000001', 'Marcos Silva',    'Marcos',   'Seminovos'),
  ('s2',  '00000000-0000-0000-0000-000000000001', 'Ana Souza',       'Ana',      'Seminovos'),
  ('s3',  '00000000-0000-0000-0000-000000000001', 'João Ferreira',   'João',     'Novos'),
  ('s4',  '00000000-0000-0000-0000-000000000001', 'Lucas Martins',   'Lucas',    'Novos'),
  ('s5',  '00000000-0000-0000-0000-000000000001', 'Beatriz Lima',    'Beatriz',  'Seminovos'),
  ('s6',  '00000000-0000-0000-0000-000000000001', 'Rafael Nunes',    'Rafael',   'Novos'),
  ('s7',  '00000000-0000-0000-0000-000000000001', 'Carla Mendes',    'Carla',    'Seminovos'),
  ('s8',  '00000000-0000-0000-0000-000000000001', 'Diego Alves',     'Diego',    'Novos'),
  ('s9',  '00000000-0000-0000-0000-000000000001', 'Patrícia Rocha',  'Patrícia', 'Seminovos'),
  ('s10', '00000000-0000-0000-0000-000000000001', 'Bruno Castro',    'Bruno',    'Novos'),
  ('s11', '00000000-0000-0000-0000-000000000001', 'Fernanda Dias',   'Fernanda', 'Seminovos'),
  ('s12', '00000000-0000-0000-0000-000000000001', 'Thiago Moraes',   'Thiago',   'Novos')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 3 — auth.users + profiles (LOCAL/DEV)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Usuários LOCAIS de referência, exclusivos do ambiente local/dev
-- (`supabase start` / `supabase db reset`). Os UUIDs abaixo são fixos,
-- determinísticos e escolhidos à mão — NÃO são ids do projeto remoto.
-- Nenhuma senha é definida (encrypted_password fica nulo), então login via
-- GoTrue não funciona para eles, de propósito: servem apenas para satisfazer
-- a FK profiles.id -> auth.users.id e permitir validar profiles, sellers,
-- RLS e RPCs direto no PostgreSQL local. NÃO destinados à produção.
--
--   11111111-…  admin@autocrm.com      → role admin,   seller_id null
--   22222222-…  gerente@autocrm.com    → role manager, seller_id null
--   33333333-…  vendedor1@autocrm.com  → role seller,  seller_id 's4'  (Lucas Martins)
--   44444444-…  vendedor2@autocrm.com  → role seller,  seller_id 's11' (Fernanda Dias)

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'admin@autocrm.com',     now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'gerente@autocrm.com',   now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'vendedor1@autocrm.com', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'vendedor2@autocrm.com', now(), now(), now())
on conflict (id) do nothing;

insert into profiles (id, company_id, name, email, role, seller_id) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'Admin',          'admin@autocrm.com',     'admin',   null),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Carlos Mendes',  'gerente@autocrm.com',   'manager', null),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', 'Lucas Martins',  'vendedor1@autocrm.com', 'seller',  's4'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000001', 'Fernanda Costa', 'vendedor2@autocrm.com', 'seller',  's11')
on conflict (id) do nothing;

-- Opcional, mas recomendado: linkar sellers.profile_id de volta para os dois
-- vendedores de teste, agora que os profiles existem.
update sellers set profile_id = '33333333-3333-3333-3333-333333333333' where id = 's4';
update sellers set profile_id = '44444444-4444-4444-4444-444444444444' where id = 's11';

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 4 — company_memberships + sellers.membership_id (M1-F S2)
-- ─────────────────────────────────────────────────────────────────────────
-- Mesmo motivo já documentado na Parte 1B (pipeline_stages) e nas
-- migrations m1f_s1_02/m1f_s2_01: o catch-up backfill roda como MIGRATION,
-- ANTES deste seed.sql — os 4 usuários acima ainda não existiam quando o
-- catch-up rodou, então nasceriam sem membership se nada aqui os cobrisse.
-- Mapeamento idêntico ao das migrations (design §5.4): admin/manager ->
-- MANAGER, seller -> SELLER. Sem isso, os helpers/RLS novos do S2
-- (m1f_s2_02/03) não teriam nenhum vínculo válido para testar contra os
-- usuários seedados de sempre.
--
-- Nenhum SUPER_ADMIN é criado aqui — platform_role permanece null para
-- os 4 usuários, exatamente como nas migrations. Nenhuma senha ou
-- credencial é alterada. Nenhum id existente muda.

insert into public.company_memberships (company_id, profile_id, role, is_active, joined_at)
values
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'manager', true, now()),
  ('00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'manager', true, now()),
  ('00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'seller',  true, now()),
  ('00000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'seller',  true, now())
on conflict (company_id, profile_id) do nothing;

update public.sellers s
set membership_id = cm.id
from public.company_memberships cm
where s.profile_id is not null
  and s.company_id is not null
  and cm.company_id = s.company_id
  and cm.profile_id = s.profile_id
  and cm.role = 'seller'
  and s.membership_id is null;
