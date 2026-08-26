-- CRM-BULK-IMPORT-B1-EXEC-BACKEND — importação em massa de Leads (backend)
-- Fonte: CRM-BULK-IMPORT-A2-DESIGN (contrato fechado) + correções formais do
-- próprio B1 (p_filename no contrato, result_json para idempotência real,
-- advisory lock de serialização por empresa, timing final-only de
-- import_batches). Escopo estrito: tabela import_batches + RLS/grants,
-- helper interno insert_lead_row (extraído de create_lead, reaproveitado
-- pelas duas RPCs), create_lead com o MESMO contrato externo (assinatura,
-- erros, grants intocados — CREATE OR REPLACE preserva privilégios) e a RPC
-- pública bulk_import_leads. Nenhum frontend, nenhuma dependência instalada,
-- nenhum dado real importado.
--
-- Autoridade de escrita: SOMENTE estas RPCs SECURITY DEFINER. Nenhum GRANT
-- de INSERT/UPDATE/DELETE em leads ou import_batches para authenticated —
-- mesmo padrão de toda escrita comercial deste projeto desde o M1-E.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. public.import_batches
-- ═══════════════════════════════════════════════════════════════════════
-- result_json é o que torna a idempotência real (§10/§28 do B1): guarda
-- SOMENTE o suficiente para reconstruir a resposta de commit byte a byte
-- num replay (rowNumber/status/code/leadId) — NUNCA nome/telefone/carro/
-- origem/forma de pagamento originais da planilha. import_batches nunca
-- vira armazenamento de PII linha a linha (essa continua sendo
-- responsabilidade exclusiva do browser, nunca do servidor).
--
-- actor_profile_id usa FK SIMPLES para profiles(id) — igual a
-- audit_log.actor_profile_id, deliberadamente DIFERENTE do padrão composto
-- (company_id, profile_id) -> company_memberships usado em
-- leads.created_by_fk/updated_by_fk (m1e_01, corrigido em
-- 20260729120000_..._authorship_membership_fk). Aquele padrão composto só
-- existe em leads porque a autoria ali precisa refletir uma membership
-- histórica; aqui o campo é só "quem rodou o lote", e Super Admin nunca tem
-- company_id/membership — uma FK composta reproduziria o mesmo bug que já
-- foi corrigido uma vez neste projeto. Diferente de leads, aqui
-- actor_profile_id NUNCA é nulado para Super Admin: não há restrição de
-- "mesma empresa" a satisfazer, então a autoria real fica sempre completa.

create table public.import_batches (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  actor_profile_id  uuid references public.profiles(id) on delete set null,
  actor_kind        text not null,
  client_request_id uuid not null,
  filename          text not null,
  status            text not null,
  total_rows        integer not null,
  imported_count    integer not null,
  duplicate_count   integer not null,
  error_count       integer not null,
  result_json       jsonb not null,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz not null default now(),

  constraint import_batches_actor_kind_ck check (actor_kind in ('manager', 'super_admin')),
  constraint import_batches_status_ck check (status in ('completed', 'partial', 'failed')),
  constraint import_batches_filename_not_blank_ck check (btrim(filename) <> ''),
  constraint import_batches_total_rows_ck check (total_rows >= 0),
  constraint import_batches_imported_count_ck check (imported_count >= 0),
  constraint import_batches_duplicate_count_ck check (duplicate_count >= 0),
  constraint import_batches_error_count_ck check (error_count >= 0),

  -- idempotência real (§22/§28 do design): a MESMA tentativa (duplo clique,
  -- retry de rede) nunca processa duas vezes — ver bulk_import_leads.
  unique (company_id, client_request_id)
);

