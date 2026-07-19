-- M1-E E1 — testes de concorrência com DUAS CONEXÕES REAIS via dblink.
-- Coordenação determinística por locks de linha (READ COMMITTED re-check):
-- a conexão 2 dispara a operação de forma assíncrona, bloqueia no lock da
-- linha aberto pela conexão 1, e só prossegue quando a 1 comita — sem
-- nenhuma espera arbitrária. O resultado é o mesmo em qualquer
-- interleaving: a precondition de version impede sobrescrita silenciosa.
-- Conexão local do próprio Postgres da stack (credencial default de dev).
-- Escritas via dblink são commitadas fora da transação do teste — o
-- cleanup explícito no final remove as fixtures.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select * from no_plan();

-- ── fixtures commitadas (conexão c0, postgres) ──────────────────────────
select dblink_connect('c0', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select dblink_exec('c0', $f$
  insert into public.leads (id, company_id, name, phone, car, stage_id, seller_id) values
    ('ee000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Conc Upd', '(11) 90000-0091', 'C1',
     (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4'),
    ('ee000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Conc Asg', '(11) 90000-0092', 'C2',
     (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), null),
    ('ee000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Conc Arc', '(11) 90000-0093', 'C3',
     (select id from public.pipeline_stages where company_id='00000000-0000-0000-0000-000000000001' and code='new'), 's4')
$f$);

-- ═══ Cenário 1: update_lead — segunda conexão recebe stale_write ════════
select dblink_connect('c1', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select dblink_connect('c2', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select * from dblink('c1', $c$select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false)$c$) as t(x text);
select dblink_exec('c1', 'set role authenticated');
select * from dblink('c2', $c$select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)$c$) as t(x text);
select dblink_exec('c2', 'set role authenticated');

select dblink_exec('c1', 'begin');
select * from dblink('c1', $c$select v.version from public.update_lead('ee000000-0000-0000-0000-000000000001', 1, 'Editado pela conexao 1', '(11) 90000-0091', 'C1') v$c$) as t(v integer);
-- conexão 2 tenta com a MESMA versão 1; bloqueia no lock da linha
select ok((select dblink_send_query('c2', $c$select v.version from public.update_lead('ee000000-0000-0000-0000-000000000001', 1, 'Editado pela conexao 2', '(11) 90000-0091', 'C2') v$c$) = 1), 'conexao 2 despachada');
select dblink_exec('c1', 'commit');
select throws_like(
  $$select * from dblink_get_result('c2') as t(v integer)$$,
  '%stale_write%',
  'update concorrente: conexao 2 recebe stale_write apos o commit da conexao 1');
select is((select name from public.leads where id = 'ee000000-0000-0000-0000-000000000001'),
  'Editado pela conexao 1', 'nenhuma sobrescrita silenciosa no update');
select dblink_disconnect('c1');
select dblink_disconnect('c2');

-- ═══ Cenário 2: assign_lead_seller — sem reatribuição silenciosa ════════
select dblink_connect('c1', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select dblink_connect('c2', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select * from dblink('c1', $c$select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false)$c$) as t(x text);
select dblink_exec('c1', 'set role authenticated');
select * from dblink('c2', $c$select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)$c$) as t(x text);
select dblink_exec('c2', 'set role authenticated');

select dblink_exec('c1', 'begin');
select * from dblink('c1', $c$select v.seller_id from public.assign_lead_seller('ee000000-0000-0000-0000-000000000002', 's1', 1) v$c$) as t(s text);
select ok((select dblink_send_query('c2', $c$select v.seller_id from public.assign_lead_seller('ee000000-0000-0000-0000-000000000002', 's2', 1) v$c$) = 1), 'conexao 2 despachada (assign)');
select dblink_exec('c1', 'commit');
select throws_like(
  $$select * from dblink_get_result('c2') as t(s text)$$,
  '%stale_write%',
  'assign concorrente: conexao 2 recebe stale_write');
select is((select seller_id from public.leads where id = 'ee000000-0000-0000-0000-000000000002'),
  's1', 'nenhuma reatribuicao silenciosa');
select dblink_disconnect('c1');
select dblink_disconnect('c2');

-- ═══ Cenário 3: archive_lead — idempotência sob o lock (FOR UPDATE) ═════
select dblink_connect('c1', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select dblink_connect('c2', format('host=%s port=5432 dbname=postgres user=postgres password=postgres', host(inet_server_addr())));
select * from dblink('c1', $c$select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false)$c$) as t(x text);
select dblink_exec('c1', 'set role authenticated');
select * from dblink('c2', $c$select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false)$c$) as t(x text);
select dblink_exec('c2', 'set role authenticated');

select dblink_exec('c1', 'begin');
select * from dblink('c1', $c$select v.version from public.archive_lead('ee000000-0000-0000-0000-000000000003', 1) v$c$) as t(v integer);
-- conexão 2 chega com a versão que ficou antiga; bloqueia no FOR UPDATE
select ok((select dblink_send_query('c2', $c$select v.version, v.archived_at from public.archive_lead('ee000000-0000-0000-0000-000000000003', 1) v$c$) = 1), 'conexao 2 despachada (archive)');
select dblink_exec('c1', 'commit');
create temp table t_conc_ar as
  select * from dblink_get_result('c2') as t(v integer, archived timestamptz);
select is((select v from t_conc_ar), 2,
  'archive concorrente: estado ja alcancado retorna SEM novo bump, mesmo com versao antiga');
select ok((select archived from t_conc_ar) is not null,
  'archive concorrente: caminho idempotente devolve a linha arquivada, sem stale_write');
select dblink_disconnect('c1');
select dblink_disconnect('c2');

-- ── cleanup das fixtures commitadas ─────────────────────────────────────
select dblink_exec('c0', $f$delete from public.leads where id in (
  'ee000000-0000-0000-0000-000000000001',
  'ee000000-0000-0000-0000-000000000002',
  'ee000000-0000-0000-0000-000000000003')$f$);
select dblink_disconnect('c0');

select * from finish();
rollback;
