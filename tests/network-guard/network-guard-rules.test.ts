// @vitest-environment node
// Regras do bloqueio, em outro arquivo de teste de propósito: roda em outro processo e
// comprova que cada worker carrega a proteção por conta própria.
import { createRequire } from 'node:module';
import net from 'node:net';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseAllowlist, isEndpointAllowed, isCommandAllowed, readConnectTarget } = require('../helpers/network-guard.cjs');

describe('outro processo de teste', () => {
  it('também tem a proteção carregada antes do teste', async () => {
    const guard = (globalThis as unknown as Record<symbol, { scope: string; captureExpected: (a: () => unknown) => Promise<unknown[]> }>)[Symbol.for('kapa.test.networkGuard')];
    expect(guard.scope).toBe('worker');
    expect(process.execArgv.join(' ')).toContain('network-guard.preload.cjs');
    const captured = await guard.captureExpected(() => new Promise<void>((resolve) => {
      net.connect(9, '127.0.0.2').on('error', () => resolve());
    }));
    expect(captured).toHaveLength(1);
  });
});

describe('lista de endpoints permitidos', () => {
  it('vazia por padrão', () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
  });

  it('aceita loopback literal com porta', () => {
    expect([...parseAllowlist('127.0.0.1:57321,[::1]:57321')]).toEqual(['127.0.0.1:57321', '[::1]:57321']);
  });

  it.each([
    'graph.facebook.com:443',
    'example.invalid:443',
    'localhost:57321',
    '0.0.0.0:57321',
    '10.0.0.5:5432',
    '192.168.0.10:5432',
    '127.0.0.2:57321',
    '127.0.0.1',
    '127.0.0.1:*',
    '127.0.0.1:0',
    '127.0.0.1:70000',
    '*:443',
    '127.0.0.1:57321,graph.facebook.com:443',
  ])('recusa %s e impede a execução', (entry) => {
    expect(() => parseAllowlist(entry)).toThrow('KAPA_TEST_NETWORK_ALLOWLIST');
  });

  it('compara host e porta exatos', () => {
    const allowed = parseAllowlist('127.0.0.1:57321');
    expect(isEndpointAllowed('127.0.0.1', 57321, allowed)).toBe(true);
    expect(isEndpointAllowed('127.0.0.1', '57321', allowed)).toBe(true);
    expect(isEndpointAllowed('127.0.0.1', 57322, allowed)).toBe(false);
    expect(isEndpointAllowed('localhost', 57321, allowed)).toBe(false);
    expect(isEndpointAllowed('::1', 57321, allowed)).toBe(false);
  });
});

describe('leitura do destino de uma conexão', () => {
  it.each([
    [[{ host: 'a.invalid', port: 1 }], { host: 'a.invalid', port: 1 }],
    [[[{ host: 'a.invalid', port: 1 }, null]], { host: 'a.invalid', port: 1 }],
    [[80, 'a.invalid'], { host: 'a.invalid', port: 80 }],
    [['80', 'a.invalid'], { host: 'a.invalid', port: '80' }],
    [[80], { host: 'localhost', port: 80 }],
    [[{ port: 80 }], { host: 'localhost', port: 80 }],
    [[{ path: '/tmp/s' }], { path: '/tmp/s' }],
    [['/tmp/s'], { path: '/tmp/s' }],
  ])('%j', (args, expected) => {
    expect(readConnectTarget(args)).toEqual(expected);
  });
});

describe('comandos permitidos', () => {
  const env = { META_LOCAL_DB_CONTAINER: 'supabase_db_kapa-mvp1-sbx' };

  it('psql e inspect na pilha descartável', () => {
    expect(isCommandAllowed('docker', ['exec', '-i', 'supabase_db_kapa-mvp1-sbx', 'psql', '-U', 'postgres'], env)).toBe(true);
    expect(isCommandAllowed('docker.exe', ['exec', '-i', 'supabase_db_kapa-mvp1-sbx', 'psql'], env)).toBe(true);
    expect(isCommandAllowed('docker', ['inspect', 'supabase_kong_kapa-mvp1-sbx'], env)).toBe(true);
  });

  it.each([
    ['contêiner fora da pilha descartável', 'docker', ['exec', '-i', 'supabase_db_autocrm-performance-core', 'psql']],
    ['contêiner diferente do configurado', 'docker', ['exec', '-i', 'supabase_db_kapa-outro', 'psql']],
    ['outro comando no contêiner', 'docker', ['exec', '-i', 'supabase_db_kapa-mvp1-sbx', 'sh', '-c', 'curl']],
    ['docker run', 'docker', ['run', 'alpine']],
    ['docker cp', 'docker', ['cp', 'a', 'b']],
    ['inspect de contêiner qualquer', 'docker', ['inspect', 'qualquer']],
    ['curl', 'curl', ['https://example.invalid']],
    ['node', 'node', ['-v']],
    ['powershell', 'powershell.exe', ['-c', 'x']],
    ['npx supabase', 'npx', ['supabase', 'db', 'push']],
  ])('recusa %s', (_label, file, args) => {
    expect(isCommandAllowed(file, args, env)).toBe(false);
  });
});
