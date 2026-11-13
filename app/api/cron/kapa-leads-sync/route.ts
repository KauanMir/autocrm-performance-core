// Rota do ciclo de sincronização KAPA Leads → CRM, chamada pelo schedule do vercel.json. SERVER-ONLY.
// Ordem: autenticação (CRON_SECRET) → flag/configuração → ciclo. Parâmetros do caller são ignorados.
// Respostas e logs só com status e contadores: nunca IDs, PII, URL com cursor ou segredo.
import { isAuthorizedCronRequest } from '@/lib/server/meta-webhook/cron-auth';
import { createAdminClient } from '@/lib/server/supabase/admin';
import { readKapaLeadsSyncConfig } from '@/lib/server/kapa-leads-sync/env';
import { runKapaLeadsSync } from '@/lib/server/kapa-leads-sync/run-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Next 14 guarda no Data Cache os fetch do supabase-js mesmo com force-dynamic: em produção as RPCs
// (links_for_poll, process_pending, purge_expired) voltavam "Using cache" com a resposta de antes da
// ativação (2026-11-13, vínculo ligado e ciclos com links:0). Nenhum fetch desta rota pode vir do cache.
export const fetchCache = 'force-no-store';
// 5 páginas × timeout de 10 s por vínculo, com folga.
export const maxDuration = 120;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return jsonResponse(401, { status: 'unauthorized' });
  }

  const config = readKapaLeadsSyncConfig();
  if ('reason' in config) {
    if (config.reason !== 'disabled') console.warn('[kapa-leads-sync]', JSON.stringify({ status: 'misconfigured', reason: config.reason }));
    return jsonResponse(200, { status: config.reason === 'disabled' ? 'disabled' : 'misconfigured' });
  }

  try {
    const summary = await runKapaLeadsSync({ supabase: createAdminClient(), config: config.config });
    console.log('[kapa-leads-sync]', JSON.stringify(summary));
    return jsonResponse(200, { status: 'ok', ...summary });
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]{1,40}$/.test(error.message) ? error.message : 'unexpected';
    console.error('[kapa-leads-sync]', JSON.stringify({ status: 'error', code }));
    return jsonResponse(500, { status: 'error' });
  }
}
