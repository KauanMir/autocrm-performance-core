-- M1-F S2 — testes de catch-up backfill (pgTAP): reexecução fiel da lógica
-- de m1f_s2_01 (cópia literal, mesma nota de todos os arquivos anteriores)
-- contra fixtures dentro da própria transação de teste, mais os 8 blocos
-- de validação pós-catch-up reproduzidos fielmente para provar que
-- detectam inconsistência quando ela existe e não falsificam positivo
-- quando os dados estão saudáveis. Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures: empresa e profiles "legados" ───────────────────────────────
insert into public.companies (id, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Empresa C Catchup S2 Teste');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's2admin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 's2manager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's2seller@test.local', now(), now(), now());

insert into public.sellers (id, company_id, name, first_name) values
  ('s2Seller1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Vendedor S2', 'Vend');

insert into public.profiles (id, company_id, name, email, role, seller_id, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'S2 Admin',   's2admin@test.local',   'admin',   null,        true),
  ('c0000000-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'S2 Manager', 's2manager@test.local', 'manager', null,        true),
  ('c0000000-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'S2 Seller',  's2seller@test.local',  'seller',  's2Seller1', true);

update public.sellers set profile_id = 'c0000000-0000-0000-0000-000000000003' where id = 's2Seller1';

-- ── reexecuta a lógica de m1f_s2_01 (cópia literal do catch-up) ─────────
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null and company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  loop
    case v_profile.role
      when 'admin' then v_role := 'manager';
      when 'manager' then v_role := 'manager';
      when 'seller' then v_role := 'seller';
    end case;
    insert into public.company_memberships
      (company_id, profile_id, role, is_active, invited_at, joined_at)
    values
      (v_profile.company_id, v_profile.id, v_role, v_profile.is_active, null, v_profile.created_at)
    on conflict (company_id, profile_id) do nothing;
  end loop;
end $$;
update public.sellers s
set membership_id = cm.id
from public.company_memberships cm
where s.profile_id is not null
  and s.company_id is not null
  and cm.company_id = s.company_id
  and cm.profile_id = s.profile_id
  and cm.role = 'seller'
  and s.membership_id is null;

-- ── mapeamento de role ────────────────────────────────────────────────
select is(
  (select role::text from public.company_memberships where profile_id = 'c0000000-0000-0000-0000-000000000001'),
  'manager', 'S2 catch-up: ADMIN legado vira membership MANAGER');
select is(
  (select role::text from public.company_memberships where profile_id = 'c0000000-0000-0000-0000-000000000002'),
  'manager', 'S2 catch-up: MANAGER legado vira membership MANAGER');
select is(
  (select role::text from public.company_memberships where profile_id = 'c0000000-0000-0000-0000-000000000003'),
  'seller', 'S2 catch-up: SELLER legado vira membership SELLER');
select is(
  (select cm.id from public.sellers s join public.company_memberships cm on cm.id = s.membership_id where s.id = 's2Seller1'),
  (select id from public.company_memberships where profile_id = 'c0000000-0000-0000-0000-000000000003'),
  'S2 catch-up: seller recebe o membership_id correto');

-- ── idempotência: segunda execução não duplica ──────────────────────────
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null and company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  loop
    case v_profile.role
      when 'admin' then v_role := 'manager';
      when 'manager' then v_role := 'manager';
      when 'seller' then v_role := 'seller';
    end case;
    insert into public.company_memberships
      (company_id, profile_id, role, is_active, invited_at, joined_at)
    values
      (v_profile.company_id, v_profile.id, v_role, v_profile.is_active, null, v_profile.created_at)
    on conflict (company_id, profile_id) do nothing;
  end loop;
end $$;
select is(
  (select count(*)::int from public.company_memberships where company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  3, 'S2 catch-up: reexecutar nao duplica (idempotente)');

select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  0, 'S2 catch-up: nenhum SUPER_ADMIN criado');

-- ── profile/seller criado DEPOIS do primeiro catch-up (janela real que a
--    migration cobre em produção) ────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 's2late@test.local', now(), now(), now());
insert into public.sellers (id, company_id, name, first_name) values
  ('s2Seller2', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Vendedor Tardio S2', 'Tardio');
insert into public.profiles (id, company_id, name, email, role, seller_id, is_active) values
  ('c0000000-0000-0000-0000-000000000004', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'S2 Late', 's2late@test.local', 'seller', 's2Seller2', true);
update public.sellers set profile_id = 'c0000000-0000-0000-0000-000000000004' where id = 's2Seller2';

select is(
  (select count(*)::int from public.company_memberships where profile_id = 'c0000000-0000-0000-0000-000000000004'),
  0, 'S2 catch-up: profile tardio ainda sem membership antes de reexecutar');

do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null and company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  loop
    case v_profile.role
      when 'admin' then v_role := 'manager';
      when 'manager' then v_role := 'manager';
      when 'seller' then v_role := 'seller';
    end case;
    insert into public.company_memberships
      (company_id, profile_id, role, is_active, invited_at, joined_at)
    values
      (v_profile.company_id, v_profile.id, v_role, v_profile.is_active, null, v_profile.created_at)
    on conflict (company_id, profile_id) do nothing;
  end loop;
end $$;
update public.sellers s
set membership_id = cm.id
from public.company_memberships cm
where s.profile_id is not null
  and s.company_id is not null
  and cm.company_id = s.company_id
  and cm.profile_id = s.profile_id
  and cm.role = 'seller'
  and s.membership_id is null;

select is(
  (select role::text from public.company_memberships where profile_id = 'c0000000-0000-0000-0000-000000000004'),
  'seller', 'S2 catch-up: profile tardio ganha membership apos reexecucao');
select is(
  (select membership_id from public.sellers where id = 's2Seller2') is not null,
  true, 'S2 catch-up: seller tardio ganha membership_id apos reexecucao');

select is(
  (select count(*)::int from public.company_memberships where company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  4, 'S2 catch-up: total estavel (4) apos cobrir o tardio, sem duplicar os 3 originais');

-- ═══════════════════════════════════════════════════════════════════════
-- VALIDAÇÕES PÓS-CATCH-UP: reprodução fiel das 8 queries de m1f_s2_01,
-- provando que detectam violação quando ela existe (para as que são
-- construtíveis via fixture) e não falsificam positivo com dados
-- saudáveis (para todas). As que são estruturalmente impossíveis de violar
-- via INSERT normal (protegidas por FK composta/trigger/unique desde
-- m1f_s1_01) são testadas apenas na direção "zero falso positivo" — não é
-- possível construir a violação sem burlar a própria proteção estrutural
-- que a migration já teria abortado tentando aplicar.
-- ═══════════════════════════════════════════════════════════════════════

-- validação 1 — sobre os dados JÁ saudáveis do bloco acima: zero violações
select is(
  (select count(*)::int from public.profiles p
    where p.company_id is not null
      and not exists (select 1 from public.company_memberships cm where cm.company_id = p.company_id and cm.profile_id = p.id)),
  0, 'validacao 1 (profile sem membership): zero com dados saudaveis');

-- validação 1 — cenário real de violação: profile órfão (company_id null)
-- é corretamente EXCLUÍDO desta checagem (diagnosticado via NOTICE, não
-- tratado como violação que aborta) — confirma que o filtro
-- "company_id is not null" da própria query está correto
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's2orphan@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('c0000000-0000-0000-0000-000000000005', null, 'S2 Orphan', 's2orphan@test.local', 'seller', true);
select is(
  (select count(*)::int from public.profiles p
    where p.company_id is not null
      and not exists (select 1 from public.company_memberships cm where cm.company_id = p.company_id and cm.profile_id = p.id)),
  0, 'validacao 1: profile orfao (company_id null) NAO conta como violacao (e diagnostico, nao abort)');

-- validação 2 — cenário real de violação: seller "elegível" (profile_id e
-- company_id preenchidos) cujo profile vinculado não tem company_id, logo
-- nenhuma membership existe para cobri-lo — o backfill não consegue
-- associar com segurança, e a validação precisa detectar isso
insert into public.sellers (id, company_id, name, first_name, profile_id) values
  ('s2SellerBad', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Seller Inconsistente', 'Inc', 'c0000000-0000-0000-0000-000000000005');
select is(
  (select count(*)::int from public.sellers s
    where s.profile_id is not null and s.company_id is not null and s.membership_id is null),
  1, 'validacao 2 (seller elegivel sem membership_id): detecta o seller inconsistente construido acima');

-- limpa o seller inconsistente antes das validações 3-7 (elas leem
-- sellers JOIN company_memberships por membership_id — este seller tem
-- membership_id NULL e não entraria nessas queries de qualquer forma, mas
-- removido por clareza do cenário)
delete from public.sellers where id = 's2SellerBad';
delete from public.profiles where id = 'c0000000-0000-0000-0000-000000000005';

-- validações 3-7 — estruturalmente impossíveis de violar via INSERT normal
-- (FK composta + triggers de m1f_s1_01 já rejeitam a tentativa antes de
-- qualquer linha existir para a query encontrar) — confirmadas em "zero
-- falso positivo" contra os dados saudáveis já construídos neste arquivo
select is(
  (select count(*)::int from public.sellers s join public.company_memberships cm on cm.id = s.membership_id
    where s.profile_id is distinct from cm.profile_id),
  0, 'validacao 3 (seller x membership de outro profile): zero com dados saudaveis');
select is(
  (select count(*)::int from public.sellers s join public.company_memberships cm on cm.id = s.membership_id
    where s.company_id is distinct from cm.company_id),
  0, 'validacao 4 (seller x membership de outra empresa): zero com dados saudaveis');
select is(
  (select count(*)::int from public.sellers s join public.company_memberships cm on cm.id = s.membership_id
    where cm.role <> 'seller'),
  0, 'validacao 5 (seller x membership MANAGER): zero com dados saudaveis');
select is(
  (select count(*)::int from (select 1 from public.company_memberships group by company_id, profile_id having count(*) > 1) d),
  0, 'validacao 6 (membership duplicada): zero com dados saudaveis');
select is(
  (select count(*)::int from (select 1 from public.company_memberships where is_active group by profile_id having count(*) > 1) d),
  0, 'validacao 7 (mais de uma membership ativa por profile): zero com dados saudaveis');
select is(
  (select count(*)::int from public.profiles where platform_role is not null),
  0, 'validacao 8 (platform_role criado automaticamente): zero com dados saudaveis');

select * from finish();
rollback;
