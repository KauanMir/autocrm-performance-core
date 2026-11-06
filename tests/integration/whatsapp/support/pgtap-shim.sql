-- Implementação mínima das funções pgTAP usadas pelos testes Meta/WhatsApp, para rodar em
-- PGlite, que não tem a extensão pgtap. NÃO substitui o pgTAP real: o procedimento em
-- docs/WHATSAPP-CLOUD-API.md executa os mesmos arquivos em Supabase local.
create schema if not exists tap;
create table tap.results (n serial primary key, pass boolean, descr text, detail text);
grant usage on schema tap to public;
grant all on all tables in schema tap to public;
grant all on all sequences in schema tap to public;

create function public.no_plan() returns setof text language sql as $$ select 'plan'::text $$;
create function public.finish() returns setof text language sql as $$ select 'done'::text $$;

create function public.ok(boolean, text default '') returns text language plpgsql as $f$
begin
  insert into tap.results(pass, descr) values (coalesce($1, false), $2);
  return $2;
end $f$;

create function public.is(anyelement, anyelement, text default '') returns text language plpgsql as $f$
declare r boolean := $1 is not distinct from $2;
begin
  insert into tap.results(pass, descr, detail)
  values (r, $3, case when r then null else format('got %L want %L', $1, $2) end);
  return $3;
end $f$;

create function public.has_table(text, text, text default '') returns text language plpgsql as $f$
begin
  insert into tap.results(pass, descr) values (to_regclass($1 || '.' || $2) is not null, $3);
  return $3;
end $f$;

create function public.columns_are(text, text, text[], text default '') returns text language plpgsql as $f$
declare got text[]; r boolean;
begin
  select array_agg(column_name::text order by column_name) into got
    from information_schema.columns where table_schema = $1 and table_name = $2;
  r := got = (select array_agg(x order by x) from unnest($3) x);
  insert into tap.results(pass, descr, detail) values (r, $4, case when r then null else array_to_string(got, ',') end);
  return $4;
end $f$;

create function public.throws_ok(text, text default null, text default null, text default '') returns text language plpgsql as $f$
declare st text; msg text; r boolean;
begin
  begin
    execute $1;
    st := 'NO_ERROR';
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  r := st <> 'NO_ERROR' and st is not distinct from coalesce($2, st) and ($3 is null or msg is not distinct from $3);
  insert into tap.results(pass, descr, detail) values (r, $4, case when r then null else format('state %s msg %s', st, msg) end);
  return $4;
end $f$;

create function public.lives_ok(text, text default '') returns text language plpgsql as $f$
declare st text; msg text;
begin
  begin
    execute $1;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
  end;
  insert into tap.results(pass, descr, detail)
  values (st is null, $2, case when st is null then null else format('state %s msg %s', st, msg) end);
  return $2;
end $f$;

grant execute on function public.no_plan(), public.finish(), public.ok(boolean, text), public.has_table(text, text, text),
  public.columns_are(text, text, text[], text), public.throws_ok(text, text, text, text) to public;
grant execute on function public.is(anyelement, anyelement, text) to public;
grant execute on function public.lives_ok(text, text) to public;
