'use client';
// components/screens/ManagementResults.tsx — KPI-REPORTS-B2-EXEC-FRONTEND.
// Tela gerencial "Resultados V1". Consome EXCLUSIVAMENTE
// get_company_management_report (via useManagementReport) — nenhuma
// tabela comercial é lida para agregar no browser (§1). Substitui o corpo
// antigo de ScreenResultados (ranking de Sales + percentuais fixos), que
// foi removido (§9). Sem nova entrada de navegação (§8): continua sendo a
// tela 'resultados'.
//
// Acesso (§2): Manager (própria empresa) e Super Admin contextual
// (companyId explícito). Seller NÃO recebe este dashboard e a RPC NUNCA é
// chamada para ele — o gate vive em useManagementReport (isAuthorizedRole)
// e aqui companyId fica null para qualquer papel que não seja Manager/
// Super Admin contextual. Super Admin global (sem empresa) também não
// dispara a RPC (§51).
//
// Sem drilldown, sem metas, sem comparação de período, sem insights
// automáticos (§14/§53/§54/§55/§56).
import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LightScreen, PageHead, LCard } from '@/components/ui/kit';
import type { User } from '@/lib/data';
import { AuthService } from '@/lib/services';
import { useOperationalCompanyContext } from '@/lib/operational/OperationalCompanyContext';
import { useCurrentCompanyTimezone } from '@/lib/hooks/useCurrentCompanyTimezone';
import {
  resolvePresetRange,
  resolveCustomRange,
  type PeriodPreset,
  type ResolvedPeriod,
} from '@/lib/date/companyPeriod';
import { useManagementReport } from '@/lib/hooks/useManagementReport';
import type {
  ManagementReport,
  ManagementReportSellerRow,
  ManagementReportSourceRow,
  ManagementReportTrendPoint,
} from '@/lib/managementReport/types';
import { formatCentsToBRL } from '@/lib/deals/money';
import {
  formatRatePercent,
  formatTrendDateShort,
  formatTrendDateLong,
} from '@/lib/managementReport/format';

// ── período ────────────────────────────────────────────────────────────
const PRESETS: PeriodPreset[] = ['Hoje', '7 dias', '15 dias', '30 dias'];
const DEFAULT_PERIOD = '30 dias'; // §11 — nunca all-time, nunca mês civil implícito
type PeriodChoice = PeriodPreset | 'Personalizado';

// ── responsividade (sem lib; mesmo padrão de `narrow` de Home) ──────────
function useColumns(): number {
  const read = () => {
    if (typeof window === 'undefined') return 3;
    const w = window.innerWidth;
    if (w >= 980) return 3;
    if (w >= 640) return 2;
    return 1;
  };
  const [cols, setCols] = useState(read);
  useEffect(() => {
    const onResize = () => setCols(read());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return cols;
}

// ── mensagens centrais (loading skeleton usa outro componente) ──────────
function ResultsMessage({ testId, children, onRetry }: {
  testId: string; children: React.ReactNode; onRetry?: () => void;
}) {
  return (
    <LCard style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
      <div data-testid={testId} style={{ display: 'grid', placeItems: 'center', gap: 14, textAlign: 'center' }}>
        <div style={{ color: 'var(--t-500)', fontSize: 14, maxWidth: 460 }}>{children}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="focus-ring"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontSize: 14,
              fontWeight: 600, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
              background: 'linear-gradient(180deg,#33333a,#222226)', color: '#fff',
              border: '1px solid rgba(255,255,255,.14)',
            }}
          >
            <Icon name="refresh" size={16} stroke={2.2} /> Tentar novamente
          </button>
        )}
      </div>
    </LCard>
  );
}

