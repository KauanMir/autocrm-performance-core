-- M1-F S3-A — testes do backend de criação e listagem de empresas
-- (pgTAP): create_company(), os 5 pipeline_stages padrão, e a RLS de
-- leitura de companies via can_access_company() (m1f_s3a). Roda como
-- postgres (fixtures) e authenticated/anon (comportamento real via SET
-- ROLE + request.jwt.claims). Reaproveita os 4 usuários seedados
-- (11111111 ADMIN legado, 22222222 MANAGER, 33333333/44444444 SELLER) da
-- company seedada '00000000-...-0001' para os testes de autorização
-- negativa. Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── fixture: Super Admin temporário só para este teste (como postgres,
--    fora de qualquer caminho de authenticated/anon — nao e autopromocao,
--    mesmo padrao ja usado em 16_m1f_s2_helpers.sql/20_m1f_s11). Revertido
--    pelo rollback do arquivo. ─────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'f9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'f9superadmin@test.local', now(), now(), now());
insert into public.profiles (id, company_id, name, email, role, is_active) values
  ('f9000000-0000-0000-0000-000000000001', null, 'F9 SuperAdmin (fixture)', 'f9superadmin@test.local', 'seller', true);
update public.profiles set platform_role = 'super_admin' where id = 'f9000000-0000-0000-0000-000000000001';

-- ═══════════════════════════════════════════════════════════════════════
-- AUTORIZAÇÃO
-- ═══════════════════════════════════════════════════════════════════════

set local role anon;
select throws_ok(
  $$select public.create_company('Empresa Anon')$$,
  '42501', null, 'anon nao executa create_company');
reset role;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_company('Empresa Seller')$$,
  '42501', null, 'Seller nao cria company');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_company('Empresa Manager')$$,
  '42501', null, 'Manager nao cria company');
reset role;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_company('Empresa Admin Legado')$$,
  '42501', null, 'ADMIN legado (platform_role null) nao cria company');
reset role;

-- authenticated sem NENHUM profile correspondente (auth.uid() nao resolve
-- nenhuma linha em profiles) tambem e negado — is_platform_super_admin()
-- ja falha fechado para esse caso (m1f_s2_02), reforcado aqui no contexto
-- de create_company especificamente
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_company('Empresa Sem Profile')$$,
  '42501', null, 'authenticated sem profile correspondente nao cria company');
reset role;

-- nenhuma das tentativas negadas acima criou nenhuma linha
select is(
  (select count(*)::int from public.companies where name in ('Empresa Anon', 'Empresa Seller', 'Empresa Manager', 'Empresa Admin Legado', 'Empresa Sem Profile')),
  0, 'nenhuma tentativa negada de create_company criou uma company parcial');

-- ═══════════════════════════════════════════════════════════════════════
-- CRIAÇÃO (Super Admin)
-- ═══════════════════════════════════════════════════════════════════════

select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_company('Empresa Nova S3A', 'Nome Fantasia S3A', '11.222.333/0001-44', '(11) 4000-0000', 'America/Sao_Paulo')$$,
  'Super Admin cria company com todos os campos');
reset role;

select is((select count(*)::int from public.companies where name = 'Empresa Nova S3A'), 1, 'exatamente 1 company criada com o nome esperado');
select is((select trade_name from public.companies where name = 'Empresa Nova S3A'), 'Nome Fantasia S3A', 'trade_name gravado corretamente');
select is((select cnpj from public.companies where name = 'Empresa Nova S3A'), '11.222.333/0001-44', 'cnpj gravado corretamente, sem normalizacao');
select is((select phone from public.companies where name = 'Empresa Nova S3A'), '(11) 4000-0000', 'phone gravado corretamente');
select is((select timezone from public.companies where name = 'Empresa Nova S3A'), 'America/Sao_Paulo', 'timezone gravado corretamente');
select is((select status::text from public.companies where name = 'Empresa Nova S3A'), 'implantacao', 'status sempre implantacao no create (nunca parametro)');
select is((select created_by_profile_id from public.companies where name = 'Empresa Nova S3A'), 'f9000000-0000-0000-0000-000000000001'::uuid, 'created_by_profile_id e sempre auth.uid() do Super Admin real');

-- argumentos nomeados fora de ordem (forma como o PostgREST/frontend
-- futuro pode chamar via supabase.rpc('create_company', {...})) —
-- confirma que a assinatura resolve corretamente por nome, nao por
-- posicao
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company(p_cnpj := '22.333.444/0001-55', p_name := 'Empresa Named Args', p_phone := '(21) 5000-0000')$$,
  'create_company aceita argumentos nomeados fora de ordem');
reset role;
select is((select name from public.companies where cnpj = '22.333.444/0001-55'), 'Empresa Named Args', 'company criada via argumentos nomeados tem os valores corretos nos campos certos (nao trocados por posicao)');
select is((select phone from public.companies where cnpj = '22.333.444/0001-55'), '(21) 5000-0000', 'phone correto via argumento nomeado');

