-- scripts/meta/rcar-pilot-readiness.sql — leitura do estado da produção antes do
-- piloto Lead Ads da RCAR. SOMENTE LEITURA: uma única consulta SELECT, sem
-- escrita, sem função com efeito colateral. Devolve contagens e status, nunca
-- nome de pessoa, e-mail, telefone, token ou conteúdo de lead.
--
-- Uso: Supabase → SQL Editor do projeto de produção → colar e executar.
-- Funciona antes e depois das migrations do MVP (as colunas do MVP-2 aparecem
-- como null quando a tabela ainda não existe — ver o bloco "mvp2_applied").
select
  c.id                                   as company_id,
  coalesce(c.trade_name, c.name)         as company,
  c.status                               as company_status,      -- precisa ser 'ativa'
  (select count(*) from public.company_memberships m
     where m.company_id = c.id and m.is_active and m.role = 'manager') as active_managers,
  (select count(*) from public.company_memberships m
     where m.company_id = c.id and m.is_active and m.role = 'seller')  as active_sellers,
  exists (select 1 from public.pipeline_stages s
           where s.company_id = c.id and s.code = 'new')               as has_new_stage,
  (select count(*) from public.leads l
     where l.company_id = c.id and l.archived_at is null)              as active_leads,
  (select count(*) from public.leads l
     where l.company_id = c.id and l.source = 'Meta Lead Ads')         as meta_leads_total,
  (select count(*) from public.company_meta_integrations i
     where i.company_id = c.id and i.status = 'connected')             as meta_pages_connected,
  (select count(*) from public.company_meta_integrations i
     where i.company_id = c.id and i.status = 'error')                 as meta_pages_error,
  (select count(*) from public.meta_leadgen_events e
     where e.company_id = c.id and e.status <> 'processed')            as meta_events_not_processed,
  to_regclass('public.company_meta_lead_ads_access') is not null       as mvp2_applied,
  (select count(*) from supabase_migrations.schema_migrations)         as remote_migrations
from public.companies c
order by c.created_at;
