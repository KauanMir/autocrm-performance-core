// Testes de useUpdateCompanyLogo (COMPANY-IDENTITY-LOGO-R1-EXEC). Supabase
// RPC e Storage mockados, QueryClient novo por teste, sem rede real. Mesmo
// padrão estrutural de tests/hooks/useActivateCompany.test.tsx.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateCompanyLogo,
  getUpdateCompanyLogoErrorMessage,
  UPDATE_COMPANY_LOGO_LOCAL_ERRORS,
} from '@/lib/hooks/useUpdateCompanyLogo';
import { platformCompanyQueryKeys } from '@/lib/companies/queryKeys';
import { currentCompanyTimezoneQueryKey } from '@/lib/hooks/useCurrentCompanyTimezone';
import { currentCompanyIdentityQueryKey } from '@/lib/hooks/useActiveCompanyIdentity';
import { resetQueryCache } from '@/lib/query/resetQueryCache';
import { PlatformCompanyError } from '@/lib/companies/errors';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  buildCompanyLogoObjectPath: vi.fn(),
  uploadCompanyLogoObject: vi.fn(),
  deleteCompanyLogoObject: vi.fn(),
  validateCompanyLogoFile: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/companies/logoStorage', () => ({
  buildCompanyLogoObjectPath: mocks.buildCompanyLogoObjectPath,
  uploadCompanyLogoObject: mocks.uploadCompanyLogoObject,
  deleteCompanyLogoObject: mocks.deleteCompanyLogoObject,
  validateCompanyLogoFile: mocks.validateCompanyLogoFile,
}));

const BASE: PlatformCompanyRow = {
  id: 'company-1',
  name: 'Rcar Seminovos Gama',
  trade_name: null,
  cnpj: null,
  phone: null,
  timezone: 'America/Sao_Paulo',
  status: 'ativa',
  created_at: '2026-08-01T10:00:00+00:00',
  logo_path: 'company-1/logos/old-uuid.png',
};

const UPDATED: PlatformCompanyRow = { ...BASE, logo_path: 'company-1/logos/new-uuid.png' };
const REMOVED: PlatformCompanyRow = { ...BASE, logo_path: null };

const NEW_FILE = new File(['fake'], 'logo.png', { type: 'image/png' });

const DETAIL_KEY = platformCompanyQueryKeys.detail('company-1', 'user-a');
const LIST_KEY = platformCompanyQueryKeys.list('user-a');
const TIMEZONE_KEY = currentCompanyTimezoneQueryKey('company-1', 'user-a');
const IDENTITY_KEY = currentCompanyIdentityQueryKey('company-1', 'user-a');

function setup(options: { userId?: string | null; companyId?: string | null; authorized?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } },
  });
  queryClient.setQueryData(DETAIL_KEY, [BASE]);
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useUpdateCompanyLogo({ userId: 'user-a', companyId: 'company-1', authorized: true, ...options }),
    { wrapper },
  );
  return { queryClient, invalidateSpy, hook };
}

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: UPDATED, error: null });
  mocks.buildCompanyLogoObjectPath.mockReset().mockReturnValue('company-1/logos/new-uuid.png');
  mocks.uploadCompanyLogoObject.mockReset().mockResolvedValue(undefined);
  mocks.deleteCompanyLogoObject.mockReset().mockResolvedValue(true);
  mocks.validateCompanyLogoFile.mockReset().mockReturnValue(null);
});

describe('useUpdateCompanyLogo — setLogo: fluxo feliz', () => {
  it('upload -> RPC -> remove o objeto ANTIGO (nesta ordem), invalida os 3 namespaces de cache', async () => {
    const { hook, invalidateSpy } = setup();
    const result = await hook.result.current.setLogo(NEW_FILE, 'company-1/logos/old-uuid.png');

    expect(result).toEqual({ company: UPDATED, oldObjectCleanupFailed: false });
    expect(mocks.uploadCompanyLogoObject).toHaveBeenCalledWith('company-1/logos/new-uuid.png', NEW_FILE);
    expect(mocks.rpc).toHaveBeenCalledWith('update_company_logo', {
      p_company_id: 'company-1',
      p_logo_path: 'company-1/logos/new-uuid.png',
    });
    expect(mocks.deleteCompanyLogoObject).toHaveBeenCalledWith('company-1/logos/old-uuid.png');

    // upload precisa acontecer ANTES da RPC (§18 do EXEC).
    const uploadOrder = mocks.uploadCompanyLogoObject.mock.invocationCallOrder[0];
    const rpcOrder = mocks.rpc.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(rpcOrder);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: LIST_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: TIMEZONE_KEY });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: IDENTITY_KEY });
  });

  it('sem logo antiga (currentLogoPath null): nunca chama delete', async () => {
    const { hook } = setup();
    await hook.result.current.setLogo(NEW_FILE, null);
    expect(mocks.deleteCompanyLogoObject).not.toHaveBeenCalled();
  });

  it('falha ao remover o objeto ANTIGO: troca continua confirmada, oldObjectCleanupFailed=true', async () => {
    mocks.deleteCompanyLogoObject.mockResolvedValue(false);
    const { hook } = setup();
    const result = await hook.result.current.setLogo(NEW_FILE, 'company-1/logos/old-uuid.png');
    expect(result).toEqual({ company: UPDATED, oldObjectCleanupFailed: true });
  });
});

