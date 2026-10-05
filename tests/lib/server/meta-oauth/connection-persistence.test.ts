// META-P4A — camada de persistência Meta (sem callback). Tokens, chaves e
// ciphertexts são FAKE. Porta RPC injetada; nenhuma rede, nenhum banco.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findMetaConnectionOwnerByPage,
  persistMetaPageConnection,
  type MetaConnectionRpcPort,
  type PersistMetaPageConnectionInput,
  type UpsertRpcArgs,
  type UpsertRpcRow,
  type OwnerRpcRow,
} from '@/lib/server/meta-oauth/connection-persistence';
import { decryptMetaPageToken } from '@/lib/server/meta-oauth/token-crypto';

const FAKE_KEY_HEX = 'ab'.repeat(32);
const FAKE_KEY = Buffer.from(FAKE_KEY_HEX, 'hex');
const COMPANY = '0a0a0a0a-0000-4000-8000-00000000c0de';
const PAGE = '700000000000001';
const CONNECTED_BY = 'f7000000-0000-4000-8000-000000000001';
const FAKE_PAGE_TOKEN = 'FAKE-PAGE-TOKEN-persistence-test-only';
const REQUIRED = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'];
const CONNECTED_AT = new Date('2026-10-05T12:00:00.000Z');
const LEADGEN_AT = new Date('2026-10-05T12:00:01.000Z');

function validInput(over: Partial<PersistMetaPageConnectionInput> = {}): PersistMetaPageConnectionInput {
  return {
    companyId: COMPANY,
    pageId: PAGE,
    pageName: 'Pagina Teste Fake',
    pageAccessToken: FAKE_PAGE_TOKEN,
    grantedScopes: [...REQUIRED],
    connectedAt: CONNECTED_AT,
    connectedBy: CONNECTED_BY,
    leadgenSubscribedAt: LEADGEN_AT,
    ...over,
  };
}

function makeRow(over: Partial<UpsertRpcRow> = {}): UpsertRpcRow {
  return {
    id: 'a1000000-0000-4000-8000-000000000001',
    company_id: COMPANY,
    page_id: PAGE,
    page_name: 'Pagina Teste Fake',
    status: 'connected',
    connected_at: CONNECTED_AT.toISOString(),
    leadgen_subscribed_at: LEADGEN_AT.toISOString(),
    ...over,
  };
}

interface FakePort extends MetaConnectionRpcPort {
  upsertCalls: UpsertRpcArgs[];
  ownerCalls: string[];
}

function makePort(opts: {
  upsert?: () => Promise<{ data: UpsertRpcRow[] | null; error: { code?: string; message?: string } | null }>;
  owner?: () => Promise<{ data: OwnerRpcRow[] | null; error: { code?: string; message?: string } | null }>;
} = {}): FakePort {
  const upsertCalls: UpsertRpcArgs[] = [];
  const ownerCalls: string[] = [];
  return {
    upsertCalls,
    ownerCalls,
    upsert: async (args) => {
      upsertCalls.push(args);
      return opts.upsert ? opts.upsert() : { data: [makeRow()], error: null };
    },
    ownerByPage: async (pageId) => {
      ownerCalls.push(pageId);
      return opts.owner ? opts.owner() : { data: [], error: null };
    },
  };
}

const enabled = () => true;
const disabled = () => false;

let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', FAKE_KEY_HEX);
  vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'true');
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('flag de persistência — OFF impede qualquer toque no banco', () => {
  it('persistMetaPageConnection com flag OFF -> persistence_disabled, zero RPC', async () => {
    const port = makePort();
    const result = await persistMetaPageConnection({ rpc: port, isEnabled: disabled }, validInput());
    expect(result).toEqual({ ok: false, code: 'persistence_disabled' });
    expect(port.upsertCalls).toHaveLength(0);
  });

  it('findMetaConnectionOwnerByPage com flag OFF -> persistence_disabled, zero RPC', async () => {
    const port = makePort();
    const result = await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: disabled }, PAGE);
    expect(result).toEqual({ ok: false, code: 'persistence_disabled' });
    expect(port.ownerCalls).toHaveLength(0);
  });

  it('a flag real (env) é lida quando isEnabled não é injetado', async () => {
    vi.stubEnv('META_CONNECTION_PERSISTENCE_ENABLED', 'false');
    const port = makePort();
    const result = await persistMetaPageConnection({ rpc: port }, validInput());
    expect(result.ok).toBe(false);
    expect(port.upsertCalls).toHaveLength(0);
  });
});