// ── período: controle no topo (§10/§13) ────────────────────────────────
function ResultsPeriodControl({
  choice, onSelectPreset, appliedCustom, draft, setDraft, open, setOpen, error, onApplyCustom,
}: {
  choice: PeriodChoice;
  onSelectPreset: (p: PeriodPreset) => void;
  appliedCustom: { start: string; end: string } | null;
  draft: { start: string; end: string };
  setDraft: (d: { start: string; end: string }) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  error: string | null;
  onApplyCustom: () => void;
}) {
  const pill = (active: boolean): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    border: 'none', fontFamily: 'inherit', transition: 'all .15s',
    background: active ? 'linear-gradient(180deg,#33333a,#222226)' : 'transparent',
    color: active ? '#fff' : 'var(--t-500)',
  });
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, color: 'var(--t-400)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
        Período
      </span>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 12, padding: 3 }}>
        {PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={choice === p} onClick={() => onSelectPreset(p)} style={pill(choice === p)}>
            {p}
          </button>
        ))}
        <button type="button" aria-pressed={choice === 'Personalizado'} onClick={() => setOpen(!open)} style={pill(choice === 'Personalizado')}>
          Personalizado
        </button>
      </div>
      {choice === 'Personalizado' && appliedCustom && (
        <span style={{ fontSize: 11.5, color: 'var(--t-400)' }}>
          {formatTrendDateShort(appliedCustom.start)} a {formatTrendDateShort(appliedCustom.end)}
        </span>
      )}
      {open && (
        <div
          data-testid="results-custom-period"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 30, background: 'var(--surface-2)',
            border: '1px solid var(--border)', borderRadius: 14, padding: 16, boxShadow: 'var(--shadow-md)',
            display: 'flex', flexDirection: 'column', gap: 10, minWidth: 230,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t-900)' }}>Escolha uma data inicial e final.</div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--t-500)' }}>
            Data inicial
            <input
              type="date" value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', color: 'var(--t-900)', fontFamily: 'inherit', fontSize: 13 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5, color: 'var(--t-500)' }}>
            Data final
            <input
              type="date" value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', color: 'var(--t-900)', fontFamily: 'inherit', fontSize: 13 }}
            />
          </label>
          {error && <div style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</div>}
          <button
            type="button" onClick={onApplyCustom}
            style={{ marginTop: 4, padding: '9px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: 'linear-gradient(180deg,#E8CE72,#C9A227)', color: '#2a2104' }}
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

// ── seção "Visão geral": 6 cards (§16-§24) ─────────────────────────────
function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div data-testid="results-metric" data-label={label}>
      <LCard pad={18} style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 96 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)' }}>{label}</span>
          {hint && (
            <span
              title={hint}
              aria-label={hint}
              style={{ fontSize: 10.5, width: 15, height: 15, borderRadius: 999, border: '1px solid var(--border)', color: 'var(--t-400)', display: 'inline-grid', placeItems: 'center', cursor: 'help', fontWeight: 700 }}
            >
              i
            </span>
          )}
        </div>
        <span className="display tnum" style={{ fontSize: 30, fontWeight: 800, color: 'var(--t-900)', lineHeight: 1.05, letterSpacing: '-.02em' }}>
          {value}
        </span>
      </LCard>
    </div>
  );
}

function SummarySection({ report, columns }: { report: ManagementReport; columns: number }) {
  const s = report.summary;
  const cards: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Leads recebidos',
      value: String(s.leadsReceived),
      hint: 'Leads importados contam na data em que entraram no CRM.',
    },
    { label: 'Vendas realizadas', value: String(s.salesCount) },
    { label: 'Valor vendido', value: formatCentsToBRL(s.revenueCents) },
    {
      label: 'Ticket médio',
      value: s.averageTicketCents === null ? 'Sem vendas' : formatCentsToBRL(s.averageTicketCents),
    },
    { label: 'Visitas realizadas', value: String(s.visitsCompleted) },
    { label: 'Pendências concluídas', value: String(s.tasksCompleted) },
  ];
  return (
    <section data-testid="results-summary" aria-label="Visão geral" style={{ marginBottom: 26 }}>
      <SectionHead icon="grid">Visão geral</SectionHead>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 14 }}>
        {cards.map((c) => (
          <MetricCard key={c.label} label={c.label} value={c.value} hint={c.hint} />
        ))}
      </div>
    </section>
  );
}

