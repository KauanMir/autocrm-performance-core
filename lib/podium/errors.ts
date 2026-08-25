// lib/podium/errors.ts — erros tipados do leaderboard company-wide
// (PODIUM-COMPETITION-R1-EXEC). Mesmo padrão de lib/companies/errors.ts:
// código/mensagem ESTÁVEIS, nunca exibidos crus ao usuário (SQLSTATE/nome
// de policy/stack ficam só em `detail`, já higienizado).

export type PodiumLeaderboardErrorCode = 'podium_leaderboard_fetch_failed';

export interface PodiumLeaderboardErrorDetail {
  code?: string;
  message?: string;
  operation?: string;
}

export class PodiumLeaderboardError extends Error {
  readonly code: PodiumLeaderboardErrorCode;
  readonly detail: PodiumLeaderboardErrorDetail;

  constructor(code: PodiumLeaderboardErrorCode, detail: PodiumLeaderboardErrorDetail = {}) {
    super(code);
    this.name = 'PodiumLeaderboardError';
    this.code = code;
    this.detail = detail;
  }
}

export function isPodiumLeaderboardError(error: unknown): error is PodiumLeaderboardError {
  return error instanceof PodiumLeaderboardError;
}