describe('useUpdateCompanyLogo — setLogo: compensação de falha da RPC (§19)', () => {
  it('upload=SUCCESS, RPC=ERROR: remove o objeto RECÉM-ENVIADO e propaga o erro da RPC, nunca deleta o antigo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    const { hook, queryClient } = setup();

    await expect(
      hook.result.current.setLogo(NEW_FILE, 'company-1/logos/old-uuid.png'),
    ).rejects.toBeInstanceOf(PlatformCompanyError);

    expect(mocks.uploadCompanyLogoObject).toHaveBeenCalledWith('company-1/logos/new-uuid.png', NEW_FILE);
    expect(mocks.deleteCompanyLogoObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCompanyLogoObject).toHaveBeenCalledWith('company-1/logos/new-uuid.png');
    expect(mocks.deleteCompanyLogoObject).not.toHaveBeenCalledWith('company-1/logos/old-uuid.png');
    // cache nunca tocado numa falha (nenhuma UI otimista para o objeto novo).
    expect(queryClient.getQueryData(DETAIL_KEY)).toEqual([BASE]);
  });

  it('upload falha: nunca chama a RPC, nunca tenta compensar (nada foi enviado)', async () => {
    mocks.uploadCompanyLogoObject.mockRejectedValue(
      new PlatformCompanyError('platform_companies_logo_upload_failed', { message: 'network error' }),
    );
    const { hook } = setup();
    await expect(
      hook.result.current.setLogo(NEW_FILE, 'company-1/logos/old-uuid.png'),
    ).rejects.toBeInstanceOf(PlatformCompanyError);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deleteCompanyLogoObject).not.toHaveBeenCalled();
  });
});