// ── seção "Conversão das negociações" (§25-§28) ────────────────────────
function ConversionSection({ report }: { report: ManagementReport }) {
  const c = report.summary.dealToSaleConversion;
  const emptyCohort = c.cohortDealsCount === 0 || c.ratePercent === null;
  return (
    <section data-testid="results-conversion" aria-label="Conversão das negociações" style={{ marginBottom: 26 }}>
      <SectionHead icon="handshake">Conversão das negociações</SectionHead>
      <LCard style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {emptyCohort ? (
          <div data-testid="results-conversion-empty" style={{ fontSize: 14, color: 'var(--t-500)' }}>
            Sem negociações no período.
          </div>
        ) : (
          <>
            <div className="display tnum" style={{ fontSize: 38, fontWeight: 800, color: 'var(--t-900)', lineHeight: 1 }}>
              {formatRatePercent(c.ratePercent as number)}
            </div>
            <div data-testid="results-conversion-counts" style={{ fontSize: 14, color: 'var(--t-700)', fontWeight: 600 }}>
              {c.convertedDealsCount} de {c.cohortDealsCount} negociações já viraram venda.
            </div>
          </>
        )}
        <div
          style={{ fontSize: 12, color: 'var(--t-400)' }}
          title="Esta taxa acompanha as negociações criadas no período, mesmo quando a venda acontece depois."
        >
          Negociações recentes ainda podem virar venda.
        </div>
      </LCard>
    </section>
  );
}

// ── seção "Evolução": trend Leads x Vendas (§29-§34) ───────────────────
const TREND_LEADS_COLOR = 'var(--green)';
const TREND_SALES_COLOR = 'var(--gold-ink)';

