// Testes de lib/managementReport/adapter.ts (KPI-REPORTS-B2-EXEC-FRONTEND
// §5/§6/§60). Prova: snake_case -> camelCase; nullability exata
// (averageTicket/rate); "Sem vendedor"/"Não informado" passam intactos;
// trend com bucket zero preservado; qualquer desvio de contrato =>
// ManagementReportError('management_report_contract_invalid'), nunca
// número fake / NaN / undefined.
import { describe, expect, it } from 'vitest';
import { adaptManagementReport } from '@/lib/managementReport/adapter';
import { isManagementReportError } from '@/lib/managementReport/errors';

function validRaw(): Record<string, unknown> {
  return {
    period: {
      start: '2026-03-10T03:00:00+00:00',
      end: '2026-03-14T03:00:00+00:00',
      timezone: 'America/Sao_Paulo',
      trend_granularity: 'day',
    },
    summary: {
      leads_received: 5,
      sales_count: 3,
      revenue_cents: 63333,
      average_ticket_cents: 21111,
      visits_completed: 2,
      tasks_completed: 3,
      deal_to_sale_conversion: {
        cohort_deals_count: 3,
        converted_deals_count: 1,
        rate_percent: 33.33,
      },
    },
    seller_breakdown: [
      { seller_id: 'sel-a', seller_name: 'Seller A', tasks_completed: 1, visits_completed: 2, deals_created: 2, sales_count: 2, revenue_cents: 53333 },
      { seller_id: null, seller_name: 'Sem vendedor', tasks_completed: 1, visits_completed: 0, deals_created: 0, sales_count: 0, revenue_cents: 0 },
    ],
    source_breakdown: [
      { source_key: 'facebook', source_label: 'Facebook', leads_received: 3, sales_count: 2 },
      { source_key: '__not_informed__', source_label: 'Não informado', leads_received: 1, sales_count: 1 },
    ],
    trend: [
      { date: '2026-03-10', leads_received: 1, sales_count: 1 },
      { date: '2026-03-13', leads_received: 0, sales_count: 0 },
    ],
  };
}

describe('adaptManagementReport — caminho feliz', () => {
  it('traduz o shape inteiro para camelCase', () => {
    const r = adaptManagementReport(validRaw());
    expect(r.period).toEqual({
      start: '2026-03-10T03:00:00+00:00',
      end: '2026-03-14T03:00:00+00:00',
      timezone: 'America/Sao_Paulo',
      trendGranularity: 'day',
    });
    expect(r.summary.leadsReceived).toBe(5);
    expect(r.summary.salesCount).toBe(3);
    expect(r.summary.revenueCents).toBe(63333);
    expect(r.summary.averageTicketCents).toBe(21111);
    expect(r.summary.visitsCompleted).toBe(2);
    expect(r.summary.tasksCompleted).toBe(3);
    expect(r.summary.dealToSaleConversion).toEqual({
      cohortDealsCount: 3,
      convertedDealsCount: 1,
      ratePercent: 33.33,
    });
  });

  it('seller_breakdown: null vira sellerId null com "Sem vendedor" intacto, ordem preservada', () => {
    const r = adaptManagementReport(validRaw());
    expect(r.sellerBreakdown).toHaveLength(2);
    expect(r.sellerBreakdown[0].sellerId).toBe('sel-a');
    expect(r.sellerBreakdown[1].sellerId).toBeNull();
    expect(r.sellerBreakdown[1].sellerName).toBe('Sem vendedor');
    expect(r.sellerBreakdown[0].revenueCents).toBe(53333);
  });

  it('source_breakdown: label do backend intacto ("Não informado"), ordem preservada', () => {
    const r = adaptManagementReport(validRaw());
    expect(r.sourceBreakdown.map((s) => s.sourceLabel)).toEqual(['Facebook', 'Não informado']);
    expect(r.sourceBreakdown[1].sourceKey).toBe('__not_informed__');
  });

  it('trend: bucket com zero preservado, sem reconstrução', () => {
    const r = adaptManagementReport(validRaw());
    expect(r.trend).toEqual([
      { date: '2026-03-10', leadsReceived: 1, salesCount: 1 },
      { date: '2026-03-13', leadsReceived: 0, salesCount: 0 },
    ]);
  });

  it('arrays vazios são válidos (empty states)', () => {
    const raw = validRaw();
    raw.seller_breakdown = [];
    raw.source_breakdown = [];
    raw.trend = [];
    const r = adaptManagementReport(raw);
    expect(r.sellerBreakdown).toEqual([]);
    expect(r.sourceBreakdown).toEqual([]);
    expect(r.trend).toEqual([]);
  });
});

