'use client';
// components/whatsappInbox/ConversationThread.tsx — W2B-8. Histórico de uma conversa,
// somente leitura. Sem campo de resposta de propósito: o rodapé diz que o envio não
// existe, em vez de exibir um controle desabilitado que pareça quase pronto.
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import type { WhatsAppInboxSource } from '@/lib/hooks/useWhatsAppInbox';
import { useWhatsAppInboxMessages } from '@/lib/hooks/useWhatsAppInbox';
import type {
  WhatsAppInboxBody,
  WhatsAppInboxConversation,
  WhatsAppInboxMessage,
} from '@/lib/integrations/whatsappInboxRequest';
import { ContactAvatar } from './ContactAvatar';
import { InboxLoading, InboxState, inboxErrorState } from './InboxStates';
import { contactLabel, dayKey, dayLabel, fullTimestamp, isSameBurst, MEDIA_ICONS, MEDIA_LABELS, MEDIA_RECEIVED_LABELS, messageTime, unsupportedLabel } from './inboxFormat';

// Coluna de leitura: em monitores grandes a conversa fica centralizada, sem esticar as
// linhas de texto. Cabeçalho e rodapé usam a mesma coluna para alinhar com as mensagens.
const CHAT_COLUMN: React.CSSProperties = { width: '100%', maxWidth: 960, margin: '0 auto' };
const CHAT_GUTTER = 'clamp(14px, 2.6vw, 28px)';

const BUBBLE: React.CSSProperties = {
  maxWidth: 'min(84%, 640px)', padding: '8px 12px 7px', background: 'var(--surface-3)', border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-sm)', color: 'var(--t-900)', fontSize: 14.5, lineHeight: 1.45,
};

const NOTICE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 11, fontSize: 13,
  color: 'var(--t-500)', border: '1px dashed var(--border)', background: 'rgba(255,255,255,.02)',
};

const TIME_STYLE: React.CSSProperties = { fontSize: 11, lineHeight: '16px', color: 'var(--t-500)' };

function MessageTime({ iso, style }: { iso: string; style?: React.CSSProperties }) {
  return <time dateTime={iso} title={fullTimestamp(iso)} className="tnum" style={{ ...TIME_STYLE, ...style }}>{messageTime(iso)}</time>;
}

// O horário flutua no fim do texto: mensagem curta fica em uma linha só, como num chat.
const FLOATING_TIME: React.CSSProperties = { float: 'right', margin: '6px -1px -2px 14px' };

function MediaCard({ body }: { body: Extract<WhatsAppInboxBody, { kind: 'media' }> }) {
  return (
    <div data-testid="whatsapp-inbox-media" style={{ width: 304, maxWidth: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--t-700)', background: 'rgba(255,255,255,.04)', border: '1px dashed rgba(255,255,255,.2)' }}>
        <Icon name={MEDIA_ICONS[body.mediaType]} size={20} stroke={1.9} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650, lineHeight: 1.35, color: 'var(--t-900)', overflowWrap: 'anywhere' }}>{body.fileName ?? MEDIA_RECEIVED_LABELS[body.mediaType]}</div>
        <div style={{ marginTop: 2, fontSize: 12, lineHeight: 1.35, color: 'var(--t-500)' }}>{body.fileName ? `${MEDIA_LABELS[body.mediaType]} ainda não disponível no CRM` : 'Arquivo ainda não disponível no CRM'}</div>
      </div>
    </div>
  );
}

function MessageContent({ body, occurredAt }: { body: WhatsAppInboxBody; occurredAt: string }) {
  if (body.kind === 'text') {
    return (
      <div style={{ display: 'flow-root' }}>
        <span data-testid="whatsapp-inbox-text" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body.text}</span>
        {body.truncated && <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--amber)' }}>Mensagem longa: exibindo só o início.</span>}
        <MessageTime iso={occurredAt} style={FLOATING_TIME} />
      </div>
    );
  }

  if (body.kind === 'media') {
    return (
      <>
        <MediaCard body={body} />
        <div style={{ display: 'flow-root', marginTop: body.caption ? 9 : 0 }}>
          {body.caption && <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body.caption}</span>}
          <MessageTime iso={occurredAt} style={FLOATING_TIME} />
        </div>
      </>
    );
  }

  return null;
}

