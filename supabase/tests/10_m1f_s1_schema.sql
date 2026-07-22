-- M1-F S1 — testes de schema (pgTAP): platform_role, company_role,
-- company_memberships, sellers.membership_id, preservação das colunas
-- legadas e das FKs de autoria histórica. Roda como postgres dentro de uma
-- transação com rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── enums ───────────────────────────────────────────────────────────────
select has_enum('public', 'platform_role'::name);
select enum_has_labels('public', 'platform_role', array['super_admin']);
select has_enum('public', 'company_role'::name);
select enum_has_labels('public', 'company_role', array['manager','seller']);

-- ── profiles.platform_role ──────────────────────────────────────────────
-- col_type_is já prova a existência da coluna (falharia se não existisse);
-- pgTAP não tem uma função has_column(schema,table,column) de 3 args nesta
-- versão (só (table,column), (table,column,desc) e
-- (schema,table,column,desc)) — evitado aqui para não arriscar a
-- interpretação errada dos argumentos.
select col_type_is('public'::name, 'profiles'::name, 'platform_role'::name, 'platform_role');
select col_is_null('public'::name, 'profiles'::name, 'platform_role'::name);
select is(
  (select count(*)::int from public.profiles where platform_role is not null),
  0, 'nenhum profile existente (seedado) tem platform_role preenchido');

-- ── company_memberships: existe, colunas exatas, tipos, nulabilidade ────
select has_table('public'::name, 'company_memberships'::name);
select columns_are('public'::name, 'company_memberships'::name, array[
  'id','company_id','profile_id','role','is_active','invited_at','joined_at','created_at','updated_at'
]);
select col_type_is('public'::name, 'company_memberships'::name, 'id'::name, 'uuid');
select col_type_is('public'::name, 'company_memberships'::name, 'company_id'::name, 'uuid');
select col_type_is('public'::name, 'company_memberships'::name, 'profile_id'::name, 'uuid');
select col_type_is('public'::name, 'company_memberships'::name, 'role'::name, 'company_role');
select col_type_is('public'::name, 'company_memberships'::name, 'is_active'::name, 'boolean');
select col_type_is('public'::name, 'company_memberships'::name, 'invited_at'::name, 'timestamp with time zone');
select col_type_is('public'::name, 'company_memberships'::name, 'joined_at'::name, 'timestamp with time zone');
select col_not_null('public'::name, 'company_memberships'::name, 'company_id'::name);
select col_not_null('public'::name, 'company_memberships'::name, 'profile_id'::name);
select col_not_null('public'::name, 'company_memberships'::name, 'role'::name);
select col_not_null('public'::name, 'company_memberships'::name, 'is_active'::name);
select col_is_null('public'::name, 'company_memberships'::name, 'invited_at'::name);
select col_is_null('public'::name, 'company_memberships'::name, 'joined_at'::name);
select col_default_is('public'::name, 'company_memberships'::name, 'is_active'::name, 'true'::text, 'is_active default true');

-- Sem status enum, sem created_by/updated_by_profile_id: não fazem parte
-- do schema aprovado em docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §6.2
-- — columns_are() acima já garante isso (falharia se sobrasse ou faltasse
-- qualquer coluna).

-- ── índices ─────────────────────────────────────────────────────────────
select has_index('public'::name, 'company_memberships'::name, 'company_memberships_company_id_idx'::name);
select has_index('public'::name, 'company_memberships'::name, 'company_memberships_profile_id_idx'::name);
select has_index('public'::name, 'company_memberships'::name, 'company_memberships_profile_single_active_uidx'::name);

-- ── uniques compostas (2: (company_id,id) — alvo da FK de
--    sellers.membership_id — e (company_id,profile_id) — identificação
--    única do vínculo. Sem unique(company_id,id,profile_id): auditoria
--    pós-implementação confirmou que nada a referenciava — a
--    correspondência de profile_id é garantida pelo trigger de sellers, não
--    por FK de 3 colunas; removida por não ter uso real) ─────────────────
select is(
  (select count(*)::int from pg_constraint where conrelid='public.company_memberships'::regclass and contype='u'),
  2, '2 unique constraints em company_memberships (sem redundância)');

-- ── triggers de integridade bidirecional (correção pós-auditoria) ───────
select has_trigger('public'::name, 'company_memberships'::name, 'company_memberships_set_updated_at'::name);
select has_trigger('public'::name, 'company_memberships'::name, 'company_memberships_check_mutation_ck'::name);
select has_trigger('public'::name, 'sellers'::name, 'sellers_membership_consistency_ck'::name);

