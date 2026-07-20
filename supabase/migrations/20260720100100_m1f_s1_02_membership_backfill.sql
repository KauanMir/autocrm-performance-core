-- M1-F / Módulo 1 — m1f_s1_02: backfill de company_memberships e
-- sellers.membership_id
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §5.4,
-- §6.2, §6.3, §16 (S1). Depende de m1f_s1_01.
--
-- Backfill determinístico e idempotente (ON CONFLICT DO NOTHING na chave
-- natural unique(company_id, profile_id) de m1f_s1_01) — seguro mesmo se
-- reexecutado. Mapeamento de role (design §5.4): admin -> manager,
-- manager -> manager, seller -> seller. is_active da membership espelha
-- profiles.is_active no momento do backfill (não existe ainda um conceito
-- "por empresa" separado do profile — hoje um profile só tem uma empresa).
-- joined_at usa profiles.created_at como melhor aproximação disponível (não
-- existe data real de admissão registrada em lugar nenhum); invited_at fica
-- null (não há dado de convite para contas legadas). created_at/updated_at
-- da própria linha de membership são o momento real de execução desta
-- migration (now(), via default da tabela), não uma data retroativa.
--
-- IMPORTANTE (mesma observação já registrada em m1c_02 e espelhada em
-- supabase/seed.sql Parte 1B): num `supabase db reset` local, as migrations
-- rodam ANTES do seed.sql — ou seja, quando ESTA migration executa, ainda
-- não existe nenhuma company/profile/seller no banco (seed.sql ainda não
-- rodou), e os dois backfills abaixo produzem ZERO linhas em ambiente local
-- limpo. O comportamento é intencional e idêntico ao já aceito para o seed
-- de pipeline_stages — não é um bug desta migration. A cobertura real do
-- comportamento do backfill é validada pelos testes pgTAP
-- (supabase/tests/11_m1f_s1_backfill.sql), que reexecutam a MESMA lógica de
-- INSERT/UPDATE (copiada literalmente, com esta mesma nota) contra fixtures
-- inseridas dentro da própria transação de teste.
--
-- ═══════════════════════════════════════════════════════════════════════
-- PENDÊNCIA REGISTRADA PARA O S2 (não resolvida nesta etapa, de propósito
-- — seed.sql está fora do escopo de arquivos autorizados no S1):
--
-- Consequência prática do parágrafo acima: depois de um `db reset` local,
-- os 4 usuários seedados (admin/manager/2 sellers de supabase/seed.sql)
-- ficam SEM nenhuma company_memberships, porque o backfill desta migration
-- já rodou (contra zero linhas) antes de seed.sql criar esses profiles.
-- Hoje isso não importa — nada no S1 lê company_memberships. Mas assim que
-- o S2 trocar os helpers (current_profile_company_id() etc.) para
-- resolver a empresa via company_memberships em vez de profiles.company_id
-- diretamente, o ambiente local reconstruído do zero vai quebrar para
-- esses 4 usuários (sem membership = sem empresa resolvida = RLS nega
-- tudo), MESMO QUE o comportamento no projeto remoto real (onde o backfill
-- roda depois de profiles já existirem) continue correto.
--
-- Isso precisa ser resolvido ANTES do S2 depender de company_memberships
-- para valer, por uma de duas vias (decisão de implementação do S2, não
-- desta etapa): (a) seed.sql passa a inserir as memberships dos 4 usuários
-- explicitamente, junto com profiles/sellers; ou (b) uma migration futura
-- reexecuta a mesma lógica de backfill como um passo SEPARADO do reset
-- local (ex.: via supabase/seed.sql chamando a mesma query, no mesmo
-- espírito da Parte 1B para pipeline_stages). Não decidido nem
-- implementado aqui — deliberadamente fora do escopo do S1.
--
-- SEGUNDO RISCO — JANELA OPERACIONAL S1→S2 (mais grave que o do seed local,
-- porque afeta o projeto REMOTO real, não só o ambiente de desenvolvimento):
--
--   1. o S1 faz backfill dos profiles/sellers que existem NO MOMENTO em
--      que a migration é aplicada no remoto;
--   2. entre a aplicação do S1 e a aplicação do S2, o runtime em produção
--      continua sendo o runtime ANTIGO (profiles.company_id, profiles.role,
--      sellers.profile_id) — exatamente como pretendido, o S1 é aditivo e
--      não muda comportamento observável;
--   3. mas esse runtime antigo continua criando usuários/sellers pelo
--      fluxo legado durante essa janela — CADA profile/seller criado
--      DEPOIS do backfill do S1 nasce SEM membership/membership_id,
--      porque o backfill já rodou (é um passo único de migration, não um
--      trigger contínuo);
--   4. se o S2 entrar em vigor (helpers/RLS/RPCs passando a depender de
--      company_memberships) sem repetir o backfill primeiro, todo usuário
--      criado nessa janela perde acesso (sem membership = RLS nega tudo,
--      mesma mecânica do item acima) ou fica inconsistente.
--
-- DECISÃO OPERACIONAL OBRIGATÓRIA (registrada aqui, não implementada nesta
-- etapa — é orientação para a sequência de deploy, não um mecanismo de
-- segurança; este comentário não substitui a validação real do S2):
--
--   - o S1 (schema + este backfill) PODE ser commitado e publicado no
--     GitHub normalmente;
--   - o S1 NÃO deve ser aplicado sozinho no Supabase remoto como um
--     deploy isolado e "concluído" — ele é fundação, não um marco de
--     produto;
--   - o deploy remoto do schema deste módulo deve aguardar o S2 estar
--     pronto para ser aplicado logo em seguida, na mesma janela de
--     manutenção;
--   - o S2 DEVE começar executando um catch-up backfill (reexecução da
--     mesma lógica idempotente acima, cobrindo qualquer profile/seller
--     criado depois do S1) ANTES de qualquer helper, policy ou RPC passar
--     a depender de company_memberships;
--   - só depois do catch-up confirmado é que as novas regras de
--     autorização (S2+) podem entrar em vigor.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── diagnóstico: profile sem company_id não recebe membership ───────────
-- Hoje isso é sempre uma anomalia (o runtime atual não suporta profile sem
-- empresa) — reportado via NOTICE, não tratado como erro fatal que
-- travaria toda a migration por causa de uma única linha inesperada.