describe('adaptManagementReport — nullability exata (ADDENDUM §4/§5)', () => {
  it('sales_count 0 + average_ticket_cents null => averageTicketCents null', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).sales_count = 0;
    (raw.summary as Record<string, unknown>).revenue_cents = 0;
    (raw.summary as Record<string, unknown>).average_ticket_cents = null;
    const r = adaptManagementReport(raw);
    expect(r.summary.averageTicketCents).toBeNull();
  });

  it('cohort 0 + rate_percent null => ratePercent null', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).deal_to_sale_conversion = {
      cohort_deals_count: 0, converted_deals_count: 0, rate_percent: null,
    };
    const r = adaptManagementReport(raw);
    expect(r.summary.dealToSaleConversion.ratePercent).toBeNull();
  });

  it('sales_count 0 mas average_ticket_cents não-null => contrato inválido', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).sales_count = 0;
    (raw.summary as Record<string, unknown>).average_ticket_cents = 0;
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('cohort > 0 mas rate_percent null => contrato inválido', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).deal_to_sale_conversion = {
      cohort_deals_count: 3, converted_deals_count: 1, rate_percent: null,
    };
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('converted > cohort => contrato inválido', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).deal_to_sale_conversion = {
      cohort_deals_count: 2, converted_deals_count: 5, rate_percent: 250,
    };
    expect(() => adaptManagementReport(raw)).toThrow();
  });
});

describe('adaptManagementReport — desvio de contrato nunca vira número fake', () => {
  it('campo ausente => ManagementReportError com field', () => {
    const raw = validRaw();
    delete (raw.summary as Record<string, unknown>).leads_received;
    try {
      adaptManagementReport(raw);
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect(isManagementReportError(e)).toBe(true);
      if (isManagementReportError(e)) {
        expect(e.code).toBe('management_report_contract_invalid');
        expect(e.detail.field).toBe('leads_received');
      }
    }
  });

  it('número não finito (NaN/Infinity) => inválido, nunca propagado', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).revenue_cents = Number.POSITIVE_INFINITY;
    expect(() => adaptManagementReport(raw)).toThrow();
    const raw2 = validRaw();
    (raw2.summary as Record<string, unknown>).visits_completed = NaN;
    expect(() => adaptManagementReport(raw2)).toThrow();
  });

  it('string onde deveria ser número => inválido (sem coerção silenciosa)', () => {
    const raw = validRaw();
    (raw.summary as Record<string, unknown>).sales_count = '3';
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('average_ticket_cents undefined (ausente) => inválido, não tratado como null', () => {
    const raw = validRaw();
    delete (raw.summary as Record<string, unknown>).average_ticket_cents;
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('trend com date fora do formato YYYY-MM-DD => inválido', () => {
    const raw = validRaw();
    (raw.trend as unknown[])[0] = { date: '10/03/2026', leads_received: 1, sales_count: 0 };
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('trend não-array => inválido', () => {
    const raw = validRaw();
    raw.trend = { '2026-03-10': 1 };
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('period.trend_granularity != "day" => inválido', () => {
    const raw = validRaw();
    (raw.period as Record<string, unknown>).trend_granularity = 'week';
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('source_label em branco => inválido (nunca origem sem rótulo)', () => {
    const raw = validRaw();
    (raw.source_breakdown as unknown[])[0] = { source_key: 'x', source_label: '   ', leads_received: 1, sales_count: 0 };
    expect(() => adaptManagementReport(raw)).toThrow();
  });

  it('raiz não-objeto => inválido', () => {
    expect(() => adaptManagementReport(null)).toThrow();
    expect(() => adaptManagementReport('nope')).toThrow();
    expect(() => adaptManagementReport([])).toThrow();
  });
});
