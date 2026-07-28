-- M1-F / Módulo 1 — m1f_s6e: leitura administrativa de memberships inativas
-- (suspensas/desligadas), decisão fechada em §24.14 do design (opção B: RPC
-- separada e dedicada — nunca uma alteração de list_company_users, cujo
-- contrato permanece 100% intacto: nenhuma linha desta migration toca
-- list_company_users nem a query 20260723160000_m1f_s5a2).
--
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §24.14/§24.15.
-- Nome/assinatura/cursor confirmados explicitamente pelo usuário nesta
-- etapa (o documento só trazia um exemplo ilustrativo, não uma assinatura
-- congelada — ver comentário de decisão abaixo).
--
-- Nome: list_inactive_company_users — espelha list_company_users (mesma
-- convenção de nome, mesmo padrão de cursor/paginação/busca/autorização),
-- só que nunca retorna lifecycle_status = 'active'.
--
-- Cursor: (updated_at, id) — não (created_at, id) como list_company_users.
-- company_memberships.updated_at é mantido por trigger
-- (company_memberships_set_updated_at, m1f_s1_01) e É tocado por TODA
-- transição de lifecycle (suspend_membership/reactivate_membership/
-- offboard_seller/offboard_manager/transfer_membership fazem UPDATE na
-- linha) — reflete "última mudança de estado", a ordenação que faz sentido
-- para uma tela de inativos (mais recentemente suspenso/desligado primeiro).
-- created_at ficaria parado desde a criação original da membership, sem
-- relação com o evento que esta listagem existe para mostrar.
--
-- Autorização: MESMOS helpers de list_company_users
-- (is_platform_super_admin/current_membership_company_id/
-- current_membership_role/can_access_company, m1f_s2_02) — nenhum helper
-- novo. Super Admin: escopo global, p_company_id como filtro visual (nunca
-- autorização), exclui apenas empresas 'cancelada' (mesmo corte de
-- list_company_users/can_access_company, m1f_s11). Manager: precisa de
-- membership MANAGER ativa E can_access_company() na própria empresa
-- (mesmo gate de list_company_users — uma empresa suspensa/cancelada
-- também bloqueia a leitura histórica do próprio Manager, por consistência
-- com o padrão já estabelecido, não uma decisão nova desta migration);
-- p_company_id recebido de um Manager é IGNORADO silenciosamente (mesmo
-- comportamento de list_company_users: o escopo é sempre a própria
-- empresa, nunca o parâmetro do cliente); role é SEMPRE forçado a 'seller'
-- para Manager, independente de p_role (§4/§24.14 do design: Manager nunca
-- pode visualizar Managers inativos — restrição nova desta RPC, sem
-- equivalente em list_company_users, onde Manager vê os dois papéis).
--
-- Nunca retorna lifecycle_status = 'active': o filtro `not cm.is_active`
-- é incondicional na query (não depende de p_lifecycle) — a única forma de
-- estreitar ainda mais é p_lifecycle = 'suspended' OU 'offboarded'.
-- p_lifecycle = 'active' explícito é rejeitado com invalid_lifecycle (nunca
-- silenciosamente ignorado — evita a falsa impressão de que o filtro foi
-- aplicado quando na verdade seria vazio).
--
-- Catálogo de erros: só códigos com caminho real (mesmo critério de
-- list_company_users). invalid_role/company_not_found/
-- company_not_operational NÃO são implementados propositalmente:
-- p_role é enum (Postgres já rejeita valor inválido antes da função
-- rodar); empresa inexistente/não operacional apenas filtra (0 linhas),
-- nunca lança — revelar a distinção via erro vazaria a existência de uma
-- empresa fora do escopo do chamador, o oposto do que a leitura
-- administrativa deve proteger.
--
-- Índice novo: company_memberships_inactive_updated_id_idx, espelhando
-- company_memberships_active_created_id_idx (m1f_s5a2) mas para o
-- complemento (`where not is_active`) e pela coluna de cursor desta RPC
-- (updated_at). Nenhuma tabela/coluna/enum/trigger/policy/grant de tabela
-- novos — só a função e este índice, exatamente o que §7 da tarefa permite.

begin;

create function public.list_inactive_company_users(
  p_limit integer default 25,
  p_cursor_updated_at timestamptz default null,
  p_cursor_membership_id uuid default null,
  p_search text default null,
  p_company_id uuid default null,
  p_role public.company_role default null,
  p_lifecycle public.membership_lifecycle_status default null
) returns table (
  profile_id uuid,
  membership_id uuid,
  name text,
  email text,
  company_id uuid,
  company_name text,
  company_role public.company_role,
  lifecycle_status public.membership_lifecycle_status,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_is_super_admin boolean;
  v_manager_company_id uuid;
  v_search text;
  v_search_pattern text;
begin
  if auth.uid() is null then
    raise insufficient_privilege using message = 'unauthenticated';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise invalid_parameter_value using message = 'invalid_limit';
  end if;

  if (p_cursor_updated_at is null) is distinct from (p_cursor_membership_id is null) then
    raise invalid_parameter_value using message = 'invalid_cursor';
  end if;

  if p_search is not null and length(p_search) > 100 then
    raise invalid_parameter_value using message = 'invalid_search';
  end if;

  if p_lifecycle is not null and p_lifecycle = 'active' then
    raise invalid_parameter_value using message = 'invalid_lifecycle';
  end if;

  v_is_super_admin := public.is_platform_super_admin();

  if not v_is_super_admin then
    v_manager_company_id := public.current_membership_company_id();
    if v_manager_company_id is null
       or public.current_membership_role() is distinct from 'manager'
       or not public.can_access_company(v_manager_company_id) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  v_search := nullif(trim(p_search), '');
  if v_search is not null then
    v_search_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    cm.profile_id,
    cm.id as membership_id,
    p.name,
    p.email,
    cm.company_id,
    c.name as company_name,
    cm.role as company_role,
    cm.lifecycle_status,
    cm.is_active,
    cm.created_at,
    cm.updated_at
  from public.company_memberships cm
  join public.profiles p on p.id = cm.profile_id
  join public.companies c on c.id = cm.company_id
  where not cm.is_active
    and p.is_active
    and (case
           when v_is_super_admin then c.status <> 'cancelada'
           else true
         end)
    and (case
           when v_is_super_admin then (p_company_id is null or cm.company_id = p_company_id)
           else cm.company_id = v_manager_company_id
         end)
    and (case
           when v_is_super_admin then (p_role is null or cm.role = p_role)
           else cm.role = 'seller'
         end)
    and (p_lifecycle is null or cm.lifecycle_status = p_lifecycle)
    and (
      v_search_pattern is null
      or p.name ilike v_search_pattern escape '\'
      or p.email ilike v_search_pattern escape '\'
    )
    and (
      p_cursor_updated_at is null
      or (cm.updated_at, cm.id) < (p_cursor_updated_at, p_cursor_membership_id)
    )
  order by cm.updated_at desc, cm.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_inactive_company_users(
  integer, timestamptz, uuid, text, uuid, public.company_role, public.membership_lifecycle_status
) from public;
revoke all on function public.list_inactive_company_users(
  integer, timestamptz, uuid, text, uuid, public.company_role, public.membership_lifecycle_status
) from anon;
grant execute on function public.list_inactive_company_users(
  integer, timestamptz, uuid, text, uuid, public.company_role, public.membership_lifecycle_status
) to authenticated;

create index company_memberships_inactive_updated_id_idx
  on public.company_memberships (updated_at desc, id desc)
  where not is_active;

commit;
