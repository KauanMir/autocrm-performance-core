// tests/components/users/UsersTabSection.test.tsx — roteador da composição
// da aba Usuários (M1-F S7-C). LegacyUsersTabContent/ContextualUsersTabContent
// são stubados — este arquivo cobre EXCLUSIVAMENTE a decisão de qual
// caminho montar, nunca o conteúdo interno de cada um (isso é coberto nos
// arquivos dedicados). Prova central: UsersTabSection nunca chama hook
// algum diretamente — só escolhe qual componente filho renderizar.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({
  isCompanySelectorEnabled: vi.fn(),
  legacyProps: { current: null as any },
  contextualProps: { current: null as any },
}));

vi.mock('@/lib/flags', () => ({ isCompanySelectorEnabled: m.isCompanySelectorEnabled }));

vi.mock('@/components/users/LegacyUsersTabContent', () => ({
  LegacyUsersTabContent: (props: any) => { m.legacyProps.current = props; return <div data-testid="legacy-stub" />; },
}));

vi.mock('@/components/users/ContextualUsersTabContent', () => ({
  ContextualUsersTabContent: (props: any) => { m.contextualProps.current = props; return <div data-testid="contextual-stub" />; },
}));

import { UsersTabSection } from '@/components/users/UsersTabSection';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

const BASE_PROPS = {
  userId: 'user-1',
  activeUsersEnabled: true,
  userLifecycleEnabled: true,
  userEmailEditEnabled: true,
};

beforeEach(() => {
  m.isCompanySelectorEnabled.mockReset();
  m.legacyProps.current = null;
  m.contextualProps.current = null;
});

describe('UsersTabSection — flag desligada', () => {
  it('Super Admin: monta LegacyUsersTabContent, nunca ContextualUsersTabContent', () => {
    m.isCompanySelectorEnabled.mockReturnValue(false);
    render(<UsersTabSection {...BASE_PROPS} actor={SUPER_ADMIN} />);
    expect(screen.getByTestId('legacy-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('contextual-stub')).toBeNull();
  });

  it('Manager: monta LegacyUsersTabContent', () => {
    m.isCompanySelectorEnabled.mockReturnValue(false);
    render(<UsersTabSection {...BASE_PROPS} actor={MANAGER} />);
    expect(screen.getByTestId('legacy-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('contextual-stub')).toBeNull();
  });
});

describe('UsersTabSection — flag ligada', () => {
  it('Super Admin: monta ContextualUsersTabContent, nunca LegacyUsersTabContent', () => {
    m.isCompanySelectorEnabled.mockReturnValue(true);
    render(<UsersTabSection {...BASE_PROPS} actor={SUPER_ADMIN} />);
    expect(screen.getByTestId('contextual-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-stub')).toBeNull();
  });

  it('Manager: continua no caminho legado, mesmo com a flag ligada (nunca vê o seletor)', () => {
    m.isCompanySelectorEnabled.mockReturnValue(true);
    render(<UsersTabSection {...BASE_PROPS} actor={MANAGER} />);
    expect(screen.getByTestId('legacy-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('contextual-stub')).toBeNull();
  });

  it('actor null: caminho legado (mesmo padrão de "sem capability")', () => {
    m.isCompanySelectorEnabled.mockReturnValue(true);
    render(<UsersTabSection {...BASE_PROPS} actor={null} />);
    expect(screen.getByTestId('legacy-stub')).toBeInTheDocument();
  });
});

describe('UsersTabSection — repasse de props', () => {
  it('repassa userId/actor/flags exatamente iguais para o componente escolhido', () => {
    m.isCompanySelectorEnabled.mockReturnValue(true);
    render(<UsersTabSection {...BASE_PROPS} actor={SUPER_ADMIN} />);
    expect(m.contextualProps.current).toMatchObject({
      userId: 'user-1', actor: SUPER_ADMIN, activeUsersEnabled: true, userLifecycleEnabled: true, userEmailEditEnabled: true,
    });
  });

  it('caminho legado recebe os mesmos props', () => {
    m.isCompanySelectorEnabled.mockReturnValue(false);
    render(<UsersTabSection {...BASE_PROPS} actor={MANAGER} />);
    expect(m.legacyProps.current).toMatchObject({
      userId: 'user-1', actor: MANAGER, activeUsersEnabled: true, userLifecycleEnabled: true, userEmailEditEnabled: true,
    });
  });
});
