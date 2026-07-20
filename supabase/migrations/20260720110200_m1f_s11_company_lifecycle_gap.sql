-- M1-F / Módulo 1 — m1f_s11: fechamento da lacuna retroativa do S1
-- (companies.status/trade_name/created_by_profile_id)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §6.4,
-- §8, §9.9, §16 (linha S1 — "companies ganha status/created_by_profile_id/
-- trade_name (§6.4)").
--
-- CONTEXTO DA LACUNA: o plano oficial (§16) atribui esses 3 campos à
-- migration de schema do S1 (m1f_s1_01). A migration real do S1 não os
-- criou — descoberto em auditoria adversarial durante o S3 (relatório de
-- divergência aprovado). Esta migration fecha exatamente essa lacuna, como
-- etapa própria (S1.1), ANTES do S3 oficial (criação de empresas, que
-- pressupõe esse schema já existir, conforme a própria tabela do §16:
-- "Schema: — (schema já entrou em S1)").
--
-- ESCOPO ESTRITO: somente os 3 campos + integração dos helpers do S2 com o
-- status. Fora de escopo aqui, propositalmente (pertencem ao S3 oficial ou
-- a etapas posteriores, ver §16): create_company(), qualquer RPC de
-- transição de status (suspend/reactivate/cancel), qualquer policy nova de
-- escrita, qualquer UI, qualquer auditoria de company_status_changed.

begin;

-- ── 1. enum company_status (§6.4) ────────────────────────────────────────
create type public.company_status as enum ('implantacao', 'ativa', 'suspensa', 'cancelada');

-- ── 2. companies.status ──────────────────────────────────────────────────
-- Default 'implantacao' é para EMPRESAS NOVAS (futuras, via create_company
-- no S3) — "é o estado inicial enquanto KAPA configura e convida o
-- primeiro gerente" (§8). Empresas JÁ EXISTENTES nesta transação não estão
-- nesse estado: já têm memberships/managers/sellers reais (backfill do
-- S1/S2 já rodou) — corrigidas para 'ativa' logo abaixo, separadamente do
-- default da coluna.
alter table public.companies
  add column status public.company_status not null default 'implantacao';

update public.companies set status = 'ativa';

-- ── 3. companies.trade_name (§6.4: "nova, nullable") ────────────────────
-- Sem valor de backfill previsto no design (não existe menção a copiar
-- companies.name) — permanece NULL para empresas existentes. companies.name
-- não é tocado.
alter table public.companies
  add column trade_name text;

-- ── 4. companies.created_by_profile_id (§6.4: "FK profiles(id) on delete
--    set null — sempre um Super Admin") ─────────────────────────────────
-- "Sempre um Super Admin" descreve o preenchimento por create_company() no
-- S3 (autor real, validado por is_platform_super_admin()) — fora de
-- escopo aqui. Para as empresas JÁ EXISTENTES, o autor real não é
-- conhecido (nenhuma empresa até hoje foi criada por um fluxo que
-- registrasse isso) — permanece NULL, exatamente o que a FK nullable +
-- ON DELETE SET NULL já prevê para "autor desconhecido/removido". Não
-- atribuído a nenhum profile seedado, ADMIN legado ou Super Admin
-- artificial.
alter table public.companies
  add column created_by_profile_id uuid references public.profiles(id) on delete set null;

-- ── validações pós-backfill (abortam a migration em caso de violação) ────
do $$
declare
  v_count int;
begin
  -- nenhuma empresa existente foi automaticamente suspensa ou cancelada
  select count(*) into v_count
    from public.companies where status in ('suspensa', 'cancelada');
  if v_count > 0 then
    raise exception 'm1f_s11: % empresa(s) existente(s) ficaram suspensa/cancelada automaticamente — backfill deveria produzir apenas ativa', v_count;
  end if;

  -- nenhuma empresa existente ficou sem status (NOT NULL já garante isso
  -- estruturalmente; revalidado aqui como defesa em profundidade, mesmo
  -- padrão já usado em m1f_s2_01)
  select count(*) into v_count
    from public.companies where status is null;
  if v_count > 0 then
    raise exception 'm1f_s11: % empresa(s) sem status apos o backfill', v_count;
  end if;

  -- nenhum created_by_profile_id foi atribuído automaticamente (autor
  -- desconhecido de empresas historicas deve permanecer NULL)
  select count(*) into v_count
    from public.companies where created_by_profile_id is not null;
  if v_count > 0 then
    raise exception 'm1f_s11: % empresa(s) ganharam created_by_profile_id automaticamente — deveria permanecer NULL para historico', v_count;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════
-- INTEGRAÇÃO COM OS HELPERS DO S2 (§8: "a checagem de status entra no
-- mesmo ponto único — can_access_company()/require_company_access(),
-- sem reescrever cada policy individualmente")
-- ═══════════════════════════════════════════════════════════════════════

-- ── can_access_company(p_target_company_id) — CREATE OR REPLACE, mesma
--    assinatura/grants/SECURITY DEFINER de m1f_s2_02. Único ponto que
--    ganha a checagem de status:
--    * Super Admin: empresa existe E status <> 'cancelada' (implantacao/
--      ativa/suspensa continuam acessíveis a Super Admin, para não quebrar
--      suporte/auditoria/histórico, §7.4/§8 — só 'cancelada' nega mesmo
--      para Super Admin, exatamente como §8 especifica);
--    * Manager/Seller: além da membership ativa já exigida, a empresa
--      precisa estar em status in ('ativa','implantacao') — "uso normal
--      liberado" nos dois, §8; 'suspensa'/'cancelada' negam, mesmo com
--      membership ativa (membership ativa não contorna o status).
--    require_company_access() e current_profile_seller_id_for_company()
--    NÃO são alterados: ambos já delegam integralmente a can_access_company
--    (o primeiro é SECURITY INVOKER só para isso, m1f_s2_02) e herdam o
--    novo comportamento automaticamente, sem duplicar a checagem.
create or replace function public.can_access_company(p_target_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_target_company_id is null then false
    else coalesce(
      (
        public.is_platform_super_admin()
        and exists (
          select 1 from public.companies c
          where c.id = p_target_company_id and c.status <> 'cancelada'
        )
      )
      or (
        exists (
          select 1
            from public.company_memberships cm
            join public.profiles p on p.id = cm.profile_id
            join public.companies c on c.id = cm.company_id
           where cm.profile_id = auth.uid()
             and cm.company_id = p_target_company_id
             and cm.is_active
             and p.is_active
             and c.status in ('ativa', 'implantacao')
        )
      ),
      false
    )
  end;
$$;

-- ── is_manager_or_platform(p_target_company_id) — CREATE OR REPLACE,
--    mesma assinatura/grants/SECURITY DEFINER de m1f_s2_02. Reescrita para
--    delegar o gate operacional (existência + status) a can_access_company
--    em vez de duplicar a lógica — mesmo motivo de design que já levou
--    require_company_access a delegar tudo a can_access_company (m1f_s2_02,
--    minimização/DRY): TRUE somente quando can_access_company já autoriza
--    E (é Super Admin OU tem membership MANAGER ativa correspondente).
--    Efeito prático idêntico ao anterior para status='ativa'/'implantacao'
--    (nenhuma mudança de comportamento observável nos testes já existentes,
--    que nunca setam status explicitamente e por isso caem no default
--    'implantacao'); para 'suspensa'/'cancelada', passa a negar também
--    Manager de empresa não operacional, o que a versão anterior (sem
--    conceito de status) não conseguia expressar.
create or replace function public.is_manager_or_platform(p_target_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    public.can_access_company(p_target_company_id)
    and (
      public.is_platform_super_admin()
      or exists (
        select 1
          from public.company_memberships cm
          join public.profiles p on p.id = cm.profile_id
         where cm.profile_id = auth.uid()
           and cm.company_id = p_target_company_id
           and cm.role = 'manager'
           and cm.is_active
           and p.is_active
      )
    );
$$;

commit;
