-- M1-F S5-A2 — RPC segura e paginada de listagem de usuários da empresa
-- (§22 do design, docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md).
--
-- Arquitetura: RPC SECURITY DEFINER estreita, não SELECT direto ampliado
-- sobre profiles/company_memberships (§22.5) — evita grants amplos,
-- centraliza autorização/paginação num único ponto, não depende da policy
-- legada profiles_update_admin (removida em S5-A1). auth.users nunca é
-- lido; profiles.role legado e platform_role nunca são retornados.
--
-- Reconciliação decidida antes desta migration (M1-F S5-A2, aprovada
-- explicitamente):
--   A. Paginação sem has_more/next_cursor/total_count/sentinela: a RPC
--      retorna no máximo p_limit linhas; a existência de próxima página só
--      é confirmada pela chamada seguinte (uma chamada vazia ao final é
--      esperada, não um erro). Substitui a sugestão anterior de
--      "p_limit + 1" — mais simples, sem contradição de contrato.
--   B. Super Admin com membership NÃO é estruturalmente impossível — prova
--      encontrada em accept_invite() (20260720142000...:588-676, ramo de
--      aceite manager/seller): nenhuma checagem bloqueia um profile já
--      platform_role='super_admin' de também aceitar um convite de
--      manager/seller e ganhar uma company_membership ativa (o bloqueio
--      inverso, impedir que um MANAGER/SELLER vire Super Admin mantendo
--      membership ativa, é o único lado coberto, linha ~578-584,
--      'membership_conflict'). Por isso esta RPC nunca trata esse cenário
--      como impossível: ela consulta exclusivamente company_memberships
--      (nunca profiles.platform_role) para montar as linhas — um Super
--      Admin com membership ativa aparece exatamente uma vez, pela própria
--      membership, como qualquer outro membro; um Super Admin sem
--      membership simplesmente não gera nenhuma linha seleção alguma (não
--      há UNION nem caminho alternativo que o adicione por possuir
--      platform_role) — nenhuma duplicação possível por construção.
--
-- Contrato de empresa (§22.9, reutilizando o helper já existente sem
-- inventar regra nova): can_access_company() (m1f_s11) já nega Super Admin
-- somente para status='cancelada', e nega Manager/Seller a menos que a
-- empresa esteja em ('ativa','implantacao') — 'suspensa' já bloqueia
-- Manager mesmo com membership ativa, contrato pré-existente. Esta RPC usa
-- exatamente essa mesma regra: Super Admin filtra companies.status <>
-- 'cancelada' (visão global, §8 do design); Manager é gated no início da
-- função via can_access_company(v_manager_company_id) — mesma função usada
-- em toda a base, nenhuma duplicação de lógica de status.
begin;

create function public.list_company_users(
  p_limit integer default 25,
  p_cursor_created_at timestamptz default null,
  p_cursor_membership_id uuid default null,
  p_search text default null,
  p_company_id uuid default null,
  p_role public.company_role default null
) returns table (
  profile_id uuid,
  membership_id uuid,
  name text,
  email text,
  company_id uuid,
  company_name text,
  company_role public.company_role,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_super_admin boolean;
  v_manager_company_id uuid;
  v_search text;
  v_search_pattern text;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise invalid_parameter_value using message = 'invalid_limit';
  end if;

  if (p_cursor_created_at is null) is distinct from (p_cursor_membership_id is null) then
    raise invalid_parameter_value using message = 'invalid_cursor';
  end if;

  if p_search is not null and length(p_search) > 100 then
    raise invalid_parameter_value using message = 'invalid_search';
  end if;

  v_is_super_admin := public.is_platform_super_admin();

  if not v_is_super_admin then
    v_manager_company_id := public.current_membership_company_id();

    if v_manager_company_id is null
       or public.current_membership_role() is distinct from 'manager'::public.company_role
       or not public.can_access_company(v_manager_company_id) then
      raise insufficient_privilege using message = 'forbidden';
    end if;
  end if;

  -- busca: string vazia (apos trim) equivale a NULL (busca desativada);
  -- escape manual de %, _ e \ antes de montar o padrao ILIKE — sem SQL
  -- dinamico, sem concatenacao insegura (o padrao inteiro e passado como
  -- parametro vinculado ao ILIKE, nunca interpolado em texto de comando).
  v_search := nullif(btrim(p_search), '');
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
    cm.created_at
  from public.company_memberships cm
  join public.profiles p on p.id = cm.profile_id
  join public.companies c on c.id = cm.company_id
  where cm.is_active
    and p.is_active
    and c.status <> 'cancelada'
    and (
      case
        when v_is_super_admin then (p_company_id is null or cm.company_id = p_company_id)
        else cm.company_id = v_manager_company_id
      end
    )
    and (p_role is null or cm.role = p_role)
    and (v_search_pattern is null or p.name ilike v_search_pattern escape '\' or p.email ilike v_search_pattern escape '\')
    and (
      p_cursor_created_at is null
      or (cm.created_at, cm.id) < (p_cursor_created_at, p_cursor_membership_id)
    )
  order by cm.created_at desc, cm.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_company_users(
  integer, timestamptz, uuid, text, uuid, public.company_role
) from public;
revoke all on function public.list_company_users(
  integer, timestamptz, uuid, text, uuid, public.company_role
) from anon;
grant execute on function public.list_company_users(
  integer, timestamptz, uuid, text, uuid, public.company_role
) to authenticated;

-- Índice — decisão registrada, não especulativa: EXPLAIN ANALYZE local com
-- fixtures sintéticas transacionais (8000 memberships, cenário global e
-- multiempresa de 20 empresas, nunca commitadas) mostrou:
--   Sem índice novo — listagem global (Super Admin, sem filtro de
--   empresa): Seq Scan + Sort da tabela inteira, ~7.2ms a 8000 linhas —
--   degrada linearmente com o total de memberships da plataforma inteira,
--   não com o tamanho de uma empresa.
--   Com este índice — mesma consulta: Index Scan direto na ordem já
--   pedida, ~0.35ms (~20x). Também acelera a consulta do Manager (escopada
--   por empresa) de ~1.5ms para ~0.47ms, porque o LIMIT pode parar cedo na
--   ordem do índice em vez de precisar ordenar depois de filtrar.
--   Um segundo índice composto (company_id, created_at, id) foi testado
--   separadamente e traria a consulta do Manager de ~0.47ms para ~0.19ms —
--   ganho marginal (ambos já sub-milissegundo) que não justifica o custo
--   permanente de manutenção de um segundo índice em toda escrita de
--   company_memberships; não criado nesta migração.
create index company_memberships_active_created_id_idx
  on public.company_memberships (created_at desc, id desc)
  where is_active;

commit;