create index import_batches_company_id_idx on public.import_batches(company_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
-- can_access_company() (20260720110100) retorna true para QUALQUER
-- membership ativa da empresa, sem filtrar por role — um Seller também
-- passaria nela. Por isso a policy abaixo NUNCA usa can_access_company()
-- sozinha: combina com is_platform_super_admin() OR current_membership_role()
-- = 'manager', excluindo Seller explicitamente (Seller: zero linhas, nunca
-- erro). Sem sessão/sem membership: current_membership_role() retorna null
-- -> false -> zero linhas.

alter table public.import_batches enable row level security;

create policy import_batches_select on public.import_batches
  for select to authenticated
  using (
    public.can_access_company(company_id)
    and (public.is_platform_super_admin() or public.current_membership_role() = 'manager'::public.company_role)
  );

-- Nenhuma policy de INSERT/UPDATE/DELETE (negação dupla junto com a
-- ausência de grants abaixo) — escrita exclusiva de bulk_import_leads
-- (SECURITY DEFINER, roda como owner).

revoke all on table public.import_batches from public;
revoke all on table public.import_batches from anon;
revoke all on table public.import_batches from authenticated;

grant select on public.import_batches to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. helper interno: public.insert_lead_row(...)
-- ═══════════════════════════════════════════════════════════════════════
-- Extraído do meio de create_lead (20260731100000): INSERT em leads com os
-- MESMOS defaults de sempre (urgency 'red', labels iniciais, timeline
-- "Lead criado" via record_lead_timeline_event) + a MESMA regra de
-- created_by/updated_by NULL para Super Admin (leads_created_by_fk/
-- leads_updated_by_fk exigem profiles da MESMA company via
-- company_memberships — Super Admin nunca satisfaz isso, decisão humana já
-- registrada em 20260729110000). create_lead e bulk_import_leads chamam
-- este MESMO helper — nenhuma duplicação da lógica de negócio real.
--
-- Nunca exposto a authenticated/anon (sem GRANT EXECUTE) — chamado
-- exclusivamente de dentro de outras RPCs SECURITY DEFINER já autorizadas,
-- exatamente como record_lead_timeline_event/resolve_lead_mutation_context.
-- Todos os parâmetros já vêm RESOLVIDOS e VALIDADOS pelo chamador (empresa,
-- stage, seller) — este helper nunca reautoriza nem revalida nada.

create function public.insert_lead_row(
  p_company_id         uuid,
  p_actor_kind         text,
  p_actor_profile_id   uuid,
  p_stage_id           uuid,
  p_name               text,
  p_phone              text,
  p_car                text,
  p_seller_id          text,
  p_temperature        public.lead_temperature,
  p_payment_preference text,
  p_source             text
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.leads;
begin
  insert into public.leads (
    company_id, name, phone, car, stage_id, seller_id,
    urgency, temperature, last_activity_label, alert_label,
    payment_preference, source,
    created_by_profile_id, updated_by_profile_id
  ) values (
    p_company_id, p_name, p_phone, p_car, p_stage_id, p_seller_id,
    'red', p_temperature, 'Sem contato ainda', 'Fazer primeiro contato',
    p_payment_preference, p_source,
    case when p_actor_kind = 'super_admin' then null else p_actor_profile_id end,
    case when p_actor_kind = 'super_admin' then null else p_actor_profile_id end
  )
  returning * into v_row;

  perform public.record_lead_timeline_event(
    p_company_id, v_row.id, p_actor_kind, p_actor_profile_id,
    'plus', '#E8CE72', 'Lead criado', null);

  return v_row;
end;
$$;

revoke all on function public.insert_lead_row(
  uuid, text, uuid, uuid, text, text, text, text, public.lead_temperature, text, text
) from public;
revoke all on function public.insert_lead_row(
  uuid, text, uuid, uuid, text, text, text, text, public.lead_temperature, text, text
) from anon;
revoke all on function public.insert_lead_row(
  uuid, text, uuid, uuid, text, text, text, text, public.lead_temperature, text, text
) from authenticated;
-- Nenhum GRANT a authenticated de propósito — helper interno, nunca uma
-- porta nova de criação de Lead.

-- ═══════════════════════════════════════════════════════════════════════
-- 3. create_lead — MESMA assinatura pública, corpo reescrito para reusar
--    insert_lead_row. CREATE OR REPLACE (identidade preservada, nenhum
--    DROP+CREATE): grants/privilégios já publicados permanecem intactos
--    automaticamente. Contrato externo (parâmetros, defaults, mensagens de
--    erro, comportamento observável) NUNCA muda — só a implementação
--    interna do insert final passa a delegar ao helper.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.create_lead(
  p_name               text,
  p_phone              text,
  p_car                text,
  p_seller_id          text default null,
  p_temperature        public.lead_temperature default null,
  p_payment_preference text default null,
  p_source             text default null,
  p_company_id         uuid default null
) returns public.leads
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx      record;
  v_stage_id uuid;
  v_seller   text;
  v_row      public.leads;
begin
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id);

  if v_ctx.actor_kind = 'seller' then
    if p_seller_id is not null and p_seller_id is distinct from v_ctx.actor_seller_id then
      raise exception 'forbidden';
    end if;
    v_seller := v_ctx.actor_seller_id;
  else
    if p_seller_id is not null then
      perform 1 from public.sellers s
        where s.id = p_seller_id
          and s.company_id = v_ctx.resolved_company_id
          and s.is_active;
      if not found then
        raise exception 'seller_not_found';
      end if;
    end if;
    v_seller := p_seller_id;
  end if;

  select ps.id into v_stage_id
    from public.pipeline_stages ps
    where ps.company_id = v_ctx.resolved_company_id and ps.code = 'new';
  if v_stage_id is null then
    raise exception 'initial_stage_missing';
  end if;

  select * into v_row from public.insert_lead_row(
    v_ctx.resolved_company_id, v_ctx.actor_kind, v_ctx.actor_profile_id, v_stage_id,
    p_name, p_phone, p_car, v_seller, p_temperature, p_payment_preference, p_source);

  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_created', 'lead', v_row.id::text, 'success', null,
       null,
       jsonb_build_object('lead_id', v_row.id, 'stage_id', v_row.stage_id, 'seller_id', v_row.seller_id, 'archived', false),
       'rpc');
  end if;

  return v_row;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. bulk_import_leads — RPC pública de importação em massa
