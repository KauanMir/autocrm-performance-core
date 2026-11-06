-- WHATSAPP-W2B-8 — leitura da inbox: privilégios, isolamento e paginação (pgTAP).
-- Dados fictícios; rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── estrutura e privilégios ───────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('whatsapp_inbox_read_allowed', 'whatsapp_inbox_list_conversations', 'whatsapp_inbox_list_messages')
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  3, 'as três funções são SECURITY DEFINER com search_path fixo');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('whatsapp_inbox_read_allowed', 'whatsapp_inbox_list_conversations', 'whatsapp_inbox_list_messages')
     and p.provolatile = 's'),
  3, 'as três funções são STABLE: não escrevem');

select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated']) r,
        unnest(array[
          'public.whatsapp_inbox_read_allowed(uuid, uuid)',
          'public.whatsapp_inbox_list_conversations(uuid, uuid, integer, timestamptz, uuid)',
          'public.whatsapp_inbox_list_messages(uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid)']) f
   where has_function_privilege(r, f, 'EXECUTE')),
  0, 'anon e authenticated sem EXECUTE');

select ok(
  has_function_privilege('service_role', 'public.whatsapp_inbox_list_conversations(uuid, uuid, integer, timestamptz, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.whatsapp_inbox_list_messages(uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid)', 'EXECUTE'),
  'service_role executa as RPCs de leitura');

select ok(
  not has_function_privilege('service_role', 'public.whatsapp_inbox_read_allowed(uuid, uuid)', 'EXECUTE'),
  'portão é interno: service_role não executa direto');

select ok(
  not exists (
    select 1 from aclexplode(
      (select proacl from pg_proc where oid = 'public.whatsapp_inbox_list_messages(uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid)'::regprocedure)
    ) a where a.grantee = 0),
  'PUBLIC sem EXECUTE');

select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['public.whatsapp_contacts', 'public.whatsapp_conversations', 'public.whatsapp_messages']) t,
        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, t, p)),
  0, 'a W2B-8 não abre privilégio direto nas tabelas');

select ok(
  not exists (select 1 from pg_policies where tablename in ('whatsapp_contacts', 'whatsapp_conversations', 'whatsapp_messages')),
  'a W2B-8 não cria policy');

select ok(
  pg_get_function_result('public.whatsapp_inbox_list_conversations(uuid, uuid, integer, timestamptz, uuid)'::regprocedure)
    !~* '(hmac|bsuid|phone|waba|company_id|event_id)'
  and pg_get_function_result('public.whatsapp_inbox_list_messages(uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid)'::regprocedure)
    !~* '(hmac|bsuid|phone|waba|company_id|event_id)',
  'o retorno não traz HMAC, identificadores do contato ou da empresa');

