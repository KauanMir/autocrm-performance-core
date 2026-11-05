'use client';
// components/whatsappInbox/InboxStates.tsx — W2B-8. Estados de carregamento, vazio e
// erro da inbox. A mensagem depende só de códigos do catálogo da API: texto de erro
// bruto nunca chega à tela.
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { WhatsAppInboxRequestError } from '@/lib/hooks/useWhatsAppInbox';

export type InboxStateContent = { icon: string; title: string; text: string; tone?: 'neutral' | 'error'; retry?: boolean };

export function inboxErrorState(error: unknown, subject: string): InboxStateContent {
  const code = error instanceof WhatsAppInboxRequestError ? error.code : 'request_failed';
  switch (code) {
    case 'inbox_disabled':
      return { icon: 'lock', title: 'Caixa de entrada desativada', text: 'A leitura de conversas está desligada neste ambiente.' };
    case 'inbox_unavailable':
      return { icon: 'wifiOff', title: 'Caixa de entrada indisponível', text: 'A leitura de conversas ainda não está disponível neste ambiente.', tone: 'error', retry: true };
    case 'unauthenticated':
      return { icon: 'lock', title: 'Sessão expirada', text: 'Entre novamente para continuar.', tone: 'error' };
    case 'forbidden':
      return { icon: 'lock', title: 'Sem permissão', text: 'Seu acesso não permite ler estas conversas.', tone: 'error' };
    case 'conversation_not_found':
      return { icon: 'message', title: 'Conversa não encontrada', text: 'Ela pode não existir mais. Atualize a lista.', tone: 'error' };
    default:
      return { icon: 'alert', title: 'Algo deu errado', text: `Não foi possível carregar ${subject}.`, tone: 'error', retry: true };
  }
}

export function InboxState({ icon, title, text, tone = 'neutral', retry = true, onRetry, action }: InboxStateContent & { onRetry?: () => void; action?: React.ReactNode }) {
  const error = tone === 'error';
  return (
    <div role={error ? 'alert' : 'status'} data-testid={error ? 'whatsapp-inbox-error' : 'whatsapp-inbox-state'} style={{ height: '100%', minHeight: 220, display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', margin: '0 auto 14px', background: error ? 'var(--red-bg)' : 'rgba(255,255,255,.05)', color: error ? 'var(--red)' : 'var(--t-500)' }}>
          <Icon name={icon} size={22} stroke={2} />
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--t-900)', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--t-500)' }}>{text}</div>
        {error && retry && onRetry && (
          <div style={{ marginTop: 16 }}>
            <LBtn kind="ghost" icon="refresh" size="sm" onClick={onRetry}>Tentar novamente</LBtn>
          </div>
        )}
        {action && <div style={{ marginTop: 16 }}>{action}</div>}
      </div>
    </div>
  );
}

function Block({ width, height, radius = 6 }: { width: number | string; height: number; radius?: number | string }) {
  return <span style={{ display: 'block', width, height, borderRadius: radius, background: 'rgba(255,255,255,.07)', animation: 'breatheSoft 1.6s ease-in-out infinite' }} />;
}

export function InboxLoading({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-testid="whatsapp-inbox-loading" style={{ padding: 8 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px' }}>
          <Block width={40} height={40} radius="50%" />
          <div style={{ flex: 1, display: 'grid', gap: 8 }}>
            <Block width={`${54 - index * 5}%`} height={12} />
            <Block width={`${82 - index * 7}%`} height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}
