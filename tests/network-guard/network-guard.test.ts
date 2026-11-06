// @vitest-environment node
// Prova do bloqueio de rede. Nada sai da máquina: o "destino proibido" é um servidor
// sentinela em 127.0.0.2, fora da lista de permitidos, e os nomes de host usam o domínio
// reservado `.invalid`. Se o bloqueio falhar, o sentinela conta a conexão e o teste reprova.
import { execFile, execFileSync, execSync, fork, spawn, spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Worker } from 'node:worker_threads';
import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface Guard {
  scope: string;
  allowedEndpoints: () => string[];
  captureExpected: (attempt: () => unknown) => Promise<{ mechanism: string; target: string }[]>;
  assertClean: (context: string) => void;
}
const guard = (globalThis as unknown as Record<symbol, Guard>)[Symbol.for('kapa.test.networkGuard')];

const SENTINEL_HOST = '127.0.0.2';
const INVALID_HOST = 'sentinela-do-guarda.invalid';
let tcpHits = 0;
let udpHits = 0;
let tcpPort = 0;
let udpPort = 0;
let tcpSentinel: net.Server;
let udpSentinel: dgram.Socket;

const ignored = () => undefined;

function settled(emitter: { on: (event: string, listener: (...args: unknown[]) => void) => unknown }): Promise<void> {
  return new Promise((resolve) => {
    for (const event of ['error', 'close', 'connect', 'response']) emitter.on(event, () => resolve());
  });
}

async function expectBlocked(attempt: () => unknown, mechanism: string): Promise<void> {
  const before = tcpHits + udpHits;
  const captured = await guard.captureExpected(async () => {
    await attempt();
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  });
  expect(captured.map((item) => item.mechanism)).toContain(mechanism);
  expect(tcpHits + udpHits).toBe(before);
}

beforeAll(async () => {
  tcpSentinel = net.createServer((socket) => { tcpHits += 1; socket.destroy(); });
  await new Promise<void>((resolve) => { tcpSentinel.listen(0, SENTINEL_HOST, resolve); });
  tcpPort = (tcpSentinel.address() as net.AddressInfo).port;
  udpSentinel = dgram.createSocket('udp4');
  udpSentinel.on('message', () => { udpHits += 1; });
  await new Promise<void>((resolve) => { udpSentinel.bind(0, SENTINEL_HOST, resolve); });
  udpPort = udpSentinel.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => { tcpSentinel.close(resolve); });
  await new Promise<void>((resolve) => { udpSentinel.close(() => resolve()); });
  expect(tcpHits).toBe(0);
  expect(udpHits).toBe(0);
});

afterEach(() => {
  expect(tcpHits).toBe(0);
});

