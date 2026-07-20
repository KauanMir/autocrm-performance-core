-- M1-F / Módulo 1 — m1f_s2_02: helpers de autorização (empresa alvo
-- explícita, sem estado persistido)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §7.4,
-- §15.3, §16 (S2). Depende de m1f_s1_01/02 e m1f_s2_01.
--
-- Camada NOVA e PARALELA aos helpers legados (current_profile_company_id,
-- current_profile_role, current_profile_seller_id, is_manager_or_admin —
-- M1-C m1c_01) e às 9 RPCs do M1-E: nenhum deles é alterado, removido ou
-- tem a assinatura tocada nesta migration. ADMIN legado continua sendo
-- tratado como manager/admin pelos helpers ANTIGOS exatamente como hoje —
-- essa mudança de produto (ADMIN absorvido por MANAGER na interface) é de
-- uma etapa posterior, não desta.
--
-- Sem estado persistido de empresa: nenhuma tabela de "empresa
-- selecionada", nenhuma função select_active_company()/
-- effective_company_id(), nenhuma impersonação. A empresa alvo é SEMPRE
-- parâmetro explícito (p_target_company_id) de cada helper que precisa
-- dela — exatamente a arquitetura aprovada em §7 do design (Revisão 2),
-- rejeitando deliberadamente a Revisão 1.
--
-- 7 helpers novos (avaliados e descartados: current_membership_id() e
-- current_membership_id_for_company() — nenhuma policy ou helper desta
-- etapa precisa do id da membership em si, só de company_id/role/
-- existência; não criados, para não acumular objetos sem consumidor real):
--   1. is_platform_super_admin()
--   2. current_membership_company_id()
--   3. current_membership_role()
--   4. can_access_company(p_target_company_id uuid)
--   5. require_company_access(p_target_company_id uuid)
--   6. is_manager_or_platform(p_target_company_id uuid)
--   7. current_profile_seller_id_for_company(p_target_company_id uuid)
--
-- Padrão de segurança idêntico ao já usado desde M1-C: SECURITY DEFINER,
-- set search_path = '' com todos os objetos qualificados (public.*,
-- auth.uid()), REVOKE ALL FROM public/anon/authenticated seguido de GRANT
-- EXECUTE só para authenticated, na MESMA transação da criação. Nenhum
-- profile_id é aceito como parâmetro (todos derivam de auth.uid()) —
-- elimina qualquer caminho de "verificar acesso de outra pessoa" via
-- parâmetro forjado.

begin;

-- ── 1. is_platform_super_admin() ─────────────────────────────────────────
-- Deriva de auth.uid(); não depende de company_id, localStorage ou
-- qualquer seleção persistida; profile inexistente/inativo -> false;
-- ADMIN legado (profiles.role='admin') NUNCA é super admin por esta
-- função — platform_role e role são colunas completamente independentes.

create function public.is_platform_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.platform_role = 'super_admin'
       from public.profiles p
      where p.id = auth.uid() and p.is_active),
    false
  );
$$;

-- ── 2. current_membership_company_id() ──────────────────────────────────
-- Empresa da ÚNICA membership ativa do usuário (Manager/Seller). Falha
-- fechado: se por qualquer motivo existir mais de uma linha ativa (nunca
-- deveria acontecer — índice único parcial de m1f_s1_01 impede — mas a
-- função não assume isso, ela mesma verifica), retorna NULL em vez de
-- escolher uma arbitrariamente. Super Admin nunca tem membership -> NULL,
-- por design (nenhuma empresa implícita).

create function public.current_membership_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  with active_memberships as (
    select cm.company_id
      from public.company_memberships cm
      join public.profiles p on p.id = cm.profile_id
     where cm.profile_id = auth.uid()
       and cm.is_active
       and p.is_active
  )
  select company_id from active_memberships
  where (select count(*) from active_memberships) = 1;
$$;

-- ── 3. current_membership_role() ────────────────────────────────────────
-- company_role da membership ativa — NUNCA deriva de profiles.role (que
-- continua existindo só para o runtime legado) e NUNCA traduz
-- platform_role em MANAGER (são conceitos independentes). Mesma lógica de
-- "falha fechado" de current_membership_company_id().

