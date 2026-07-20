-- M1-F / Módulo 1 — m1f_s3a: backend de criação e listagem de empresas
-- (primeiro subestágio do S3 oficial)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §6.4,
-- §7.4, §8, §9.9, §14, §16 (linha S3). Depende de m1f_s1_01/02, m1f_s2_01/
-- 015/02, m1f_s11.
--
-- ESCOPO ESTRITO (S3-A, backend apenas): RPC create_company() + os 5
-- pipeline_stages padrão + RLS de leitura de companies via
-- can_access_company(). Fora de escopo aqui, propositalmente: tela,
-- feature flag no código, convites, criação de Manager/Seller,
-- transições de status, auditoria administrativa completa (S3-B e
-- etapas posteriores, ver §16).
--
-- ═══════════════════════════════════════════════════════════════════════
-- companies.name: nome obrigatório e não-branco (§8: "name | sim")
-- ═══════════════════════════════════════════════════════════════════════
-- companies.name já é NOT NULL desde M1-B, mas nada impedia uma string em
-- branco. Mesmo padrão já usado em leads.name (m1e_01,
-- leads_name_not_blank_ck) — adicionado aqui porque é exatamente agora que
-- a primeira via de escrita real de companies (create_company) passa a
-- existir; antes disso a coluna nunca recebia entrada de usuário.
begin;

alter table public.companies
  add constraint companies_name_not_blank_ck check (btrim(name) <> '');

-- ═══════════════════════════════════════════════════════════════════════
-- create_company(): única via de criação de empresas (§8, §9.9, §16-S3)
-- ═══════════════════════════════════════════════════════════════════════
-- Assinatura: somente os campos do §8 ("Dados mínimos"). status/
-- created_by_profile_id/created_at NÃO são parâmetros — o sistema define
-- (status sempre 'implantacao', created_by_profile_id sempre auth.uid()).
-- Nenhum id, company_id, profile_id, platform_role ou objeto JSON genérico
-- é aceito — elimina qualquer caminho de mass assignment. cnpj/phone
-- permanecem sem validação de formato ou unicidade: o design (§8) só
-- define cnpj como opcional ("somente se necessário", sem exigir
-- unicidade) — nenhuma constraint de unicidade é inventada aqui sem essa
-- exigência aprovada. trade_name/cnpj/phone não são normalizados (string
-- vazia é aceita como veio, sem decisão documentada para tratá-la como
-- NULL). timezone tem default 'America/Sao_Paulo' no próprio parâmetro
-- (§8), preenchendo o mesmo valor que já é o default da coluna desde
-- M1-B, sem duplicar a fonte de verdade em dois lugares divergentes —
-- e, diferente de cnpj/phone, timezone É validada (não é texto livre
-- sem consequência: ver justificativa completa no corpo da função).
--
-- SECURITY DEFINER necessário (não por padrão): authenticated não tem
-- INSERT em public.companies (confirmado — zero grants, ver m1f_s1_01).
-- Autorização checada ANTES de qualquer INSERT: nega ADMIN legado,
-- Manager, Seller e anon — só is_platform_super_admin() passa. Ator
-- sempre auth.uid() (nunca parâmetro externo). Toda a função roda numa
-- única invocação de RPC = uma única transação implícita: qualquer
-- exceção (autorização negada, nome em branco, falha ao criar stage)
-- desfaz TUDO, inclusive a linha de companies já inserida — não há
-- caminho de sucesso parcial.
--
-- Os 5 estágios padrão são exatamente os mesmos da fonte canônica
-- (m1c_02_pipeline_stages.sql, seed idempotente): codes/names/sort_order/
-- is_terminal idênticos, char a char. Nenhuma company pode ser retornada
-- sem os 5 estágios, porque qualquer falha no segundo INSERT desfaz o
-- primeiro (mesma transação).
--
-- Retorno: a própria linha de public.companies recém-criada (mesmo
-- padrão de create_lead, que retorna public.leads) — pequeno, estável,
-- sem dados de profile/auth.users/memberships/outras empresas.

