-- M1-F S1 — testes de backfill de company_memberships e
-- sellers.membership_id (pgTAP).
--
-- Num `db reset` local, a migration m1f_s1_02 roda ANTES do seed.sql — ou
-- seja, o backfill real de produção roda contra zero linhas em ambiente
-- limpo (comentário idêntico na própria migration e em m1c_02/seed.sql
-- Parte 1B). Este teste reexecuta a MESMA lógica de INSERT/UPDATE (copiada
-- literalmente de m1f_s1_02) contra fixtures "legadas" inseridas dentro da
-- própria transação de teste, para validar o comportamento do backfill de
-- forma determinística. Roda como postgres. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures: empresa e profiles "legados" (como se fossem pré-S1) ──────
insert into public.companies (id, name) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Empresa F Backfill Teste');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'legacyadmin@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'legacymanager@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'legacyseller@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'legacyinactive@test.local', now(), now(), now());

insert into public.sellers (id, company_id, name, first_name) values
  ('fSeller1', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Vendedor F', 'Vend');

insert into public.profiles (id, company_id, name, email, role, seller_id, is_active) values
  ('f0000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Legacy Admin',    'legacyadmin@test.local',    'admin',   null,       true),
  ('f0000000-0000-0000-0000-000000000002', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Legacy Manager',  'legacymanager@test.local',  'manager', null,       true),
  ('f0000000-0000-0000-0000-000000000003', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Legacy Seller',   'legacyseller@test.local',   'seller',  'fSeller1', true),
  ('f0000000-0000-0000-0000-000000000004', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Legacy Inactive', 'legacyinactive@test.local', 'seller',  null,       false);

update public.sellers set profile_id = 'f0000000-0000-0000-0000-000000000003' where id = 'fSeller1';

-- ── reexecuta a lógica de m1f_s1_02 (cópia literal, ver nota no topo) ────
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null
  loop
    case v_profile.role
      when 'admin' then
        v_role := 'manager';
      when 'manager' then
        v_role := 'manager';
      when 'seller' then
        v_role := 'seller';
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
  (select role::text from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000001'),
  'manager', 'ADMIN legado vira membership MANAGER');
select is(
  (select role::text from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000002'),
  'manager', 'MANAGER legado vira membership MANAGER');
select is(
  (select role::text from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000003'),
  'seller', 'SELLER legado vira membership SELLER');

-- ── cobertura total, sem duplicação ──────────────────────────────────────
select is(
  (select count(*)::int from public.company_memberships where company_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  4, 'todos os 4 profiles com empresa ganharam exatamente 1 membership cada');

-- idempotência: reexecutar a mesma lógica não duplica
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null and company_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
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
  (select count(*)::int from public.company_memberships where company_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  4, 'reexecutar o backfill nao duplica memberships (idempotente)');

-- ── nenhum SUPER_ADMIN criado automaticamente ────────────────────────────
select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  0, 'nenhum profile vira SUPER_ADMIN automaticamente pelo backfill');

-- ── seller aponta para a membership correta / nunca para Manager ────────
select is(
  (select cm.role::text from public.sellers s join public.company_memberships cm on cm.id = s.membership_id where s.id = 'fSeller1'),
  'seller', 'seller aponta para membership com role seller (nunca manager)');
select is(
  (select cm.company_id from public.sellers s join public.company_memberships cm on cm.id = s.membership_id where s.id = 'fSeller1'),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'company do seller e da membership coincidem');
select is(
  (select cm.profile_id from public.sellers s join public.company_memberships cm on cm.id = s.membership_id where s.id = 'fSeller1'),
  'f0000000-0000-0000-0000-000000000003'::uuid, 'profile do seller e da membership coincidem');

-- ── IDs antigos preservados ───────────────────────────────────────────
select is((select id from public.sellers where id = 'fSeller1'), 'fSeller1', 'id do seller nao mudou com o backfill');

-- ── is_active da membership espelha o profile no momento do backfill ────
select is(
  (select is_active from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000004'),
  false, 'membership de profile inativo nasce inativa');

-- ── CENÁRIO DE CATCH-UP (janela operacional S1→S2, ver comentário na
--    própria migration m1f_s1_02): um profile/seller criado pelo fluxo
--    LEGADO depois de o backfill já ter rodado uma vez fica sem
--    membership até uma nova execução da mesma lógica — exatamente o que
--    o S2 precisará repetir antes de trocar a autoridade dos helpers.
--    Reexecuta a MESMA lógica de m1f_s1_02 (cópia literal), nunca uma
--    versão simplificada à parte. ────────────────────────────────────────

-- Novo usuário "criado depois do primeiro backfill" — mesma empresa F.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'legacylate@test.local', now(), now(), now());
insert into public.sellers (id, company_id, name, first_name) values
  ('fSeller2', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Vendedor Tardio', 'Tardio');
insert into public.profiles (id, company_id, name, email, role, seller_id, is_active) values
  ('f0000000-0000-0000-0000-000000000005', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Legacy Late', 'legacylate@test.local', 'seller', 'fSeller2', true);
update public.sellers set profile_id = 'f0000000-0000-0000-0000-000000000005' where id = 'fSeller2';

-- Confirma que, ANTES do catch-up, o registro tardio realmente não tem
-- membership nem membership_id — não é um dado já resolvido por acidente.
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000005'),
  0, 'catch-up: profile criado apos o primeiro backfill NAO tem membership antes do catch-up');
select is(
  (select membership_id from public.sellers where id = 'fSeller2'),
  null::uuid, 'catch-up: seller criado apos o primeiro backfill NAO tem membership_id antes do catch-up');

-- Executa o catch-up: MESMA lógica de m1f_s1_02, reexecutada (3ª vez neste
-- arquivo, contando as duas execuções acima).
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null and company_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
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
  (select role::text from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000005'),
  'seller', 'catch-up: profile tardio ganha membership SELLER apos o catch-up');
select is(
  (select cm.id from public.sellers s join public.company_memberships cm on cm.id = s.membership_id where s.id = 'fSeller2'),
  (select id from public.company_memberships where profile_id = 'f0000000-0000-0000-0000-000000000005'),
  'catch-up: seller tardio recebe o membership_id correto apos o catch-up');

-- Executa uma quarta vez (terceira "reexecução" contando a partir do
-- catch-up) — confirma que não há duplicação para NENHUM dos 5 profiles
-- da empresa (os 4 originais + o tardio).
do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null and company_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
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
  (select count(*)::int from public.company_memberships where company_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  5, 'catch-up: total permanece 5 memberships (4 originais + 1 tardio) apos a terceira reexecucao — sem duplicacao');

-- ── leads continuam apontando para o mesmo seller; autoria continua
--    apontando para profiles (schema não tocado pelo S1 — asserção
--    estrutural, não depende de dados) ────────────────────────────────
select fk_ok('public', 'leads', array['company_id','seller_id'],
             'public', 'sellers', array['company_id','id'],
             'leads.seller_id continua referenciando sellers diretamente (inalterado pelo S1)');
select fk_ok('public', 'leads', array['company_id','created_by_profile_id'],
             'public', 'profiles', array['company_id','id'],
             'autoria (leads.created_by_profile_id) continua apontando para profiles (inalterado pelo S1)');

select * from finish();
rollback;
