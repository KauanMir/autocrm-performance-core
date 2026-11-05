// lib/whatsapp/inboxDemoData.ts — W2B-8: dados FICTÍCIOS para ver a inbox em
// desenvolvimento, antes de existir mensagem real. Só carregado com o modo
// demonstração (lib/flags.ts: isWhatsAppInboxDemoEnabled), que exige NODE_ENV
// 'development' e sempre exibe aviso na tela. Nenhuma pessoa, telefone ou veículo real.
import type {
  WhatsAppInboxBody,
  WhatsAppInboxConversation,
  WhatsAppInboxConversationsPage,
  WhatsAppInboxMessage,
  WhatsAppInboxMessagesPage,
} from '@/lib/integrations/whatsappInboxRequest';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type DemoMessage = { minutesAgo: number; body: WhatsAppInboxBody };

const text = (value: string): WhatsAppInboxBody => ({ kind: 'text', text: value, truncated: false });

const DEMO_THREADS: Array<{
  id: string;
  displayName: string | null;
  phoneMasked: string | null;
  readable?: boolean;
  messages: DemoMessage[];
}> = [
  {
    id: 'de000000-0000-4000-8000-000000000001',
    displayName: 'Aurora Fictícia',
    phoneMasked: '+55 ••••• 0001',
    messages: [
      { minutesAgo: 2 * 24 * 60 + 30, body: text('Boa tarde! Vi o anúncio do SUV prata. Ainda está disponível?') },
      { minutesAgo: 26 * 60, body: { kind: 'media', mediaType: 'image', caption: 'É esse aqui da foto?', fileName: null } },
      { minutesAgo: 25 * 60 + 58, body: text('Aceita usado na troca?') },
      { minutesAgo: 25 * 60 + 57, body: text('Tenho um hatch 2019, único dono, revisões em dia e pneus novos. Queria entender como funciona a avaliação e se dá para usar o valor como entrada no financiamento do SUV.') },
      { minutesAgo: 14, body: text('Consigo passar aí amanhã depois das 18h.\nVocês fecham que horas?') },
      { minutesAgo: 12, body: text('Se der, já queria fazer um test drive.') },
    ],
  },
  {
    id: 'de000000-0000-4000-8000-000000000002',
    displayName: 'Bento Fictício',
    phoneMasked: '+55 ••••• 0002',
    messages: [
      { minutesAgo: 3 * 60, body: { kind: 'media', mediaType: 'audio', caption: null, fileName: null } },
      { minutesAgo: 2 * 60 + 50, body: { kind: 'media', mediaType: 'document', caption: 'Comprovante de renda', fileName: 'documento-ficticio.pdf' } },
    ],
  },
  {
    id: 'de000000-0000-4000-8000-000000000003',
    displayName: null,
    phoneMasked: '+55 ••••• 0003',
    messages: [
      { minutesAgo: 27 * 60, body: { kind: 'unsupported', messageType: 'location' } },
      { minutesAgo: 26 * 60 + 58, body: text('Estou aqui perto da loja.') },
    ],
  },
  {
    id: 'de000000-0000-4000-8000-000000000004',
    displayName: 'Clara Fictícia',
    phoneMasked: null,
    messages: [
      { minutesAgo: 5 * 24 * 60, body: { kind: 'unsupported', messageType: 'reaction' } },
      { minutesAgo: 5 * 24 * 60 - 1, body: { kind: 'unsupported', messageType: 'request_welcome' } },
    ],
  },
  {
    id: 'de000000-0000-4000-8000-000000000006',
    displayName: 'Davi Fictício',
    phoneMasked: '+55 ••••• 0006',
    messages: [
      { minutesAgo: 6 * 60 + 12, body: { kind: 'media', mediaType: 'video', caption: null, fileName: null } },
      { minutesAgo: 6 * 60 + 10, body: text('Gravei o barulho que comentei com o vendedor.') },
    ],
  },
  {
    id: 'de000000-0000-4000-8000-000000000007',
    displayName: 'Elisa Fictícia',
    phoneMasked: '+55 ••••• 0007',
    messages: [
      { minutesAgo: 3 * 24 * 60, body: text('Qual a taxa do financiamento em 48 vezes?') },
      { minutesAgo: 3 * 24 * 60 - 2, body: { kind: 'media', mediaType: 'sticker', caption: null, fileName: null } },
    ],
  },
  {
    id: 'de000000-0000-4000-8000-000000000005',
    displayName: null,
    phoneMasked: null,
    readable: false,
    messages: [{ minutesAgo: 40 * 24 * 60, body: { kind: 'unreadable' } }],
  },
];

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

function toConversation(thread: (typeof DEMO_THREADS)[number]): WhatsAppInboxConversation {
  const last = thread.messages[thread.messages.length - 1];
  return {
    id: thread.id,
    contact: { displayName: thread.displayName, phoneMasked: thread.phoneMasked, readable: thread.readable ?? true },
    lastMessageAt: isoAgo(last.minutesAgo),
    messageCount: thread.messages.length,
    preview: last.body,
  };
}

function toMessage(threadId: string, message: DemoMessage, index: number): WhatsAppInboxMessage {
  return { id: `${threadId.slice(0, 34)}${String(index).padStart(2, '0')}`, occurredAt: isoAgo(message.minutesAgo), body: message.body };
}

export function demoConversationsPage(): WhatsAppInboxConversationsPage {
  return {
    conversations: DEMO_THREADS.map(toConversation).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    nextCursor: null,
  };
}

export function demoMessagesPage(conversationId: string): WhatsAppInboxMessagesPage {
  const thread = DEMO_THREADS.find((candidate) => candidate.id === conversationId);
  return { messages: thread ? thread.messages.map((message, index) => toMessage(thread.id, message, index)) : [], nextCursor: null };
}
