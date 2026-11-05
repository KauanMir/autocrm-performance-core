// @vitest-environment node
// tests/integration/whatsapp/inbox-read.pglite.test.ts — W2B-8. Caminho completo com
// Postgres real em memória: webhook real grava envelopes reais, e as rotas da inbox
// leem pelas RPCs reais, decifram e devolvem o DTO. Só dados fictícios, sem rede.
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireAuthenticatedActor: vi.fn() }));

vi.mock('@/lib/server/invites/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/invites/http')>();
  return { ...actual, requireAuthenticatedActor: mocks.requireAuthenticatedActor };
});

import { GET as listConversations } from '@/app/api/integrations/whatsapp/inbox/conversations/route';
import { GET as listMessages } from '@/app/api/integrations/whatsapp/inbox/conversations/[conversationId]/messages/route';
import { POST as webhook } from '@/app/api/webhooks/whatsapp/route';
import { createPostgrestBridge, createWhatsAppTestDatabase, type WhatsAppTestDatabase } from './support/pglite-database';

const TEST_COMPANY = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const DEALER = 'fa7eeeee-2222-4222-8222-222222222222';
const CONNECTION = 'fa7a0000-0000-4000-8000-00000000000a';
const DEALER_CONNECTION = 'fa7a0000-0000-4000-8000-00000000000b';
const SUPER_ADMIN = 'fa700000-0000-4000-8000-000000000001';
const COMMON_USER = 'fa700000-0000-4000-8000-000000000002';
const WABA = '710000000000071';
const PHONE_ID = '810000000000071';
const APP_SECRET = 'fake-app-secret-inbox';
const CUSTOMER = '5511900001234';
const BSUID = 'BR.1349120865530270000';
const NAME = 'Cliente Fictício Integração';
const TEXT = 'Texto fictício do cliente ✅';
const WAMID = 'wamid.FICTICIO-INBOX-0001';
const ENDPOINT = 'https://crm.example.test/api/integrations/whatsapp/inbox/conversations';

let database: WhatsAppTestDatabase;

function actor(profileId: string, isSuperAdmin: boolean) {
  return {
    ok: true as const,
    actor: { profileId },
    jwt: 'fake.jwt',
    client: { rpc: vi.fn(async () => ({ data: isSuperAdmin, error: null })) },
  };
}

