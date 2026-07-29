-- M1-F S8-C2-C1 — resolver interno de contexto de mutation de Leads
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md §31/§32/§33/§34
-- (decisões humanas aprovadas). Migration puramente aditiva — nenhuma
-- tabela, policy ou RPC existente é alterada aqui (create_lead/update_lead/
-- check_lead_phone_duplicate são migradas na migration seguinte,
-- 20260729110000).
--
-- Único ponto de decisão de "qual empresa e qual ator" para as três RPCs de
-- mutation/duplicidade de Leads que vão consumi-lo — nunca reescrito três
-- vezes. Nunca vira API pública de frontend (nenhum GRANT a authenticated):
-- é chamado exclusivamente de dentro das RPCs SECURITY DEFINER que o
-- consomem, cujo owner (o mesmo papel que roda as migrations) já tem
-- privilégio implícito de superusuário — nenhuma GRANT EXECUTE é necessária
-- para esse caminho interno funcionar. Os testes pgTAP chamam este resolver
-- diretamente como `postgres` (antes de qualquer `set local role
-- authenticated`), o que já respeita `auth.uid()` via `request.jwt.claims` —
-- não precisa de GRANT para ser exercitado em teste.

begin;

-- ── resolve_lead_mutation_context(p_company_id, p_read_only) ────────────
-- Contrato (§34.1 do design):
--   parte sempre de auth.uid(); nunca aceita profile_id/role/seller_id do
--   cliente; profile globalmente inativo -> forbidden.
--
--   p_read_only (default false): as três RPCs consumidoras têm status
--   permitido DIFERENTE para Super Admin. create_lead/update_lead chamam
--   com o default (false — verdadeira mutation, exige ativa/implantacao).
--   check_lead_phone_duplicate é LEITURA (mesmo fazendo parte do C1 por
--   compatibilidade com o fluxo de criação/edição) e chama com true — o
--   Super Admin pode checar duplicidade em qualquer status, inclusive
--   suspensa/cancelada (histórico), sem nunca poder escrever. Manager/
--   Seller NUNCA são afetados por este parâmetro — para eles a regra é
--   sempre "somente empresa ativa", em leitura ou escrita.
--
--   SUPER ADMIN (is_platform_super_admin() = true):
--     p_company_id null                    -> company_required
--     empresa inexistente                  -> company_not_found
--     p_read_only=false, status ativa/
--     implantacao                          -> autorizado
--     p_read_only=false, status suspensa/
--     cancelada                            -> company_read_only
--     p_read_only=true, qualquer status    -> autorizado (leitura histórica)
--     resolved_company_id = p_company_id sempre; actor_seller_id sempre
--     null (Super Admin nunca tem seller próprio).
--
--   MANAGER/SELLER (membership ativa, via current_membership_company_id()/
--   current_membership_role()) — p_company_id é TOTALMENTE ignorado, nunca
--   lido nesta branch, com OU sem p_read_only:
--     sem membership ativa         -> forbidden
--     status da empresa da
--     membership <> 'ativa'        -> forbidden (implantação/suspensa/
--                                      cancelada negadas — mais restritivo
--                                      que Pipeline/can_access_company, que
--                                      aceitam implantação; mesma regra já
--                                      aprovada para leads_select no S8-C2-B1)
--     Seller sem seller ativo
--     resolvido (current_profile_
--     seller_id_for_company)       -> forbidden
--     Manager                      -> actor_seller_id null
--     Seller                       -> actor_seller_id = o próprio, nunca
--                                      escolhido pelo cliente
--
--   Qualquer outro caso (sem profile, profile inativo) -> forbidden
--   (coberto pela checagem inicial).
--
-- Retorno mínimo, sem dado sensível: identidade do ator, o "papel" efetivo
-- resolvido, o seller do próprio ator quando aplicável, a empresa resolvida
-- e o status dela (para as RPCs chamadoras não precisarem reconsultar
-- companies).
create function public.resolve_lead_mutation_context(
  p_company_id uuid default null,
  p_read_only  boolean default false
) returns table (
  actor_profile_id     uuid,
  actor_kind           text,
  actor_seller_id      text,
  resolved_company_id  uuid,
  company_status       public.company_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id         uuid;
  v_is_super_admin     boolean;
  v_membership_company uuid;
  v_membership_role    public.company_role;
  v_status             public.company_status;
  v_seller_id          text;
begin
  select p.id into v_profile_id
    from public.profiles p
    where p.id = auth.uid() and p.is_active;
  if v_profile_id is null then
    raise exception 'forbidden';
  end if;

  v_is_super_admin := public.is_platform_super_admin();

  if v_is_super_admin then
    if p_company_id is null then
      raise exception 'company_required';
    end if;

    select c.status into v_status
      from public.companies c
      where c.id = p_company_id;
    if v_status is null then
      raise exception 'company_not_found';
    end if;
    if not p_read_only and v_status not in ('ativa', 'implantacao') then
      raise exception 'company_read_only';
    end if;

    return query select v_profile_id, 'super_admin'::text, null::text, p_company_id, v_status;
    return;
  end if;

  -- Manager/Seller: p_company_id nunca é lido a partir daqui — a empresa
  -- vem exclusivamente da membership ativa do próprio ator.
  v_membership_company := public.current_membership_company_id();
  v_membership_role := public.current_membership_role();
  if v_membership_company is null or v_membership_role is null then
    raise exception 'forbidden';
  end if;

  select c.status into v_status
    from public.companies c
    where c.id = v_membership_company;
  if v_status is distinct from 'ativa' then
    raise exception 'forbidden';
  end if;

  if v_membership_role = 'seller' then
    v_seller_id := public.current_profile_seller_id_for_company(v_membership_company);
    if v_seller_id is null then
      raise exception 'forbidden';
    end if;
    return query select v_profile_id, 'seller'::text, v_seller_id, v_membership_company, v_status;
    return;
  end if;

  return query select v_profile_id, 'manager'::text, null::text, v_membership_company, v_status;
end;
$$;

-- ── revoke/grant explícitos (mesma transação) ───────────────────────────
-- Nenhum GRANT a authenticated/anon/public de propósito — resolver interno,
-- nunca chamado diretamente pelo frontend (ver nota de topo). Chamado
-- somente por outras funções SECURITY DEFINER cujo owner já tem privilégio
-- implícito de executar qualquer função do schema.
revoke all on function public.resolve_lead_mutation_context(uuid, boolean) from public;
revoke all on function public.resolve_lead_mutation_context(uuid, boolean) from anon;
revoke all on function public.resolve_lead_mutation_context(uuid, boolean) from authenticated;

commit;
