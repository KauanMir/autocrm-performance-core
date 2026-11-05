// tests/lib/server/whatsapp-webhook/inbound-parser.test.ts — W2B-3. Parser puro:
// sem rede, sem banco e sem log. Dados fictícios.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_INBOUND_TEXT_LENGTH,
  MAX_OCCURRED_AT_SKEW_MS,
  MIN_OCCURRED_AT_MS,
  parseWhatsAppInboundDelivery,
} from '@/lib/server/whatsapp-webhook/inbound-parser';

const WABA_ID = '102290129340398';
const PHONE_NUMBER_ID = '106540352242922';
const CUSTOMER_PHONE = '5511987654321';
const BSUID = 'BR.13491208655302741918';
const PARENT_BSUID = 'BR.ENT.11815799212886844830';
const WAMID = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAxAA==';
const WAMID_2 = 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABIYFDNBMDAwMDAwMDAwMDAwMDAwMDAyAA==';
const NAME = 'Fulana de Tal Teste';
const TEXT = 'Quero saber o preço do carro';

function textMessage(over: Record<string, unknown> = {}) {
  return { from: CUSTOMER_PHONE, id: WAMID, timestamp: '1730000000', type: 'text', text: { body: TEXT }, ...over };
}

function contactBlock(over: Record<string, unknown> = {}) {
  return { profile: { name: NAME }, wa_id: CUSTOMER_PHONE, ...over };
}

function value(extra: Record<string, unknown>) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550783881', phone_number_id: PHONE_NUMBER_ID },
    contacts: [contactBlock()],
    ...extra,
  };
}

function payload(...values: Array<Record<string, unknown>>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: WABA_ID, changes: values.map((v) => ({ field: 'messages', value: v })) }],
  };
}

const parseOne = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parseWhatsAppInboundDelivery(payload(value({ messages: [message], ...extra })));

describe('mensagens de texto', () => {
  it('normaliza texto, contato, ids e horário', () => {
    const { messages, rejected } = parseOne(textMessage());
    expect(rejected).toEqual([]);
    expect(messages).toEqual([
      {
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        wamid: WAMID,
        messageType: 'text',
        occurredAt: new Date(1730000000 * 1000),
        contact: { phone: CUSTOMER_PHONE, bsuid: null, parentBsuid: null, displayName: NAME },
        content: { kind: 'text', text: TEXT, truncated: false },
        repliedToWamid: null,
      },
    ]);
  });

  it('preserva o wamid original, sem alteração', () => {
    expect(parseOne(textMessage()).messages[0].wamid).toBe(WAMID);
  });

  it('texto acima do limite é truncado e sinalizado', () => {
    const long = 'a'.repeat(MAX_INBOUND_TEXT_LENGTH + 10);
    const { content } = parseOne(textMessage({ text: { body: long } })).messages[0];
    expect(content).toEqual({ kind: 'text', text: 'a'.repeat(MAX_INBOUND_TEXT_LENGTH), truncated: true });
  });

  it.each([
    ['corpo vazio', { text: { body: '   ' } }],
    ['corpo não textual', { text: { body: 123 } }],
    ['sem objeto text', { text: undefined }],
  ])('%s → mensagem mantida como não suportada, não perdida', (_label, over) => {
    const { messages } = parseOne(textMessage(over));
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual({ kind: 'unsupported' });
  });

  it('resposta a outra mensagem preserva o wamid de contexto', () => {
    expect(parseOne(textMessage({ context: { id: WAMID_2, from: CUSTOMER_PHONE } })).messages[0].repliedToWamid).toBe(WAMID_2);
  });

  it('timestamp ausente ou inválido → occurredAt null, sem usar a hora atual', () => {
    expect(parseOne(textMessage({ timestamp: 'ontem' })).messages[0].occurredAt).toBeNull();
    expect(parseOne(textMessage({ timestamp: undefined })).messages[0].occurredAt).toBeNull();
  });
});

