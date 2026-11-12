# Continuidade do desenvolvimento

Atualizado em 2026-11-06. Objetivo: centralizar implementação e validação no Codex, com participação do usuário apenas quando necessária.

## Estado atual confirmado

**2026-11-12 — P2 (backup do CRM de produção) concluída: 17/17, restauração isolada PASS com 86+87 na cópia, rollback provado com esquema idêntico; 86 ganhou lock_timeout 5 s. P3 pronta, aguarda autorização.**

**2026-11-12 — P1 (backup do KAPA Leads de produção) concluída e aprovada.** Backup 20/20, restauração isolada PASS (inclusive isolamento entre lojas), cópia GPG no Google Drive privada com hashes conferidos e senha no Bitwarden comprovada. Ensaio do CRM com teste de isolamento entre empresas por comportamento (7 usuários, 9 tabelas, 0 vazamentos; controle negativo 59). P2 pronta, aguarda autorização. Detalhes: docs/KAPA-LEADS-SYNC.md §7.

**2026-11-12 — KAPA Leads → CRM: auditoria final + LGPD + kit de liberação, só local.** Correções na 86 (item fora do contrato não trava a loja; ordem da página; recuperação de cursor), nova migration local 20261111130000 (eliminação LGPD no CRM, docs/LGPD-ELIMINACAO.md). pgTAP 88/4827, Meta 9/92, ponta a ponta 9/9. IDs RCAR/Vitrine lidos em produção (somente leitura) em docs/KAPA-LEADS-SYNC.md §6. Kit de backup/restauração dos dois sistemas ensaiado localmente: C:/Users/jaque/Documents/KAPA-Leads-CRM-Liberacao. Suíte completa 403 arquivos / 6921 PASS; tsc 0. Ensaio de aplicação 86/87 + rollback em banco com o histórico de produção: PASS. Produção intocada (CRM 85 migrations).

**2026-11-11 — KAPA Leads → CRM (simuladores), só local.** Branch `codex/kapa-leads-crm-sync`
(worktree `.codex/worktrees/kapa-leads-crm-sync`, base 132f684) e, no KAPA Leads, `codex/crm-export`
(ac2f9e9). Sincronização por pull, desligada por padrão, migration local `20261111120000` (produção
continua 85). Validação local completa com dados fictícios, inclusive ponta a ponta. Nada publicado.
Plano de publicação e rollback: `docs/KAPA-LEADS-SYNC.md`.

**Lead Ads: teste ponta a ponta aprovado em produção para a TEST COMPANY em 2026-11-06 às 16:09 de São Paulo.** App Meta em Ao vivo por autorização do usuário; webhook recebeu o evento, recuperou os campos pela Graph API e criou exatamente um lead na empresa de teste. Nenhum rollout para clientes foi realizado. WhatsApp W2B permanece congelado. Os blocos abaixo preservam o histórico e podem descrever estados anteriores.

## Fontes e limites

- Checkout inicial: `main`, commit `efe0eec`.
- Chats consultados: `Recuperar contexto API META` e `API META`, trechos finais recuperados. Não equivalem a uma auditoria do ambiente remoto.
- Os documentos META-OAUTH e META-WEBHOOK contêm seções históricas; algumas descrevem recursos como futuros embora já exista implementação. Confirme o código antes de planejar funcionalidades.
- Nenhum acesso autenticado à Meta, Vercel ou Supabase foi comprovado nesta retomada. Não foram executadas escritas remotas.

## Meta Lead Ads

Existe OAuth, persistência cifrada, diagnóstico, webhook assinado, ledger de eventos, processamento de leads e sweep de recuperação, com testes e migrations.

Último estado relatado no chat: conexão de teste registrada como conectada, permissões salvas incluindo leads_retrieval, diagnóstico de identidade da Página funcionando e contagem de leads Meta na TEST COMPANY igual a zero. Isso não comprova validade atual nem leitura de leads.

