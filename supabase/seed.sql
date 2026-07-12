-- M1-B — seed inicial (companies + sellers + profiles)
-- Rodar DEPOIS da migration 20260708120000_m1b_auth_profiles_sellers.sql.
--
-- Este arquivo tem 3 partes. As Partes 1 e 2 são SQL puro e podem rodar
-- direto no SQL editor do Supabase (ou via `supabase db execute`). A Parte 3
-- PRECISA de um passo manual fora do SQL antes de rodar — ver instruções.

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 1 — company (não depende de nada)
-- ─────────────────────────────────────────────────────────────────────────

insert into companies (id, name, cnpj, phone, timezone)
values (
  '00000000-0000-0000-0000-000000000001',
  'Revenda Premium Veículos',
  '00.000.000/0001-00',
  '(11) 3000-0000',
  'America/Sao_Paulo'
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 2 — sellers (não depende de auth.users; ids iguais ao seed atual do
-- protótipo em lib/data.ts SELLERS, de propósito — ver nota no topo da
-- migration sobre por que sellers.id é `text` nesta fase, não uuid)
-- ─────────────────────────────────────────────────────────────────────────

insert into sellers (id, company_id, name, first_name, team) values
  ('s1',  '00000000-0000-0000-0000-000000000001', 'Marcos Silva',    'Marcos',   'Seminovos'),
  ('s2',  '00000000-0000-0000-0000-000000000001', 'Ana Souza',       'Ana',      'Seminovos'),
  ('s3',  '00000000-0000-0000-0000-000000000001', 'João Ferreira',   'João',     'Novos'),
  ('s4',  '00000000-0000-0000-0000-000000000001', 'Lucas Martins',   'Lucas',    'Novos'),
  ('s5',  '00000000-0000-0000-0000-000000000001', 'Beatriz Lima',    'Beatriz',  'Seminovos'),
  ('s6',  '00000000-0000-0000-0000-000000000001', 'Rafael Nunes',    'Rafael',   'Novos'),
  ('s7',  '00000000-0000-0000-0000-000000000001', 'Carla Mendes',    'Carla',    'Seminovos'),
  ('s8',  '00000000-0000-0000-0000-000000000001', 'Diego Alves',     'Diego',    'Novos'),
  ('s9',  '00000000-0000-0000-0000-000000000001', 'Patrícia Rocha',  'Patrícia', 'Seminovos'),
  ('s10', '00000000-0000-0000-0000-000000000001', 'Bruno Castro',    'Bruno',    'Novos'),
  ('s11', '00000000-0000-0000-0000-000000000001', 'Fernanda Dias',   'Fernanda', 'Seminovos'),
  ('s12', '00000000-0000-0000-0000-000000000001', 'Thiago Moraes',   'Thiago',   'Novos')
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- PARTE 3 — profiles (PRECISA de auth.users primeiro — passo manual)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Não dá para criar usuários reais do Supabase Auth com um INSERT direto em
-- auth.users de forma segura/suportada — senha precisa passar pelo GoTrue
-- (hash, validação, etc.), não por um `insert` cru. Duas formas oficiais:
--
--   (a) Dashboard → Authentication → Users → "Add user" → marcar
--       "Auto Confirm User" para não depender de e-mail de confirmação.
--   (b) Admin API (server-side, nunca no client — exige a service role key):
--         await supabaseAdmin.auth.admin.createUser({
--           email: 'admin@autocrm.com',
--           password: '<escolha uma senha real aqui, não "123456">',
--           email_confirm: true,
--         });
--
-- Crie os 4 usuários abaixo (mesmos e-mails do protótipo original) por (a)
-- ou (b), copie o `id` (uuid) que o Supabase gerar para cada um, e troque os
-- placeholders <UUID_ADMIN> / <UUID_MANAGER> / <UUID_SELLER1> / <UUID_SELLER2>
-- pelos valores reais antes de rodar o bloco abaixo.
--
--   admin@autocrm.com      → role admin,   seller_id null
--   gerente@autocrm.com    → role manager, seller_id null
--   vendedor1@autocrm.com  → role seller,  seller_id 's4'  (Lucas Martins)
--   vendedor2@autocrm.com  → role seller,  seller_id 's11' (Fernanda Dias)
--
-- Nenhuma senha é gravada aqui nem em nenhum outro arquivo deste repositório.

insert into profiles (id, company_id, name, email, role, seller_id) values
  ('<UUID_ADMIN>',    '00000000-0000-0000-0000-000000000001', 'Admin',          'admin@autocrm.com',     'admin',   null),
  ('<UUID_MANAGER>',  '00000000-0000-0000-0000-000000000001', 'Carlos Mendes',  'gerente@autocrm.com',   'manager', null),
  ('<UUID_SELLER1>',  '00000000-0000-0000-0000-000000000001', 'Lucas Martins',  'vendedor1@autocrm.com', 'seller',  's4'),
  ('<UUID_SELLER2>',  '00000000-0000-0000-0000-000000000001', 'Fernanda Costa', 'vendedor2@autocrm.com', 'seller',  's11')
on conflict (id) do nothing;

-- Opcional, mas recomendado: linkar sellers.profile_id de volta para os dois
-- vendedores de teste, agora que os profiles existem.
update sellers set profile_id = '<UUID_SELLER1>' where id = 's4';
update sellers set profile_id = '<UUID_SELLER2>' where id = 's11';
