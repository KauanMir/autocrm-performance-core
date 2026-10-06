// Sweep de eventos leadgen pendentes. SERVER-ONLY. Um batch por execução:
// claim_batch (uma única aquisição de lease por evento) → processador já com
// lease. Sequencial, para caber no lease de 300 s. Não é rota nem cron: é um
// módulo chamável por uma fase futura. Resumo sem IDs, PII ou erro bruto.
import {
  createMetaLeadgenProcessorDeps,
  processClaimedMetaLeadgenEvent,
  type MetaLeadProcessorDeps,
  type MetaLeadProcessorResult,
} from './process-leadgen-event';

export const SWEEP_DEFAULT_LIMIT = 20;
export const SWEEP_MAX_LIMIT = 20;
// Pior caso sequencial: 20 × (Graph 8 s + banco). Abaixo de 300 s com folga.
export const SWEEP_LEASE_SECONDS = 300;

export interface MetaLeadSweepSummary {
  attempted: number;
  created: number;
  linkedExisting: number;
  failed: number;
  leaseLost: number;
  // Zero por construção: o claim em lote só devolve eventos que este sweep
  // adquiriu. Eventos que outro worker segura não aparecem aqui.
  notClaimed: number;
  infrastructureErrors: number;
}

function emptySummary(): MetaLeadSweepSummary {
  return {
    attempted: 0,
    created: 0,
    linkedExisting: 0,
    failed: 0,
    leaseLost: 0,
    notClaimed: 0,
    infrastructureErrors: 0,
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit)) return SWEEP_DEFAULT_LIMIT;
  return Math.min(Math.max(limit, 1), SWEEP_MAX_LIMIT);
}

function tally(summary: MetaLeadSweepSummary, result: MetaLeadProcessorResult): void {
  switch (result.outcome) {
    case 'created':
      summary.created += 1;
      return;
    case 'linked_existing':
      summary.linkedExisting += 1;
      return;
    case 'failed':
      summary.failed += 1;
      return;
    case 'lease_lost':
      summary.leaseLost += 1;
      return;
    case 'not_claimed':
      summary.notClaimed += 1;
      return;
    default:
      summary.infrastructureErrors += 1;
  }
}

export async function sweepMetaLeadgenEvents(
  options: { limit?: number; deps?: MetaLeadProcessorDeps } = {},
): Promise<MetaLeadSweepSummary> {
  const summary = emptySummary();
  let deps: MetaLeadProcessorDeps;
  try {
    deps = options.deps ?? createMetaLeadgenProcessorDeps();
  } catch {
    summary.infrastructureErrors += 1;
    return summary;
  }

  const claimed = await deps.rpc.claimBatch(clampLimit(options.limit), SWEEP_LEASE_SECONDS);
  if (!claimed.ok) {
    summary.infrastructureErrors += 1;
    return summary;
  }

  for (const event of claimed.value) {
    summary.attempted += 1;
    try {
      tally(summary, await processClaimedMetaLeadgenEvent(event, deps));
    } catch {
      summary.infrastructureErrors += 1;
    }
  }
  return summary;
}
