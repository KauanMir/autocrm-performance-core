-- COMMERCIAL-REMOTE-SALES-A1 — Vendas remoto: schema + RLS + RPC register_sale.
-- Fonte: COMMERCIAL-REMOTE-SALES-A1-PRECHECK. Escopo: exclusivamente o
-- backend de Sales. Nenhum frontend, nenhuma feature flag, nenhuma alteração
-- em Leads/Tasks/Visits/Deals (schema existente reaproveitado sem mudança).
-- Migration NÃO aplicada remotamente neste lote (LOCAL=54/REMOTE=53).
--
-- Entidade: SALE = VENDA — negócio realmente fechado. Nasce SEMPRE de uma
-- Deal OPEN existente (nunca solta) e é IMUTÁVEL desde o nascimento: zero
-- update_sale/cancel_sale/delete_sale/restore_sale neste V1 (divergência
-- deliberada do legado local, que tem SALE_STATUS.CANCELED — não replicada
-- aqui; ver PRECHECK §19).
--
-- Lifecycle: Deal OPEN --register_sale--> Sale persistida + Deal SOLD, tudo
-- na MESMA transação (mesma function, sem BEGIN/COMMIT manual — PL/pgSQL já
-- roda dentro da transação implícita da chamada RPC). ZERO approval, ZERO
-- status intermediário. register_sale é a ÚNICA autoridade pública para
-- open -> sold — nenhuma RPC mark_deal_sold é criada (documentado desde o
-- B1 de Deals: "sold permanece inalcançável pelos RPCs deste lote").
--
-- Campos autoritativos (company_id/lead_id/assigned_seller_id) são SEMPRE
-- copiados da própria Deal dentro do RPC — o frontend nunca escolhe
-- company/Lead/Seller ao registrar uma venda (evita spoofing). Frontend
-- controla apenas: deal_id, expected_version, sold_value_cents (preço final
-- pode divergir do value_cents atualmente negociado), payment_method (forma
-- final). vehicle NÃO é duplicado — permanece acessível via FK deal_id (Deal
-- SOLD é imutável pelas RPCs atuais de update_deal/mark_deal_lost, que só
-- operam sobre status='open').
--
-- Resolver de contexto: resolve_commercial_mutation_context (20260819100000)
-- — já documentado como compartilhado "para Tasks/Visits/Deals/Sales" desde
-- sua criação — reutilizado sem alteração.
--
-- Permissões: Manager registra venda de qualquer Deal OPEN da company;
-- Seller só da própria Deal OPEN (assigned_seller_id = actor_seller_id),
-- mesmo padrão de mark_deal_lost. Nenhuma aprovação.
--
-- Concorrência: SELECT ... FOR UPDATE trava a Deal antes de qualquer
-- validação de status/version — duas chamadas concorrentes na mesma Deal
-- serializam (a segunda, ao destravar, já enxerga o estado pós-primeira
-- chamada e falha com deal_closed/stale_write, nunca cria uma segunda
-- Sale). UNIQUE(deal_id) permanece como defesa estrutural adicional
-- (nunca a única linha de defesa). Mesmo contrato de version/
-- expected_version/stale_write de create_deal/update_deal/mark_deal_lost.
--
-- Timeline: record_lead_timeline_event (helper interno já existente),
-- exatamente 1 evento "Venda registrada" por chamada bem-sucedida, mesma
-- transação, mesmo critério das RPCs de Deals.
--
-- Sem DELETE: nenhum RPC de remoção física — Sale é registro histórico
-- terminal, mesmo padrão de archive_lead/complete_task/mark_deal_lost.
--
-- Sem sale_status: Sale nasce final, sem lifecycle próprio neste V1.

begin;

-- ── deals: habilitar FK composta (company_id, id) ──────────────────────
-- Nenhuma tabela referenciava deals via FK composta até agora (mesma razão
-- pela qual leads/sellers/profiles/pipeline_stages/company_memberships já
-- têm um `unique (company_id, id)` análogo desde suas migrations de
-- origem — m1c_01/m1e_01/m1f_s1_01/m1c_02). Aditivo puro: nenhuma coluna,
-- RLS, RPC ou dado existente é tocado.
alter table public.deals
  add constraint deals_id_company_uidx unique (company_id, id);

-- ── table public.sales ───────────────────────────────────────────────────
-- Estrutura de "log imutável" — mesmo padrão de public.lead_timeline_entries
-- (só created_at, sem updated_at/version: a row nunca é editada depois de
-- inserida). sold_at é o timestamp de negócio (quando a venda aconteceu,
-- servidor autoritativo); created_at é o timestamp estrutural da linha —
-- mesma distinção já usada em lead_timeline_entries (occurred_at/created_at).