describe('limites de horário', () => {
  const NOW = new Date('2026-11-05T12:00:00.000Z');
  const parseAt = (timestamp: unknown) =>
    parseWhatsAppInboundDelivery(payload(value({ messages: [textMessage({ timestamp })] })), { now: NOW });
  const seconds = (ms: number) => String(Math.floor(ms / 1000));

  it('aceita o horário normal sem contar como inválido', () => {
    const delivery = parseAt(seconds(NOW.getTime() - 60_000));
    expect(delivery.messages[0].occurredAt).toEqual(new Date(NOW.getTime() - 60_000));
    expect(delivery.invalidTimestampCount).toBe(0);
  });

  it('aceita exatamente os limites', () => {
    expect(parseAt(seconds(MIN_OCCURRED_AT_MS)).messages[0].occurredAt).not.toBeNull();
    expect(parseAt(seconds(NOW.getTime() + MAX_OCCURRED_AT_SKEW_MS)).messages[0].occurredAt).not.toBeNull();
  });

  it.each([
    ['um segundo antes do mínimo', () => seconds(MIN_OCCURRED_AT_MS - 1000)],
    ['um segundo depois da tolerância', () => seconds(NOW.getTime() + MAX_OCCURRED_AT_SKEW_MS + 1000)],
    ['ano extremo aceito pelo formato', () => '999999999999'],
    ['zero', () => '0'],
    ['formato inválido', () => 'ontem'],
    ['número em vez de texto', () => 1730000000],
    ['negativo', () => '-1'],
  ])('%s → null, contado, mensagem mantida', (_label, build) => {
    const delivery = parseAt(build());
    expect(delivery.messages).toHaveLength(1);
    expect(delivery.messages[0].occurredAt).toBeNull();
    expect(delivery.invalidTimestampCount).toBe(1);
  });

  it('timestamp ausente não conta como inválido', () => {
    expect(parseAt(undefined).invalidTimestampCount).toBe(0);
  });

  it('o limite vale também para status', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ statuses: [{ id: WAMID, status: 'read', timestamp: '999999999999' }] })),
      { now: NOW },
    );
    expect(delivery.statuses[0].occurredAt).toBeNull();
    expect(delivery.invalidTimestampCount).toBe(1);
  });
});

describe('mensagens de grupo', () => {
  const GROUP_ID = 'Y2FwaV9ncm91cDoxNzA1NTU1MDEzOToxMjAzNjM0MDQ2OTQyMzM4MjAZD';

  it('nunca vira mensagem individual, mesmo com contato válido', () => {
    const delivery = parseOne(textMessage({ group_id: GROUP_ID }));
    expect(delivery.messages).toEqual([]);
    expect(delivery.rejected).toEqual([
      {
        reason: 'group_message',
        message: {
          wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID, wamid: WAMID, messageType: 'text',
          occurredAt: new Date(1730000000 * 1000),
        },
      },
    ]);
  });

  it('o rastro não traz dado do participante nem do grupo', () => {
    const serialized = JSON.stringify(parseOne(textMessage({ group_id: GROUP_ID })).rejected);
    for (const secret of [CUSTOMER_PHONE, NAME, TEXT, GROUP_ID]) expect(serialized).not.toContain(secret);
  });

  it.each([
    ['formato desconhecido', 'abc'],
    ['vazio', ''],
    ['número', 123],
    ['objeto', { id: 'x' }],
    ['zero', 0],
    ['falso', false],
  ])('presença basta: %s é grupo', (_label, groupId) => {
    expect(parseOne(textMessage({ group_id: groupId })).rejected[0].reason).toBe('group_message');
  });

  it('group_id nulo não é grupo', () => {
    expect(parseOne(textMessage({ group_id: null })).messages).toHaveLength(1);
  });

  it('tipo não suportado em grupo continua sendo grupo', () => {
    const delivery = parseOne(textMessage({ type: 'unsupported', text: undefined, group_id: GROUP_ID, errors: [{ code: 130501 }] }));
    expect(delivery.messages).toEqual([]);
    expect(delivery.rejected[0].reason).toBe('group_message');
  });

  it('grupo sem contato identificável continua sendo grupo', () => {
    const delivery = parseOne(textMessage({ from: undefined, group_id: GROUP_ID }), { contacts: [] });
    expect(delivery.rejected[0].reason).toBe('group_message');
  });

  it('não afeta a mensagem individual na mesma entrega', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ messages: [textMessage({ group_id: GROUP_ID }), textMessage({ id: WAMID_2 })] })),
    );
    expect(delivery.messages.map((m) => m.wamid)).toEqual([WAMID_2]);
  });

  it('status de grupo é recusado, sem usar recipient_id', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ statuses: [{ id: WAMID, status: 'sent', recipient_id: GROUP_ID, recipient_type: 'group' }] })),
    );
    expect(delivery.statuses).toEqual([]);
    expect(delivery.rejected).toEqual([{ reason: 'group_message', message: null }]);
  });
});