function MessageItem({ message, grouped }: { message: WhatsAppInboxMessage; grouped: boolean }) {
  const { body, occurredAt } = message;
  const marginTop = grouped ? 3 : 12;

  if (body.kind === 'unsupported' || body.kind === 'unreadable') {
    const unreadable = body.kind === 'unreadable';
    return (
      <div data-testid={unreadable ? 'whatsapp-inbox-unreadable' : 'whatsapp-inbox-unsupported'} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop }}>
        <span style={{ ...NOTICE, ...(unreadable ? { color: 'var(--red)', borderColor: 'var(--red-line)' } : null) }}>
          <Icon name={unreadable ? 'lock' : 'alert'} size={14} stroke={2.2} style={{ flexShrink: 0 }} />
          {unreadable ? 'Mensagem ilegível' : unsupportedLabel(body.messageType)}
        </span>
        <MessageTime iso={occurredAt} style={{ flexShrink: 0 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', marginTop }}>
      <div style={{ ...BUBBLE, borderRadius: grouped ? 15 : '5px 15px 15px 15px' }}>
        <MessageContent body={body} occurredAt={occurredAt} />
      </div>
    </div>
  );
}

// Fica presa ao topo enquanto o dia correspondente está na tela.
function DaySeparator({ iso }: { iso: string }) {
  return (
    <div role="separator" style={{ position: 'sticky', top: 8, zIndex: 1, display: 'flex', justifyContent: 'center', marginTop: 16, pointerEvents: 'none' }}>
      <span style={{ padding: '3px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, lineHeight: '16px', color: 'var(--t-700)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>{dayLabel(iso)}</span>
    </div>
  );
}

function groupByDay(messages: WhatsAppInboxMessage[]): WhatsAppInboxMessage[][] {
  const days: WhatsAppInboxMessage[][] = [];
  for (const message of messages) {
    const day = days[days.length - 1];
    if (day && dayKey(day[0].occurredAt) === dayKey(message.occurredAt)) day.push(message);
    else days.push([message]);
  }
  return days;
}

export function ConversationThread({ companyId, conversation, source, onBack }: {
  companyId: string;
  conversation: WhatsAppInboxConversation;
  source: WhatsAppInboxSource;
  // Só no celular, onde a lista e o histórico não aparecem juntos.
  onBack?: () => void;
}) {
  const query = useWhatsAppInboxMessages({ companyId, conversationId: conversation.id, enabled: true, source });
  const scrollRef = useRef<HTMLDivElement>(null);
  const heightBeforeOlderPage = useRef<number | null>(null);

  // A primeira página é a mais recente: páginas antigas entram antes dela.
  const messages = useMemo(
    () => [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.messages),
    [query.data],
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || messages.length === 0) return;
    // Ao carregar mensagens antigas, mantém o leitor na mesma mensagem.
    element.scrollTop = heightBeforeOlderPage.current === null
      ? element.scrollHeight
      : element.scrollHeight - heightBeforeOlderPage.current;
    heightBeforeOlderPage.current = null;
  }, [messages]);

  const loadOlder = () => {
    if (query.isFetchingNextPage) return;
    heightBeforeOlderPage.current = scrollRef.current?.scrollHeight ?? null;
    void query.fetchNextPage();
  };

  const days = useMemo(() => groupByDay(messages), [messages]);

  const { contact } = conversation;
  return (
    <section aria-label={`Conversa com ${contactLabel(contact)}`} data-testid="whatsapp-inbox-thread" style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <header style={{ padding: `11px ${CHAT_GUTTER}`, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ ...CHAT_COLUMN, display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Voltar para as conversas" className="focus-ring" style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)', flexShrink: 0 }}>
              <Icon name="arrowLeft" size={17} stroke={2.2} />
            </button>
          )}
          <ContactAvatar contact={contact} seed={conversation.id} size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="tnum" style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.3, color: 'var(--t-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactLabel(contact)}</div>
            {contact.displayName && contact.phoneMasked && <div className="tnum" style={{ marginTop: 1, fontSize: 12, lineHeight: 1.35, color: 'var(--t-500)' }}>{contact.phoneMasked}</div>}
          </div>
        </div>
      </header>

      <div ref={scrollRef} data-testid="whatsapp-inbox-messages" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: `0 ${CHAT_GUTTER} 16px`, background: 'rgba(0,0,0,.2)' }}>
        {query.isPending && <InboxLoading label="Carregando mensagens" />}
        {query.isError && <InboxState {...inboxErrorState(query.error, 'as mensagens')} onRetry={() => void query.refetch()} />}
        {query.isSuccess && messages.length === 0 && <InboxState icon="message" title="Sem mensagens" text="Esta conversa não tem mensagens para exibir." />}
        {/* Margem superior automática: conversa curta fica junto ao rodapé, como num chat. */}
        <div style={{ ...CHAT_COLUMN, margin: 'auto auto 0', flexShrink: 0 }}>
          {query.hasNextPage && (
            <div style={{ textAlign: 'center', padding: '10px 0 2px' }}>
              <LBtn kind="ghost" size="sm" onClick={loadOlder}>{query.isFetchingNextPage ? 'Carregando…' : 'Carregar mensagens anteriores'}</LBtn>
            </div>
          )}
          {days.map((day) => (
            <div key={dayKey(day[0].occurredAt)}>
              <DaySeparator iso={day[0].occurredAt} />
              {day.map((message, index) => (
                <MessageItem key={message.id} message={message} grouped={index > 0 && isSameBurst(day[index - 1].occurredAt, message.occurredAt)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <footer data-testid="whatsapp-inbox-readonly" style={{ padding: `10px ${CHAT_GUTTER}`, borderTop: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.4, color: 'var(--t-500)', flexShrink: 0 }}>
        <div style={{ ...CHAT_COLUMN, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={14} stroke={2.2} style={{ flexShrink: 0 }} />
          Somente leitura. Responder pelo CRM ainda não está disponível.
        </div>
      </footer>
    </section>
  );
}
