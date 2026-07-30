# M1-F — Runbook de Rollout Remoto

Documento de planejamento. **Nenhum passo aqui foi executado.** Nenhuma migration foi aplicada no Supabase remoto em nenhum momento da linha do tempo do M1-F. Este runbook existe para que, quando o rollout remoto for autorizado (decisão de produto separada, fora do escopo desta etapa), exista um roteiro seguro, com pré-checks read-only, ordem de migrations, smoke tests e critérios de interrupção já definidos.

## 1. Objetivo

Aplicar as 47 migrations locais do M1-F (1 M1-B + 3 M1-C + 3 M1-E + 40 M1-F) ao banco Supabase remoto de produção, e ativar progressivamente as duas flags do workspace comercial do Super Admin (`NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ`/`WRITE`), sem interromper o uso operacional existente de Manager/Seller (que continua no caminho local M0 até o M1-E E4).

## 2. Escopo

Dentro do escopo: aplicação de migrations, pré-checks read-only, smoke tests pós-deploy, ativação faseada de flags, critérios de rollback lógico.

Fora do escopo: qualquer alteração de schema/RPC/RLS (já congeladas desde o S8-E2), migração do M1-E E4 (Manager/Seller para o caminho remoto — desbloqueada por este fechamento, mas é uma etapa própria e futura), qualquer trabalho de frontend novo.

## 3. Estado necessário antes de começar

- Este runbook aprovado por decisão humana explícita de iniciar o rollout (evento futuro, não implícito neste documento).
- As 47 migrations locais validadas (`supabase db reset` + `supabase test db` 100% PASS) na branch `main` no commit que será promovido.
- Acesso administrativo ao projeto Supabase remoto confirmado fora desta sessão (nunca via `--linked` neste ambiente de desenvolvimento).
- Janela de manutenção comunicada, mesmo que o impacto observável seja mínimo (ver §12).

## 4. Responsáveis

A definir pela organização no momento do rollout real (este documento não atribui pessoas). Papéis mínimos necessários: um operador com acesso ao Supabase Dashboard/CLI remoto autorizado, um revisor que confirma os pré-checks antes de cada bloco, um responsável pela decisão de interrupção (§13).

## 5. Backup

Antes de qualquer migration: snapshot/backup completo do banco remoto (mecanismo nativo do Supabase — Point-in-Time Recovery ou backup manual, conforme o plano contratado). Confirmar que o backup é restaurável (não só que foi criado) antes de prosseguir. Registrar o horário exato do backup — é o ponto de retorno caso o rollback físico (§13, Nível 3) seja necessário.

## 6. Janela de manutenção

As 40 migrations M1-F, na forma em que existem hoje, não fazem `DROP TABLE`/truncamento de dados de produção real (o remoto nunca teve dados M1-F — as tabelas `company_memberships`/`invites`/`audit_log`/etc. são todas criadas por este próprio conjunto de migrations). O maior risco de lock é `ALTER TABLE ... DROP COLUMN` em `profiles` (migration 40, S8-E2b) — tabela pequena (uma linha por usuário autenticado), lock `ACCESS EXCLUSIVE` breve. Recomenda-se ainda assim uma janela de baixo tráfego, não por volume de dados, mas porque o M0 legado (Manager/Seller) consulta `profiles` em todo login.

## 7. Pré-checks

Ver `supabase/scripts/rollout-precheck.sql` (§ deste runbook, seção 8). Executar e revisar manualmente **antes** de aplicar qualquer migration. Qualquer resultado inesperado (contagem > 0 onde 0 era esperado) é motivo de parar e investigar, nunca de prosseguir "só desta vez".

## 8. Pré-checks — consultas read-only

Arquivo de referência (a criar no momento real do rollout, a partir do modelo abaixo — não executado nesta etapa, não commitado como script separado para evitar sugerir execução acidental). Todas as consultas abaixo são somente leitura, sem PII (nunca selecionam `email`/`name`/`phone`), sem IDs reais hard-coded, e seguras para rodar contra produção antes de qualquer migration:

