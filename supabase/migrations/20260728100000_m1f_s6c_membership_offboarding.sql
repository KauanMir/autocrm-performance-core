-- M1-F S6-C — desligamento empresarial de Seller e Manager
-- (offboard_seller/offboard_manager). Fonte: docs/M1-F-SUPER-ADMIN-USER-
-- LIFECYCLE-DESIGN.md §11, §12, §24 — nenhuma decisão congelada é
-- reinterpretada aqui. Assinaturas exatas de §11/§12:
--   offboard_seller(p_seller_membership_id, p_successor_seller_id|null, p_note)
--   offboard_manager(p_manager_membership_id, p_successor_profile_id|null, p_note)
-- Os três parâmetros são obrigatórios em SQL (Postgres exige que todo
-- parâmetro após um com DEFAULT também tenha DEFAULT — p_note é
-- obrigatório e vem depois do sucessor na ordem do documento, então o
-- sucessor não pode ter DEFAULT sem violar a ordem congelada); "sucessor
-- ausente" é expresso passando NULL explicitamente, nunca omitindo o
-- argumento — mesma convenção já usada por p_note em suspend_membership.
--
-- ── Achado de auditoria (S6-C, antes de qualquer escrita) ──────────────
-- §11 descreve offboard_seller reatribuindo leads, tarefas
-- (tasks.assigned_to), negociações (deals) e visitas (visits) abertas, e
-- preservando vendas (sales) como histórico. Nenhuma dessas quatro
-- últimas tabelas existe no schema Postgres (confirmado por grep em
-- todas as migrations: só public.leads e public.lead_timeline_entries
-- existem como tabelas comerciais) — são módulos legados M0, nunca
-- migrados (mesmo registrado em §23.9 do fechamento do S5: "sem
-- cobertura de teste automatizado... não fazem parte do escopo do
-- M1-F"). Decisão (aprovada explicitamente pelo usuário nesta etapa):
-- offboard_seller reatribui exclusivamente public.leads — a única tabela
-- operacional real. Nenhuma tabela nova é criada para cobrir
-- tasks/visits/deals/sales; quando esses módulos forem migrados ao
-- Postgres, a reatribuição deles é trabalho de uma etapa futura, não
-- desta.
--
-- offboard_manager não reatribui nenhum registro operacional: §12 do
-- documento só descreve a transição da membership e a validação de um
-- sucessor já-Manager — nenhuma tabela referencia um Manager como "dono"
-- de forma análoga a leads.seller_id (autoria em
-- created_by_profile_id/updated_by_profile_id é histórica, nunca tocada
-- por nenhum fluxo deste documento). Nenhuma reatribuição é inventada
-- aqui.
--
-- Estados: ambas as RPCs aceitam origem active OU suspended -> offboarded
-- (idempotente quando já offboarded; nenhuma transição a partir de
-- offboarded existe nestas RPCs — reactivate_membership já rejeita esse
-- caminho desde S6-B, migration antiga intocada). membership_lifecycle_
-- conflict não tem caminho real aqui (só 3 estados existem; active e
-- suspended são origens válidas, offboarded é idempotente) — não usado.
--
-- Locks: ordem fixa empresa -> membership(ns) -> profile(ns) -> seller(s)
-- alvo -> seller sucessor, idêntica a suspend_membership/
-- reactivate_membership/update_membership_role. Quando um sucessor é
-- informado, a membership alvo e a membership sucessora são travadas em
-- UMA única consulta ordenada por id (ORDER BY id FOR UPDATE) — a ordem
-- nunca depende de qual delas é "alvo" e qual é "sucessora", eliminando
-- deadlock cruzado entre duas chamadas concorrentes que apontem uma para
-- a outra como sucessora.
begin;

-- ── offboard_seller ──────────────────────────────────────────────────────
create function public.offboard_seller(
  p_seller_membership_id uuid,
  p_successor_seller_id text,
  p_note text
) returns table (
  membership_id         uuid,
  profile_id             uuid,
  company_id             uuid,
  company_role           public.company_role,
  lifecycle_status       public.membership_lifecycle_status,
  is_active              boolean,
  seller_id              text,
  seller_active          boolean,
  successor_seller_id    text,
  leads_reassigned       integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id_peek            uuid;
  v_company                    public.companies;
  v_membership                 public.company_memberships;
  v_target_profile             public.profiles;
  v_seller                     public.sellers;
  v_successor_membership_peek  uuid;
  v_successor_membership       public.company_memberships;
  v_successor_profile          public.profiles;
  v_successor_seller           public.sellers;
  v_row                        public.company_memberships;
  v_note                       text;
  v_leads_count                int;
  v_before                     jsonb;
  v_after                      jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_seller_membership_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select cm.company_id into v_company_id_peek
    from public.company_memberships cm
   where cm.id = p_seller_membership_id;
  if v_company_id_peek is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = v_company_id_peek for update;
  if v_company.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_not_operational';
  end if;

  -- peek do sucessor (sem lock, sem revelar nada ao chamador) — resolve o
  -- membership_id do vendedor sucessor, se informado, ANTES de travar
  -- qualquer membership.
  if p_successor_seller_id is not null then
    select s.membership_id into v_successor_membership_peek
      from public.sellers s
     where s.id = p_successor_seller_id and s.company_id = v_company.id;
  end if;

  -- trava membership alvo e (quando aplicável) membership sucessora numa
  -- única consulta ordenada por id — nunca na ordem em que os parâmetros
  -- chegaram (§13 desta etapa).
  if v_successor_membership_peek is not null and v_successor_membership_peek <> p_seller_membership_id then
    for v_row in
      select cm.* from public.company_memberships cm
       where cm.id in (p_seller_membership_id, v_successor_membership_peek)
         and cm.company_id = v_company.id
       order by cm.id
       for update
    loop
      if v_row.id = p_seller_membership_id then
        v_membership := v_row;
      else
        v_successor_membership := v_row;
      end if;
    end loop;
  else
    select cm.* into v_membership
      from public.company_memberships cm
     where cm.id = p_seller_membership_id and cm.company_id = v_company.id
     for update;
  end if;

  if v_membership.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- esta RPC só opera sobre membership de Seller — alvo Manager (RPC
  -- errada) colapsa em membership_not_found, mesmo tratamento de
  -- "não existe" (anti-enumeração, nenhuma informação extra vaza).
  if v_membership.role <> 'seller'::public.company_role then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- autorização: Super Admin (qualquer empresa) ou Manager (só a própria
  -- empresa) — nunca Seller. Alvo já garantidamente 'seller' acima, então
  -- "Manager sobre Manager" não se aplica nesta RPC.
  if not public.is_manager_or_platform(v_company.id) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_target_profile.id = auth.uid() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  -- motivo obrigatório (mesma validação de suspend_membership/S6-B)
  v_note := btrim(p_note);
  if v_note is null or v_note = '' or length(v_note) < 3 or length(v_note) > 500 or v_note ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_note';
  end if;

  -- resolve o Seller vinculado à membership alvo — sempre, mesmo em
  -- caminho idempotente (checagem de invariante estrutural).
  select s.* into v_seller from public.sellers s where s.membership_id = v_membership.id for update;
  if v_seller.id is null
     or v_seller.company_id <> v_membership.company_id
     or v_seller.profile_id <> v_membership.profile_id then
    raise using message = 'seller_state_conflict';
  end if;

  -- idempotência: já desligado, nada a reatribuir, nada a auditar
  -- novamente.
  if v_membership.lifecycle_status = 'offboarded'::public.membership_lifecycle_status then
    return query select
      v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
      v_membership.lifecycle_status, v_membership.is_active,
      v_seller.id, v_seller.is_active,
      null::text, 0;
    return;
  end if;

  -- valida o sucessor, quando informado — nunca obrigatório para
  -- offboard_seller (§11.1 "Vendedor sem substituto: permitido"), mas
  -- sempre validado integralmente quando presente.
  if p_successor_seller_id is not null then
    if v_successor_membership.id is null then
      raise using message = 'successor_invalid';
    end if;

    select p.* into v_successor_profile from public.profiles p where p.id = v_successor_membership.profile_id for update;
    select s.* into v_successor_seller from public.sellers s where s.membership_id = v_successor_membership.id for update;

    if v_successor_membership.id = v_membership.id
       or v_successor_membership.role <> 'seller'::public.company_role
       or not v_successor_membership.is_active
       or v_successor_membership.lifecycle_status <> 'active'::public.membership_lifecycle_status
       or v_successor_profile.id is null or not v_successor_profile.is_active
       or v_successor_seller.id is null or not v_successor_seller.is_active
       or v_successor_seller.company_id <> v_company.id
       or v_successor_seller.profile_id <> v_successor_membership.profile_id then
      raise using message = 'successor_invalid';
    end if;
  end if;

  v_before := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active
  );

  update public.company_memberships
     set lifecycle_status = 'offboarded', is_active = false
   where id = v_membership.id
  returning * into v_membership;

  update public.sellers set is_active = false where id = v_seller.id
  returning * into v_seller;

  -- reatribuição operacional (só leads — ver nota de topo). Somente
  -- seller_id é escrito, exatamente como o passo 4 do §11 especifica
  -- ("UPDATE leads SET seller_id = p_successor_seller_id") —
  -- updated_by_profile_id NUNCA é gravado por esta RPC: leads_updated_by_fk
  -- (M1-E, migration antiga, intocada) é uma FK composta contra
  -- profiles(company_id, id), e profiles.company_id é sempre NULL para
  -- Super Admin (o modelo M1-F não usa mais essa coluna legada) — gravar
  -- auth.uid() ali violaria a FK sempre que o ator fosse Super Admin,
  -- exatamente o ator que este RPC precisa suportar (§6). Não é ambiguidade
  -- de contrato: o documento nunca pediu essa coluna: escrevê-la foi
  -- decisão própria, corrigida aqui de volta ao que a fonte de verdade
  -- especifica, sem tocar a migration antiga que define a FK.
  --
  -- UPDATE direto, sem SELECT...FOR UPDATE prévio: a própria UPDATE trava
  -- cada linha ao alterá-la; uma segunda chamada concorrente sobre o MESMO
  -- vendedor espera essas linhas e, ao continuar, já não encontra mais
  -- leads com seller_id = v_seller.id (a primeira já moveu tudo) — mesma
  -- serialização do §11.1 "duas pessoas tentando transferir
  -- simultaneamente", sem precisar de uma fase de lock separada.
  -- alias explícito "l": os nomes de saída do RETURNS TABLE (company_id,
  -- seller_id) sombreiam os nomes de coluna homônimos de public.leads
  -- dentro do corpo da função — sem alias, "company_id"/"seller_id" no
  -- WHERE seriam ambíguos entre a variável de saída e a coluna da tabela.
  update public.leads l
     set seller_id = v_successor_seller.id
   where l.company_id = v_company.id
     and l.seller_id = v_seller.id
     and l.archived_at is null;
  get diagnostics v_leads_count = row_count;

  v_after := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'seller_id', v_seller.id,
    'seller_active', v_seller.is_active,
    'successor_seller_id', v_successor_seller.id,
    'leads_reassigned', v_leads_count,
    'note', v_note
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'seller_offboarded', 'membership', v_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select
    v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
    v_membership.lifecycle_status, v_membership.is_active,
    v_seller.id, v_seller.is_active,
    v_successor_seller.id, v_leads_count;
end;
$$;

revoke all on function public.offboard_seller(uuid, text, text) from public;
revoke all on function public.offboard_seller(uuid, text, text) from anon;
grant execute on function public.offboard_seller(uuid, text, text) to authenticated;

-- ── offboard_manager ──────────────────────────────────────────────────────
-- Nenhuma reatribuição operacional (ver nota de topo) — só a transição da
-- membership e a validação do sucessor (que já precisa ser Manager ativo
-- antes desta chamada; promoção não é implícita, §12).
create function public.offboard_manager(
  p_manager_membership_id uuid,
  p_successor_profile_id uuid,
  p_note text
) returns table (
  membership_id         uuid,
  profile_id             uuid,
  company_id             uuid,
  company_role           public.company_role,
  lifecycle_status       public.membership_lifecycle_status,
  is_active              boolean,
  successor_profile_id   uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company_id_peek            uuid;
  v_company                    public.companies;
  v_membership                 public.company_memberships;
  v_target_profile             public.profiles;
  v_successor_membership_peek  uuid;
  v_successor_membership       public.company_memberships;
  v_successor_profile          public.profiles;
  v_row                        public.company_memberships;
  v_note                       text;
  v_other_manager_count        int;
  v_before                     jsonb;
  v_after                      jsonb;
begin
  if auth.uid() is null then
    raise invalid_authorization_specification using message = 'unauthenticated';
  end if;

  if p_manager_membership_id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select cm.company_id into v_company_id_peek
    from public.company_memberships cm
   where cm.id = p_manager_membership_id;
  if v_company_id_peek is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select c.* into v_company from public.companies c where c.id = v_company_id_peek for update;
  if v_company.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_company.status not in ('implantacao', 'ativa') then
    raise using message = 'company_not_operational';
  end if;

  -- peek do sucessor: resolve a membership de MANAGER já ativa do profile
  -- sucessor, se informado — promoção nunca é implícita (§12).
  if p_successor_profile_id is not null then
    select cm.id into v_successor_membership_peek
      from public.company_memberships cm
     where cm.profile_id = p_successor_profile_id
       and cm.company_id = v_company.id
       and cm.role = 'manager'::public.company_role
       and cm.is_active
       and cm.lifecycle_status = 'active'::public.membership_lifecycle_status;
  end if;

  if v_successor_membership_peek is not null and v_successor_membership_peek <> p_manager_membership_id then
    for v_row in
      select cm.* from public.company_memberships cm
       where cm.id in (p_manager_membership_id, v_successor_membership_peek)
         and cm.company_id = v_company.id
       order by cm.id
       for update
    loop
      if v_row.id = p_manager_membership_id then
        v_membership := v_row;
      else
        v_successor_membership := v_row;
      end if;
    end loop;
  else
    select cm.* into v_membership
      from public.company_memberships cm
     where cm.id = p_manager_membership_id and cm.company_id = v_company.id
     for update;
  end if;

  if v_membership.id is null then
    raise no_data_found using message = 'membership_not_found';
  end if;

  select p.* into v_target_profile from public.profiles p where p.id = v_membership.profile_id for update;
  if v_target_profile.id is null or not v_target_profile.is_active then
    raise no_data_found using message = 'membership_not_found';
  end if;

  if v_membership.role <> 'manager'::public.company_role then
    raise no_data_found using message = 'membership_not_found';
  end if;

  -- autorização: somente Super Admin desliga Manager — nunca outro
  -- Manager, nem da própria empresa (§7 desta etapa). Company já validada
  -- operacional acima; is_platform_super_admin() já cobre profile ativo
  -- do ator (mesmo padrão de update_membership_role, S5-C).
  if not public.is_platform_super_admin() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if v_target_profile.id = auth.uid() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  if coalesce(v_target_profile.platform_role = 'super_admin', false) then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  v_note := btrim(p_note);
  if v_note is null or v_note = '' or length(v_note) < 3 or length(v_note) > 500 or v_note ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_note';
  end if;

  -- idempotência
  if v_membership.lifecycle_status = 'offboarded'::public.membership_lifecycle_status then
    return query select
      v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
      v_membership.lifecycle_status, v_membership.is_active,
      null::uuid;
    return;
  end if;

  -- valida o sucessor quando informado — precisa já ser Manager ativo da
  -- mesma empresa (nunca promovido implicitamente por esta RPC).
  if p_successor_profile_id is not null then
    if v_successor_membership.id is null then
      raise using message = 'successor_invalid';
    end if;

    select p.* into v_successor_profile from public.profiles p where p.id = v_successor_membership.profile_id for update;

    if v_successor_membership.id = v_membership.id
       or v_successor_membership.role <> 'manager'::public.company_role
       or not v_successor_membership.is_active
       or v_successor_membership.lifecycle_status <> 'active'::public.membership_lifecycle_status
       or v_successor_profile.id is null or not v_successor_profile.is_active
       or coalesce(v_successor_profile.platform_role = 'super_admin', false) then
      raise using message = 'successor_invalid';
    end if;
  end if;

  -- guarda do último Manager (mesma definição de S5-C/S6-B): conta outros
  -- Managers ativos da empresa, excluindo o próprio alvo; se zero e
  -- nenhum sucessor válido foi estabelecido, recusa. Aplica-se igualmente
  -- a alvo active ou suspended (Manager suspenso só pode ser desligado se
  -- a empresa ainda tiver outro Manager ativo).
  select count(*)::int into v_other_manager_count
    from public.company_memberships cm
    join public.profiles p on p.id = cm.profile_id
   where cm.company_id = v_company.id
     and cm.role = 'manager'::public.company_role
     and cm.is_active
     and cm.lifecycle_status = 'active'::public.membership_lifecycle_status
     and p.is_active
     and cm.id <> v_membership.id;

  if v_other_manager_count = 0 and v_successor_membership.id is null then
    raise using message = 'last_manager_requires_successor';
  end if;

  v_before := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active
  );

  update public.company_memberships
     set lifecycle_status = 'offboarded', is_active = false
   where id = v_membership.id
  returning * into v_membership;

  v_after := jsonb_build_object(
    'role', v_membership.role,
    'lifecycle_status', v_membership.lifecycle_status,
    'is_active', v_membership.is_active,
    'successor_profile_id', v_successor_profile.id,
    'note', v_note
  );

  insert into public.audit_log
    (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
  values
    (auth.uid(), v_company.id, 'manager_offboarded', 'membership', v_membership.id::text, 'success', null, v_before, v_after, 'rpc');

  return query select
    v_membership.id, v_membership.profile_id, v_membership.company_id, v_membership.role,
    v_membership.lifecycle_status, v_membership.is_active,
    v_successor_profile.id;
end;
$$;

revoke all on function public.offboard_manager(uuid, uuid, text) from public;
revoke all on function public.offboard_manager(uuid, uuid, text) from anon;
grant execute on function public.offboard_manager(uuid, uuid, text) to authenticated;

commit;