create function public.current_membership_role() returns public.company_role
language sql stable security definer set search_path = '' as $$
  with active_memberships as (
    select cm.role
      from public.company_memberships cm
      join public.profiles p on p.id = cm.profile_id
     where cm.profile_id = auth.uid()
       and cm.is_active
       and p.is_active
  )
  select role from active_memberships
  where (select count(*) from active_memberships) = 1;
$$;

-- ── 4. can_access_company(p_target_company_id) ──────────────────────────
-- Leitura pura, nunca falha alto. TRUE se: (a) chamador é Super Admin e a
-- empresa alvo existe; ou (b) chamador tem membership ATIVA cujo
-- company_id é EXATAMENTE o alvo. Nunca aceita profiles.company_id como
-- autoridade (helper novo não lê essa coluna em nenhum ramo). target
-- NULL -> false explicitamente (não depende de semântica implícita de
-- comparação NULL).
--
-- NOTA DE ESCOPO: "empresa em estado operacional permitido" (design §8)
-- pressupõe companies.status, que NÃO existe no schema atual — nenhuma
-- migration até aqui (M1-B..M1-F S1) criou essa coluna, e criá-la agora
-- seria escopo do S3 (design §8, "Criação de empresas"), não deste S2.
-- Por isso o ramo de Super Admin valida apenas EXISTÊNCIA da empresa.
-- Quando companies.status existir, este ramo deve ganhar
-- "and c.status not in (...)" sem precisar mudar a assinatura da função —
-- ponto de extensão documentado aqui de propósito.

create function public.can_access_company(p_target_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_target_company_id is null then false
    else coalesce(
      (
        public.is_platform_super_admin()
        and exists (select 1 from public.companies c where c.id = p_target_company_id)
      )
      or (
        exists (
          select 1
            from public.company_memberships cm
            join public.profiles p on p.id = cm.profile_id
           where cm.profile_id = auth.uid()
             and cm.company_id = p_target_company_id
             and cm.is_active
             and p.is_active
        )
      ),
      false
    )
  end;
$$;

-- ── 5. require_company_access(p_target_company_id) ──────────────────────
-- Mesma autoridade de can_access_company(), mas falha alto — usada dentro
-- de outros helpers/futuras RPCs para encadear "valide e devolva a
-- empresa" numa única expressão. Erro padronizado (insufficient_privilege,
-- SQLSTATE 42501) — nunca diferencia "empresa inexistente" de "sem
-- acesso" (can_access_company já colapsa os dois casos em FALSE antes de
-- chegar aqui). auth.uid() é lido pelo Postgres a partir do JWT da
-- requisição, não muda com SECURITY DEFINER — uma chamada aninhada (helper
-- chamando helper, ou uma futura RPC SECURITY DEFINER chamando este
-- helper) continua validando o usuário REAL da requisição, nunca o dono
-- da função — não há bypass por composição de SECURITY DEFINER.
--
-- SECURITY INVOKER deliberado (minimização, não DEFINER por padrão): esta
-- função não lê nenhuma tabela diretamente — delega inteiramente a
-- can_access_company() (essa sim SECURITY DEFINER, pois lê company_
-- memberships/profiles/companies). Rodar como INVOKER não muda nenhum
-- comportamento observável (a chamada aninhada a can_access_company()
-- continua elevando privilégio normalmente, com ou sem DEFINER aqui, e
-- authenticated já tem EXECUTE em ambas as funções); o ganho é
-- defesa em profundidade: se este corpo algum dia ganhar uma leitura de
-- tabela direta por engano, ela falhará imediatamente por falta de grant
-- em vez de silenciosamente ler com privilégio de postgres.

