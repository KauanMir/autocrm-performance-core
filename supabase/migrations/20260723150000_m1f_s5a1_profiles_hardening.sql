-- M1-F S5-A1 — hardening da superfície de escrita direta de public.profiles.
-- Auditoria prévia (M1-F S5-A0) confirmou, via catálogo real (não só
-- migrations): `authenticated`/`anon` nunca tiveram, em nenhuma migration,
-- GRANT UPDATE de tabela nem de coluna em `profiles` — a policy
-- `profiles_update_admin` (M1-B, 20260708120000) sempre esteve
-- estruturalmente inalcançável por PostgREST (Postgres nega o comando
-- UPDATE antes de a RLS ser avaliada, exatamente o mesmo mecanismo já
-- documentado para o gap histórico de SELECT em
-- 20260721150000_m1f_s4c2c_login_profile_read.sql). Nenhum consumidor
-- client-side ou RPC SECURITY DEFINER depende dela (grep completo do
-- repositório, S5-A0 §5) — as RPCs administrativas existentes
-- (create_invite/resend_invite/cancel_invite/accept_invite/create_company)
-- escrevem como owner (`postgres`) e não dependem de GRANT concedido a
-- `authenticated`.
--
-- Nota sobre o comentário histórico de 20260721150000_m1f_s4c2c_...: aquele
-- arquivo descreve "profiles_update_admin, já existente" como "a única
-- mutação client-side em profiles" — essa frase presumia a policy
-- funcional, mas não corresponde ao estado real de GRANT (achado empírico
-- desta auditoria, não presumido). A migration histórica não é alterada
-- (nunca reescrever histórico); este comentário aqui registra a correção.
--
-- Motivo da remoção, não apenas do REVOKE: mesmo inalcançável hoje, a
-- policy é superfície ampla (qualquer coluna da linha-alvo, sem whitelist
-- própria) dependente de `profiles.role = 'admin'` — papel legado que o
-- produto já decidiu abandonar (design §5.4). Diferente de
-- `platform_role` (que tem uma Camada 2 independente de GRANT — o trigger
-- `profiles_guard_platform_role_ck`), esta policy não tem defesa
-- equivalente para as demais colunas; um GRANT UPDATE futuro acidental
-- (ex.: herdado de um projeto remoto com default antigo de "auto-expose",
-- ou de uma migration futura descuidada) reabriria 100% da superfície sem
-- aviso. Remover a policy elimina essa classe de risco por completo, em
-- vez de deixá-la como código morto reativável por acidente.
--
-- Mutações futuras de perfil (nome, papel, e-mail — M1-F S5-B/S5-C/e-mail
-- em subetapa própria, §22 do design) usam RPCs SECURITY DEFINER estreitas,
-- nunca esta policy ampla nem GRANT direto de escrita a `authenticated`.
--
-- Defesa em duas camadas resultante:
--   Camada 1 (privilégio) — nenhum GRANT de escrita/DDL em profiles para
--     anon/authenticated/PUBLIC; nenhuma coluna com UPDATE concedido.
--   Camada 2 (RLS) — nenhuma policy de UPDATE em public.profiles; mesmo que
--     uma migration futura conceda UPDATE por engano, a ausência de policy
--     de UPDATE nega a escrita (RLS "default deny": sem policy = nenhuma
--     linha passa).
--
-- Nada mais é alterado: profiles_select_own/profiles_select_company, os
-- GRANTs de SELECT existentes, triggers, constraints, índices, helpers,
-- o guard de platform_role e company_memberships permanecem intocados.
begin;

drop policy if exists profiles_update_admin on public.profiles;

revoke insert, update, delete, truncate, references, trigger
  on table public.profiles
  from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.profiles
  from public;

-- Camada 1, reforço explícito por coluna (redundante com o REVOKE de
-- tabela acima, mantido por clareza de auditoria e simetria com o padrão
-- já usado para platform_role em 20260720100000_m1f_s1_01_...): nenhuma
-- coluna atual de profiles concede UPDATE a anon/authenticated.
revoke update (
  id,
  company_id,
  name,
  email,
  role,
  seller_id,
  is_active,
  created_at,
  updated_at,
  platform_role
) on public.profiles from anon, authenticated;

commit;