describe('mídia: reconhecida, nunca baixada', () => {
  it.each(['image', 'video', 'audio', 'sticker'])('%s guarda só metadados', (type) => {
    const { content, messageType } = parseOne({
      from: CUSTOMER_PHONE, id: WAMID, timestamp: '1730000000', type,
      [type]: { id: 'media.123_ABC', mime_type: 'image/jpeg', sha256: 'abc123+/=', caption: ' Foto ' },
    }).messages[0];
    expect(messageType).toBe(type);
    expect(content).toEqual({
      kind: 'media', mediaType: type, mediaId: 'media.123_ABC', mimeType: 'image/jpeg', sha256: 'abc123+/=',
      caption: 'Foto', fileName: null,
    });
  });

  it('document preserva o nome do arquivo e mime com parâmetro', () => {
    const { content } = parseOne({
      from: CUSTOMER_PHONE, id: WAMID, timestamp: '1730000000', type: 'document',
      document: { id: '123', mime_type: 'audio/ogg; codecs=opus', filename: 'proposta.pdf' },
    }).messages[0];
    expect(content).toMatchObject({ mediaType: 'document', fileName: 'proposta.pdf', mimeType: 'audio/ogg; codecs=opus' });
  });

  it('metadados fora do formato são descartados; a mensagem permanece', () => {
    const { messages } = parseOne({
      from: CUSTOMER_PHONE, id: WAMID, timestamp: '1730000000', type: 'image',
      image: { id: '../../etc/passwd', mime_type: '<script>', sha256: 'x y' },
    });
    expect(messages[0].content).toMatchObject({ kind: 'media', mediaId: null, mimeType: null, sha256: null });
  });

  it('objeto de mídia ausente não quebra a entrega', () => {
    const { messages } = parseOne({ from: CUSTOMER_PHONE, id: WAMID, timestamp: '1730000000', type: 'image' });
    expect(messages[0].content).toMatchObject({ kind: 'media', mediaId: null });
  });
});

describe('tipos ainda não suportados', () => {
  it.each(['location', 'contacts', 'interactive', 'button', 'reaction', 'order', 'system', 'request_welcome', 'unsupported'])(
    '%s é reconhecido e mantido sem conteúdo',
    (type) => {
      const { messages } = parseOne({ from: CUSTOMER_PHONE, id: WAMID, timestamp: '1730000000', type, [type]: { body: 'segredo' } });
      expect(messages[0].messageType).toBe(type);
      expect(messages[0].content).toEqual({ kind: 'unsupported' });
    },
  );

  it('tipo desconhecido vira other, nunca a string recebida', () => {
    const { messages } = parseOne(textMessage({ type: 'novo_tipo_da_meta' }));
    expect(messages[0].messageType).toBe('other');
    expect(messages[0].content).toEqual({ kind: 'unsupported' });
  });
});

