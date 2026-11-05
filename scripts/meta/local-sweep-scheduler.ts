// META-MVP1 — agendador LOCAL do sweep de Lead Ads. Simula o cron da Vercel
// contra o servidor de desenvolvimento, sem publicar cron nenhum.
//
// Uso (servidor dev rodando em 127.0.0.1:3000, CRON_SECRET no ambiente do shell):
//   npm run meta:sweep-local -- --interval 30 --runs 10
//
// Garantias:
//   - só aceita URL de loopback (127.0.0.1, localhost, ::1); qualquer outro
//     host é recusado antes de qualquer request;
//   - intervalo mínimo de 10 s e no máximo 1000 execuções;
//   - imprime só status HTTP e contadores devolvidos pela rota (que já não
//     trazem IDs, PII ou token); o CRON_SECRET nunca é impresso.
import { META_SWEEP_CRON_PATH } from '../../lib/server/meta-webhook/sweep-schedule';

export const MIN_INTERVAL_SECONDS = 10;
export const MAX_RUNS = 1000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export interface SchedulerOptions {
  baseUrl: string;
  intervalSeconds: number;
  runs: number;
}

export function assertLoopbackBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid_base_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid_base_url');
  if (!LOOPBACK_HOSTS.has(url.hostname)) throw new Error('refusing_non_loopback_host');
  if (url.username || url.password) throw new Error('invalid_base_url');
  return url;
}

export function parseSchedulerArgs(argv: readonly string[]): SchedulerOptions {
  const options: SchedulerOptions = { baseUrl: 'http://127.0.0.1:3000', intervalSeconds: 30, runs: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--base-url' && value !== undefined) {
      options.baseUrl = value;
      index += 1;
    } else if (flag === '--interval' && value !== undefined) {
      options.intervalSeconds = Number(value);
      index += 1;
    } else if (flag === '--runs' && value !== undefined) {
      options.runs = Number(value);
      index += 1;
    } else {
      throw new Error('invalid_argument');
    }
  }
  if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < MIN_INTERVAL_SECONDS) {
    throw new Error('invalid_interval');
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > MAX_RUNS) throw new Error('invalid_runs');
  assertLoopbackBaseUrl(options.baseUrl);
  return options;
}

export function buildSweepRequest(baseUrl: string, cronSecret: string): { url: URL; init: RequestInit } {
  const url = new URL(META_SWEEP_CRON_PATH, assertLoopbackBaseUrl(baseUrl));
  return { url, init: { method: 'GET', headers: { Authorization: `Bearer ${cronSecret}` }, redirect: 'error' } };
}

// Mantém só os campos esperados do resumo da rota.
export function summarizeSweepBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) return {};
  const allowed = ['status', 'attempted', 'created', 'linkedExisting', 'failed', 'leaseLost', 'notClaimed', 'infrastructureErrors'];
  const source = body as Record<string, unknown>;
  return Object.fromEntries(
    allowed.filter((key) => key in source && ['string', 'number'].includes(typeof source[key])).map((key) => [key, source[key]]),
  );
}

export async function runScheduler(
  options: SchedulerOptions,
  cronSecret: string,
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; print?: (line: string) => void } = {},
): Promise<number> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const print = deps.print ?? ((line: string) => console.log(line));
  let failures = 0;
  for (let run = 1; run <= options.runs; run += 1) {
    const { url, init } = buildSweepRequest(options.baseUrl, cronSecret);
    try {
      const response = await doFetch(url, init);
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) failures += 1;
      print(JSON.stringify({ run, httpStatus: response.status, ...summarizeSweepBody(body) }));
    } catch {
      failures += 1;
      print(JSON.stringify({ run, error: 'request_failed' }));
    }
    if (run < options.runs) await sleep(options.intervalSeconds * 1000);
  }
  return failures;
}

async function main(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET ausente no ambiente do shell');
    process.exitCode = 2;
    return;
  }
  const options = parseSchedulerArgs(process.argv.slice(2));
  const failures = await runScheduler(options, secret);
  process.exitCode = failures > 0 ? 1 : 0;
}

if (process.argv[1] && /local-sweep-scheduler\.ts$/.test(process.argv[1])) {
  main().catch(() => {
    console.error('scheduler_failed');
    process.exitCode = 1;
  });
}
