-- M1-C / Módulo 1 — m1c_01: helpers de RLS endurecidos + uniques compostas
-- Fonte: docs/M1-C-DESIGN.md (Revisão 4), §3, §5.1, §6.3.
--
-- PRIMEIRA migration do módulo, de propósito: as policies de
-- pipeline_stages (m1c_02) e a RPC de reorder (m1c_03) chamam estes
-- helpers — endurecê-los antes garante que nenhuma policy nova nasce
-- apoiada nas versões antigas (sem filtro de is_active, com
-- search_path = public e EXECUTE default de PUBLIC).
--
-- Escopo:
--   1. Redefine as 4 funções auxiliares de RLS do M1-B para (a) bloquear
--      profiles inativos e (b) usar search_path vazio com objetos
--      totalmente qualificados;
--   2. REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated em cada uma
--      (o M1-B dependia do EXECUTE default concedido a PUBLIC);
--   3. Adiciona unique(company_id, id) em sellers e profiles — alvos das
--      FKs compostas multiempresa das migrations m1c_04+.
--
-- Efeito do filtro is_active: para um profile desativado, cada helper
-- retorna NULL → toda policy que compara company_id =
-- current_profile_company_id() avalia como NULL → RLS nega (SELECT filtra a
-- linha; INSERT/UPDATE falham o WITH CHECK). Vale retroativamente para as
-- policies de companies/profiles/sellers criadas no M1-B.
--
-- Nota (§5.1): is_active=false NÃO impede a autenticação no Supabase Auth —
-- o GoTrue não conhece a tabela profiles. O bloqueio real acontece em duas
-- camadas: o app nega a entrada e faz signOut (AuthService.login já se
-- comporta assim desde o M1-B), e estas funções garantem zero linhas para
-- qualquer sessão ainda viva de um profile desativado.

begin;

-- ── helpers redefinidos ─────────────────────────────────────────────────

create or replace function public.current_profile_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.current_profile_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.current_profile_seller_id() returns text
language sql stable security definer set search_path = '' as $$
  select seller_id from public.profiles where id = auth.uid() and is_active;
$$;

-- Herda o filtro de is_active automaticamente por chamar
-- current_profile_role() por dentro. Para profile inativo o role vem NULL,
-- o IN devolve NULL e o coalesce força false — a função nunca retorna NULL.
create or replace function public.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.current_profile_role() in ('manager', 'admin'),
    false
  );
$$;

-- ── revoke/grant explícitos (mesma transação da redefinição, §6.3) ──────
-- Assinaturas completas: as 4 funções não recebem parâmetros — a
-- assinatura completa de cada uma é o nome com lista vazia, `()`.

revoke all on function public.current_profile_company_id() from public;
revoke all on function public.current_profile_role()       from public;
revoke all on function public.current_profile_seller_id()  from public;
revoke all on function public.is_manager_or_admin()        from public;

revoke all on function public.current_profile_company_id() from anon;
revoke all on function public.current_profile_role()       from anon;
revoke all on function public.current_profile_seller_id()  from anon;
revoke all on function public.is_manager_or_admin()        from anon;

revoke all on function public.current_profile_company_id() from authenticated;
revoke all on function public.current_profile_role()       from authenticated;
revoke all on function public.current_profile_seller_id()  from authenticated;
revoke all on function public.is_manager_or_admin()        from authenticated;

grant execute on function public.current_profile_company_id() to authenticated;
grant execute on function public.current_profile_role()       to authenticated;
grant execute on function public.current_profile_seller_id()  to authenticated;
grant execute on function public.is_manager_or_admin()        to authenticated;

-- ── uniques compostas multiempresa (alvos de FK composta, §3) ──────────

alter table public.sellers
  add constraint sellers_company_id_uidx unique (company_id, id);

alter table public.profiles
  add constraint profiles_company_id_uidx unique (company_id, id);

commit;
