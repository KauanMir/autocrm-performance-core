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
  fetchPlatformSellers,
  createPlatformLead,
  updatePlatformLead,
  checkPlatformLeadPhoneDuplicate,
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

// M1-F S8-C2-C2 — Sellers/mutation/duplicidade.
describe('fetchPlatformSellers', () => {
  it('chama list_platform_sellers_for_company com p_company_id exato', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ seller_id: 's1', name: 'Vendedor 1' }], error: null });
    const result = await fetchPlatformSellers('company-a');
    expect(mocks.rpc).toHaveBeenCalledWith('list_platform_sellers_for_company', { p_company_id: 'company-a' });
    expect(result).toEqual([{ seller_id: 's1', name: 'Vendedor 1' }]);
  });

  it('data null ⇒ array vazio', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchPlatformSellers('company-a')).toEqual([]);
  });

  it('erro ⇒ PlatformCommercialError com o código certo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    await expect(fetchPlatformSellers('company-a')).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_sellers_fetch_failed');
  });
});

describe('createPlatformLead', () => {
  const baseInput = { companyId: 'company-a', name: 'Cliente', phone: '11999990000', car: 'Golf' };
  const fakeLead = { id: 'lead-1', company_id: 'company-a', name: 'Cliente' };

  it('chama create_lead com p_company_id explícito e os campos obrigatórios', async () => {
    mocks.rpc.mockResolvedValue({ data: fakeLead, error: null });
    const result = await createPlatformLead(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('create_lead', {
      p_company_id: 'company-a',
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_payment_preference: undefined,
      p_seller_id: undefined,
      p_source: undefined,
      p_temperature: undefined,
    });
    expect(result).toEqual(fakeLead);
  });

  it('campos opcionais são repassados quando informados', async () => {
    mocks.rpc.mockResolvedValue({ data: fakeLead, error: null });
    await createPlatformLead({
      ...baseInput,
      sellerId: 's1',
      temperature: 'hot',
      paymentPreference: 'À vista',
      source: 'WhatsApp',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('create_lead', expect.objectContaining({
      p_seller_id: 's1',
      p_temperature: 'hot',
      p_payment_preference: 'À vista',
      p_source: 'WhatsApp',
    }));
  });

  it('erro ⇒ PlatformCommercialError com o código certo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'seller_not_found' } });
    await expect(createPlatformLead(baseInput)).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_lead_create_failed');
  });

  it('data null sem erro ⇒ ainda assim rejeita (create_lead sempre retorna linha)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(createPlatformLead(baseInput)).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_lead_create_failed');
  });
});

describe('updatePlatformLead', () => {
  const baseInput = {
    companyId: 'company-a', leadId: 'lead-1', expectedVersion: 3,
    name: 'Cliente', phone: '11999990000', car: 'Golf',
  };
  const fakeLead = { id: 'lead-1', company_id: 'company-a', version: 4 };

  it('chama update_lead só com os campos reais — nunca seller_id/stage/archived_at', async () => {
    mocks.rpc.mockResolvedValue({ data: fakeLead, error: null });
    const result = await updatePlatformLead(baseInput);
    expect(mocks.rpc).toHaveBeenCalledWith('update_lead', {
      p_company_id: 'company-a',
      p_lead_id: 'lead-1',
      p_expected_version: 3,
      p_name: 'Cliente',
      p_phone: '11999990000',
      p_car: 'Golf',
      p_payment_preference: undefined,
      p_source: undefined,
      p_temperature: undefined,
    });
    expect(result).toEqual(fakeLead);
    const sentArgs = mocks.rpc.mock.calls[0][1];
    expect(sentArgs).not.toHaveProperty('p_seller_id');
    expect(sentArgs).not.toHaveProperty('p_stage_id');
    expect(sentArgs).not.toHaveProperty('p_archived_at');
  });

  it('erro ⇒ PlatformCommercialError com o código certo (ex.: stale_write)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'stale_write' } });
    await expect(updatePlatformLead(baseInput)).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_lead_update_failed');
  });

  it('data null sem erro ⇒ ainda assim rejeita', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(updatePlatformLead(baseInput)).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_lead_update_failed');
  });
});

describe('checkPlatformLeadPhoneDuplicate', () => {
  it('chama check_lead_phone_duplicate com p_company_id SEMPRE explícito (nunca omitido)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }], error: null });
    const result = await checkPlatformLeadPhoneDuplicate('company-a', '11999990000');
    expect(mocks.rpc).toHaveBeenCalledWith('check_lead_phone_duplicate', {
      p_company_id: 'company-a',
      p_phone: '11999990000',
    });
    expect(result).toEqual([{ status: 'none', lead_id: null, lead_name: null, lead_archived: null }]);
  });

  it('data null ⇒ array vazio', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await checkPlatformLeadPhoneDuplicate('company-a', '11999990000')).toEqual([]);
  });

  it('erro ⇒ PlatformCommercialError com o código certo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_phone' } });
    await expect(checkPlatformLeadPhoneDuplicate('company-a', '')).rejects.toSatisfy((e: unknown) => isPlatformCommercialError(e)
      && (e as PlatformCommercialError).code === 'platform_commercial_duplicate_check_failed');
  });
});

describe('nenhuma função lê sellers ou faz SELECT direto', () => {
  it('nenhuma das funções de leitura chama supabase.from em nenhum momento', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await fetchCommercialCompanies();
    await fetchPlatformLeads('company-a', false);
    await fetchPlatformLeadTimeline('company-a', 'lead-1');
    await fetchPlatformPipelineStages('company-a');
    await fetchPlatformSellers('company-a');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('create/update/duplicate-check também nunca chamam supabase.from', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'lead-1' }, error: null });
    await createPlatformLead({ companyId: 'company-a', name: 'C', phone: '1', car: 'X' });
    await updatePlatformLead({ companyId: 'company-a', leadId: 'lead-1', expectedVersion: 1, name: 'C', phone: '1', car: 'X' });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await checkPlatformLeadPhoneDuplicate('company-a', '1');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