```sql
-- 1. Leads com autor sem membership histórica correspondente
-- (verifica que leads_created_by_fk/updated_by_fk vão encontrar destino
-- válido em company_memberships antes da migration que redefine a FK)
select count(*) as leads_sem_membership_para_autor
from leads l
where l.created_by_profile_id is not null
  and not exists (
    select 1 from company_memberships cm
    where cm.company_id = l.company_id and cm.profile_id = l.created_by_profile_id
  );

-- 2. Timelines com ator sem membership histórica correspondente
select count(*) as timelines_sem_membership_para_ator
from lead_timeline_entries t
where t.actor_profile_id is not null
  and not exists (
    select 1 from company_memberships cm
    where cm.company_id = t.company_id and cm.profile_id = t.actor_profile_id
  );

-- 3. Memberships duplicadas (mesma empresa + profile)
select company_id, profile_id, count(*) as duplicatas
from company_memberships
group by company_id, profile_id
having count(*) > 1;

-- 4. Mais de uma membership ATIVA por profile
select profile_id, count(*) as memberships_ativas
from company_memberships
where is_active
group by profile_id
having count(*) > 1;

-- 5. Sellers inconsistentes com a membership (profile/empresa/role divergentes)
select count(*) as sellers_inconsistentes
from sellers s
join company_memberships cm on cm.id = s.membership_id
where s.profile_id is distinct from cm.profile_id
   or s.company_id is distinct from cm.company_id
   or cm.role <> 'seller';

-- 6. Sellers "elegíveis" (profile_id + company_id preenchidos) sem membership_id
select count(*) as sellers_orfaos
from sellers
where profile_id is not null and company_id is not null and membership_id is null;

-- 7. Empresas com status fora do enum esperado (defesa, não deveria ocorrer)
select status, count(*) from companies group by status;

-- 8. Convites pendentes com company_id apontando para empresa inexistente/cancelada
select count(*) as convites_incompativeis
from invites i
where i.status = 'pending'
  and i.company_id is not null
  and not exists (select 1 from companies c where c.id = i.company_id and c.status <> 'cancelada');

-- 9. Funções/policies legadas ainda presentes no remoto (não deveriam existir
-- nunca — remoto nunca teve M1-F aplicado — mas confirma catálogo limpo
-- antes de aplicar as migrations que dependem da ausência delas)
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('current_profile_company_id','current_profile_role',
                   'current_profile_seller_id','is_manager_or_admin');

-- 10. Colunas legadas já presentes em profiles (não deveriam existir — só
-- relevante se o remoto já tiver alguma versão parcial aplicada por engano)
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('company_id', 'role', 'seller_id');
```

Resultado esperado em um remoto que nunca recebeu nenhuma migration M1-F: consultas 9 e 10 retornam zero linhas (funções/colunas legadas nunca existiram no remoto — só existiam no M1-B/M1-C originais, que também não foram aplicados). Consultas 1-8 são defensivas para o caso (não esperado, mas não descartado sem prova) de o remoto já ter alguma estrutura de `company_memberships`/`sellers`/`leads` fora do fluxo destas migrations.

## 9. Ordem das migrations

As 47 migrations aplicam-se **na ordem cronológica do nome do arquivo** (padrão do Supabase CLI — `supabase migration up`/`db push` já respeita isso automaticamente; não há necessidade de reordenar nada manualmente). A tabela abaixo documenta as 40 migrations M1-F (as 7 anteriores — M1-B/M1-C/M1-E — são pré-requisito e já formam a base sobre a qual o M1-F foi desenhado; não fazem parte do escopo de auditoria desta etapa, que é o M1-F).

