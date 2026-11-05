// lib/integrations/metaLeadOpsCopy.ts — META-MVP1. Textos puros da operação
// Lead Ads (sem React, sem rede). Cada código fechado do ledger vira uma frase
// que diz o que aconteceu e o que fazer.
import type { MetaConnectionHealth, ReviewState } from './metaLeadOps';

const ERROR_COPY: Record<string, { title: string; action: string }> = {
  token_decrypt_failed: { title: 'Não foi possível ler a credencial salva', action: 'Reconecte a Página da Meta.' },
  token_invalid: { title: 'A Meta recusou a credencial da Página', action: 'Reconecte a Página e reprocesse.' },
  token_expired: { title: 'A credencial da Página venceu', action: 'Reconecte a Página e reprocesse.' },
  graph_permission_missing: { title: 'Falta permissão para ler o lead na Meta', action: 'Reconecte concedendo leads_retrieval.' },
  graph_timeout: { title: 'A Meta demorou para responder', action: 'Nova tentativa automática.' },
  graph_error: { title: 'Erro temporário da Meta', action: 'Nova tentativa automática.' },
  graph_malformed: { title: 'Resposta inesperada da Meta', action: 'Nova tentativa automática.' },
  lead_not_found: { title: 'A Meta ainda não liberou o lead', action: 'Nova tentativa automática.' },
  crm_create_failed: { title: 'Falha ao gravar no CRM', action: 'Nova tentativa automática.' },
  initial_stage_missing: { title: 'A empresa não tem a etapa inicial “Novo”', action: 'Restaure a etapa e reprocesse.' },
  integration_not_found: { title: 'A conexão desta Página não existe mais', action: 'Reconecte a Página e reprocesse.' },
  invalid_field_data: { title: 'Formulário em formato inesperado', action: 'Veja o lead na Central de Leads da Meta.' },
  missing_name: { title: 'Formulário sem nome', action: 'Mapeie o campo de nome do formulário e reprocesse.' },
  missing_phone: { title: 'Formulário sem telefone brasileiro válido', action: 'Mapeie o campo de telefone ou trate o lead na Meta.' },
  duplicate_phone_ambiguous: { title: 'Mais de um lead ativo com este telefone', action: 'Arquive o duplicado e reprocesse.' },
  max_attempts: { title: 'Tentativas automáticas esgotadas', action: 'Reprocesse depois de verificar a conexão.' },
  event_expired: { title: 'Ficou 7 dias sem conseguir processar', action: 'Reprocesse (a Meta guarda o lead por 90 dias).' },
};

export function describeLeadErrorCode(code: string | null): { title: string; action: string } {
  if (code === null) return { title: 'Aguardando processamento', action: 'Verifique se o agendador está ativo.' };
  return ERROR_COPY[code] ?? { title: 'Falha não classificada', action: 'Investigue nos logs pelo código do evento.' };
}

export function reviewStateLabel(state: ReviewState): string {
  if (state === 'failed') return 'Falhou';
  if (state === 'stuck') return 'Parado';
  return 'Nova tentativa agendada';
}

export const DISMISS_LABELS: Record<'handled_manually' | 'duplicate' | 'test_event' | 'not_recoverable', string> = {
  handled_manually: 'Tratado manualmente',
  duplicate: 'Duplicado',
  test_event: 'Evento de teste',
  not_recoverable: 'Não recuperável',
};

export type ConnectionTone = 'green' | 'amber' | 'red';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RENEWAL_WARNING_DAYS = 14;

export function summarizeConnection(health: MetaConnectionHealth, now: Date): { tone: ConnectionTone; label: string; detail: string } {
  if (health.status === 'disconnected') {
    return { tone: 'red', label: 'Desconectada', detail: 'Leads desta Página não são recebidos.' };
  }
  if (health.status === 'error') {
    const reason = describeLeadErrorCode(
      health.lastErrorCode === 'permission_missing' ? 'graph_permission_missing' : health.lastErrorCode,
    );
    return { tone: 'red', label: 'Reconexão necessária', detail: `${reason.title}. Leads recebidos aguardam na fila.` };
  }
  if (health.tokenCheckedAt === null) {
    return { tone: 'amber', label: 'Validade não verificada', detail: 'Conexão anterior ao MVP-1. Reconecte para verificar o token.' };
  }
  const deadlines = [health.tokenExpiresAt, health.tokenDataAccessExpiresAt]
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (deadlines.length === 0) {
    return { tone: 'green', label: 'Conectada', detail: 'A Meta não informou vencimento para esta credencial.' };
  }
  const soonest = Math.min(...deadlines);
  const days = Math.floor((soonest - now.getTime()) / DAY_MS);
  if (days < 0) return { tone: 'red', label: 'Credencial vencida', detail: 'Reconecte a Página.' };
  if (days <= RENEWAL_WARNING_DAYS) {
    return { tone: 'amber', label: 'Renovação próxima', detail: `Reconecte a Página em até ${days} dia(s).` };
  }
  return { tone: 'green', label: 'Conectada', detail: `Credencial válida por mais ${days} dias.` };
}