-- ── fixtures (como dono das tabelas) ──────────────────────────────────────
insert into public.companies (id, name, status) values
  ('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'TEST COMPANY', 'ativa'),
  ('fa8eeeee-2222-4222-8222-222222222222', 'Concessionária simulada', 'ativa')
on conflict (id) do update set status = 'ativa';

insert into auth.users (id, email) values
  ('fa800000-0000-4000-8000-000000000001', 'sa-ativo@ficticio.test'),
  ('fa800000-0000-4000-8000-000000000002', 'sa-inativo@ficticio.test'),
  ('fa800000-0000-4000-8000-000000000003', 'comum@ficticio.test');

insert into public.profiles (id, name, email, is_active, platform_role) values
  ('fa800000-0000-4000-8000-000000000001', 'SA ativo', 'sa-ativo@ficticio.test', true, 'super_admin'),
  ('fa800000-0000-4000-8000-000000000002', 'SA inativo', 'sa-inativo@ficticio.test', false, 'super_admin'),
  ('fa800000-0000-4000-8000-000000000003', 'Comum', 'comum@ficticio.test', true, null)
on conflict (id) do update
  set is_active = excluded.is_active, platform_role = excluded.platform_role;

insert into public.whatsapp_connections
  (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at)
values
  ('fa8a0000-0000-4000-8000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '710000000000081', '810000000000081', 'v1.x.y.z', 'connected', now()),
  ('fa8a0000-0000-4000-8000-00000000000b', 'fa8eeeee-2222-4222-8222-222222222222', '710000000000082', '810000000000082', 'v1.x.y.z', 'connected', now());

create function pg_temp.add_message(
  p_company uuid, p_connection uuid, p_conversation uuid, p_contact uuid, p_seed text,
  p_occurred timestamptz, p_received timestamptz
) returns uuid language plpgsql as $$
declare v_event uuid; v_message uuid; v_hash text := encode(sha256(convert_to(p_seed, 'UTF8')), 'hex');
begin
  insert into public.whatsapp_webhook_events
    (company_id, connection_id, phone_number_id, event_kind, event_key, message_id_hash, message_type, processing_status, occurred_at, received_at)
  values
    (p_company, p_connection, (select phone_number_id from public.whatsapp_connections where id = p_connection), 'message',
     encode(sha256(convert_to('key' || p_seed, 'UTF8')), 'hex'), v_hash, 'text', 'received', p_occurred, p_received)
  returning id into v_event;

  insert into public.whatsapp_messages
    (company_id, connection_id, conversation_id, contact_id, event_id, direction, message_type, message_id_hash,
     content_ciphertext, content_key_version, occurred_at, received_at)
  values
    (p_company, p_connection, p_conversation, p_contact, v_event, 'inbound', 'text', v_hash,
     'v1.content.' || p_seed, 1, p_occurred, p_received)
  returning id into v_message;
  return v_message;
end $$;

insert into public.whatsapp_contacts
  (id, company_id, phone_hmac, hmac_key_version, pii_ciphertext, pii_ref, pii_key_version, pii_has_phone, pii_source_at)
values
  ('fa8c0000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', repeat('a', 64), 1, 'v1.pii.a', gen_random_uuid(), 1, true, now()),
  ('fa8c0000-0000-4000-8000-000000000002', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', repeat('b', 64), 1, 'v1.pii.b', gen_random_uuid(), 1, true, now()),
  ('fa8c0000-0000-4000-8000-000000000003', 'fa8eeeee-2222-4222-8222-222222222222', repeat('c', 64), 1, 'v1.pii.c', gen_random_uuid(), 1, true, now());

insert into public.whatsapp_conversations
  (id, company_id, connection_id, contact_id, first_message_at, last_message_at)
values
  ('fa8b0000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8a0000-0000-4000-8000-00000000000a',
   'fa8c0000-0000-4000-8000-000000000001', '2026-11-05 10:00:00+00', '2026-11-05 12:00:00+00'),
  ('fa8b0000-0000-4000-8000-000000000002', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8a0000-0000-4000-8000-00000000000a',
   'fa8c0000-0000-4000-8000-000000000002', '2026-11-05 09:00:00+00', '2026-11-05 09:00:00+00'),
  ('fa8b0000-0000-4000-8000-000000000003', 'fa8eeeee-2222-4222-8222-222222222222', 'fa8a0000-0000-4000-8000-00000000000b',
   'fa8c0000-0000-4000-8000-000000000003', '2026-11-05 13:00:00+00', '2026-11-05 13:00:00+00');

select pg_temp.add_message('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8a0000-0000-4000-8000-00000000000a',
  'fa8b0000-0000-4000-8000-000000000001', 'fa8c0000-0000-4000-8000-000000000001', 'antiga',
  '2026-11-05 10:00:00+00', '2026-11-05 10:00:01+00');
-- Mesmo segundo do WhatsApp: a ordem vem do recebimento.
select pg_temp.add_message('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8a0000-0000-4000-8000-00000000000a',
  'fa8b0000-0000-4000-8000-000000000001', 'fa8c0000-0000-4000-8000-000000000001', 'primeira-do-segundo',
  '2026-11-05 12:00:00+00', '2026-11-05 12:00:00.100+00');
select pg_temp.add_message('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8a0000-0000-4000-8000-00000000000a',
  'fa8b0000-0000-4000-8000-000000000001', 'fa8c0000-0000-4000-8000-000000000001', 'segunda-do-segundo',
  '2026-11-05 12:00:00+00', '2026-11-05 12:00:00.200+00');
select pg_temp.add_message('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8a0000-0000-4000-8000-00000000000a',
  'fa8b0000-0000-4000-8000-000000000002', 'fa8c0000-0000-4000-8000-000000000002', 'outro-contato',
  '2026-11-05 09:00:00+00', '2026-11-05 09:00:01+00');
select pg_temp.add_message('fa8eeeee-2222-4222-8222-222222222222', 'fa8a0000-0000-4000-8000-00000000000b',
  'fa8b0000-0000-4000-8000-000000000003', 'fa8c0000-0000-4000-8000-000000000003', 'da-concessionaria',
  '2026-11-05 13:00:00+00', '2026-11-05 13:00:01+00');

-- ── leitura autorizada ────────────────────────────────────────────────────
select is(
  (select array_agg(c.out_conversation_id::text) from public.whatsapp_inbox_list_conversations(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') c),
  array['fa8b0000-0000-4000-8000-000000000001', 'fa8b0000-0000-4000-8000-000000000002'],
  'lista só conversas da TEST COMPANY, da mais recente para a mais antiga');

select is(
  (select c.out_message_count from public.whatsapp_inbox_list_conversations(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 1) c),
  3::bigint, 'conta as mensagens da conversa');

select is(
  (select c.out_last_content_ciphertext from public.whatsapp_inbox_list_conversations(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 1) c),
  'v1.content.segunda-do-segundo', 'a prévia usa a última mensagem pela ordem de chegada');

select is(
  (select array_agg(m.out_content_ciphertext) from public.whatsapp_inbox_list_messages(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     'fa8b0000-0000-4000-8000-000000000001') m),
  array['v1.content.segunda-do-segundo', 'v1.content.primeira-do-segundo', 'v1.content.antiga'],
  'mensagens do mesmo segundo seguem a ordem de chegada');

select is(
  (select array_agg(m.out_content_ciphertext) from public.whatsapp_inbox_list_messages(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     'fa8b0000-0000-4000-8000-000000000001', 50,
     '2026-11-05 12:00:00+00', '2026-11-05 12:00:00.200+00',
     (select id from public.whatsapp_messages where content_ciphertext = 'v1.content.segunda-do-segundo')) m),
  array['v1.content.primeira-do-segundo', 'v1.content.antiga'],
  'cursor de mensagens não repete nem pula, mesmo no mesmo segundo');

select is(
  (select array_agg(c.out_conversation_id::text) from public.whatsapp_inbox_list_conversations(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 10,
     '2026-11-05 12:00:00+00', 'fa8b0000-0000-4000-8000-000000000001') c),
  array['fa8b0000-0000-4000-8000-000000000002'],
  'cursor de conversas continua da posição certa');

-- ── acesso indevido ───────────────────────────────────────────────────────
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', 'fa8eeeee-2222-4222-8222-222222222222') $$,
  'P0001', 'forbidden', 'Super Admin não lista outra empresa');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_messages('fa800000-0000-4000-8000-000000000001', 'fa8eeeee-2222-4222-8222-222222222222', 'fa8b0000-0000-4000-8000-000000000003') $$,
  'P0001', 'forbidden', 'Super Admin não lê mensagens de outra empresa');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000003', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  'P0001', 'forbidden', 'perfil comum não lista');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_messages('fa800000-0000-4000-8000-000000000003', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8b0000-0000-4000-8000-000000000001') $$,
  'P0001', 'forbidden', 'perfil comum não lê mensagens');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000002', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  'P0001', 'forbidden', 'Super Admin inativo não lista');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-0000000000ff', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  'P0001', 'forbidden', 'perfil inexistente não lista');