| # | Migration | Finalidade | Objetos | Depende de | Valida dados | Lock/downtime | Rollback lógico | Smoke test | Risco |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `m1f_s1_01_platform_memberships` | Fundação: `platform_role` em profiles, tabela `company_memberships`, `sellers.membership_id` | ALTER `profiles`, CREATE `company_memberships` + RLS, ALTER `sellers` | M1-B | não | baixo (tabelas pequenas/vazias no remoto) | aditiva, nada a reverter | catálogo: colunas/tabela existem | baixo |
| 2 | `m1f_s1_02_membership_backfill` | Backfill histórico (`profiles.company_id/role` → `company_memberships`) | DO block, INSERT/UPDATE | #1 | **sim** — é o próprio backfill | baixo (roda contra 0 linhas em ambiente limpo; ver §14) | não reversível de forma simples (histórico); idempotente via `ON CONFLICT DO NOTHING` | contagem de memberships pós-backfill = contagem de profiles com company_id | médio (única migration com lógica de dados não-trivial) |
| 3 | `m1f_s2_01_membership_catchup` | Reexecuta a mesma lógica do backfill (janela S1→S2) + 8 validações de consistência | DO block, INSERT/UPDATE, SELECT de diagnóstico | #2 | **sim** | baixo | idempotente | mesma validação do backfill + as 8 queries de diagnóstico (viram `NOTICE`, nunca abortam) | médio |
| 4 | `m1f_s2_015_seller_membership_uniqueness` | `UNIQUE(sellers.membership_id)` | ALTER `sellers` ADD CONSTRAINT | #3 | não | baixo | aditiva | catálogo: constraint existe | baixo |
| 5 | `m1f_s2_02_company_access_helpers` | 7 helpers de autorização (`is_platform_super_admin`, `can_access_company`, etc.) | CREATE FUNCTION ×7 | #1 | não | nenhum | aditiva (substituível por `CREATE OR REPLACE` futuro) | `has_function` para os 7 | baixo |
| 6 | `m1f_s11_company_lifecycle_gap` | `companies.status`/`trade_name`/`created_by_profile_id` + backfill para `ativa` | ALTER `companies`, UPDATE | #5 | **sim** — backfill de status | baixo | não reversível de forma simples; idempotente | contagem de empresas com status não-null | médio |
| 7 | `m1f_s3a_company_creation_backend` | `create_company()` + RLS de `companies` | CREATE FUNCTION, policies | #6 | não | nenhum | aditiva | `create_company` existe, RLS ativa | baixo |
| 8 | `m1f_s4a1_invite_audit_foundation` | Tabelas `invites`/`audit_log` | CREATE TABLE ×2 + RLS | #7 | não | nenhum | aditiva | catálogo | baixo |
| 9 | `m1f_s4a2a_invite_lifecycle_rpcs` | `create_invite`/`resend_invite`/`cancel_invite` | CREATE FUNCTION ×3 | #8 | não | nenhum | aditiva | `has_function` ×3 | baixo |
| 10 | `m1f_s4a2a1_invite_delivery_ratelimit` | Colunas de status de entrega + `invite_rate_limit_events` + `complete_invite_resend_delivery` | ALTER `invites`, CREATE TABLE, `CREATE OR REPLACE` | #9 | não | nenhum | aditiva | catálogo | baixo |
| 11 | `m1f_s4a2b1_authorized_invite_rate_limit` | `reserve_invite_rate_limit` | CREATE FUNCTION | #10 | não | nenhum | aditiva | `has_function` | baixo |
| 12 | `m1f_s4c1_invite_acceptance` | `accept_invite` (versão original, redefinida depois em #43) | CREATE FUNCTION | #11 | não | nenhum | aditiva | `has_function` | baixo |
| 13 | `m1f_s4c2c_login_profile_read` | GRANT SELECT por coluna em `profiles` para login | GRANT | #1 | não | nenhum | aditiva (REVOKE reverteria) | login funcional | baixo |
| 14 | `m1f_s4f1_01_own_membership_read` | GRANT SELECT por coluna em `company_memberships` | GRANT | #1 | não | nenhum | aditiva | leitura da própria membership | baixo |
| 15 | `m1f_s4f1_02_invites_column_grants` | Endurece GRANT de `invites` (whitelist de 10 colunas) | REVOKE + GRANT | #8 | não | nenhum | aditiva | leitura de convites próprios | baixo |
| 16 | `m1f_s5a1_profiles_hardening` | Remove policy de UPDATE ampla em `profiles` | DROP POLICY | #1 | não | nenhum | não reversível sem recriar a policy (não desejável) | UPDATE direto continua negado | baixo |
| 17 | `m1f_s5a2_list_company_users` | `list_company_users` | CREATE FUNCTION | #16 | não | nenhum | aditiva | `has_function` | baixo |
| 18 | `m1f_s5b_update_profile_name` | `update_profile_name` | CREATE FUNCTION | #17 | não | nenhum | aditiva | `has_function` | baixo |
| 19 | `m1f_s5c_update_membership_role` | `update_membership_role` (versão original, redefinida em #35 e #43) | CREATE FUNCTION | #18 | não | nenhum | aditiva | `has_function` | baixo |
| 20 | `m1f_s5e1a_email_update_backend` | `get_auth_email_update_state`/`get_profile_email_update_state`/`commit_profile_email_update` | CREATE FUNCTION ×3 | #19 | não | nenhum | aditiva | `has_function` ×3 | baixo |
| 21 | `m1f_s6b_membership_lifecycle` | `lifecycle_status` + `suspend_membership`/`reactivate_membership` | ALTER `company_memberships`, CREATE FUNCTION ×2 | #20 | não | nenhum | aditiva | catálogo | baixo |
| 22 | `m1f_s6c_membership_offboarding` | `offboard_seller`/`offboard_manager` (assinatura original, substituída em #24) | CREATE FUNCTION ×2 | #21 | não | nenhum | aditiva | `has_function` ×2 | baixo |
| 23 | `m1f_s6d_membership_transfer` | `transfer_membership` | CREATE FUNCTION | #22 | não | nenhum | aditiva | `has_function` | baixo |
| 24 | `m1f_s6e_inactive_listing` | `list_inactive_company_users` | CREATE FUNCTION | #23 | não | nenhum | aditiva | `has_function` | baixo |
| 25 | `m1f_s6e2_offboard_seller_successor_hardening` | `DROP FUNCTION offboard_seller(uuid,text,text)` + `CREATE FUNCTION offboard_seller(uuid,uuid,text)` (troca de tipo de parâmetro) | DROP + CREATE FUNCTION | #24 | não | nenhum (função, sem dado) | não reversível trivialmente (assinatura mudou) | `has_function` com a nova assinatura | médio (única migration com `DROP FUNCTION` antes de #37-#39) |
| 26 | `m1f_s8c1a_close_profile_seller_access` | Remove `profiles_select_company`, fecha policies de `sellers` | DROP POLICY ×5 | #25 | não | nenhum | não reversível sem recriar (não desejável — reintroduziria leitura ampla) | SELECT direto de terceiros continua negado | baixo |
| 27 | `m1f_s8c1b_pipeline_membership_access` | `pipeline_stages`/`reorder_pipeline_stages` migrados para membership | `CREATE OR REPLACE`, ALTER POLICY | #26 | não | nenhum | não reversível sem reintroduzir helper legado (indesejável) | Manager opera pipeline da própria empresa | baixo |
| 28 | `m1f_s8c2b1_leads_timeline_membership_access` | `leads`/`lead_timeline_entries` policies migradas para membership | ALTER POLICY | #27 | não | nenhum | idem | isolamento entre empresas | baixo |
| 29 | `m1f_s8c2b1_platform_commercial_read_rpcs` | 4 RPCs de leitura comercial (`list_commercial_companies` etc.) | CREATE FUNCTION ×4 | #28 | não | nenhum | aditiva | `has_function` ×4 | baixo |
| 30 | `m1f_s8c2c1_lead_mutation_context_resolver` | `resolve_lead_mutation_context` | CREATE FUNCTION | #29 | não | nenhum | aditiva | `has_function` | baixo |
| 31 | `m1f_s8c2c1_lead_create_update_duplicate_commercial` | `create_lead`/`update_lead`/`check_lead_phone_duplicate` migrados | `CREATE OR REPLACE` | #30 | não | nenhum | não reversível trivialmente | Super Admin cria/edita Lead com empresa explícita | médio |
| 32 | `m1f_s8c2c1auth_a1_lead_authorship_membership_fk` | **`leads_created_by_fk`/`leads_updated_by_fk` reapontadas** de `profiles(company_id,id)` para `company_memberships(company_id,profile_id)` | DROP CONSTRAINT + ADD CONSTRAINT | #31 | **sim** — exige que toda autoria histórica de leads tenha membership correspondente (pré-check §8.1) | **potencialmente alto** se houver dado real incompatível (remoto nunca teve dado M1-F, risco só teórico) | não reversível trivialmente | pré-check #1 zerado + `fk_ok` | **alto** (única alteração de FK sobre dado potencialmente existente) |
| 33 | `m1f_s8c2c2sellers_b1_platform_seller_listing` | `list_platform_sellers_for_company` | CREATE FUNCTION | #32 | não | nenhum | aditiva | `has_function` | baixo |
| 34 | `m1f_s8c2d1_move_event_assign_commercial` | `move_lead_to_stage`/`apply_lead_event`/`assign_lead_seller` migrados | `CREATE OR REPLACE` | #33 | não | nenhum | não reversível trivialmente | Super Admin move/atribui Lead | médio |
| 35 | `m1f_s8c2d1_archive_unarchive_timeline_commercial` | `archive_lead`/`unarchive_lead`/`add_lead_timeline_entry` migrados | `CREATE OR REPLACE` | #34 | não | nenhum | idem | Super Admin arquiva/adiciona timeline | médio |
| 36 | `m1f_s8c2d1timeline_a1_actor_membership_fk` | **`lead_timeline_actor_fk` reapontada** para `company_memberships` | DROP CONSTRAINT + ADD CONSTRAINT | #35 | **sim** — mesmo pré-check da #32, para timeline | **potencialmente alto** (mesma ressalva) | não reversível trivialmente | pré-check #2 zerado + `fk_ok` | **alto** |
| 37 | `m1f_s8d2b_stop_profile_role_sync` | `update_membership_role` para de escrever `profiles.role` | `CREATE OR REPLACE` | #36 | não | nenhum | não reversível (comportamento antigo indesejável) | promoção/rebaixamento não sincroniza mais `profiles.role` | baixo |
| 38 | `m1f_s8e1_drop_legacy_profile_helpers` | `DROP FUNCTION` dos 4 helpers legados M1-C | DROP FUNCTION ×4 | #37 | não | nenhum | **não reversível sem recriar as funções (não desejável)** | `hasnt_function` ×4 | baixo (zero consumidor confirmado antes do drop) |
| 39 | `m1f_s8e2a_stop_profile_legacy_writes` | `accept_invite`/`update_membership_role` param de tocar `profiles.company_id/role` | `CREATE OR REPLACE` ×2 | #38 | não | nenhum | não reversível (comportamento antigo indesejável) | aceite de convite não grava mais campos legados | baixo |
| 40 | `m1f_s8e2b_drop_profile_legacy_columns` | **`DROP COLUMN` de `profiles.company_id/role/seller_id`** | DROP CONSTRAINT ×3 + DROP INDEX ×2 + DROP COLUMN ×3 | #39 | não (pré-condição já garantida por #39) | **breve, `ACCESS EXCLUSIVE` em `profiles`** (tabela pequena) | **fisicamente irreversível** — só via migration corretiva que recria as colunas (nunca recomendado) | catálogo: 3 colunas ausentes, 7 restantes presentes | **alto** (irreversibilidade física — mitigado por ser a última de uma cadeia de 3 migrations que já provaram zero consumidor) |

**Migrations com validação de dados real**: #2 (`m1f_s1_02`), #3 (`m1f_s2_01`), #6 (`m1f_s11`, backfill de status), #32 e #36 (FKs de autoria — dependem de todo lead/timeline histórico ter membership correspondente). Estas quatro são as únicas que fazem algo diferente de "criar/substituir objeto vazio" — são as prioritárias para os pré-checks (§8).

**Migrations de risco alto**: #32, #36 (FK de autoria sobre dado potencialmente existente) e #40 (irreversibilidade física do `DROP COLUMN`). Nenhuma tem mitigação automática além do backup (§5) e dos pré-checks (§8) — são leitura, não perigo de execução em si (todas as 40 já rodam localmente sem erro contra a fixture de teste padrão), o risco é especificamente sobre **dado de produção real que este ambiente de desenvolvimento nunca viu**.

## 10. Verificação após cada bloco

Após aplicar as migrations, antes de prosseguir para a ativação de flags:

1. `supabase migration list` (ou equivalente remoto) confirma as 47 migrations aplicadas, na ordem.
2. Repetir as 10 consultas do §8 — as de números 9 e 10 devem continuar em zero (nada de legado foi reintroduzido); as demais (1-8) idealmente em zero, mas nesse ponto pós-migration algumas passam a ser esperadas em zero *por construção* (ex.: 5 e 6 dependem de `sellers`/`company_memberships` que só existem a partir daqui).
3. Login funcional para um usuário de teste de cada papel (Super Admin/Manager/Seller) — ver §11.

## 11. Smoke tests

Executar manualmente contra o ambiente remoto pós-migration, com contas de teste dedicadas (nunca contas reais de cliente). Nenhum destes é executado nesta etapa — é o roteiro para o momento real.

**Auth**
- Login Super Admin — sessão válida, `platformRole==='super_admin'`.
- Login Manager — sessão válida, `activeMembership.role==='manager'`.
- Login Seller — sessão válida, `activeMembership.role==='seller'`, `sellerId` resolvido.
- Login de usuário com membership suspensa — sessão termina (`restoreSession`/`login` fazem `signOut()`).
- Login de usuário sem nenhuma membership — sessão válida, módulos locais mostram listas vazias (fail-closed, contrato do S8-D2-A).

**Lifecycle**
- Enviar convite (Manager convida Seller da própria empresa; Super Admin convida Manager/Seller/outro Super Admin).
- Aceitar convite (cada um dos 3 papéis).
- Promover Seller → Manager (`update_membership_role`).
- Rebaixar Manager → Seller.
- Suspender membership.
- Reativar membership.
- Transferir membership entre empresas.
- Desligar (offboard) Seller com e sem sucessor; Manager com e sem sucessor.

**Comercial Super Admin** (só após READ ativado — ver §12)
- Selecionar empresa explícita.
- Listar Leads da empresa selecionada.
- Criar Lead (só após WRITE ativado).
- Editar Lead.
- Mover Lead de etapa.
- Atribuir Seller.
- Registrar evento de callback/visita.
- Adicionar entrada de timeline.
- Arquivar/desarquivar Lead.

**Isolamento**
- Tentar acessar Lead/Stage/Seller de outra empresa (via URL/parâmetro manipulado) — negado, sem vazar existência.
- Tentar operar sobre empresa suspensa — leitura permitida, escrita negada.
- Tentar operar sobre empresa cancelada — leitura negada também.
- Confirmar que toda falha usa mensagem sanitizada (nunca stack trace/detalhe interno).

**Auditoria**
- Cada operação acima gera exatamente 1 linha em `audit_log` com o ator real (nunca um id inventado pelo cliente).
- `before_data`/`after_data` nunca contêm PII completa (nome/e-mail/telefone/senha/token) — só os campos estritamente necessários (já congelado desde o S4-A1).
- Nenhuma linha de `audit_log` órfã (sempre aponta para uma entidade existente).

## 12. Ativação das flags

Ordem obrigatória — **nunca ativar READ e WRITE na mesma janela**:

1. Migrations aplicadas (§9), pré-checks pós-bloco (§10) verdes.
2. `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ=true`, `WRITE` continua `false`.
3. Deploy do frontend com essa configuração.
4. Smoke test de leitura (§11, bloco "Comercial Super Admin" — só os itens de leitura: selecionar empresa, listar Leads).
5. Observar (ver §12.1) — sem incidentes, nenhum erro anômalo em `audit_log`/logs de aplicação.
6. Só então `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE=true`.
7. Novo deploy.
8. Smoke test de mutation (§11, itens restantes do bloco comercial).
9. Observar novamente.
10. Rollout considerado encerrado só depois da segunda observação sem incidentes.

`canMutateCommercialWorkspace()` já impõe `readEnabled && writeEnabled` no código (`lib/capabilities.ts`) — mesmo que alguém ative `WRITE` sem `READ` por engano, a mutation continua bloqueada; a ordem acima é sobre risco operacional/observabilidade, não uma dependência técnica que já não exista.

### 12.1 Monitoramento

Durante as janelas de observação: taxa de erro do endpoint/RPC (`4xx`/`5xx` ou `result='failure'` em `audit_log`), volume de `invite_accepted`/`lead_*`/`user_membership_role_updated` comparado ao esperado, ausência de qualquer entrada `audit_log` com `entity_id` não resolvível (linha órfã), tempo de resposta das RPCs comerciais sob carga real (nunca medido neste ambiente local).

## 13. Critérios de interrupção e rollback

**Nível 1 — mutation com problema, leitura ainda segura**
- Desligar `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE`.
- Manter `READ` ligada se a leitura continuar correta.
- Novo deploy do frontend só com essa flag revertida.

**Nível 2 — leitura também comprometida**
- Desligar `NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ` (e `WRITE`, que já depende dela).
- Frontend volta ao caminho anterior, inteiramente visível a Manager/Seller (nada no M0 é afetado por essas duas flags).

**Nível 3 — problema nas migrations/schema, não nas flags**
- Interromper a aplicação de migrations futuras imediatamente (não aplicar a próxima na ordem).
- **Nunca** tentar reverter uma migration já aplicada editando-a ou com `DROP`/`ALTER` improvisado em produção.
- Preparar uma migration corretiva **aditiva** (nunca destrutiva) que resolva o problema encontrado, seguindo o mesmo processo de auditoria já usado em toda a linha do tempo do M1-F (design → migration → teste → validação → commit → push).
- Se o dado já estiver corrompido de forma irrecuperável por migration corretiva: restaurar o backup do §5 é o único caminho — decisão que exige aprovação humana explícita, nunca tomada unilateralmente por um agente.

Migrations #32/#36 (FKs de autoria) e #40 (`DROP COLUMN`) são as que, se algo desse errado, mais provavelmente levariam ao Nível 3 — são também as únicas com pré-check dedicado (§8, consultas 1 e 2) especificamente para reduzir essa chance a quase zero antes mesmo de tentar aplicá-las.

## 14. Encerramento

Rollout considerado formalmente encerrado quando: as 47 migrations estão aplicadas e confirmadas (§10), os smoke tests de auth/lifecycle passam, `READ` está ativa há tempo suficiente sem incidente, `WRITE` está ativa há tempo suficiente sem incidente, e as evidências do §15 estão registradas. Só depois disso considerar o início do M1-E E4 (fora do escopo deste runbook).

## 15. Evidências a registrar

Para cada execução real deste runbook: horário e resultado do backup (§5); resultado literal das 10 consultas do §8 antes de começar; hash do commit promovido; confirmação de que as 47 migrations foram aplicadas (lista); resultado dos smoke tests (§11), com timestamp; horário de cada ativação de flag; qualquer anomalia observada durante as janelas de observação (§12.1), mesmo que não tenha exigido rollback; horário de encerramento formal.

---

**Nota sobre o backfill histórico (migrations #2/#3)**: o comentário original de `m1f_s1_02`/`m1f_s2_01` já registra que, num `db reset` local, essas migrations rodam **antes** do `seed.sql` — ou seja, o backfill real de desenvolvimento sempre rodou contra zero linhas. Em produção remota, se este runbook for executado pela primeira vez (nunca aplicado antes), o mesmo vale: não existem `profiles.company_id`/`role` legados em produção para essas duas migrations backfillarem, porque a própria tabela `profiles` de produção, se já existir de um M1-B anterior, nunca teve essas colunas povoadas por um fluxo que as migrations #2/#3 conheçam fora do que elas mesmas established. Se o remoto **já tiver** dados reais de usuários de produção com uma estrutura de `profiles` de M1-B (colunas `company_id`/`role`/`seller_id` reais e povoadas), essas duas migrations passam a ser a etapa de maior atenção real deste runbook — releitura cuidadosa do comportamento de `m1f_s1_02`/`m1f_s2_01` contra o dado real de produção (nunca simulado) é pré-requisito antes de aplicá-las nesse cenário, e está fora do que este documento pode garantir sem ver esse dado.
