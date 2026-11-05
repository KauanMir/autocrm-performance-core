'use client';
// components/whatsappInbox/ScreenConversas.tsx — W2B-8. Caixa de entrada WhatsApp,
// somente leitura. Defesa em profundidade: o App só oferece a tela com a capability,
// e ela reavalia a mesma capability antes de consultar. A autorização real é da rota
// e das RPCs. Nenhuma ação de escrita, envio ou vínculo com lead nesta fase.
import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import { LBadge, LBtn, LCard, PageHead, TopBar } from '@/components/ui/kit';
import { canAccessWhatsAppInbox } from '@/lib/capabilities';
import { isWhatsAppInboxDemoEnabled, isWhatsAppInboxEnabled } from '@/lib/flags';
import { useViewport } from '@/lib/hooks/useViewport';
import { useWhatsAppInboxConversations } from '@/lib/hooks/useWhatsAppInbox';
import { useOperationalCompanyContext } from '@/lib/operational/OperationalCompanyContext';
import { AuthService } from '@/lib/services';
import { gutterForWidth } from '@/lib/ui/breakpoints';
import { ConversationList } from './ConversationList';
import { ConversationThread } from './ConversationThread';
import { InboxLoading, InboxState, inboxErrorState } from './InboxStates';
import { filterConversations } from './inboxFormat';

// Área de trabalho, não página de leitura: passa do limite padrão de 1360px para os dois
// painéis aproveitarem monitores grandes. A largura do texto é limitada no histórico.
const INBOX_MAX_WIDTH = 1760;

function DemoNotice() {
  return (
    <div role="status" data-testid="whatsapp-inbox-demo-notice" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', marginBottom: 12, borderRadius: 11, fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: 'var(--amber)', background: 'var(--amber-bg)', border: '1px solid var(--amber-line)' }}>
      <Icon name="alert" size={16} stroke={2.2} style={{ flexShrink: 0 }} />
      Modo demonstração: dados fictícios gerados localmente. Nenhuma mensagem é real.
    </div>
  );
}

function NoSelection() {
  return <InboxState icon="message" title="Selecione uma conversa" text="O histórico aparece aqui." />;
}

export function ScreenConversas() {
  const { width, isMd, isDesktop } = useViewport();
  const { companyId } = useOperationalCompanyContext();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Fica aqui, e não na lista, para sobreviver à ida ao histórico no celular.
  const [search, setSearch] = useState('');

  const currentUser = AuthService.getCurrentUser();
  const allowed = canAccessWhatsAppInbox({
    platformRole: currentUser?.platformRole ?? null,
    companyId,
    inboxFlagEnabled: isWhatsAppInboxEnabled(),
  });
  // Comparação literal: em produção o bundler remove o aviso e todo o ramo de demonstração.
  const demo = process.env.NODE_ENV === 'development' && isWhatsAppInboxDemoEnabled();
  const source = demo ? 'demo' : 'api';

  const query = useWhatsAppInboxConversations({ companyId, enabled: allowed, source });
  const conversations = useMemo(() => query.data?.pages.flatMap((page) => page.conversations) ?? [], [query.data]);
  const visibleConversations = useMemo(() => filterConversations(conversations, search), [conversations, search]);
  // Procura na lista completa: filtrar não fecha a conversa aberta.
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  if (!allowed || companyId === null) return null;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['whatsapp-inbox'] });
  const refreshing = query.isFetching && !query.isPending;
  const gx = gutterForWidth(width);

  const list = (
    <ConversationList
      conversations={visibleConversations}
      totalLoaded={conversations.length}
      search={search}
      onSearchChange={setSearch}
      selectedId={selectedId}
      onSelect={setSelectedId}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
  const thread = selected && (
    <ConversationThread
      key={selected.id}
      companyId={companyId}
      conversation={selected}
      source={source}
      onBack={isMd ? undefined : () => setSelectedId(null)}
    />
  );

  let content: React.ReactNode;
  if (query.isPending) {
    content = <div style={{ width: '100%', overflow: 'hidden' }}><InboxLoading label="Carregando conversas" rows={isMd ? 7 : 6} /></div>;
  } else if (query.isError) {
    content = <div style={{ width: '100%' }}><InboxState {...inboxErrorState(query.error, 'as conversas')} onRetry={() => void query.refetch()} /></div>;
  } else if (conversations.length === 0) {
    content = (
      <div style={{ width: '100%' }}>
        <InboxState icon="inbox" title="Nenhuma conversa ainda" text="As mensagens recebidas pelo WhatsApp da empresa aparecem aqui depois que a captura for ativada." />
      </div>
    );
  } else if (isMd) {
    content = (
      <>
        <div style={{ width: isDesktop ? 'clamp(320px, 25vw, 400px)' : 296, flexShrink: 0, minHeight: 0, borderRight: '1px solid var(--border)' }}>{list}</div>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{thread ?? <NoSelection />}</div>
      </>
    );
  } else {
    content = <div style={{ width: '100%', minHeight: 0 }}>{thread ?? list}</div>;
  }

  const refreshButton = (
    <LBtn kind="ghost" icon="refresh" size="sm" aria-label="Atualizar conversas" onClick={refresh} style={{ opacity: refreshing ? 0.6 : 1 }}>
      {isMd ? (refreshing ? 'Atualizando…' : 'Atualizar') : undefined}
    </LBtn>
  );

  return (
    <div data-testid="whatsapp-inbox-screen" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--t-900)', overflow: 'hidden' }}>
      <TopBar />
      <div style={{ flex: 1, minHeight: 0, width: '100%', maxWidth: INBOX_MAX_WIDTH, margin: '0 auto', display: 'flex', flexDirection: 'column', padding: isMd ? `22px ${gx}px 22px` : `12px ${gx}px 12px` }}>
        {isMd ? (
          <PageHead
            title="Conversas"
            sub="Mensagens recebidas pelo WhatsApp."
            actions={<><LBadge tone="amber"><Icon name="lock" size={12} stroke={2.4} /> Somente leitura</LBadge>{refreshButton}</>}
          />
        ) : (
          !selected && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <LBadge tone="amber"><Icon name="lock" size={12} stroke={2.4} /> Somente leitura</LBadge>
              {refreshButton}
            </div>
          )
        )}
        {demo && <DemoNotice />}
        <LCard pad={0} style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>{content}</LCard>
      </div>
    </div>
  );
}
