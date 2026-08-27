// Testes de ManagementResultsScreen (KPI-REPORTS-B2-EXEC-FRONTEND
// §60-§68). Hooks mockados no nível da tela
// (useOperationalCompanyContext / useCurrentCompanyTimezone /
// useManagementReport) — nenhum QueryClientProvider real necessário.
// A agregação real e o adapter já têm cobertura própria.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ManagementReport } from '@/lib/managementReport/types';
import type { ManagementReportState } from '@/lib/hooks/useManagementReport';
import type { User } from '@/lib/data';

const m = vi.hoisted(() => ({
  useOperationalCompanyContext: vi.fn(),
  useCurrentCompanyTimezone: vi.fn(),
  useManagementReport: vi.fn(),
}));

vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: m.useOperationalCompanyContext,
}));
vi.mock('@/lib/hooks/useCurrentCompanyTimezone', () => ({
  useCurrentCompanyTimezone: m.useCurrentCompanyTimezone,
}));
vi.mock('@/lib/hooks/useManagementReport', () => ({
  useManagementReport: m.useManagementReport,
}));

import { ManagementResultsScreen } from '@/components/screens/ManagementResults';

const MANAGER: User = {
  id: 'user-1', name: 'Manager', email: 'm@x.com', platformRole: null,
  activeMembership: { companyId: 'company-1', role: 'manager', sellerId: null },
};
const SELLER: User = {
  id: 'user-2', name: 'Seller', email: 's@x.com', platformRole: null,
  activeMembership: { companyId: 'company-1', role: 'seller', sellerId: 'sel-1' },
};
const SUPER_ADMIN: User = {
  id: 'admin-1', name: 'Admin', email: 'a@x.com', platformRole: 'super_admin', activeMembership: null,
};

function fullReport(over: Partial<ManagementReport> = {}): ManagementReport {
  return {
    period: { start: '2026-03-10T03:00:00+00:00', end: '2026-03-14T03:00:00+00:00', timezone: 'America/Sao_Paulo', trendGranularity: 'day' },
    summary: {
      leadsReceived: 12, salesCount: 4, revenueCents: 8_000_000, averageTicketCents: 2_000_000,
      visitsCompleted: 6, tasksCompleted: 9,
      dealToSaleConversion: { cohortDealsCount: 30, convertedDealsCount: 18, ratePercent: 60 },
    },
    sellerBreakdown: [
      { sellerId: 'sel-a', sellerName: 'Ana Ativa', tasksCompleted: 5, visitsCompleted: 3, dealsCreated: 4, salesCount: 3, revenueCents: 6_000_000 },
      { sellerId: 'sel-off', sellerName: 'Bruno Desligado', tasksCompleted: 2, visitsCompleted: 1, dealsCreated: 1, salesCount: 1, revenueCents: 2_000_000 },
      { sellerId: null, sellerName: 'Sem vendedor', tasksCompleted: 1, visitsCompleted: 0, dealsCreated: 0, salesCount: 0, revenueCents: 0 },
    ],
    sourceBreakdown: [
      { sourceKey: 'facebook', sourceLabel: 'Facebook', leadsReceived: 8, salesCount: 3 },
      { sourceKey: '__not_informed__', sourceLabel: 'Não informado', leadsReceived: 3, salesCount: 1 },
      { sourceKey: 'instagram', sourceLabel: 'Instagram', leadsReceived: 1, salesCount: 0 },
    ],
    trend: [
      { date: '2026-03-10', leadsReceived: 4, salesCount: 1 },
      { date: '2026-03-11', leadsReceived: 5, salesCount: 2 },
      { date: '2026-03-12', leadsReceived: 3, salesCount: 1 },
      { date: '2026-03-13', leadsReceived: 0, salesCount: 0 },
    ],
    ...over,
  };
}

function ready(report: ManagementReport): ManagementReportState {
  return { status: 'ready', report };
}

beforeEach(() => {
  m.useOperationalCompanyContext.mockReset().mockReturnValue({ mode: 'membership', companyId: 'company-1', identity: { status: 'ready' }, isReadOnly: false });
  m.useCurrentCompanyTimezone.mockReset().mockReturnValue({ status: 'ready', timezone: 'America/Sao_Paulo' });
  m.useManagementReport.mockReset().mockReturnValue(ready(fullReport()));
});

