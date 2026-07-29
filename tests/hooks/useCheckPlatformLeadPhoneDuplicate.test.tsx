// Testes de useCheckPlatformLeadPhoneDuplicate (M1-F S8-C2-C2). Supabase
// mockado (rpc). Confirma que é um useMutation imperativo (nunca useQuery —
// telefone nunca vira parte de uma query key persistida).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCheckPlatformLeadPhoneDuplicate } from '@/lib/hooks/useCheckPlatformLeadPhoneDuplicate';
import { isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, hook: renderHook(() => useCheckPlatformLeadPhoneDuplicate(), { wrapper }) };
}

beforeEach(() => mocks.rpc.mockReset());

describe('useCheckPlatformLeadPhoneDuplicate — chamada', () => {
  it('chama check_lead_phone_duplicate com p_company_id SEMPRE explícito', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }], error: null });
    const { hook } = setup();
    const result = await hook.result.current.checkDuplicate({ companyId: 'company-a', phone: '11999990000' });
    expect(mocks.rpc).toHaveBeenCalledWith('check_lead_phone_duplicate', {
      p_company_id: 'company-a',
      p_phone: '11999990000',
    });
    expect(result).toEqual([{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }]);
  });

  it('status "accessible": o chamador nunca precisa ler lead_id/lead_name para decidir bloquear — só status !== none', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: 'accessible', lead_id: 'other-lead', lead_name: 'Outro Cliente', lead_archived: false }], error: null });
    const { hook } = setup();
    const result = await hook.result.current.checkDuplicate({ companyId: 'company-a', phone: '11999990000' });
    expect(result.some((row) => row.status !== 'none')).toBe(true);
  });

  it('status "restricted": nunca revela lead_id/lead_name (vêm null), mas ainda sinaliza duplicidade', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: 'restricted', lead_id: null, lead_name: null, lead_archived: null }], error: null });
    const { hook } = setup();
    const result = await hook.result.current.checkDuplicate({ companyId: 'company-a', phone: '11999990000' });
    expect(result[0].status).toBe('restricted');
    expect(result[0].lead_id).toBeNull();
    expect(result[0].lead_name).toBeNull();
  });

  it('cada chamada é independente — chamar duas vezes dispara duas RPCs (sem cache de query)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }], error: null });
    const { hook } = setup();
    await hook.result.current.checkDuplicate({ companyId: 'company-a', phone: '11999990000' });
    await hook.result.current.checkDuplicate({ companyId: 'company-a', phone: '11999990000' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});

describe('useCheckPlatformLeadPhoneDuplicate — erro', () => {
  it('erro do Supabase (ex.: invalid_phone) vira PlatformCommercialError', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_phone' } });
    const { hook } = setup();
    await expect(hook.result.current.checkDuplicate({ companyId: 'company-a', phone: '' }))
      .rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
  });
});