describe('identificação do contato', () => {
  it('telefone e BSUID juntos', () => {
    const { contact } = parseOne(textMessage({ from_user_id: BSUID }), {
      contacts: [contactBlock({ user_id: BSUID, parent_user_id: PARENT_BSUID })],
    }).messages[0];
    expect(contact).toEqual({ phone: CUSTOMER_PHONE, bsuid: BSUID, parentBsuid: PARENT_BSUID, displayName: NAME });
  });

  it('usuário com username: sem from e sem wa_id, só BSUID', () => {
    const { contact } = parseOne(textMessage({ from: undefined, from_user_id: BSUID }), {
      contacts: [{ profile: { name: NAME }, user_id: BSUID }],
    }).messages[0];
    expect(contact).toEqual({ phone: null, bsuid: BSUID, parentBsuid: null, displayName: NAME });
  });

  it('BSUID chegando em from e wa_id não é tratado como telefone', () => {
    const { contact } = parseOne(textMessage({ from: BSUID }), { contacts: [{ wa_id: BSUID, user_id: BSUID }] }).messages[0];
    expect(contact.phone).toBeNull();
    expect(contact.bsuid).toBe(BSUID);
  });

  it('mensagem sem identificador com bloco único usa o bloco', () => {
    const { contact } = parseOne(textMessage({ from: undefined }), { contacts: [contactBlock({ user_id: BSUID })] }).messages[0];
    expect(contact).toMatchObject({ phone: CUSTOMER_PHONE, bsuid: BSUID, displayName: NAME });
  });

  it('nome é atribuído ao contato certo em entrega com vários blocos', () => {
    const other = '5511900000000';
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({
        contacts: [{ profile: { name: 'Outro' }, wa_id: other }, contactBlock()],
        messages: [textMessage(), textMessage({ id: WAMID_2, from: other })],
      })),
    );
    expect(delivery.messages.map((m) => m.contact.displayName)).toEqual([NAME, 'Outro']);
  });

  it('vários blocos sem correspondência não atribuem nome por palpite', () => {
    const { contact } = parseOne(textMessage(), {
      contacts: [{ profile: { name: 'A' }, wa_id: '5511911111111' }, { profile: { name: 'B' }, wa_id: '5511922222222' }],
    }).messages[0];
    expect(contact.displayName).toBeNull();
    expect(contact.phone).toBe(CUSTOMER_PHONE);
  });

  it('sem identificador algum → rejeição rastreável, sem contato inventado', () => {
    const delivery = parseOne(textMessage({ from: undefined }), { contacts: [] });
    expect(delivery.messages).toEqual([]);
    expect(delivery.rejected).toEqual([
      {
        reason: 'missing_contact',
        message: {
          wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID, wamid: WAMID, messageType: 'text',
          occurredAt: new Date(1730000000 * 1000),
        },
      },
    ]);
  });

  it.each(['abc', '0123456789', '+5511987654321', '55 11 98765', 'BR.', 'br.123', 'BR.ENT.123'])(
    'identificador malformado "%s" não é aceito como telefone ou BSUID',
    (bad) => {
      const delivery = parseOne(textMessage({ from: bad }), { contacts: [] });
      expect(delivery.messages).toEqual([]);
      expect(delivery.rejected[0].reason).toBe('missing_contact');
    },
  );
});

describe('statuses', () => {
  it('são separados de mensagens e mantêm o valor bruto para o hash', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ statuses: [{ id: WAMID, status: 'delivered', timestamp: '1730000001', recipient_id: CUSTOMER_PHONE }] })),
    );
    expect(delivery.messages).toEqual([]);
    expect(delivery.statuses).toEqual([
      {
        wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID, wamid: WAMID, statusValue: 'delivered',
        rawStatus: 'delivered', occurredAt: new Date(1730000001 * 1000),
      },
    ]);
  });

  it('status desconhecido vira other e preserva o bruto', () => {
    const { statuses } = parseWhatsAppInboundDelivery(payload(value({ statuses: [{ id: WAMID, status: 'x_new' }] })));
    expect(statuses[0]).toMatchObject({ statusValue: 'other', rawStatus: 'x_new' });
  });

  it('entrega mista preserva os dois tipos', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ messages: [textMessage()], statuses: [{ id: WAMID_2, status: 'read' }] })),
    );
    expect(delivery.messages).toHaveLength(1);
    expect(delivery.statuses).toHaveLength(1);
  });
});