describe('useUpdateCompanyLogo — setLogo: validação client-side (§34)', () => {
  it('MIME inválido: erro local, nunca toca upload/RPC', async () => {
    mocks.validateCompanyLogoFile.mockReturnValue('invalid_type');
    const { hook } = setup();
    await expect(hook.result.current.setLogo(NEW_FILE, null))
      .rejects.toThrow(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.invalidType);
    expect(mocks.uploadCompanyLogoObject).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('arquivo grande demais: erro local, nunca toca upload/RPC', async () => {
    mocks.validateCompanyLogoFile.mockReturnValue('too_large');
    const { hook } = setup();
    await expect(hook.result.current.setLogo(NEW_FILE, null))
      .rejects.toThrow(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.tooLarge);
    expect(mocks.uploadCompanyLogoObject).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('useUpdateCompanyLogo — removeLogo (§21)', () => {
  it('RPC(null) primeiro, DELETE físico do objeto antigo só depois', async () => {
    mocks.rpc.mockResolvedValue({ data: REMOVED, error: null });
    const { hook } = setup();
    const result = await hook.result.current.removeLogo('company-1/logos/old-uuid.png');

    expect(result).toEqual({ company: REMOVED, oldObjectCleanupFailed: false });
    expect(mocks.rpc).toHaveBeenCalledWith('update_company_logo', {
      p_company_id: 'company-1',
      p_logo_path: null,
    });
    expect(mocks.deleteCompanyLogoObject).toHaveBeenCalledWith('company-1/logos/old-uuid.png');

    const rpcOrder = mocks.rpc.mock.invocationCallOrder[0];
    const deleteOrder = mocks.deleteCompanyLogoObject.mock.invocationCallOrder[0];
    expect(rpcOrder).toBeLessThan(deleteOrder);
  });

  it('RPC(null) falha: nunca tenta remover o objeto físico, empresa continua com a logo anterior', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'company_status_conflict' } });
    const { hook } = setup();
    await expect(hook.result.current.removeLogo('company-1/logos/old-uuid.png'))
      .rejects.toBeInstanceOf(PlatformCompanyError);
    expect(mocks.deleteCompanyLogoObject).not.toHaveBeenCalled();
  });

  it('falha ao remover o objeto físico: remoção no banco continua confirmada, oldObjectCleanupFailed=true', async () => {
    mocks.rpc.mockResolvedValue({ data: REMOVED, error: null });
    mocks.deleteCompanyLogoObject.mockResolvedValue(false);
    const { hook } = setup();
    const result = await hook.result.current.removeLogo('company-1/logos/old-uuid.png');
    expect(result).toEqual({ company: REMOVED, oldObjectCleanupFailed: true });
  });
});

describe('useUpdateCompanyLogo — validações locais bloqueiam a chamada (sem Storage/RPC)', () => {
  it('authorized=false bloqueia', async () => {
    const { hook } = setup({ authorized: false });
    await expect(hook.result.current.setLogo(NEW_FILE, null))
      .rejects.toThrow(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.notAllowed);
    expect(mocks.uploadCompanyLogoObject).not.toHaveBeenCalled();
  });

  it('userId ausente bloqueia', async () => {
    const { hook } = setup({ userId: null });
    await expect(hook.result.current.setLogo(NEW_FILE, null))
      .rejects.toThrow(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.missingUser);
  });

  it('companyId ausente bloqueia', async () => {
    const { hook } = setup({ companyId: null });
    await expect(hook.result.current.setLogo(NEW_FILE, null))
      .rejects.toThrow(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.missingCompanyId);
  });
});

describe('useUpdateCompanyLogo — identidade obsoleta', () => {
  it('reset do cache durante a RPC descarta o resultado: erro estável, sem invalidar caches', async () => {
    let resolveRpc!: (v: { data: unknown; error: unknown }) => void;
    mocks.rpc.mockReturnValue(new Promise((resolve) => { resolveRpc = resolve; }));
    const { hook, queryClient, invalidateSpy } = setup();

    const pending = hook.result.current.setLogo(NEW_FILE, 'company-1/logos/old-uuid.png');
    const settled = pending.catch((e) => e);
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));

    resetQueryCache(queryClient);
    resolveRpc({ data: UPDATED, error: null });

    const err = await settled;
    expect((err as Error).message).toBe(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.staleIdentity);
    expect(invalidateSpy).not.toHaveBeenCalled();
    // identidade mudou -> nunca tenta limpar o objeto antigo sob o contexto obsoleto.
    expect(mocks.deleteCompanyLogoObject).not.toHaveBeenCalled();
  });
});

describe('getUpdateCompanyLogoErrorMessage', () => {
  it('cobre validação local, upload, autorização, status e o fallback genérico — nunca SQLSTATE/policy/stack cru', () => {
    expect(getUpdateCompanyLogoErrorMessage(new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.invalidType)))
      .toBe('Envie uma imagem PNG, JPEG ou WEBP.');
    expect(getUpdateCompanyLogoErrorMessage(new Error(UPDATE_COMPANY_LOGO_LOCAL_ERRORS.tooLarge)))
      .toBe('A imagem precisa ter no máximo 2 MB.');
    expect(getUpdateCompanyLogoErrorMessage(
      new PlatformCompanyError('platform_companies_logo_upload_failed', { message: 'network error' }),
    )).toBe('Não foi possível enviar a imagem. Tente novamente.');
    expect(getUpdateCompanyLogoErrorMessage(
      new PlatformCompanyError('platform_companies_update_logo_failed', { code: '42501' }),
    )).toBe('Você não tem permissão para editar esta empresa.');
    expect(getUpdateCompanyLogoErrorMessage(
      new PlatformCompanyError('platform_companies_update_logo_failed', { code: 'P0001' }),
    )).toBe('Esta empresa não está disponível para configuração no momento.');
    expect(getUpdateCompanyLogoErrorMessage(
      new PlatformCompanyError('platform_companies_update_logo_failed', { code: '22023' }),
    )).toBe('Não foi possível salvar esta imagem. Tente enviar novamente.');
    const generic = getUpdateCompanyLogoErrorMessage(
      new PlatformCompanyError('platform_companies_update_logo_failed', { code: '42501', message: 'permission denied for function update_company_logo' }),
    );
    expect(generic).not.toMatch(/42501/);
    expect(generic).not.toMatch(/update_company_logo/);
    expect(getUpdateCompanyLogoErrorMessage(undefined))
      .toBe('Não foi possível salvar as alterações. Tente novamente.');
  });
});
