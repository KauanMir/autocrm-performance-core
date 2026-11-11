'use strict';
// tests/helpers/network-guard.cjs — bloqueio de rede da suíte de testes.
//
// Carregado com `--require` em cada worker (vitest.config.ts), antes de qualquer
// código de teste. Não usa spies: `vi.restoreAllMocks()` não o desfaz.
//
// Regra: nenhuma conexão é permitida, inclusive em loopback, exceto os endpoints
// listados em KAPA_TEST_NETWORK_ALLOWLIST, que só aceita `127.0.0.1:<porta>` ou
// `[::1]:<porta>`. Não existe exceção para domínio externo.
//
// Bloquear não basta: o código de produção transforma erro de rede em retorno
// (`network_error`). Por isso toda tentativa é registrada, e tests/setup.ts reprova
// o teste. O registro também vai para um arquivo lido no fim da execução, para pegar
// tentativas feitas fora de um teste.
//
// Limites em docs/TESTES-REDE-BLOQUEADA.md.
const net = require('node:net');
const dns = require('node:dns');
const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const workerThreads = require('node:worker_threads');
const { syncBuiltinESMExports } = require('node:module');

const GUARD_KEY = Symbol.for('kapa.test.networkGuard');
const ALLOWLIST_ENV = 'KAPA_TEST_NETWORK_ALLOWLIST';
const LOG_ENV = 'KAPA_NETWORK_GUARD_LOG';
const BLOCKED_CODE = 'ENETWORKGUARD';
const BLOCKED_BINDINGS = new Set(['tcp_wrap', 'tls_wrap', 'udp_wrap', 'pipe_wrap', 'cares_wrap', 'js_stream']);
const ENTRY_PATTERN = /^(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})$/;
const DISPOSABLE_CONTAINER = /^supabase_(db|kong)_kapa-[a-z0-9-]+$/;

function parseAllowlist(raw) {
  const allowed = new Set();
  if (raw === undefined || raw === '') return allowed;
  for (const entry of String(raw).split(',').map((item) => item.trim())) {
    const match = ENTRY_PATTERN.exec(entry);
    if (!match || Number(match[2]) > 65535) {
      throw new Error(`${ALLOWLIST_ENV}: só aceita 127.0.0.1:<porta> ou [::1]:<porta>`);
    }
    allowed.add(entry);
  }
  return allowed;
}

function endpointKey(host, port) {
  return net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
}

function isEndpointAllowed(host, port, allowed) {
  return allowed.has(endpointKey(host, port));
}

// Só o acesso ao Postgres e a leitura de metadados de uma pilha local descartável.
// Shell nunca: uma linha de comando poderia fazer qualquer coisa.
function isCommandAllowed(file, args, env = process.env) {
  const name = path.basename(String(file)).toLowerCase().replace(/\.(exe|cmd)$/, '');
  if (name !== 'docker' || !Array.isArray(args)) return false;
  if (args[0] === 'exec') {
    // Banco do CRM (META_LOCAL_DB_CONTAINER) ou, no ponta a ponta KAPA Leads → CRM, o banco
    // descartável do KAPA Leads (KL_E2E_DB_CONTAINER). Os dois precisam ser pilhas kapa-* locais.
    const target = args[2];
    const declared = target === env.META_LOCAL_DB_CONTAINER || (Boolean(env.KL_E2E_DB_CONTAINER) && target === env.KL_E2E_DB_CONTAINER);
    return args[1] === '-i' && args[3] === 'psql' && declared && DISPOSABLE_CONTAINER.test(String(target));
  }
  if (args[0] === 'inspect') {
    return args.length === 2 && DISPOSABLE_CONTAINER.test(String(args[1]));
  }
  return false;
}

// Formatos aceitos por net.Socket.prototype.connect, inclusive o array normalizado
// usado internamente por net.connect e tls.connect.
function readConnectTarget(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === 'object') {
    if (first.path !== undefined) return { path: String(first.path) };
    return { host: first.host ?? 'localhost', port: first.port };
  }
  if (typeof first === 'string' && !/^[0-9]+$/.test(first)) return { path: first };
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

function createState(scope) {
  return {
    scope,
    allowed: parseAllowlist(process.env[ALLOWLIST_ENV]),
    violations: [],
    expected: [],
    expecting: 0,
    logPath: process.env[LOG_ENV],
  };
}

function blockedError(mechanism, target) {
  const error = new Error(`rede bloqueada nos testes: ${mechanism} para ${target}`);
  error.code = BLOCKED_CODE;
  return error;
}

function record(state, mechanism, target) {
  const entry = { mechanism, target, pid: process.pid };
  if (state.expecting > 0) {
    state.expected.push(entry);
  } else {
    state.violations.push(entry);
    if (state.logPath) {
      try {
        fs.appendFileSync(state.logPath, `${JSON.stringify(entry)}\n`);
      } catch {
        // A violação continua na memória do worker e reprova o teste.
      }
    }
  }
  return blockedError(mechanism, target);
}

