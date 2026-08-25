-- PODIUM-COMPETITION-R1-EXEC — list_company_seller_leaderboard
-- (20260825120000_podium_competition_leaderboard_r1.sql). Cobre
-- autorização (Manager/Seller da própria empresa, outra empresa deny,
-- Super Admin explícito, sem sessão deny), status da empresa, roster
-- (todos os sellers.is_active=true, inclusive zero-vendas; inativo
-- excluído), filtro de período (sales.sold_at / visits.closed_at), o
-- desempate completo (sales -> visitas realizadas -> MAX(sold_at) ->
-- nome/id) e posições sempre únicas (row_number, nunca rank/dense_rank).
-- Fixtures sintéticas @test.local, transação com rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

create or replace function pg_temp.as_user(p_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- FIXTURES
-- ══════════════════════════════════════════════════════════════════════

insert into public.companies (id, name, cnpj, phone, timezone, status) values
  ('c7010000-0000-0000-0000-000000000001', 'C61 Empresa Ativa',    null, null, 'America/Sao_Paulo', 'ativa'),
  ('c7010000-0000-0000-0000-000000000002', 'C61 Empresa Outra',    null, null, 'America/Sao_Paulo', 'ativa'),
  ('c7010000-0000-0000-0000-000000000003', 'C61 Empresa Suspensa', null, null, 'America/Sao_Paulo', 'suspensa');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c7020000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c61-manager-ativa@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c7020000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c61-seller-a@test.local',         now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c7020000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'c61-manager-outra@test.local',    now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c7020000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'c61-superadmin@test.local',       now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c7020000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'c61-manager-suspensa@test.local', now(), now(), now());

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('c7020000-0000-0000-0000-000000000001', 'C61 Manager Ativa',    'c61-manager-ativa@test.local',    true, null),
  ('c7020000-0000-0000-0000-000000000002', 'C61 Seller A',         'c61-seller-a@test.local',         true, null),
  ('c7020000-0000-0000-0000-000000000003', 'C61 Manager Outra',    'c61-manager-outra@test.local',    true, null),
  ('c7020000-0000-0000-0000-000000000004', 'C61 Super Admin',      'c61-superadmin@test.local',       true, 'super_admin'),
  ('c7020000-0000-0000-0000-000000000005', 'C61 Manager Suspensa', 'c61-manager-suspensa@test.local', true, null);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('c7030000-0000-0000-0000-000000000001', 'c7010000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'manager', true),
  ('c7030000-0000-0000-0000-000000000002', 'c7010000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000002', 'seller',  true),
  ('c7030000-0000-0000-0000-000000000003', 'c7010000-0000-0000-0000-000000000002', 'c7020000-0000-0000-0000-000000000003', 'manager', true),
  ('c7030000-0000-0000-0000-000000000004', 'c7010000-0000-0000-0000-000000000003', 'c7020000-0000-0000-0000-000000000005', 'manager', true);
-- Super Admin (...-0004) deliberadamente sem membership.

-- Roster da Empresa Ativa (§6/§7 do EXEC). Só seller-a e o Manager têm
-- cadeia completa de auth (precisam logar); os demais só precisam existir
-- em public.sellers para participar da agregação — nenhum teste desta
-- suíte loga como eles.
insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id, is_active) values
  ('c61SellerA',        'c7010000-0000-0000-0000-000000000001', 'C61 Seller A',    'A',    'c7020000-0000-0000-0000-000000000002', 'c7030000-0000-0000-0000-000000000002', true),
  ('c61SellerB',        'c7010000-0000-0000-0000-000000000001', 'C61 Seller B',    'B',    null, null, true),
  ('c61SellerC',        'c7010000-0000-0000-0000-000000000001', 'C61 Seller C',    'C',    null, null, true),
  ('c61SellerG',        'c7010000-0000-0000-0000-000000000001', 'C61 Seller G',    'G',    null, null, true),
  ('c61SellerH',        'c7010000-0000-0000-0000-000000000001', 'C61 Seller H',    'H',    null, null, true),
  ('c61SellerD',        'c7010000-0000-0000-0000-000000000001', 'C61 Seller D',    'D',    null, null, true),
  ('c61SellerJ',        'c7010000-0000-0000-0000-000000000001', 'Aaa Zero Seller', 'J',    null, null, true),
  ('c61SellerI',        'c7010000-0000-0000-0000-000000000001', 'Zzz Zero Seller', 'I',    null, null, true),
  ('c61SellerInactive', 'c7010000-0000-0000-0000-000000000001', 'C61 Seller Inativo', 'X', null, null, false),
  ('c61SellerOutside',  'c7010000-0000-0000-0000-000000000001', 'C61 Seller Fora Periodo', 'O', null, null, true),
  ('c61SellerOutra',    'c7010000-0000-0000-0000-000000000002', 'C61 Seller Outra Empresa', 'Y', null, null, true);

insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('c7040000-0000-0000-0000-000000000001', 'c7010000-0000-0000-0000-000000000001', 'new', 'Novo', 0),
  ('c7040000-0000-0000-0000-000000000002', 'c7010000-0000-0000-0000-000000000002', 'new', 'Novo', 0);

-- 1 lead por seller-com-venda (reaproveitado por todas as Deals daquele
-- seller — deals.lead_id não é UNIQUE). IDs puramente numéricos (uuid
-- literal exige hex 0-9a-f — sem letras mnemônicas g/h/x/o/y).
-- Mapa: 0001=A 0002=B 0003=C 0004=G 0005=H 0006=Inativo 0007=Fora 0008=Outra
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
  ('c7050000-0000-0000-0000-000000000001', 'c7010000-0000-0000-0000-000000000001', 'Lead A', '(11) 90000-0001', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerA'),
  ('c7050000-0000-0000-0000-000000000002', 'c7010000-0000-0000-0000-000000000001', 'Lead B', '(11) 90000-0002', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerB'),
  ('c7050000-0000-0000-0000-000000000003', 'c7010000-0000-0000-0000-000000000001', 'Lead C', '(11) 90000-0003', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerC'),
  ('c7050000-0000-0000-0000-000000000004', 'c7010000-0000-0000-0000-000000000001', 'Lead G', '(11) 90000-0004', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerG'),
  ('c7050000-0000-0000-0000-000000000005', 'c7010000-0000-0000-0000-000000000001', 'Lead H', '(11) 90000-0005', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerH'),
  ('c7050000-0000-0000-0000-000000000006', 'c7010000-0000-0000-0000-000000000001', 'Lead Inativo', '(11) 90000-0006', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerInactive'),
  ('c7050000-0000-0000-0000-000000000007', 'c7010000-0000-0000-0000-000000000001', 'Lead Fora', '(11) 90000-0007', 'Onix', 'c7040000-0000-0000-0000-000000000001', 'c61SellerOutside'),
  ('c7050000-0000-0000-0000-000000000008', 'c7010000-0000-0000-0000-000000000002', 'Lead Outra', '(11) 90000-0008', 'Onix', 'c7040000-0000-0000-0000-000000000002', 'c61SellerOutra');

-- 1 Deal por Sale (sales.deal_id é UNIQUE) — status/discount/payment_method
-- são só o mínimo válido, nunca lidos pela RPC sob teste. Mapa de deal/sale
-- (mesmo número em ambas as tabelas): 0001-0003=A 0004-0006=B 0007-0008=C
-- 0009-0010=G 0011-0012=H 0013-0014=Inativo 0015=Fora 0016=Outra.
insert into public.deals (id, company_id, lead_id, client_name_snapshot, assigned_seller_id, vehicle, value_cents, discount_percent, payment_method, created_by, updated_by, status) values
  ('c7060000-0000-0000-0000-000000000001', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000001', 'Lead A', 'c61SellerA', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000002', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000001', 'Lead A', 'c61SellerA', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000003', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000001', 'Lead A', 'c61SellerA', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000004', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000002', 'Lead B', 'c61SellerB', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000005', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000002', 'Lead B', 'c61SellerB', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000006', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000002', 'Lead B', 'c61SellerB', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000007', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000003', 'Lead C', 'c61SellerC', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000008', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000003', 'Lead C', 'c61SellerC', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000009', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000004', 'Lead G', 'c61SellerG', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000010', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000004', 'Lead G', 'c61SellerG', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000011', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000005', 'Lead H', 'c61SellerH', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000012', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000005', 'Lead H', 'c61SellerH', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000013', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000006', 'Lead Inativo', 'c61SellerInactive', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000014', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000006', 'Lead Inativo', 'c61SellerInactive', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000015', 'c7010000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000007', 'Lead Fora', 'c61SellerOutside', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000001', 'c7020000-0000-0000-0000-000000000001', 'sold'),
  ('c7060000-0000-0000-0000-000000000016', 'c7010000-0000-0000-0000-000000000002', 'c7050000-0000-0000-0000-000000000008', 'Lead Outra', 'c61SellerOutra', 'Onix', 100000, 0, 'a_vista', 'c7020000-0000-0000-0000-000000000003', 'c7020000-0000-0000-0000-000000000003', 'sold');

-- Período oficial usado pelos testes de agregação: [2026-01-01, 2026-01-31].
-- Seller A: 3 vendas DENTRO do período (max sold_at = dia 15).
-- Seller B: 3 vendas DENTRO do período, empata em saleCount com A, mas
--   max(sold_at) = dia 20 (depois de A) -> A fica acima de B.
-- Seller C/G/H: 2 vendas cada. C max=dia04, G max=dia06, H max=dia09.
-- Seller Inativo: 2 vendas DENTRO do período, mas is_active=false ->
--   NUNCA aparece no roster (exclusão testada abaixo).
-- Seller Fora: 1 venda FORA do período (dezembro/2025) -> não deve contar
--   para saleCount dentro do range oficial.
insert into public.sales (id, company_id, deal_id, lead_id, assigned_seller_id, sold_value_cents, payment_method, sold_by, sold_at) values
  ('c7070000-0000-0000-0000-000000000001', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000001', 'c7050000-0000-0000-0000-000000000001', 'c61SellerA', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-05 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000002', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000002', 'c7050000-0000-0000-0000-000000000001', 'c61SellerA', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-10 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000003', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000003', 'c7050000-0000-0000-0000-000000000001', 'c61SellerA', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-15 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000004', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000004', 'c7050000-0000-0000-0000-000000000002', 'c61SellerB', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-03 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000005', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000005', 'c7050000-0000-0000-0000-000000000002', 'c61SellerB', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-08 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000006', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000006', 'c7050000-0000-0000-0000-000000000002', 'c61SellerB', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-20 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000007', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000007', 'c7050000-0000-0000-0000-000000000003', 'c61SellerC', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-02 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000008', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000008', 'c7050000-0000-0000-0000-000000000003', 'c61SellerC', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-04 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000009', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000009', 'c7050000-0000-0000-0000-000000000004', 'c61SellerG', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-01 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000010', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000010', 'c7050000-0000-0000-0000-000000000004', 'c61SellerG', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-06 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000011', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000011', 'c7050000-0000-0000-0000-000000000005', 'c61SellerH', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-01 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000012', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000012', 'c7050000-0000-0000-0000-000000000005', 'c61SellerH', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-09 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000013', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000013', 'c7050000-0000-0000-0000-000000000006', 'c61SellerInactive', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-05 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000014', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000014', 'c7050000-0000-0000-0000-000000000006', 'c61SellerInactive', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2026-01-06 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000015', 'c7010000-0000-0000-0000-000000000001', 'c7060000-0000-0000-0000-000000000015', 'c7050000-0000-0000-0000-000000000007', 'c61SellerOutside', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000001', '2025-12-15 12:00:00+00'),
  ('c7070000-0000-0000-0000-000000000016', 'c7010000-0000-0000-0000-000000000002', 'c7060000-0000-0000-0000-000000000016', 'c7050000-0000-0000-0000-000000000008', 'c61SellerOutra', 100000, 'a_vista', 'c7020000-0000-0000-0000-000000000003', '2026-01-05 12:00:00+00');

-- Visitas completed (§10/§23): Seller C/G/H 1 cada dentro do período,
-- Seller D 2 dentro do período (zero vendas, ranqueado só por visitas),
-- Seller Fora 1 completed FORA do período (não deve contar), Seller D
-- também tem 1 visita scheduled (nunca "realizada") no meio do período.
insert into public.visits (id, company_id, client_name, assigned_seller_id, vehicles, scheduled_at, status, outcome, closed_by, closed_at) values
  ('c7080000-0000-0000-0000-000000000001', 'c7010000-0000-0000-0000-000000000001', 'Visita C', 'c61SellerC', array['Onix'], '2026-01-02 09:00:00+00', 'completed', 'sold', 'c7020000-0000-0000-0000-000000000001', '2026-01-02 10:00:00+00'),
  ('c7080000-0000-0000-0000-000000000002', 'c7010000-0000-0000-0000-000000000001', 'Visita G', 'c61SellerG', array['Onix'], '2026-01-01 09:00:00+00', 'completed', 'sold', 'c7020000-0000-0000-0000-000000000001', '2026-01-01 10:00:00+00'),
  ('c7080000-0000-0000-0000-000000000003', 'c7010000-0000-0000-0000-000000000001', 'Visita H', 'c61SellerH', array['Onix'], '2026-01-01 09:00:00+00', 'completed', 'sold', 'c7020000-0000-0000-0000-000000000001', '2026-01-01 10:00:00+00'),
  ('c7080000-0000-0000-0000-000000000004', 'c7010000-0000-0000-0000-000000000001', 'Visita D1', 'c61SellerD', array['Onix'], '2026-01-01 09:00:00+00', 'completed', 'thinking', 'c7020000-0000-0000-0000-000000000001', '2026-01-01 10:00:00+00'),
  ('c7080000-0000-0000-0000-000000000005', 'c7010000-0000-0000-0000-000000000001', 'Visita D2', 'c61SellerD', array['Onix'], '2026-01-02 09:00:00+00', 'completed', 'thinking', 'c7020000-0000-0000-0000-000000000001', '2026-01-02 10:00:00+00'),
  ('c7080000-0000-0000-0000-000000000006', 'c7010000-0000-0000-0000-000000000001', 'Visita Fora', 'c61SellerOutside', array['Onix'], '2025-12-14 09:00:00+00', 'completed', 'sold', 'c7020000-0000-0000-0000-000000000001', '2025-12-14 10:00:00+00'),
  -- scheduled (nunca "realizada") — prova que status != completed nunca
  -- conta, mesmo para um seller que já tem visitas completed contadas
  -- (Seller D): esta linha NUNCA deve incrementar completedVisitCount.
  ('c7080000-0000-0000-0000-000000000007', 'c7010000-0000-0000-0000-000000000001', 'Visita Agendada', 'c61SellerD', array['Onix'], '2026-01-10 09:00:00+00', 'scheduled', null, null, null);

-- ══════════════════════════════════════════════════════════════════════
-- 1. CATÁLOGO / ASSINATURA / SEGURANÇA
-- ══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_proc where proname = 'list_company_seller_leaderboard' and pronamespace = 'public'::regnamespace),
  1, 'list_company_seller_leaderboard existe exatamente uma vez (sem overload)');

select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'list_company_seller_leaderboard'),
  'p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_company_id uuid DEFAULT NULL::uuid',
  'list_company_seller_leaderboard aceita exatamente 3 parametros, na ordem esperada, com default NULL em p_company_id');

select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.list_company_seller_leaderboard(timestamptz,timestamptz,uuid)'::regprocedure),
  true, 'list_company_seller_leaderboard e SECURITY DEFINER');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'list_company_seller_leaderboard'
      and (p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])),
  1, 'list_company_seller_leaderboard tem search_path vazio configurado');

select is(
  has_function_privilege('public', 'public.list_company_seller_leaderboard(timestamptz,timestamptz,uuid)', 'EXECUTE'),
  false, 'PUBLIC sem EXECUTE');
select is(
  has_function_privilege('anon', 'public.list_company_seller_leaderboard(timestamptz,timestamptz,uuid)', 'EXECUTE'),
  false, 'anon sem EXECUTE');
select is(
  has_function_privilege('authenticated', 'public.list_company_seller_leaderboard(timestamptz,timestamptz,uuid)', 'EXECUTE'),
  true, 'authenticated com EXECUTE (autorizacao real e interna)');

-- ══════════════════════════════════════════════════════════════════════
-- 2. AUTORIZAÇÃO
-- ══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)$$,
  '42501', null, 'sem autenticacao (anon): permission denied (sem EXECUTE)');
