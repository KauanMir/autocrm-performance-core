-- M1-F S1 — testes de resistência a autopromoção via profiles.platform_role
-- (pgTAP). Correção pós-auditoria crítica: profiles_update_admin (M1-B,
-- intocada) permite que QUALQUER admin atualize QUALQUER coluna de
-- QUALQUER profile da própria empresa — sem saber de platform_role, porque
-- a coluna não existia quando a policy foi escrita.
--
-- Defesa final, em duas camadas (m1f_s1_01): (1) REVOKE UPDATE (coluna) —
-- rápido, mas comprovadamente frágil a um GRANT de tabela emitido depois
-- (achado desta própria auditoria, ver comentário na migration); (2)
-- trigger profiles_guard_platform_role_ck — bloqueia a mudança sempre que
-- o role efetivo da sessão for authenticated/anon, independente de
-- qualquer estado de GRANT. É a Camada 2 que garante a invariante.
--
-- O ambiente local mostra ZERO grants de UPDATE em profiles para
-- authenticated/anon hoje (condição pré-existente, não introduzida por
-- este módulo) — o que tornaria um teste "authenticated tenta UPDATE"
-- trivialmente bloqueado por um motivo ALHEIO à correção (falta de grant
-- de tabela). Isso não provaria que a defesa funciona — provaria só que o
-- ambiente local está fechado por acidente. Por isso este arquivo CONCEDE
-- deliberadamente, como postgres, SELECT+UPDATE amplos em profiles para
-- authenticated/anon dentro da própria transação (simulando o pior caso
-- plausível: um projeto remoto mais antigo com grant amplo herdado do
-- default anterior de "auto-expose" do Supabase, ou um GRANT futuro
-- acidental) e SÓ DEPOIS testa que platform_role continua inacessível
-- mesmo assim. A concessão nunca sai desta transação (rollback ao final) e
-- não é uma alteração real de grant do projeto.
--
-- Comportamento de RLS relevante para a leitura dos testes abaixo: a
-- policy profiles_update_admin tem USING (quem pode ser alvo do UPDATE) e
-- WITH CHECK (a linha resultante é válida). Para manager/seller/anon, a
-- cláusula USING (current_profile_role() = 'admin') já é falsa — a própria
-- linha nunca é selecionada como alvo do UPDATE, então o comando afeta
-- ZERO linhas e NÃO lança exceção (RLS filtra silenciosamente, não é um
-- "with check" que falha). Só o admin passa pela USING e chega a executar
-- de fato o UPDATE — é aí que o trigger da Camada 2 entra em ação e lança
-- P0001. Os testes abaixo refletem essa distinção real, verificada
-- empiricamente (não presumida). Rollback ao final.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- ── simula o pior caso plausível: authenticated/anon com SELECT+UPDATE
--    amplos em profiles (SELECT é necessário além de UPDATE porque a
--    cláusula WHERE/RLS precisa ler a coluna referenciada) ──────────────
grant select, update on public.profiles to authenticated;
grant select, update on public.profiles to anon;

-- ── admin legítimo (seed.sql) tenta se autopromover diretamente ─────────
-- Passa pela USING (é admin, é a própria linha) — chega a executar o
-- UPDATE de fato, e é barrado pelo trigger (Camada 2): P0001.
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

-- Confirma o role EFETIVO usado pelo trigger: current_user muda com
-- SET ROLE (reflete "authenticated" aqui); session_user permanece a
-- identidade de conexão original (postgres, neste teste — seria
-- "authenticator" ou equivalente atrás de um pooler real do Supabase). O
-- trigger em m1f_s1_01 checa current_user, não session_user — se checasse
-- session_user, jamais veria "authenticated" e a defesa seria inerte.
select isnt(current_user, session_user, 'current_user difere de session_user sob SET ROLE (a distincao que o trigger depende de acertar)');
select is(current_user, 'authenticated', 'current_user reflete o role efetivo da operacao (authenticated), nao a conexao subjacente');

