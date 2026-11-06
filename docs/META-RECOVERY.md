# Recuperação de eventos Meta Lead Ads

O webhook persiste antes de responder e tenta processar imediatamente via waitUntil.
Esse processamento não é uma fila durável. A recuperação usa a rota autenticada
`GET /api/cron/meta-leadgen-sweep`, acionada pelo schedule `meta-leadgen-recovery`.

## Configuração preparada

- `vercel.json`: a cada cinco minutos em UTC, janela de dispersão de um minuto.
- Projeto atual identificado no painel como Pro. Essa frequência exige plano compatível.
- Reutiliza `CRON_SECRET` já cadastrado; o valor não foi lido nem copiado.
- Rota exige Bearer válido antes de ler a flag ou acessar o banco.
- `META_LEAD_INGESTION_ENABLED` precisa ser exatamente `true`.
- Lote máximo de 20, lease de 300 s, maxDuration explícito de 240 s.
- Log `[meta-leadgen-sweep]` contém somente contadores de resultado.
- Não executa migrações nem altera inscrições ou tokens na Meta.

A documentação atual da Vercel define schedules estáticos no deploy e mantém
`Authorization: Bearer <CRON_SECRET>` para targets de path. GET precisa ser explícito,
pois o padrão de Schedules é POST. Novos schedules de Preview começam inativos.
Fontes verificadas em 2026-11-06:

- https://vercel.com/docs/schedules/configuration
- https://vercel.com/docs/schedules/migrate-from-cron-jobs
- https://vercel.com/docs/schedules/concepts

## Validação isolada

`npm run test:run -- tests/integration/meta/reliability.pglite.test.ts --maxWorkers=2`

O teste aplica todas as migrations no PGlite, usa os adapters supabase-js e as RPCs
reais por um bridge de PostgREST, com Graph fake e sem acesso à rede. Executa também
os contratos SQL 78, 79 e 80 por um shim pgTAP. Casos: reentrega sequencial, backoff,
lease válido/expirado, falha antes do complete, erro terminal e Página fora do escopo.
Isso não prova concorrência entre processos, PostgREST real ou scheduler remoto.

## Publicação e verificação

O painel de produção estava sem schedules em 2026-11-06. A configuração local não
significa que o job já esteja ativo. Publicar apenas uma entrega baseada no commit
de produção `1da7ccf`, com as alterações Meta necessárias. O checkout mais recente
contém WhatsApp W2B ainda bloqueado por backup/restauração; não promover tudo.

Depois da publicação, confirmar `meta-leadgen-recovery` ativo em Schedules, executar
Run Schedule uma vez e verificar resposta/log autenticado sem erro. Confirmar a
próxima execução periódica e que o único lead Meta válido de teste continua único.
Falhas terminais como missing_phone permanecem no ledger e não devem ser apagadas
ou convertidas em retries automáticos.

Para pausar, desabilitar esse schedule no painel. Isso preserva a tentativa imediata
do webhook. Rollback do deploy restaura a configuração de schedules do deploy anterior.