function TrendChart({ points }: { points: ManagementReportTrendPoint[] }) {
  // Renderiza EXATAMENTE a série recebida (já com zero-fill do backend,
  // §33) — nenhuma reconstrução de bucket aqui.
  const width = 720;
  const height = 220;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxValue = Math.max(
    1,
    ...points.map((p) => Math.max(p.leadsReceived, p.salesCount)),
  );
  const n = points.length;
  const xFor = (i: number) => (n <= 1 ? padL + innerW / 2 : padL + (innerW * i) / (n - 1));
  const yFor = (v: number) => padT + innerH - (innerH * v) / maxValue;

  const linePath = (key: 'leadsReceived' | 'salesCount') =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p[key]).toFixed(1)}`).join(' ');

  // Ticks Y: 0, meio, topo (inteiros).
  const yTicks = Array.from(new Set([0, Math.round(maxValue / 2), maxValue]));

  // Rótulos X: no máximo ~8 para não empilhar.
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  const describeData = points
    .map((p) => `${formatTrendDateLong(p.date)}: ${p.leadsReceived} leads, ${p.salesCount} vendas`)
    .join('; ');

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        role="img"
        aria-label={`Evolução de leads e vendas por dia. ${describeData || 'Sem dados no período.'}`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', minWidth: 320, height: 'auto', display: 'block' }}
      >
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line x1={padL} y1={yFor(t)} x2={width - padR} y2={yFor(t)} stroke="var(--border-2)" strokeWidth={1} />
            <text x={padL - 6} y={yFor(t) + 3} textAnchor="end" fontSize={10} fill="var(--t-400)">{t}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={`x-${p.date}`} x={xFor(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--t-400)">
              {formatTrendDateShort(p.date)}
            </text>
          ) : null,
        )}
        {n > 1 && (
          <>
            <path d={linePath('leadsReceived')} fill="none" stroke={TREND_LEADS_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={linePath('salesCount')} fill="none" stroke={TREND_SALES_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        )}
        {points.map((p, i) => (
          <g key={`pt-${p.date}`}>
            <circle cx={xFor(i)} cy={yFor(p.leadsReceived)} r={n <= 1 ? 4 : 3} fill={TREND_LEADS_COLOR}>
              <title>{`${formatTrendDateLong(p.date)} — Leads: ${p.leadsReceived}, Vendas: ${p.salesCount}`}</title>
            </circle>
            <circle cx={xFor(i)} cy={yFor(p.salesCount)} r={n <= 1 ? 4 : 3} fill={TREND_SALES_COLOR}>
              <title>{`${formatTrendDateLong(p.date)} — Leads: ${p.leadsReceived}, Vendas: ${p.salesCount}`}</title>
            </circle>
            {n <= 1 && (
              <>
                <text x={xFor(i) + 8} y={yFor(p.leadsReceived) + 3} fontSize={11} fill={TREND_LEADS_COLOR}>{p.leadsReceived}</text>
                <text x={xFor(i) + 8} y={yFor(p.salesCount) + 3} fontSize={11} fill={TREND_SALES_COLOR}>{p.salesCount}</text>
              </>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function TrendSection({ report }: { report: ManagementReport }) {
  const points = report.trend;
  const hasMovement = points.some((p) => p.leadsReceived > 0 || p.salesCount > 0);
  return (
    <section data-testid="results-trend" aria-label="Evolução" style={{ marginBottom: 26 }}>
      <SectionHead icon="trend" sub="Leads e vendas no período">Evolução</SectionHead>
      <LCard>
        <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: 'var(--t-500)' }}>
          <LegendDot color={TREND_LEADS_COLOR} label="Leads" />
          <LegendDot color={TREND_SALES_COLOR} label="Vendas" />
        </div>
        {points.length === 0 ? (
          <div data-testid="results-trend-empty" style={{ fontSize: 14, color: 'var(--t-500)', padding: '20px 0' }}>
            Sem dados no período.
          </div>
        ) : (
          <>
            <TrendChart points={points} />
            {!hasMovement && (
              <div style={{ fontSize: 12, color: 'var(--t-400)', marginTop: 8 }}>Sem movimento no período.</div>
            )}
          </>
        )}
      </LCard>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

// ── seção "Desempenho da equipe" (§35-§40) ─────────────────────────────
const TEAM_COLS: { key: keyof ManagementReportSellerRow | 'sellerName'; label: string; money?: boolean }[] = [
  { key: 'sellerName', label: 'Vendedor' },
  { key: 'tasksCompleted', label: 'Pendências concluídas' },
  { key: 'visitsCompleted', label: 'Visitas realizadas' },
  { key: 'dealsCreated', label: 'Negociações' },
  { key: 'salesCount', label: 'Vendas' },
  { key: 'revenueCents', label: 'Valor vendido', money: true },
];

function TeamSection({ report }: { report: ManagementReport }) {
  const rows = report.sellerBreakdown; // ordem do backend preservada (§38)
  return (
    <section data-testid="results-team" aria-label="Desempenho da equipe" style={{ marginBottom: 26 }}>
      <SectionHead icon="users">Desempenho da equipe</SectionHead>
      {rows.length === 0 ? (
        <ResultsMessage testId="results-team-empty">Nenhuma atividade da equipe neste período.</ResultsMessage>
      ) : (
        <LCard pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {TEAM_COLS.map((col, i) => (
                    <th
                      key={col.label}
                      scope="col"
                      style={{
                        textAlign: i === 0 ? 'left' : 'right', padding: '11px 16px', fontSize: 11,
                        color: 'var(--t-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
                        borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.sellerId ?? '__no_seller__'} data-testid="results-team-row">
                    {TEAM_COLS.map((col, ci) => {
                      const raw = row[col.key as keyof ManagementReportSellerRow];
                      const content = col.key === 'sellerName'
                        ? row.sellerName
                        : col.money
                          ? formatCentsToBRL(raw as number)
                          : String(raw as number);
                      return (
                        <td
                          key={col.label}
                          style={{
                            textAlign: ci === 0 ? 'left' : 'right', padding: '11px 16px',
                            borderTop: ri === 0 ? 'none' : '1px solid var(--border-2)',
                            color: ci === 0 ? 'var(--t-900)' : 'var(--t-700)',
                            fontWeight: ci === 0 ? 600 : 500, whiteSpace: 'nowrap',
                          }}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LCard>
      )}
    </section>
  );
}

// ── seção "Origem dos Leads" (§41-§45) ─────────────────────────────────
function SourceSection({ report }: { report: ManagementReport }) {
  const rows = report.sourceBreakdown; // ordem do backend preservada (§43)
  const maxLeads = Math.max(1, ...rows.map((r) => r.leadsReceived));
  return (
    <section data-testid="results-sources" aria-label="Origem dos Leads" style={{ marginBottom: 8 }}>
      <SectionHead icon="mapPin">Origem dos Leads</SectionHead>
      {rows.length === 0 ? (
        <ResultsMessage testId="results-sources-empty">Nenhuma origem registrada neste período.</ResultsMessage>
      ) : (
        <LCard pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th scope="col" style={thStyle('left')}>Origem</th>
                  <th scope="col" style={thStyle('right')}>Leads recebidos</th>
                  <th scope="col" style={thStyle('right')}>Vendas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: ManagementReportSourceRow, ri) => (
                  <tr key={row.sourceKey} data-testid="results-source-row">
                    <td style={{ padding: '11px 16px', borderTop: ri === 0 ? 'none' : '1px solid var(--border-2)', color: 'var(--t-900)', fontWeight: 600 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span>{row.sourceLabel}</span>
                        <span
                          aria-hidden="true"
                          style={{
                            height: 4, borderRadius: 999, background: 'var(--green)', opacity: 0.55,
                            width: `${Math.max(4, Math.round((row.leadsReceived / maxLeads) * 100))}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', borderTop: ri === 0 ? 'none' : '1px solid var(--border-2)', textAlign: 'right', color: 'var(--t-700)', fontWeight: 600 }}>
                      {row.leadsReceived}
                    </td>
                    <td style={{ padding: '11px 16px', borderTop: ri === 0 ? 'none' : '1px solid var(--border-2)', textAlign: 'right', color: 'var(--t-700)', fontWeight: 600 }}>
                      {row.salesCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </LCard>
      )}
    </section>
  );
}