O chat parou antes da exclusão/substituição de um lead fictício e verificação de entrega completa. Não repetir a operação sem conferir se já foi feita. Próxima evidência necessária: evento recebido, processamento concluído, lead na empresa correta e ausência de duplicação.

## WhatsApp

O repositório avançou além do bootstrap discutido no chat antigo: contém captura transacional e inbox somente leitura. A documentação de 2026-11-05 congela as migrations W2B-4 em produção até backup seguro e restauração comprovada. Inscrição da WABA e entrega real ainda precisam ser confirmadas. Não assumir que código local está publicado.

## Alterações anteriores preservadas

- `tsconfig.tsbuildinfo`: já modificado na chegada.
- `supabase/snippets/Untitled query 561.sql`: já não versionado; contém escrita para criar/ajustar empresa de teste local. Apenas lido, não executado.
- `.env.local`: presente; conteúdo não impresso nem versionado.

## Validação nesta retomada

- TypeScript inicial: 22 diagnósticos restritos a quatro arquivos de testes (invites.validate, capabilities, invites/fragment, pipeline/adapter).
- Ajustados contrato do mock RPC, fixture de identidade atual, comentários de null com strictNullChecks desligado e narrowing explícito da união de resultado. Nenhuma alteração no runtime do CRM.
- Vitest no sandbox: EPERM ao renomear cache temporário, antes de coletar testes. Execução repetida fora do sandbox.
- TypeScript após correções: `npx tsc --noEmit --incremental false` concluído com exit code 0.
- Primeiro conjunto: 11 arquivos, 393 testes aprovados (webhooks, cron Meta, bootstrap WhatsApp e quatro arquivos corrigidos).
- Segundo conjunto: 41 arquivos aprovados, 951 testes aprovados; 6 arquivos/32 testes pulados por dependerem do Supabase local opt-in. Inclui serviços, rotas e testes de migrations/captura/inbox WhatsApp em PGlite. Não comprova entrega real da Meta.
- Suíte geral interrompida após deixar de avançar; não foi aprovada. Antes da interrupção, FlowReagendarVisitaRemote reportou 17 falhas em 28 testes. Causa provável a confirmar isoladamente: datas fixas `2026-09-01` já estão no passado, enquanto o relógio de teste preserva o dia real e a aplicação rejeita agendamento passado. Também houve saída esperada de testes de erro de renderização; não interpretar stderr sozinho como falha.

## Ordem de continuidade

1. Concluir referência de testes e compilação; registrar falhas sem ocultá-las.
2. Investigar falhas reproduzíveis, priorizando Meta/WhatsApp e integridade de dados.
3. Conferir acessos autenticados e estado efetivo de deploy, flags e migrations por leitura.
4. Retomar teste controlado Lead Ads e comprovar persistência/idempotência.
5. Retomar liberações WhatsApp quando os pré-requisitos documentados estiverem satisfeitos.

## Continuação de 2026-11-06

