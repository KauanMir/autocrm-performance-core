// lib/commercial/errors.ts — erros tipados da leitura comercial do Super
// Admin (M1-F S8-C2-B2). Mesmo padrão de lib/leads/errors.ts e
// lib/companies/errors.ts: código/mensagem ESTÁVEIS, nunca exibidos crus ao
// usuário (SQLSTATE/mensagem do PostgREST ficam só em `detail`, já
// higienizado — nunca token, credencial, URL ou query completa).

export type PlatformCommercialErrorCode =
  | 'platform_commercial_companies_fetch_failed'
  | 'platform_commercial_leads_fetch_failed'
  | 'platform_commercial_timeline_fetch_failed'
  | 'platform_commercial_stages_fetch_failed'
  // Espelham os erros estáveis das 4 RPCs (forbidden/company_required/
  // company_not_found/lead_required/lead_not_found) — nunca inventados aqui,
  // só repassados como causa técnica em `detail.message`.
  | 'platform_commercial_forbidden'
  | 'platform_commercial_company_required';

export interface PlatformCommercialErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class PlatformCommercialError extends Error {
  readonly code: PlatformCommercialErrorCode;
  readonly detail: PlatformCommercialErrorDetail;

  constructor(code: PlatformCommercialErrorCode, detail: PlatformCommercialErrorDetail = {}) {
    super(code);
    this.name = 'PlatformCommercialError';
    this.code = code;
    this.detail = detail;
  }
}

export function isPlatformCommercialError(error: unknown): error is PlatformCommercialError {
  return error instanceof PlatformCommercialError;
}