// ── ACESSO (§67) ──────────────────────────────────────────────────────
describe('acesso', () => {
  it('Manager: dashboard visível, hook recebe membershipRole manager + companyId da membership', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-summary')).toBeTruthy();
    expect(m.useManagementReport).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-1', membershipRole: 'manager', isSuperAdminContext: false,
    }));
  });

  it('Super Admin contextual: dashboard visível, hook recebe isSuperAdminContext + companyId da URL', () => {
    m.useOperationalCompanyContext.mockReturnValue({ mode: 'super_admin', companyId: 'company-b', identity: { status: 'ready' }, isReadOnly: false });
    render(<ManagementResultsScreen currentUser={SUPER_ADMIN} />);
    expect(screen.getByTestId('results-summary')).toBeTruthy();
    expect(m.useManagementReport).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 'company-b', isSuperAdminContext: true,
    }));
  });

  it('SELLER: nenhum dashboard; hook recebe companyId null e membershipRole null (RPC nunca habilita)', () => {
    render(<ManagementResultsScreen currentUser={SELLER} />);
    expect(screen.queryByTestId('results-summary')).toBeNull();
    expect(screen.getByTestId('results-no-company')).toBeTruthy();
    expect(m.useManagementReport).toHaveBeenCalledWith(expect.objectContaining({
      companyId: null, membershipRole: null, isSuperAdminContext: false,
    }));
  });

  it('Super Admin global (sem empresa): orienta a abrir uma empresa, sem dashboard', () => {
    m.useOperationalCompanyContext.mockReturnValue({ mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false });
    render(<ManagementResultsScreen currentUser={SUPER_ADMIN} />);
    expect(screen.queryByTestId('results-summary')).toBeNull();
    expect(screen.getByTestId('results-no-company').textContent).toMatch(/abra uma empresa/i);
    expect(m.useManagementReport).toHaveBeenCalledWith(expect.objectContaining({ companyId: null }));
  });
});

// ── PERÍODO (§61) ─────────────────────────────────────────────────────
describe('controle de período', () => {
  it('presets renderizados; default = 30 dias (aria-pressed)', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    for (const p of ['Hoje', '7 dias', '15 dias', '30 dias', 'Personalizado']) {
      expect(screen.getByRole('button', { name: p })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: '30 dias' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('período pronto: hook recebe period { kind: "ready", startMillis, endMillis } numéricos', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const call = m.useManagementReport.mock.calls.at(-1)?.[0];
    expect(call.period.kind).toBe('ready');
    expect(typeof call.period.startMillis).toBe('number');
    expect(typeof call.period.endMillis).toBe('number');
    expect(call.period.startMillis).toBeLessThan(call.period.endMillis);
  });

  it('trocar preset muda a seleção e recalcula o período (nova janela)', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const before = m.useManagementReport.mock.calls.at(-1)?.[0].period;
    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(screen.getByRole('button', { name: 'Hoje' }).getAttribute('aria-pressed')).toBe('true');
    const after = m.useManagementReport.mock.calls.at(-1)?.[0].period;
    expect(after.startMillis).not.toBe(before.startMillis);
  });

  it('abre o popover de período personalizado', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    expect(screen.getByTestId('results-custom-period')).toBeTruthy();
  });

  it('timezone ainda carregando => skeleton, hook recebe period kind loading', () => {
    m.useCurrentCompanyTimezone.mockReturnValue({ status: 'loading' });
    m.useManagementReport.mockReturnValue({ status: 'loading' });
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-loading')).toBeTruthy();
    expect(m.useManagementReport.mock.calls.at(-1)?.[0].period.kind).toBe('loading');
  });
});

