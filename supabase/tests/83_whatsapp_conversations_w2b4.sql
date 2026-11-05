-- WHATSAPP-W2B-4 — contatos, conversas, mensagens e RPCs de captura (pgTAP).
-- Dados fake; rollback.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── estrutura e privilégios ───────────────────────────────────────────────
select has_table('public', 'whatsapp_contacts', 'tabela de contatos existe');
select has_table('public', 'whatsapp_conversations', 'tabela de conversas existe');
select has_table('public', 'whatsapp_messages', 'tabela de mensagens existe');

select columns_are('public', 'whatsapp_contacts',
  array['id', 'company_id', 'bsuid_hmac', 'phone_hmac', 'hmac_key_version', 'pii_ciphertext', 'pii_ref',
        'pii_key_version', 'pii_has_phone', 'pii_source_at', 'created_at', 'updated_at'],
  'contatos: sem telefone, nome ou BSUID em texto puro');
select columns_are('public', 'whatsapp_conversations',
  array['id', 'company_id', 'connection_id', 'contact_id', 'first_message_at', 'last_message_at', 'created_at', 'updated_at'],
  'conversas: sem vínculo com lead nesta fase');
select is(
  (select count(*)::int from pg_constraint
    where confrelid = 'public.leads'::regclass
      and conrelid in ('public.whatsapp_contacts'::regclass, 'public.whatsapp_conversations'::regclass, 'public.whatsapp_messages'::regclass)),
  0, 'nenhuma FK aponta para leads');
select columns_are('public', 'whatsapp_messages',
  array['id', 'company_id', 'connection_id', 'conversation_id', 'contact_id', 'event_id', 'direction', 'message_type',
        'message_id_hash', 'content_ciphertext', 'content_key_version', 'occurred_at', 'received_at', 'created_at'],
  'mensagens: sem texto, wamid ou payload em texto puro');

select is(
  (select count(*)::int from pg_class where oid in (
     'public.whatsapp_contacts'::regclass, 'public.whatsapp_conversations'::regclass, 'public.whatsapp_messages'::regclass)
     and relrowsecurity),
  3, 'RLS habilitado nas três tabelas');
select ok(
  not exists (select 1 from pg_policies where tablename in ('whatsapp_contacts', 'whatsapp_conversations', 'whatsapp_messages')),
  'zero policies');
select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['public.whatsapp_contacts', 'public.whatsapp_conversations', 'public.whatsapp_messages']) t,
        unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   where has_table_privilege(r, t, p)),
  0, 'anon, authenticated e service_role sem privilégio direto nas tabelas');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('whatsapp_connection_capture_context', 'whatsapp_capture_gate', 'whatsapp_inbound_message_capture',
       'whatsapp_inbound_event_mark_failed', 'whatsapp_connection_set_capture', 'whatsapp_diagnostics_summary')
     and p.prosecdef and p.proconfig @> array['search_path=""']),
  6, 'todas as RPCs são SECURITY DEFINER com search_path fixo');

select is(
  (select count(*)::int
   from unnest(array['anon', 'authenticated']) r,
        unnest(array[
          'public.whatsapp_connection_capture_context(text)',
          'public.whatsapp_capture_gate(uuid, uuid, text, text)',
          'public.whatsapp_inbound_message_capture(uuid, uuid, text, text, text, text, timestamptz, timestamptz, uuid, text, text, smallint, text, uuid, smallint, boolean, text, smallint)',
          'public.whatsapp_inbound_event_mark_failed(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid)',
          'public.whatsapp_connection_set_capture(uuid, boolean, uuid)',
          'public.whatsapp_diagnostics_summary(uuid)']) f
   where has_function_privilege(r, f, 'EXECUTE')),
  0, 'anon e authenticated sem EXECUTE');
select ok(
  not has_function_privilege('service_role', 'public.whatsapp_capture_gate(uuid, uuid, text, text)', 'EXECUTE'),
  'portão é interno: service_role não executa direto');

