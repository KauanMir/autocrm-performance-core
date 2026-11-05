// tests/api/integrations/whatsapp/inbox.test.ts — W2B-8. Rotas GET da inbox: acesso,
// isolamento, flag, falhas e ausência de vazamento. Auth e RPC mockados, envelopes
// reais com chave fictícia. Sem rede e sem banco.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedActor: vi.fn(),
  adminRpc: vi.fn(),
}));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...actual, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});
vi.mock('@/lib/server/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: mocks.adminRpc }),
}));

import * as conversationsRoute from '@/app/api/integrations/whatsapp/inbox/conversations/route';
import * as messagesRoute from '@/app/api/integrations/whatsapp/inbox/conversations/[conversationId]/messages/route';
import { META_TEST_COMPANY_ID } from '@/lib/server/meta-oauth/config';
import {
  encryptWhatsAppContactPii,
  encryptWhatsAppMessageContent,
} from '@/lib/server/whatsapp-connection/capture-crypto';

const ENDPOINT = 'https://crm.example.test/api/integrations/whatsapp/inbox/conversations';
const OTHER_COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555';
const PII_REF = '66666666-6666-4666-8666-666666666666';
const ACTOR_ID = '77777777-7777-4777-8777-777777777777';
const HASH = 'a'.repeat(64);
const CONTENT_KEY_HEX = 'cd'.repeat(32);
const KEY = Buffer.from(CONTENT_KEY_HEX, 'hex');
const PHONE = '5511900009876';
const BSUID = 'BR.FICTICIO000000001';
const WAMID = 'wamid.FICTICIO-ROTA';
const NAME = 'Cliente Fictício da Rota';
const TEXT = 'Texto fictício sigiloso da rota';
const OCCURRED_AT = '2026-11-05T10:00:00.123456+00:00';
const RECEIVED_AT = '2026-11-05T10:00:01.654321+00:00';

const piiCiphertext = () =>
  encryptWhatsAppContactPii({
    companyId: META_TEST_COMPANY_ID,
    piiRef: PII_REF,
    contact: { phone: PHONE, bsuid: BSUID, parentBsuid: null, displayName: NAME },
    key: KEY,
  });

const contentCiphertext = (content: unknown = { kind: 'text', text: TEXT, truncated: false }) =>
  encryptWhatsAppMessageContent({
    companyId: META_TEST_COMPANY_ID,
    connectionId: CONNECTION_ID,
    messageIdHash: HASH,
    payload: { wamid: WAMID, content: content as never, repliedToWamid: null },
    key: KEY,
  });

function conversationRow(over: Record<string, unknown> = {}) {
  return {
    out_conversation_id: CONVERSATION_ID,
    out_last_message_at: OCCURRED_AT,
    out_message_count: 3,
    out_pii_ciphertext: piiCiphertext(),
    out_pii_ref: PII_REF,
    out_pii_key_version: 1,
    out_last_connection_id: CONNECTION_ID,
    out_last_message_type: 'text',
    out_last_message_id_hash: HASH,
    out_last_content_ciphertext: contentCiphertext(),
    out_last_content_key_version: 1,
    ...over,
  };
}

function messageRow(over: Record<string, unknown> = {}) {
  return {
    out_message_id: MESSAGE_ID,
    out_connection_id: CONNECTION_ID,
    out_message_type: 'text',
    out_message_id_hash: HASH,
    out_content_ciphertext: contentCiphertext(),
    out_content_key_version: 1,
    out_occurred_at: OCCURRED_AT,
    out_received_at: RECEIVED_AT,
    ...over,
  };
}

function actor(opts: { isSuperAdmin?: unknown; err?: unknown } = {}) {
  return {
    ok: true as const,
    actor: { profileId: ACTOR_ID },
    jwt: 'fake.jwt',
    client: {
      rpc: vi.fn(async () => ({ data: 'isSuperAdmin' in opts ? opts.isSuperAdmin : true, error: opts.err ?? null })),
    },
  };
}

