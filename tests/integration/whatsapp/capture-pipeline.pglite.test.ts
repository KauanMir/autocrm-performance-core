// @vitest-environment node
// tests/integration/whatsapp/capture-pipeline.pglite.test.ts — validação permanente
// com Postgres real em memória: migrations, pgTAP e o caminho completo do webhook
// (assinatura → parser → criptografia → supabase-js → RPCs reais). Dados fictícios,
// sem rede. Conexão única: não prova concorrência nem substitui o Supabase local.
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/whatsapp/route';
import {
  decryptWhatsAppContactPii,
  decryptWhatsAppMessageContent,
} from '@/lib/server/whatsapp-connection/capture-crypto';
import { fetchWhatsAppDiagnosticsSummary } from '@/lib/server/whatsapp-webhook/capture-rpc';
import { createPostgrestBridge, createWhatsAppTestDatabase, type WhatsAppTestDatabase } from './support/pglite-database';

const TEST_COMPANY = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
const DEALER = 'fa5eeeee-2222-4222-8222-222222222222';
const CONNECTION = 'fa5a0000-0000-4000-8000-00000000000a';
const SECOND_CONNECTION = 'fa5a0000-0000-4000-8000-00000000000c';
const DEALER_CONNECTION = 'fa5a0000-0000-4000-8000-00000000000b';
const WABA = '710000000000051';
const DEALER_WABA = '710000000000052';
const PHONE_ID = '810000000000051';
const SECOND_PHONE_ID = '810000000000053';
const DEALER_PHONE_ID = '810000000000052';
const APP_SECRET = 'fake-app-secret-pglite';
const CONTENT_KEY = 'c'.repeat(64);
const HMAC_KEY = 'd'.repeat(64);
const CUSTOMER = '5511987654321';
const NAME = 'Fulana Integração';
const TEXT = 'Mensagem secreta da integração com acentuação ✅';
const BSUID = 'BR.1349120865530274191';

let database: WhatsAppTestDatabase;
let failRpc: string | null = null;
let calledRpcs: string[] = [];

const count = async (table: string, where = 'true') =>
  (await database.db.query<{ c: number }>(`select count(*)::int c from public.${table} where ${where}`)).rows[0].c;

const allTableCounts = async () => ({
  events: await count('whatsapp_webhook_events'),
  contacts: await count('whatsapp_contacts'),
  conversations: await count('whatsapp_conversations'),
  messages: await count('whatsapp_messages'),
});

