// lib/deals/remoteRepository.ts — leitura remota de Deals
// (COMMERCIAL-REMOTE-DEALS-B2-A). SOMENTE leitura: nenhuma RPC, nenhum
// write, nenhum acesso a store, localStorage ou React. Usa o cliente
// Supabase único do app (anon + sessão do usuário) — a RLS (deals_select) é
// a única autoridade de isolamento; nenhum company_id/seller_id é enviado
// como filtro. Mesmo padrão exato de lib/visits/remoteRepository.ts/
// lib/tasks/remoteTaskRepository.ts.
//
// Retorna RemoteDealRow[] — dado CANÔNICO cru: nenhuma adaptação acontece
// aqui. Ver lib/deals/adapter.ts para a conversão em RemoteDealModel, feita
// fora deste módulo.
//
// Migration #53 (public.deals) ainda NÃO existe no banco remoto — este
// módulo só é exercitado quando resolveDealRemoteMode() === 'deal_remote_ready'
// (feature flag NEXT_PUBLIC_FF_REMOTE_DEALS, default OFF), nunca chamado
// incondicionalmente.
import { supabase } from '@/lib/supabase/client';
import type { RemoteDealRow } from '@/lib/deals/adapter';
import { RemoteDealsError } from '@/lib/deals/errors';

// Ordenação estável e determinística: created_at descendente (mais
// recentes primeiro) com id ascendente como desempate — mesmo padrão de
// fetchVisibleVisitRows/fetchPendingTaskRows, consistente com os índices
// já criados na migration #53 (deals_company_status_created_idx).
export async function fetchVisibleDealRows(): Promise<RemoteDealRow[]> {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e
    // mensagem do PostgREST — sem token, sem URL, sem query.
    throw new RemoteDealsError('remote_deals_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteDealRow[];
}
