// @vitest-environment node
// Prova da trava de banco local. Toda configuração inválida é recusada pela leitura dos
// valores: nada conecta aos destinos, e o inspect do Docker é um fake.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertDisposableLocalDatabase,
  UnsafeDatabaseError,
  type ContainerFacts,
  type LocalDatabaseConfig,
} from '@/tests/helpers/localDatabaseGuard';

const jwt = (claims: Record<string, unknown>) =>
  ['cabecalho', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'assinatura'].join('.');

const PROJECT = 'kapa-teste-sbx';
const VALID: LocalDatabaseConfig = {
  url: 'http://127.0.0.1:57321',
  serviceRoleKey: jwt({ iss: 'supabase-demo', role: 'service_role' }),
  anonKey: jwt({ iss: 'supabase-demo', role: 'anon' }),
  container: `supabase_db_${PROJECT}`,
};
const STACK: ContainerFacts = { project: PROJECT, published: [{ hostIp: '127.0.0.1', hostPort: '57321' }] };
const stack = () => vi.fn((): ContainerFacts | null => STACK);

function reason(config: Partial<LocalDatabaseConfig>, inspect: () => ContainerFacts | null = stack()): string | null {
  try {
    assertDisposableLocalDatabase({ ...VALID, ...config }, inspect);
    return null;
  } catch (error) {
    if (error instanceof UnsafeDatabaseError) return error.reason;
    throw error;
  }
}

describe('configuração válida', () => {
  it('pilha local descartável passa', () => {
    expect(reason({})).toBeNull();
  });

  it('confere o contêiner do banco e o gateway que publica a porta', () => {
    const inspect = stack();
    assertDisposableLocalDatabase(VALID, inspect);
    expect(inspect.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([`supabase_db_${PROJECT}`, `supabase_kong_${PROJECT}`]);
  });
});

describe('URL', () => {
  it.each([
    ['ausente', undefined, 'url_ausente'],
    ['vazia', '', 'url_ausente'],
    ['inválida', 'nao-e-url', 'url_invalida'],
    ['Supabase remoto', 'https://projeto-ficticio.supabase.co', 'url_nao_http'],
    ['Supabase remoto em http', 'http://projeto-ficticio.supabase.co', 'host_nao_loopback'],
    ['host externo', 'http://db.example.invalid:54321', 'host_nao_loopback'],
    ['rede privada', 'http://192.168.0.10:54321', 'host_nao_loopback'],
    ['0.0.0.0', 'http://0.0.0.0:54321', 'host_nao_loopback'],
    ['localhost, que depende de resolução', 'http://localhost:54321', 'host_nao_loopback'],
    ['nome que imita loopback', 'http://127.0.0.1.example.invalid:54321', 'host_nao_loopback'],
    ['credencial que disfarça o host', 'http://127.0.0.1:x@example.invalid', 'url_com_credencial'],
    ['credencial em loopback', 'http://user:senha@127.0.0.1:54321', 'url_com_credencial'],
    ['sem porta', 'http://127.0.0.1', 'url_sem_porta'],
  ])('%s é recusada', (_label, url, expected) => {
    const inspect = stack();
    expect(reason({ url }, inspect)).toBe(expected);
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe('chaves', () => {
  it.each([
    ['chave de projeto remoto, com ref', jwt({ iss: 'supabase', ref: 'projeto-ficticio', role: 'service_role' })],
    ['emissor de demonstração com ref', jwt({ iss: 'supabase-demo', ref: 'projeto-ficticio', role: 'service_role' })],
    ['emissor desconhecido', jwt({ iss: 'outro', role: 'service_role' })],
    ['papel errado', jwt({ iss: 'supabase-demo', role: 'anon' })],
    ['formato opaco', 'sb_secret_valor-ficticio'],
    ['token malformado', 'a.b.c'],
    ['ausente', undefined],
  ])('service_role: %s é recusada', (_label, serviceRoleKey) => {
    expect(reason({ serviceRoleKey })).toBe('chave_service_role_nao_local');
  });

  it('anon de projeto remoto é recusada', () => {
    expect(reason({ anonKey: jwt({ iss: 'supabase', ref: 'projeto-ficticio', role: 'anon' }) })).toBe('chave_anon_nao_local');
  });
});

describe('contêiner', () => {
  it.each([
    ['ausente', undefined],
    ['nome padrão do projeto, cujo volume não é descartável', 'supabase_db_autocrm-performance-core'],
    ['outro contêiner', 'postgres'],
    ['nome com sufixo', 'supabase_db_kapa-teste; rm'],
  ])('%s é recusado', (_label, container) => {
    expect(reason({ container })).toBe('conteiner_nao_descartavel');
  });

  it('contêiner que não existe é recusado', () => {
    expect(reason({}, () => null)).toBe('conteiner_do_banco_nao_confirmado');
  });

  it('nome forjado: a etiqueta do contêiner aponta outro projeto', () => {
    expect(reason({}, () => ({ project: 'autocrm-performance-core', published: STACK.published }))).toBe('conteiner_do_banco_nao_confirmado');
  });

  it('gateway da pilha ausente é recusado', () => {
    const inspect = vi.fn().mockReturnValueOnce(STACK).mockReturnValueOnce(null);
    expect(reason({}, inspect)).toBe('gateway_nao_confirmado');
  });
});

describe('a porta da URL precisa ser desta pilha', () => {
  it('URL local apontando para outro serviço é recusada', () => {
    expect(reason({ url: 'http://127.0.0.1:54321' })).toBe('porta_da_url_nao_e_desta_pilha');
  });

  it('porta publicada em interface externa não prova nada', () => {
    expect(reason({}, () => ({ project: PROJECT, published: [{ hostIp: '10.0.0.5', hostPort: '57321' }] }))).toBe('porta_da_url_nao_e_desta_pilha');
  });
});

describe('só uma flag não basta', () => {
  it('a flag ligada com ambiente vazio é recusada', () => {
    vi.stubEnv('META_P4B5_LOCAL', '1');
    expect(reason({ url: undefined, serviceRoleKey: undefined, anonKey: undefined, container: undefined })).toBe('url_ausente');
    vi.unstubAllEnvs();
  });

  it('o erro nunca traz o valor recusado', () => {
    const secret = jwt({ iss: 'supabase', ref: 'projeto-ficticio', role: 'service_role' });
    try {
      assertDisposableLocalDatabase({ ...VALID, serviceRoleKey: secret }, stack());
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain('projeto-ficticio');
    }
  });
});

describe('connection-local.test.ts', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'tests/integration/meta/connection-local.test.ts'), 'utf8');

  it('prova o banco antes de criar o cliente e de qualquer escrita', () => {
    const start = source.indexOf('beforeAll(async () => {');
    const proof = source.indexOf('assertDisposableLocalDatabase();', start);
    const client = source.indexOf('createAdminClient()', start);
    const firstWrite = source.indexOf(".from('companies').insert", start);
    expect(proof).toBeGreaterThan(start);
    expect(proof).toBeLessThan(client);
    expect(client).toBeLessThan(firstWrite);
  });

  it('a limpeza não roda sem a prova', () => {
    const start = source.indexOf('afterAll(async () => {');
    const check = source.indexOf('if (!databaseProvenLocal) return;', start);
    expect(check).toBeGreaterThan(start);
    expect(check).toBeLessThan(source.indexOf('sql(', start));
  });

  it('não tem contêiner padrão', () => {
    expect(source).not.toContain('supabase_db_autocrm-performance-core');
  });
});