- Branch local criada: `codex/integration-baseline`.
- Reagendamento: o relógio dos testes agora é fixado em 31/08/2026 às 08h locais e restaurado após cada teste. Os casos de data personalizada em setembro deixam de depender do dia real; a rejeição de passado continua coberta. Resultado: 28/28 aprovados.
- TypeScript novamente aprovado após essa alteração.
- GitHub autenticado fora do sandbox; repositório `KauanMir/autocrm-performance-core`, branch padrão `main`. O erro de autenticação dentro do sandbox não significava token inválido.
- Docker disponível. Existem stacks `kapa-mvp1-sbx` e `kapa-w2b8-demo`; nenhum é o `autocrm-performance-core` fixado nos testes Meta. Não foram alterados nem usados para rodar fixtures.
- `.env.local` contém apenas URL/chave pública Supabase e flags de frontend; não contém credenciais server-side Meta ou de administração Supabase. Valores não foram exibidos.
- Consulta preparada: `scripts/meta/diagnose-test-company.sql`, somente leitura, com contagens/estados e verificação de vínculo entre evento processado e lead da empresa. Não executada no remoto. Não substitui verificação do runtime, da assinatura na Meta ou do deploy.
- Referência final: 383 arquivos/6.299 testes aprovados na execução sem Home; Home isolado também aprovado (156 testes). Total: 384 arquivos e 6.455 testes aprovados, 6 arquivos/32 testes opt-in pulados. Não houve falhas nessas duas execuções. Comandos: `npm run test:run -- --maxWorkers=2 --exclude tests/screens/Home.test.tsx` e `npm run test:run -- tests/screens/Home.test.tsx --maxWorkers=2`.
- A suspeita inicial de travamento de Home não se confirmou: isolado, concluiu em 9,56s. A suíte ampla levou 406,41s; sua saída silenciosa entre arquivos aprovados foi interpretada prematuramente como falta de progresso na primeira tentativa.
- `git diff --check` aprovado; apenas avisos de normalização LF/CRLF do Git no Windows. Nenhum deploy, push, migration remota ou alteração nos stacks Docker.
- Usuário executou diagnóstico no Supabase e trouxe apenas `processed_without_matching_lead: 0`. Isso não comprova ingestão: também ocorre com zero eventos. Consulta ajustada para devolver todas as seções em uma única linha, evitando perder result sets no SQL Editor. Estado da conexão/eventos/leads ainda aguarda resultado consolidado.

## Diagnóstico remoto confirmado via integração Supabase

Em 2026-11-06 às 15:43 de São Paulo, acesso direto somente de leitura confirmado ao projeto `autocrm-m1b` (`qglirrsyhdfbgkmchwcw`), Postgres 17.11, ACTIVE_HEALTHY. O bloqueio do navegador deixa de impedir consultas de banco.

- Conexão da Página de teste: `connected`, token presente, versão de chave 1, quatro escopos salvos incluindo `leads_retrieval`, sem erro de conexão registrado e sem desconexão. Isso é estado persistido, não validação atual da Graph API.
- Ledger Meta inteiro: zero eventos, última recepção nula. TEST COMPANY: zero leads com origem Meta Lead Ads.
- Migrations remotas Meta: conexão p2, p3 RPCs, p35 scopes, p4a owner, ledger p1, processamento p2 e sweep p25a presentes.
- Migrations WhatsApp remotas: somente connections W2A e webhook events W2A presentes. O congelamento W2B continua aplicável.
- Logs consultados por contagem de origem, sem retornar payloads ou credenciais. Advisor health sem avisos.
- Advisors de segurança/performance têm avisos a avaliar em trabalho separado: search_path de 3 funções; execução anon de duas funções de trigger (`_competition_rewards_freeze_on_seller_deactivate` e `rls_auto_enable`); capabilities SECURITY DEFINER autenticadas; proteção contra senhas vazadas; índices e initplan de RLS. Não concluir vulnerabilidade explorável só pelo aviso nem alterar grants sem verificar função e contrato. Links: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable e https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable.
- Próxima investigação: deploy/runtime da Vercel (flag META_LEAD_INGESTION_ENABLED, logs do webhook, versão publicada) e assinatura/entrega da Página na Meta. Zero eventos não distingue falha de entrega, flag desligada, evento ignorado ou erro de persistência.
- Integração Vercel encontrada e sugerida, ainda não conectada. Nenhuma escrita remota nesta etapa.

## Acesso Vercel confirmado

Em 2026-11-06 às 15:47 de São Paulo, autorização de equipe concluída. Projeto `prj_UJbnmViRZQhh8im3oXx9ZP2nmJdp`, equipe `team_U7UNnJzgewpSUCpGg74Jt6LF` (`kauan-s-projects3`).

