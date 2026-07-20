-- M1-F S2 — testes de unicidade sellers.membership_id (pgTAP): cobre a
-- lacuna estrutural encontrada em auditoria adversarial (m1f_s2_015).
-- Prova que a constraint UNIQUE nova impede duas linhas de sellers
-- apontarem para a mesma company_membership, sem quebrar nenhum fluxo
-- legítimo (múltiplos NULL durante a transição, memberships distintas,
-- empresas distintas, catch-up, histórico de leads). Roda como postgres.
-- Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixtures: duas empresas, duas memberships SELLER na empresa 1, uma na
--    empresa 2 ──────────────────────────────────────────────────────────
insert into public.companies (id, name) values
  ('d1eeeeee-1111-1111-1111-111111111111', 'Empresa D1 Uniqueness'),
  ('d2eeeeee-2222-2222-2222-222222222222', 'Empresa D2 Uniqueness');

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd1seller1@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'd1seller2@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'd2seller1@test.local', now(), now(), now());

insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('d1000000-0000-0000-0000-000000000001', 'd1eeeeee-1111-1111-1111-111111111111', 'D1 Seller 1', 'd1seller1@test.local', 'seller', true),
  ('d1000000-0000-0000-0000-000000000002', 'd1eeeeee-1111-1111-1111-111111111111', 'D1 Seller 2', 'd1seller2@test.local', 'seller', true),
  ('d2000000-0000-0000-0000-000000000001', 'd2eeeeee-2222-2222-2222-222222222222', 'D2 Seller 1', 'd2seller1@test.local', 'seller', true);

insert into public.company_memberships (id, company_id, profile_id, role, is_active) values
  ('d1c00000-0000-0000-0000-000000000001', 'd1eeeeee-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000001', 'seller', true),
  ('d1c00000-0000-0000-0000-000000000002', 'd1eeeeee-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-000000000002', 'seller', true),
  ('d2c00000-0000-0000-0000-000000000001', 'd2eeeeee-2222-2222-2222-222222222222', 'd2000000-0000-0000-0000-000000000001', 'seller', true);

-- pipeline_stages mínimo para o lead de histórico usado mais abaixo
insert into public.pipeline_stages (id, company_id, code, name, sort_order) values
  ('d1500000-0000-0000-0000-000000000001', 'd1eeeeee-1111-1111-1111-111111111111', 'new', 'Novo', 0);

-- ── 1. seller válido com membership SELLER é aceito ─────────────────────
select lives_ok(
  $$insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id)
    values ('s19Seller1', 'd1eeeeee-1111-1111-1111-111111111111', 'Seller D1 Um', 'S19-1',
            'd1000000-0000-0000-0000-000000000001', 'd1c00000-0000-0000-0000-000000000001')$$,
  '1: seller valido com membership SELLER e aceito');

-- ── dois sellers com memberships DIFERENTES são aceitos (mesma empresa) ─
select lives_ok(
  $$insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id)
    values ('s19Seller2', 'd1eeeeee-1111-1111-1111-111111111111', 'Seller D1 Dois', 'S19-2',
            'd1000000-0000-0000-0000-000000000002', 'd1c00000-0000-0000-0000-000000000002')$$,
  'dois sellers com memberships diferentes sao aceitos');

-- ── memberships de empresas diferentes permanecem isoladas (seller de
--    outra empresa, outra membership, tambem aceito sem conflito) ───────
select lives_ok(
  $$insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id)
    values ('s19SellerD2', 'd2eeeeee-2222-2222-2222-222222222222', 'Seller D2 Um', 'S19-D2',
            'd2000000-0000-0000-0000-000000000001', 'd2c00000-0000-0000-0000-000000000001')$$,
  'seller de empresa diferente, membership diferente, aceito sem conflito (isolamento entre empresas)');

-- ── historico: lead da empresa D1 apontando para s19Seller1 (usado para
--    provar mais abaixo que autoria/atribuicao historica nao muda) ──────
insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id, created_by_profile_id)
values (
  'd1a00000-0000-0000-0000-000000000001', 'd1eeeeee-1111-1111-1111-111111111111',
  'Lead Historico D1', '11999990000', 'Onix', 'd1500000-0000-0000-0000-000000000001',
  's19Seller1', 'd1000000-0000-0000-0000-000000000001'
);

-- ── 2. helper continua retornando o seller correto no estado valido
--    (antes de qualquer desativacao) ────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.current_profile_seller_id_for_company('d1eeeeee-1111-1111-1111-111111111111'), 's19Seller1',
  'helper current_profile_seller_id_for_company retorna o seller correto no estado valido');
reset role;

-- ── 3. segundo seller apontando para a MESMA membership e negado, e o
--    erro vem da constraint UNIQUE (23505), nao do trigger de consistencia
--    (que passaria: profile_id/role/empresa continuam corretos) ────────
select throws_ok(
  $$insert into public.sellers (id, company_id, name, first_name, profile_id, membership_id)
    values ('s19Seller1Dup', 'd1eeeeee-1111-1111-1111-111111111111', 'Seller D1 Duplicado', 'S19-Dup',
            'd1000000-0000-0000-0000-000000000001', 'd1c00000-0000-0000-0000-000000000001')$$,
  '23505', null,
  '2: segundo seller para a mesma membership e negado, erro 23505 (unique_violation)');

