# scripts/db/rehearse-restore-migrations.ps1 — release rehearsal on a restored
# copy of production. LOCAL ONLY; never points at a remote database.
#
#   1. starts a disposable Supabase Postgres container with networking disabled
#      and no published ports;
#   2. decrypts the DPAPI (CurrentUser) backup archive IN MEMORY and streams
#      roles/schema/data/migration history/ACL into it (no plaintext on disk);
#   3. applies, in order, every local migration whose version is missing from
#      the restored supabase_migrations history (each file in one transaction);
#   4. checks that existing data counts did not change, RLS/grants of the new
#      tables, and runs every pgTAP file in supabase/tests (each rolls back);
#   5. removes the container (unless -KeepContainer).
# Output is aggregate counts and pass/fail only — never row data.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db/rehearse-restore-migrations.ps1 [-SkipMigrations]
param(
  [string] $Archive = (Join-Path $env:USERPROFILE '.codex\backups\w2b-20261106\database-with-acl.zip.dpapi'),
  [string] $Image = 'public.ecr.aws/supabase/postgres:17.11.0.003',
  [switch] $KeepContainer,
  # Baseline: restore and run the same checks without applying pending files.
  [switch] $SkipMigrations,
  # Clean: no backup at all; every migration from scratch on the bare image
  # (the pgTAP contract baseline, separating data/ACL artefacts of the restore).
  [switch] $Clean,
  # Print the description of each failing pgTAP assertion (never diagnostics,
  # which may echo row values).
  [switch] $ShowFailures
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.IO.Compression

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$container = "kapa-restore-rehearsal-$PID"
$results = New-Object System.Collections.Generic.List[object]
function Check([string] $name, [bool] $pass, [string] $detail = '') {
  $results.Add([pscustomobject]@{ name = $name; pass = $pass })
  $mark = if ($pass) { 'PASS' } else { 'FAIL' }
  if (-not $pass -and $detail) { Write-Output "$mark  $name  -- $detail" } else { Write-Output "$mark  $name" }
}

function Invoke-Psql([string] $sql, [IO.Stream] $stream = $null, [string] $user = 'supabase_admin', [switch] $Tuples, [switch] $Single) {
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = 'docker'
  $flags = if ($Tuples) { '-At' } else { '-q' }
  if ($Single) { $flags = "$flags -1" }
  $info.Arguments = "exec -i $container psql -X $flags -U $user -d postgres -v ON_ERROR_STOP=1"
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($info)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if ($sql) { $process.StandardInput.WriteLine($sql); $process.StandardInput.Flush() }
  if ($stream) { $stream.CopyTo($process.StandardInput.BaseStream) }
  $process.StandardInput.Close()
  $process.WaitForExit()
  $out = $stdout.GetAwaiter().GetResult()
  $err = $stderr.GetAwaiter().GetResult()
  $code = $process.ExitCode
  $process.Dispose()
  # Only the first ERROR line is surfaced: it names the failing statement, never data.
  $firstError = ($err -split "`n" | Where-Object { $_ -match 'ERROR:' } | Select-Object -First 1)
  return [pscustomobject]@{ ok = ($code -eq 0); out = $out.Trim(); error = $firstError }
}

function Query([string] $sql) {
  $r = Invoke-Psql $sql -Tuples
  if (-not $r.ok) { throw "query failed: $($r.error)" }
  return $r.out
}

if (-not $Clean -and -not (Test-Path -LiteralPath $Archive)) { throw "Backup archive not found: $Archive" }
docker run -d --rm --network none --name $container -e POSTGRES_PASSWORD=local-disposable-test -e POSTGRES_DB=postgres $Image | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'docker run failed' }
try {
  $ready = $false
  for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
    try { docker exec $container pg_isready -U postgres -d postgres 2>$null | Out-Null; $ok = ($LASTEXITCODE -eq 0) } catch { $ok = $false }
    if ($ok) { $ready = $true } else { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw 'database did not become ready' }
  # The image runs its own init scripts (and restarts Postgres) after the first ready signal.
  # A fixed sleep raced them on 2026-11-12 ("database system is shutting down", "could not open
  # relation with OID"): wait until auth.users exists and 5 consecutive probes succeed.
  $stable = 0
  for ($i = 0; $i -lt 60 -and $stable -lt 5; $i++) {
    Start-Sleep -Seconds 2
    try {
      $o = docker exec $container psql -X -At -U supabase_admin -d postgres -c "select (to_regclass('auth.users') is not null)::int" 2>$null
      $ok = ($LASTEXITCODE -eq 0 -and "$o".Trim() -eq '1')
    } catch { $ok = $false }
    if ($ok) { $stable++ } else { $stable = 0 }
  }
  if ($stable -lt 5) { throw 'image init did not settle' }
  Write-Output ("Container {0} ({1}), network none" -f $container, (Query 'show server_version'))

  if ($Clean) {
    Write-Output 'CLEAN: no backup restored; all migrations applied from scratch'
    # The bare image has no Storage schema (the storage-api service creates it);
    # a minimal stand-in, same shape as tests/integration/whatsapp/support/supabase-stub.sql.
    $r = Invoke-Psql @'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint,
  allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), path_tokens text[]);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