describe('instalação', () => {
  it('foi carregado antes do teste, no worker, pelo execArgv', () => {
    expect(guard?.scope).toBe('worker');
    expect(process.execArgv.join(' ')).toContain('network-guard.preload.cjs');
  });

  it('o registro de tentativas chega ao worker', () => {
    expect(process.env.KAPA_NETWORK_GUARD_LOG).toBeTruthy();
  });

  it('não pode ser removido de globalThis nem do protótipo', () => {
    const key = Symbol.for('kapa.test.networkGuard');
    expect(Object.getOwnPropertyDescriptor(globalThis, key)?.configurable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect')?.writable).toBe(false);
    expect(() => { (net.Socket.prototype as unknown as { connect: unknown }).connect = ignored; }).toThrow(TypeError);
  });
});

describe('conexões TCP e TLS', () => {
  it('fetch', async () => {
    await expectBlocked(() => fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`).catch(ignored), 'socket');
  });

  it('fetch para https', async () => {
    await expectBlocked(() => fetch(`https://${SENTINEL_HOST}:${tcpPort}/x`).catch(ignored), 'socket');
  });

  it('fetch a host por nome: bloqueado antes de resolver o DNS', async () => {
    const captured = await guard.captureExpected(() => fetch(`https://${INVALID_HOST}/x`).catch(ignored));
    expect(captured).toEqual([expect.objectContaining({ mechanism: 'socket', target: `${INVALID_HOST}:443` })]);
  });

  it('o erro do fetch traz o código do guarda como causa', async () => {
    await guard.captureExpected(async () => {
      const error = await fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`).then(() => null, (e: Error & { cause?: { code?: string } }) => e);
      expect(error?.cause?.code).toBe('ENETWORKGUARD');
    });
  });

  it('http.get', async () => {
    await expectBlocked(() => settled(http.get(`http://${SENTINEL_HOST}:${tcpPort}/x`)), 'socket');
  });

  it('http.request com agente próprio', async () => {
    await expectBlocked(() => settled(http.request({ host: SENTINEL_HOST, port: tcpPort, agent: new http.Agent() }).on('error', ignored).end() as never), 'socket');
  });

  it('https.get', async () => {
    await expectBlocked(() => settled(https.get(`https://${SENTINEL_HOST}:${tcpPort}/x`)), 'socket');
  });

  it('http2.connect', async () => {
    await expectBlocked(() => settled(http2.connect(`http://${SENTINEL_HOST}:${tcpPort}`)), 'socket');
  });

  it('net.connect', async () => {
    await expectBlocked(() => settled(net.connect(tcpPort, SENTINEL_HOST)), 'socket');
  });

  it('new net.Socket().connect com opções', async () => {
    await expectBlocked(() => settled(new net.Socket().connect({ port: tcpPort, host: SENTINEL_HOST })), 'socket');
  });

  it('tls.connect', async () => {
    await expectBlocked(() => settled(tls.connect({ port: tcpPort, host: SENTINEL_HOST, rejectUnauthorized: false })), 'socket');
  });

  it('WebSocket global', async () => {
    await expectBlocked(() => new Promise<void>((resolve) => {
      const socket = new WebSocket(`ws://${SENTINEL_HOST}:${tcpPort}/x`);
      socket.onerror = () => resolve();
      socket.onclose = () => resolve();
    }), 'socket');
  });

  it('cliente Supabase real', async () => {
    const client = createClient(`http://${SENTINEL_HOST}:${tcpPort}`, 'chave-de-teste', { auth: { persistSession: false, autoRefreshToken: false } });
    // O cliente repete a tentativa sozinho: o abort encerra as repetições.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expectBlocked(() => client.from('leads').select('id').abortSignal(controller.signal), 'socket');
  });

  it('pipe nomeado', async () => {
    await expectBlocked(() => settled(net.connect({ path: '\\\\servidor.invalid\\pipe\\x' })), 'socket');
  });
});

describe('loopback fora da lista', () => {
  it.each([
    ['127.0.0.1 em porta não listada', '127.0.0.1', 9],
    ['localhost', 'localhost', 57321],
    ['0.0.0.0', '0.0.0.0', 57321],
    ['IPv6 mapeado', '::ffff:127.0.0.1', 57321],
    ['nome que imita loopback', '127.0.0.1.invalid', 57321],
  ])('%s é bloqueado', async (_label, host, port) => {
    await expectBlocked(() => settled(net.connect({ host, port })), 'socket');
  });
});

describe('DNS e UDP', () => {
  it('dns.lookup', async () => {
    await expectBlocked(() => new Promise((resolve) => { dns.lookup(INVALID_HOST, resolve); }), 'dns');
  });

  it('dns.promises.resolve4', async () => {
    await expectBlocked(() => dns.promises.resolve4(INVALID_HOST).catch(ignored), 'dns');
  });

  it('dns.promises.lookup', async () => {
    await expectBlocked(() => dns.promises.lookup(INVALID_HOST).catch(ignored), 'dns');
  });

  it('Resolver próprio', async () => {
    await expectBlocked(() => new Promise((resolve) => { new dns.Resolver().resolveTxt(INVALID_HOST, resolve); }), 'dns');
  });

  it('dgram send', async () => {
    const socket = dgram.createSocket('udp4');
    await expectBlocked(() => new Promise((resolve) => { socket.send('x', udpPort, SENTINEL_HOST, resolve); }), 'udp');
    socket.close();
    expect(udpHits).toBe(0);
  });
});

describe('caminhos que escapariam do socket', () => {
  it('process.binding de tcp', async () => {
    await expectBlocked(() => expect(() => (process as unknown as { binding: (n: string) => unknown }).binding('tcp_wrap')).toThrow('rede bloqueada'), 'binding');
  });

  it('worker_threads', async () => {
    await expectBlocked(() => expect(() => new Worker('setTimeout(() => {}, 0)', { eval: true })).toThrow('rede bloqueada'), 'worker_thread');
  });

  it.each([
    ['execSync', () => execSync('echo oi')],
    ['execFileSync', () => execFileSync('node', ['--version'])],
    ['spawnSync', () => spawnSync('node', ['--version'])],
    ['spawn', () => spawn('node', ['--version'])],
    ['execFile', () => execFile('node', ['--version'])],
    ['fork', () => fork('script-inexistente.js')],
  ])('child_process.%s', async (_label, run) => {
    await expectBlocked(() => expect(run).toThrow('rede bloqueada'), 'child_process');
  });

  it('docker só com o comando permitido: `docker run` é recusado', async () => {
    await expectBlocked(() => expect(() => execFileSync('docker', ['run', 'alpine'])).toThrow('rede bloqueada'), 'child_process');
  });

  it('docker em shell é recusado mesmo com o comando permitido', async () => {
    vi.stubEnv('META_LOCAL_DB_CONTAINER', 'supabase_db_kapa-teste');
    await expectBlocked(
      () => expect(() => execFileSync('docker', ['exec', '-i', 'supabase_db_kapa-teste', 'psql'], { shell: true })).toThrow('rede bloqueada'),
      'child_process',
    );
    vi.unstubAllEnvs();
  });
});

describe('independência de spies', () => {
  it('vi.restoreAllMocks não desfaz o bloqueio', async () => {
    vi.restoreAllMocks();
    await expectBlocked(() => fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`).catch(ignored), 'socket');
  });

  it('vi.resetAllMocks e unstubAllGlobals também não', async () => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    await expectBlocked(() => fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`).catch(ignored), 'socket');
  });

  it('spy de fetch desfeito no meio de um teste não reabre a rede', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fake'));
    await fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`);
    spy.mockRestore();
    await expectBlocked(() => fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`).catch(ignored), 'socket');
  });
});

describe('falha detectável', () => {
  it('erro engolido pelo código ainda fica registrado', async () => {
    const captured = await guard.captureExpected(async () => {
      try {
        await fetch(`http://${SENTINEL_HOST}:${tcpPort}/x`);
      } catch {
        // como o código de produção faz ao devolver `network_error`
      }
    });
    expect(captured).toHaveLength(1);
  });

  it('nesta suíte nada ficou pendente', () => {
    expect(() => guard.assertClean('teste')).not.toThrow();
  });
});
