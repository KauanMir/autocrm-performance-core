// tests/helpers/localDatabaseGuard.ts — prova de que um teste que ESCREVE no banco está
// numa pilha local descartável. Uma flag ligada não prova nada: esta função confere o
// endereço, as chaves e o contêiner Docker que publica a porta da URL. Não abre conexão
// com o Supabase; o único acesso é `docker inspect` na própria máquina.
import { execFileSync } from 'node:child_process';

const CONTAINER_PATTERN = /^supabase_db_(kapa-[a-z0-9-]+)$/;
const KONG_INTERNAL_PORT = '8000/tcp';
const LOCAL_KEY_ISSUER = 'supabase-demo';

export interface ContainerFacts {
  project: string | null;
  published: { hostIp: string; hostPort: string }[];
}

export type InspectContainer = (name: string) => ContainerFacts | null;

export interface LocalDatabaseConfig {
  url: string | undefined;
  serviceRoleKey: string | undefined;
  anonKey: string | undefined;
  container: string | undefined;
}

export class UnsafeDatabaseError extends Error {
  constructor(public readonly reason: string) {
    super(`banco não comprovadamente local: ${reason}`);
    this.name = 'UnsafeDatabaseError';
  }
}

export function inspectDockerContainer(name: string): ContainerFacts | null {
  try {
    const output = execFileSync('docker', ['inspect', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [info] = JSON.parse(output) as {
      Config?: { Labels?: Record<string, string> };
      NetworkSettings?: { Ports?: Record<string, { HostIp: string; HostPort: string }[] | null> };
    }[];
    return {
      project: info?.Config?.Labels?.['com.supabase.cli.project'] ?? null,
      published: (info?.NetworkSettings?.Ports?.[KONG_INTERNAL_PORT] ?? []).map((port) => ({ hostIp: port.HostIp, hostPort: port.HostPort })),
    };
  } catch {
    return null;
  }
}

function assertLocalUrl(raw: string | undefined): URL {
  if (!raw) throw new UnsafeDatabaseError('url_ausente');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeDatabaseError('url_invalida');
  }
  if (url.protocol !== 'http:') throw new UnsafeDatabaseError('url_nao_http');
  if (url.username !== '' || url.password !== '') throw new UnsafeDatabaseError('url_com_credencial');
  if (url.hostname !== '127.0.0.1') throw new UnsafeDatabaseError('host_nao_loopback');
  if (url.port === '') throw new UnsafeDatabaseError('url_sem_porta');
  return url;
}

// Chave de projeto remoto traz `ref` e emissor `supabase`; a pilha local usa o emissor
// de demonstração da CLI. Formato opaco (sb_*) não permite provar a origem: recusado.
function assertLocalKey(key: string | undefined, role: string, reason: string): void {
  const parts = (key ?? '').split('.');
  if (parts.length !== 3) throw new UnsafeDatabaseError(reason);
  let claims: { iss?: unknown; ref?: unknown; role?: unknown };
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new UnsafeDatabaseError(reason);
  }
  if (claims.iss !== LOCAL_KEY_ISSUER || claims.ref !== undefined || claims.role !== role) {
    throw new UnsafeDatabaseError(reason);
  }
}

export function assertDisposableLocalDatabase(
  config: LocalDatabaseConfig = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    container: process.env.META_LOCAL_DB_CONTAINER,
  },
  inspect: InspectContainer = inspectDockerContainer,
): void {
  const url = assertLocalUrl(config.url);
  assertLocalKey(config.serviceRoleKey, 'service_role', 'chave_service_role_nao_local');
  assertLocalKey(config.anonKey, 'anon', 'chave_anon_nao_local');

  const match = CONTAINER_PATTERN.exec(config.container ?? '');
  if (!match) throw new UnsafeDatabaseError('conteiner_nao_descartavel');
  const project = match[1];

  const database = inspect(config.container as string);
  if (database?.project !== project) throw new UnsafeDatabaseError('conteiner_do_banco_nao_confirmado');

  const gateway = inspect(`supabase_kong_${project}`);
  if (gateway?.project !== project) throw new UnsafeDatabaseError('gateway_nao_confirmado');
  const published = gateway.published.some((port) => port.hostPort === url.port && ['127.0.0.1', '0.0.0.0', ''].includes(port.hostIp));
  if (!published) throw new UnsafeDatabaseError('porta_da_url_nao_e_desta_pilha');
}
