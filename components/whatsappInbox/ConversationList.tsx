'use client';
// components/whatsappInbox/ConversationList.tsx — W2B-8. Lista de conversas com busca
// local. A busca filtra em memória o que a página já carregou: não consulta a API, não
// vai para a URL nem para o armazenamento do navegador. Nome e prévia vêm do cliente e
// são sempre texto: React escapa, e nada aqui usa HTML cru.
import React, { useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import type { WhatsAppInboxBody, WhatsAppInboxConversation } from '@/lib/integrations/whatsappInboxRequest';
import { ContactAvatar } from './ContactAvatar';
import { InboxState } from './InboxStates';
import { contactLabel, conversationTime, fullTimestamp, MEDIA_ICONS, previewLabel } from './inboxFormat';

function PreviewIcon({ body }: { body: WhatsAppInboxBody }) {
  if (body.kind === 'media') {
    return <Icon name={MEDIA_ICONS[body.mediaType]} size={13} stroke={2.2} style={{ flexShrink: 0, color: 'var(--t-500)' }} />;
  }
  if (body.kind === 'unsupported') {
    return <Icon name="alert" size={13} stroke={2.2} style={{ flexShrink: 0, color: 'var(--t-500)' }} />;
  }
  if (body.kind === 'unreadable') {
    return <Icon name="lock" size={13} stroke={2.2} style={{ flexShrink: 0, color: 'var(--red)' }} />;
  }
  return null;
}

function ConversationRow({ conversation, selected, onSelect }: {
  conversation: WhatsAppInboxConversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { id, contact, preview, lastMessageAt } = conversation;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      data-testid="whatsapp-inbox-conversation"
      className="focus-ring inbox-row"
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', marginBottom: 2, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
    >
      <ContactAvatar contact={contact} seed={id} selected={selected} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="tnum" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 650, lineHeight: 1.3, color: 'var(--t-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contactLabel(contact)}
          </span>
          <time dateTime={lastMessageAt} title={fullTimestamp(lastMessageAt)} className="tnum" style={{ flexShrink: 0, fontSize: 11.5, fontWeight: selected ? 600 : 500, color: selected ? 'var(--gold-ink)' : 'var(--t-500)' }}>
            {conversationTime(lastMessageAt)}
          </time>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 13, lineHeight: 1.35, color: selected ? 'var(--t-700)' : 'var(--t-500)' }}>
          <PreviewIcon body={preview} />
          <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{previewLabel(preview)}</span>
        </div>
      </div>
    </button>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };
  return (
    <div className="inbox-search">
      <Icon name="search" size={15} stroke={2.2} style={{ flexShrink: 0, color: 'var(--t-500)' }} />
      <input
        ref={inputRef}
        type="search"
        aria-label="Buscar conversas"
        placeholder="Nome, telefone ou prévia"
        value={value}
        maxLength={80}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape' && value !== '') clear(); }}
      />
      {value !== '' && (
        <button type="button" aria-label="Limpar busca" className="focus-ring inbox-search-clear" onClick={clear}>
          <Icon name="x" size={14} stroke={2.4} />
        </button>
      )}
    </div>
  );
}

export function ConversationList({ conversations, totalLoaded, search, onSearchChange, selectedId, onSelect, hasMore, loadingMore, onLoadMore }: {
  conversations: WhatsAppInboxConversation[];
  totalLoaded: number;
  search: string;
  onSearchChange: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const searching = search.trim() !== '';
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div role="search" style={{ flexShrink: 0, padding: '10px 10px 8px' }}>
        <SearchField value={search} onChange={onSearchChange} />
        <div role="status" data-testid="whatsapp-inbox-search-status" style={{ padding: searching ? '7px 3px 0' : 0, fontSize: 12, lineHeight: 1.35, color: 'var(--t-500)' }}>
          {searching && `${conversations.length} de ${totalLoaded} ${totalLoaded === 1 ? 'conversa' : 'conversas'}${hasMore ? ' carregadas' : ''}`}
        </div>
      </div>
      <nav aria-label="Conversas" data-testid="whatsapp-inbox-list" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px' }}>
        {searching && conversations.length === 0 && (
          <InboxState
            icon="search"
            title="Nenhuma conversa encontrada"
            text={hasMore ? 'A busca cobre só as conversas já carregadas. Carregue mais ou tente outro termo.' : 'Tente outro nome, telefone ou trecho da prévia.'}
            action={<LBtn kind="ghost" size="sm" onClick={() => onSearchChange('')}>Limpar busca</LBtn>}
          />
        )}
        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            selected={conversation.id === selectedId}
            onSelect={() => onSelect(conversation.id)}
          />
        ))}
        {hasMore && (
          <div style={{ padding: '6px 5px 8px' }}>
            <LBtn kind="ghost" size="sm" block onClick={() => { if (!loadingMore) onLoadMore(); }}>
              {loadingMore ? 'Carregando…' : 'Carregar mais conversas'}
            </LBtn>
          </div>
        )}
      </nav>
    </div>
  );
}