// ── SUMMARY (§62) ────────────────────────────────────────────────────
describe('visão geral', () => {
  it('6 cards com os rótulos exatos', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-summary');
    for (const label of ['Leads recebidos', 'Vendas realizadas', 'Valor vendido', 'Ticket médio', 'Visitas realizadas', 'Pendências concluídas']) {
      expect(within(sec).getByText(label)).toBeTruthy();
    }
  });

  it('valores formatados; dinheiro em BRL', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-summary');
    expect(within(sec).getByText('12')).toBeTruthy(); // leads
    expect(within(sec).getByText('R$ 80.000,00')).toBeTruthy(); // revenue 8_000_000 cents
    expect(within(sec).getByText('R$ 20.000,00')).toBeTruthy(); // ticket 2_000_000 cents
  });

  it('ticket médio NULL => card "Ticket médio" mostra "Sem vendas", nunca "R$ 0,00"', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({
      summary: { ...fullReport().summary, salesCount: 0, revenueCents: 500, averageTicketCents: null },
    })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const cards = screen.getAllByTestId('results-metric');
    const ticket = cards.find((c) => c.getAttribute('data-label') === 'Ticket médio')!;
    expect(within(ticket).getByText('Sem vendas')).toBeTruthy();
    expect(within(ticket).queryByText('R$ 0,00')).toBeNull();
    expect(within(ticket).queryByText(/R\$/)).toBeNull();
  });

  it('zero data honesto: Leads 0, Vendas 0, Valor vendido R$ 0,00', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({
      summary: {
        leadsReceived: 0, salesCount: 0, revenueCents: 0, averageTicketCents: null,
        visitsCompleted: 0, tasksCompleted: 0,
        dealToSaleConversion: { cohortDealsCount: 0, convertedDealsCount: 0, ratePercent: null },
      },
      sellerBreakdown: [], sourceBreakdown: [],
      trend: [{ date: '2026-03-10', leadsReceived: 0, salesCount: 0 }],
    })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-summary');
    expect(within(sec).getAllByText('0').length).toBeGreaterThanOrEqual(3);
    expect(within(sec).getByText('R$ 0,00')).toBeTruthy();
    expect(within(sec).getByText('Sem vendas')).toBeTruthy();
  });
});

// ── CONVERSÃO (§63) ──────────────────────────────────────────────────
describe('conversão das negociações', () => {
  it('60 => "60%" (sem zeros finais) + "18 de 30 negociações"', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-conversion');
    expect(within(sec).getByText('60%')).toBeTruthy();
    expect(within(sec).getByText(/18 de 30 negociações já viraram venda\./)).toBeTruthy();
  });

  it('33.33 => "33,33%"', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({
      summary: { ...fullReport().summary, dealToSaleConversion: { cohortDealsCount: 3, convertedDealsCount: 1, ratePercent: 33.33 } },
    })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(within(screen.getByTestId('results-conversion')).getByText('33,33%')).toBeTruthy();
  });

  it('coorte vazia => "Sem negociações no período", nunca "0%"', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({
      summary: { ...fullReport().summary, dealToSaleConversion: { cohortDealsCount: 0, convertedDealsCount: 0, ratePercent: null } },
    })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-conversion');
    expect(within(sec).getByTestId('results-conversion-empty').textContent).toMatch(/sem negociações no período/i);
    expect(within(sec).queryByText('0%')).toBeNull();
    expect(within(sec).queryByText(/NaN|Infinity/)).toBeNull();
  });

  it('copy de censoring presente', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(within(screen.getByTestId('results-conversion')).getByText(/negociações recentes ainda podem virar venda/i)).toBeTruthy();
  });
});

// ── TREND (§64) ──────────────────────────────────────────────────────
describe('evolução', () => {
  it('renderiza um gráfico acessível (role img) com as duas séries na legenda', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-trend');
    const chart = within(sec).getByRole('img');
    expect(chart.getAttribute('aria-label')).toMatch(/leads e vendas/i);
    expect(within(sec).getByText('Leads')).toBeTruthy();
    expect(within(sec).getByText('Vendas')).toBeTruthy();
    expect(within(sec).getByText('Leads e vendas no período')).toBeTruthy();
  });

  it('renderiza exatamente os buckets recebidos, incluindo o dia zero-filled (§33)', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const chart = within(screen.getByTestId('results-trend')).getByRole('img');
    // 4 buckets => 4 rótulos de data no eixo (10/03..13/03); o dia
    // 13/03 (0/0) precisa aparecer na descrição acessível.
    expect(chart.getAttribute('aria-label')).toContain('13/03/2026: 0 leads, 0 vendas');
  });

  it('período de 1 dia continua funcionando (§34)', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({
      trend: [{ date: '2026-03-10', leadsReceived: 2, salesCount: 1 }],
    })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(within(screen.getByTestId('results-trend')).getByRole('img')).toBeTruthy();
  });

  it('trend todo-zero: gráfico renderiza + aviso "Sem movimento no período"', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({
      trend: [
        { date: '2026-03-10', leadsReceived: 0, salesCount: 0 },
        { date: '2026-03-11', leadsReceived: 0, salesCount: 0 },
      ],
    })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-trend');
    expect(within(sec).getByRole('img')).toBeTruthy();
    expect(within(sec).getByText(/sem movimento no período/i)).toBeTruthy();
  });
});