- Produção READY: `dpl_4Rnuo4LTAcEQyjGsDk1sRjvRiAhH`, commit `1da7ccf1bdb088d66f901c804058b8a887706628` na main. Domínio `crm.assessoriakapa.com.br` associado.
- Checkout contém cinco commits posteriores, incluindo captura e inbox WhatsApp; não publicar automaticamente, pois as migrations W2B de produção continuam congeladas.
- Configuração atual de produção `META_LEAD_INGESTION_ENABLED` = string exata `true` (config não sensível, lida individualmente). Não foram lidos valores de segredos nem alteradas variáveis. Isso confirma configuração do projeto, não prova o valor efetivo do deployment imutável.
- GET público de diagnóstico, com verify token fictício inválido, retornou 403 `forbidden`, consistente com a rota rejeitando uma tentativa de handshake sem credencial válida. Não prova assinatura POST, ingestão ou entrega Meta.
- Consultas de logs com filtro do webhook na última hora e `meta` nos últimos 10 minutos retornaram vazias, inclusive logo após o probe. Não inferir ausência de tráfego apenas dessa consulta: retenção, atraso e filtros podem limitar a visibilidade.
- Próximo ponto: conferir assinatura da Página/app e gerar teste controlado na Meta, acompanhando Vercel e ledger Supabase. Acesso Meta ainda não disponível por connector; os conectores encontrados na busca eram de análise/campanhas e não comprovam suporte a configuração de webhooks Developers.

## Teste via painel Meta confirmado

Em 2026-11-06 às 15:52 de São Paulo, sessão autenticada no navegador interno permitiu verificar o app KAPA CRM sem ler tokens:

- Objeto Page com callback correto `https://crm.assessoriakapa.com.br/api/webhooks/meta`; campo `leadgen` assinado em v26.0.
- App permanece em desenvolvimento. O painel informa explicitamente que apps não publicados recebem apenas webhooks de teste enviados do painel; dados de produção, inclusive de administradores/desenvolvedores/testadores, não são fornecidos enquanto não publicado. Não mudou para Ao vivo.
- Enviado um payload fictício padrão pelo teste do campo leadgen (IDs compostos por 4). Logs Vercel às 18:52:15Z confirmaram `accepted` e `leadgen_skipped_other_company`. Isso comprova entrega Meta→Vercel, assinatura válida e ramo de ingestão ativo, com isolamento de empresa funcionando para a Página fictícia. Não comprova persistência ou recuperação de lead real.
- Consulta Supabase posterior: ledger continua com zero eventos, compatível com filtro de empresa.
- Ferramenta Lead Ads: Página `KAPA CRM Teste` selecionada, formulário `KAPA CRM TESTE — Lead Ads Smoke`; diagnóstico da Página com três checks verdes; app 949664270760149 associado e mensagem `Este app não tem problemas`.
- Rastreamento do lead preexistente continua `Pending`; não há evidência de entrega dele. Tentativa de criar lead foi recusada com `Um lead já foi criado para esse formulário. Para criar um novo lead, exclua o outro.` Nenhum lead novo criado. Prévia mostra submissão já concluída.
- Renovar teste depende de remover o lead fictício existente do formulário; não excluído nesta etapa. Mesmo renovado, o modo desenvolvimento pode impedir entrega automática; não prometer que só remover resolve. Publicação exige avaliar os pré-requisitos e acesso/revisão da Meta separadamente.

## Renovação autorizada e auditoria de publicação

Em 2026-11-06, usuário autorizou explicitamente excluir somente o lead fictício do formulário e criar outro. A ferramenta Meta confirmou `Seu lead foi excluído` e depois `Seu lead de teste foi enviado`. A criação usou o botão padrão da ferramenta (sem valores personalizados de nome/telefone). A prévia continuou exibindo a tela de submissão já concluída; não foi usado dado pessoal do usuário. Não considerar esse teste como prova de normalização de telefone válido.

