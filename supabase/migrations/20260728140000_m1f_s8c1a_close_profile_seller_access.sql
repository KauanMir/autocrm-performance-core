-- M1-F S8-C1-A — fechamento do acesso direto a profiles/sellers
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §29 (decisões
-- humanas aprovadas sobre a auditoria S8-C1-A0). Migration puramente
-- remocional — nenhuma policy substituta, nenhum grant novo, nenhuma
-- coluna/constraint/índice/trigger/RPC/helper alterado ou removido.
--
-- profiles_select_company: auditoria confirmou zero consumidor
-- client-side (o único acesso real a public.profiles é
-- lib/services.ts::_loadProfile, filtrado por id = auth.uid(), coberto
-- exclusivamente por profiles_select_own). A listagem administrativa
-- multi-perfil já é resolvida inteiramente por list_company_users/
-- list_inactive_company_users (RPCs SECURITY DEFINER). Enquanto
-- profiles_select_company existisse, a GRANT SELECT de profiles para
-- authenticated (role, seller_id, platform_role incluídos) permitia a
-- qualquer Manager ler essas três colunas de colegas da própria
-- empresa via REST direto — dados que a RPC sancionada deliberadamente
-- não repassa (design §22.5). profiles_select_own permanece intocada.
--
-- sellers_select_own/sellers_select_company/sellers_insert_admin/
-- sellers_update_admin: public.sellers nunca recebeu nenhum GRANT
-- (SELECT/INSERT/UPDATE/DELETE) para authenticated/anon em nenhuma
-- migration desde M1-B — fato já registrado no histórico do
-- repositório (20260721150000_m1f_s4c2c_login_profile_read.sql).
-- Postgres nega qualquer operação sobre uma tabela sem GRANT antes
-- mesmo de avaliar a RLS — as quatro policies são estruturalmente
-- inalcançáveis desde a criação, confirmado por grep de todo o código
-- de aplicação (zero .from('sellers') fora de testes SQL). Nenhuma
-- policy substituta é criada; nenhum GRANT é concedido; RLS permanece
-- habilitada com zero policy — mesma postura de dupla negação já
-- comprovada em public.company_memberships desde o S1.
--
-- Pipeline (pipeline_stages/reorder_pipeline_stages) e as 9 RPCs de
-- leads (m1e_03) não são tocados por esta migration — fora de escopo
-- do S8-C1-A (Pipeline é o S8-C1-B, com decisões próprias ainda não
-- implementadas, §29.4).

begin;

drop policy if exists profiles_select_company on public.profiles;

drop policy if exists sellers_select_own on public.sellers;
drop policy if exists sellers_select_company on public.sellers;
drop policy if exists sellers_insert_admin on public.sellers;
drop policy if exists sellers_update_admin on public.sellers;

comment on table public.sellers is
  'M1-F S8-C1-A: RLS habilitada, zero policy (dupla negação — sem GRANT client-side em nenhuma coluna/operação desde M1-B). Todo acesso real acontece via RPCs SECURITY DEFINER (list_company_users, list_inactive_company_users, current_profile_seller_id_for_company, e internamente nas RPCs de leads).';

commit;
