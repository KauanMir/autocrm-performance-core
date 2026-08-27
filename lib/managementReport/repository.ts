// lib/managementReport/repository.ts — KPI-REPORTS-B2-EXEC-FRONTEND §4.
// Único caminho de leitura do relatório gerencial:
// public.get_company_management_report (SECURITY DEFINER, agregação 100%
// server-side). NUNCA lê leads/tasks/visits/deals/sales diretamente para
// agregar no browser (§1). Sem React, sem cache — hooks cuidam disso.
//
// Assinatura da RPC: lib/supabase/database.types.ts é a autoridade
// (p_period_start / p_period_end obrigatórios, p_company_id opcional,
// Returns: Json). O adapter valida o conteúdo do Json contra o contrato
// congelado (KPI_REPORTS_A2_DESIGN + ADDENDUM).
import { supabase } from '@/lib/supabase/client';
import { ManagementReportError, isManagementReportError } from '@/lib/managementReport/errors';
import { adaptManagementReport } from '@/lib/managementReport/adapter';
import type { ManagementReport } from '@/lib/managementReport/types';

export type FetchManagementReportInput = {
  periodStartMillis: number;
  periodEndMillis: number;
  // Enviado SOMENTE no modo Super Admin contextual (companyId explícito da
  // URL /company/[id]). Manager/Seller nunca enviam — o backend deriva a
  // empresa da própria membership via _resolve_commercial_read_company, e
  // o gate de relatório gerencial nega Seller lá dentro (Seller nem chega
  // aqui: o hook não habilita a query, §2/§52).
  companyId?: string;
};

export async function fetchManagementReport(
  input: FetchManagementReportInput,
): Promise<ManagementReport> {
  const { data, error } = await supabase.rpc('get_company_management_report', {
    p_period_start: new Date(input.periodStartMillis).toISOString(),
    p_period_end: new Date(input.periodEndMillis).toISOString(),
    p_company_id: input.companyId,
  });

  if (error) {
    throw new ManagementReportError('management_report_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  try {
    return adaptManagementReport(data);
  } catch (adapterError) {
    if (isManagementReportError(adapterError)) throw adapterError;
    // Qualquer throw inesperado do adapter também vira erro de contrato
    // sanitizado — nunca propaga um erro cru.
    throw new ManagementReportError('management_report_contract_invalid', {});
  }
}