'@
    if (-not $r.ok) { throw "history table failed: $($r.error)" }
  } else {
  # ── restore (in memory) ──────────────────────────────────────────────────────
  $cipher = [IO.File]::ReadAllBytes($Archive)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $memory = New-Object IO.MemoryStream (, $plain)
  $zip = New-Object IO.Compression.ZipArchive ($memory, [IO.Compression.ZipArchiveMode]::Read)
  try {
    $r = Invoke-Psql 'drop schema auth cascade; drop schema storage cascade;'
    if (-not $r.ok) { throw "reset managed schemas failed: $($r.error)" }
    # Platform-managed roles production may have and this image may lack (2026-11-12:
    # supabase_realtime_admin, target of GRANT SET ON PARAMETER in roles.sql). Created without
    # login or privileges, only when missing; a real Supabase project already has them.
    $r = Invoke-Psql "do `$`$ declare r text; begin foreach r in array array['supabase_realtime_admin'] loop if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin noinherit', r); end if; end loop; end `$`$;"
    if (-not $r.ok) { throw "managed roles failed: $($r.error)" }
    foreach ($name in @('roles.sql', 'restore-schema.sql', 'data.sql', 'migration-data.sql', 'production-acl.sql')) {
      $entry = $zip.GetEntry($name)
      if (-not $entry) { throw "archive entry missing: $name" }
      $entryStream = $entry.Open()
      try {
        $prefix = if ($name -eq 'data.sql') { 'set session_replication_role = replica;' } else { '' }
        $r = Invoke-Psql $prefix $entryStream
        if (-not $r.ok) { throw "restore step $name failed: $($r.error)" }
      } finally { $entryStream.Dispose() }
    }
  } finally {
    $zip.Dispose(); $memory.Dispose(); [Array]::Clear($plain, 0, $plain.Length); [Array]::Clear($cipher, 0, $cipher.Length)
  }
  }

  $countsSql = "select concat_ws(',', (select count(*) from public.companies), (select count(*) from public.leads), (select count(*) from auth.users), (select count(*) from public.meta_leadgen_events), (select count(*) from public.lead_timeline_entries))"
  $before = if ($Clean) { '' } else { Query $countsSql }
  $applied = @((Query 'select version from supabase_migrations.schema_migrations order by version') -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  Write-Output ("Restored: companies,leads,users,meta_events,timeline = {0}; migration history = {1}" -f $before, $applied.Count)

  # ── pending migrations ───────────────────────────────────────────────────────
  $files = Get-ChildItem -LiteralPath (Join-Path $root 'supabase\migrations') -Filter '*.sql' | Sort-Object Name
  $pending = @($files | Where-Object { $applied -notcontains ($_.Name -split '_')[0] })
  if ($SkipMigrations) { Write-Output 'BASELINE: pending migrations are NOT applied'; $pending = @() }
  $latestApplied = ($applied | Sort-Object | Select-Object -Last 1)
  $older = @($pending | Where-Object { (($_.Name -split '_')[0]) -lt $latestApplied })
  Check 'no pending migration predates the restored history' ($older.Count -eq 0) (($older | ForEach-Object Name) -join ', ')
  Write-Output ("Pending migrations to apply: {0}" -f $pending.Count)
  foreach ($file in $pending) {
    $version = ($file.Name -split '_')[0]
    $label = ($file.BaseName -replace '^[0-9]+_', '')
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $sqlStream = New-Object IO.MemoryStream (, $bytes)
    # Same transaction: the file and its history row (as the Supabase CLI records it).
    $r = Invoke-Psql "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$label');" $sqlStream -Single
    $sqlStream.Dispose()
    Check "apply $($file.Name)" $r.ok $r.error
    if (-not $r.ok) { throw 'migration rehearsal stopped at the first failure' }
  }

  # ── post-migration checks ────────────────────────────────────────────────────
  if (-not $Clean) {
    $after = Query $countsSql
    Check 'existing companies/leads/users/Meta events/timeline counts unchanged' ($after -eq $before) "$before -> $after"
  }
  Check 'existing leads keep their phone' ((Query 'select count(*) from public.leads where phone is null') -eq '0')
  Check 'migration history recorded every applied file' ((Query 'select count(*) from supabase_migrations.schema_migrations') -eq [string]($applied.Count + $pending.Count))
  $newTables = "'instagram_connections','instagram_conversations','instagram_messages','lead_channel_identities','whatsapp_conversations','whatsapp_messages','whatsapp_contacts'"
  Check 'RLS enabled on channel tables' ((Query "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ($newTables) and not relrowsecurity") -eq '0')
  $grants = Query "select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ($newTables) and grantee in ('anon','authenticated')"
  Check 'no anon/authenticated table grants on channel tables' ($grants -eq '0') "$grants grants"
  $exposed = Query "select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'instagram\_%' or p.proname like 'channel\_%' or p.proname like 'whatsapp\_conversation\_intake%' or p.proname like 'lock\_lead\_phone%') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))"
  Check 'no channel RPC executable by anon/authenticated' ($exposed -eq '0') "$exposed functions"
  $definers = Query 'select count(*) from pg_proc p where p.pronamespace = ''public''::regnamespace and p.prosecdef and (p.proname like ''instagram\_%'' or p.proname like ''channel\_%'') and not coalesce(p.proconfig @> array[''search_path=""''], false)'
  Check 'channel SECURITY DEFINER functions pin search_path' ($definers -eq '0') "$definers functions"
  $synthetic = Invoke-Psql @"
begin;
insert into public.leads (company_id, name, phone, car, stage_id)
  select c.id, 'Rehearsal synthetic', '62900000000', 'Car', s.id
  from public.companies c join public.pipeline_stages s on s.company_id = c.id
  order by c.id, s.sort_order limit 1;
rollback;
"@
  Check 'lead insert with the phone-class lock trigger works on restored data (rolled back)' $synthetic.ok $synthetic.error

  # ── pgTAP contracts (each file rolls back) ───────────────────────────────────
  # Most files assume the seed users and an otherwise empty database, so on real
  # restored data they fail for data reasons (e.g. "no Super Admin exists"). The
  # gate is therefore the channel contracts (8x files), which create their own
  # fixtures; every other failure is reported for comparison with a
  # -SkipMigrations baseline (identical sets mean no regression). The official
  # full contract run is `supabase db reset` + `supabase test db` on an isolated
  # local project (see docs/RELEASE-REHEARSAL.md).
  $okTotal = 0; $failedFiles = @(); $gateFailures = @()
  foreach ($test in (Get-ChildItem -LiteralPath (Join-Path $root 'supabase\tests') -Filter '*.sql' | Sort-Object Name)) {
    $bytes = [IO.File]::ReadAllBytes($test.FullName)
    $testStream = New-Object IO.MemoryStream (, $bytes)
    $r = Invoke-Psql '' $testStream -Tuples
    $testStream.Dispose()
    $lines = $r.out -split "`n"
    $notOk = @($lines | Where-Object { $_ -match '^\s*not ok' }).Count
    $okTotal += @($lines | Where-Object { $_ -match '^\s*ok ' }).Count
    if ($ShowFailures -and $notOk -gt 0) {
      $lines | Where-Object { $_ -match '^\s*not ok' } | ForEach-Object { Write-Output ("  {0}: {1}" -f $test.Name, $_.Trim()) }
    }
    if (-not $r.ok -or $notOk -gt 0) {
      $entry = "$($test.Name) (not ok: $notOk$(if (-not $r.ok) { '; ' + $r.error }))"
      if ($test.Name -match '^8[0-9]_') { $gateFailures += $entry } else { $failedFiles += $entry }
    }
  }
  Write-Output ("pgTAP: {0} assertions ok; {1} non-channel files with data-dependent failures (informational)" -f $okTotal, $failedFiles.Count)
  if ($failedFiles.Count -gt 0) { Write-Output ("  informational: " + ($failedFiles -join ' | ')) }
  if ($Clean) {
    Write-Output '  (clean mode: the bare image lacks the Auth service schema and seed; use supabase test db for the full run)'
  } else {
    Check 'channel pgTAP contracts (8x) pass on restored + migrated data' ($gateFailures.Count -eq 0) ($gateFailures -join ' | ')
  }

  $failed = @($results | Where-Object { -not $_.pass }).Count
  Write-Output ("{0}/{1} checks passed" -f ($results.Count - $failed), $results.Count)
  if ($failed -gt 0) { $global:LASTEXITCODE = 1 }
} finally {
  if (-not $KeepContainer) { docker rm -f $container 2>$null | Out-Null }
}
