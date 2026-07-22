-- M1-F S4-F1 (01): leitura da PRÓPRIA membership em public.company_memberships
-- para authenticated. Fonte: correção pedida pelo usuário durante o S4-F1 —
-- canManageInvites() precisa distinguir "Manager com membership ATIVA" de
-- "profiles.role='manager' legado" (que não reflete suspensão/offboarding),
-- e hoje NENHUM código client-side lê company_memberships: a tabela está
-- fechada desde m1f_s1_01 (RLS habilitada, ZERO policy, REVOKE ALL de
-- public/anon/authenticated) — postura correta então (nenhum consumidor
-- real), mas bloqueante agora que existe um consumidor real e legítimo: o
-- próprio usuário resolvendo o próprio contexto de autorização no frontend.
--
-- Escopo mínimo, por design (mesmo princípio já usado no hotfix de SELECT
-- de profiles, S4-C2C):
--   - policy SELECT nova, restrita a profile_id = auth.uid() — nunca a
--     empresa inteira, nunca outro usuário. Um Manager não passa a enxergar
--     as memberships de outros Managers/Sellers da própria empresa por
--     esta migration (isso seria uma tabela/RPC de "membros da empresa",
--     fora de escopo aqui e do S4-F1 como um todo — ver decisão do usuário
--     de não ampliar visibilidade além do próprio ator nesta etapa).
--   - GRANT SELECT por COLUNA (nunca a tabela inteira): somente
--     company_id, role, is_active — exatamente o que
--     _loadActiveMembership() (lib/services.ts) lê. invited_at/joined_at/
--     created_at/updated_at/id/profile_id não são necessários para
--     determinar autorização e não são concedidos.
--   - Somente `authenticated` — `anon` continua sem qualquer acesso.
--   - Nenhum INSERT/UPDATE/DELETE concedido a ninguém aqui.
--   - Nenhuma policy existente é alterada; nenhum helper SECURITY DEFINER
--     (current_membership_company_id/current_membership_role, m1f_s2_02)
--     é tocado — continuam existindo e servindo seu propósito original
--     (uso interno por outras RPCs/policies futuras do S8), independentes
--     desta leitura direta nova, que serve um consumidor diferente
--     (identidade carregada no frontend em login()/restoreSession()).
--
-- Múltiplas linhas por profile_id são estruturalmente possíveis (histórico
-- de memberships passadas em outras empresas — company_memberships não
-- apaga linhas ao desativar), mas no máximo UMA pode ter is_active=true
-- (company_memberships_profile_single_active_uidx, m1f_s1_01) — a policy
-- abaixo não precisa (nem deve) filtrar por is_active: isso é um filtro de
-- CONSULTA (o cliente decide o que perguntar), não de AUTORIZAÇÃO (a
-- autorização é "é sua própria linha", ponto). Ver a query real em
-- _loadActiveMembership(), que sim filtra por is_active=true.
begin;

create policy company_memberships_select_own on public.company_memberships
  for select
  to authenticated
  using (profile_id = auth.uid());

grant select (company_id, role, is_active) on public.company_memberships to authenticated;

commit;
