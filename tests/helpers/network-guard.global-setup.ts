// tests/helpers/network-guard.global-setup.ts — roda no processo principal do Vitest.
// Protege esse processo e, no fim, lê as tentativas gravadas pelos workers: pega o que
// aconteceu fora de um teste, onde o hook de tests/setup.ts não alcança.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const guard = require('./network-guard.cjs');

export default function setup(): () => void {
  const logPath = join(tmpdir(), `kapa-network-guard-${process.pid}-${Date.now()}.jsonl`);
  writeFileSync(logPath, '');
  process.env[guard.LOG_ENV] = logPath;
  guard.install({ scope: 'main' });

  return function teardown(): void {
    const content = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim() : '';
    rmSync(logPath, { force: true });
    if (content === '') return;
    const attempts = content.split('\n').map((line) => {
      const { mechanism, target } = JSON.parse(line) as { mechanism: string; target: string };
      return `${mechanism} ${target}`;
    });
    // Erro no teardown só é impresso pelo Vitest; sem isto, o processo terminaria com 0.
    process.exitCode = 1;
    throw new Error(`Tentativas de rede proibidas nesta execução (${attempts.length}): ${[...new Set(attempts)].join('; ')}`);
  };
}
