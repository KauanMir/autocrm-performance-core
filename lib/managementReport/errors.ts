// lib/managementReport/errors.ts — erros tipados do relatório gerencial
// (KPI-REPORTS-B2-EXEC-FRONTEND). Mesmo padrão de lib/podium/errors.ts:
// código/mensagem ESTÁVEIS, nunca exibidos crus ao usuário — SQLSTATE,
// nome de policy, stack e mensagem do PostgREST ficam só em `detail`, já
// higienizado (sem token, sem URL, sem query).

export type ManagementReportErrorCode =
  // Falha de rede/RPC (PostgREST retornou error, ou a chamada rejeitou).
  | 'management_report_fetch_failed'
  // A RPC respondeu, mas o JSON não bate com o contrato congelado
  // (KPI_REPORTS_A2_DESIGN + ADDENDUM) — nunca inventamos números para
  // preencher o buraco, o consumidor mostra um estado de erro honesto.
  | 'management_report_contract_invalid';

export interface ManagementReportErrorDetail {
  code?: string;
  message?: string;
  field?: string;
}

export class ManagementReportError extends Error {
  readonly code: ManagementReportErrorCode;
  readonly detail: ManagementReportErrorDetail;

  constructor(code: ManagementReportErrorCode, detail: ManagementReportErrorDetail = {}) {
    super(code);
    this.name = 'ManagementReportError';
    this.code = code;
    this.detail = detail;
  }
}

export function isManagementReportError(error: unknown): error is ManagementReportError {
  return error instanceof ManagementReportError;
}
