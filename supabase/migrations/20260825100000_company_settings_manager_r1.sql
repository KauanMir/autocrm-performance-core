-- COMPANY-SETTINGS-R1-EXEC — RPC estreita de edição de configurações
-- operacionais da empresa (fecha o achado BLOCKER do
-- PILOT-UI-TRUTH-AUDIT-A1: Ajustes > Empresa usava CompanyService fixture
-- local, sem nenhum contrato remoto real). Contrato fechado, mesmo espírito
-- de update_profile_name (m1f_s5b)/activate_company
-- (platform_company_activation_a1): altera SOMENTE public.companies.phone e
-- public.companies.timezone — nunca name/trade_name/cnpj/status/
-- created_by_profile_id/created_at (decisão de produto do
-- COMPANY-SETTINGS-A1-PRECHECK §8/§9/§10: name/cnpj ficam read-only na V1
-- por falta de contrato de edição segura — nenhuma coluna nova, nenhuma
-- policy nova em public.companies).
--
-- Autorização (§4 do EXEC):
--   A. Manager com membership ATIVA cujo company_id é EXATAMENTE
--      p_company_id (nunca outra empresa, nunca aceito cru do client sem
--      revalidar contra current_membership_company_id()/
--      current_membership_role() — mesmos helpers de m1f_s2_02, já usados
--      por update_profile_name).
--   B. Platform Super Admin (is_platform_super_admin()) — para uma
--      p_company_id EXPLÍCITA. A UI de Ajustes genérico não oferece esta
--      aba para Super Admin ainda (sem company context, §13/§19/§24/§25 do
--      PRECHECK) — este ramo existe só para deixar a RPC pronta para o
--      futuro "Empresas -> selecionar empresa -> entrar no CRM daquela
--      empresa", sem exigir uma segunda migration quando esse modo chegar.
--   Seller: nunca autorizado (nem da própria empresa). Sem sessão: nunca
--   autorizado. Manager de OUTRA empresa: nunca autorizado, mesmo
--   fornecendo o próprio id de empresa como parâmetro (a checagem usa
--   current_membership_company_id() do ATOR real, nunca o que o client diz
--   que é sua empresa).
--
-- Status (§5): permitido somente em 'implantacao'/'ativa' — bloqueado em
-- 'suspensa'/'cancelada', para QUALQUER ator (Super Admin incluído,
-- diferente de can_access_company()/is_manager_or_platform(), cujo ramo de
-- Super Admin tolera 'suspensa' para fins de leitura/suporte — esta RPC
-- escreve, então usa uma regra própria e mais estrita, checada depois do
-- lock de linha, nunca delegada a can_access_company()).
--
-- Timezone (§8): obrigatório, trim, nunca vazio. Validação IANA real via
-- `perform now() at time zone`, EXATAMENTE a mesma técnica de
-- create_company (m1f_s3a) — o Postgres resolve o nome usando o tzdata do
-- servidor; nome inválido vira SQLSTATE 22023 (invalid_parameter_value),
-- propagado tal como é, nunca reescrito. Nunca confia em validação do
-- browser.
--
-- Phone (§7): trim; vazio (após trim) vira NULL — diferente de
-- create_company (que preserva string vazia como veio, por decisão
-- explícita documentada em m1f_s3a), mas aqui é uma decisão própria e
-- deliberada desta RPC: "salvar telefone em branco" deve limpar o campo
-- (NULL), não persistir uma string vazia visualmente idêntica a NULL na
-- UI. cnpj/name não são tocados por esta RPC, então a divergência de
-- comportamento entre as duas RPCs não é uma inconsistência real — cada
-- uma normaliza só os campos que ela própria escreve.
--
-- Audit (§9): public.audit_log, actor_profile_id=auth.uid() (ator real,
-- nunca "efetivo"), action='company_settings_updated', entity_type=
-- 'company', before_data/after_data contendo SOMENTE phone/timezone —
-- nunca name/cnpj/status (que esta RPC nem lê para esse fim).
--
-- Grants (§10): SECURITY DEFINER, search_path='' fixo, EXECUTE só para
-- authenticated (autorização é 100% interna, via is_platform_super_admin()/
-- current_membership_company_id()/current_membership_role() — nunca um
-- grant por role do Postgres). Nenhum UPDATE/INSERT/DELETE direto é
-- concedido em public.companies — a única via de escrita continua sendo
-- esta RPC (ou create_company/activate_company, para os campos que cada
-- uma já cobre). RLS de companies: ZERO alteração.
begin;

create function public.update_company_settings(
  p_company_id uuid,
  p_phone      text,
  p_timezone   text
) returns public.companies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company    public.companies;
  v_authorized boolean;
  v_phone      text;
  v_timezone   text;
  v_before     jsonb;
  v_after      jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  -- Autorização ANTES de qualquer leitura/lock da linha-alvo (mesmo padrão
  -- de activate_company/update_profile_name). Ramo Manager: current_
  -- membership_company_id()/current_membership_role() derivam SEMPRE da
  -- identidade real do ator (auth.uid()) — nunca de p_company_id, que é só
  -- o alvo declarado pelo client. Um Manager de outra empresa nunca bate
  -- aqui, mesmo enviando a p_company_id "certa" por engano/malícia.
  v_authorized := public.is_platform_super_admin() or (
    p_company_id is not null
    and public.current_membership_company_id() = p_company_id
    and public.current_membership_role() = 'manager'::public.company_role
  );

  if not v_authorized then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- Mesmo tratamento de activate_company: um Super Admin autorizado que
  -- envia p_company_id NULL cai aqui, nunca no ramo de sucesso — nunca há
  -- "empresa implícita" (§24 do PRECHECK: nenhum fallback para primeira/
  -- última empresa).
  if p_company_id is null then
    raise no_data_found using message = 'company_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = p_company_id for update;
  if v_company.id is null then
    raise no_data_found using message = 'company_not_found';
  end if;

  -- Bloqueia suspensa/cancelada para QUALQUER ator, Super Admin incluído
  -- (§5 do EXEC) — regra própria desta RPC, não delegada a
  -- can_access_company()/is_manager_or_platform() (cujo ramo Super Admin é
  -- mais permissivo, apropriado para leitura/suporte, não para escrita).
  if v_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_status_conflict';
  end if;

  v_phone := nullif(btrim(coalesce(p_phone, '')), '');

  v_timezone := btrim(coalesce(p_timezone, ''));
  if v_timezone = '' then
    raise invalid_parameter_value using message = 'timezone_required';
  end if;
  -- Validação IANA real, mesma técnica de create_company — determinística,
  -- sem rede, sem lista própria para manter sincronizada com o tzdata.
  perform now() at time zone v_timezone;

  v_before := jsonb_build_object('phone', v_company.phone, 'timezone', v_company.timezone);
  v_after  := jsonb_build_object('phone', v_phone, 'timezone', v_timezone);

  update public.companies
     set phone    = v_phone,
         timezone = v_timezone
   where id = v_company.id
  returning * into v_company;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'company_settings_updated', 'company', v_company.id::text, 'success', null, v_before, v_after, 'rpc');

  return v_company;
end;
$$;

revoke all on function public.update_company_settings(uuid, text, text) from public;
revoke all on function public.update_company_settings(uuid, text, text) from anon;
revoke all on function public.update_company_settings(uuid, text, text) from authenticated;
grant execute on function public.update_company_settings(uuid, text, text) to authenticated;

commit;
