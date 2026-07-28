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
  membershipEq: vi.fn(),
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
        // CORREÇÃO (M1-F S4-F2, bug real de produção encontrado em
        // validação E2E): a query real NUNCA filtra por profile_id — essa
        // coluna nunca foi concedida a authenticated (grant é só
        // company_id/role/is_active, m1f_s4f1_01), e referenciá-la em
        // QUALQUER parte da query (WHERE incluso) fazia o PostgREST negar
        // a query inteira com 42501. A RLS (profile_id = auth.uid()) já
        // restringe à própria linha — o único .eq() real é is_active=true.
        // Este mock antes tinha uma cadeia eq().eq() simulando um filtro
        // de profile_id que não existe mais.
        return {
          select: () => ({
            eq: mocks.membershipEq.mockReturnValue({ maybeSingle: mocks.membershipMaybeSingle }),
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

  it('consulta de membership filtra SOMENTE por is_active=true, nunca por profile_id (coluna não concedida a authenticated — RLS já restringe à própria linha, ver m1f_s4f1_01)', async () => {
    mockProfile({ id: 'profile-xyz' });
    mockMembership({ company_id: 'company-a', role: 'manager', is_active: true });

    await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(mocks.membershipEq).toHaveBeenCalledWith('is_active', true);
    expect(mocks.membershipEq).not.toHaveBeenCalledWith('profile_id', expect.anything());
  });

  it('profile inativo: login inteiro falha ANTES de qualquer consulta de membership (is_active=false continua rejeitando tudo)', async () => {
    mockProfile({ is_active: false });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user).toBeNull();
    expect(mocks.membershipEq).not.toHaveBeenCalled();
  });

  it('Super Admin com profile INATIVO: login retorna null — platform_role=super_admin nunca contorna is_active=false, canManageInvites nem chega a ser chamada (nenhum User é construído)', async () => {
    mockProfile({ platform_role: 'super_admin', company_id: null, is_active: false });

    const user = await AuthService.login('fixture@exemplo.test', 'senha-qualquer');

    expect(user).toBeNull();
    expect(mocks.membershipEq).not.toHaveBeenCalled();
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

// M1-F S6-E: hardening — restoreSession() precisa falhar fechado quando o
// profile por trás da sessão Auth não existe mais ou está globalmente
// inativo (mesma assimetria com login() encontrada na auditoria S6-A0:
// login() sempre fazia signOut() quando _loadProfile retornava null,
// restoreSession() nunca fazia). NUNCA deve encerrar a sessão só por causa
// de company_memberships (suspensa/desligada/ausente) — esse é o contrato
// central desta correção, testado explicitamente abaixo.
describe('AuthService.restoreSession — hardening de identidade (M1-F S6-E)', () => {
  it('profile inexistente (erro/sem linha): retorna null E encerra a sessão Auth (signOut), mesmo padrão de login()', async () => {
    mocks.profilesSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

    const user = await AuthService.restoreSession();

    expect(user).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('profile globalmente inativo (is_active=false): retorna null E encerra a sessão Auth (signOut)', async () => {
    mockProfile({ is_active: false });

    const user = await AuthService.restoreSession();

    expect(user).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('Super Admin globalmente inativo: retorna null E encerra a sessão Auth (platform_role nunca contorna is_active=false)', async () => {
    mockProfile({ platform_role: 'super_admin', company_id: null, is_active: false });

    const user = await AuthService.restoreSession();

    expect(user).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('membership ausente/suspensa (activeMembership=null): profile válido continua autenticado, signOut NUNCA é chamado', async () => {
    mockProfile();
    mockMembership(null); // sem linha ativa em company_memberships — suspensa, desligada ou nunca existiu, indistinguível daqui

    const user = await AuthService.restoreSession();

    expect(user).not.toBeNull();
    expect(user?.activeMembership).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('Super Admin sem membership própria: continua autenticado, signOut NUNCA é chamado', async () => {
    mockProfile({ platform_role: 'super_admin', company_id: null });
    mockMembership(null);

    const user = await AuthService.restoreSession();

    expect(user).not.toBeNull();
    expect(user?.platformRole).toBe('super_admin');
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('sem sessão Auth nenhuma (getSession sem session.user): retorna null sem chamar signOut (não há sessão para encerrar)', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    const user = await AuthService.restoreSession();

    expect(user).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