describe('ownership metadata-only', () => {
  it('página conectada retorna company correta, só metadados', async () => {
    const port = makePort({
      owner: async () => ({
        data: [{ integration_id: 'a1000000-0000-4000-8000-000000000001', company_id: COMPANY, page_id: PAGE, status: 'connected' }],
        error: null,
      }),
    });
    const result = await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: enabled }, PAGE);
    expect(result).toEqual({
      ok: true,
      value: { integrationId: 'a1000000-0000-4000-8000-000000000001', companyId: COMPANY, pageId: PAGE, status: 'connected' },
    });
    expect(port.ownerCalls).toEqual([PAGE]);
  });

  it('disconnected/error não aparece: RPC vazio -> null', async () => {
    const port = makePort({ owner: async () => ({ data: [], error: null }) });
    expect(await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: enabled }, PAGE)).toEqual({ ok: true, value: null });
  });

  it('retorno nunca contém ciphertext, key version, scopes nem nome', async () => {
    const port = makePort({
      owner: async () => ({
        data: [{ integration_id: 'a1000000-0000-4000-8000-000000000001', company_id: COMPANY, page_id: PAGE, status: 'connected' }],
        error: null,
      }),
    });
    const result = await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: enabled }, PAGE);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/ciphertext|token_key_version|granted_scopes|page_name|v1\./);
    expect(result.ok && Object.keys(result.value ?? {}).sort()).toEqual(['companyId', 'integrationId', 'pageId', 'status']);
  });

  it('page_id inválido -> invalid_persistence_input sem RPC', async () => {
    const port = makePort();
    expect(await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: enabled }, '12a')).toEqual({ ok: false, code: 'invalid_persistence_input' });
    expect(port.ownerCalls).toHaveLength(0);
  });
});

describe('persistMetaPageConnection — fluxo feliz e conteúdo da RPC', () => {
  it('a RPC recebe ciphertext e NUNCA o plaintext', async () => {
    const port = makePort();
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    const serializedArgs = JSON.stringify(port.upsertCalls);
    expect(serializedArgs).not.toContain(FAKE_PAGE_TOKEN);
    expect(serializedArgs).not.toContain(FAKE_KEY_HEX);
    expect(port.upsertCalls[0].p_access_token_ciphertext).toMatch(/^v1\./);
  });

  it('o ciphertext decifra com a chave e o contexto corretos (company + page) e falha com contexto errado', async () => {
    const port = makePort();
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    const ciphertext = port.upsertCalls[0].p_access_token_ciphertext;
    expect(decryptMetaPageToken({ ciphertext, companyId: COMPANY, pageId: PAGE, key: FAKE_KEY })).toBe(FAKE_PAGE_TOKEN);
    expect(() =>
      decryptMetaPageToken({ ciphertext, companyId: '0b0b0b0b-0000-4000-8000-00000000c0de', pageId: PAGE, key: FAKE_KEY }),
    ).toThrow();
    expect(() => decryptMetaPageToken({ ciphertext, companyId: COMPANY, pageId: '700000000000002', key: FAKE_KEY })).toThrow();
  });

  it('token_key_version = 1 e envelope começa com v1', async () => {
    const port = makePort();
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    expect(port.upsertCalls[0].p_token_key_version).toBe(1);
    expect(port.upsertCalls[0].p_access_token_ciphertext.startsWith('v1.')).toBe(true);
  });

  it('as quatro permissões chegam à RPC (conjunto exato)', async () => {
    const port = makePort();
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput({ grantedScopes: [...REQUIRED].reverse() }));
    expect([...port.upsertCalls[0].p_granted_scopes].sort()).toEqual([...REQUIRED].sort());
    expect(port.upsertCalls[0].p_granted_scopes).toHaveLength(4);
  });

  it('connected_at, connected_by, company, page e page_name chegam como informados', async () => {
    const port = makePort();
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    const args = port.upsertCalls[0];
    expect(args.p_connected_at).toBe(CONNECTED_AT.toISOString());
    expect(args.p_connected_by).toBe(CONNECTED_BY);
    expect(args.p_company_id).toBe(COMPANY);
    expect(args.p_page_id).toBe(PAGE);
    expect(args.p_page_name).toBe('Pagina Teste Fake');
    expect(args.p_leadgen_subscribed_at).toBe(LEADGEN_AT.toISOString());
  });

  it('retorno contém somente metadados seguros, sem ciphertext, token ou chave', async () => {
    const port = makePort();
    const result = await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(
      ['companyId', 'connectedAt', 'id', 'leadgenSubscribedAt', 'pageId', 'pageName', 'status'].sort(),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FAKE_PAGE_TOKEN);
    expect(serialized).not.toContain(FAKE_KEY_HEX);
    expect(serialized).not.toMatch(/v1\./);
  });

  it('reconexão usa a mesma RPC (upsert) de novo, sem outra rota', async () => {
    const port = makePort();
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput({ pageAccessToken: 'FAKE-PAGE-TOKEN-second' }));
    expect(port.upsertCalls).toHaveLength(2);
  });
});