const listUrl = (query = `?company_id=${META_TEST_COMPANY_ID}`) => `${ENDPOINT}${query}`;
const threadUrl = (query = `?company_id=${META_TEST_COMPANY_ID}`, id = CONVERSATION_ID) => `${ENDPOINT}/${id}/messages${query}`;
const getList = (query?: string) => conversationsRoute.GET(new Request(listUrl(query)));
const getThread = (query?: string, id = CONVERSATION_ID) =>
  messagesRoute.GET(new Request(threadUrl(query, id)), { params: { conversationId: id } });

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('WHATSAPP_INBOX_READ_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', CONTENT_KEY_HEX);
  mocks.requireAuthenticatedActor.mockResolvedValue(actor());
  mocks.adminRpc.mockImplementation(async (name: string) => {
    if (name === 'whatsapp_inbox_list_conversations') return { data: [conversationRow()], error: null };
    if (name === 'whatsapp_inbox_list_messages') return { data: [messageRow()], error: null };
    throw new Error(`unexpected rpc: ${name}`);
  });
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.requireAuthenticatedActor.mockReset();
  mocks.adminRpc.mockReset();
});

const logs = () => [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join('\n');

describe.each([
  ['conversas', () => getList()],
  ['mensagens', () => getThread()],
])('acesso às %s', (_label, call) => {
  it('não autenticado → 401, sem RPC', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue({ ok: false });
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'unauthenticated' });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['Manager', false],
    ['Seller', false],
    ['perfil inativo', null],
    ['resposta não booleana', 'true'],
  ])('%s → 403, sem RPC', async (_role, isSuperAdmin) => {
    mocks.requireAuthenticatedActor.mockResolvedValue(actor({ isSuperAdmin }));
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden' });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('falha ao checar permissão → 500 sem detalhe, sem RPC', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(actor({ isSuperAdmin: null, err: { message: 'db detail secret' } }));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('db detail secret');
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it.each([['ausente', undefined], ['false', 'false'], ['TRUE', 'TRUE'], ['1', '1']])(
    'flag de servidor %s → 503 inbox_disabled, sem RPC',
    async (_case, value) => {
      vi.stubEnv('WHATSAPP_INBOX_READ_ENABLED', value as unknown as string);
      const res = await call();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'inbox_disabled' });
      expect(mocks.adminRpc).not.toHaveBeenCalled();
    },
  );

  it('a permissão vem do client do usuário, e o ator vai para a RPC', async () => {
    const current = actor();
    mocks.requireAuthenticatedActor.mockResolvedValue(current);
    await call();
    expect(current.client.rpc).toHaveBeenCalledWith('is_platform_super_admin');
    expect(mocks.adminRpc.mock.calls[0][1]).toMatchObject({ p_actor_profile_id: ACTOR_ID, p_company_id: META_TEST_COMPANY_ID });
  });

  it('banco recusa o ator → 403, mesmo com a rota aprovando', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const res = await call();
    expect(res.status).toBe(403);
  });

  it.each([
    ['erro da RPC', { data: null, error: { code: 'XX000', message: 'rpc detail secret' } }],
    ['RPC ainda não aplicada', { data: null, error: { code: 'PGRST202', message: 'function not found' } }],
    ['resposta fora do contrato', { data: [{ out_conversation_id: 'x' }, { out_message_id: 'x' }], error: null }],
    ['resposta que não é lista', { data: {}, error: null }],
  ])('%s → 503 inbox_unavailable, sem detalhe', async (_case, response) => {
    mocks.adminRpc.mockResolvedValue(response);
    const res = await call();
    const body = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ ok: false, error: 'inbox_unavailable' });
    expect(`${body}${logs()}`).not.toContain('rpc detail secret');
  });

  it('exceção na RPC → 503 sem detalhe', async () => {
    mocks.adminRpc.mockRejectedValue(new Error('rpc detail secret'));
    const res = await call();
    expect(res.status).toBe(503);
    expect(`${await res.text()}${logs()}`).not.toContain('rpc detail secret');
  });

  it('chave de conteúdo inválida → 503, sem expor a variável', async () => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'curta');
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'inbox_unavailable' });
  });

  it('não usa rede externa', async () => {
    await call();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('isolamento por empresa', () => {
  it.each([
    ['sem company_id', ''],
    ['company_id inválido', '?company_id=nao-e-uuid'],
  ])('%s → 400, sem RPC', async (_case, query) => {
    for (const res of [await getList(query), await getThread(query)]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'invalid_request' });
    }
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('Super Admin pedindo outra empresa → 403, sem RPC', async () => {
    for (const res of [await getList(`?company_id=${OTHER_COMPANY_ID}`), await getThread(`?company_id=${OTHER_COMPANY_ID}`)]) {
      expect(res.status).toBe(403);
    }
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it('TEST COMPANY em maiúsculas é aceita e normalizada', async () => {
    const res = await getList(`?company_id=${META_TEST_COMPANY_ID.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(mocks.adminRpc.mock.calls[0][1]).toMatchObject({ p_company_id: META_TEST_COMPANY_ID });
  });

  it('conversa de outra empresa ou inexistente → 404 igual', async () => {
    mocks.adminRpc.mockResolvedValue({ data: null, error: { message: 'conversation_not_found' } });
    const res = await getThread();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'conversation_not_found' });
  });

  it('ID de conversa inválido → 400, sem RPC', async () => {
    const res = await getThread(undefined, 'nao-e-uuid');
    expect(res.status).toBe(400);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe('conteúdo devolvido', () => {
  it('conversa traz só o DTO fechado', async () => {
    const res = await getList();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      conversations: [{
        id: CONVERSATION_ID,
        contact: { displayName: NAME, phoneMasked: '+55 ••••• 9876', readable: true },
        lastMessageAt: '2026-11-05T10:00:00.123Z',
        messageCount: 3,
        preview: { kind: 'text', text: TEXT, truncated: false },
      }],
      nextCursor: null,
    });
  });

  it('mensagens vêm em ordem cronológica', async () => {
    const rows = [
      messageRow({ out_message_id: '55555555-5555-4555-8555-000000000002', out_occurred_at: '2026-11-05T11:00:00+00:00' }),
      messageRow({ out_message_id: '55555555-5555-4555-8555-000000000001', out_occurred_at: '2026-11-05T10:00:00+00:00' }),
    ];
    mocks.adminRpc.mockResolvedValue({ data: rows, error: null });
    const body = await (await getThread()).json();
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual([
      '55555555-5555-4555-8555-000000000001',
      '55555555-5555-4555-8555-000000000002',
    ]);
  });

  it('mídia, tipo não suportado e ilegível continuam distintos', async () => {
    mocks.adminRpc.mockResolvedValue({
      data: [
        messageRow({ out_content_ciphertext: 'v1.corrompido.a.b' }),
        messageRow({ out_message_type: 'location', out_content_ciphertext: contentCiphertext({ kind: 'unsupported' }) }),
        messageRow({
          out_message_type: 'image',
          out_content_ciphertext: contentCiphertext({
            kind: 'media', mediaType: 'image', mediaId: 'MIDIA-FICTICIA', mimeType: 'image/jpeg', sha256: 'SHA-FICTICIO', caption: 'Legenda', fileName: null,
          }),
        }),
      ],
      error: null,
    });
    const text = await (await getThread()).text();
    expect(JSON.parse(text).messages.map((m: { body: unknown }) => m.body)).toEqual([
      { kind: 'media', mediaType: 'image', caption: 'Legenda', fileName: null },
      { kind: 'unsupported', messageType: 'location' },
      { kind: 'unreadable' },
    ]);
    expect(text).not.toContain('MIDIA-FICTICIA');
    expect(text).not.toContain('SHA-FICTICIO');
  });

  it('versão de chave desconhecida vira ilegível', async () => {
    mocks.adminRpc.mockResolvedValue({ data: [messageRow({ out_content_key_version: 2 })], error: null });
    const body = await (await getThread()).json();
    expect(body.messages[0].body).toEqual({ kind: 'unreadable' });
  });

  it('lista vazia não exige a chave', async () => {
    vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', '');
    mocks.adminRpc.mockResolvedValue({ data: [], error: null });
    const res = await getList();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, conversations: [], nextCursor: null });
  });
});

describe('paginação', () => {
  it('pede uma linha a mais e devolve cursor quando há próxima página', async () => {
    const rows = Array.from({ length: 31 }, () => conversationRow());
    mocks.adminRpc.mockResolvedValue({ data: rows, error: null });
    const body = await (await getList()).json();
    expect(mocks.adminRpc.mock.calls[0][1]).toMatchObject({ p_limit: 31 });
    expect(body.conversations).toHaveLength(30);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it('o cursor de mensagens preserva microssegundos na ida e na volta', async () => {
    const rows = Array.from({ length: 51 }, () => messageRow());
    mocks.adminRpc.mockResolvedValue({ data: rows, error: null });
    const { nextCursor } = await (await getThread()).json();
    await getThread(`?company_id=${META_TEST_COMPANY_ID}&cursor=${nextCursor}`);
    expect(mocks.adminRpc.mock.calls[1][1]).toMatchObject({
      p_before_occurred_at: OCCURRED_AT,
      p_before_received_at: RECEIVED_AT,
      p_before_id: MESSAGE_ID,
    });
  });

  it.each(['%%%', 'abc', 'x'.repeat(300), Buffer.from('["a","b"]').toString('base64url')])(
    'cursor inválido %s → 400, sem RPC',
    async (cursor) => {
      const res = await getList(`?company_id=${META_TEST_COMPANY_ID}&cursor=${encodeURIComponent(cursor)}`);
      expect(res.status).toBe(400);
      expect(mocks.adminRpc).not.toHaveBeenCalled();
    },
  );
});

describe('ausência de vazamento', () => {
  const secrets = () => [
    PHONE, BSUID, WAMID, HASH, CONTENT_KEY_HEX, PII_REF, CONNECTION_ID, 'fake.jwt',
    'whatsapp_inbox_list', 'v1.',
  ];

  it('a resposta não traz ciphertext, hash, wamid, BSUID, telefone ou chave', async () => {
    const list = await (await getList()).text();
    const thread = await (await getThread()).text();
    for (const secret of secrets()) {
      expect(`${list}\n${thread}`).not.toContain(secret);
    }
  });

  it('o log não traz conteúdo, nome, IDs nem dados do contato', async () => {
    await getList();
    await getThread();
    const output = logs();
    for (const secret of [...secrets(), NAME, TEXT, CONVERSATION_ID, MESSAGE_ID, META_TEST_COMPANY_ID, ACTOR_ID]) {
      expect(output).not.toContain(secret);
    }
  });

  it('o log traz só as chaves permitidas', async () => {
    await getList();
    const [, payload] = logSpy.mock.calls.find((call) => call[0] === '[whatsapp-inbox]') as [string, string];
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual(['durationMs', 'operation', 'requestId', 'result', 'returned', 'unreadable']);
  });

  it('as rotas só exportam GET', () => {
    for (const route of [conversationsRoute, messagesRoute]) {
      expect(Object.keys(route).filter((key) => /^(POST|PUT|PATCH|DELETE)$/.test(key))).toEqual([]);
    }
  });

  it('o código da inbox não envia mensagens nem chama a Graph, e o cliente não importa servidor', () => {
    const root = process.cwd();
    for (const file of [
      'app/api/integrations/whatsapp/inbox/conversations/route.ts',
      'app/api/integrations/whatsapp/inbox/conversations/[conversationId]/messages/route.ts',
      'lib/server/whatsapp-inbox/inbox-rpc.ts',
      'lib/server/whatsapp-inbox/inbox-view.ts',
    ]) {
      expect(readFileSync(resolve(root, file), 'utf8')).not.toMatch(/graph\.facebook|set_capture|message_capture|\.from\('/);
    }
    for (const file of [
      'lib/integrations/whatsappInboxRequest.ts',
      'lib/hooks/useWhatsAppInbox.ts',
      'components/whatsappInbox/ScreenConversas.tsx',
      'components/whatsappInbox/ConversationThread.tsx',
      'components/whatsappInbox/ConversationList.tsx',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/lib\/server|dangerouslySetInnerHTML|localStorage/);
    }
  });
});
