// Rota do sweep de eventos Lead Ads, chamada pelo schedule configurado em vercel.json. SERVER-ONLY.
// Ordem obrigatória: autenticação → flag → sweep. A URL e os parâmetros do caller
// são ignorados: batch, lease e escopo são definidos no servidor. Respostas trazem
// só status e contadores, nunca IDs, PII, token ou erro bruto.
import { isMetaLeadIngestionEnabled } from '@/lib/server/meta-webhook/env';
import { isAuthorizedCronRequest } from '@/lib/server/meta-webhook/cron-auth';
import { sweepMetaLeadgenEvents } from '@/lib/server/meta-webhook/sweep-leadgen-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Next 14 serve do Data Cache os fetch do supabase-js e da Graph mesmo com force-dynamic (comprovado em produção
// em 2026-11-13 no cron kapa-leads-sync). Nenhum fetch desta rota pode vir do cache.
export const fetchCache = 'force-no-store';
// O lote sequencial pode buscar 20 leads (timeout Graph de 8 s por chamada).
// Reserva abaixo do lease de 300 s para que uma interrupção seja recuperável.
export const maxDuration = 240;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return jsonResponse(401, { status: 'unauthorized' });
  }

  if (!isMetaLeadIngestionEnabled()) {
    return jsonResponse(200, { status: 'disabled' });
  }

  try {
    const summary = await sweepMetaLeadgenEvents();
    // Apenas contadores definidos pelo servidor: sem IDs, PII ou credenciais.
    console.log('[meta-leadgen-sweep]', JSON.stringify(summary));
    return jsonResponse(200, { status: 'ok', ...summary });
  } catch {
    return jsonResponse(500, { status: 'error' });
  }
}