describe('mapeamento de erros — sanitizado, sem retry semântico', () => {
  it('page_already_connected é mapeado e não é repetido', async () => {
    const port = makePort({ upsert: async () => ({ data: null, error: { code: 'P0001', message: 'page_already_connected' } }) });
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput())).toEqual({ ok: false, code: 'page_already_connected' });
    expect(port.upsertCalls).toHaveLength(1);
  });

  it('invalid_input vindo do banco -> invalid_persistence_input, sem retry', async () => {
    const port = makePort({ upsert: async () => ({ data: null, error: { code: 'P0001', message: 'invalid_input' } }) });
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput())).toEqual({ ok: false, code: 'invalid_persistence_input' });
    expect(port.upsertCalls).toHaveLength(1);
  });

  it('erro SQL bruto (FK) é sanitizado: sem message/detail no resultado, sem retry', async () => {
    const port = makePort({
      upsert: async () => ({
        data: null,
        error: { code: '23503', message: 'insert or update violates foreign key DETAIL: Key (connected_by)=(f7000000-0000-4000-8000-000000000001) is not present' },
      }),
    });
    const result = await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    expect(result).toEqual({ ok: false, code: 'connection_persist_failed' });
    expect(JSON.stringify(result)).not.toMatch(/DETAIL|foreign key|Key \(/);
    expect(port.upsertCalls).toHaveLength(1);
  });

  it('função ausente no schema cache (PGRST202) -> persistence_unavailable, sem retry', async () => {
    const port = makePort({ upsert: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput())).toEqual({ ok: false, code: 'persistence_unavailable' });
    expect(port.upsertCalls).toHaveLength(1);
  });

  it('falha de transporte transitória: uma tentativa adicional e sucesso', async () => {
    let calls = 0;
    const port = makePort({
      upsert: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError('fetch failed');
        return { data: [makeRow()], error: null };
      },
    });
    const result = await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    expect(result.ok).toBe(true);
    expect(port.upsertCalls).toHaveLength(2);
  });

  it('falha de transporte persistente: no máximo duas tentativas -> persistence_unavailable', async () => {
    const port = makePort({ upsert: async () => { throw new TypeError('fetch failed'); } });
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput())).toEqual({ ok: false, code: 'persistence_unavailable' });
    expect(port.upsertCalls).toHaveLength(2);
  });

  it('falha de crypto (chave ausente) não chama upsert', async () => {
    vi.stubEnv('META_TOKEN_ENCRYPTION_KEY_V1', '');
    const port = makePort();
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput())).toEqual({ ok: false, code: 'token_encryption_failed' });
    expect(port.upsertCalls).toHaveLength(0);
  });

  it('retorno vazio inesperado do upsert -> connection_persist_failed', async () => {
    const port = makePort({ upsert: async () => ({ data: [], error: null }) });
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput())).toEqual({ ok: false, code: 'connection_persist_failed' });
  });
});

describe('validação de entrada — falha antes de cifrar e de chamar a RPC', () => {
  const bad: Array<[string, Partial<PersistMetaPageConnectionInput>]> = [
    ['company inválida', { companyId: 'not-a-uuid' }],
    ['page inválida', { pageId: '70000000000000a' }],
    ['page vazia', { pageId: '' }],
    ['token vazio', { pageAccessToken: '' }],
    ['nome vazio', { pageName: '' }],
    ['nome acima de 200', { pageName: 'x'.repeat(201) }],
    ['scope desconhecido', { grantedScopes: [...REQUIRED.slice(0, 3), 'ads_management'] }],
    ['subset (sem leads_retrieval)', { grantedScopes: REQUIRED.slice(0, 3) }],
    ['cinco entradas', { grantedScopes: [...REQUIRED, 'pages_show_list'] }],
    ['duplicata mascarando falta', { grantedScopes: ['pages_show_list', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'] }],
    ['connectedAt inválido', { connectedAt: new Date('nope') }],
    ['connectedBy não uuid', { connectedBy: 'browser-value' }],
    ['leadgen inválido', { leadgenSubscribedAt: new Date('nope') }],
  ];

  it.each(bad)('%s -> invalid_persistence_input, zero RPC', async (_label, over) => {
    const port = makePort();
    expect(await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput(over))).toEqual({
      ok: false,
      code: 'invalid_persistence_input',
    });
    expect(port.upsertCalls).toHaveLength(0);
  });
});

describe('logs e isolamento', () => {
  it('nenhum console.* é chamado em sucesso, retry ou falha', async () => {
    const port = makePort({ upsert: async () => ({ data: null, error: { code: 'P0001', message: 'page_already_connected' } }) });
    await persistMetaPageConnection({ rpc: port, isEnabled: enabled }, validInput());
    await findMetaConnectionOwnerByPage({ rpc: port, isEnabled: enabled }, PAGE);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('o callback OAuth ainda não importa a camada de persistência (P4A não altera o fluxo)', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'app/api/integrations/meta/oauth/callback/route.ts'), 'utf8');
    expect(source).not.toContain('connection-persistence');
    expect(source).not.toContain('meta_connection_');
  });
});