- Novo teste continua `Pending` após nova consulta de status; aproximadamente às 16:01 de São Paulo, Vercel não mostrava novo POST associado ao teste e Supabase continuava com zero eventos e zero leads Meta.
- Modo desenvolvimento segue a principal hipótese de bloqueio, apoiada pelo aviso explícito do painel. Não declarar causa única provada nem assumir que publicar corrige todas as etapas.
- Configurações básicas: empresa Assessoria KAPA aparece `Verificado`; URLs de privacidade, termos e instruções de exclusão preenchidas. As três URLs responderam HTTP 200 em leitura externa; isso não é revisão do conteúdo jurídico.
- Permissões: `pages_manage_metadata` aparece Advanced access, status `Acesso avançado concedido`; `pages_read_engagement`, `pages_show_list` e `leads_retrieval` aparecem Advanced access, status `Verificação necessária`. O link dessas três leva ao cartão da empresa, que já mostra `Verificado`; a divergência não foi resolvida. Os rótulos `Ativo/Inativo (N)` pertencem à coluna de chamadas de API; não são prova isolada de permissão revogada.
- Revisado o código do commit efetivamente publicado `1da7ccf`: ingestão recusa qualquer Page fora de META_TEST_PAGE_ID antes de acessar banco e exige owner connected na META_TEST_COMPANY_ID. Nenhum controle foi afrouxado.
- App não foi publicado, nenhuma permissão foi alterada, nenhum cliente foi conectado. Próxima mudança proposta: modo Ao vivo do app, sujeito à confirmação de disponibilidade externa e à avaliação de eventuais exigências exibidas pela Meta. Não trocar grants/permissões nem aceitar termos automaticamente.

## Teste ponta a ponta concluído

O usuário autorizou a mudança para Ao vivo. O seletor foi ativado e confirmado visualmente (valor 1). A Meta não apresentou exigência adicional nem diálogo de termos. O painel passou a mostrar também Verificação de Uso de Dados concluída. O rótulo textual ao lado do seletor ainda dizia desenvolvimento; registrar essa inconsistência visual, sem repetir o toggle: o teste posterior de entrega passou.

1. Renovado o lead fictício no mesmo formulário após publicação. O evento chegou ao ledger às 19:04:40Z e terminou `failed/missing_phone` em uma tentativa. O teste padrão da ferramenta fornece telefone não utilizável; o CRM recusou a entrada conforme esperado.
2. Usado o Graph API Explorer autenticado com a credencial já existente, sem copiar/exibir/alterar token. Leituras confirmaram ID e nome do formulário e suas chaves `full_name`/`phone_number`. Não foram geradas novas credenciais nem ampliados escopos.
3. Confirmado que o telefone fictício planejado não existia no CRM. Removido o teste inválido da Meta no mesmo fluxo autorizado de renovação; mantido o ledger de erro no CRM para auditoria.
4. POST v26.0 `1086756704316763/test_leads` com field_data: nome fictício Teste Kapa Definitivo e telefone fictício +5562900000001. Novo lead Meta: `1876443300184540`. Nenhuma mensagem ou ligação enviada.
5. Meta RTU: `Success`, payload associado à Página e formulário corretos. Vercel às 19:08:59Z: `leadgen_registered` e `accepted`, testCompany true.
6. Supabase: recebido às 19:08:59.156Z; processado às 19:09:00.473515Z; `processed`, attempts 1, last_error_code null, CRM lead vinculado, mesma empresa, origem Meta Lead Ads e telefone fictício correspondentes.
7. Contagens finais: 1 evento para o novo leadgen_id; 1 lead Meta na TEST COMPANY; 1 ocorrência do telefone fictício em todo o banco; 0 ocorrências desse telefone em outras empresas. Sem duplicação observada neste teste. Reentrega deliberada do mesmo evento não foi executada; não confundir contagem única com prova de retry real.

Sem deploy, alteração de código runtime, migration ou ampliação do gate de empresa nesta validação. Aba Meta com Success mantida como comprovante; aba auxiliar Graph Explorer fechada.

Próxima revisão técnica: recuperação automática. A rota de sweep autenticada existe, mas o repositório não contém `vercel.json` e seus comentários tratam o scheduler como fase futura. Ainda não foi comprovado agendamento externo ativo. Conferir antes de prometer recuperação automática em caso de falha do processamento imediato. Validar também reentrega/idempotência com o mesmo leadgen_id em ambiente controlado antes de rollout para clientes.

## Recuperação e reentregas: implementação preparada