-- ── fixtures (como postgres) ─────────────────────────────────────────────
insert into public.companies (id, name, status) values
  ('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'TEST COMPANY', 'ativa'),
  ('fa4eeeee-2222-2222-2222-222222222222', 'Concessionária real simulada', 'ativa')
on conflict (id) do update set status = 'ativa';

insert into public.whatsapp_connections
  (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at)
values
  ('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '710000000000001', '810000000000041', 'v1.x.y.z', 'connected', now()),
  ('fa4a0000-0000-0000-0000-00000000000b', 'fa4eeeee-2222-2222-2222-222222222222', '710000000000002', '810000000000042', 'v1.x.y.z', 'connected', now());

create function pg_temp.capture(
  p_connection uuid, p_company uuid, p_phone text, p_waba text, p_hash_seed text,
  p_bsuid text default null, p_phone_hmac text default null, p_occurred timestamptz default '2026-11-05 10:00:00+00',
  p_has_phone boolean default true, p_pii text default 'v1.pii.a.b', p_ref uuid default gen_random_uuid()
) returns table (out_outcome text, out_event_id uuid, out_message_id uuid, out_conversation_id uuid)
language sql as $$
  select * from public.whatsapp_inbound_message_capture(
    p_connection, p_company, p_phone, p_waba, encode(sha256(convert_to(p_hash_seed, 'UTF8')), 'hex'), 'text', p_occurred,
    '2026-11-05 10:00:01+00', '99999999-9999-4999-8999-999999999999', p_bsuid, p_phone_hmac, 1::smallint, p_pii, p_ref,
    1::smallint, p_has_phone, 'v1.content.a.b', 1::smallint)
$$;
grant execute on function pg_temp.capture to service_role;

-- ── captura desabilitada por padrão ──────────────────────────────────────
select ok(
  (select not bool_or(capture_enabled) from public.whatsapp_connections),
  'captura nasce desabilitada');
select is(
  (select out_capture_allowed from public.whatsapp_connection_capture_context('810000000000041')),
  false, 'contexto informa captura não permitida');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm0', null, repeat('a', 64))),
  'capture_disabled', 'captura desabilitada não grava');
select is((select count(*)::int from public.whatsapp_webhook_events), 0, 'nenhum evento gravado');

-- ── trava: concessionária real nunca habilita captura ────────────────────
select throws_ok(
  $$ update public.whatsapp_connections set capture_enabled = true where id = 'fa4a0000-0000-0000-0000-00000000000b' $$,
  '23514', null, 'CHECK impede UPDATE direto fora da TEST COMPANY');
select throws_ok(
  $$ select * from public.whatsapp_connection_set_capture('fa4a0000-0000-0000-0000-00000000000b', true, null) $$,
  'P0001', 'capture_not_allowed', 'RPC recusa habilitar fora da TEST COMPANY');
select is(
  (select out_capture_enabled from public.whatsapp_connection_set_capture('fa4a0000-0000-0000-0000-00000000000a', true, null)),
  true, 'TEST COMPANY pode habilitar');
select is(
  (select after_data from public.audit_log where action = 'whatsapp_capture_changed'
     and entity_id = 'fa4a0000-0000-0000-0000-00000000000a' limit 1),
  '{"capture_enabled": true}'::jsonb, 'auditoria só com o estado do gate');
select is(
  (select before_data from public.audit_log where action = 'whatsapp_capture_changed'
     and entity_id = 'fa4a0000-0000-0000-0000-00000000000a' limit 1),
  '{"capture_enabled": false}'::jsonb, 'auditoria guarda o estado anterior');
select throws_ok(
  $$ select * from public.whatsapp_connection_set_capture('fa4a0000-0000-0000-0000-0000000000ff', true, null) $$,
  'P0001', 'connection_not_connected', 'conexão inexistente é recusada');

-- ── portão: conexão, empresa e WABA ───────────────────────────────────────
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000099', 'm1', null, repeat('a', 64))),
  'waba_mismatch', 'WABA divergente não grava');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', 'fa4eeeee-2222-2222-2222-222222222222',
     '810000000000041', '710000000000001', 'm1', null, repeat('a', 64))),
  'connection_not_connected', 'empresa esperada divergente não grava');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000042', '710000000000001', 'm1', null, repeat('a', 64))),
  'connection_not_connected', 'número de outra conexão não grava');
select is((select count(*)::int from public.whatsapp_webhook_events), 0, 'portão falho não deixa rastro parcial');

-- ── captura transacional e idempotência ───────────────────────────────────
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm1', null, repeat('a', 64))),
  'captured', 'primeira entrega captura');
select is(
  (select array[(select count(*)::int from public.whatsapp_webhook_events), (select count(*)::int from public.whatsapp_contacts),
                (select count(*)::int from public.whatsapp_conversations), (select count(*)::int from public.whatsapp_messages)]),
  array[1, 1, 1, 1], 'evento, contato, conversa e mensagem criados juntos');
