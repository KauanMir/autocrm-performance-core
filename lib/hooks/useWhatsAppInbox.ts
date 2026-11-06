// lib/hooks/useWhatsAppInbox.ts — W2B-8. Leitura paginada da inbox WhatsApp. A
// capability é resolvida pelo chamador. Conteúdo decifrado fica só na memória: gcTime
// zero descarta o cache ao sair da tela, e nada vai para localStorage. Sem polling.
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  fetchWhatsAppInboxConversations,
  fetchWhatsAppInboxMessages,
  type WhatsAppInboxConversationsPage,
  type WhatsAppInboxMessagesPage,
  type WhatsAppInboxResult,
} from '@/lib/integrations/whatsappInboxRequest';
import { AuthService } from '@/lib/services';

export class WhatsAppInboxRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'WhatsAppInboxRequestError';
  }
}

export type WhatsAppInboxSource = 'api' | 'demo';

async function accessToken(): Promise<string> {
  const { data } = await AuthService.getSession();
  const token = data.session?.access_token ?? null;
  if (!token) throw new WhatsAppInboxRequestError('unauthenticated');
  return token;
}

function unwrap<T>(result: WhatsAppInboxResult<T>): T {
  if (result.outcome === 'ok') return result.page;
  throw new WhatsAppInboxRequestError(result.outcome === 'domain_error' ? result.code : 'request_failed');
}

async function loadConversations(
  companyId: string,
  cursor: string | null,
  source: WhatsAppInboxSource,
  signal: AbortSignal,
): Promise<WhatsAppInboxConversationsPage> {
  // Comparação literal: o bundler remove este ramo, e os dados fictícios, do build de produção.
  if (process.env.NODE_ENV === 'development' && source === 'demo') {
    const { demoConversationsPage } = await import('@/lib/whatsapp/inboxDemoData');
    return demoConversationsPage();
  }
  return unwrap(await fetchWhatsAppInboxConversations({ companyId, cursor, accessToken: await accessToken() }, signal));
}

async function loadMessages(
  companyId: string,
  conversationId: string,
  cursor: string | null,
  source: WhatsAppInboxSource,
  signal: AbortSignal,
): Promise<WhatsAppInboxMessagesPage> {
  if (process.env.NODE_ENV === 'development' && source === 'demo') {
    const { demoMessagesPage } = await import('@/lib/whatsapp/inboxDemoData');
    return demoMessagesPage(conversationId);
  }
  return unwrap(
    await fetchWhatsAppInboxMessages({ companyId, conversationId, cursor, accessToken: await accessToken() }, signal),
  );
}

const QUERY_DEFAULTS = {
  gcTime: 0,
  staleTime: 30_000,
  retry: false,
  refetchOnWindowFocus: false,
  initialPageParam: null as string | null,
};

export function useWhatsAppInboxConversations(input: {
  companyId: string | null;
  enabled: boolean;
  source: WhatsAppInboxSource;
}) {
  const { companyId, enabled, source } = input;
  return useInfiniteQuery({
    ...QUERY_DEFAULTS,
    queryKey: ['whatsapp-inbox', source, companyId, 'conversations'],
    enabled: enabled && companyId !== null,
    queryFn: ({ pageParam, signal }) => loadConversations(companyId as string, pageParam, source, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useWhatsAppInboxMessages(input: {
  companyId: string | null;
  conversationId: string | null;
  enabled: boolean;
  source: WhatsAppInboxSource;
}) {
  const { companyId, conversationId, enabled, source } = input;
  return useInfiniteQuery({
    ...QUERY_DEFAULTS,
    queryKey: ['whatsapp-inbox', source, companyId, 'messages', conversationId],
    enabled: enabled && companyId !== null && conversationId !== null,
    queryFn: ({ pageParam, signal }) =>
      loadMessages(companyId as string, conversationId as string, pageParam, source, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
