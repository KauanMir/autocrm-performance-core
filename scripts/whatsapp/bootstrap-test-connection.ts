// scripts/whatsapp/bootstrap-test-connection.ts — ENTRADA do bootstrap
// one-shot (W2A): persiste SOMENTE a conexão do número de TESTE da Meta na
// TEST COMPANY de produção. Execução manual/local; nunca importar no app.
// Use o launcher scripts/whatsapp/bootstrap-test-connection.ps1 (segredos por
// prompt oculto). Procedimento: docs/WHATSAPP-CLOUD-API.md.
//
// Lê SOMENTE variáveis WA_BOOTSTRAP_* da sessão (apagadas do process.env
// assim que lidas e de novo no finally); não carrega .env*, não aceita
// argumentos. Sem WA_BOOTSTRAP_MODE=write roda em dry-run (nunca grava).
import {
  createBootstrapGraphPort,
  createBootstrapSupabasePort,
  runBootstrapCli,
} from './bootstrap-test-connection-core';

runBootstrapCli({
  argv: process.argv,
  env: process.env,
  print: (summary) => console.log('[whatsapp-bootstrap]', JSON.stringify(summary, null, 2)),
  createSupabase: createBootstrapSupabasePort,
  createGraph: () => createBootstrapGraphPort(),
}).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  () => {
    process.exitCode = 1;
  },
);