-- ── a constraint responsavel e sellers_membership_id_uidx, tipo UNIQUE ──
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.sellers'::regclass and contype = 'u' and conname = 'sellers_membership_id_uidx'),
  1, 'constraint sellers_membership_id_uidx existe e e do tipo UNIQUE');

-- ── seller existente nao muda de ID apos a tentativa negada ─────────────
select is(
  (select id from public.sellers where membership_id = 'd1c00000-0000-0000-0000-000000000001'),
  's19Seller1', 'seller existente nao muda de ID apos a tentativa de duplicidade negada');

-- ── leads continuam apontando para o mesmo seller apos a tentativa
--    negada (nenhuma reatribuicao silenciosa) ──────────────────────────
select is(
  (select seller_id from public.leads where id = 'd1a00000-0000-0000-0000-000000000001'),
  's19Seller1', 'lead continua apontando para o mesmo seller apos a tentativa de duplicidade negada');

-- ── 4. multiplos sellers com membership_id NULL continuam permitidos
--    durante a transicao (PostgreSQL trata cada NULL como distinto numa
--    constraint UNIQUE comum, sem NULLS NOT DISTINCT) ──────────────────
select lives_ok(
  $$insert into public.sellers (id, company_id, name, first_name)
    values ('s19SellerNull1', 'd1eeeeee-1111-1111-1111-111111111111', 'Seller Sem Membership 1', 'S19-N1')$$,
  'primeiro seller com membership_id NULL e aceito');
select lives_ok(
  $$insert into public.sellers (id, company_id, name, first_name)
    values ('s19SellerNull2', 'd1eeeeee-1111-1111-1111-111111111111', 'Seller Sem Membership 2', 'S19-N2')$$,
  'segundo seller com membership_id NULL tambem e aceito (UNIQUE comum permite multiplos NULL)');
select is(
  (select count(*)::int from public.sellers where company_id = 'd1eeeeee-1111-1111-1111-111111111111' and membership_id is null),
  2, 'exatamente 2 sellers com membership_id NULL coexistem sem violar a constraint');

-- ── 5. catch-up nao gera duplicidade: dois sellers "legados" com o MESMO
--    profile_id (cenario real que o backfill nao consegue distinguir com
--    seguranca) — a logica de catch-up (copia fiel de m1f_s2_01) tentaria
--    atribuir a MESMA membership a ambos; a constraint aborta a operacao
--    inteira em vez de deixar a segunda linha roubar/duplicar a
--    atribuicao da primeira ──────────────────────────────────────────────
insert into public.sellers (id, company_id, name, first_name, profile_id) values
  ('s19CatchupDup1', 'd1eeeeee-1111-1111-1111-111111111111', 'Catchup Dup 1', 'CD1', 'd1000000-0000-0000-0000-000000000001'),
  ('s19CatchupDup2', 'd1eeeeee-1111-1111-1111-111111111111', 'Catchup Dup 2', 'CD2', 'd1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$update public.sellers s
    set membership_id = cm.id
    from public.company_memberships cm
    where s.profile_id is not null
      and s.company_id is not null
      and cm.company_id = s.company_id
      and cm.profile_id = s.profile_id
      and cm.role = 'seller'
      and s.membership_id is null
      and s.id in ('s19CatchupDup1', 's19CatchupDup2')$$,
  '23505', null,
  '3: catch-up sobre dois sellers do mesmo profile_id e abortado pela constraint (nao duplica silenciosamente)');
-- os dois seguem sem membership_id (a UPDATE inteira foi revertida)
select is(
  (select count(*)::int from public.sellers where id in ('s19CatchupDup1', 's19CatchupDup2') and membership_id is null),
  2, 'catch-up abortado nao deixa nenhum dos dois sellers com membership_id parcialmente atribuido');
delete from public.sellers where id in ('s19CatchupDup1', 's19CatchupDup2');

-- ── 6. desativar membership nao remove o seller (nunca DELETE, so
--    is_active muda — mesmo principio de nao-destrutividade do §6.3) ────
update public.company_memberships set is_active = false where id = 'd1c00000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.sellers where membership_id = 'd1c00000-0000-0000-0000-000000000001'),
  1, 'desativar a membership nao remove o seller (linha continua existindo)');
select is(
  (select id from public.sellers where membership_id = 'd1c00000-0000-0000-0000-000000000001'),
  's19Seller1', 'seller mantem o mesmo ID apos a membership ser desativada');

-- ── 7. excluir membership ainda referenciada por um seller continua
--    negado (RESTRICT de sellers_membership_company_fk, m1f_s1_01 —
--    inalterado por esta migration) ─────────────────────────────────────
select throws_ok(
  $$delete from public.company_memberships where id = 'd1c00000-0000-0000-0000-000000000001'$$,
  '23503', null,
  'excluir membership ainda referenciada por um seller continua negado (FK RESTRICT)');

-- ── 8. nenhum Super Admin e criado por nenhuma operacao deste arquivo ───
select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  0, 'nenhum profile e SUPER_ADMIN apos os testes de unicidade');

-- ── 9. nenhuma autoria historica e alterada (created_by_profile_id do
--    lead permanece o profile original, do inicio ao fim do arquivo) ────
select is(
  (select created_by_profile_id from public.leads where id = 'd1a00000-0000-0000-0000-000000000001'),
  'd1000000-0000-0000-0000-000000000001'::uuid,
  'autoria historica do lead (created_by_profile_id) permanece inalterada');

select * from finish();
rollback;
