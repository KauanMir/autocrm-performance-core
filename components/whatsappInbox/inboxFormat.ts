// components/whatsappInbox/inboxFormat.ts — W2B-8. Rótulos e datas da inbox. Puro,
// sem React. Os tipos não suportados têm rótulo próprio: quem lê precisa distinguir
// "chegou algo que o CRM ainda não mostra" de "não chegou nada".
import type {
  WhatsAppInboxBody,
  WhatsAppInboxContact,
  WhatsAppInboxConversation,
  WhatsAppInboxMediaType,
  WhatsAppInboxMessageType,
} from '@/lib/integrations/whatsappInboxRequest';

export const MEDIA_LABELS: Record<WhatsAppInboxMediaType, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
};

export const MEDIA_ICONS: Record<WhatsAppInboxMediaType, string> = {
  image: 'image',
  video: 'video',
  audio: 'mic',
  document: 'doc',
  sticker: 'sticker',
};

export const MEDIA_RECEIVED_LABELS: Record<WhatsAppInboxMediaType, string> = {
  image: 'Imagem recebida',
  video: 'Vídeo recebido',
  audio: 'Áudio recebido',
  document: 'Documento recebido',
  sticker: 'Figurinha recebida',
};

const UNSUPPORTED_LABELS: Partial<Record<WhatsAppInboxMessageType, string>> = {
  location: 'Localização compartilhada',
  contacts: 'Contato compartilhado',
  interactive: 'Resposta a um menu',
  button: 'Resposta a um botão',
  reaction: 'Reação a uma mensagem',
  order: 'Pedido do catálogo',
  system: 'Aviso do WhatsApp',
  request_welcome: 'Cliente iniciou a conversa',
};

const GENERIC_UNSUPPORTED = 'Tipo de mensagem não suportado';

export function unsupportedLabel(messageType: WhatsAppInboxMessageType): string {
  return UNSUPPORTED_LABELS[messageType] ?? GENERIC_UNSUPPORTED;
}

export function contactLabel(contact: WhatsAppInboxContact): string {
  if (!contact.readable) return 'Contato ilegível';
  return contact.displayName ?? contact.phoneMasked ?? 'Contato sem identificação';
}

export function previewLabel(body: WhatsAppInboxBody): string {
  switch (body.kind) {
    case 'text':
      return body.text;
    case 'media':
      return body.caption ?? MEDIA_LABELS[body.mediaType];
    case 'unsupported':
      return unsupportedLabel(body.messageType);
    default:
      return 'Mensagem ilegível';
  }
}

export function contactInitials(name: string | null): string | null {
  const words = name?.match(/\p{L}[\p{L}\p{M}'’-]*/gu);
  if (!words) return null;
  const firstLetter = (word: string) => Array.from(word)[0];
  const letters = words.length > 1 ? firstLetter(words[0]) + firstLetter(words[words.length - 1]) : firstLetter(words[0]);
  return letters.toLocaleUpperCase('pt-BR');
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

// Busca só no que a tela já pode mostrar: nome, telefone mascarado e prévia. O histórico
// não entra, porque só existe no navegador depois que a conversa é aberta.
export function filterConversations(
  conversations: WhatsAppInboxConversation[],
  query: string,
): WhatsAppInboxConversation[] {
  const term = normalizeSearch(query);
  if (term === '') return conversations;
  return conversations.filter(({ contact, preview }) => {
    const fields = [contactLabel(contact), contact.readable ? contact.phoneMasked : null, previewLabel(preview)];
    return fields.some((field) => field !== null && normalizeSearch(field).includes(term));
  });
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(date: Date, now: Date): number {
  return Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
}

const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

export function messageTime(iso: string): string {
  return TIME.format(new Date(iso));
}

export function fullTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${FULL_DATE.format(date)} às ${TIME.format(date)}`;
}

export function conversationTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days <= 0) return TIME.format(date);
  if (days === 1) return 'Ontem';
  return date.getFullYear() === now.getFullYear() ? SHORT_DATE.format(date) : FULL_DATE.format(date);
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = daysBetween(date, now);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return LONG_DATE.format(date);
}

export function dayKey(iso: string): number {
  return dayStart(new Date(iso));
}

const SAME_BURST_MS = 5 * 60_000;

// Mensagens seguidas em poucos minutos formam um bloco, com menos espaço entre elas.
export function isSameBurst(previousIso: string, iso: string): boolean {
  return new Date(iso).getTime() - new Date(previousIso).getTime() <= SAME_BURST_MS;
}
