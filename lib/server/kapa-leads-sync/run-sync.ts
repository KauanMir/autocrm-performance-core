// lib/server/kapa-leads-sync/run-sync.ts — um ciclo da sincronização. SERVER-ONLY.
//
//  1. Para cada vínculo ligado: busca páginas no KAPA Leads a partir do cursor e grava cada
//     página na fila do CRM, avançando o cursor no MESMO comando (kapa_leads_ingest_page, com
//     compare-and-set). Falha de rede/assinatura/servidor: registra o código no vínculo e para;
//     o cursor não anda e o próximo ciclo repete a mesma página (idempotente).
//  2. Processa a fila no banco (kapa_leads_process_pending): cria/associa os leads.
//  3. Retenção (kapa_leads_purge_expired).
//
// Nunca escreve no KAPA Leads. Resumo só com contadores (sem IDs, PII ou segredo).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KapaLeadsSyncConfig } from './env';
import { fetchLeadsCount, fetchLeadsPage, PAGE_LIMIT, type Cursor } from './client';
import { toPageIngestItem } from './normalize';

export const MAX_PAGES_PER_LINK = 5;
export const PROCESS_BATCH = 25;
export const MAX_PROCESS_ROUNDS = 4;
/** Conferência por contagem no máximo a cada hora, numa janela de até 30 dias. */
export const RECONCILE_EVERY_MS = 60 * 60_000;
export const RECONCILE_WINDOW_MS = 30 * 86_400_000;

export type SyncSummary = {
  links: number;
  pages: number;
  received: number;
  duplicates: number;
  invalid: number;
  sourceErrors: number;
  cursorConflicts: number;
  created: number;
  linked: number;
  retry: number;
  failed: number;
  held: number;
  purged: number;
  processBusy: boolean;
  reconciled: number;
  reconcileMismatches: number;
};

type LinkRow = {
  link_id: string;
  company_id: string;
  kapa_store_id: string;
  vehicle_form_key: string | null;
  cursor_created_at: string | null;
  cursor_lead_id: string | null;
  activated_at: string | null;
  reconciled_at: string | null;
};

// O cliente é tipado pelo chamador; aqui só RPCs (sem acesso direto a tabelas).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = SupabaseClient<any, any, any>;

const first = <T>(data: unknown): T | null => (Array.isArray(data) && data.length > 0 ? (data[0] as T) : null);

export async function runKapaLeadsSync(input: {
  supabase: Rpc;
  config: KapaLeadsSyncConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): Promise<SyncSummary> {
  const { supabase, config, fetchImpl = fetch, now = Date.now } = input;
  const summary: SyncSummary = {
    links: 0, pages: 0, received: 0, duplicates: 0, invalid: 0, sourceErrors: 0, cursorConflicts: 0,
    created: 0, linked: 0, retry: 0, failed: 0, held: 0, purged: 0, processBusy: false, reconciled: 0, reconcileMismatches: 0,
  };

  const { data: links, error: linksError } = await supabase.rpc('kapa_leads_links_for_poll');
  if (linksError) throw new Error('links_for_poll_failed');

  for (const link of (links ?? []) as LinkRow[]) {
    summary.links += 1;
    if (!link.cursor_created_at || !link.cursor_lead_id) continue; // ligado sempre tem cursor (CHECK)
    let cursor: Cursor = { createdAt: link.cursor_created_at, id: link.cursor_lead_id };
    let healthy = false;

    for (let page = 0; page < MAX_PAGES_PER_LINK; page += 1) {
      const result = await fetchLeadsPage({ config, storeId: link.kapa_store_id, cursor, limit: PAGE_LIMIT, fetchImpl, nowMs: now() });
      if ('code' in result) {
        summary.sourceErrors += 1;
        await supabase.rpc('kapa_leads_link_record_failure', { p_link_id: link.link_id, p_error_code: result.code });
        break;
      }

      const items = result.items.map((item) => toPageIngestItem(item, link.vehicle_form_key));
      const { data, error } = await supabase.rpc('kapa_leads_ingest_page', {
        p_link_id: link.link_id,
        p_expected_cursor_created_at: cursor.createdAt,
        p_expected_cursor_lead_id: cursor.id,
        p_items: items,
        p_next_cursor_created_at: result.nextCursor?.createdAt ?? null,
        p_next_cursor_lead_id: result.nextCursor?.id ?? null,
      });
      if (error) {
        summary.sourceErrors += 1;
        const code = /^[a-z_]{1,40}$/.test(error.message ?? '') ? `ingest_${error.message}` : 'ingest_failed';
        await supabase.rpc('kapa_leads_link_record_failure', { p_link_id: link.link_id, p_error_code: code.slice(0, 64) });
        break;
      }
      const outcome = first<{ out_outcome: string; out_inserted: number; out_duplicates: number; out_invalid: number }>(data);
      if (!outcome || outcome.out_outcome !== 'ok') {
        if (outcome?.out_outcome === 'cursor_conflict') summary.cursorConflicts += 1;
        break;
      }
      summary.pages += 1;
      healthy = true;
      summary.received += outcome.out_inserted;
      summary.duplicates += outcome.out_duplicates;
      summary.invalid += outcome.out_invalid;
      if (result.nextCursor) cursor = result.nextCursor;
      if (!result.nextCursor || !result.hasMore) break;
    }

    // Conferência: leads do KAPA Leads × recebidos na fila, até o cursor (só com a consulta saudável).
    const due = !link.reconciled_at || now() - Date.parse(link.reconciled_at) >= RECONCILE_EVERY_MS;
    if (healthy && due && link.activated_at) {
      const toMs = Date.parse(cursor.createdAt);
      const fromMs = Math.max(Date.parse(link.activated_at), toMs - RECONCILE_WINDOW_MS);
      if (Number.isFinite(toMs) && Number.isFinite(fromMs) && toMs > fromMs) {
        const from = fromMs === Date.parse(link.activated_at) ? link.activated_at : new Date(fromMs).toISOString();
        const counted = await fetchLeadsCount({ config, storeId: link.kapa_store_id, from, to: cursor.createdAt, fetchImpl, nowMs: now() });
        if ('count' in counted) {
          const { data: rec } = await supabase.rpc('kapa_leads_record_reconciliation', {
            p_link_id: link.link_id, p_from: from, p_to: cursor.createdAt, p_source_count: counted.count,
          });
          const row = first<{ out_source_count: number; out_crm_count: number }>(rec);
          if (row) {
            summary.reconciled += 1;
            if (row.out_source_count > row.out_crm_count) summary.reconcileMismatches += 1;
          }
        }
      }
    }
  }

  for (let round = 0; round < MAX_PROCESS_ROUNDS; round += 1) {
    const { data, error } = await supabase.rpc('kapa_leads_process_pending', { p_limit: PROCESS_BATCH });
    if (error) throw new Error('process_pending_failed');
    const r = first<{ out_status: string; out_created: number; out_linked: number; out_retry: number; out_failed: number; out_held: number }>(data);
    if (!r) break;
    if (r.out_status === 'busy') {
      summary.processBusy = true;
      break;
    }
    summary.created += r.out_created;
    summary.linked += r.out_linked;
    summary.retry += r.out_retry;
    summary.failed += r.out_failed;
    summary.held += r.out_held;
    if (r.out_created + r.out_linked + r.out_retry + r.out_failed + r.out_held < PROCESS_BATCH) break;
  }

  const { data: purged } = await supabase.rpc('kapa_leads_purge_expired');
  summary.purged = typeof purged === 'number' ? purged : 0;
  return summary;
}
