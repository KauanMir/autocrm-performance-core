// Testes de lib/managementReport/repository.ts (KPI-REPORTS-B2-EXEC-
// FRONTEND §4/§60/§61). Mock isolado de @/lib/supabase/client (só rpc).
// Prova: args corretos da RPC (ISO 8601 dos millis; p_company_id só no
// modo Super Admin); erro do PostgREST vira ManagementReportError
// sanitizado; JSON válido passa pelo adapter; JSON inválido vira
// 'management_report_contract_invalid'.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchManagementReport } from '@/lib/managementReport/repository';
import { isManagementReportError } from '@/lib/managementReport/errors';

const m = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: m.rpc },
  isSupabaseConfigured: true,
}));

function validJson() {
  return {
    period: { start: '2026-03-10T03:00:00+00:00', end: '2026-03-14T03:00:00+00:00', timezone: 'America/Sao_Paulo', trend_granularity: 'day' },
    summary: {
      leads_received: 5, sales_count: 3, revenue_cents: 63333, average_ticket_cents: 21111,
      visits_completed: 2, tasks_completed: 3,
      deal_to_sale_conversion: { cohort_deals_count: 3, converted_deals_count: 1, rate_percent: 33.33 },
    },
    seller_breakdown: [],
    source_breakdown: [],
    trend: [{ date: '2026-03-10', leads_received: 1, sales_count: 1 }],
  };
}

// 2026-03-10T03:00:00Z e 2026-03-14T03:00:00Z em millis
const START_MS = Date.UTC(2026, 2, 10, 3, 0, 0);
const END_MS = Date.UTC(2026, 2, 14, 3, 0, 0);

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: validJson(), error: null });
});

describe('fetchManagementReport — argumentos da RPC', () => {
  it('envia p_period_start/p_period_end como ISO 8601 dos millis; sem p_company_id (Manager)', async () => {
    await fetchManagementReport({ periodStartMillis: START_MS, periodEndMillis: END_MS });
    expect(m.rpc).toHaveBeenCalledWith('get_company_management_report', {
      p_period_start: new Date(START_MS).toISOString(),
      p_period_end: new Date(END_MS).toISOString(),
      p_company_id: undefined,
    });
  });

  it('envia p_company_id explícito no modo Super Admin contextual', async () => {
    await fetchManagementReport({ periodStartMillis: START_MS, periodEndMillis: END_MS, companyId: 'company-b' });
    expect(m.rpc).toHaveBeenCalledWith('get_company_management_report', expect.objectContaining({
      p_company_id: 'company-b',
    }));
  });
});

describe('fetchManagementReport — resultado', () => {
  it('JSON válido passa pelo adapter e volta camelCase', async () => {
    const r = await fetchManagementReport({ periodStartMillis: START_MS, periodEndMillis: END_MS });
    expect(r.summary.leadsReceived).toBe(5);
    expect(r.summary.averageTicketCents).toBe(21111);
    expect(r.trend[0]).toEqual({ date: '2026-03-10', leadsReceived: 1, salesCount: 1 });
  });

  it('erro do PostgREST => ManagementReportError("management_report_fetch_failed") sanitizado', async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied for function' } });
    try {
      await fetchManagementReport({ periodStartMillis: START_MS, periodEndMillis: END_MS });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(isManagementReportError(e)).toBe(true);
      if (isManagementReportError(e)) {
        expect(e.code).toBe('management_report_fetch_failed');
        expect(e.detail.code).toBe('42501');
      }
    }
  });

  it('JSON que viola o contrato => ManagementReportError("management_report_contract_invalid")', async () => {
    const bad = validJson();
    delete (bad.summary as Record<string, unknown>).sales_count;
    m.rpc.mockResolvedValueOnce({ data: bad, error: null });
    try {
      await fetchManagementReport({ periodStartMillis: START_MS, periodEndMillis: END_MS });
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(isManagementReportError(e)).toBe(true);
      if (isManagementReportError(e)) expect(e.code).toBe('management_report_contract_invalid');
    }
  });
});
