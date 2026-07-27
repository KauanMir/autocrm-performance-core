// tests/hooks/useUpdateProfileName.test.tsx — mutation de edição de nome
// (M1-F S5-D). updateProfileNameRpc mockado — nenhuma rede real.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateProfileName,
  UPDATE_PROFILE_NAME_LOCAL_ERRORS,
  getUpdateProfileNameErrorMessage,
} from '@/lib/hooks/useUpdateProfileName';
import { bumpQueryCacheGeneration } from '@/lib/query/cacheIdentity';

const mocks = vi.hoisted(() => ({ updateProfileNameRpc: vi.fn() }));

vi.mock('@/lib/users/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/users/repository')>();
  return { ...actual, updateProfileNameRpc: mocks.updateProfileNameRpc };
});

const PROFILE_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  mocks.updateProfileNameRpc.mockReset();
  mocks.updateProfileNameRpc.mockResolvedValue({ profile_id: PROFILE_ID, name: 'Ana Nova', updated_at: '2026-07-20T10:00:00.000Z' });
});

describe('useUpdateProfileName — invariantes locais', () => {
  it('authorized=false: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: false }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: 'Ana Nova' }))
      .rejects.toThrow(UPDATE_PROFILE_NAME_LOCAL_ERRORS.notAllowed);
    expect(mocks.updateProfileNameRpc).not.toHaveBeenCalled();
  });

  it('userId ausente: rejeita', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: null, authorized: true }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: 'Ana Nova' }))
      .rejects.toThrow(UPDATE_PROFILE_NAME_LOCAL_ERRORS.missingUser);
    expect(mocks.updateProfileNameRpc).not.toHaveBeenCalled();
  });

  it('targetProfileId inválido (não-UUID): rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: 'nao-e-uuid', name: 'Ana Nova' }))
      .rejects.toThrow(UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidTarget);
    expect(mocks.updateProfileNameRpc).not.toHaveBeenCalled();
  });

  it('nome vazio após trim: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: '   ' }))
      .rejects.toThrow(UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidName);
    expect(mocks.updateProfileNameRpc).not.toHaveBeenCalled();
  });

  it('nome acima de 120 caracteres: rejeita, nunca chama a RPC', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: 'a'.repeat(121) }))
      .rejects.toThrow(UPDATE_PROFILE_NAME_LOCAL_ERRORS.invalidName);
    expect(mocks.updateProfileNameRpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateProfileName — resultado da RPC', () => {
  it('sucesso: resolve com o nome TRIMADO, chama updateProfileNameRpc com os args exatos', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: true }), { wrapper });
    const outcome = await result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: '  Ana Nova  ' });
    expect(outcome).toEqual({ profile_id: PROFILE_ID, name: 'Ana Nova', updated_at: '2026-07-20T10:00:00.000Z' });
    expect(mocks.updateProfileNameRpc).toHaveBeenCalledWith(PROFILE_ID, 'Ana Nova');
  });

  it('erro de domínio (ex.: user_inactive): propaga, nunca embrulha', async () => {
    mocks.updateProfileNameRpc.mockRejectedValue({ message: 'user_inactive', code: 'P0001' });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: 'Ana Nova' }))
      .rejects.toMatchObject({ message: 'user_inactive' });
  });
});

describe('useUpdateProfileName — isolamento por identidade (cache generation)', () => {
  it('identidade muda durante a chamada: resultado descartado (rejeita staleIdentity)', async () => {
    const { wrapper, queryClient } = createWrapper();
    mocks.updateProfileNameRpc.mockImplementation(async () => {
      bumpQueryCacheGeneration(queryClient);
      return { profile_id: PROFILE_ID, name: 'Ana Nova', updated_at: '2026-07-20T10:00:00.000Z' };
    });
    const { result } = renderHook(() => useUpdateProfileName({ userId: 'user-1', authorized: true }), { wrapper });
    await expect(result.current.updateProfileName({ targetProfileId: PROFILE_ID, name: 'Ana Nova' }))
      .rejects.toThrow(UPDATE_PROFILE_NAME_LOCAL_ERRORS.staleIdentity);
  });
});

describe('getUpdateProfileNameErrorMessage', () => {
  it('mapeia erros locais e de domínio para as mensagens estáveis exigidas, nunca texto bruto', () => {
    expect(getUpdateProfileNameErrorMessage(new Error('unauthenticated'))).toBe('Sua sessão expirou. Entre novamente.');
    expect(getUpdateProfileNameErrorMessage(new Error('forbidden'))).toBe('Você não tem permissão para realizar esta ação.');
    expect(getUpdateProfileNameErrorMessage(new Error('profile_not_found'))).toBe('Usuário não encontrado ou indisponível.');
    expect(getUpdateProfileNameErrorMessage(new Error('user_inactive'))).toBe('Este usuário está inativo.');
    expect(getUpdateProfileNameErrorMessage(new Error('invalid_name'))).toBe('Informe um nome válido com até 120 caracteres.');
    expect(getUpdateProfileNameErrorMessage(new Error('42501'))).not.toMatch(/42501/);
    expect(getUpdateProfileNameErrorMessage(new Error('algo-desconhecido'))).toBe('Não foi possível salvar o nome. Tente novamente.');
  });
});
