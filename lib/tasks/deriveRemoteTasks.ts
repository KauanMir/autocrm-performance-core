// lib/tasks/deriveRemoteTasks.ts — derivação de view-model de Tasks remotas
// (COMMERCIAL-REMOTE-B1-B2-B3-A). Wrapper puro e fino sobre
// adaptRemoteTaskRows (lib/tasks/taskAdapter.ts) — não duplica nenhuma
// lógica de adaptação, só nomeia o ponto de entrada compartilhado pelos
// dois consumidores futuros (B1-B2-B3-B/B1-B3):
//   - caminho React: useTasks().rows (query React Query, nunca o snapshot);
//   - caminho síncrono/legado: RemoteTaskSnapshot.rows (TaskService).
//
// Recebe ROWS explicitamente, nunca um RemoteTaskSnapshot — é isso que
// permite os dois caminhos acima compartilharem esta função sem que
// nenhum dos dois precise conhecer a fonte do outro. Decidir se "ausência
// de dado" significa snapshot indisponível (caminho síncrono) ou query
// ainda carregando (caminho React) é responsabilidade de CADA chamador,
// nunca desta função — ela só sabe adaptar as rows que recebeu.
//
// Puro: sem rede, sem localStorage, sem React, sem Supabase, sem
// TaskService, sem catálogo de Sellers (o adapter já não depende disso
// desde B1-B2-B2-A1).
import type {
  AdaptTaskRowsResult,
  RemoteTaskRow,
  TaskLeadRef,
} from '@/lib/tasks/taskAdapter';
import { adaptRemoteTaskRows } from '@/lib/tasks/taskAdapter';

export function deriveRemoteTasks(
  rows: readonly RemoteTaskRow[],
  leadsById: Readonly<Record<string, TaskLeadRef>>,
  now: Date = new Date(),
): AdaptTaskRowsResult {
  return adaptRemoteTaskRows(rows, { leadsById }, now);
}