do $$
declare
  v_orphan record;
begin
  for v_orphan in
    select id, email from public.profiles where company_id is null
  loop
    raise notice 'm1f_s1_02: profile % (%) sem company_id — nenhuma membership criada para ele', v_orphan.id, v_orphan.email;
  end loop;
end $$;

-- ── company_memberships a partir de profiles ─────────────────────────────
-- Role desconhecido causa falha explícita: o CASE abaixo cobre
-- exaustivamente os 3 valores possíveis de user_role; a instrução CASE do
-- PL/pgSQL (diferente da expressão CASE do SQL) levanta automaticamente a
-- exceção padrão case_not_found quando nenhum WHEN casa e não há ELSE — não
-- é preciso um RAISE manual para obter a falha explícita pedida nesta
-- etapa.

do $$
declare
  v_profile record;
  v_role public.company_role;
begin
  for v_profile in
    select id, company_id, role, is_active, created_at
    from public.profiles
    where company_id is not null
  loop
    case v_profile.role
      when 'admin' then
        v_role := 'manager';
      when 'manager' then
        v_role := 'manager';
      when 'seller' then
        v_role := 'seller';
    end case;

    insert into public.company_memberships
      (company_id, profile_id, role, is_active, invited_at, joined_at)
    values
      (v_profile.company_id, v_profile.id, v_role, v_profile.is_active, null, v_profile.created_at)
    on conflict (company_id, profile_id) do nothing;
  end loop;
end $$;

-- ── sellers.membership_id a partir das memberships recém-criadas ────────
-- Só sellers com profile_id preenchido podem ser ligados (sem profile, não
-- há membership possível — permanece null; a FK/trigger de m1f_s1_01
-- aceitam null sem checagem, MATCH SIMPLE). O UPDATE só toca sellers cuja
-- membership correspondente tem role = 'seller' na MESMA empresa —
-- exatamente o que o trigger de consistência (m1f_s1_01) também valida no
-- momento do UPDATE, então uma eventual inconsistência de dados legados
-- falharia aqui, de forma visível, em vez de silenciosamente.

update public.sellers s
set membership_id = cm.id
from public.company_memberships cm
where s.profile_id is not null
  and s.company_id is not null
  and cm.company_id = s.company_id
  and cm.profile_id = s.profile_id
  and cm.role = 'seller'
  and s.membership_id is null;

commit;