function thStyle(align: 'left' | 'right'): React.CSSProperties {
  return {
    textAlign: align, padding: '11px 16px', fontSize: 11, color: 'var(--t-400)', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  };
}

function SectionHead({ icon, sub, children }: { icon: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Icon name={icon} size={16} stroke={2.2} style={{ color: 'var(--t-500)' }} />
        <h2 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: 'var(--t-900)' }}>{children}</h2>
      </div>
      {sub && <p style={{ margin: '4px 0 0 25px', fontSize: 12.5, color: 'var(--t-400)' }}>{sub}</p>}
    </div>
  );
}

// ── skeleton (§46) ────────────────────────────────────────────────────
function SkeletonBlock({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height, borderRadius: 'var(--radius)', background: 'linear-gradient(180deg,#1a1a1d,#131315)',
        border: '1px solid var(--border)', marginBottom: 14,
      }}
    />
  );
}

function ResultsSkeleton({ columns }: { columns: number }) {
  return (
    <div data-testid="results-loading" aria-busy="true">
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 14, marginBottom: 26 }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} height={96} />)}
      </div>
      <SkeletonBlock height={120} />
      <SkeletonBlock height={260} />
      <SkeletonBlock height={200} />
    </div>
  );
}

// ── tela ──────────────────────────────────────────────────────────────
const PAGE_TITLE = 'Resultados';
const PAGE_SUB = 'Como a equipe está performando, em números simples.';