async function deliver(messages: unknown[]): Promise<void> {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: WABA,
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_ID },
          contacts: [{ profile: { name: NAME }, wa_id: CUSTOMER, user_id: BSUID }],
          messages,
        },
      }],
    }],
  });
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw, 'utf8').digest('hex')}`;
  const response = await webhook(new Request('https://crm.example.test/api/webhooks/whatsapp', {
    method: 'POST',
    body: raw,
    headers: { 'X-Hub-Signature-256': signature },
  }));
  expect(response.status).toBe(200);
}

const textMessage = (id: string, timestamp: string, body = TEXT) => ({
  from: CUSTOMER, from_user_id: BSUID, id, timestamp, type: 'text', text: { body },
});

async function getConversations(company = TEST_COMPANY) {
  return listConversations(new Request(`${ENDPOINT}?company_id=${company}`));
}

async function getMessages(conversationId: string, query = `company_id=${TEST_COMPANY}`) {
  return listMessages(new Request(`${ENDPOINT}/${conversationId}/messages?${query}`), { params: { conversationId } });
}

beforeAll(async () => {
  database = await createWhatsAppTestDatabase();
}, 240_000);

afterAll(async () => {
  await database.db.close();
});

beforeEach(async () => {
  await database.clearWhatsAppData();
  await database.db.exec(`
    insert into public.companies (id, name, status) values
      ('${TEST_COMPANY}', 'TEST COMPANY', 'ativa'), ('${DEALER}', 'Concessionária simulada', 'ativa');
    insert into auth.users (id, email) values
      ('${SUPER_ADMIN}', 'sa@ficticio.test'), ('${COMMON_USER}', 'comum@ficticio.test');
    insert into public.profiles (id, name, email, is_active, platform_role) values
      ('${SUPER_ADMIN}', 'SA', 'sa@ficticio.test', true, 'super_admin'),
      ('${COMMON_USER}', 'Comum', 'comum@ficticio.test', true, null)
    on conflict (id) do update set is_active = excluded.is_active, platform_role = excluded.platform_role;
    insert into public.whatsapp_connections (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at) values
      ('${CONNECTION}', '${TEST_COMPANY}', '${WABA}', '${PHONE_ID}', 'v1.x.y.z', 'connected', now()),
      ('${DEALER_CONNECTION}', '${DEALER}', '710000000000072', '810000000000072', 'v1.x.y.z', 'connected', now());
  `);
  await database.db.query('select * from public.whatsapp_connection_set_capture($1, true, null)', [CONNECTION]);

  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://fake.local');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'fake-verify');
  vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', 'c'.repeat(64));
  vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', 'd'.repeat(64));
  vi.stubEnv('WHATSAPP_INGESTION_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_INBOX_READ_ENABLED', 'true');
  vi.stubGlobal('fetch', createPostgrestBridge(database.db));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.requireAuthenticatedActor.mockResolvedValue(actor(SUPER_ADMIN, true));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mocks.requireAuthenticatedActor.mockReset();
});

describe('pgTAP da inbox', () => {
  it('84_whatsapp_inbox_read_w2b8.sql passa sem falhas', async () => {
    await database.clearWhatsAppData();
    const result = await database.runPgTap('84_whatsapp_inbox_read_w2b8.sql');
    expect(result.failures).toEqual([]);
    expect(result.total).toBeGreaterThan(30);
  }, 60_000);
});

describe('captura real lida pela inbox', () => {
  it('sem conversas, devolve lista vazia', async () => {
    const res = await getConversations();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, conversations: [], nextCursor: null });
  });

  it('decifra no servidor e devolve contato mascarado, prévia e histórico', async () => {
    await deliver([textMessage(WAMID, '1730000000'), textMessage(`${WAMID}-2`, '1730000060', 'Segunda mensagem fictícia')]);

    const list = await (await getConversations()).json();
    expect(list.conversations).toHaveLength(1);
    const [conversation] = list.conversations;
    expect(conversation.contact).toEqual({ displayName: NAME, phoneMasked: '+55 ••••• 1234', readable: true });
    expect(conversation.preview).toEqual({ kind: 'text', text: 'Segunda mensagem fictícia', truncated: false });
    expect(conversation.messageCount).toBe(2);

    const thread = await (await getMessages(conversation.id)).json();
    expect(thread.messages.map((m: { body: { text: string } }) => m.body.text)).toEqual([TEXT, 'Segunda mensagem fictícia']);
  });

  it('nada sensível sai da rota: ciphertext, wamid, BSUID, telefone ou hash', async () => {
    await deliver([textMessage(WAMID, '1730000000')]);
    const listBody = await (await getConversations()).text();
    const id = JSON.parse(listBody).conversations[0].id;
    const threadBody = await (await getMessages(id)).text();

    const { rows } = await database.db.query<{ content_ciphertext: string; message_id_hash: string; pii: string; hmac: string }>(`
      select m.content_ciphertext, m.message_id_hash, c.pii_ciphertext as pii, c.phone_hmac as hmac
      from public.whatsapp_messages m join public.whatsapp_contacts c on c.id = m.contact_id
    `);
    for (const secret of [WAMID, BSUID, CUSTOMER, rows[0].content_ciphertext, rows[0].message_id_hash, rows[0].pii, rows[0].hmac, 'c'.repeat(64)]) {
      expect(`${listBody}\n${threadBody}`).not.toContain(secret);
    }
  });

  it('o webhook não é afetado: a leitura não altera linhas', async () => {
    await deliver([textMessage(WAMID, '1730000000')]);
    const before = await database.db.query('select id, updated_at from public.whatsapp_conversations');
    const list = await (await getConversations()).json();
    await getMessages(list.conversations[0].id);
    const after = await database.db.query('select id, updated_at from public.whatsapp_conversations');
    expect(after.rows).toEqual(before.rows);
  });
});

describe('isolamento multiempresa', () => {
  async function seedDealerConversation(): Promise<string> {
    const contact = 'fa7c0000-0000-4000-8000-000000000003';
    const conversation = 'fa7b0000-0000-4000-8000-000000000003';
    await database.db.exec(`
      insert into public.whatsapp_contacts (id, company_id, phone_hmac, hmac_key_version, pii_ciphertext, pii_ref, pii_key_version, pii_has_phone, pii_source_at)
      values ('${contact}', '${DEALER}', '${'e'.repeat(64)}', 1, 'v1.pii.a.b', gen_random_uuid(), 1, true, now());
      insert into public.whatsapp_conversations (id, company_id, connection_id, contact_id, first_message_at, last_message_at)
      values ('${conversation}', '${DEALER}', '${DEALER_CONNECTION}', '${contact}', now(), now());
    `);
    return conversation;
  }

  it('a lista nunca mistura outra empresa', async () => {
    await seedDealerConversation();
    await deliver([textMessage(WAMID, '1730000000')]);
    const body = await (await getConversations()).json();
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].id).not.toBe('fa7b0000-0000-4000-8000-000000000003');
  });

  it('conversa de outra empresa pela URL → 404, igual a inexistente', async () => {
    const conversation = await seedDealerConversation();
    const foreign = await getMessages(conversation);
    const missing = await getMessages('fa7b0000-0000-4000-8000-0000000000ff');
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it('pedir a outra empresa → 403 na rota, sem chegar ao banco', async () => {
    await seedDealerConversation();
    const res = await getConversations(DEALER);
    expect(res.status).toBe(403);
  });

  it('banco recusa perfil comum mesmo se a rota errar', async () => {
    mocks.requireAuthenticatedActor.mockResolvedValue(actor(COMMON_USER, true));
    const res = await getConversations();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('envelope movido para outra mensagem não decifra e vira ilegível', async () => {
    await deliver([textMessage(WAMID, '1730000000'), textMessage(`${WAMID}-2`, '1730000060', 'Outra mensagem fictícia')]);
    await database.db.exec(`
      update public.whatsapp_messages m set content_ciphertext = o.content_ciphertext
      from public.whatsapp_messages o where m.id <> o.id and o.occurred_at < m.occurred_at
    `);
    const list = await (await getConversations()).json();
    expect(list.conversations[0].preview).toEqual({ kind: 'unreadable' });
    const thread = await (await getMessages(list.conversations[0].id)).json();
    expect(thread.messages.map((m: { body: { kind: string } }) => m.body.kind)).toEqual(['text', 'unreadable']);
  });

  it('contato com referência trocada por SQL não decifra', async () => {
    await deliver([textMessage(WAMID, '1730000000')]);
    const { rows } = await database.db.query<{ company_id: string }>('select company_id from public.whatsapp_contacts');
    expect(rows[0].company_id).toBe(TEST_COMPANY);
    await database.db.exec(`update public.whatsapp_contacts set pii_ref = gen_random_uuid()`);
    const list = await (await getConversations()).json();
    expect(list.conversations[0].contact).toEqual({ displayName: null, phoneMasked: null, readable: false });
  });
});

describe('paginação pela rota', () => {
  it('percorre o histórico sem repetir nem perder mensagens', async () => {
    const messages = Array.from({ length: 53 }, (_, index) =>
      textMessage(`${WAMID}-${index}`, String(1730000000 + index), `Mensagem fictícia ${index}`));
    await deliver(messages);

    const conversation = (await (await getConversations()).json()).conversations[0];
    expect(conversation.messageCount).toBe(53);

    const first = await (await getMessages(conversation.id)).json();
    expect(first.messages).toHaveLength(50);
    expect(first.messages.at(-1).body.text).toBe('Mensagem fictícia 52');
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await (await getMessages(conversation.id, `company_id=${TEST_COMPANY}&cursor=${first.nextCursor}`)).json();
    expect(second.messages.map((m: { body: { text: string } }) => m.body.text)).toEqual([
      'Mensagem fictícia 0', 'Mensagem fictícia 1', 'Mensagem fictícia 2',
    ]);
    expect(second.nextCursor).toBeNull();
  }, 60_000);
});