reset role;

select pg_temp.as_user('c7020000-0000-0000-0000-000000000003'); -- Manager Outra
set local role authenticated;
select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  1, 'Manager de OUTRA empresa recebe SOMENTE o roster da propria empresa (1 seller, nunca os 10 da Empresa Ativa)');
reset role;

select pg_temp.as_user('c7020000-0000-0000-0000-000000000005'); -- Manager Suspensa
set local role authenticated;
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)$$,
  '42501', null, 'empresa suspensa: forbidden, mesmo para o Manager legitimo dela (leitura operacional exige ativa)');
reset role;

select pg_temp.as_user('c7020000-0000-0000-0000-000000000004'); -- Super Admin
set local role authenticated;
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)$$,
  '42501', null, 'Super Admin sem p_company_id explicito: forbidden (nunca empresa implicita)');
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, '99999999-9999-9999-9999-999999999999'::uuid)$$,
  '42501', null, 'Super Admin + empresa inexistente: can_access_company nega, forbidden (nunca revela existencia)');
reset role;

select pg_temp.as_user('c7020000-0000-0000-0000-000000000002'); -- Seller A (empresa Ativa)
set local role authenticated;
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, 'c7010000-0000-0000-0000-000000000002'::uuid)$$,
  '42501', null, 'Seller (nao Super Admin) enviando p_company_id explicito de OUTRA empresa: forbidden');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. VALIDAÇÃO DE PARÂMETROS
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select throws_ok(
  $$select * from public.list_company_seller_leaderboard(null, '2026-01-31'::timestamptz, null)$$,
  '22023', null, 'p_period_start NULL: invalid_period');