-- ═══════════════════════════════════════════════════════════════════════
-- p_dry_run=true: valida em lote (batched, uma única leitura contra
-- public.leads via ANY(array), nunca N round-trips) e retorna preview —
-- NUNCA insere Lead/timeline/import_batches/audit_log. Usa
-- resolve_lead_mutation_context(p_company_id, false) — o MESMO gate de
-- status de empresa do commit (ativa/implantacao), nunca um preview mais
-- permissivo que depois falha ao importar de verdade.
--
-- p_dry_run=false: idêntico até a classificação em lote; a partir daí
-- adquire um advisory lock por empresa (serializa dois bulk imports
-- concorrentes da MESMA empresa entre si — nunca bloqueia outras empresas),
-- verifica idempotência real por (company_id, client_request_id) e só então
-- processa. Cada linha 'valid' é REVALIDADA quanto a duplicidade
-- imediatamente antes do INSERT (nunca confia no resultado da classificação
-- anterior, muito menos num preview antigo) — se uma colisão aparecer nesse
-- instante, a linha vira 'duplicate' no resultado final, nunca uma exceção.
-- import_batches só é gravada UMA VEZ, no final, já com o resultado
-- definitivo — não existe status "importing" persistido (modelo síncrono:
-- uma falha inesperada reverte a transação inteira e nenhuma linha de
-- import_batches sobra).
--
-- Seller: forbidden incondicional (decisão de produto, igual a
-- archive_lead/assign_lead_seller/unarchive_lead) — nunca chega a validar
-- linha alguma.
--
-- NUNCA aceita por linha: company_id, id, stage_id, urgency, value_amount,
-- created_by/updated_by, version, timestamps, archived_at — nenhum desses
-- é lido de p_rows em nenhum ponto desta função.
--
-- Sem WHEN OTHERS em lugar nenhum: toda classificação de linha (erro/
-- duplicado/válido) é decidida ANTES do INSERT, por comparação de dados
-- (nunca por captura de exceção); a única revalidação no meio do commit é
-- um SELECT de existência (nunca gera exceção); um erro de banco genuíno e
-- inesperado (não previsto pela validação) propaga e aborta a transação
-- inteira — nunca um "sucesso parcial" fabricado escondendo um bug.
--
-- Risco residual documentado, não corrigido nesta etapa (mesmo padrão de
-- transparência de 20260731100000): não existe UNIQUE(company_id,
-- phone_digits) em leads. O advisory lock desta função serializa bulk vs
-- bulk da MESMA empresa; um create_lead manual concorrente (fora de
-- qualquer bulk import) ainda pode, em teoria, colidir na janela exata
-- entre a revalidação e o INSERT de uma linha — exatamente o mesmo risco
-- que create_lead manual já tem hoje contra outro create_lead manual
-- concorrente, não introduzido por esta migration. Corrigir isso de vez
-- exigiria alterar o schema de leads (fora do escopo autorizado aqui).

