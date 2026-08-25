-- COMPANY-IDENTITY-LOGO-R1-EXEC — identidade visual real por empresa: uma
-- coluna nova (companies.logo_path), um bucket de Storage público
-- (company-logos), duas policies de Storage (INSERT/DELETE, sem UPDATE —
-- paths versionados, nunca upsert no mesmo objeto) e uma RPC estreita
-- (update_company_logo), mesmo espírito de update_company_settings
-- (company_settings_manager_r1): SECURITY DEFINER, search_path='',
-- autorização 100% interna via current_membership_company_id()/
-- current_membership_role()/is_platform_super_admin() — nunca aceita
-- p_company_id do client como prova de identidade.
--
-- Autorização (§13 do EXEC), idêntica em espírito a update_company_settings:
--   A. Manager com membership ATIVA cujo company_id é EXATAMENTE
--      p_company_id.
--   B. Platform Super Admin, para uma p_company_id EXPLÍCITA (nenhuma UI
--      usa este ramo ainda — pronto para o futuro "Empresas -> selecionar
--      empresa", mesmo motivo documentado em update_company_settings).
--   Seller: nunca autorizado. Sem sessão: nunca autorizado. Manager de
--   OUTRA empresa: nunca autorizado, mesmo enviando o próprio p_company_id
--   real como parâmetro (a checagem usa a identidade real do ator).
--
-- Status (§14): permitido somente em 'implantacao'/'ativa' — mesma regra
-- (mais estrita que can_access_company) já usada por update_company_settings,
-- inclusive para Super Admin.
--
-- Path (§15): quando p_logo_path não é NULL, precisa ter EXATAMENTE 3
-- segmentos '<company_id>/logos/<filename>', o primeiro segmento igual
-- (comparação de TEXTO, nunca cast de entrada não confiável) a
-- p_company_id::text, e o segundo segmento literal 'logos'. Nenhuma URL
-- completa é aceita (RPC recebe somente object path).
--
-- Remoção (§16): p_logo_path = NULL é sempre permitido (empresa sem logo).
--
-- Audit (§17): public.audit_log, action='company_logo_updated',
-- before_data/after_data contendo SOMENTE logo_path — mesmo formato de
-- update_company_settings (before/after ± um campo).
--
-- Storage (§7-§11): bucket company-logos é PÚBLICO (§3 — logo corporativa
-- não é dado sensível, sem necessidade de signed URL). Leitura pública
-- (HTTP GET .../storage/v1/object/public/company-logos/...) passa por uma
-- rota dedicada do serviço Storage que serve buckets public sem consultar
-- RLS de storage.objects — por isso nenhuma policy de SELECT "aberta"
-- (using (true)) é criada (§11).
--
-- ACHADO (verificado empiricamente durante a validação local desta etapa,
-- não estava previsto no EXEC original): Postgres exige uma policy de
-- SELECT (ou ALL) aplicável, além da própria policy de UPDATE/DELETE, para
-- que um DELETE consiga sequer ENXERGAR a linha-alvo — sem nenhuma policy
-- de SELECT, um Manager legítimo apagando o próprio objeto (ou o Super
-- Admin apagando um objeto de empresa explícita) resulta em "DELETE 0",
-- silenciosamente, mesmo com a policy de DELETE correta e satisfeita (raiz
-- confirmada com EXPLAIN: sem SELECT aplicável o planner reduz a query
-- inteira a `One-Time Filter: false`). Por isso as duas policies de SELECT
-- abaixo existem — com o MESMO escopo das policies de DELETE (Manager
-- própria empresa / Super Admin com can_access_company() explícito),
-- nunca `using (true)`: elas não ampliam quem pode LER via Postgres direto
-- além de quem já pode escrever/remover na mesma pasta; a leitura pública
-- de qualquer visitante continua vindo exclusivamente da rota HTTP pública
-- do Storage, que não usa RLS.
--
-- INSERT/DELETE exigem Manager escrevendo/removendo SOMENTE na própria
-- pasta (<company_id>/logos/...) ou Super Admin com can_access_company()
-- explícito na mesma pasta-alvo — nunca UPDATE (§9: paths versionados
-- tornam upsert desnecessário, menor superfície).
begin;

-- ── 1. COLUNA ────────────────────────────────────────────────────────────
alter table public.companies
  add column logo_path text null;

-- ── 2. BUCKET (público, contrato de MIME/tamanho no servidor) ───────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/webp']
);

-- ── 3. STORAGE POLICIES ───────────────────────────────────────────────────
-- Nenhuma policy de UPDATE (§9: paths versionados, INSERT novo + DELETE
-- antigo é o único fluxo). SELECT existe (achado documentado acima) mas
-- SEMPRE com o mesmo escopo de DELETE — nunca `using (true)`: a leitura
-- pública real vem da rota HTTP pública do Storage, não de RLS.

-- Manager: escreve SOMENTE em <própria company_id>/logos/<filename> — exige
-- exatamente 2 segmentos de pasta (company_id, 'logos'), nunca subpastas
-- adicionais. Comparação sempre TEXTO->TEXTO (current_membership_company_id()
-- convertido para text), nunca um cast do segmento de path (não confiável,
-- vindo do client) para uuid.
create policy "company_logos_insert_manager"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'company-logos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'logos'
  and public.current_membership_role() = 'manager'::public.company_role
  and public.current_membership_company_id() is not null
  and (storage.foldername(name))[1] = public.current_membership_company_id()::text
);

