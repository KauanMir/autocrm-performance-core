// lib/visits/remoteRepository.ts — leitura remota de Visits
// (COMMERCIAL-REMOTE-VISITS-B2-A). SOMENTE leitura: nenhuma RPC, nenhum
// write, nenhum acesso a store, localStorage ou React. Usa o cliente
// Supabase único do app (anon + sessão do usuário) — a RLS (visits_select)
// é a única autoridade de isolamento; nenhum company_id/seller_id é
// enviado como filtro. Mesmo padrão exato de
// lib/tasks/remoteTaskRepository.ts/lib/leads/remoteRepository.ts.
//
// Retorna RemoteVisitRow[] — dado CANÔNICO cru: nenhuma adaptação
// acontece aqui. Ver lib/visits/adapter.ts para a conversão em
// RemoteVisitModel, feita fora deste módulo.
//
// Diferente de fetchPendingTaskRows (que filtra status='pending'): esta
// query não filtra por status — a UI de Visitas precisa mostrar
// scheduled/confirmed hoje e, futuramente, completed/canceled em outras
// visões (ex.: histórico) — decidir QUAL subconjunto mostrar é
// responsabilidade da camada de tela (B3+), nunca deste reader base.
import { supabase } from '@/lib/supabase/client';
import type { RemoteVisitRow } from '@/lib/visits/adapter';
import { RemoteVisitsError } from '@/lib/visits/errors';

// Ordenação estável e determinística: scheduled_at ascendente com id
// ascendente como desempate — mesmo padrão de fetchActiveLeadRows/
// fetchPendingTaskRows.
export async function fetchVisibleVisitRows(): Promise<RemoteVisitRow[]> {
  const { data, error } = await supabase
    .from('visits')
    .select('*')
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e
    // mensagem do PostgREST — sem token, sem URL, sem query.
    throw new RemoteVisitsError('remote_visits_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteVisitRow[];
}

// SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC — bridge EXCLUSIVO do
// Super Admin contextual (/company/[id]): chama list_platform_visits_for_
// company (SECURITY DEFINER, company explícita + can_access_company),
// nunca o SELECT direto acima. Manager/Seller continuam 100% em
// fetchVisibleVisitRows/RLS — esta função nunca é chamada para eles.
// Mesmo shape de row (RemoteVisitRow), sem filtro de status (paridade
// exata com fetchVisibleVisitRows — a tela decide qual subconjunto
// mostrar).
export async function fetchPlatformVisitRows(companyId: string): Promise<RemoteVisitRow[]> {
  const { data, error } = await supabase.rpc('list_platform_visits_for_company', {
    p_company_id: companyId,
  });

  if (error) {
    throw new RemoteVisitsError('remote_visits_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteVisitRow[];
}
