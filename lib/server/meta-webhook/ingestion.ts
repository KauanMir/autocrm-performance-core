// lib/server/meta-webhook/ingestion.ts — decisão de ingestão de UM change
// leadgen. SERVER-ONLY. Só registra o evento no ledger durável
// (meta_leadgen_events). NÃO busca lead na Graph, NÃO decifra token, NÃO cria
// lead CRM. Quem chama decide o HTTP: infra_failure => 503; demais => 200.
//
// META-MVP2 — multiempresa. A empresa é decidida EXCLUSIVAMENTE pela conexão
// da Page no banco (nunca pelo payload): no máximo uma conexão `connected` por
// Page (índice único). Sem conexão connected, uma única conexão `error` também
// recebe o evento (o lead espera a reconexão). A empresa precisa estar
// autorizada para Lead Ads (desligada por padrão; só o Super Admin liga).
//
// Nenhum evento com assinatura válida é descartado em silêncio: sem conexão
// utilizável, com a empresa desligada ou com posse ambígua, ele fica RETIDO sem
// empresa (meta_leadgen_unrouted_events) e a liberação é decisão do Super Admin.
// Se a retenção falhar, a resposta é infra_failure (503) e a Meta reentrega.
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { registerLeadgenEvent } from './leadgen-events-rpc';
import { recordUnroutedLeadgenEvent, type UnroutedReason } from './leadgen-unrouted-rpc';
import type { LeadgenChangeMeta } from './events';

export type LeadgenIngestionResult =
  | 'skipped_unusable'
  | 'skipped_no_connection'
  | 'skipped_company_disabled'
  | 'skipped_ambiguous_owner'
  | 'registered'
  | 'already_exists'
  | 'infra_failure';

export interface OwnerRow {
  integration_id: string;
  company_id: string;
  page_id: string;
  status: string;
  lead_ads_enabled?: boolean | null;
}

export interface LeadgenIngestionDeps {
  ownerByPage: (pageId: string) => Promise<{ data: OwnerRow[] | null; error: { code?: string } | null }>;
  register: typeof registerLeadgenEvent;
  recordUnrouted: typeof recordUnroutedLeadgenEvent;
}

const defaultDeps = (): LeadgenIngestionDeps => ({
  ownerByPage: (pageId) => createMetaConnectionRpcPort().ownerForIngestion(pageId),
  register: registerLeadgenEvent,
  recordUnrouted: recordUnroutedLeadgenEvent,
});

export interface LeadgenIngestionOptions {
  // Chamado somente depois do registro durável (created ou already_exists).
  onRegistered?: (eventId: string) => void;
}

// Escolhe a conexão dona da Page. connected tem precedência; sem connected,
// só uma conexão error é aceita. Linhas de outra Page são ignoradas por defesa.
export function resolveIngestionOwner(pageId: string, rows: readonly OwnerRow[]): OwnerRow | 'none' | 'ambiguous' {
  const own = rows.filter((row) => row.page_id === pageId);
  const connected = own.filter((row) => row.status === 'connected');
  if (connected.length > 1) return 'ambiguous';
  if (connected.length === 1) return connected[0];
  const errored = own.filter((row) => row.status === 'error');
  if (errored.length > 1) return 'ambiguous';
  if (errored.length === 1) return errored[0];
  return 'none';
}

export async function ingestLeadgenChange(
  change: LeadgenChangeMeta,
  deps: LeadgenIngestionDeps = defaultDeps(),
  options: LeadgenIngestionOptions = {},
): Promise<LeadgenIngestionResult> {
  const pageId = change.pageId;
  const leadgenId = change.leadgenId;
  if (!pageId || !leadgenId) return 'skipped_unusable';

  let owner: Awaited<ReturnType<LeadgenIngestionDeps['ownerByPage']>>;
  try {
    owner = await deps.ownerByPage(pageId);
  } catch {
    return 'infra_failure';
  }
  if (owner.error) return 'infra_failure';

  const hold = async (reason: UnroutedReason, result: LeadgenIngestionResult): Promise<LeadgenIngestionResult> => {
    const held = await deps.recordUnrouted({ pageId, leadgenId, formId: change.formId ?? null, reason, receivedAt: new Date() });
    return held.ok ? result : 'infra_failure';
  };

  const row = resolveIngestionOwner(pageId, owner.data ?? []);
  if (row === 'none') return hold('no_connection', 'skipped_no_connection');
  if (row === 'ambiguous') return hold('ambiguous_owner', 'skipped_ambiguous_owner');
  if (row.lead_ads_enabled !== true) return hold('company_disabled', 'skipped_company_disabled');

  const registered = await deps.register({
    integrationId: row.integration_id,
    companyId: row.company_id,
    pageId,
    leadgenId,
    formId: change.formId ?? null,
    receivedAt: new Date(),
  });
  if (!registered.ok) return 'infra_failure';
  options.onRegistered?.(registered.value.eventId);
  return registered.value.created ? 'registered' : 'already_exists';
}
