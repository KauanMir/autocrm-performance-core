-- META-PERSISTENCE-P2 — estrutura da conexão Meta por company.
-- Somente tabela, constraints, índices, RLS e revogações. Nenhuma linha,
-- nenhum token, nenhuma RPC, nenhuma policy. Acesso futuro só por RPCs
-- SECURITY DEFINER estreitas (P3), nunca por privilégio direto na tabela.

create table public.company_meta_integrations (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id) on delete cascade,
  page_id                  text not null,
  page_name                text,
  access_token_ciphertext  text,
  token_key_version        smallint not null default 1,
  granted_scopes           text[] not null default '{}',
  status                   text not null,
  leadgen_subscribed_at    timestamptz,
  connected_at             timestamptz,
  connected_by             uuid references public.profiles(id) on delete set null,
  disconnected_at          timestamptz,
  last_error_code          text,
  last_error_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint company_meta_integrations_company_page_uniq
    unique (company_id, page_id),
  constraint company_meta_integrations_page_id_ck
    check (page_id ~ '^[0-9]{1,30}$'),
  constraint company_meta_integrations_page_name_ck
    check (page_name is null or char_length(page_name) <= 200),
  constraint company_meta_integrations_key_version_ck
    check (token_key_version >= 1),
  constraint company_meta_integrations_status_ck
    check (status in ('connected', 'disconnected', 'error')),
  constraint company_meta_integrations_ciphertext_len_ck
    check (access_token_ciphertext is null or char_length(access_token_ciphertext) <= 4096),
  constraint company_meta_integrations_connected_ciphertext_ck
    check (status <> 'connected' or access_token_ciphertext is not null),
  constraint company_meta_integrations_connected_at_ck
    check (status <> 'connected' or connected_at is not null),
  constraint company_meta_integrations_last_error_code_ck
    check (
      last_error_code is null
      or (char_length(last_error_code) between 1 and 64 and last_error_code ~ '^[a-z][a-z0-9_]*$')
    )
);

-- Uma Page conectada pertence a no máximo uma company. Serve também de lookup
-- do webhook, que só processa conexões ativas; não cria índice redundante em page_id.
create unique index company_meta_integrations_page_connected_uniq
  on public.company_meta_integrations (page_id)
  where status = 'connected';

create trigger company_meta_integrations_set_updated_at
  before update on public.company_meta_integrations
  for each row execute function set_updated_at();

alter table public.company_meta_integrations enable row level security;

revoke all on table public.company_meta_integrations
  from public, anon, authenticated, service_role;