export function ManagementResultsScreen({ currentUser }: { currentUser?: User | null }) {
  const operational = useOperationalCompanyContext();
  const columns = useColumns();

  const isSuperAdminCtx = operational.mode === 'super_admin';
  const membershipRole = currentUser?.activeMembership?.role ?? null;
  const isManager = !isSuperAdminCtx && membershipRole === 'manager';
  const authorized = isManager || isSuperAdminCtx;

  // companyId fica null para qualquer papel não autorizado — timezone e
  // relatório nunca disparam nesse caso (Seller / Super Admin global).
  const companyId = isSuperAdminCtx
    ? operational.companyId
    : isManager
      ? (currentUser?.activeMembership?.companyId ?? null)
      : null;
  const userId = currentUser?.id ?? null;
  const userIsActive = Boolean(currentUser);

  // Período (§10-§13). Estado local, sem URL/persistência — mesma decisão
  // do Pódio.
  const [choice, setChoice] = useState<PeriodChoice>(DEFAULT_PERIOD);
  const [appliedCustom, setAppliedCustom] = useState<{ start: string; end: string } | null>(null);
  const [draft, setDraft] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [customOpen, setCustomOpen] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const companyTimezone = useCurrentCompanyTimezone({
    userId,
    companyId,
    membershipRole: isManager ? 'manager' : null,
    userIsActive,
    isSuperAdminContext: isSuperAdminCtx,
  });

  // Resolve o intervalo absoluto no timezone da empresa (§12) — 'loading'
  // enquanto o timezone não chegou (nunca calcula com o fuso do
  // navegador). Mesma cascata do Pódio.
  const periodResolution: ResolvedPeriod = useMemo(() => {
    if (companyTimezone.status === 'loading' || companyTimezone.status === 'local') return { kind: 'loading' };
    if (companyTimezone.status === 'unavailable') return { kind: 'unavailable' };
    if (companyTimezone.status === 'error') return { kind: 'error', retry: companyTimezone.retry };

    const tz = companyTimezone.timezone;
    if (choice === 'Personalizado') {
      if (!appliedCustom) return { kind: 'unavailable' };
      const range = resolveCustomRange(appliedCustom.start, appliedCustom.end, tz);
      return range ? { kind: 'ready', ...range } : { kind: 'unavailable' };
    }
    const range = resolvePresetRange(choice, tz, new Date());
    return { kind: 'ready', ...range };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, appliedCustom, companyTimezone.status, (companyTimezone as { timezone?: string }).timezone]);

  const report = useManagementReport({
    userId,
    companyId,
    membershipRole: isManager ? 'manager' : null,
    userIsActive,
    period: periodResolution,
    isSuperAdminContext: isSuperAdminCtx,
  });

  function selectPreset(p: PeriodPreset) {
    setChoice(p);
    setCustomOpen(false);
    setCustomError(null);
  }

  function applyCustom() {
    if (!draft.start || !draft.end) {
      setCustomError('Escolha uma data inicial e uma data final.');
      return;
    }
    if (draft.start > draft.end) {
      setCustomError('A data inicial precisa ser antes da data final.');
      return;
    }
    setCustomError(null);
    setAppliedCustom({ start: draft.start, end: draft.end });
    setChoice('Personalizado');
    setCustomOpen(false);
  }

  // Não autorizado: nunca chama a RPC (companyId null já garante). Super
  // Admin global => orienta a abrir uma empresa (§51). Seller => mensagem
  // neutra (a nav já impede chegar aqui).
  if (!authorized) {
    return (
      <LightScreen>
        <PageHead title={PAGE_TITLE} sub={PAGE_SUB} />
        <ResultsMessage testId="results-no-company">
          {isSuperAdminCtx
            ? 'Abra uma empresa para ver os resultados.'
            : operational.mode === 'none' && currentUser?.platformRole === 'super_admin'
              ? 'Abra uma empresa para ver os resultados gerenciais.'
              : 'Os resultados gerenciais não estão disponíveis para o seu perfil.'}
        </ResultsMessage>
      </LightScreen>
    );
  }

  const periodControl = (
    <ResultsPeriodControl
      choice={choice}
      onSelectPreset={selectPreset}
      appliedCustom={appliedCustom}
      draft={draft}
      setDraft={setDraft}
      open={customOpen}
      setOpen={setCustomOpen}
      error={customError}
      onApplyCustom={applyCustom}
    />
  );

  let body: React.ReactNode;
  if (report.status === 'local') {
    body = (
      <ResultsMessage testId="results-unavailable">
        Os resultados em tempo real ainda não estão disponíveis nesta conta.
      </ResultsMessage>
    );
  } else if (report.status === 'loading') {
    body = <ResultsSkeleton columns={columns} />;
  } else if (report.status === 'error' || report.status === 'contract-error') {
    body = (
      <ResultsMessage testId="results-error" onRetry={report.retry}>
        Não foi possível carregar os resultados.
      </ResultsMessage>
    );
  } else if (report.status === 'unavailable') {
    body = (
      <ResultsMessage testId="results-unavailable">
        Os resultados não estão disponíveis nesta sessão.
      </ResultsMessage>
    );
  } else {
    body = (
      <>
        <SummarySection report={report.report} columns={columns} />
        <ConversionSection report={report.report} />
        <TrendSection report={report.report} />
        <TeamSection report={report.report} />
        <SourceSection report={report.report} />
      </>
    );
  }

  return (
    <LightScreen>
      <PageHead title={PAGE_TITLE} sub={PAGE_SUB} actions={report.status === 'local' ? undefined : periodControl} />
      {body}
    </LightScreen>
  );
}

// Wrapper mantido com o mesmo nome/entrada do App (screen 'resultados').
export function ScreenResultados() {
  const currentUser = AuthService.getCurrentUser();
  return <ManagementResultsScreen currentUser={currentUser} />;
}