-- ── RLS habilitada, zero policy, ACL determinística (postura fechada) ───
-- Não confia em information_schema.role_table_grants sozinho (não captura
-- privilégio herdado por membership de role) nem em defaults implícitos da
-- CLI local/projeto remoto — usa has_table_privilege(), a função nativa do
-- Postgres que resolve o privilégio EFETIVO real (inclusive herdado),
-- exatamente como o planejador de queries decide. Auditada explicitamente
-- para public, anon e authenticated, nos 7 privilégios de tabela do
-- Postgres 17 (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER;
-- MAINTAIN existe a partir do PG 17 mas não é usado neste projeto — REVOKE
-- ALL na migration já cobre todos os privilégios, presentes e futuros, sem
-- precisar listá-los).
select is(
  (select relrowsecurity from pg_class where oid = 'public.company_memberships'::regclass),
  true, 'RLS habilitada em company_memberships');

-- CORREÇÃO (M1-F S4-F1, aprovada explicitamente pelo usuário): este arquivo
-- (S1) originalmente esperava ZERO policies em company_memberships — correto
-- na época (S1 é só schema; S2 definiria as policies "definitivas" para o
-- consumo do M1-E/M1-C via can_access_company/is_manager_or_platform, ainda
-- não escrito). O S4-F1 introduziu um consumidor REAL e diferente — o
-- próprio frontend resolvendo a própria membership ativa para
-- canManageInvites() — não antecipado nem pelo S1 nem pelo S2. A asserção
-- abaixo foi atualizada para validar o contrato EXATO aprovado nessa etapa
-- (nome, comando, permissividade, roles e expressão USING), não só a
-- contagem — continua provando que NENHUMA outra policy além desta foi
-- adicionada por engano.
select is(
  (select count(*)::int from pg_policies where schemaname='public' and tablename='company_memberships'),
  1, 'company_memberships tem EXATAMENTE 1 policy (M1-F S4-F1 — nenhuma outra foi adicionada além da leitura própria)');
select is(
  (select policyname::text from pg_policies where schemaname='public' and tablename='company_memberships'),
  'company_memberships_select_own', 'a única policy tem o nome exato criado pelo S4-F1: company_memberships_select_own');
select is(
  (select cmd::text from pg_policies where schemaname='public' and tablename='company_memberships' and policyname='company_memberships_select_own'),
  'SELECT', 'company_memberships_select_own é para o comando SELECT — nenhum INSERT/UPDATE/DELETE habilitado por policy');
select is(
  (select permissive::text from pg_policies where schemaname='public' and tablename='company_memberships' and policyname='company_memberships_select_own'),
  'PERMISSIVE', 'company_memberships_select_own é PERMISSIVE (nunca RESTRICTIVE)');
select is(
  (select roles from pg_policies where schemaname='public' and tablename='company_memberships' and policyname='company_memberships_select_own'),
  array['authenticated']::name[], 'company_memberships_select_own se aplica exclusivamente a authenticated, nunca a anon/public');
select is(
  (select qual from pg_policies where schemaname='public' and tablename='company_memberships' and policyname='company_memberships_select_own'),
  '(profile_id = auth.uid())', 'USING exige profile_id = auth.uid() — nenhuma linha de outro usuário pode satisfazer essa condição, nenhuma linha de outra empresa por tabela alguma');
select is(
  (select with_check from pg_policies where schemaname='public' and tablename='company_memberships' and policyname='company_memberships_select_own'),
  null::text, 'policy de SELECT não tem WITH CHECK (cláusula não se aplica a SELECT)');

-- Grants por coluna do S4-F1: authenticated tem SELECT exatamente nas 3
-- colunas mínimas (company_id/role/is_active) que canManageInvites()
-- precisa — nunca id/profile_id/invited_at/joined_at/created_at/updated_at,
-- nunca INSERT/UPDATE/DELETE, nunca nada para anon.
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.role_column_grants
    where table_schema='public' and table_name='company_memberships'
      and grantee='authenticated' and privilege_type='SELECT'),
  (select array_agg(c order by c) from unnest(array['company_id','is_active','role']) as c),
  'authenticated tem SELECT exatamente em company_id/is_active/role, nunca id/profile_id/invited_at/joined_at/created_at/updated_at');
select is(
  (select count(*)::int from information_schema.role_column_grants
    where table_schema='public' and table_name='company_memberships' and grantee='anon' and privilege_type='SELECT'),
  0, 'anon continua sem SELECT em nenhuma coluna de company_memberships');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='company_memberships'
      and grantee='authenticated' and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'nenhum INSERT/UPDATE/DELETE foi concedido a authenticated em company_memberships pelo S4-F1');

select is(
  (select array_agg(priv order by priv) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where has_table_privilege('public', 'public.company_memberships', priv)),
  null::text[], 'role public: zero dos 7 privilegios de tabela em company_memberships');
select is(
  (select array_agg(priv order by priv) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where has_table_privilege('anon', 'public.company_memberships', priv)),
  null::text[], 'role anon: zero dos 7 privilegios de tabela em company_memberships');
select is(
  (select array_agg(priv order by priv) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as priv
    where has_table_privilege('authenticated', 'public.company_memberships', priv)),
  null::text[], 'role authenticated: zero dos 7 privilegios de tabela em company_memberships');