describe('duplicidade e ordem', () => {
  it('mesma mensagem repetida na entrega conta como duplicada', () => {
    const delivery = parseWhatsAppInboundDelivery(payload(value({ messages: [textMessage(), textMessage()] })));
    expect(delivery.messages).toHaveLength(1);
    expect(delivery.duplicateCount).toBe(1);
  });

  it('mesmo status repetido é duplicado; transições distintas não são', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ statuses: [{ id: WAMID, status: 'sent' }, { id: WAMID, status: 'sent' }, { id: WAMID, status: 'read' }] })),
    );
    expect(delivery.statuses.map((s) => s.statusValue)).toEqual(['sent', 'read']);
    expect(delivery.duplicateCount).toBe(1);
  });

  it('mensagem e status com o mesmo wamid não colidem', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ messages: [textMessage()], statuses: [{ id: WAMID, status: 'read' }] })),
    );
    expect(delivery.duplicateCount).toBe(0);
  });

  it('eventos fora de ordem mantêm a ordem recebida e o horário de cada um', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(value({ messages: [textMessage({ timestamp: '1730000500' }), textMessage({ id: WAMID_2, timestamp: '1730000000' })] })),
    );
    expect(delivery.messages.map((m) => m.occurredAt?.getTime())).toEqual([1730000500000, 1730000000000]);
  });

  it('o mesmo wamid em números diferentes não é duplicado', () => {
    const delivery = parseWhatsAppInboundDelivery(
      payload(
        value({ messages: [textMessage()] }),
        value({ metadata: { phone_number_id: '106540352242933' }, messages: [textMessage()] }),
      ),
    );
    expect(delivery.messages).toHaveLength(2);
  });
});

describe('estruturas incompletas e malformadas', () => {
  it.each([
    ['null', null],
    ['texto', 'x'],
    ['lista', []],
    ['objeto vazio', {}],
    ['outro object', { object: 'page', entry: [] }],
  ])('%s → ignorado sem lançar', (_label, input) => {
    const delivery = parseWhatsAppInboundDelivery(input);
    expect(delivery.isWhatsAppBusinessAccount).toBe(false);
    expect(delivery.messages).toEqual([]);
  });

  it.each([
    ['entry não lista', { object: 'whatsapp_business_account', entry: 'x' }],
    ['entry com nulos', { object: 'whatsapp_business_account', entry: [null, 1] }],
    ['changes não lista', { object: 'whatsapp_business_account', entry: [{ changes: {} }] }],
    ['outro field', { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] }],
    ['value ausente', { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages' }] }] }],
  ])('%s → sem itens e sem lançar', (_label, input) => {
    const delivery = parseWhatsAppInboundDelivery(input);
    expect(delivery.messages).toEqual([]);
    expect(delivery.rejected).toEqual([]);
  });

  it('item não objeto é rejeitado sem derrubar os demais', () => {
    const delivery = parseWhatsAppInboundDelivery(payload(value({ messages: [null, 'x', textMessage()] })));
    expect(delivery.messages).toHaveLength(1);
    expect(delivery.rejected.map((r) => r.reason)).toEqual(['malformed_item', 'malformed_item']);
  });

  it('sem id de mensagem → rejeitado, sem rastreio', () => {
    expect(parseOne(textMessage({ id: undefined })).rejected).toEqual([{ reason: 'missing_message_id', message: null }]);
    expect(parseOne(textMessage({ id: 'w'.repeat(513) })).rejected[0].reason).toBe('missing_message_id');
  });

  it('sem phone_number_id → rejeitado', () => {
    const delivery = parseWhatsAppInboundDelivery(payload({ messages: [textMessage()], contacts: [contactBlock()] }));
    expect(delivery.rejected).toEqual([{ reason: 'missing_phone_number_id', message: null }]);
  });

  it('WABA ausente ou inválida fica null, para a checagem falhar fechada', () => {
    const delivery = parseWhatsAppInboundDelivery({
      object: 'whatsapp_business_account',
      entry: [{ id: 'abc', changes: [{ field: 'messages', value: value({ messages: [textMessage()] }) }] }],
    });
    expect(delivery.messages[0].wabaId).toBeNull();
  });

  it('não muda o objeto recebido e não copia chaves desconhecidas', () => {
    const input = payload(value({ messages: [textMessage({ extra: 'campo-novo' })] }));
    const snapshot = JSON.stringify(input);
    const delivery = parseWhatsAppInboundDelivery(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(JSON.stringify(delivery)).not.toContain('campo-novo');
  });
});

describe('isolamento do módulo', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('nada é logado', () => {
    parseOne(textMessage());
    parseOne(null as unknown as Record<string, unknown>);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('o código não importa banco, rede, env nem logger', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/server/whatsapp-webhook/inbound-parser.ts'), 'utf8');
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/fetch\(|process\.env|console\./);
    expect(code).not.toMatch(/from '[^']*(supabase|logger|whatsapp-connection)[^']*'/);
  });
});
