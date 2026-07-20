// lib/companies/errors.ts — erros tipados da listagem/criação administrativa
// de empresas (M1-F S3-B). Mesmo padrão de lib/leads/errors.ts: código/
// mensagem ESTÁVEIS, nunca exibidos crus ao usuário (SQLSTATE/nome de
// policy/stack ficam só em `detail`, já higienizado).

export type PlatformCompanyErrorCode =
  | 'platform_companies_fetch_failed'
  | 'platform_companies_create_failed';

// Causa técnica segura: somente código (SQLSTATE) e mensagem do PostgREST —
// nunca token, credencial, URL ou query completa.
export interface PlatformCompanyErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class PlatformCompanyError extends Error {
  readonly code: PlatformCompanyErrorCode;
  readonly detail: PlatformCompanyErrorDetail;

  constructor(code: PlatformCompanyErrorCode, detail: PlatformCompanyErrorDetail = {}) {
    super(code);
    this.name = 'PlatformCompanyError';
    this.code = code;
    this.detail = detail;
  }
}

export function isPlatformCompanyError(error: unknown): error is PlatformCompanyError {
  return error instanceof PlatformCompanyError;
}
