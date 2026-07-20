-- M1-F S1 — testes de constraints (pgTAP): duplicação, role inválida,
-- inconsistência seller/membership, exclusões indevidas. Roda como
-- postgres. Rollback ao final.
--
-- Nota sobre "status inválido é negado" (item do checklist desta etapa):
-- o design aprovado (docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §6.2)
-- modela o estado da membership como is_active boolean, não como enum de
-- status — não foi inventado um enum além do aprovado. "Status inválido" é
-- estruturalmente impossível (boolean só aceita true/false), já coberto
-- por col_type_is em 10_m1f_s1_schema.sql.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures ────────────────────────────────────────────────────────────
insert into public.companies (id, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Empresa E Constraints Teste'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Empresa D Constraints Teste');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'econstraint1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'econstraint2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'econstraint3@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'econstraint4@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role) values
  ('e0000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'E Constraint 1', 'econstraint1@test.local', 'seller'),
  ('e0000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'E Constraint 2', 'econstraint2@test.local', 'seller'),
  ('e0000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'E Constraint 3', 'econstraint3@test.local', 'seller'),
  ('e0000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'E Manager 4',    'econstraint4@test.local', 'manager');

insert into public.company_memberships (company_id, profile_id, role) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e0000000-0000-0000-0000-000000000001', 'seller'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e0000000-0000-0000-0000-000000000003', 'seller'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e0000000-0000-0000-0000-000000000004', 'manager');

insert into public.sellers (id, company_id, name, first_name, profile_id) values
  ('sConstraint1', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Seller Constraint 1', 'S1', 'e0000000-0000-0000-0000-000000000001');

-- ── membership duplicada profile/company é negada ────────────────────────
select throws_ok($$insert into public.company_memberships (company_id, profile_id, role)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'e0000000-0000-0000-0000-000000000001', 'manager')$$,
  '23505', null, 'membership duplicada (mesma company+profile) e negada');

-- ── role inválida é negada (nao existe no enum company_role) ────────────
select throws_ok($$insert into public.company_memberships (company_id, profile_id, role)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'e0000000-0000-0000-0000-000000000002', 'admin')$$,
  '22P02', null, 'role admin nao existe em company_role — insert falha');

-- ── segunda membership ATIVA para o mesmo profile em outra empresa é
--    negada (unique parcial por profile ativo — design §6.2) ───────────
select throws_ok($$insert into public.company_memberships (company_id, profile_id, role)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'e0000000-0000-0000-0000-000000000001', 'seller')$$,
  '23505', null, 'segunda membership ATIVA do mesmo profile em outra empresa e negada');

-- ── seller com membership de outra empresa é negado (FK composta) ───────
-- Fixture isolada: mesma profile_id e role='seller' do seller de teste
-- (para o TRIGGER nao disparar antes), mas company_id diferente e
-- is_active=false (para nao violar a unique parcial de membership ativa) —
-- isola a checagem exatamente na FK (company_id, membership_id).
insert into public.company_memberships (company_id, profile_id, role, is_active) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'e0000000-0000-0000-0000-000000000001', 'seller', false);
select throws_ok(
  format($$update public.sellers set membership_id = %L where id = 'sConstraint1'$$,
    (select id from public.company_memberships
      where company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
        and profile_id = 'e0000000-0000-0000-0000-000000000001')),
  '23503', null, 'seller com membership de outra empresa e negado');

-- ── seller com membership de outro profile é negado (trigger) ──────────
-- Mesma empresa e role='seller' (para o FK e o check de role passarem),
-- mas profile diferente do seller de teste — isola a checagem de profile.
select throws_ok(
  format($$update public.sellers set membership_id = %L where id = 'sConstraint1'$$,
    (select id from public.company_memberships
      where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
        and profile_id = 'e0000000-0000-0000-0000-000000000003')),
  'P0001', null, 'seller com membership de outro profile (mesma empresa) e negado');

-- ── seller com membership MANAGER é negado (trigger) ────────────────────
-- Usa a membership MANAGER real da empresa (profile 4). O trigger checa
-- role ANTES de profile (função em m1f_s1_01) — o mismatch de role é
-- detectado e resulta em P0001 independentemente de o profile também
-- divergir. Não é possível criar uma segunda membership (mesma empresa,
-- mesmo profile 01) só para isolar esta checagem: violaria
-- unique(company_id, profile_id) — cada par empresa+profile tem no máximo
-- UMA linha de membership, ativa ou não (design §6.2).
select throws_ok(
  format($$update public.sellers set membership_id = %L where id = 'sConstraint1'$$,
    (select id from public.company_memberships
      where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
        and profile_id = 'e0000000-0000-0000-0000-000000000004'
        and role = 'manager')),
  'P0001', null, 'seller com membership MANAGER e negado');

-- ── caminho positivo: vincular o seller à própria membership seller ativa
--    (necessário para testar a exclusão indevida abaixo) ────────────────
select lives_ok(
  format($$update public.sellers set membership_id = %L where id = 'sConstraint1'$$,
    (select id from public.company_memberships
      where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
        and profile_id = 'e0000000-0000-0000-0000-000000000001'
        and role = 'seller' and is_active = true)),
  'vincular seller a propria membership seller ativa da mesma empresa funciona');

-- ── integridade bidirecional: alterar a MEMBERSHIP depois que um seller já
--    aponta para ela (correção pós-auditoria — o trigger em sellers só
--    valida no momento em que o SELLER é gravado, não protege este sentido
--    inverso) ───────────────────────────────────────────────────────────

-- company_id é imutável, mesmo com seller já vinculado
select throws_ok(
  $$update public.company_memberships set company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller'$$,
  'P0001', null, 'company_id de membership ja vinculada a um seller e imutavel');

-- profile_id é imutável, mesmo com seller já vinculado
select throws_ok(
  $$update public.company_memberships set profile_id = 'e0000000-0000-0000-0000-000000000003'
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller'$$,
  'P0001', null, 'profile_id de membership ja vinculada a um seller e imutavel');

-- role não pode deixar de ser 'seller' enquanto um seller ainda referencia
-- esta membership (o UPDATE cru deixaria sellers.membership_id apontando
-- para uma membership MANAGER — exatamente o que o trigger de sellers
-- impede na direção oposta)
select throws_ok(
  $$update public.company_memberships set role = 'manager'
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller'$$,
  'P0001', null, 'role nao pode deixar de ser seller enquanto um seller ainda referencia a membership');

-- role PODE mudar quando NENHUM seller referencia a membership (não é uma
-- restrição incondicional — design §10.3 prevê promoção seller->manager)
select lives_ok(
  $$update public.company_memberships set role = 'manager'
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000003' and role = 'seller'$$,
  'role pode mudar de seller para manager quando nenhum seller referencia a membership');

-- is_active NÃO é restringido por este trigger (suspender/reativar é
-- transição de ciclo de vida normal, mesmo com seller vinculado) —
-- revertido logo em seguida para não afetar os testes de exclusão abaixo.
-- Confirma explicitamente que a associação SOBREVIVE à desativação
-- (histórico preservado): sellers.membership_id continua exatamente o
-- mesmo, o seller não é apagado, a membership não é apagada — só
-- is_active muda.
select lives_ok(
  $$update public.company_memberships set is_active = false
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller'$$,
  'is_active pode ser desativado mesmo com seller vinculado (nao e uma das tres invariantes protegidas)');
select is(
  (select membership_id from public.sellers where id = 'sConstraint1'),
  (select id from public.company_memberships
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller'),
  'membership inativa permanece associada ao seller (historico preservado, nada foi desvinculado)');
select ok(
  (select true from public.sellers where id = 'sConstraint1'),
  'desativar a membership NAO apaga o seller (linha continua existindo)');
select ok(
  (select true from public.profiles where id = 'e0000000-0000-0000-0000-000000000001'),
  'desativar a membership NAO apaga a autoria/profile (linha continua existindo)');
update public.company_memberships set is_active = true
  where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller';

-- ── exclusão indevida de membership usada por seller é negada ──────────
select throws_ok(
  $$delete from public.company_memberships
    where company_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
      and profile_id = 'e0000000-0000-0000-0000-000000000001' and role = 'seller' and is_active = true$$,
  '23503', null, 'exclusao de membership ainda usada por um seller e negada');

-- ── exclusão de profile com membership (histórico) é negada ────────────
select throws_ok(
  $$delete from public.profiles where id = 'e0000000-0000-0000-0000-000000000003'$$,
  '23503', null, 'exclusao de profile com membership (historico) e negada');

-- ── nenhuma cascata destrutiva: apagar a empresa é a única forma prevista
--    de derrubar memberships, e isso já era assim para todo o resto da
--    base (companies ON DELETE CASCADE, operação de operador) — não
--    testado aqui por já ser comportamento herdado e não exclusivo desta
--    tabela; nenhuma nova cascata foi introduzida além dessa já existente.

select * from finish();
rollback;
