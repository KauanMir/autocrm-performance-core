// Tentativa imediata de processamento após o registro durável do evento.
// SERVER-ONLY. waitUntil é aceleração, NÃO durabilidade: se o processo morrer, o
// evento continua received/processing no banco e a recuperação é do sweep
// (fase futura). A promise nunca rejeita: a resposta HTTP já foi decidida.
import { waitUntil } from '@vercel/functions';
import { createMetaLeadgenProcessorDeps, processMetaLeadgenEvent } from './process-leadgen-event';

async function runProcessingSafely(eventId: string): Promise<void> {
  try {
    await processMetaLeadgenEvent(eventId, createMetaLeadgenProcessorDeps());
  } catch {
    // Sem log de erro bruto: nenhum ID, PII ou mensagem de dependência sai daqui.
  }
}

export function scheduleMetaLeadgenProcessing(eventId: string): void {
  waitUntil(runProcessingSafely(eventId));
}