-- Conversa de outra empresa, pedida pela empresa autorizada: resposta de inexistente.
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_messages('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8b0000-0000-4000-8000-000000000003') $$,
  'P0001', 'conversation_not_found', 'ID de outra empresa não vaza conteúdo');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_messages('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8b0000-0000-4000-8000-0000000000ff') $$,
  'P0001', 'conversation_not_found', 'conversa inexistente tem a mesma resposta');

-- ── entrada inválida ──────────────────────────────────────────────────────
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations(null, '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  'P0001', 'invalid_input', 'ator nulo é recusado');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'invalid_input', 'empresa nula é recusada');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 101) $$,
  'P0001', 'invalid_input', 'limite acima do máximo é recusado');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 0) $$,
  'P0001', 'invalid_input', 'limite zero é recusado');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 10, now(), null) $$,
  'P0001', 'invalid_input', 'cursor pela metade é recusado');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_messages('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8b0000-0000-4000-8000-000000000001', 10, now(), null, gen_random_uuid()) $$,
  'P0001', 'invalid_input', 'cursor de mensagens pela metade é recusado');

-- ── leitura não muda nada ─────────────────────────────────────────────────
select is(
  (select count(*)::int from public.audit_log where action like 'whatsapp_inbox%'),
  0, 'leitura não grava auditoria nesta fase');

-- ── papéis: nenhum caminho direto ─────────────────────────────────────────
set local role authenticated;
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  '42501', null, 'authenticated não executa a lista');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_messages('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'fa8b0000-0000-4000-8000-000000000001') $$,
  '42501', null, 'authenticated não executa as mensagens');
select throws_ok($$ select public.whatsapp_inbox_read_allowed(null, null) $$, '42501', null, 'authenticated não executa o portão');
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  '42501', null, 'anon não executa a lista');
reset role;

set local role service_role;
select throws_ok($$ select * from public.whatsapp_messages $$, '42501', null, 'service_role segue sem ler a tabela');
select throws_ok($$ select public.whatsapp_inbox_read_allowed(null, null) $$, '42501', null, 'service_role não executa o portão');
select is(
  (select count(*)::int from public.whatsapp_inbox_list_conversations(
     'fa800000-0000-4000-8000-000000000001', '0dfc73ee-bca9-4fdf-aa50-b227940b2869')),
  2, 'service_role lê pela RPC, em nome de um Super Admin ativo');
select throws_ok(
  $$ select * from public.whatsapp_inbox_list_conversations('fa800000-0000-4000-8000-000000000003', '0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  'P0001', 'forbidden', 'nem service_role lê em nome de perfil comum');
reset role;

select * from finish();
rollback;