function lockMethod(owner, name, value) {
  Object.defineProperty(owner, name, { value, writable: false, configurable: false, enumerable: false });
}

function guardSockets(state) {
  const original = net.Socket.prototype.connect;
  lockMethod(net.Socket.prototype, 'connect', function guardedConnect(...args) {
    const target = readConnectTarget(args);
    if (target.path === undefined && isEndpointAllowed(target.host, target.port, state.allowed)) {
      return original.apply(this, args);
    }
    const label = target.path !== undefined ? 'pipe' : endpointKey(target.host, target.port);
    const error = record(state, 'socket', label);
    process.nextTick(() => this.destroy(error));
    return this;
  });
}

function guardDns(state) {
  const names = ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname',
    'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
  const passes = (host) => host === 'localhost' || net.isIP(String(host)) !== 0;

  const patch = (owner, promised) => {
    for (const name of names) {
      const original = owner[name];
      if (typeof original !== 'function') continue;
      owner[name] = function guardedDns(...args) {
        if (name.startsWith('lookup') && passes(args[0])) return original.apply(this, args);
        const error = record(state, 'dns', String(args[0]).slice(0, 80));
        if (promised) return Promise.reject(error);
        const callback = args[args.length - 1];
        if (typeof callback === 'function') {
          process.nextTick(callback, error);
          return undefined;
        }
        throw error;
      };
    }
  };
  patch(dns, false);
  patch(dns.promises, true);
  patch(dns.Resolver.prototype, false);
  patch(dns.promises.Resolver.prototype, true);
}

function guardDatagrams(state) {
  for (const name of ['send', 'connect']) {
    lockMethod(dgram.Socket.prototype, name, function guardedDatagram(...args) {
      const error = record(state, 'udp', name);
      const callback = args[args.length - 1];
      if (typeof callback === 'function') process.nextTick(callback, error);
      else process.nextTick(() => this.emit('error', error));
    });
  }
}

function guardRawBindings(state) {
  const original = process.binding;
  process.binding = function guardedBinding(name) {
    if (BLOCKED_BINDINGS.has(name)) throw record(state, 'binding', name);
    return original.call(this, name);
  };
}

function guardChildProcesses(state) {
  const refuse = (file) => record(state, 'child_process', path.basename(String(file)).slice(0, 40));

  const originalSpawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function guardedSpawn(options) {
    if (options?.shell || !isCommandAllowed(options?.file, (options?.args ?? []).slice(1))) throw refuse(options?.file);
    return originalSpawn.call(this, options);
  };

  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function guardedSpawnSync(file, args, options) {
    if (options?.shell || !isCommandAllowed(file, args)) throw refuse(file);
    return originalSpawnSync.call(this, file, args, options);
  };

  const originalExecFileSync = childProcess.execFileSync;
  childProcess.execFileSync = function guardedExecFileSync(file, args, options) {
    if (options?.shell || !isCommandAllowed(file, args)) throw refuse(file);
    return originalExecFileSync.call(this, file, args, options);
  };

  childProcess.execSync = function guardedExecSync(command) {
    throw refuse(String(command).split(' ')[0]);
  };
}

// Worker próprio de um teste não passa por aqui: bloqueado. O pool usa processos.
function guardWorkerThreads(state) {
  workerThreads.Worker = class BlockedWorker {
    constructor() {
      throw record(state, 'worker_thread', 'novo worker');
    }
  };
}

function install({ scope }) {
  if (globalThis[GUARD_KEY]) return globalThis[GUARD_KEY];
  const state = createState(scope);

  guardSockets(state);
  guardDns(state);
  guardDatagrams(state);
  guardRawBindings(state);
  // O processo principal do Vitest precisa criar os workers.
  if (scope === 'worker') {
    guardChildProcesses(state);
    guardWorkerThreads(state);
  }
  // Mantém `import { execFileSync } from 'node:child_process'` no valor protegido.
  syncBuiltinESMExports();

  const api = Object.freeze({
    scope,
    allowedEndpoints: () => [...state.allowed],
    // Só para os testes do próprio guarda: a tentativa continua bloqueada, mas não reprova.
    async captureExpected(attempt) {
      state.expecting += 1;
      try {
        await attempt();
      } finally {
        state.expecting -= 1;
      }
      return state.expected.splice(0);
    },
    assertClean(context) {
      const found = state.violations.splice(0);
      if (found.length === 0) return;
      const summary = found.map((item) => `${item.mechanism} ${item.target}`).join('; ');
      const error = new Error(`Tentativa de rede proibida em ${context}: ${summary}`);
      error.code = BLOCKED_CODE;
      throw error;
    },
  });
  Object.defineProperty(globalThis, GUARD_KEY, { value: api, writable: false, configurable: false, enumerable: false });
  return api;
}

module.exports = { install, parseAllowlist, isEndpointAllowed, isCommandAllowed, readConnectTarget, GUARD_KEY, LOG_ENV, BLOCKED_CODE };