-- ATUALIZAÇÃO (M1-F S5-A1, aprovada explicitamente): profiles_update_admin
-- foi removida (hardening — ver 20260723150000_m1f_s5a1_...). Sem NENHUMA
-- policy de UPDATE em profiles, a linha do admin nunca é alcançada em
-- primeiro lugar (RLS "default deny" filtra antes do trigger ser avaliado)
-- — defesa mais forte, não regressão: o resultado observável (platform_role
-- nunca muda) é idêntico, mas agora por uma camada a mais que nem chega a
-- exercitar o trigger desta migration. Cobertura completa do hardening está
-- em 30_m1f_s5a1_profiles_hardening.sql.
select lives_ok(
  $$update public.profiles set platform_role = 'super_admin' where id = auth.uid()$$,
  'admin autenticado: UPDATE de platform_role nao lanca excecao (RLS ja filtra a linha, sem policy de UPDATE — trigger nem chega a ser avaliado)');

select is(
  (select platform_role from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::public.platform_role, 'platform_role do admin continua null apos a tentativa');

-- prova que a tabela não ficou super-fechada por acidente: uma coluna
-- legítima (name) continua editável pelo próprio admin sob a policy
-- existente + o grant amplo simulado — o trigger só reage a platform_role
select lives_ok(
  $$update public.profiles set name = name where id = auth.uid()$$,
  'admin ainda consegue atualizar colunas legitimas (o trigger e o revoke sao especificos da coluna nova)');

-- inclusão indireta: platform_role junto de uma coluna legítima na MESMA
-- instrução também não aplica nada — mas, pós S5-A1 (profiles_update_admin
-- removida), o motivo não é mais o trigger negando o statement completo:
-- é a ausência de qualquer policy de UPDATE, que já filtra a linha antes de
-- qualquer avaliação de trigger. O resultado observável (nenhuma aplicação
-- parcial, nenhuma coluna persistida) é idêntico ao de antes.
select lives_ok(
  $$update public.profiles set name = 'Tentativa Indireta', platform_role = 'super_admin' where id = auth.uid()$$,
  'combinar platform_role com uma coluna permitida no mesmo UPDATE nao lanca excecao (RLS ja filtra a linha, sem aplicacao parcial)');
select isnt(
  (select name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Tentativa Indireta', 'name NAO foi alterado pela tentativa combinada (nenhuma aplicacao parcial)');
select is(
  (select platform_role from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::public.platform_role, 'platform_role continua null apos a tentativa combinada');

reset role;

-- ── manager (nao-admin) já é negado pela policy existente (profiles_
--    update_admin exige current_profile_role() = admin): a USING filtra a
--    própria linha do manager, então o UPDATE afeta ZERO linhas e NÃO
--    lança exceção — a superfície de ataque do manager já era fechada
--    antes desta correção, e continua fechada depois; o teste confirma o
--    resultado real (0 linhas), não presume um erro que não acontece ────
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$update public.profiles set platform_role = 'super_admin' where id = auth.uid()$$,
  'manager: UPDATE nao lanca excecao (RLS filtra a linha silenciosamente)');
select is(
  (select platform_role from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  null::public.platform_role, 'platform_role do manager continua null (RLS ja negava o acesso a propria linha p/ nao-admin)');
reset role;

-- ── seller: mesmo padrão do manager (nem admin, nem alcançado pela USING) ─
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$update public.profiles set platform_role = 'super_admin' where id = auth.uid()$$,
  'seller: UPDATE nao lanca excecao (RLS filtra a linha silenciosamente)');
select is(
  (select platform_role from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  null::public.platform_role, 'platform_role do seller continua null');
reset role;

-- ── anon (sem sessão): proteção ainda mais forte que a de manager/seller —
--    anon nunca recebeu EXECUTE nos helpers de RLS (current_profile_role()
--    etc., revogado de anon desde m1c_01) — a própria avaliação da USING
--    clause falha com "permission denied for function", não uma simples
--    filtragem silenciosa. Achado confirmado empiricamente (a primeira
--    tentativa desta auditoria esperava lives_ok e falhou porque a
--    realidade é mais restritiva, não menos) ─────────────────────────────
set local role anon;
select throws_ok(
  $$update public.profiles set platform_role = 'super_admin' where id = '11111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'anon: nem consegue avaliar a policy (sem EXECUTE nos helpers de RLS) — negado antes de qualquer filtragem');
reset role;
-- Verificação como postgres (não como anon): mesmo o SELECT de
-- verificação falharia como anon com o mesmo "permission denied for
-- function" — anon não tem EXECUTE em nenhum helper usado por NENHUMA
-- policy de profiles, nem a de SELECT. Achado idêntico ao de cima,
-- confirmado empiricamente.
select is(
  (select platform_role from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  null::public.platform_role, 'platform_role do alvo continua null apos a tentativa de anon');

-- ── nenhuma RPC/função existente atualiza platform_role ou faz mass
--    assignment em profiles — busca textual na definição de toda função
--    SECURITY DEFINER do schema public, exceto as que este próprio módulo
--    criou (que legitimamente mencionam a coluna) ───────────────────────
-- ATUALIZAÇÃO (M1-F S2): is_platform_super_admin() foi adicionada à lista
-- de exclusão — é o helper de leitura do S2 cuja função inteira é
-- verificar platform_role (design §7/§8), não um caminho de escrita/mass
-- assignment. A intenção do teste (nenhuma RPC do M1-C/M1-E, nem nenhum
-- helper de ESCRITA, referencia platform_role) permanece 100% coberta:
-- is_platform_super_admin() é STABLE (só leitura), nunca faz UPDATE.
--
-- ATUALIZAÇÃO (M1-F S4-A2A): create_invite()/resend_invite()/
-- cancel_invite() adicionadas à lista de exclusão pelo mesmo motivo —
-- as três precisam LER platform_role (de p_actor_profile_id, ou de
-- auth.uid() no caso de cancel_invite) para revalidar no banco se o
-- ator é Super Admin, contrato exigido pela autorização de convites
-- (M1-F S4-A2 E0 §6/§8). Nenhuma das três jamais grava em
-- profiles.platform_role — escrevem apenas em invites/audit_log; a
-- intenção original do teste (nenhuma escrita/mass assignment de
-- platform_role fora do trigger de guarda) permanece 100% coberta.
--
-- ATUALIZAÇÃO (M1-F S4-A2A.1): complete_invite_resend_delivery() e
-- complete_invite_delivery() adicionadas à lista de exclusão pelo mesmo
-- motivo — ambas precisam LER platform_role (de p_actor_profile_id, que
-- chega já validado pelo servidor/service_role, nunca de auth.uid())
-- para revalidar INTEGRALMENTE no banco a autoridade sobre o convite
-- sendo finalizado, mesmo padrão de resend_invite()/cancel_invite(). Não
-- são executáveis por authenticated (EXECUTE restrito a service_role);
-- nenhuma das duas jamais grava em profiles.platform_role — escrevem
-- apenas em invites (delivery_status e colunas relacionadas)/audit_log.
--
-- ATUALIZAÇÃO (M1-F S4-A2B.1): reserve_create_invite_rate_limit() e
-- reserve_resend_invite_rate_limit() adicionadas à lista de exclusão pelo
-- MESMO motivo — revalidam INTEGRALMENTE a autorização de create_invite()/
-- resend_invite() (mesma lógica, deliberadamente duplicada como defesa em
-- profundidade) ANTES de reservar o rate limit, o que exige ler
-- platform_role de p_actor_profile_id. EXECUTE restrito a service_role;
-- nenhuma das duas jamais grava em profiles.platform_role — só em
-- audit_log (falhas de domínio) e invite_rate_limit_events (via o helper
-- interno reserve_invite_rate_limit(), que elas chamam).
--
-- ATUALIZAÇÃO (M1-F S4-C1): accept_invite() adicionada à lista de
-- exclusão — é a ÚNICA das exceções desta lista que efetivamente ESCREVE
-- em platform_role (UPDATE profiles SET platform_role='super_admin', só
-- quando role_kind='super_admin' do próprio convite sendo aceito, nunca
-- por parâmetro do cliente — ator sempre auth.uid()). EXECUTE restrito a
-- authenticated (nunca anon), ator sempre derivado da sessão real.
--
-- ATUALIZAÇÃO (M1-F S5-B): update_profile_name() adicionada à lista de
-- exclusão — precisa LER platform_role de auth.uid() (o ator, nunca o
-- alvo) para decidir se aplica o escopo global de Super Admin ou o escopo
-- restrito de Manager/self, mesmo padrão de leitura já usado por
-- is_platform_super_admin()/create_invite()/accept_invite(). Nunca grava
-- em profiles.platform_role — a única coluna que esta RPC escreve é
-- profiles.name (contrato fechado, S5-B E0/migration).
--
-- ATUALIZAÇÃO (M1-F S5-C): update_membership_role consulta platform_role
-- somente para exigir Super Admin como ator. A função nunca altera
-- platform_role e modifica exclusivamente o papel empresarial, a ponte
-- temporária profiles.role e o vínculo operacional de sellers necessário à
-- troca de papel.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname not in ('profiles_guard_platform_role', 'company_memberships_check_mutation',
                             'sellers_check_membership_consistency', 'is_platform_super_admin',
                             'create_invite', 'resend_invite', 'cancel_invite',
                             'complete_invite_resend_delivery', 'complete_invite_delivery',
                             'reserve_create_invite_rate_limit', 'reserve_resend_invite_rate_limit',
                             'accept_invite', 'update_profile_name', 'update_membership_role')
      and pg_get_functiondef(p.oid) ilike '%platform_role%'),
  0, 'nenhuma funcao SECURITY DEFINER pre-existente (RPCs do M1-C/M1-E, helpers) referencia platform_role');
-- Reforço específico do S2: is_platform_super_admin() referencia
-- platform_role, mas é STABLE (nunca escreve) — confirmado explicitamente
-- para não deixar a exclusão acima como um "buraco" não verificado.
select is(
  (select p.provolatile from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'is_platform_super_admin'),
  's', 'is_platform_super_admin() e STABLE (somente leitura) — a excecao acima nao abre caminho de escrita');
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in ('create_lead','update_lead','move_lead_to_stage','apply_lead_event',
                         'assign_lead_seller','archive_lead','unarchive_lead',
                         'add_lead_timeline_entry','check_lead_phone_duplicate',
                         'sale_create','sale_cancel','deal_approve','deal_reject',
                         'reorder_pipeline_stages')
      and (pg_get_functiondef(p.oid) ilike '%update public.profiles%'
        or pg_get_functiondef(p.oid) ilike '%update profiles%')),
  0, 'nenhuma das RPCs do M1-C/M1-E faz UPDATE em profiles (nenhum caminho de mass assignment)');

-- ── uma futura RPC administrativa SECURITY DEFINER (dona do owner da
--    tabela) ainda poderá alterar platform_role — o trigger não bloqueia
--    esse caminho, porque SECURITY DEFINER troca current_user para o
--    dono da função durante a execução (comprovado empiricamente antes de
--    escrever este teste — não presumido). Função descartável em pg_temp,
--    nunca persiste além desta transação; não é a RPC real (essa fica
--    para uma etapa futura, fora do escopo do S1) — só prova que o
--    desenho do trigger não vai exigir retrabalho quando ela existir ────
create function pg_temp.future_admin_promote_probe(p_profile_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set platform_role = 'super_admin' where id = p_profile_id;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select pg_temp.future_admin_promote_probe('22222222-2222-2222-2222-222222222222')$$,
  'uma futura RPC SECURITY DEFINER de propriedade do owner AINDA consegue alterar platform_role (nao fica bloqueada pelo trigger)');
reset role;
select is(
  (select platform_role from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'super_admin'::public.platform_role,
  'a alteracao via SECURITY DEFINER (caminho controlado, futuro) realmente aplicou — prova que o trigger nao e over-broad');
-- reverte explicitamente: esta e a UNICA linha deste arquivo que
-- deliberadamente materializa um super_admin, e só para provar o caminho
-- futuro — desfeito manualmente antes do rollback final por clareza (o
-- rollback já garante isso de qualquer forma, mas não deixa a linha
-- "verdadeira" no meio do arquivo por mais tempo que o necessário)
update public.profiles set platform_role = null where id = '22222222-2222-2222-2222-222222222222';

-- ── nenhuma permissão global apareceu por NENHUM caminho direto de
--    authenticated/anon como resultado de qualquer tentativa acima
--    (a única linha que ficou super_admin foi via o caminho controlado
--    acima, e já foi revertida) ─────────────────────────────────────────
select is(
  (select count(*)::int from public.profiles where platform_role = 'super_admin'),
  0, 'nenhum profile permanece super_admin ao final (nem por tentativa direta, nem residual do teste do caminho futuro)');

select * from finish();
rollback;
