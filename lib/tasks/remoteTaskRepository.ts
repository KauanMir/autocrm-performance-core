// lib/tasks/remoteTaskRepository.ts — leitura remota de Tasks
// (COMMERCIAL-REMOTE-B1-B2-B1). SOMENTE leitura: nenhuma RPC, nenhum
// write, nenhum acesso a store, localStorage ou React. Usa o cliente
// Supabase único do app (anon + sessão do usuário) — a RLS (tasks_select)
// é a única autoridade de isolamento; nenhum company_id é enviado como
// filtro, nenhum filtro de Seller é aplicado no cliente por "segurança"
// (isso pertenceria à RLS, nunca ao client).
//
// Retorna RemoteTaskRow[] — dado CANÔNICO cru (B1-B2-B precheck §11):
// nenhuma adaptação acontece aqui. Não conhece Lead catalog, Seller
// catalog ou `now`. Ver lib/tasks/taskAdapter.ts para a conversão em
// RemoteTaskModel, feita fora deste módulo.
import { supabase } from '@/lib/supabase/client';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import { RemoteTasksError } from '@/lib/tasks/errors';

// Lê as Tasks PENDENTES visíveis para a sessão atual (status='pending' é a
// única condição — B1-B2 precheck §6/§11: nenhuma tela atual ou planejada
// exibe uma Task concluída, então a query nem a busca). Ordenação estável
// e determinística: due_at ascendente com id ascendente como desempate —
// mesmo padrão de fetchActiveLeadRows (lib/leads/remoteRepository.ts).
export async function fetchPendingTaskRows(): Promise<RemoteTaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('status', 'pending')
    .order('due_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    // Erro NUNCA vira lista vazia. Detail preserva somente código e
    // mensagem do PostgREST — sem token, sem URL, sem query.
    throw new RemoteTasksError('remote_tasks_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []) as unknown as RemoteTaskRow[];
}
