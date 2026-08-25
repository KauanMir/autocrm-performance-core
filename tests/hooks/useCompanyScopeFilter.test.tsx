// tests/hooks/useCompanyScopeFilter.test.tsx — estado compartilhado do
// filtro contextual de empresa (M1-F S7-B, decisões congeladas em §26).
// useCompanies mockado — nenhuma rede real. Cobre exatamente as regras
// congeladas: null=visão global, validação contra a lista acessível,
// reset em troca de identidade/tipo de ator, Manager/Seller nunca
// consomem/definem o valor, nenhuma persistência em navegador.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({ useCompanies: vi.fn() }));

vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));

import { useCompanyScopeFilter } from '@/lib/hooks/useCompanyScopeFilter';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-a', name: 'Revenda Premium', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00', logo_path: null,
    ...overrides,
  };
}

function companiesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], companies: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.useCompanies.mockReturnValue(companiesResult({
    companies: [company({ id: 'company-a' }), company({ id: 'company-b', name: 'Revenda Secundária' })],
    hasData: true, isEmpty: false,
  }));
});

describe('useCompanyScopeFilter — estado inicial', () => {
  it('começa em null (visão global), mesmo para Super Admin', () => {
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    expect(result.current.companyFilterId).toBeNull();
    expect(result.current.isSuperAdmin).toBe(true);
  });

  it('actor null: companyFilterId sempre null, isSuperAdmin false', () => {
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'user-1', actor: null }));
    expect(result.current.companyFilterId).toBeNull();
    expect(result.current.isSuperAdmin).toBe(false);
  });
});

describe('useCompanyScopeFilter — Super Admin seleciona e troca de empresa', () => {
  it('Super Admin seleciona uma empresa: companyFilterId reflete o id escolhido', () => {
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(result.current.companyFilterId).toBe('company-a');
  });

  it('troca A -> B: companyFilterId reflete a nova seleção', () => {
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(result.current.companyFilterId).toBe('company-a');
    act(() => result.current.setCompanyFilterId('company-b'));
    expect(result.current.companyFilterId).toBe('company-b');
  });

  it('limpar a seleção (setCompanyFilterId(null)): volta para visão global', () => {
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    act(() => result.current.setCompanyFilterId(null));
    expect(result.current.companyFilterId).toBeNull();
  });
});

describe('useCompanyScopeFilter — reset por troca de identidade/tipo de ator', () => {
  it('troca de userId (troca de usuário/nova sessão): limpa a seleção', () => {
    const { result, rerender } = renderHook(
      ({ userId, actor }) => useCompanyScopeFilter({ userId, actor }),
      { initialProps: { userId: 'admin-1', actor: SUPER_ADMIN as CreateInviteActor | null } },
    );
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(result.current.companyFilterId).toBe('company-a');

    rerender({ userId: 'admin-2', actor: SUPER_ADMIN });
    expect(result.current.companyFilterId).toBeNull();
  });

  it('userId vira null (logout): limpa a seleção', () => {
    const { result, rerender } = renderHook(
      ({ userId, actor }) => useCompanyScopeFilter({ userId, actor }),
      { initialProps: { userId: 'admin-1' as string | null, actor: SUPER_ADMIN as CreateInviteActor | null } },
    );
    act(() => result.current.setCompanyFilterId('company-a'));
    rerender({ userId: null, actor: null });
    expect(result.current.companyFilterId).toBeNull();
  });

  it('troca de tipo de ator (Super Admin -> Manager, ex.: mudança de platform_role): limpa a seleção', () => {
    const { result, rerender } = renderHook(
      ({ actor }) => useCompanyScopeFilter({ userId: 'user-1', actor }),
      { initialProps: { actor: SUPER_ADMIN as CreateInviteActor | null } },
    );
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(result.current.companyFilterId).toBe('company-a');

    rerender({ actor: MANAGER });
    expect(result.current.companyFilterId).toBeNull();
  });
});

describe('useCompanyScopeFilter — validação contra useCompanies', () => {
  it('empresa selecionada removida da lista acessível: limpa para visão global assim que a lista carrega', () => {
    const { result, rerender } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(result.current.companyFilterId).toBe('company-a');

    // Empresa deixou de vir na fonte (removida/cancelada/inacessível).
    m.useCompanies.mockReturnValue(companiesResult({
      companies: [company({ id: 'company-b', name: 'Revenda Secundária' })],
      hasData: true, isEmpty: false,
    }));
    rerender();
    expect(result.current.companyFilterId).toBeNull();
  });

  it('lista ainda carregando (isLoading=true): não limpa prematuramente', () => {
    m.useCompanies.mockReturnValue(companiesResult({ isLoading: true }));
    const { result, rerender } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    rerender();
    expect(result.current.companyFilterId).toBe('company-a');
  });

  it('empresa selecionada continua na lista: nada é limpo', () => {
    const { result, rerender } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    rerender();
    expect(result.current.companyFilterId).toBe('company-a');
  });
});

describe('useCompanyScopeFilter — Manager/Seller nunca consomem ou definem o valor', () => {
  it('Manager: companyFilterId é sempre null, mesmo tentando setCompanyFilterId', () => {
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'manager-1', actor: MANAGER }));
    expect(result.current.companyFilterId).toBeNull();
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(result.current.companyFilterId).toBeNull();
  });

  it('Manager: useCompanies é chamado com authorized=false (nunca busca a lista global)', () => {
    renderHook(() => useCompanyScopeFilter({ userId: 'manager-1', actor: MANAGER }));
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: false }));
  });

  it('Super Admin: useCompanies é chamado com authorized=true', () => {
    renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: true }));
  });
});

describe('useCompanyScopeFilter — nenhuma persistência em navegador', () => {
  it('nunca lê ou escreve localStorage', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('nunca lê ou escreve sessionStorage', () => {
    const getSpy = vi.spyOn(window.sessionStorage, 'getItem');
    const setSpy = vi.spyOn(window.sessionStorage, 'setItem');
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    act(() => result.current.setCompanyFilterId('company-a'));
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe('useCompanyScopeFilter — exposição de companies para reaproveitamento (evita chamada duplicada)', () => {
  it('expõe companies/companiesLoading vindos da mesma chamada de useCompanies', () => {
    m.useCompanies.mockReturnValue(companiesResult({
      companies: [company()], hasData: true, isEmpty: false, isLoading: false,
    }));
    const { result } = renderHook(() => useCompanyScopeFilter({ userId: 'admin-1', actor: SUPER_ADMIN }));
    expect(result.current.companies).toEqual([company()]);
    expect(result.current.companiesLoading).toBe(false);
    expect(m.useCompanies).toHaveBeenCalledTimes(1);
  });
});