-- timezone default quando omitido
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company('Empresa Timezone Default')$$,
  'Super Admin cria company omitindo trade_name/cnpj/phone/timezone');
reset role;
select is((select timezone from public.companies where name = 'Empresa Timezone Default'), 'America/Sao_Paulo', 'timezone recebe o default America/Sao_Paulo quando omitido');
select is((select trade_name from public.companies where name = 'Empresa Timezone Default'), null::text, 'trade_name permanece NULL quando omitido');
select is((select cnpj from public.companies where name = 'Empresa Timezone Default'), null::text, 'cnpj permanece NULL quando omitido');

-- string vazia e aceita como veio, sem normalizacao para NULL (decisao
-- documentada na migration: nenhuma normalizacao sem exigencia do design)
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company('Empresa String Vazia', '')$$,
  'Super Admin cria company com trade_name como string vazia');
reset role;
select is((select trade_name from public.companies where name = 'Empresa String Vazia'), '', 'trade_name string vazia e gravada como veio (nao normalizada para NULL)');

-- nenhuma membership/seller e criado para o Super Admin por causa do create
select is(
  (select count(*)::int from public.company_memberships where profile_id = 'f9000000-0000-0000-0000-000000000001'),
  0, 'Super Admin nao ganha nenhuma membership ao criar empresas');
select is(
  (select count(*)::int from public.sellers where profile_id = 'f9000000-0000-0000-0000-000000000001'),
  0, 'nenhum seller e criado para o Super Admin');

-- cnpj duplicado e permitido (decisao documentada: design nao aprova
-- unicidade de cnpj, §8 so define como opcional — nenhuma constraint
-- inventada sem exigencia)
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company('Empresa CNPJ Dup 1', null, '99.999.999/0001-99')$$,
  'primeira company com um dado CNPJ e aceita');
select lives_ok(
  $$select public.create_company('Empresa CNPJ Dup 2', null, '99.999.999/0001-99')$$,
  'segunda company com o MESMO CNPJ tambem e aceita (unicidade de cnpj nao e exigida pelo design)');
reset role;
select is(
  (select count(*)::int from public.companies where cnpj = '99.999.999/0001-99'),
  2, 'duas companies com o mesmo cnpj coexistem, por decisao de design (sem constraint inventada)');

-- ═══════════════════════════════════════════════════════════════════════
-- STAGES
-- ═══════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.pipeline_stages where company_id = (select id from public.companies where name = 'Empresa Nova S3A')),
  5, 'exatamente 5 pipeline_stages criados para a nova company');

select is(
  (select array_agg(code order by sort_order) from public.pipeline_stages where company_id = (select id from public.companies where name = 'Empresa Nova S3A')),
  array['new','qualified','visit_scheduled','negotiation','closing'],
  'codes dos 5 stages, na ordem exata (sort_order 0..4)');

select is(
  (select array_agg(name order by sort_order) from public.pipeline_stages where company_id = (select id from public.companies where name = 'Empresa Nova S3A')),
  array['Novo','Qualificado','Visita agendada','Em negociação','Fechamento'],
  'names dos 5 stages, exatos e na ordem correta');

select is(
  (select array_agg(is_terminal order by sort_order) from public.pipeline_stages where company_id = (select id from public.companies where name = 'Empresa Nova S3A')),
  array[false,false,false,false,true],
  'is_terminal correto: somente closing e terminal');

select is(
  (select count(distinct code)::int from public.pipeline_stages where company_id = (select id from public.companies where name = 'Empresa Nova S3A')),
  5, 'nenhum stage duplicado (5 codes distintos)');

-- duas empresas criadas tem dez stages no total, sem compartilhar IDs
-- (cada uma com seu proprio conjunto de 5, gerados pelo banco)
select is(
  (select count(*)::int from public.pipeline_stages
    where company_id in (
      (select id from public.companies where name = 'Empresa Nova S3A'),
      (select id from public.companies where name = 'Empresa Timezone Default')
    )),
  10, 'duas companies distintas somam exatamente 10 stages (5 cada), sem compartilhar linhas');
select is(
  (select count(distinct id)::int from public.pipeline_stages
    where company_id in (
      (select id from public.companies where name = 'Empresa Nova S3A'),
      (select id from public.companies where name = 'Empresa Timezone Default')
    )),
  10, 'os 10 stages tem IDs distintos entre si (nenhum compartilhado entre as duas companies)');