create function public.require_company_access(p_target_company_id uuid) returns uuid
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.can_access_company(p_target_company_id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;
  return p_target_company_id;
end;
$$;

-- ── 6. is_manager_or_platform(p_target_company_id) ──────────────────────
-- TRUE para: Super Admin com acesso à empresa alvo; OU membership MANAGER
-- ativa cujo company_id é exatamente o alvo. FALSE para Seller (mesmo
-- ativo), Manager de outra empresa, membership inativa, e ADMIN legado
-- sem membership MANAGER válida (esta função nunca lê profiles.role).

create function public.is_manager_or_platform(p_target_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    (public.is_platform_super_admin() and public.can_access_company(p_target_company_id))
    or coalesce(
      (
        select cm.role = 'manager'
          from public.company_memberships cm
          join public.profiles p on p.id = cm.profile_id
         where cm.profile_id = auth.uid()
           and cm.company_id = p_target_company_id
           and cm.is_active
           and p.is_active
      ),
      false
    );
$$;

-- ── 7. current_profile_seller_id_for_company(p_target_company_id) ──────
-- Primeiro valida acesso à empresa (require_company_access, falha alto se
-- negado) — depois resolve o seller EXCLUSIVAMENTE pela cadeia
-- sellers.membership_id -> company_memberships (nunca usa sellers.
-- profile_id isoladamente como autoridade). Manager: sua própria
-- membership tem role='manager', não casa com o filtro role='seller' ->
-- NULL. Super Admin: nunca tem company_memberships -> NULL (nenhum seller
-- artificial). Seller de outra empresa: cm.company_id não bate com o
-- alvo validado -> NULL. Seller inativo: segue o mesmo modelo já usado em
-- create_lead/assign_lead_seller (checa sellers.is_active) -> NULL se
-- inativo.
--
-- Falha fechado contra ambiguidade (mesmo padrão de current_membership_
-- company_id/role): sellers.membership_id NÃO tem constraint UNIQUE no
-- schema atual (nada estruturalmente novo desta migration — pré-existente
-- desde m1f_s1_01), então nada impede hoje que duas linhas de sellers
-- apontem para a mesma membership_id. Em vez de confiar num LIMIT 1
-- implícito ou no comportamento de função SQL escalar com múltiplas
-- linhas, a query conta explicitamente as correspondências e só devolve
-- um resultado quando existe exatamente uma — qualquer estado
-- contraditório retorna NULL, nunca uma escolha arbitrária.

create function public.current_profile_seller_id_for_company(p_target_company_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  with validated as (
    select public.require_company_access(p_target_company_id) as company_id
  ),
  matches as (
    select s.id
      from validated v
      join public.company_memberships cm on cm.company_id = v.company_id
      join public.sellers s on s.membership_id = cm.id
      join public.profiles p on p.id = cm.profile_id
     where cm.profile_id = auth.uid()
       and cm.role = 'seller'
       and cm.is_active
       and p.is_active
       and s.is_active
  )
  select id from matches
  where (select count(*) from matches) = 1;
$$;

-- ── revoke/grant explícitos (mesma transação, assinaturas completas) ────
-- PUBLIC e anon nunca recebem EXECUTE — helpers administrativos/de
-- autorização não são de uso anônimo. authenticated recebe EXECUTE em
-- todos os 7 (são os únicos que precisam avaliar seu próprio acesso).
-- Nenhum uso de service_role em nenhum ponto.

revoke all on function public.is_platform_super_admin() from public;
revoke all on function public.is_platform_super_admin() from anon;
revoke all on function public.is_platform_super_admin() from authenticated;
grant execute on function public.is_platform_super_admin() to authenticated;

revoke all on function public.current_membership_company_id() from public;
revoke all on function public.current_membership_company_id() from anon;
revoke all on function public.current_membership_company_id() from authenticated;
grant execute on function public.current_membership_company_id() to authenticated;

revoke all on function public.current_membership_role() from public;
revoke all on function public.current_membership_role() from anon;
revoke all on function public.current_membership_role() from authenticated;
grant execute on function public.current_membership_role() to authenticated;

revoke all on function public.can_access_company(uuid) from public;
revoke all on function public.can_access_company(uuid) from anon;
revoke all on function public.can_access_company(uuid) from authenticated;
grant execute on function public.can_access_company(uuid) to authenticated;

revoke all on function public.require_company_access(uuid) from public;
revoke all on function public.require_company_access(uuid) from anon;
revoke all on function public.require_company_access(uuid) from authenticated;
grant execute on function public.require_company_access(uuid) to authenticated;

revoke all on function public.is_manager_or_platform(uuid) from public;
revoke all on function public.is_manager_or_platform(uuid) from anon;
revoke all on function public.is_manager_or_platform(uuid) from authenticated;
grant execute on function public.is_manager_or_platform(uuid) to authenticated;

revoke all on function public.current_profile_seller_id_for_company(uuid) from public;
revoke all on function public.current_profile_seller_id_for_company(uuid) from anon;
revoke all on function public.current_profile_seller_id_for_company(uuid) from authenticated;
grant execute on function public.current_profile_seller_id_for_company(uuid) to authenticated;

commit;
