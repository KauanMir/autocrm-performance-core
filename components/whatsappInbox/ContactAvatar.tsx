'use client';
// components/whatsappInbox/ContactAvatar.tsx — W2B-8. Avatar sem foto: as iniciais e o
// tom diferenciam contatos parecidos. O tom vem do id da conversa, nunca do nome ou do
// telefone, então é estável e não deriva de dado pessoal. Dourado, vermelho, âmbar e
// verde ficam fora da paleta porque já têm significado no CRM.
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import type { WhatsAppInboxContact } from '@/lib/integrations/whatsappInboxRequest';
import { contactInitials } from './inboxFormat';

const TONES: ReadonlyArray<{ from: string; to: string; ink: string }> = [
  { from: '#31506B', to: '#1F3447', ink: '#D6E7F6' },
  { from: '#2C5A54', to: '#1B3B37', ink: '#CDEFE8' },
  { from: '#573A63', to: '#3A2642', ink: '#ECD8F3' },
  { from: '#6A4438', to: '#482D25', ink: '#F7DFD5' },
  { from: '#50562F', to: '#363A20', ink: '#E9ECC9' },
  { from: '#3E4274', to: '#2A2C50', ink: '#DBDDF8' },
  { from: '#633B4B', to: '#432733', ink: '#F5D8E2' },
  { from: '#3C4A55', to: '#283138', ink: '#D9E2E9' },
];

const UNREADABLE_TONE = { from: '#2A2A2E', to: '#1C1C1F', ink: '#8B8B93' };

function toneFor(seed: string) {
  const sum = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
  return TONES[sum % TONES.length];
}

export function ContactAvatar({ contact, seed, size = 42, selected = false }: {
  contact: WhatsAppInboxContact;
  seed: string;
  size?: number;
  selected?: boolean;
}) {
  const tone = contact.readable ? toneFor(seed) : UNREADABLE_TONE;
  const initials = contact.readable ? contactInitials(contact.displayName) : null;
  const shadow = selected
    ? '0 0 0 2px var(--surface), 0 0 0 3.5px rgba(212,175,55,.72)'
    : 'inset 0 1px 0 rgba(255,255,255,.1), inset 0 0 0 1px rgba(255,255,255,.05)';
  return (
    <span
      aria-hidden="true"
      data-testid="whatsapp-inbox-avatar"
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
        background: `linear-gradient(145deg, ${tone.from}, ${tone.to})`, color: tone.ink, boxShadow: shadow,
        fontFamily: 'Archivo, sans-serif', fontWeight: 700, fontSize: Math.round(size * 0.35), letterSpacing: '.03em',
        transition: 'box-shadow .16s ease',
      }}
    >
      {initials ?? <Icon name={contact.readable ? 'user' : 'lock'} size={Math.round(size * 0.44)} stroke={2} />}
    </span>
  );
}