// ── EQUIPE (§65) ─────────────────────────────────────────────────────
describe('desempenho da equipe', () => {
  it('cabeçalhos exatos, sem colunas de Leads/Score/Conversão/Ticket', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-team');
    for (const h of ['Vendedor', 'Pendências concluídas', 'Visitas realizadas', 'Negociações', 'Vendas', 'Valor vendido']) {
      expect(within(sec).getByText(h)).toBeTruthy();
    }
    expect(within(sec).queryByText('Leads')).toBeNull();
    expect(within(sec).queryByText('Score')).toBeNull();
    expect(within(sec).queryByText('Conversão')).toBeNull();
    expect(within(sec).queryByText('Ticket médio')).toBeNull();
  });

  it('ordem do backend preservada; seller desligado NÃO some; bucket "Sem vendedor" presente', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const rows = within(screen.getByTestId('results-team')).getAllByTestId('results-team-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Ana Ativa')).toBeTruthy();
    expect(within(rows[1]).getByText('Bruno Desligado')).toBeTruthy();
    expect(within(rows[2]).getByText('Sem vendedor')).toBeTruthy();
    // Valor vendido em BRL
    expect(within(rows[0]).getByText('R$ 60.000,00')).toBeTruthy();
  });

  it('lista vazia => empty state, sem linhas fake', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({ sellerBreakdown: [] })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-team-empty').textContent).toMatch(/nenhuma atividade da equipe neste período/i);
    expect(screen.queryAllByTestId('results-team-row')).toHaveLength(0);
  });
});

// ── ORIGENS (§66) ────────────────────────────────────────────────────
describe('origem dos leads', () => {
  it('usa source_label do backend ("Não informado") e ordem do backend; sem conversão/revenue', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    const sec = screen.getByTestId('results-sources');
    const rows = within(sec).getAllByTestId('results-source-row');
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Facebook', 'Não informado', 'Instagram']);
    expect(within(sec).getByText('Leads recebidos')).toBeTruthy();
    expect(within(sec).getByText('Vendas')).toBeTruthy();
    expect(within(sec).queryByText('Conversão')).toBeNull();
    expect(within(sec).queryByText('Receita')).toBeNull();
  });

  it('lista vazia => empty state', () => {
    m.useManagementReport.mockReturnValue(ready(fullReport({ sourceBreakdown: [] })));
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-sources-empty').textContent).toMatch(/nenhuma origem registrada neste período/i);
  });
});

// ── LOADING / ERROR (§46/§47) ────────────────────────────────────────
describe('estados', () => {
  it('loading => skeleton, sem zeros de resultado', () => {
    m.useManagementReport.mockReturnValue({ status: 'loading' });
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-loading')).toBeTruthy();
    expect(screen.queryByTestId('results-summary')).toBeNull();
  });

  it('error => copy exata + "Tentar novamente" chama retry', () => {
    const retry = vi.fn();
    m.useManagementReport.mockReturnValue({ status: 'error', retry });
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-error').textContent).toMatch(/não foi possível carregar os resultados/i);
    fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(retry).toHaveBeenCalled();
  });

  it('contract-error => mesmo card de erro honesto (nunca números fake)', () => {
    m.useManagementReport.mockReturnValue({ status: 'contract-error', retry: vi.fn() });
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.getByTestId('results-error')).toBeTruthy();
    expect(screen.queryByTestId('results-summary')).toBeNull();
  });
});

// ── REGRESSÃO DE MÉTRICAS FAKE (§68) ─────────────────────────────────
describe('sem métricas legadas hardcoded', () => {
  it('nenhum dos percentuais fixos antigos (67/49/58/34) aparece com dados reais', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    for (const fake of ['67%', '49%', '58%', '34%']) {
      expect(screen.queryByText(fake)).toBeNull();
    }
  });

  it('nenhum motivo de perda hardcoded (40/25/20/10) nem título "Motivos de perda"', () => {
    render(<ManagementResultsScreen currentUser={MANAGER} />);
    expect(screen.queryByText(/motivos de perda/i)).toBeNull();
    expect(screen.queryByText(/conversão por etapa/i)).toBeNull();
    for (const fake of ['40%', '25%', '20%', '10%']) {
      expect(screen.queryByText(fake)).toBeNull();
    }
  });
});