create function public.create_company(
  p_name        text,
  p_trade_name  text default null,
  p_cnpj        text default null,
  p_phone       text default null,
  p_timezone    text default 'America/Sao_Paulo'
) returns public.companies
language plpgsql security definer set search_path = '' as $$
declare
  v_company  public.companies;
  v_timezone text := coalesce(p_timezone, 'America/Sao_Paulo');
begin
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- Validação de timezone: companies.timezone não é texto livre sem
  -- consequência — o contrato já aprovado em docs/M1-C-DESIGN.md §4.5
  -- ("Timezone — contrato de conversão") documenta que esse valor é
  -- passado direto para Intl.DateTimeFormat(..., { timeZone: ... }) na
  -- conversão de horários de visita. Uma string inválida gravada aqui
  -- quebraria esse contrato silenciosamente só no momento do uso futuro.
  -- Validação determinística e sem rede: o próprio Postgres resolve o
  -- nome IANA usando o tzdata do servidor (mesmo dado que alimenta
  -- pg_timezone_names()) — "not recognized" vira SQLSTATE 22023
  -- (invalid_parameter_value), deixado propagar tal como é, sem reescrever.
  perform now() at time zone v_timezone;

  insert into public.companies (name, trade_name, cnpj, phone, timezone, status, created_by_profile_id)
  values (p_name, p_trade_name, p_cnpj, p_phone, v_timezone, 'implantacao', auth.uid())
  returning * into v_company;

  insert into public.pipeline_stages (company_id, code, name, sort_order, is_terminal)
  values
    (v_company.id, 'new',             'Novo',            0, false),
    (v_company.id, 'qualified',       'Qualificado',     1, false),
    (v_company.id, 'visit_scheduled', 'Visita agendada', 2, false),
    (v_company.id, 'negotiation',     'Em negociação',   3, false),
    (v_company.id, 'closing',         'Fechamento',      4, true);

  return v_company;
end;
$$;

revoke all on function public.create_company(text, text, text, text, text) from public;
revoke all on function public.create_company(text, text, text, text, text) from anon;
revoke all on function public.create_company(text, text, text, text, text) from authenticated;
grant execute on function public.create_company(text, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- RLS de leitura de companies (§16-S3: "RLS de companies usando
-- can_access_company")
-- ═══════════════════════════════════════════════════════════════════════
-- As duas policies antigas (companies_select_own/companies_update_admin,
-- M1-B) usavam os helpers legados (current_profile_company_id/role) e
-- eram estruturalmente inalcançáveis por authenticated até agora (zero
-- grant de tabela em companies, confirmado desde m1f_s1_01) — nunca
-- estiveram "em produção" de fato. Substituídas em vez de mantidas ao
-- lado da nova: como RLS policies se combinam por OR, manter
-- companies_select_own ativa (que não verifica companies.status)
-- vazaria leitura de empresa suspensa/cancelada para Manager/Seller via
-- profiles.company_id legado, anulando exatamente a garantia de status
-- fechada em m1f_s11. companies_update_admin é removida pelo mesmo
-- motivo estrutural — nenhuma escrita direta é concedida nesta etapa de
-- qualquer forma (criação é só via create_company; UPDATE de status é
-- etapa futura, fora deste S3-A).
--
-- Empresa cancelada continua omitida mesmo para Super Admin nesta
-- listagem padrão — can_access_company() já nega 'cancelada' para todos
-- os papéis (m1f_s11, §7.4/§8). O próprio design já prevê e resolve essa
-- consequência explicitamente (§8, efeito de 'cancelada'): "Acesso
-- forense a empresa cancelada... não é resolvido neste documento... é
-- uma RPC/relatório separado, restrito a is_platform_super_admin() sem
-- passar por can_access_company(), fora do escopo desta etapa" — ou
-- seja, NÃO é uma contradição a resolver agora; é uma etapa futura já
-- deliberadamente adiada pelo próprio documento. Nenhuma
-- can_administer_company() é criada aqui sem exigência oficial.

drop policy companies_select_own on public.companies;
drop policy companies_update_admin on public.companies;

create policy companies_select_accessible on public.companies
  for select to authenticated
  using (public.can_access_company(id));

grant select on public.companies to authenticated;
-- Nenhum INSERT/UPDATE/DELETE direto é concedido — criação é
-- exclusivamente via create_company(); UPDATE de status é etapa futura.

commit;
