-- Ambiente Supabase simplificado para testes em PGlite. Só para testes locais.
-- O dono dos objetos não é superusuário, como o postgres do Supabase. Esta
-- simulação NÃO substitui o Supabase local: auth, storage e papéis são aproximados.
do $$ begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role authenticator nologin;
  create role supabase_admin nologin;
  create role supabase_auth_admin nologin;
  create role dashboard_user nologin;
  create role supabase_storage_admin nologin;
  create role app_owner nosuperuser createrole createdb bypassrls login;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists realtime;
create schema if not exists vault;

create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text, email_confirmed_at timestamptz,
  encrypted_password text, created_at timestamptz, updated_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, phone text, last_sign_in_at timestamptz, banned_until timestamptz,
  deleted_at timestamptz, is_anonymous boolean default false
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(), user_id uuid, provider text, provider_id text, identity_data jsonb
);

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), path_tokens text[]
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as
$$ select string_to_array(name, '/') $$;
alter table storage.objects enable row level security;
alter table storage.objects owner to app_owner;
alter table storage.buckets owner to app_owner;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists "uuid-ossp";

grant anon, authenticated, service_role to app_owner;
grant all on schema public, auth, storage, extensions to app_owner;
grant all on all tables in schema auth, storage to app_owner;
grant all on all functions in schema auth, storage to app_owner;
grant create on database postgres to app_owner;
grant usage on schema public, auth, storage to anon, authenticated, service_role;

alter default privileges for role app_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public grant all on sequences to anon, authenticated, service_role;
