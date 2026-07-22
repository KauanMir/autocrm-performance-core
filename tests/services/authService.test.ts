// tests/services/authService.test.ts — M1-F S4-F1: _loadProfile() passa a
// carregar também a membership ATIVA (company_memberships), nunca
// profiles.role legado. Supabase mockado por completo — nenhuma rede real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  profilesSingle: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  profilesEq: vi.fn(),
  membershipEq1: vi.fn(),
  membershipEq2: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      getSession: mocks.getSession,
      signOut: mocks.signOut,
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: mocks.profilesEq.mockReturnValue({ single: mocks.profilesSingle }),
          }),
        };
      }
      if (table === 'company_memberships') {
        return {
          select: () => ({
            eq: mocks.membershipEq1.mockReturnValue({
              eq: mocks.membershipEq2.mockReturnValue({ maybeSingle: mocks.membershipMaybeSingle }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in mock: ${table}`);
    },
  },
  isSupabaseConfigured: true,
}));

import { AuthService } from '@/lib/services';

const PROFILE_BASE = {
  id: 'profile-1',
  company_id: 'company-a',
  name: 'Fixture',
  email: 'fixture@exemplo.test',
  role: 'manager',
  seller_id: null,
  is_active: true,
  platform_role: null,
};

function mockProfile(overrides: Partial<typeof PROFILE_BASE> = {}, error: unknown = null) {
  mocks.profilesSingle.mockResolvedValue({ data: { ...PROFILE_BASE, ...overrides }, error });
}

function mockMembership(data: unknown, error: unknown = null) {
  mocks.membershipMaybeSingle.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: 'profile-1', email: 'fixture@exemplo.test' } }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'profile-1', email: 'fixture@exemplo.test' } } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthService.login — carrega activeMembership junto do profile', () => {
  it('Manager com membership ativa: activeMembership = { companyId, role: manager }', async () => {
    mockProfile();
    mockMembership({ company_id: 'company-a', role: 'manager', is_active: true });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user?.activeMembership).toEqual({ companyId: 'company-a', role: 'manager' });
  });

  it('Super Admin sem nenhuma membership: activeMembership = null (nunca lança, nunca inventa)', async () => {
    mockProfile({ platform_role: 'super_admin', company_id: null });
    mockMembership(null);

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user?.platformRole).toBe('super_admin');
    expect(user?.activeMembership).toBeNull();
  });

  it('Seller com membership ativa: activeMembership.role = seller (nunca manager)', async () => {
    mockProfile({ role: 'seller' });
    mockMembership({ company_id: 'company-a', role: 'seller', is_active: true });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user?.activeMembership).toEqual({ companyId: 'company-a', role: 'seller' });
  });

  it('erro na consulta de membership: activeMembership = null, login NÃO falha por causa disso', async () => {
    mockProfile();
    mockMembership(null, { code: '42501', message: 'permission denied' });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user).not.toBeNull();
    expect(user?.activeMembership).toBeNull();
  });

  it('consulta de membership filtra por profile_id=id do profile carregado e is_active=true', async () => {
    mockProfile({ id: 'profile-xyz' });
    mockMembership({ company_id: 'company-a', role: 'manager', is_active: true });

    await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(mocks.membershipEq1).toHaveBeenCalledWith('profile_id', 'profile-xyz');
    expect(mocks.membershipEq2).toHaveBeenCalledWith('is_active', true);
  });

  it('profile inativo: login inteiro falha ANTES de qualquer consulta de membership (is_active=false continua rejeitando tudo)', async () => {
    mockProfile({ is_active: false });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user).toBeNull();
    expect(mocks.membershipEq1).not.toHaveBeenCalled();
  });

  it('Super Admin com profile INATIVO: login retorna null — platform_role=super_admin nunca contorna is_active=false, canManageInvites nem chega a ser chamada (nenhum User é construído)', async () => {
    mockProfile({ platform_role: 'super_admin', company_id: null, is_active: false });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user).toBeNull();
    expect(mocks.membershipEq1).not.toHaveBeenCalled();
  });
});

describe('AuthService.restoreSession — mesmo comportamento de membership', () => {
  it('Manager com membership ativa é restaurado com activeMembership correto', async () => {
    mockProfile();
    mockMembership({ company_id: 'company-a', role: 'manager', is_active: true });

    const user = await AuthService.restoreSession();

    expect(user?.activeMembership).toEqual({ companyId: 'company-a', role: 'manager' });
  });
});