-- ── prova empirica de rollback real: uma falha forcada DURANTE a criacao
--    dos stages (apos a empresa ja ter sido inserida na mesma transacao)
--    precisa desfazer TAMBEM a empresa. Trigger criado e removido dentro
--    desta mesma transacao de teste (rollback ao final do arquivo desfaz
--    tudo de qualquer forma) — nao altera nenhuma migration, nao introduz
--    dependencia entre arquivos, nao relaxa nenhuma constraint real.
create function public.f21_test_only_fail_stage_trigger() returns trigger
language plpgsql as $$
begin
  if new.code = 'negotiation' then
    raise exception 'f21_test_only: falha forcada para provar rollback real';
  end if;
  return new;
end;
$$;
create trigger f21_test_only_fail_stage_trg
  before insert on public.pipeline_stages
  for each row execute function public.f21_test_only_fail_stage_trigger();

select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_company('Empresa Rollback Forcado')$$,
  'P0001', null, 'create_company com falha forcada no 4o stage (negotiation) retorna erro, nao sucesso parcial');
reset role;

drop trigger f21_test_only_fail_stage_trg on public.pipeline_stages;
drop function public.f21_test_only_fail_stage_trigger();

-- a empresa (inserida ANTES do stage que falhou, na mesma transacao) nao
-- permaneceu — prova que o rollback cobriu tambem o INSERT em companies,
-- nao so os stages
select is(
  (select count(*)::int from public.companies where name = 'Empresa Rollback Forcado'),
  0, 'apos a falha forcada no stage, a empresa NAO permaneceu criada (rollback real da transacao inteira)');
-- os 2 stages que tinham sido inseridos com sucesso ANTES da falha (new,
-- qualified) tambem nao permaneceram — nenhum stage parcial
select is(
  (select count(*)::int from public.pipeline_stages ps
    where not exists (select 1 from public.companies c where c.id = ps.company_id)),
  0, 'nenhum stage orfao (incluindo os que tinham sido inseridos com sucesso antes da falha) permaneceu apos o rollback forcado');

-- ═══════════════════════════════════════════════════════════════════════
-- VALIDAÇÕES
-- ═══════════════════════════════════════════════════════════════════════

select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.create_company('   ')$$,
  '23514', null, 'nome em branco (so espacos) e negado (companies_name_not_blank_ck)');
select throws_ok(
  $$select public.create_company(null)$$,
  '23502', null, 'nome NULL e negado (NOT NULL)');
reset role;

-- timezone: contrato aprovado em docs/M1-C-DESIGN.md §4.5
-- (Intl.DateTimeFormat(..., {timeZone: company.timezone})) exige um nome
-- IANA valido — validado deterministicamente contra o tzdata do proprio
-- servidor Postgres (sem rede)
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_company('Empresa TZ Valida', null, null, null, 'America/Bahia')$$,
  'timezone IANA valida (America/Bahia, diferente do default) e aceita');
select throws_ok(
  $$select public.create_company('Empresa TZ Invalida', null, null, null, 'Bogus/Nonexistent')$$,
  '22023', null, 'timezone invalida (fora do tzdata IANA) e negada (22023, determinístico, sem rede)');
reset role;
select is(
  (select count(*)::int from public.companies where name = 'Empresa TZ Invalida'),
  0, 'nenhuma company foi criada com a tentativa de timezone invalida');

-- nenhuma company/stage orfa foi criada pelas tentativas negadas acima
select is(
  (select count(*)::int from public.companies where btrim(coalesce(name, '')) = ''),
  0, 'nenhuma company com nome em branco existe apos as tentativas negadas');
select is(
  (select count(*)::int from public.pipeline_stages ps
    where not exists (select 1 from public.companies c where c.id = ps.company_id)),
  0, 'nenhum pipeline_stage orfao (sem company correspondente) apos as tentativas negadas');

-- assinatura: sem parametro de status/created_by/id/company_id/profile_id
-- (elimina mass assignment) — verificado no catalogo
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_company'),
  'p_name text, p_trade_name text DEFAULT NULL::text, p_cnpj text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_timezone text DEFAULT ''America/Sao_Paulo''::text',
  'create_company aceita exatamente os 5 parametros esperados, sem status/created_by_profile_id/id');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_company'
      and pg_get_function_arguments(p.oid) ilike '%status%'),
  0, 'create_company nao aceita status como parametro (nao pode ser forjado)');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_company'
      and (pg_get_function_arguments(p.oid) ilike '%created_by%' or pg_get_function_arguments(p.oid) ilike '%profile_id%')),
  0, 'create_company nao aceita created_by_profile_id como parametro (nao pode ser forjado)');

-- ═══════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════

-- anon nao tem SELECT grant em companies (so authenticated recebeu, nesta
-- migration) — a tentativa falha por permissao, nao retorna silenciosamente
-- zero linhas (RLS so filtra para quem ja tem o grant de tabela)
set local role anon;
select throws_ok(
  $$select count(*) from public.companies$$,
  '42501', null, 'anon nao consegue ler companies (sem GRANT SELECT de tabela)');
