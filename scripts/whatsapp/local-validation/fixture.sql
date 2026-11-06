-- Dados fictícios para a validação em Supabase LOCAL. Nunca aplicar em produção.
-- Uso: psql dentro do container descartável, ver docs/WHATSAPP-CLOUD-API.md. O comando
-- "db query --local -f" não aceita arquivos com vários comandos.
insert into public.companies (id, name, status) values
  ('0dfc73ee-bca9-4fdf-aa50-b227940b2869', 'TEST COMPANY', 'ativa')
on conflict (id) do update set status = 'ativa';

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'fa700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'super@test.local', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'comum@test.local', now(), now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, name, email, is_active) values
  ('fa700000-0000-4000-8000-000000000001', 'Super Admin Local', 'super@test.local', true),
  ('fa700000-0000-4000-8000-000000000002', 'Usuário Comum Local', 'comum@test.local', true)
on conflict (id) do nothing;

update public.profiles set platform_role = 'super_admin' where id = 'fa700000-0000-4000-8000-000000000001';

insert into public.whatsapp_connections
  (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at)
values
  ('fa7a0000-0000-4000-8000-00000000000a', '0dfc73ee-bca9-4fdf-aa50-b227940b2869', '710000000000071', '810000000000071', 'v1.x.y.z', 'connected', now())
on conflict (id) do nothing;

select * from public.whatsapp_connection_set_capture('fa7a0000-0000-4000-8000-00000000000a', true, null);
