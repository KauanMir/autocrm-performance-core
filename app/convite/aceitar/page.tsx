// app/convite/aceitar/page.tsx — Server Component mínimo (M1-F S4-C2B).
// Nunca lê o fragmento (que não existe no servidor), nunca autentica,
// nunca aceita, nunca registra a URL. Delega tudo à única fronteira
// 'use client' desta rota: AcceptInviteFlow.
import type { Metadata } from 'next';
import { AcceptInviteFlow } from '@/components/invites/AcceptInviteFlow';

export const metadata: Metadata = {
  title: 'Convite — AutoCRM',
  description: 'Ative sua conta no AutoCRM.',
};

export default function AceitarConvitePage() {
  return <AcceptInviteFlow />;
}