-- Sequence associada ao id: não existe — id é uuid com default
-- gen_random_uuid(), não identity/serial. pg_get_serial_sequence() retorna
-- NULL nesse caso; a auditoria de USAGE/SELECT/UPDATE de sequence pedida
-- nesta etapa é estruturalmente inaplicável aqui (não há objeto sequence a
-- proteger), confirmado explicitamente em vez de simplesmente omitido.
select is(
  pg_get_serial_sequence('public.company_memberships', 'id'),
  null::text, 'company_memberships.id nao usa sequence (uuid default gen_random_uuid, sem identity/serial)');

-- owner (postgres) mantém capacidade administrativa normal — nenhuma das
-- revogações acima o afeta (REVOKE ALL FROM public/anon/authenticated
-- nunca inclui o owner da tabela).
select is(
  (select tableowner from pg_tables where schemaname='public' and tablename='company_memberships'),
  'postgres', 'owner de company_memberships continua postgres, com capacidade administrativa plena');

-- ── tentativas reais de DML como authenticated e anon (não só leitura de
--    catálogo) — mesmo padrão de 01_m1e_grants_rls.sql ─────────────────
set local role anon;
select throws_ok($$select count(*) from public.company_memberships$$, '42501', null, 'anon: SELECT direto em company_memberships falha');
select throws_ok($$insert into public.company_memberships (company_id, profile_id, role) values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'manager')$$, '42501', null, 'anon: INSERT direto em company_memberships falha');
select throws_ok($$update public.company_memberships set is_active = false$$, '42501', null, 'anon: UPDATE direto em company_memberships falha');
select throws_ok($$delete from public.company_memberships$$, '42501', null, 'anon: DELETE direto em company_memberships falha');
reset role;

-- ATUALIZAÇÃO (M1-F S4-F1, aprovada explicitamente): SELECT direto de
-- company_memberships por authenticated não falha mais por completo — a
-- policy company_memberships_select_own deixa cada ator ler a PRÓPRIA linha
-- (seed.sql: o admin legado tem membership própria, role=manager,
-- is_active=true), então a consulta sem filtro retorna 1, nunca lança.
-- INSERT/UPDATE/DELETE continuam sem nenhum grant e seguem falhando.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.company_memberships), 1, 'authenticated (admin legado): SELECT direto em company_memberships devolve so a propria linha (S4-F1)');
select throws_ok($$insert into public.company_memberships (company_id, profile_id, role) values ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'manager')$$, '42501', null, 'authenticated (admin legado): INSERT direto em company_memberships falha');
select throws_ok($$update public.company_memberships set is_active = false$$, '42501', null, 'authenticated (admin legado): UPDATE direto em company_memberships falha');
select throws_ok($$delete from public.company_memberships$$, '42501', null, 'authenticated (admin legado): DELETE direto em company_memberships falha');
reset role;

-- ── sellers.membership_id ───────────────────────────────────────────────
select col_type_is('public'::name, 'sellers'::name, 'membership_id'::name, 'uuid');
select col_is_null('public'::name, 'sellers'::name, 'membership_id'::name);

-- ── colunas legadas preservadas (migration é aditiva/compatível) ────────
-- col_type_is prova existência + tipo em uma única asserção (mesmo motivo
-- de não usar has_column citado acima).
select col_type_is('public'::name, 'sellers'::name, 'profile_id'::name, 'uuid');
select col_type_is('public'::name, 'sellers'::name, 'company_id'::name, 'uuid');
select col_type_is('public'::name, 'profiles'::name, 'company_id'::name, 'uuid');
select col_type_is('public'::name, 'profiles'::name, 'role'::name, 'user_role');
select col_type_is('public'::name, 'profiles'::name, 'seller_id'::name, 'text');
select col_type_is('public'::name, 'profiles'::name, 'is_active'::name, 'boolean');
select has_enum('public', 'user_role'::name);
select enum_has_labels('public', 'user_role', array['admin','manager','seller']);

-- ── autoria histórica continua apontando direto para profiles (nunca para
--    company_memberships nem sellers) — design §6.3, §9 do prompt ────────
select fk_ok('public', 'leads', array['company_id','created_by_profile_id'],
             'public', 'profiles', array['company_id','id'],
             'leads.created_by_profile_id ainda referencia profiles diretamente');
select fk_ok('public', 'leads', array['company_id','updated_by_profile_id'],
             'public', 'profiles', array['company_id','id'],
             'leads.updated_by_profile_id ainda referencia profiles diretamente');
select fk_ok('public', 'lead_timeline_entries', array['company_id','actor_profile_id'],
             'public', 'profiles', array['company_id','id'],
             'lead_timeline_entries.actor_profile_id ainda referencia profiles diretamente');
select fk_ok('public', 'leads', array['company_id','seller_id'],
             'public', 'sellers', array['company_id','id'],
             'leads.seller_id ainda referencia sellers diretamente (nao redirecionado para membership)');

select * from finish();
rollback;
