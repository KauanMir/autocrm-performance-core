// tests/components/users/LegacyUsersTabContent.test.tsx — composição
// ANTIGA da aba Usuários (M1-F S5-D/S6-F), preservada byte a byte pelo
// S7-C. ActiveUserList/InactiveUserList/InviteList são stubados — prova
// central: renderiza SEM QueryClientProvider (nenhum hook novo é
// chamado), confirmando que o caminho legado nunca monta
// useCompanyScopeFilter/useCompanies.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({
  activeUserListProps: { current: null as any },
  inactiveUserListProps: { current: null as any },
  inviteListProps: { current: null as any },
}));

vi.mock('@/components/users/ActiveUserList', () => ({
  ActiveUserList: (props: any) => { m.activeUserListProps.current = props; return <div data-testid="active-user-list-stub" />; },
}));
vi.mock('@/components/users/InactiveUserList', () => ({
  InactiveUserList: (props: any) => { m.inactiveUserListProps.current = props; return <div data-testid="inactive-user-list-stub" />; },
}));
vi.mock('@/components/invites/InviteList', () => ({
  InviteList: (props: any) => { m.inviteListProps.current = props; return <div data-testid="invite-list-stub" />; },
}));

import { LegacyUsersTabContent } from '@/components/users/LegacyUsersTabContent';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };

beforeEach(() => {
  m.activeUserListProps.current = null;
  m.inactiveUserListProps.current = null;
  m.inviteListProps.current = null;
});

describe('LegacyUsersTabContent — renderiza SEM QueryClientProvider (nenhum hook novo)', () => {
  it('não lança "No QueryClient set" — a própria montagem já prova ausência de hook de rede novo', () => {
    expect(() =>
      render(
        <LegacyUsersTabContent
          userId="user-1" actor={SUPER_ADMIN}
          activeUsersEnabled userLifecycleEnabled userEmailEditEnabled
        />,
      ),
    ).not.toThrow();
  });
});

describe('LegacyUsersTabContent — flags e ordem', () => {
  it('ambas ligadas: ActiveUserList, InactiveUserList e InviteList aparecem, nessa ordem', () => {
    render(
      <LegacyUsersTabContent
        userId="user-1" actor={SUPER_ADMIN}
        activeUsersEnabled userLifecycleEnabled userEmailEditEnabled
      />,
    );
    const active = screen.getByTestId('active-user-list-stub');
    const inactive = screen.getByTestId('inactive-user-list-stub');
    const invites = screen.getByTestId('invite-list-stub');
    // eslint-disable-next-line no-bitwise
    expect(active.compareDocumentPosition(inactive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(inactive.compareDocumentPosition(invites) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('activeUsersEnabled=false: ActiveUserList nunca monta, InviteList continua', () => {
    render(
      <LegacyUsersTabContent
        userId="user-1" actor={SUPER_ADMIN}
        activeUsersEnabled={false} userLifecycleEnabled userEmailEditEnabled={false}
      />,
    );
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });

  it('userLifecycleEnabled=false: InactiveUserList nunca monta', () => {
    render(
      <LegacyUsersTabContent
        userId="user-1" actor={SUPER_ADMIN}
        activeUsersEnabled userLifecycleEnabled={false} userEmailEditEnabled={false}
      />,
    );
    expect(screen.queryByTestId('inactive-user-list-stub')).toBeNull();
  });

  it('ambas desligadas: só InviteList (sempre presente)', () => {
    render(
      <LegacyUsersTabContent
        userId="user-1" actor={SUPER_ADMIN}
        activeUsersEnabled={false} userLifecycleEnabled={false} userEmailEditEnabled={false}
      />,
    );
    expect(screen.queryByTestId('active-user-list-stub')).toBeNull();
    expect(screen.queryByTestId('inactive-user-list-stub')).toBeNull();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
  });
});

describe('LegacyUsersTabContent — nenhum prop de filtro externo é passado', () => {
  it('ActiveUserList/InactiveUserList/InviteList recebem userId/actor, mas nunca externalCompanyFilterId', () => {
    render(
      <LegacyUsersTabContent
        userId="user-1" actor={SUPER_ADMIN}
        activeUsersEnabled userLifecycleEnabled userEmailEditEnabled
      />,
    );
    expect(m.activeUserListProps.current.externalCompanyFilterId).toBeUndefined();
    expect(m.inactiveUserListProps.current.externalCompanyFilterId).toBeUndefined();
    expect(m.inviteListProps.current.externalCompanyFilterId).toBeUndefined();
    expect(m.activeUserListProps.current.userId).toBe('user-1');
    expect(m.inviteListProps.current.actor).toEqual(SUPER_ADMIN);
  });
});
