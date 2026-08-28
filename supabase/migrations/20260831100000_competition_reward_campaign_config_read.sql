-- COMPETITION-REWARDS-V1-B1-R1-EXEC — FUTURE MONTH READ CONTRACT.
--
-- Problema (B2 BLOCKED): upsert_competition_reward_campaign já aceita
-- month_start >= mês oficial corrente, mas get_competition_rewards_overview
-- só devolve a campanha do mês oficial ATUAL. O Manager cria "Setembro" em
-- Agosto e depois não consegue reabrir/recarregar "Setembro" no editor de
-- Ajustes → Competição.
--
-- Escopo desta migration (UMA migration, R1-EXEC §16):
--   1. RPC  public.get_competition_reward_campaign(p_month_start date,
--                                                  p_company_id uuid default null)
--           returns jsonb — leitura de UMA reward campaign (mês atual OU
--           futuro) para o EDITOR/CONFIGURAÇÃO do Manager.
--   2. pgTAP supabase/tests/73_competition_reward_campaign_config_read_r1.sql
--
-- ZERO tabela. ZERO índice. ZERO alteração de RLS. ZERO alteração de:
--   upsert_competition_reward_campaign / get_competition_rewards_overview /
--   list_competition_reward_history / acknowledge_competition_month_result /
--   _finalize_due_competition_reward_months / Competition V2 / ranking /
--   boundary half-open.
--
-- SEPARAÇÃO DE CONCEITOS (§3):
--   - get_competition_rewards_overview  → COMPETIÇÃO ATUAL (current campaign
--     + current rank + my_reward + first_place_reward + last_result). NÃO é
--     tocada aqui.
--   - get_competition_reward_campaign   → CAMPAIGN CONFIGURATION: lê UMA
--     campanha por month_start para o Manager editar. Sem rank, sem
--     my_reward, sem last_result, sem finalização (§11/§12).
--
-- AUTORIZAÇÃO (§4/§5/§6/§13): Manager-only V1. Empresa SEMPRE derivada de
-- current_membership_company_id() (nunca do parâmetro — mesmo princípio de
-- upsert_competition_reward_campaign §32). p_company_id existe na assinatura
-- só para simetria com as RPCs irmãs e para permitir um futuro editor de
-- Super Admin contextual via CREATE OR REPLACE (sem regen de tipo, sem
-- mudança de frontend) — em V1 ele é apenas um GUARD de consistência: se
-- vier preenchido e apontar para outra empresa, é 'forbidden'. Super Admin
-- (global ou contextual) e Seller: sempre 'forbidden' (§5/§6).
begin;

-- ═══════════════════════════════════════════════════════════════════════
-- get_competition_reward_campaign — leitura da configuração de UMA campanha
-- (mês corrente ou futuro) para o editor do Manager.
--
--   auth.uid() null                  → 28000 'unauthenticated'
--   is_platform_super_admin()        → 42501 'forbidden'  (sem editor SA V1)
--   sem membership / role <> manager → 42501 'forbidden'  (Seller negado)
--   p_company_id <> empresa do ator  → 42501 'forbidden'  (isolamento §13)
--   p_month_start null / dia <> 1    → 22023 'invalid_month'          (§10)
--   p_month_start < mês corrente     → 22023 'month_closed'           (§9)
--   campanha inexistente             → { "month_start": …, "campaign": null }
--   campanha existe (draft OU pub.)  → objeto com tiers ORDER BY position ASC
-- ═══════════════════════════════════════════════════════════════════════
create function public.get_competition_reward_campaign(
  p_month_start date,
  p_company_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id    uuid;
  v_timezone      text;
  v_current_month date;
  v_campaign      public.competition_reward_campaigns;
  v_tiers         jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  -- §5/§6 — sem editor de Super Admin em V1 (global E contextual negados).
  if public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- §4/§13 — empresa SEMPRE do ator; nunca do parâmetro.
  v_company_id := public.current_membership_company_id();
  if v_company_id is null
     or public.current_membership_role() is distinct from 'manager'::public.company_role then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- p_company_id é só guard de consistência em V1.
  if p_company_id is not null and p_company_id is distinct from v_company_id then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- §10 — month_start precisa ser o primeiro dia de um mês civil.
  if p_month_start is null or date_part('day', p_month_start) <> 1 then
    raise invalid_parameter_value using message = 'invalid_month';
  end if;

  select c.timezone into v_timezone from public.companies c where c.id = v_company_id;
  if v_timezone is null then
    -- empresa do ator sumiu no meio do request — trata como sem acesso.
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- §10 — mês oficial corrente na timezone da empresa.
  v_current_month := (date_trunc('month', now() at time zone v_timezone))::date;

  -- §9 — editor de configuração nunca carrega mês já encerrado; histórico
  -- é domínio de list_competition_reward_history.
  if p_month_start < v_current_month then
    raise invalid_parameter_value using message = 'month_closed';
  end if;

  -- §4 — Manager vê draft E published da própria empresa.
  select * into v_campaign
    from public.competition_reward_campaigns c
   where c.company_id = v_company_id
     and c.month_start = p_month_start;

  -- §4 — sem campanha ⇒ shape vazio, NUNCA erro.
  if v_campaign.id is null then
    return jsonb_build_object('month_start', p_month_start, 'campaign', null);
  end if;

  -- §7/§8 — tiers suficientes para o editor, sempre ORDER BY position ASC.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'position', t.position,
             'amount_cents', t.amount_cents,
             'reward_text', t.reward_text
           ) order by t.position
         ), '[]'::jsonb)
    into v_tiers
    from public.competition_reward_tiers t
   where t.campaign_id = v_campaign.id;

  -- §7 — total_amount_cents NÃO é retornado nem persistido: o frontend
  -- soma amount_cents dos tiers.
  return jsonb_build_object(
    'month_start', p_month_start,
    'campaign', jsonb_build_object(
      'id', v_campaign.id,
      'month_start', v_campaign.month_start,
      'timezone', v_campaign.timezone,
      'status', v_campaign.status,
      'title', v_campaign.title,
      'published_at', v_campaign.published_at,
      'updated_at', v_campaign.updated_at,
      'tiers', v_tiers
    )
  );
end;
$$;

revoke all on function public.get_competition_reward_campaign(date, uuid) from public, anon, authenticated;
grant execute on function public.get_competition_reward_campaign(date, uuid) to authenticated;

commit;
