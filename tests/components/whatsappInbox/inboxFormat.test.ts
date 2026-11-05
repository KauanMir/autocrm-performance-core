// tests/components/whatsappInbox/inboxFormat.test.ts — W2B-8. Busca local, iniciais,
// blocos de mensagens e ícones. Funções puras, só com dados fictícios.
import { describe, expect, it } from 'vitest';
import { ICONS } from '@/components/ui/Icon';
import {
  contactInitials,
  filterConversations,
  isSameBurst,
  MEDIA_ICONS,
  MEDIA_RECEIVED_LABELS,
} from '@/components/whatsappInbox/inboxFormat';
import type { WhatsAppInboxBody, WhatsAppInboxConversation } from '@/lib/integrations/whatsappInboxRequest';

const conversation = (
  id: string,
  contact: WhatsAppInboxConversation['contact'],
  preview: WhatsAppInboxBody = { kind: 'text', text: 'Prévia comum', truncated: false },
): WhatsAppInboxConversation => ({ id, contact, lastMessageAt: '2026-11-05T12:00:00.000Z', messageCount: 1, preview });

const AURORA = conversation('id-aurora', { displayName: 'Aurora Fictícia', phoneMasked: '+55 ••••• 0001', readable: true });
const SEM_NOME = conversation('id-sem-nome', { displayName: null, phoneMasked: '+55 ••••• 0003', readable: true }, { kind: 'text', text: 'Quero fazer um test drive', truncated: false });
const ILEGIVEL = conversation('id-ilegivel', { displayName: 'Nome escondido', phoneMasked: '+55 ••••• 0009', readable: false }, { kind: 'unreadable' });
const DOCUMENTO = conversation(
  'id-documento',
  { displayName: 'Bento Fictício', phoneMasked: null, readable: true },
  { kind: 'media', mediaType: 'document', caption: null, fileName: 'arquivo-secreto.pdf' },
);
const ALL = [AURORA, SEM_NOME, ILEGIVEL, DOCUMENTO];

const ids = (query: string) => filterConversations(ALL, query).map((item) => item.id);

describe('filterConversations', () => {
  it('sem termo devolve a mesma lista, sem copiar', () => {
    expect(filterConversations(ALL, '')).toBe(ALL);
    expect(filterConversations(ALL, '   ')).toBe(ALL);
  });

  it('ignora acentos, caixa e espaços extras', () => {
    expect(ids('AURORA   FICTICIA')).toEqual(['id-aurora']);
    expect(ids('  bento fictício ')).toEqual(['id-documento']);
  });

  it('encontra pelo telefone mascarado e pela prévia', () => {
    expect(ids('0003')).toEqual(['id-sem-nome']);
    expect(ids('test drive')).toEqual(['id-sem-nome']);
    expect(ids('Documento')).toEqual(['id-documento']);
  });

  it('contato ilegível não é encontrado por dado que a tela não mostra', () => {
    expect(ids('Nome escondido')).toEqual([]);
    expect(ids('0009')).toEqual([]);
    expect(ids('Contato ilegível')).toEqual(['id-ilegivel']);
  });

  it('não procura em campos fora da tela: id, horário, contagem e nome de arquivo', () => {
    expect(ids('id-aurora')).toEqual([]);
    expect(ids('2026-11-05')).toEqual([]);
    expect(ids('arquivo-secreto')).toEqual([]);
  });

  it('um termo não casa pedaços de campos diferentes', () => {
    expect(ids('Fictícia Prévia')).toEqual([]);
  });

  it('caractere especial é texto comum, não expressão regular', () => {
    expect(ids('.*')).toEqual([]);
    expect(ids('(')).toEqual([]);
  });
});

describe('contactInitials', () => {
  it.each([
    ['Aurora Fictícia', 'AF'],
    ['bento fictício', 'BF'],
    ['Ana Maria de Souza', 'AS'],
    ['Clara', 'C'],
    ['Ângela Óbidos', 'ÂÓ'],
    ['  😀 Davi  ', 'D'],
  ])('%s vira %s', (name, expected) => {
    expect(contactInitials(name)).toBe(expected);
  });

  it.each([[null], [''], ['   '], ['😀'], ['123']])('%s não tem iniciais', (name) => {
    expect(contactInitials(name)).toBeNull();
  });
});

describe('isSameBurst', () => {
  it('agrupa até 5 minutos, inclusive', () => {
    expect(isSameBurst('2026-11-05T12:00:00.000Z', '2026-11-05T12:05:00.000Z')).toBe(true);
    expect(isSameBurst('2026-11-05T12:00:00.000Z', '2026-11-05T12:05:01.000Z')).toBe(false);
  });
});

describe('mídia', () => {
  it('nenhum tipo usa o ícone de olho, e todo ícone existe', () => {
    for (const icon of Object.values(MEDIA_ICONS)) {
      expect(icon).not.toBe('eye');
      expect(ICONS[icon]).toBeDefined();
    }
    expect(MEDIA_ICONS.image).toBe('image');
    expect(MEDIA_ICONS.video).toBe('video');
  });

  it('o rótulo concorda em gênero com o tipo', () => {
    expect(MEDIA_RECEIVED_LABELS.image).toBe('Imagem recebida');
    expect(MEDIA_RECEIVED_LABELS.video).toBe('Vídeo recebido');
    expect(MEDIA_RECEIVED_LABELS.sticker).toBe('Figurinha recebida');
  });
});