select is(
  (select processing_status from public.whatsapp_webhook_events), 'processed', 'evento fica processed');
select is(
  (select request_id from public.whatsapp_webhook_events), '99999999-9999-4999-8999-999999999999'::uuid, 'request_id rastreável');

select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm1', null, repeat('a', 64))),
  'duplicate', 'reentrega é duplicate');
select is(
  (select array[(select count(*)::int from public.whatsapp_webhook_events), (select count(*)::int from public.whatsapp_messages)]),
  array[1, 1], 'reentrega não cria linhas');

-- ── contato: mesma pessoa, BSUID depois, fora de ordem ────────────────────
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm2', repeat('b', 64), repeat('a', 64), '2026-11-05 11:00:00+00', true, 'v1.pii.novo.b')),
  'captured', 'mesmo telefone com BSUID novo captura');
select is((select count(*)::int from public.whatsapp_contacts), 1, 'mesmo telefone não duplica contato');
select is((select bsuid_hmac from public.whatsapp_contacts), repeat('b', 64), 'BSUID fica associado');
select is((select pii_ciphertext from public.whatsapp_contacts), 'v1.pii.novo.b', 'envelope mais novo substitui');
select is((select count(*)::int from public.whatsapp_conversations), 1, 'mesma conversa');

select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm3', repeat('b', 64), null, '2026-11-05 09:00:00+00', true, 'v1.pii.velho.b')),
  'captured', 'evento antigo fora de ordem captura');
select is((select pii_ciphertext from public.whatsapp_contacts), 'v1.pii.novo.b', 'evento antigo não sobrescreve envelope novo');
select is(
  (select first_message_at from public.whatsapp_conversations), '2026-11-05 09:00:00+00'::timestamptz, 'primeira data recua');
select is(
  (select last_message_at from public.whatsapp_conversations), '2026-11-05 11:00:00+00'::timestamptz, 'última data não recua');

select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm4', repeat('b', 64), null, '2026-11-05 12:00:00+00', false, 'v1.pii.semfone.b')),
  'captured', 'mensagem sem telefone captura');
select is((select pii_has_phone from public.whatsapp_contacts), true, 'telefone já conhecido não se perde');
select is((select pii_ciphertext from public.whatsapp_contacts), 'v1.pii.novo.b', 'envelope sem telefone não substitui o completo');

-- ── identidades de contatos diferentes nunca são fundidas ─────────────────
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm7', repeat('e', 64), repeat('f', 64), '2026-11-05 12:30:00+00')),
  'captured', 'segundo contato captura');
select is((select count(*)::int from public.whatsapp_contacts), 2, 'dois contatos');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm8', repeat('e', 64), repeat('a', 64), '2026-11-05 12:40:00+00')),
  'captured', 'BSUID de um contato com telefone de outro captura');
select is((select count(*)::int from public.whatsapp_contacts), 2, 'conflito não funde nem cria contato');
select is(
  (select phone_hmac from public.whatsapp_contacts where bsuid_hmac = repeat('e', 64)),
  repeat('f', 64), 'telefone do contato não é sobrescrito no conflito');
delete from public.whatsapp_messages where message_id_hash in (
  encode(sha256(convert_to('m7', 'UTF8')), 'hex'), encode(sha256(convert_to('m8', 'UTF8')), 'hex'));
delete from public.whatsapp_webhook_events where message_id_hash in (
  encode(sha256(convert_to('m7', 'UTF8')), 'hex'), encode(sha256(convert_to('m8', 'UTF8')), 'hex'));
delete from public.whatsapp_contacts where bsuid_hmac = repeat('e', 64);

-- ── evento sem mensagem é completado pela reentrega ───────────────────────
select is(
  (select out_created from public.whatsapp_webhook_event_register(
     'fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '810000000000041', 'message',
     encode(sha256(convert_to('m5', 'UTF8')), 'hex'), 'text')),
  true, 'linha da W2A sem conteúdo');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000041', '710000000000001', 'm5', repeat('b', 64))),
  'captured', 'reentrega completa o evento antigo');

-- ── falha permanente rastreável ───────────────────────────────────────────
select is(
  (select out_outcome from public.whatsapp_inbound_event_mark_failed(
     'fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '810000000000041', '710000000000001',
     encode(sha256(convert_to('m6', 'UTF8')), 'hex'), 'text', 'contact_unresolved', null, now(), null)),
  'recorded', 'falha registrada');