select throws_ok(
  $$select * from public.list_company_seller_leaderboard('2026-01-31'::timestamptz, '2026-01-01'::timestamptz, null)$$,
  '22023', null, 'p_period_start > p_period_end: invalid_period');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. ROSTER — TODOS os sellers ativos, inclusive zero-vendas; inativo
--    excluido; outra empresa nunca aparece (§6/§7 do EXEC)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;

select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  9, 'roster tem exatamente 9 sellers ativos da Empresa Ativa (A,B,C,G,H,D,J,I,Fora) — o Inativo (10o cadastrado) fica de fora');

select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerInactive'),
  0, 'Seller inativo NUNCA aparece no roster competitivo (historico dele continua intacto em sales, nao verificado aqui)');

select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerOutra'),
  0, 'Seller de OUTRA empresa nunca aparece no roster da Empresa Ativa');

select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerD' and sale_count = 0),
  1, 'Seller com ZERO vendas no periodo aparece no roster (saleCount=0), quando ja existe alguma venda na empresa');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. FILTRO DE PERÍODO (sales.sold_at / visits.closed_at) — §8/§9
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;

select is(
  (select sale_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerOutside'),
  0, 'venda de dezembro/2025 (fora do range) NAO conta para saleCount de janeiro');
select is(
  (select completed_visit_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerOutside'),
  0, 'visita completed de dezembro/2025 (fora do range) NAO conta para completedVisitCount de janeiro');

select is(
  (select sale_count from public.list_company_seller_leaderboard('2025-12-01'::timestamptz, '2025-12-31'::timestamptz, null) where seller_id = 'c61SellerOutside'),
  1, 'a mesma venda CONTA quando o range pedido e dezembro/2025 (prova que o filtro e real, nao um recorte cosmetico)');

select is(
  (select completed_visit_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerD'),
  2, 'visita status=scheduled (nunca completed) nunca conta como visita realizada — Seller D fica em 2 (as 2 completed), nunca 3');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. TIE-BREAK COMPLETO + POSIÇÕES ÚNICAS (§12-§15)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;

-- Camada 1: mais vendas ganha (A e B empatam em 3, C/G/H empatam em 2 —
-- todos ficam acima de D/J/I que tem 0).
select is(
  (select sale_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerA'),
  3, 'Seller A: 3 vendas no periodo');
select is(
  (select sale_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerB'),
  3, 'Seller B: 3 vendas no periodo (empata com A em saleCount)');

-- Camada 3 (saleCount empatado, completedVisitCount tambem empatado
-- 0=0 entre A e B): quem atingiu o total atual primeiro (MAX(sold_at) menor)
-- fica acima — A(dia15) antes de B(dia20).
select ok(
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerA')
  <
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerB'),
  'Seller A (atingiu 3 vendas no dia 15) fica ACIMA de Seller B (atingiu 3 vendas no dia 20) — mesmo saleCount, desempate por MAX(sold_at) ASC');

-- Camada 2: saleCount empatado (G e H = 2), completedVisitCount tambem
-- empatado (G e H = 1 cada) — desempate cai na camada 3 (MAX(sold_at)):
-- G(dia06) antes de H(dia09).
select is(
  (select completed_visit_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerG'),
  1, 'Seller G: 1 visita realizada no periodo');
select is(
  (select completed_visit_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerH'),
  1, 'Seller H: 1 visita realizada no periodo (empata com G)');
select ok(
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerG')
  <
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerH'),
  'Seller G (atingiu a 2a venda no dia 06) fica ACIMA de Seller H (dia 09) — mesmo saleCount E completedVisitCount, desempate por MAX(sold_at)');

-- Camada 2 isolada: C tem 2 vendas + 1 visita — comparado a G/H (2 vendas +
-- 1 visita tambem) fica no mesmo grupo de desempate por MAX(sold_at)
-- (C dia04, G dia06, H dia09) — C deve ficar acima dos dois.
select ok(
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerC')
  <
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerG'),
  'Seller C (2 vendas, MAX=dia04) fica ACIMA de Seller G (2 vendas, MAX=dia06) — mesma camada de desempate');

-- Camada 4 (fallback final): D tem 0 vendas mas 2 visitas — fica acima de
-- J/I (0 vendas, 0 visitas). Entre J e I (0/0/NULL empatados em tudo),
-- o fallback final e nome ASC: "Aaa Zero Seller" (J) antes de
-- "Zzz Zero Seller" (I).
select ok(
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerD')
  <
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerJ'),
  'Seller D (0 vendas, 2 visitas) fica ACIMA de Seller J (0 vendas, 0 visitas) — completedVisitCount desempata mesmo em zero-vendas (§14)');
select ok(
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerJ')
  <
  (select rank from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerI'),
  'triple empate total (0 vendas, 0 visitas, sem MAX(sold_at)) entre J e I: fallback final por nome ASC — "Aaa Zero Seller" antes de "Zzz Zero Seller"');

-- Posições SEMPRE únicas — nunca 1,1,3 mesmo com múltiplos empates reais
-- de saleCount/completedVisitCount nesta fixture.
select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  (select count(distinct rank)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  'numero de linhas == numero de ranks DISTINTOS — nenhuma posicao duplicada (row_number, nunca rank()/dense_rank())');
select is(
  (select array_agg(rank order by rank) from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  (select array_agg(g) from generate_series(1, 9) g),
  'ranks formam a sequencia 1..9 sem buracos e sem repeticao');

-- A RPC devolve as linhas JÁ na ordem do rank (ORDER BY explícito na query
-- final) — o frontend faz Top3 = 3 primeiras linhas do array sem precisar
-- reordenar por conta própria. Usa array_agg SEM "order by" para capturar
-- a ordem de ENTREGA real, nunca uma ordem imposta pelo agregador.
select is(
  (select array_agg(rank) from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  (select array_agg(g) from generate_series(1, 9) g),
  'a ordem de ENTREGA das linhas ja e por rank ASC (ORDER BY na propria RPC, nunca dependente de reordenacao no client)');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 7. ZERO SALES NA EMPRESA (§16) — roster continua existindo, so nao ha
--    vendas: usado pelo frontend para decidir o empty state, a RPC em si
--    so precisa devolver saleCount=0 para todos, nunca lancar erro.
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000001'); -- Manager Ativa
set local role authenticated;
select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2020-01-01'::timestamptz, '2020-01-31'::timestamptz, null) where sale_count > 0),
  0, 'range sem nenhuma venda da empresa: todo o roster ativo aparece com saleCount=0 (nunca um erro, nunca linhas fantasmas)');
select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2020-01-01'::timestamptz, '2020-01-31'::timestamptz, null)),
  9, 'roster completo (9) continua presente mesmo com zero vendas no periodo');
reset role;

-- ══════════════════════════════════════════════════════════════════════
-- 8. SELLER: MESMO LEADERBOARD DO MANAGER (§4/§11) — nenhuma Sale/Visit
--    bruta e devolvida, so o agregado.
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000002'); -- Seller A
set local role authenticated;
select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null)),
  9, 'Seller recebe o MESMO roster completo (9) que o Manager — nunca so a propria linha');
select is(
  (select sale_count from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, null) where seller_id = 'c61SellerB'),
  3, 'Seller A enxerga o saleCount agregado de OUTRO seller (B) — agregado, nunca as Sales brutas dele');
reset role;

-- Coluna revenue_cents/receita NAO existe no contrato desta RPC (§11/§24
-- do EXEC): nunca exposta a Seller nesta V1.
select hasnt_column('public', 'list_company_seller_leaderboard', 'revenue_cents', 'RPC nao e uma tabela, checagem informativa');

-- ══════════════════════════════════════════════════════════════════════
-- 9. SUPER ADMIN — empresa explícita autorizada (future-proof, §3)
-- ══════════════════════════════════════════════════════════════════════

select pg_temp.as_user('c7020000-0000-0000-0000-000000000004'); -- Super Admin
set local role authenticated;
select is(
  (select count(*)::int from public.list_company_seller_leaderboard('2026-01-01'::timestamptz, '2026-01-31'::timestamptz, 'c7010000-0000-0000-0000-000000000001'::uuid)),
  9, 'Super Admin com p_company_id explicito e autorizado ve o mesmo roster (9) da Empresa Ativa');
reset role;

select * from finish();
rollback;
