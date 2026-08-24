-- PLATFORM-COMPANY-ACTIVATION-A1 — lifecycle mínimo de companies.status
-- (implantacao -> ativa), acionado exclusivamente por Super Admin de
-- plataforma. Fecha o gap descrito em m1f_s3a_company_creation_backend.sql
-- ("UPDATE de status é etapa futura") e m1f_s11_company_lifecycle_gap.sql
-- ("qualquer RPC de transição de status... fora de escopo aqui"), achado no
-- smoke público do primeiro piloto real (Rcar Seminovos Gama presa em
-- 'implantacao' sem nenhum caminho para 'ativa').
--
-- ESCOPO ESTRITO: somente a transição implantacao -> ativa. suspend/
-- reactivate/cancel permanecem fora de escopo (mesma decisão já registrada
-- em m1f_s11) — nenhuma dessas transições é criada aqui. Nenhum enum novo,
-- nenhuma tabela nova, nenhuma policy RLS nova: company_status e
-- public.audit_log já existem desde m1f_s11/m1f_s4a1; audit_log.action é
-- texto livre (§14.2 do design), então 'company_activated' não exige
-- alteração de schema.
--
-- CRÍTICO: esta migration NÃO toca nenhum gate comercial existente
-- (leads_select, list_current_company_seller_labels,
-- list_assignable_company_sellers, tasks/visits/deals/sales RLS) — todos
-- continuam exigindo companies.status = 'ativa' exatamente como antes. A
-- única forma de uma empresa deixar de bloquear essas leituras continua
-- sendo esta RPC (ou UPDATE direto por um operador, fora do produto).
--
-- Autorização: is_platform_super_admin() apenas — nunca company membership
-- do ator (Super Admin nunca tem membership ativa, por design; §31.5 do
-- design M1-F). Padrão estrutural (lock FOR UPDATE, idempotência, audit_log
-- before/after) espelha suspend_membership/reactivate_membership (m1f_s6b),
-- simplificado: sem membership/seller envolvidos, sem p_note (V1 — fora de
-- escopo deste lote, mesma decisão do EXEC).
begin;

create function public.activate_company(
  p_company_id uuid
) returns public.companies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
  v_before  jsonb;
  v_after   jsonb;
begin
  -- Autorização primeiro, antes de qualquer leitura/lock — mesmo padrão de
  -- create_company (m1f_s3a): Super Admin não precisa de activeMembership,
  -- a empresa nunca é inferida por membership do ator.
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if p_company_id is null then
    raise no_data_found using message = 'company_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = p_company_id for update;
  if v_company.id is null then
    raise no_data_found using message = 'company_not_found';
  end if;

  -- Idempotente: já ativa -> retorna o estado atual, sem erro e SEM segunda
  -- entrada de audit_log (nunca duplicar o evento de ativação).
  if v_company.status = 'ativa'::public.company_status then
    return v_company;
  end if;

  -- Único estado de origem válido é 'implantacao'. suspensa/cancelada
  -- exigiriam uma RPC de reversão própria (fora de escopo aqui) — nunca
  -- reativadas implicitamente por esta função.
  if v_company.status <> 'implantacao'::public.company_status then
    raise using message = 'company_status_conflict';
  end if;

  v_before := jsonb_build_object('status', v_company.status);

  update public.companies
     set status = 'ativa'
   where id = v_company.id
  returning * into v_company;

  v_after := jsonb_build_object('status', v_company.status);

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'company_activated', 'company', v_company.id::text, 'success', null, v_before, v_after, 'rpc');

  return v_company;
end;
$$;

revoke all on function public.activate_company(uuid) from public;
revoke all on function public.activate_company(uuid) from anon;
revoke all on function public.activate_company(uuid) from authenticated;
grant execute on function public.activate_company(uuid) to authenticated;

commit;