select is(
  (select out_outcome from public.whatsapp_inbound_event_mark_failed(
     'fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '810000000000041', '710000000000001',
     encode(sha256(convert_to('m6', 'UTF8')), 'hex'), 'text', 'contact_unresolved', null, now(), null)),
  'already_recorded', 'falha repetida não duplica');
select throws_ok(
  $$ select * from public.whatsapp_inbound_event_mark_failed(
       'fa4a0000-0000-0000-0000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '810000000000041', '710000000000001',
       repeat('c', 64), 'text', 'codigo_livre', null, now(), null) $$,
  'P0001', 'invalid_input', 'código de erro é fechado');

-- ── isolamento: mesma identidade em outra empresa ─────────────────────────
-- Só aqui, dentro da transação, a trava sai para simular duas empresas capturando.
alter table public.whatsapp_connections drop constraint whatsapp_connections_capture_test_only_ck;
update public.whatsapp_connections set capture_enabled = true where id = 'fa4a0000-0000-0000-0000-00000000000b';

select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000b', 'fa4eeeee-2222-2222-2222-222222222222',
     '810000000000042', '710000000000002', 'm1', null, repeat('a', 64))),
  'captured', 'mesmo wamid e HMAC em outra empresa capturam separados');
select is(
  (select count(distinct company_id)::int from public.whatsapp_contacts where phone_hmac = repeat('a', 64)),
  2, 'cada empresa tem seu próprio contato');
select is(
  (select count(*)::int from public.whatsapp_messages m
     join public.whatsapp_conversations c on c.id = m.conversation_id
     where m.company_id <> c.company_id),
  0, 'nenhuma mensagem em conversa de outra empresa');
select is(
  (select out_messages_total from public.whatsapp_diagnostics_summary('fa4eeeee-2222-2222-2222-222222222222')),
  1::bigint, 'resumo conta só a empresa pedida');

select throws_ok(
  $$ insert into public.whatsapp_messages (company_id, connection_id, conversation_id, contact_id, event_id, direction,
       message_type, message_id_hash, content_ciphertext, content_key_version, occurred_at, received_at)
     select 'fa4eeeee-2222-2222-2222-222222222222', m.connection_id, m.conversation_id, m.contact_id, gen_random_uuid(), 'inbound',
       'text', repeat('d', 64), 'v1.a.b.c', 1, now(), now()
     from public.whatsapp_messages m where m.company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869' limit 1 $$,
  '23503', null, 'FK composta impede mensagem apontando para outra empresa');

-- ── resumo sanitizado ─────────────────────────────────────────────────────
select is(
  (select array[out_events_total, out_events_processed, out_events_failed, out_events_received, out_messages_total,
                out_contacts_total, out_conversations_total, out_capture_enabled_connections]
   from public.whatsapp_diagnostics_summary('0dfc73ee-bca9-4fdf-aa50-b227940b2869')),
  array[6, 5, 1, 0, 5, 1, 1, 1]::bigint[], 'contagens da TEST COMPANY');

-- ── mesmo wamid em dois números da empresa: duas mensagens, duas conversas ──
insert into public.whatsapp_connections
  (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at, capture_enabled)
values
  ('fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '710000000000001', '810000000000043', 'v1.x.y.z', 'connected', now(), true);

select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000043', '710000000000001', 'm1', null, repeat('a', 64))),
  'captured', 'mesmo wamid em outro número não gera erro');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000043', '710000000000001', 'm1', null, repeat('a', 64))),
  'duplicate', 'reentrega no segundo número é duplicate');
select is(
  (select count(distinct conversation_id)::int from public.whatsapp_messages
    where company_id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869'
      and message_id_hash = encode(sha256(convert_to('m1', 'UTF8')), 'hex')),
  2, 'cada número fica na sua conversa');

-- ── horários fora da faixa não afetam a ordem ─────────────────────────────
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000043', '710000000000001', 't1', null, repeat('a', 64), '2099-01-01 00:00:00+00')),
  'captured', 'horário futuro não falha');
select is(
  (select occurred_at from public.whatsapp_messages where message_id_hash = encode(sha256(convert_to('t1', 'UTF8')), 'hex')),
  '2026-11-05 10:00:01+00'::timestamptz, 'horário futuro usa o recebimento');