create policy "company_logos_delete_manager"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'company-logos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'logos'
  and public.current_membership_role() = 'manager'::public.company_role
  and public.current_membership_company_id() is not null
  and (storage.foldername(name))[1] = public.current_membership_company_id()::text
);

-- Platform Super Admin: companyId EXPLÍCITO no path, validado via
-- can_access_company() — nenhuma UI usa este ramo ainda (§10/§25 do EXEC),
-- mas a policy já existe para não exigir uma segunda migration quando o modo
-- "Super Admin escolhe empresa" chegar. O primeiro segmento só é
-- CAST para uuid depois de confirmado por regex — um path malicioso não
-- solicitável (ex.: 'not-a-uuid/logos/x.png') nunca chega a lançar
-- exceção de cast dentro da checagem de policy, apenas nega (false).
create policy "company_logos_insert_super_admin"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'company-logos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'logos'
  and public.is_platform_super_admin()
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.can_access_company(((storage.foldername(name))[1])::uuid)
);

create policy "company_logos_delete_super_admin"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'company-logos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'logos'
  and public.is_platform_super_admin()
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.can_access_company(((storage.foldername(name))[1])::uuid)
);

-- SELECT: MESMO escopo de DELETE acima — exigido pelo Postgres para que o
-- DELETE consiga localizar a própria linha-alvo (achado documentado no
-- cabeçalho desta seção). Nunca `using (true)`: a leitura pública de
-- qualquer visitante continua vindo só da rota HTTP pública do Storage.
create policy "company_logos_select_manager"
on storage.objects for select
to authenticated
using (
  bucket_id = 'company-logos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'logos'
  and public.current_membership_role() = 'manager'::public.company_role
  and public.current_membership_company_id() is not null
  and (storage.foldername(name))[1] = public.current_membership_company_id()::text
);

create policy "company_logos_select_super_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'company-logos'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[2] = 'logos'
  and public.is_platform_super_admin()
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.can_access_company(((storage.foldername(name))[1])::uuid)
);

-- ── 4. RPC update_company_logo ───────────────────────────────────────────
create function public.update_company_logo(
  p_company_id uuid,
  p_logo_path  text
) returns public.companies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company    public.companies;
  v_authorized boolean;
  v_logo_path  text;
  v_segments   text[];
  v_before     jsonb;
  v_after      jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  -- Mesma ordem de update_company_settings: autorização ANTES de qualquer
  -- leitura/lock da linha-alvo, sempre derivada da identidade REAL do ator
  -- (nunca de p_company_id, que é só o alvo declarado pelo client).
  v_authorized := public.is_platform_super_admin() or (
    p_company_id is not null
    and public.current_membership_company_id() = p_company_id
    and public.current_membership_role() = 'manager'::public.company_role
  );

  if not v_authorized then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if p_company_id is null then
    raise no_data_found using message = 'company_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = p_company_id for update;
  if v_company.id is null then
    raise no_data_found using message = 'company_not_found';
  end if;

  -- Mesma regra estrita de update_company_settings (§14 do EXEC): escrita
  -- bloqueada em suspensa/cancelada para QUALQUER ator, Super Admin incluso.
  if v_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_status_conflict';
  end if;

  v_logo_path := nullif(btrim(coalesce(p_logo_path, '')), '');

  -- §15: NULL sempre permitido (remoção). Não-NULL precisa bater
  -- EXATAMENTE no contrato '<company_id>/logos/<filename>' — 3 segmentos,
  -- primeiro segmento igual a p_company_id (texto, nunca cast do valor
  -- vindo do client), segundo segmento literal 'logos', terceiro segmento
  -- (filename) não vazio e sem separador de path dentro dele. Path com '..'
  -- ou esquema de URL ('scheme://') nunca é aceito — RPC só aceita object
  -- path, nunca URL completa (§15, "RPC NÃO aceita URL completa").
  if v_logo_path is not null then
    v_segments := string_to_array(v_logo_path, '/');

    if array_length(v_segments, 1) <> 3
       or v_segments[1] <> p_company_id::text
       or v_segments[2] <> 'logos'
       or v_segments[3] = ''
       or position('..' in v_logo_path) > 0
       or v_logo_path ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
    then
      raise invalid_parameter_value using message = 'logo_path_invalid';
    end if;
  end if;

  v_before := jsonb_build_object('logo_path', v_company.logo_path);
  v_after  := jsonb_build_object('logo_path', v_logo_path);

  update public.companies
     set logo_path = v_logo_path
   where id = v_company.id
  returning * into v_company;

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'company_logo_updated', 'company', v_company.id::text, 'success', null, v_before, v_after, 'rpc');

  return v_company;
end;
$$;

revoke all on function public.update_company_logo(uuid, text) from public;
revoke all on function public.update_company_logo(uuid, text) from anon;
revoke all on function public.update_company_logo(uuid, text) from authenticated;
grant execute on function public.update_company_logo(uuid, text) to authenticated;

commit;
