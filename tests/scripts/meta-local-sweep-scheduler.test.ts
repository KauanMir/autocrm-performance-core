// META-MVP1 — agendador local do sweep: só loopback, sem vazar segredo.
import { describe, expect, it, vi } from 'vitest';
import {
  assertLoopbackBaseUrl,
  buildSweepRequest,
  parseSchedulerArgs,
  runScheduler,
  summarizeSweepBody,
} from '@/scripts/meta/local-sweep-scheduler';

const SECRET = 'fake-cron-secret-local-only';

describe('assertLoopbackBaseUrl', () => {
  it.each(['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000'])('%s aceito', (url) => {
    expect(() => assertLoopbackBaseUrl(url)).not.toThrow();
  });

  it.each([
    ['https://crm.assessoriakapa.com.br', 'refusing_non_loopback_host'],
    ['http://192.168.0.10:3000', 'refusing_non_loopback_host'],
    ['http://127.0.0.1.evil.test', 'refusing_non_loopback_host'],
    ['ftp://127.0.0.1', 'invalid_base_url'],
    ['http://user:pass@127.0.0.1', 'invalid_base_url'],
    ['nada', 'invalid_base_url'],
  ])('%s recusado', (url, error) => {
    expect(() => assertLoopbackBaseUrl(url)).toThrow(error);
  });
});

describe('parseSchedulerArgs', () => {
  it('defaults seguros', () => {
    expect(parseSchedulerArgs([])).toEqual({ baseUrl: 'http://127.0.0.1:3000', intervalSeconds: 30, runs: 10 });
  });

  it.each([
    [['--interval', '5'], 'invalid_interval'],
    [['--runs', '0'], 'invalid_runs'],
    [['--runs', '1001'], 'invalid_runs'],
    [['--base-url', 'https://crm.assessoriakapa.com.br'], 'refusing_non_loopback_host'],
    [['--bogus'], 'invalid_argument'],
  ])('%j → %s', (argv, error) => {
    expect(() => parseSchedulerArgs(argv)).toThrow(error);
  });
});

describe('runScheduler', () => {
  it('chama GET na rota do sweep com Bearer, N vezes, e imprime só status e contadores', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok', attempted: 2, created: 1, failed: 1, leaked: 'x' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    const lines: string[] = [];
    const failures = await runScheduler(
      { baseUrl: 'http://127.0.0.1:3000', intervalSeconds: 10, runs: 3 },
      SECRET,
      { fetchImpl, sleep, print: (line) => lines.push(line) },
    );
    expect(failures).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10_000);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:3000/api/cron/meta-leadgen-sweep');
    expect((init as RequestInit).headers).toEqual({ Authorization: `Bearer ${SECRET}` });
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain('leaked');
    }
    expect(JSON.parse(lines[0])).toEqual({ run: 1, httpStatus: 200, status: 'ok', attempted: 2, created: 1, failed: 1 });
  });

  it('401 e erro de rede contam como falha', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ status: 'unauthorized' }), { status: 401 });
      throw new Error(`down ${SECRET}`);
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    const failures = await runScheduler({ baseUrl: 'http://127.0.0.1:3000', intervalSeconds: 10, runs: 2 }, SECRET, {
      fetchImpl, sleep: async () => {}, print: (line) => lines.push(line),
    });
    expect(failures).toBe(2);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('buildSweepRequest nunca segue redirect', () => {
    expect(buildSweepRequest('http://127.0.0.1:3000', SECRET).init.redirect).toBe('error');
  });

  it('summarizeSweepBody ignora formatos inesperados', () => {
    expect(summarizeSweepBody(null)).toEqual({});
    expect(summarizeSweepBody({ attempted: { nested: 1 } })).toEqual({});
  });
});
