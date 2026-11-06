// Tentativa imediata de processamento após o registro durável do evento.
// SERVER-ONLY. waitUntil é aceleração, NÃO durabilidade: se o processo morrer,
// o evento continua received/processing no banco e o sweep o recupera.
//
// META-MVP1 — sweep oportunístico: depois do evento novo, a mesma execução
// também tenta até OPPORTUNISTIC_SWEEP_LIMIT eventos já vencidos (retries,
// leases expirados, reprocessamentos manuais). Isso não substitui o cron, mas
// faz as novas tentativas andarem sempre que chega um lead, inclusive no plano
// Hobby da Vercel, onde o cron só pode rodar uma vez por dia.
//
// As promises nunca rejeitam: a resposta HTTP já foi decidida.
import { waitUntil } from '@vercel/functions';
import {
  createMetaLeadgenProcessorDeps,
  processMetaLeadgenEvent,
  type MetaLeadProcessorDeps,
  type ProcessingTrigger,
} from './process-leadgen-event';
import { sweepMetaLeadgenEvents } from './sweep-leadgen-events';

export const OPPORTUNISTIC_SWEEP_LIMIT = 5;

export async function runLeadgenProcessingSafely(
  eventId: string,
  trigger: ProcessingTrigger,
  makeDeps: () => MetaLeadProcessorDeps = createMetaLeadgenProcessorDeps,
): Promise<void> {
  let deps: MetaLeadProcessorDeps;
  try {
    deps = makeDeps();
  } catch {
    return;
  }
  try {
    await processMetaLeadgenEvent(eventId, deps, trigger);
  } catch {
    // Sem log de erro bruto: nenhum ID, PII ou mensagem de dependência sai daqui.
  }
  try {
    await sweepMetaLeadgenEvents({ limit: OPPORTUNISTIC_SWEEP_LIMIT, deps });
  } catch {
    // Idem.
  }
}

export function scheduleMetaLeadgenProcessing(eventId: string): void {
  waitUntil(runLeadgenProcessingSafely(eventId, 'webhook'));
}

// Reprocessamento pedido por um usuário autorizado (fila de revisão).
export function scheduleManualRequeueProcessing(eventId: string): void {
  waitUntil(runLeadgenProcessingSafely(eventId, 'manual_requeue'));
}

// META-MVP2: eventos retidos liberados pelo Super Admin entram como `received`.
// Um sweep imediato processa até o limite; o restante segue pelo sweep normal.
export function scheduleUnroutedAdoptionSweep(): void {
  waitUntil(sweepMetaLeadgenEvents().then(() => undefined, () => undefined));
}