async function send(body: unknown): Promise<Response> {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw, 'utf8').digest('hex')}`;
  return POST(
    new Request('https://crm.example.test/api/webhooks/whatsapp', {
      method: 'POST',
      body: raw,
      headers: { 'X-Hub-Signature-256': signature },
    }),
  );
}

function delivery(options: {
  waba?: string;
  phone?: string;
  messages?: unknown[];
  statuses?: unknown[];
  contacts?: unknown[];
}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: options.waba ?? WABA,
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: options.phone ?? PHONE_ID },
          contacts: options.contacts ?? [{ profile: { name: NAME }, wa_id: CUSTOMER }],
          messages: options.messages,
          statuses: options.statuses,
        },
      }],
    }],
  };
}

const message = (id: string, over: Record<string, unknown> = {}) => ({
  from: CUSTOMER, id, timestamp: '1730000000', type: 'text', text: { body: TEXT }, ...over,
});

async function enableCapture(connection = CONNECTION) {
  await database.db.query('select * from public.whatsapp_connection_set_capture($1, true, null)', [connection]);
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
    insert into public.whatsapp_connections (id, company_id, waba_id, phone_number_id, access_token_ciphertext, status, connected_at) values
      ('${CONNECTION}', '${TEST_COMPANY}', '${WABA}', '${PHONE_ID}', 'v1.x.y.z', 'connected', now()),
      ('${SECOND_CONNECTION}', '${TEST_COMPANY}', '${WABA}', '${SECOND_PHONE_ID}', 'v1.x.y.z', 'connected', now()),
      ('${DEALER_CONNECTION}', '${DEALER}', '${DEALER_WABA}', '${DEALER_PHONE_ID}', 'v1.x.y.z', 'connected', now());
  `);

  failRpc = null;
  calledRpcs = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://fake.local');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-role');
  vi.stubEnv('META_APP_SECRET', APP_SECRET);
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'fake-verify');
  vi.stubEnv('WHATSAPP_CONTENT_ENCRYPTION_KEY_V1', CONTENT_KEY);
  vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', HMAC_KEY);
  vi.stubEnv('WHATSAPP_INGESTION_ENABLED', 'true');
  vi.stubGlobal('fetch', createPostgrestBridge(database.db, {
    failRpc: () => failRpc,
    onCall: (name) => calledRpcs.push(name),
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('migrations e pgTAP', () => {
  it('aplica todas as migrations como dono não superusuário', async () => {
    const { rows } = await database.db.query<{ rolsuper: boolean }>(
      'select rolsuper from pg_roles where rolname = current_user',
    );
    expect(rows[0].rolsuper).toBe(false);
    expect(database.appliedMigrations).toBeGreaterThanOrEqual(81);
  });

  it.each([
    ['81_whatsapp_connections_w2a.sql'],
    ['82_whatsapp_webhook_events_w2a.sql'],
    ['83_whatsapp_conversations_w2b4.sql'],
  ])('%s passa sem falhas', async (file) => {
    await database.clearWhatsAppData();
    const result = await database.runPgTap(file);
    expect(result.failures).toEqual([]);
    expect(result.total).toBeGreaterThan(30);
  }, 60_000);
});

describe('índices das tabelas novas', () => {
  it('toda FK tem índice de suporte', async () => {
    const { rows } = await database.db.query<{ conname: string }>(`
      select c.conname from pg_constraint c
      where c.contype = 'f'
        and c.conrelid in ('public.whatsapp_contacts'::regclass, 'public.whatsapp_conversations'::regclass,
                           'public.whatsapp_messages'::regclass)
        and not exists (
          select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
            and c.conkey @> (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1])`);
    expect(rows).toEqual([]);
  });
});

describe('captura desabilitada', () => {
  it('flag ligada sem capture_enabled não grava nada', async () => {
    const res = await send(delivery({ messages: [message('wamid.A1')], statuses: [{ id: 'wamid.A2', status: 'read' }] }));
    expect(res.status).toBe(200);
    expect(await allTableCounts()).toEqual({ events: 0, contacts: 0, conversations: 0, messages: 0 });
  });

  it('conexão habilitada não pode ser movida para outra empresa', async () => {
    await enableCapture();
    await expect(
      database.db.query('update public.whatsapp_connections set company_id = $1 where id = $2', [DEALER, CONNECTION]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('flag desligada não chama nenhuma RPC', async () => {
    vi.stubEnv('WHATSAPP_INGESTION_ENABLED', undefined as unknown as string);
    await enableCapture();
    expect((await send(delivery({ messages: [message('wamid.A3')] }))).status).toBe(200);
    expect(calledRpcs).toEqual([]);
  });

  it('concessionária não habilita captura, nem por RPC nem por UPDATE', async () => {
    await expect(enableCapture(DEALER_CONNECTION)).rejects.toThrow('capture_not_allowed');
    await expect(
      database.db.query('update public.whatsapp_connections set capture_enabled = true where id = $1', [DEALER_CONNECTION]),
    ).rejects.toThrow();
    const res = await send(delivery({ waba: DEALER_WABA, phone: DEALER_PHONE_ID, messages: [message('wamid.A4')] }));
    expect(res.status).toBe(200);
    expect(await count('whatsapp_messages')).toBe(0);
  });
});

describe('captura transacional', () => {
  beforeEach(async () => {
    await enableCapture();
  });

  it('grava evento, contato, conversa e mensagem, sem dado em claro', async () => {
    const res = await send(delivery({ messages: [message('wamid.B1')] }));
    expect(res.status).toBe(200);
    expect(await allTableCounts()).toEqual({ events: 1, contacts: 1, conversations: 1, messages: 1 });

    const { rows } = await database.db.query(`
      select (select jsonb_agg(to_jsonb(e)) from public.whatsapp_webhook_events e) a,
             (select jsonb_agg(to_jsonb(c)) from public.whatsapp_contacts c) b,
             (select jsonb_agg(to_jsonb(c)) from public.whatsapp_conversations c) d,
             (select jsonb_agg(to_jsonb(m)) from public.whatsapp_messages m) f,
             (select jsonb_agg(to_jsonb(l)) from public.audit_log l where l.action like 'whatsapp%') g`);
    const stored = JSON.stringify(rows);
    for (const secret of [CUSTOMER, NAME, TEXT, 'wamid.B1', 'Mensagem']) {
      expect(stored).not.toContain(secret);
    }
  });

  it('o que está no banco decifra só no contexto correto', async () => {
    await send(delivery({ messages: [message('wamid.B2')] }));
    const { rows } = await database.db.query<Record<string, string>>(`
      select m.content_ciphertext, m.message_id_hash, c.pii_ciphertext, c.pii_ref
      from public.whatsapp_messages m join public.whatsapp_contacts c on c.id = m.contact_id`);
    const row = rows[0];
    const key = Buffer.from(CONTENT_KEY, 'hex');

    const opened = decryptWhatsAppMessageContent({
      ciphertext: row.content_ciphertext, companyId: TEST_COMPANY, connectionId: CONNECTION, messageIdHash: row.message_id_hash, key,
    });
    expect(opened).toMatchObject({ wamid: 'wamid.B2', content: { kind: 'text', text: TEXT } });
    expect(decryptWhatsAppContactPii({ ciphertext: row.pii_ciphertext, companyId: TEST_COMPANY, piiRef: row.pii_ref, key }))
      .toMatchObject({ phone: CUSTOMER, displayName: NAME });
    expect(() => decryptWhatsAppMessageContent({
      ciphertext: row.content_ciphertext, companyId: DEALER, connectionId: DEALER_CONNECTION, messageIdHash: row.message_id_hash, key,
    })).toThrow();
  });

  it('é atômica: falha na última etapa não deixa evento, contato nem conversa', async () => {
    await database.db.exec(`
      create function public.whatsapp_test_block() returns trigger language plpgsql as $f$
      begin raise exception 'bloqueio de teste'; end $f$;
      create trigger whatsapp_test_block before insert on public.whatsapp_messages
        for each row execute function public.whatsapp_test_block();
    `);
    try {
      const res = await send(delivery({ messages: [message('wamid.B3')] }));
      expect(res.status).toBe(503);
      expect(await allTableCounts()).toEqual({ events: 0, contacts: 0, conversations: 0, messages: 0 });
    } finally {
      await database.db.exec(`
        drop trigger whatsapp_test_block on public.whatsapp_messages;
        drop function public.whatsapp_test_block();
      `);
    }
    expect((await send(delivery({ messages: [message('wamid.B3')] }))).status).toBe(200);
    expect(await count('whatsapp_messages')).toBe(1);
  });

  it('várias mensagens na entrega: cada uma é gravada, com a mesma conversa', async () => {
    const res = await send(delivery({ messages: [message('wamid.B4'), message('wamid.B5'), message('wamid.B6')] }));
    expect(res.status).toBe(200);
    expect(await allTableCounts()).toEqual({ events: 3, contacts: 1, conversations: 1, messages: 3 });
  });

  it('reentrega não duplica', async () => {
    const body = delivery({ messages: [message('wamid.B7')] });
    expect((await send(body)).status).toBe(200);
    expect((await send(body)).status).toBe(200);
    expect(await allTableCounts()).toEqual({ events: 1, contacts: 1, conversations: 1, messages: 1 });
  });

  it('reentrega não altera contato, conversa nem mensagem já gravados', async () => {
    const body = delivery({ messages: [message('wamid.B10')] });
    const snapshot = async () => (await database.db.query(`
      select c.pii_ciphertext, c.pii_ref, c.updated_at as contact_updated, v.updated_at as conversation_updated,
             m.content_ciphertext
      from public.whatsapp_messages m
      join public.whatsapp_contacts c on c.id = m.contact_id
      join public.whatsapp_conversations v on v.id = m.conversation_id`)).rows;
    await send(body);
    const first = await snapshot();
    await send(body);
    expect(await snapshot()).toEqual(first);
  });

  it('falha transitória responde 503 e a reentrega recupera', async () => {
    const body = delivery({ messages: [message('wamid.B8')] });
    failRpc = 'whatsapp_inbound_message_capture';
    expect((await send(body)).status).toBe(503);
    expect(await count('whatsapp_messages')).toBe(0);
    failRpc = null;
    expect((await send(body)).status).toBe(200);
    expect(await count('whatsapp_messages')).toBe(1);
  });

  it('sem chave válida responde 503 e não grava', async () => {
    vi.stubEnv('WHATSAPP_CONTACT_HMAC_KEY_V1', '');
    expect((await send(delivery({ messages: [message('wamid.B9')] }))).status).toBe(503);
    expect(await count('whatsapp_webhook_events')).toBe(0);
  });

  it('usuário só com BSUID vira contato sem telefone', async () => {
    const res = await send(delivery({
      contacts: [{ profile: { name: 'Sem Fone' }, user_id: BSUID }],
      messages: [message('wamid.C1', { from: undefined, from_user_id: BSUID })],
    }));
    expect(res.status).toBe(200);
    expect(await count('whatsapp_contacts', 'phone_hmac is null and bsuid_hmac is not null')).toBe(1);
  });

  it('status é registrado no ledger', async () => {
    await send(delivery({ statuses: [{ id: 'wamid.C2', status: 'read', timestamp: '1730000100' }] }));
    expect(await count('whatsapp_webhook_events', `event_kind = 'status'`)).toBe(1);
    expect(await count('whatsapp_messages')).toBe(0);
  });

  it('mesmo wamid em dois números da empresa: duas mensagens, sem 503', async () => {
    await enableCapture(SECOND_CONNECTION);
    expect((await send(delivery({ messages: [message('wamid.C3')] }))).status).toBe(200);
    expect((await send(delivery({ phone: SECOND_PHONE_ID, messages: [message('wamid.C3')] }))).status).toBe(200);
    expect((await send(delivery({ phone: SECOND_PHONE_ID, messages: [message('wamid.C3')] }))).status).toBe(200);
    expect(await count('whatsapp_messages')).toBe(2);
    expect(await count('whatsapp_conversations')).toBe(2);
  });

  it.each([
    ['extremo', '999999999999'],
    ['futuro', String(Math.floor(Date.now() / 1000) + 10 * 24 * 3600)],
    ['anterior ao WhatsApp', '1000000000'],
  ])('timestamp %s não falha e não entra na ordem', async (_label, timestamp) => {
    const before = Date.now();
    const res = await send(delivery({ messages: [message('wamid.C4', { timestamp })] }));
    expect(res.status).toBe(200);
    const { rows } = await database.db.query<{ occurred_at: Date; last_message_at: Date }>(`
      select m.occurred_at, c.last_message_at from public.whatsapp_messages m
      join public.whatsapp_conversations c on c.id = m.conversation_id`);
    expect(rows[0].occurred_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(rows[0].occurred_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(rows[0].last_message_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('recusas', () => {
  beforeEach(async () => {
    await enableCapture();
  });

  it('mensagem de grupo não cria contato, conversa nem mensagem', async () => {
    const res = await send(delivery({ messages: [message('wamid.D1', { group_id: 'Y2FwaV9ncm91cDoxNzA1NTU1MDEzOQZD' })] }));
    expect(res.status).toBe(200);
    expect(await allTableCounts()).toEqual({ events: 1, contacts: 0, conversations: 0, messages: 0 });
    expect(await count('whatsapp_webhook_events', `last_error_code = 'group_message'`)).toBe(1);
  });

  it('grupo não contamina contato individual existente', async () => {
    await send(delivery({ messages: [message('wamid.D2')] }));
    await send(delivery({ messages: [message('wamid.D3', { group_id: 'grupo-qualquer' })] }));
    expect(await allTableCounts()).toEqual({ events: 2, contacts: 1, conversations: 1, messages: 1 });
  });

  it('mensagem sem contato fica rastreada, sem contato inventado', async () => {
    const res = await send(delivery({ contacts: [], messages: [message('wamid.D4', { from: undefined })] }));
    expect(res.status).toBe(200);
    expect(await count('whatsapp_webhook_events', `processing_status = 'failed' and last_error_code = 'contact_unresolved'`)).toBe(1);
    expect(await count('whatsapp_contacts')).toBe(0);
  });

  it('WABA divergente é recusada, rastreada e não cria conversa', async () => {
    const res = await send(delivery({ waba: '999', messages: [message('wamid.D5')] }));
    expect(res.status).toBe(200);
    expect(await allTableCounts()).toEqual({ events: 1, contacts: 0, conversations: 0, messages: 0 });
    expect(await count('whatsapp_webhook_events', `last_error_code = 'waba_mismatch'`)).toBe(1);
  });

  it('entrega correta posterior completa um evento recusado por WABA', async () => {
    await send(delivery({ waba: '999', messages: [message('wamid.D6')] }));
    expect((await send(delivery({ messages: [message('wamid.D6')] }))).status).toBe(200);
    expect(await count('whatsapp_webhook_events', `processing_status = 'processed' and last_error_code is null`)).toBe(1);
    expect(await count('whatsapp_messages')).toBe(1);
  });

  it('número desconhecido não grava nada', async () => {
    const res = await send(delivery({ waba: '111', phone: '810000000000099', messages: [message('wamid.D7')] }));
    expect(res.status).toBe(200);
    expect(await count('whatsapp_webhook_events')).toBe(0);
  });

  it('resumo do diagnóstico separa os motivos e não cruza empresas', async () => {
    await send(delivery({ messages: [message('wamid.E1')] }));
    await send(delivery({ waba: '999', messages: [message('wamid.E2')] }));
    await send(delivery({ contacts: [], messages: [message('wamid.E3', { from: undefined })] }));
    await send(delivery({ messages: [message('wamid.E4', { group_id: 'g' })] }));

    expect(await fetchWhatsAppDiagnosticsSummary(TEST_COMPANY)).toMatchObject({
      eventsTotal: 4, eventsFailed: 3, eventsWabaMismatch: 1, eventsContactUnresolved: 1, eventsGroupMessage: 1,
      messagesTotal: 1, captureEnabledConnections: 1,
    });
    expect(await fetchWhatsAppDiagnosticsSummary(DEALER)).toMatchObject({ eventsTotal: 0, messagesTotal: 0 });
  });
});

describe('papéis', () => {
  it.each(['anon', 'authenticated', 'service_role'])('%s não lê mensagens diretamente', async (role) => {
    await expect(database.db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query('select * from public.whatsapp_messages');
    })).rejects.toMatchObject({ code: '42501' });
  });
});
