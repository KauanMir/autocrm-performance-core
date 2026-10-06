// lib/server/meta-webhook/ingestion.ts — decisão de ingestão de UM change
// leadgen. SERVER-ONLY. Só registra o evento no ledger durável
// (meta_leadgen_events). NÃO busca lead na Graph, NÃO decifra token, NÃO cria
// lead CRM. Quem chama decide o HTTP: infra_failure => 503; demais => 200.
import { META_TEST_COMPANY_ID, META_TEST_PAGE_ID } from '@/lib/server/meta-oauth/config';
import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';
import { registerLeadgenEvent } from './leadgen-events-rpc';
import type { LeadgenChangeMeta } from './events';

export type LeadgenIngestionResult =
  | 'skipped_unusable'
  | 'skipped_no_connection'
  | 'skipped_other_company'
  | 'registered'
  | 'already_exists'
  | 'infra_failure';

export interface OwnerRow {
  integration_id: string;
  company_id: string;
  page_id: string;
  status: string;
}

export interface LeadgenIngestionDeps {
  ownerByPage: (pageId: string) => Promise<{ data: OwnerRow[] | null; error: { code?: string } | null }>;
  register: typeof registerLeadgenEvent;
}

const defaultDeps = (): LeadgenIngestionDeps => ({
  ownerByPage: (pageId) => createMetaConnectionRpcPort().ownerByPage(pageId),
  register: registerLeadgenEvent,
});

export interface LeadgenIngestionOptions {
  // Chamado somente depois do registro durável (created ou already_exists).
  onRegistered?: (eventId: string) => void;
}

export async function ingestLeadgenChange(
  change: LeadgenChangeMeta,
  deps: LeadgenIngestionDeps = defaultDeps(),
  options: LeadgenIngestionOptions = {},
): Promise<LeadgenIngestionResult> {
  const pageId = change.pageId;
  const leadgenId = change.leadgenId;
  if (!pageId || !leadgenId) return 'skipped_unusable';

  // Gate sem banco: qualquer Page que não seja a de teste nunca encosta no banco.
  if (pageId !== META_TEST_PAGE_ID) return 'skipped_other_company';

  let owner: Awaited<ReturnType<LeadgenIngestionDeps['ownerByPage']>>;
  try {
    owner = await deps.ownerByPage(pageId);
  } catch {
    return 'infra_failure';
  }
  if (owner.error) return 'infra_failure';

  const row = owner.data?.[0];
  if (!row) return 'skipped_no_connection';
  if (row.status !== 'connected' || row.company_id !== META_TEST_COMPANY_ID) {
    return 'skipped_other_company';
  }

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