reset role;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.companies where id = '00000000-0000-0000-0000-000000000001'),
  1, 'Manager le a propria company (acessivel via can_access_company)');
select is(
  (select count(*)::int from public.companies where name = 'Empresa Nova S3A'),
  0, 'Manager NAO le uma company de outro Super Admin/onde nao tem membership');
-- consulta SEM filtro explicito: por este ponto do arquivo ja existem
-- varias outras companies criadas pelo Super Admin (Empresa Nova S3A,
-- Empresa Timezone Default, Empresa String Vazia, Empresa CNPJ Dup 1/2,
-- Empresa TZ Valida, Empresa Named Args) — um SELECT sem .eq() precisa
-- continuar retornando SOMENTE a propria company do Manager, provando que
-- a RLS (nao um filtro de aplicacao) e quem garante o isolamento
select is(
  (select count(*)::int from public.companies),
  1, 'SELECT sem filtro explicito retorna somente a company autorizada do Manager, mesmo havendo outras no banco');
reset role;

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.companies where id = '00000000-0000-0000-0000-000000000001'),
  1, 'Seller le a propria company (acessivel via can_access_company)');
reset role;

select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.companies where name = 'Empresa Nova S3A'),
  1, 'Super Admin le a company que acabou de criar');
reset role;

-- escrita direta continua negada em qualquer papel (criacao so via
-- create_company; UPDATE/DELETE seguem sem grant, mesmo padrao ja
-- validado em 20_m1f_s11_company_lifecycle.sql)
select set_config('request.jwt.claims', '{"sub":"f9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.companies (name) values ('Empresa Insert Direto')$$,
  '42501', null, 'INSERT direto em companies e negado mesmo para Super Admin (unica via e create_company)');
select throws_ok(
  $$update public.companies set name = 'Renomeada' where id = (select id from public.companies where name = 'Empresa Nova S3A')$$,
  '42501', null, 'UPDATE direto em companies e negado');
select throws_ok(
  $$delete from public.companies where name = 'Empresa Nova S3A'$$,
  '42501', null, 'DELETE direto em companies e negado');
reset role;

-- ═══════════════════════════════════════════════════════════════════════
-- SEGURANÇA
-- ═══════════════════════════════════════════════════════════════════════

select is(
  has_function_privilege('public', 'public.create_company(text,text,text,text,text)', 'EXECUTE'),
  false, 'PUBLIC sem EXECUTE em create_company');
select is(
  has_function_privilege('anon', 'public.create_company(text,text,text,text,text)', 'EXECUTE'),
  false, 'anon sem EXECUTE em create_company');
select is(
  has_function_privilege('authenticated', 'public.create_company(text,text,text,text,text)', 'EXECUTE'),
  true, 'authenticated com EXECUTE em create_company');

select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_company'
      and (p.proconfig @> array['search_path='] or p.proconfig @> array['search_path=""'])),
  1, 'create_company tem search_path vazio configurado');
select is(
  (select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_company'),
  true, 'create_company e SECURITY DEFINER (necessario: authenticated nao tem INSERT em companies)');

select hasnt_table('public'::name, 'super_admin_active_company'::name, 'super_admin_active_company continua nao existindo apos o S3-A');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('select_active_company', 'effective_company_id')),
  0, 'select_active_company()/effective_company_id() continuam nao existindo apos o S3-A');

-- nenhum Super Admin real alem da fixture deste arquivo (revertida pelo
-- rollback)
select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  1, 'exatamente 1 Super Admin (a fixture deste arquivo) apos todos os testes');

-- ═══════════════════════════════════════════════════════════════════════
-- COMPATIBILIDADE
-- ═══════════════════════════════════════════════════════════════════════

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('create_lead','update_lead','move_lead_to_stage',
    'apply_lead_event','assign_lead_seller','archive_lead','unarchive_lead',
    'add_lead_timeline_entry','check_lead_phone_duplicate')), 9, 'as 9 RPCs do M1-E continuam existindo, sem duplicata');

select has_function('public'::name, 'current_profile_company_id'::name, array[]::name[]);
select has_function('public'::name, 'current_profile_role'::name, array[]::name[]);
select has_function('public'::name, 'current_profile_seller_id'::name, array[]::name[]);
select has_function('public'::name, 'is_manager_or_admin'::name, array[]::name[]);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'leads'),
  1, 'policy de leads inalterada (1 policy)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lead_timeline_entries'),
  1, 'policy de lead_timeline_entries inalterada (1 policy)');

-- runtime legado continua operando leads normalmente
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select (public.create_lead('S3A Compat Teste', '(11) 90000-6666', 'Onix')).id$$,
  'SELLER legado (usuario seedado) ainda cria lead normalmente apos o S3-A');
reset role;

select * from finish();
rollback;