Revisão de 2026-11-06: o painel Vercel Schedules mostrou a tela inicial sem jobs; produção não tem `cron.job` e não havia eventos Meta unfinished. A API Vercel não disponibilizou a árvore de arquivos do deploy (404); não usar isso como prova de ausência de rota. O painel foi a evidência de agendamento ausente.

- Adicionado `tests/integration/meta/reliability.pglite.test.ts`: PostgreSQL isolado com todas as migrations, adapters supabase-js/RPC reais por bridge, Graph fictícia e destinos de rede bloqueados. Nove testes aprovados, incluindo reentregas sequenciais, backoff, recuperação após lease expirado, falha antes do complete, erro terminal e gate de Página. Inclui contratos SQL 78/79/80. Não prova concorrência entre processos ou PostgREST real.
- Shim pgTAP compartilhado ganhou `lives_ok`, necessário pelo contrato 79. Um teste negativo confirma que falhas SQL não são aprovadas silenciosamente. Regressão WhatsApp/Meta em PGlite: 77 testes aprovados antes de adicionar o teste negativo (agora nove no novo arquivo). Suíte Meta ampliada: 223 aprovados antes desse último teste.
- `vercel.json` preparado usando Schedules atual da Vercel: `meta-leadgen-recovery`, GET `/api/cron/meta-leadgen-sweep`, `*/5 * * * *`, UTC, jitter 1, reutilizando CRON_SECRET sem ler seu valor. Documentação oficial confirma header Bearer e Preview inicialmente inativo. Projeto identificado como Pro no painel.
- Rota ganhou maxDuration 240 s (abaixo do lease 300 s) e log de resumo somente com contadores. Sem alteração nas regras de retry, grants ou migrations.
- Entrega isolada criada a partir de produção `1da7ccf`, no worktree gerenciado `C:\Users\jaque\.codex\worktrees\meta-recovery-release\autocrm-performance-core`; branch `codex/meta-recovery-release`, commit `69d82713f9f072e0f9e3ee5b23828ea44eab15f4`, enviada ao GitHub. Contém apenas config, rota, runbook e quatro correções de tipos de testes. Não inclui os cinco commits de WhatsApp posteriores a produção. Não abrir PR desta branch contra main sem considerar que sua base é anterior ao W2B; futuras integrações devem aplicar o commit sem reverter W2B.
- Na árvore exata dessa entrega: 384 testes aprovados, TypeScript aprovado e `npm run build` aprovado. Preview automático `dpl_HzNbDdBDpdxdC9Wqq4DHJ5oN27ZB` ainda estava BUILDING na última consulta. Agendamento ainda não publicado em produção.
- Preservadas alterações anteriores tsconfig.tsbuildinfo e supabase/snippets no checkout principal. Não foram incluídas no commit da entrega.

## Recuperação Meta publicada e verificada

Em 2026-11-06, o deployment de produção `dpl_8wsJZVEKicSS9SoZtLLo2zGAJivG`, commit `69d82713f9f072e0f9e3ee5b23828ea44eab15f4`, ficou READY e associado ao domínio do CRM. O schedule `meta-leadgen-recovery` está ativo; o painel mostrou 29 execuções e 0% de erro. Logs de execuções periódicas confirmaram acesso autenticado à rota e nenhum erro de infraestrutura, com fila vazia. O banco manteve um lead Meta na empresa de teste, zero eventos pendentes e o registro terminal `missing_phone`. Detalhes e limites da validação constam em `docs/META-RECOVERY.md`.

O código da entrega já existe neste checkout como alterações locais, mas ainda não foi consolidado em commit na branch de desenvolvimento. Preservar as alterações pré-existentes do usuário. Os cinco commits posteriores de WhatsApp permanecem fora do deployment Meta; W2B continua condicionado a backup e restauração comprovados.

## W2B backup and restore rehearsal — 2026-11-06

The Supabase dashboard confirms that this project uses the Free plan, without scheduled backups. The existing authenticated CLI session successfully exported production without asking for or exposing the database password. Production was not changed.

