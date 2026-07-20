// lib/leads/remoteRepository.ts — leitura remota de leads (M1-E, E3).
// SOMENTE leitura: nenhuma RPC, nenhum write, nenhum acesso a store,
// localStorage ou React. Usa o cliente Supabase único do app (anon + sessão
// do usuário) — a RLS (leads_select) é a única autoridade de isolamento;
// nenhum company_id é enviado como filtro.
import { supabase } from '@/lib/supabase/client';
import type { LeadRow } from '@/lib/supabase/types';
import { RemoteLeadsError } from '@/lib/leads/errors';

// Lê os leads ATIVOS visíveis para a sessão atual (archived_at IS NULL é a
// única condição — arquivados terão query própria quando a visualização de
// admin/manager existir, fase E6). Ordenação estável e determinística:
// created_at descendente com id ascendente como desempate — nunca o nome do
// estágio como autoridade.
export async function fetchActiveLeadRows(): Promise<LeadRow[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e mensagem
    // do PostgREST — sem token, sem URL, sem query.
    throw new RemoteLeadsError('remote_leads_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as LeadRow[];
}