create function public.bulk_import_leads(
  p_rows                    jsonb,
  p_client_request_id       uuid,
  p_filename                text,
  p_car_fallback_enabled    boolean,
  p_dry_run                 boolean,
  p_company_id              uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx             record;
  v_stage_id        uuid;
  v_filename        text;
  v_total_rows      int;
  v_valid_count     int;
  v_duplicate_count int;
  v_error_count     int;
  v_imported_count  int;
  v_rows            jsonb;
  v_status          text;
  v_batch_id        uuid;
  v_existing        record;
  v_rec             record;
  v_temp_for_insert public.lead_temperature;
  v_lead            public.leads;
  v_out_rows        jsonb := '[]'::jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'bulk_import_generic_error';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'bulk_import_limit_exceeded';
  end if;
  if p_client_request_id is null then
    raise exception 'bulk_import_generic_error';
  end if;

  -- Mesmo resolver de create_lead/update_lead: Manager/Seller resolvidos
  -- exclusivamente pela membership ativa (p_company_id do cliente é
  -- ignorado); Super Admin exige p_company_id explícito, validado contra
  -- companies.status. p_read_only=false SEMPRE (dry-run incluso) — o preview
  -- nunca é mais permissivo que o commit real.
  select * into v_ctx from public.resolve_lead_mutation_context(p_company_id, false);

  if v_ctx.actor_kind = 'seller' then
    raise exception 'forbidden';
  end if;

  select ps.id into v_stage_id
    from public.pipeline_stages ps
    where ps.company_id = v_ctx.resolved_company_id and ps.code = 'new';
  if v_stage_id is null then
    raise exception 'initial_stage_missing';
  end if;

  -- p_filename é só metadado descritivo (nunca autoridade, nunca vira
  -- Storage/path) — sanitizado com trim + teto defensivo de 255 chars;
  -- nunca fica vazio (fallback 'import.csv').
  v_filename := left(coalesce(nullif(btrim(p_filename), ''), 'import.csv'), 255);

  -- ── classificação em lote (idêntica para dry-run e para a primeira
  --    passada do commit) ────────────────────────────────────────────────
  -- Espera linhas em snake_case (row_number/seller_id/payment_preference) —
  -- contrato de fio desta RPC; a tradução de camelCase (TS) para este
  -- formato é responsabilidade do repository de frontend (B2), o mesmo
  -- padrão já usado por createRemoteLead/updateRemoteLead ao montar os
  -- argumentos p_* de create_lead/update_lead a partir de payloads em
  -- camelCase.
  with incoming as (
    select
      (x->>'row_number')::int as row_number,
      nullif(btrim(x->>'name'), '') as name,
      nullif(btrim(x->>'phone'), '') as phone,
      regexp_replace(coalesce(x->>'phone', ''), '\D', '', 'g') as phone_digits,
      nullif(btrim(x->>'car'), '') as car_raw,
      nullif(btrim(x->>'source'), '') as source,
      nullif(btrim(x->>'seller_id'), '') as seller_id,
      nullif(btrim(x->>'temperature'), '') as temperature_raw,
      nullif(btrim(x->>'payment_preference'), '') as payment_preference
    from jsonb_array_elements(p_rows) as x
  ),
  resolved_car as (
    select i.*,
      case
        when i.car_raw is not null then i.car_raw
        when p_car_fallback_enabled then 'Não informado'
        else null
      end as car_final
    from incoming i
  ),
  resolved_temperature as (
    select r.*,
      case lower(coalesce(r.temperature_raw, ''))
        when 'hot' then 'hot' when 'warm' then 'warm' when 'cold' then 'cold' else null
      end as temperature_final,
      (r.temperature_raw is not null and lower(r.temperature_raw) not in ('hot', 'warm', 'cold')) as temperature_invalid
    from resolved_car r
  ),
  dedup_batch as (
    select t.*,
      row_number() over (partition by t.phone_digits order by t.row_number) as dup_rank
    from resolved_temperature t
  ),
  -- Uma única leitura indexada (leads_company_phone_digits_idx) para o
  -- lote inteiro — nunca N chamadas de check_lead_phone_duplicate.
  existing_dup as (
    select distinct l.phone_digits
      from public.leads l
     where l.company_id = v_ctx.resolved_company_id
       and l.phone_digits = any (array(
         select distinct d.phone_digits from dedup_batch d where d.phone_digits <> ''
       ))
  ),
  seller_valid as (
    select s.id
      from public.sellers s
     where s.company_id = v_ctx.resolved_company_id
       and s.is_active
       and s.id = any (array(
         select distinct d.seller_id from dedup_batch d where d.seller_id is not null
       ))
  ),
  classified as (
    select
      d.row_number, d.name, d.phone, d.phone_digits, d.car_final, d.source,
      d.seller_id, d.temperature_final, d.temperature_invalid, d.payment_preference,
      case
        when d.name is null then 'error'
        when d.phone is null or d.phone_digits = '' then 'error'
        when d.car_final is null then 'error'
        when d.seller_id is not null and not exists (select 1 from seller_valid sv where sv.id = d.seller_id) then 'error'
        when d.dup_rank > 1 then 'duplicate'
        when exists (select 1 from existing_dup ed where ed.phone_digits = d.phone_digits) then 'duplicate'
        else 'valid'
      end as status,
      case
        when d.name is null then 'name_required'
        when d.phone is null or d.phone_digits = '' then 'phone_required'
        when d.car_final is null then 'car_required'
        when d.seller_id is not null and not exists (select 1 from seller_valid sv where sv.id = d.seller_id) then 'seller_not_found'
        when d.dup_rank > 1 then 'duplicate_phone'
        when exists (select 1 from existing_dup ed where ed.phone_digits = d.phone_digits) then 'duplicate_phone'
        -- Nunca vira erro (§16/§23 do A2): linha permanece 'valid', só o
        -- code sinaliza o aviso — temperature grava NULL.
        when d.temperature_invalid then 'invalid_temperature'
        else null
      end as code
    from dedup_batch d
  )
  select
    count(*)::int,
    count(*) filter (where status = 'valid')::int,
    count(*) filter (where status = 'duplicate')::int,
    count(*) filter (where status = 'error')::int,
    coalesce(jsonb_agg(jsonb_build_object(
      'row_number', row_number, 'status', status, 'code', code,
      'name', name, 'phone', phone, 'car', car_final, 'seller_id', seller_id,
      'temperature', temperature_final, 'source', source, 'payment_preference', payment_preference
    ) order by row_number), '[]'::jsonb)
  into v_total_rows, v_valid_count, v_duplicate_count, v_error_count, v_rows
  from classified;

  if p_dry_run then
    return jsonb_build_object(
      'total_rows', v_total_rows,
      'valid_count', v_valid_count,
      'duplicate_count', v_duplicate_count,
      'error_count', v_error_count,
      'rows', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'row_number', (r->>'row_number')::int,
          'status', r->>'status',
          'code', r->>'code',
          'normalized', jsonb_build_object(
            'name', r->>'name', 'phone', r->>'phone', 'car', r->>'car',
            'seller_id', r->>'seller_id', 'temperature', r->>'temperature',
            'source', r->>'source', 'payment_preference', r->>'payment_preference'
          )
        ) order by (r->>'row_number')::int), '[]'::jsonb)
        from jsonb_array_elements(v_rows) as r
      )
    );
  end if;

  -- ── COMMIT (p_dry_run = false) ────────────────────────────────────────

  -- Serializa bulk imports concorrentes da MESMA empresa (§27 do B1) —
  -- transaction-scoped, liberado automaticamente ao fim desta chamada.
  -- Nunca bloqueia outra empresa (chave inclui resolved_company_id).
  perform pg_advisory_xact_lock(hashtext('bulk_import_leads'), hashtext(v_ctx.resolved_company_id::text));

  -- Idempotência real: com o lock já adquirido, esta leitura e o INSERT
  -- final de import_batches abaixo nunca correm concorrentemente para a
  -- MESMA empresa — duas chamadas com o mesmo client_request_id são
  -- inteiramente serializadas por este lock (a segunda só prossegue depois
  -- que a primeira já commitou sua linha de import_batches, e cai direto
  -- neste "if found"). Por isso o INSERT final não precisa (e não tem) де
  -- tratamento de unique_violation: a condição de corrida que a
  -- constraint existe para prevenir já é estruturalmente inatingível dado
  -- este ordenamento lock -> check -> insert.
  select id, status, total_rows, imported_count, duplicate_count, error_count, result_json
    into v_existing
    from public.import_batches
    where company_id = v_ctx.resolved_company_id and client_request_id = p_client_request_id;

  if found then
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'status', v_existing.status,
      'total_rows', v_existing.total_rows,
      'imported_count', v_existing.imported_count,
      'duplicate_count', v_existing.duplicate_count,
      'error_count', v_existing.error_count,
      'rows', v_existing.result_json
    );
  end if;

  v_imported_count := 0;

  for v_rec in
    select
      (r->>'row_number')::int as row_number,
      r->>'status' as status,
      r->>'code' as code,
      r->>'name' as name,
      r->>'phone' as phone,
      r->>'car' as car,
      r->>'seller_id' as seller_id,
      r->>'temperature' as temperature,
      r->>'source' as source,
      r->>'payment_preference' as payment_preference
    from jsonb_array_elements(v_rows) as r
    order by (r->>'row_number')::int
  loop
    if v_rec.status <> 'valid' then
      v_out_rows := v_out_rows || jsonb_build_object(
        'row_number', v_rec.row_number,
        'status', case when v_rec.status = 'duplicate' then 'duplicate' else 'error' end,
        'code', v_rec.code
      );
      continue;
    end if;

    -- Revalidação TOCTOU (§12 do A2 / §26 do B1): NUNCA confia na
    -- classificação acima nem em qualquer preview anterior. Sempre um
    -- SELECT de existência — nunca uma exceção — então nunca precisa de
    -- WHEN OTHERS aqui.
    if exists (
      select 1 from public.leads l
       where l.company_id = v_ctx.resolved_company_id
         and l.phone_digits = regexp_replace(coalesce(v_rec.phone, ''), '\D', '', 'g')
    ) then
      v_out_rows := v_out_rows || jsonb_build_object(
        'row_number', v_rec.row_number, 'status', 'duplicate', 'code', 'duplicate_phone');
      continue;
    end if;

    v_temp_for_insert := case v_rec.temperature
      when 'hot' then 'hot'::public.lead_temperature
      when 'warm' then 'warm'::public.lead_temperature
      when 'cold' then 'cold'::public.lead_temperature
      else null
    end;

    select * into v_lead from public.insert_lead_row(
      v_ctx.resolved_company_id, v_ctx.actor_kind, v_ctx.actor_profile_id, v_stage_id,
      v_rec.name, v_rec.phone, v_rec.car, v_rec.seller_id, v_temp_for_insert,
      v_rec.payment_preference, v_rec.source);

    v_imported_count := v_imported_count + 1;
    v_out_rows := v_out_rows || jsonb_build_object(
      'row_number', v_rec.row_number, 'status', 'imported', 'code', v_rec.code, 'lead_id', v_lead.id);
  end loop;

  -- Contagens finais SEMPRE recomputadas do resultado real do loop (nunca
  -- reaproveitadas da classificação inicial) — a revalidação TOCTOU pode
  -- ter reclassificado linhas 'valid' para 'duplicate' durante o commit.
  select
    count(*) filter (where (o->>'status') = 'duplicate')::int,
    count(*) filter (where (o->>'status') = 'error')::int
  into v_duplicate_count, v_error_count
  from jsonb_array_elements(v_out_rows) as o;

  -- §39: completed mesmo com 0 importados se error_count=0 (ex.: reenvio
  -- 100% duplicado); partial só quando há erro E ao menos 1 importado;
  -- failed quando há erro e nada foi importado. Nunca persistido:
  -- draft/validating/importing (modelo síncrono, final-only).
  v_status := case
    when v_error_count = 0 then 'completed'
    when v_imported_count > 0 then 'partial'
    else 'failed'
  end;

  insert into public.import_batches (
    company_id, actor_profile_id, actor_kind, client_request_id, filename,
    status, total_rows, imported_count, duplicate_count, error_count, result_json
  ) values (
    v_ctx.resolved_company_id, v_ctx.actor_profile_id, v_ctx.actor_kind, p_client_request_id, v_filename,
    v_status, v_total_rows, v_imported_count, v_duplicate_count, v_error_count, v_out_rows
  )
  returning id into v_batch_id;

  -- Auditoria: mesmo padrão de create_lead/update_lead/etc. — somente
  -- mutation de Super Admin grava audit_log; Manager já tem import_batches
  -- como auditoria própria do lote (nunca ampliamos audit_log global para
  -- cobrir Manager, decisão do B1 §36).
  if v_ctx.actor_kind = 'super_admin' then
    insert into public.audit_log
      (actor_profile_id, company_id, action, entity_type, entity_id, result, reason, before_data, after_data, origin)
    values
      (v_ctx.actor_profile_id, v_ctx.resolved_company_id, 'lead_bulk_imported', 'import_batch', v_batch_id::text,
       case when v_status = 'failed' then 'failure' else 'success' end, null,
       null,
       jsonb_build_object('total_rows', v_total_rows, 'imported_count', v_imported_count,
                           'duplicate_count', v_duplicate_count, 'error_count', v_error_count),
       'rpc');
  end if;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'status', v_status,
    'total_rows', v_total_rows,
    'imported_count', v_imported_count,
    'duplicate_count', v_duplicate_count,
    'error_count', v_error_count,
    'rows', v_out_rows
  );
end;
$$;

revoke all on function public.bulk_import_leads(jsonb, uuid, text, boolean, boolean, uuid) from public;
revoke all on function public.bulk_import_leads(jsonb, uuid, text, boolean, boolean, uuid) from anon;
revoke all on function public.bulk_import_leads(jsonb, uuid, text, boolean, boolean, uuid) from authenticated;
grant execute on function public.bulk_import_leads(jsonb, uuid, text, boolean, boolean, uuid) to authenticated;

commit;