A logical backup was restored in a disposable Supabase Postgres 17.11.0.003 container, with no published ports and Docker networking disabled. Counts matched production: 15 leads, 4 companies, 8 auth users, 2 Meta events, 0 WhatsApp events, and 79 migrations. Separate exports preserve the managed Auth/Storage schema and migration history. The default CLI export omitted explicit ACLs; a supplemental catalog export restores privileges for public, auth, and storage tables, sequences, and functions. Production itself denies direct WhatsApp table access to anon, authenticated, and service_role, as intended.

The three pending migrations (W2B-4 conversations, W2B-4 capture RPCs, W2B-8 inbox reads) applied successfully to the restored copy. After restoring source ACL metadata, all existing database contracts passed: 81 (50 assertions), 82 (35), 83 (85), and 84 (38), totaling 208. This is a rehearsal against restored production data, not a remote migration or an end-to-end WhatsApp delivery test.

Verified backup: `C:\Users\jaque\.codex\backups\w2b-20261106\database-with-acl.zip.dpapi`; evidence: `manifest.json` in the same private directory. Windows DPAPI CurrentUser encryption was round-trip verified. Recovery requires the current Windows user's DPAPI credentials/profile; this is not yet an off-device disaster-recovery copy. Plaintext local exports and the disposable restore container were removed. No backup data is stored in Git.

Restore sequence: decrypt the archive with Windows ProtectedData.Unprotect using CurrentUser, then use a compatible clean Supabase Postgres target; restore roles, dependency-ordered restore-schema.sql, data.sql with session_replication_role=replica, migration-data.sql, and production-acl.sql. The local image's older Auth/Storage schemas had to be replaced with the exported versions inside the disposable restore transaction. Do not run this local preparation against production. Storage object binaries and external application encryption keys are not included; preserve them separately if needed.

Remaining release checks: W2B-2 diagnostic deployment/preflight, effective runtime flags, pending environment changes, migration automation, encryption-key escrow, and role-based HTTP checks. WhatsApp ingestion and capture remain off; WABA subscription and real-message smoke are not completed.

## W2B production runtime preflight — 2026-11-06

Authenticated Super Admin opened the TEST COMPANY operation, Settings > Integrations, and ran the read-only WhatsApp diagnostic. Production reported ingestion disabled, webhook verification token configured, app secret configured, valid token-encryption-key format, one connected test-company connection, ledger summary unavailable, WABA subscription unconfirmed, and deployment Production / 69d8271. Unauthenticated HTTP access returned 401 with unauthenticated. Existing diagnostics and inbox authorization tests passed: 109 assertions across two files. Authenticated Manager/Seller HTTP probes have not been executed; their denial is covered by mocked route tests only.

Vercel environment metadata was inspected without decrypting values. WHATSAPP_CONTENT_ENCRYPTION_KEY_V1 and WHATSAPP_CONTACT_HMAC_KEY_V1 are absent. WhatsApp ingestion/inbox flags are also absent from the project-level list; ingestion OFF was independently confirmed in the actual runtime. Shared-variable state and pending environment changes still require their own checks. The Git checkout has no .github/workflows directory; this alone does not prove that Supabase has no external migration automation.

Next release sequence: verify external migration automation and pending environment changes; create two distinct 32-byte capture keys and escrow them in the user's Bitwarden; confirm retrievability without exposing values; apply the three rehearsed additive migrations individually; publish capture/inbox code with ingestion and inbox gates OFF; repeat runtime and role-based HTTP checks. Key creation and escrow have not been performed. The documented Bitwarden escrow requirement cannot be fulfilled through the currently connected tools; an unlocked user-approved vault is needed before secret provisioning. No production schema, environment variable, WABA subscription, or capture setting changed during this preflight.

## WhatsApp capture key escrow — 2026-11-06