select is(
  (select occurred_at from public.whatsapp_webhook_events where message_id_hash = encode(sha256(convert_to('t1', 'UTF8')), 'hex')),
  null::timestamptz, 'ledger não guarda horário inválido');
select is(
  (select last_message_at from public.whatsapp_conversations where connection_id = 'fa4a0000-0000-0000-0000-00000000000c'),
  '2026-11-05 10:00:01+00'::timestamptz, 'conversa não vai para o futuro');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000043', '710000000000001', 't2', null, repeat('a', 64), '2001-01-01 00:00:00+00')),
  'captured', 'horário antigo demais não falha');
select is(
  (select occurred_at from public.whatsapp_messages where message_id_hash = encode(sha256(convert_to('t2', 'UTF8')), 'hex')),
  '2026-11-05 10:00:01+00'::timestamptz, 'horário antigo demais usa o recebimento');
select is(
  (select out_outcome from pg_temp.capture('fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869',
     '810000000000043', '710000000000001', 't3', null, repeat('a', 64), '2026-11-05 20:00:00+00')),
  'captured', 'pequena diferença de relógio é aceita');
select is(
  (select occurred_at from public.whatsapp_messages where message_id_hash = encode(sha256(convert_to('t3', 'UTF8')), 'hex')),
  '2026-11-05 20:00:00+00'::timestamptz, 'horário dentro da tolerância é mantido');

-- ── recusas sanitizadas: grupo e WABA divergente nunca criam conversa ─────
select is(
  (select out_outcome from public.whatsapp_inbound_event_mark_failed(
     'fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '810000000000043', '710000000000001',
     encode(sha256(convert_to('g1', 'UTF8')), 'hex'), 'text', 'group_message', null, now(), null)),
  'recorded', 'grupo fica rastreado');
select is(
  (select out_outcome from public.whatsapp_inbound_event_mark_failed(
     'fa4a0000-0000-0000-0000-00000000000c', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '810000000000043', '710000000000001',
     encode(sha256(convert_to('w1', 'UTF8')), 'hex'), 'text', 'waba_mismatch', null, now(), null)),
  'recorded', 'WABA divergente fica rastreada');
select is(
  (select count(*)::int from public.whatsapp_messages where message_id_hash in (
     encode(sha256(convert_to('g1', 'UTF8')), 'hex'), encode(sha256(convert_to('w1', 'UTF8')), 'hex'))),
  0, 'recusas não criam mensagem');
select is(
  (select array[out_events_waba_mismatch, out_events_contact_unresolved, out_events_group_message]
   from public.whatsapp_diagnostics_summary('0dfc73ee-bca9-4fdf-aa50-b227940b2869')),
  array[1, 1, 1]::bigint[], 'resumo separa os motivos');
select is(
  (select array[out_events_waba_mismatch, out_events_contact_unresolved, out_events_group_message]
   from public.whatsapp_diagnostics_summary('fa4eeeee-2222-2222-2222-222222222222')),
  array[0, 0, 0]::bigint[], 'recusas não aparecem em outra empresa');

-- ── papéis: nenhum caminho direto ─────────────────────────────────────────
set local role authenticated;
select throws_ok($$ select * from public.whatsapp_messages $$, '42501', null, 'authenticated não lê mensagens');
select throws_ok($$ select * from public.whatsapp_contacts $$, '42501', null, 'authenticated não lê contatos');
select throws_ok($$ select * from public.whatsapp_diagnostics_summary('0dfc73ee-bca9-4fdf-aa50-b227940b2869') $$,
  '42501', null, 'authenticated não executa resumo');
select throws_ok($$ select * from public.whatsapp_connection_set_capture('fa4a0000-0000-0000-0000-00000000000a', false, null) $$,
  '42501', null, 'authenticated não altera captura');
reset role;

set local role anon;
select throws_ok($$ select * from public.whatsapp_conversations $$, '42501', null, 'anon não lê conversas');
select throws_ok($$ select * from public.whatsapp_connection_capture_context('810000000000041') $$,
  '42501', null, 'anon não executa contexto');
reset role;

set local role service_role;
select throws_ok($$ select * from public.whatsapp_messages $$, '42501', null, 'service_role não lê a tabela diretamente');
select is(
  (select out_waba_id from public.whatsapp_connection_capture_context('810000000000041')),
  '710000000000001', 'service_role executa o contexto');
reset role;

select * from finish();
rollback;
