// Testes de lib/managementReport/queryKeys.ts (KPI-REPORTS-B2-EXEC-
// FRONTEND §7/§60). Prova: isolamento por company; isolamento por período;
// prefixo estável.
import { describe, expect, it } from 'vitest';
import {
  managementReportQueryKey,
  managementReportQueryPrefix,
} from '@/lib/managementReport/queryKeys';

describe('managementReportQueryKey', () => {
  it('inclui company, userId, periodStart e periodEnd', () => {
    expect(managementReportQueryKey('company-a', 'user-1', 1000, 2000)).toEqual([
      'company', 'company-a', 'management-report', 'remote', 'user-1', 1000, 2000,
    ]);
  });

  it('Company A e Company B nunca compartilham cache (mesmo período/usuário)', () => {
    const a = managementReportQueryKey('company-a', 'user-1', 1000, 2000);
    const b = managementReportQueryKey('company-b', 'user-1', 1000, 2000);
    expect(a).not.toEqual(b);
    expect(a[1]).toBe('company-a');
    expect(b[1]).toBe('company-b');
  });

  it('troca de período gera key diferente (nova consulta)', () => {
    const p1 = managementReportQueryKey('company-a', 'user-1', 1000, 2000);
    const p2 = managementReportQueryKey('company-a', 'user-1', 1000, 3000);
    expect(p1).not.toEqual(p2);
  });

  it('a key não carrega role nem token', () => {
    const k = managementReportQueryKey('company-a', 'user-1', 1000, 2000);
    expect(k).not.toContain('manager');
    expect(k).not.toContain('seller');
  });
});

describe('managementReportQueryPrefix', () => {
  it('prefixo estável sem userId/período', () => {
    expect(managementReportQueryPrefix('company-a')).toEqual([
      'company', 'company-a', 'management-report', 'remote',
    ]);
  });

  it('é prefixo real da key completa', () => {
    const prefix = managementReportQueryPrefix('company-a');
    const full = managementReportQueryKey('company-a', 'user-1', 1000, 2000);
    expect(full.slice(0, prefix.length)).toEqual([...prefix]);
  });
});
