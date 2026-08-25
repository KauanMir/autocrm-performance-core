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

// PODIUM-COMPETITION-R2B-B1-EXEC — eventos reais de melhora de ranking
// (seller_competition_events). Mesmo padrão de PodiumLeaderboardError.
export type PodiumCompetitionEventsErrorCode =
  | 'competition_events_fetch_failed'
  | 'competition_events_mark_seen_failed';

export interface PodiumCompetitionEventsErrorDetail {
  code?: string;
  message?: string;
}

export class PodiumCompetitionEventsError extends Error {
  readonly code: PodiumCompetitionEventsErrorCode;
  readonly detail: PodiumCompetitionEventsErrorDetail;

  constructor(code: PodiumCompetitionEventsErrorCode, detail: PodiumCompetitionEventsErrorDetail = {}) {
    super(code);
    this.name = 'PodiumCompetitionEventsError';
    this.code = code;
    this.detail = detail;
  }
}

export function isPodiumCompetitionEventsError(error: unknown): error is PodiumCompetitionEventsError {
  return error instanceof PodiumCompetitionEventsError;
}