create table public.sales (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  deal_id               uuid not null,
  lead_id               uuid not null,
  assigned_seller_id    text not null,
  sold_value_cents      bigint not null,
  payment_method        public.deal_payment_method not null,
  sold_by               uuid not null,
  sold_at               timestamptz not null default now(),
  created_at            timestamptz not null default now(),

  constraint sales_sold_value_ck check (sold_value_cents > 0),

  -- Uma Deal produz no máximo uma Sale — defesa estrutural, nunca depende
  -- só do guard de aplicação em register_sale.
  constraint sales_deal_id_uniq unique (deal_id),

  constraint sales_company_deal_fk
    foreign key (company_id, deal_id)
    references public.deals (company_id, id)
    on delete restrict,

  constraint sales_company_lead_fk
    foreign key (company_id, lead_id)
    references public.leads (company_id, id)
    on delete restrict,

  constraint sales_company_seller_fk
    foreign key (company_id, assigned_seller_id)
    references public.sellers (company_id, id)
    on delete restrict,

  constraint sales_sold_by_fk
    foreign key (company_id, sold_by)
    references public.company_memberships (company_id, profile_id)
    on delete restrict
);

-- ── indexes (mesmo critério de Tasks/Visits/Deals — só os justificados
-- pelos readers reais já previstos: vendas por período, vendas por Seller,
-- receita por Seller — Ranking futuro, não implementado aqui) ────────────

create index sales_company_sold_at_idx
  on public.sales (company_id, sold_at);

create index sales_company_seller_sold_at_idx
  on public.sales (company_id, assigned_seller_id, sold_at);

-- ── RLS: somente SELECT ───────────────────────────────────────────────
-- Espelha deals_select exatamente. Seller aqui é SEMPRE own-only
-- (assigned_seller_id NOT NULL, copiado da Deal). Super Admin não recebe
-- nenhuma policy neste A1 — current_membership_company_id() é sempre NULL
-- para Super Admin, então a policy nega por construção.

alter table public.sales enable row level security;

create policy sales_select on public.sales
  for select to authenticated
  using (
    company_id = public.current_membership_company_id()
    and exists (
      select 1 from public.companies c
      where c.id = sales.company_id and c.status = 'ativa'
    )
    and (
      public.current_membership_role() = 'manager'
      or (
        public.current_membership_role() = 'seller'
        and assigned_seller_id = public.current_profile_seller_id_for_company(sales.company_id)
      )
    )
  );

-- ── grants: SELECT-only ──────────────────────────────────────────────

revoke all on table public.sales from public;
revoke all on table public.sales from anon;
revoke all on table public.sales from authenticated;

grant select on table public.sales to authenticated;

-- ── register_sale ─────────────────────────────────────────────────────
-- Única autoridade pública para open -> sold. Deal OPEN + expected_version
-- corretos -> Sale persistida + Deal.status = 'sold', atômico, mesma
-- transação. Erros estáveis: forbidden, deal_not_found, deal_closed,
-- invalid_value, invalid_payment_method, stale_write.
create function public.register_sale(
  p_deal_id            uuid,
  p_expected_version   integer,
  p_sold_value_cents   bigint,
  p_payment_method     public.deal_payment_method
) returns public.deals
language plpgsql security definer set search_path = '' as $$
declare
  v_ctx  record;
  v_deal public.deals;
  v_row  public.deals;
begin
  select * into v_ctx from public.resolve_commercial_mutation_context();

  if p_expected_version is null then
    raise exception 'stale_write';
  end if;

  if p_sold_value_cents is null or p_sold_value_cents <= 0 then
    raise exception 'invalid_value';
  end if;

  if p_payment_method is null then
    raise exception 'invalid_payment_method';
  end if;

  -- Trava a Deal antes de qualquer decisão: serializa chamadas concorrentes
  -- na MESMA Deal (a segunda, ao destravar, já enxerga o estado
  -- pós-primeira chamada e falha em deal_closed/stale_write logo abaixo —
  -- nunca cria uma segunda Sale). UNIQUE(deal_id) permanece como defesa
  -- estrutural adicional, nunca a única linha de defesa.
  select d.* into v_deal
    from public.deals d
    where d.id = p_deal_id and d.company_id = v_ctx.resolved_company_id
    for update;
  if v_deal.id is null then
    raise exception 'deal_not_found';
  end if;

  if v_ctx.actor_kind = 'seller' and v_deal.assigned_seller_id is distinct from v_ctx.actor_seller_id then
    raise exception 'forbidden';
  end if;

  if v_deal.status <> 'open' then
    raise exception 'deal_closed';
  end if;

  -- company_id/lead_id/assigned_seller_id vêm SEMPRE da Deal já travada —
  -- nunca do cliente (evita spoofing, PRECHECK §6/§15).
  insert into public.sales (
    company_id, deal_id, lead_id, assigned_seller_id,
    sold_value_cents, payment_method, sold_by
  ) values (
    v_deal.company_id, v_deal.id, v_deal.lead_id, v_deal.assigned_seller_id,
    p_sold_value_cents, p_payment_method, v_ctx.actor_profile_id
  );

  update public.deals
    set status     = 'sold',
        updated_by = v_ctx.actor_profile_id
    where id = p_deal_id
      and company_id = v_ctx.resolved_company_id
      and version = p_expected_version
      and status = 'open'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'stale_write';
  end if;

  perform public.record_lead_timeline_event(
    v_ctx.resolved_company_id, v_deal.lead_id, v_ctx.actor_kind, v_ctx.actor_profile_id,
    'trophy', '#E8CE72', 'Venda registrada', null);

  return v_row;
end;
$$;

revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from public;
revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from anon;
revoke all on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) from authenticated;
grant execute on function public.register_sale(uuid, integer, bigint, public.deal_payment_method) to authenticated;

commit;