Two distinct cryptographically random 32-byte keys were created and saved as separate Bitwarden vault entries: `KAPA CRM — WHATSAPP_CONTENT_ENCRYPTION_KEY_V1` and `KAPA CRM — WHATSAPP_CONTACT_HMAC_KEY_V1`. Both save operations returned the vault's successful item-added state. Values were not printed, copied to chat, or written into the repository. Notes record production scope, version, purpose, and rotation constraints. Vercel configuration is pending the user's confirmation of this separate secret destination; neither key is effective in production yet.

## W2B database and key provisioning — 2026-11-06

The user explicitly authorized sending the two escrowed capture keys to Vercel Production. Both were saved as Secret variables scoped only to Production. The dashboard confirmed success and stated that a new deployment is required; existing deployments retain their original environment. No ingestion/inbox flag was added or enabled.

Production migrations applied individually, with original repository versions preserved: 20261105100000 (contacts/conversations/messages), 20261105110000 (capture RPCs), and 20261105120000 (inbox read RPCs). CLI staging selected one pending migration per invocation, skipped vault updates, and excluded seeds and role changes. The initial staging attempt failed before connecting because referenced email templates were absent; copying those existing templates resolved it without any remote change in the failed attempt.

Final read-only checkpoint: 82 migrations; 15 leads; 4 companies; 2 Meta events; zero contacts/conversations/messages; zero capture-enabled connections; RLS enabled on all three new tables; no direct SELECT/INSERT/UPDATE/DELETE privilege for anon, authenticated, or service_role. Public WhatsApp RPCs deny anon/authenticated execution. Backend RPCs allow service_role; internal trigger/read-authorization helpers deny it, as designed. Supabase project overview independently showed GitHub: No repository connected.

The schema/key prerequisites are complete. Capture/inbox application deployment, effective key-format checks, role-based HTTP probes, WABA subscription, and controlled real-message smoke remain pending. Do not enable capture or ingestion as part of deployment alone. The backup and restore evidence remains in the prior entry.

## Lead Ads release for the RCAR pilot — 2026-11-09 (local only)

Branch `codex/leadads-rcar-release` (worktree `C:\Users\jaque\.codex\worktrees\leadads-rcar-release`)
is built on the Production commit `9c11545` with only the Lead Ads work (MVP-1, MVP-2,
core grant hardening): 3 new migrations (82 → 85), no new environment variable, no
WhatsApp W2B-9 / channel intake / Instagram. Validation: pgTAP 86 files / 4725 PASS;
Meta integration 9 files / 92 PASS on a disposable `sbx` stack; Production code
`9c11545` against the new schema 7 files / 41 PASS (code-only rollback is safe);
restore rehearsal on the 2026-11-06 backup 16/16 PASS with no new pgTAP failure vs
baseline; tsc 0; full suite 400 files / 6881 PASS; build PASS. Nothing pushed,
deployed or applied. Plan, risks, Meta permission status and owner decisions:
`docs/RCAR-LEADADS-PILOT.md`. Read-only readiness query:
`scripts/meta/rcar-pilot-readiness.sql`.

## RCAR deployment preparation — 2026-11-10 (local only)

No production change. Operator kit outside Git at `C:\Users\jaque\Documents\RCAR-Liberacao`
(runbook, final checklist, read-only SQL, backup/restore/offsite scripts, one-migration
applier, SHA-256 sums). Read-only checks: project healthy (PG 17.11.0.003), no managed
backups/PITR, 1 banned IPv4, Production deployment still `9c11545`, direct DB host
reachable over IPv6 from a host-network container. CLI 2.116.0 facts: dump/push mint the
`cli_login_postgres` temp password (`read_only: false`); the pooler fallback deletes all
network bans after 3 failed logins (the backup script aborts on the first connection
error). Found and fixed: the 2026-11-06 ACL supplement dropped column-level grants on
restore. Local rehearsals with fictitious data PASS (backup → DPAPI → isolated restore →
3 migrations → pgTAP; one-at-a-time applier → 85 migrations, expected hash). Branch
re-validated: tsc 0, suite 400 files / 6881 PASS. Details: `docs/RCAR-LEADADS-PILOT.md` §8.
Production migration count not re-read (needs the owner's SQL Editor run).
