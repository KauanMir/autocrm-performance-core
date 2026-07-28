// Testes de lib/commercial/repository.ts (M1-F S8-C2-B2). Supabase mockado
// (rpc) — nenhuma rede real. Confirma que cada função chama EXATAMENTE a
// RPC certa com os parâmetros certos, e nunca um SELECT direto em
// leads/lead_timeline_entries/pipeline_stages/companies/sellers.
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { PlatformCommercialError, isPlatformCommercialError } from '@/lib/commercial/errors';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
  isSupabaseConfigured: true,
}));

import {
  fetchCommercialCompanies,
  fetchPlatformLeads,
  fetchPlatformLeadTimeline,
  fetchPlatformPipelineStages,
} from '@/lib/commercial/repository';

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

describe('fetchCommercialCompanies', () => {
  it('chama list_commercial_companies() sem argumentos', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'c1', name: 'Empresa 1', status: 'ativa' }], error: null });
    const result = await fetchCommercialCompanies();
    expect(mocks.rpc).toHaveBeenCalledWith('list_commercial_companies');
    expect(result).toEqual([{ id: 'c1', name: 'Empresa 1', status: 'ativa' }]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('data null ⇒ array vazio (nunca null)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchCommercialCompanies()).toEqual([]);
  });

  it('erro do Supabase ⇒ PlatformCommercialError, nunca lista vazia silenciosa', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    await expect(fetchCommercialCompanies()).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_companies_fetch_failed');
  });
});

describe('fetchPlatformLeads', () => {
  it('chama list_platform_leads_for_company com p_company_id/p_archived exatos', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchPlatformLeads('company-a', false);
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', {
      p_company_id: 'company-a',
      p_archived: false,
    });
  });

  it('archived=true é repassado sem alteração', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchPlatformLeads('company-a', true);
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_leads_for_company', {
      p_company_id: 'company-a',
      p_archived: true,
    });
  });

  it('erro ⇒ PlatformCommercialError com o código certo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'company_not_found' } });
    await expect(fetchPlatformLeads('company-x', false)).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_leads_fetch_failed');
  });
});

describe('fetchPlatformLeadTimeline', () => {
  it('chama list_platform_lead_timeline com p_company_id/p_lead_id exatos', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchPlatformLeadTimeline('company-a', 'lead-1');
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_lead_timeline', {
      p_company_id: 'company-a',
      p_lead_id: 'lead-1',
    });
  });

  it('erro ⇒ PlatformCommercialError com o código certo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'lead_not_found' } });
    await expect(fetchPlatformLeadTimeline('company-a', 'lead-x')).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_timeline_fetch_failed');
  });
});

describe('fetchPlatformPipelineStages', () => {
  it('chama list_pipeline_stages_for_company com p_company_id exato', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchPlatformPipelineStages('company-a');
    expect(mocks.rpc).toHaveBeenCalledWith('list_pipeline_stages_for_company', {
      p_company_id: 'company-a',
    });
  });

  it('erro ⇒ PlatformCommercialError com o código certo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'company_not_found' } });
    await expect(fetchPlatformPipelineStages('company-x')).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_stages_fetch_failed');
  });
});

describe('nenhuma função lê sellers ou faz SELECT direto', () => {
  it('nenhuma das 4 funções chama supabase.from em nenhum momento', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchCommercialCompanies();
    await fetchPlatformLeads('company-a', false);
    await fetchPlatformLeadTimeline('company-a', 'lead-1');
    await fetchPlatformPipelineStages('company-a');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
