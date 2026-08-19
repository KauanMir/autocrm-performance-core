// lib/tasks/remoteTaskSnapshot.ts — espelho remoto somente-leitura de Tasks
// (COMMERCIAL-REMOTE-B1-B2-A).
//
// CORREÇÃO ARQUITETURAL OBRIGATÓRIA (B1-B2-A-EXEC §0): este snapshot guarda
// ROWS BRUTAS (RemoteTaskRow[]), NUNCA o RemoteTaskModel[] já adaptado.
//
// Motivo: diferente do snapshot de Leads (lib/leads/remoteSnapshot.ts, que
// guarda LeadModel[] já adaptado), a adaptação de uma Task depende de DUAS
// fontes externas voláteis que mudam independentemente da própria Task row
// — o catálogo de Leads (nome exibido) e o catálogo de Sellers (nome
// exibido) — além do instante `now` usado para derivar LATE/TODAY/UPCOMING.
// Se este snapshot guardasse RemoteTaskModel[] pré-adaptado, um Lead sendo
// renomeado, um Seller mudando de nome, ou simplesmente o relógio virando
// o dia NUNCA atualizaria a UI sem uma query de Tasks nova — mesmo que
// nenhuma Task tenha de fato mudado. Isso seria arquitetura incorreta.
//
// Com rows brutas, o leitor futuro (TaskService/useRemoteTasksScreenState,
// B1-B2-B) reconstrói o RemoteTaskModel[] a cada leitura chamando
// adaptRemoteTaskRows(snapshot.rows, contextoAtual) — uma operação pura,
// em memória, sem rede e sem N+1 (as mesmas rows já estão aqui; só o
// contexto de Lead/Seller e o `now` mudam entre leituras). Um refetch de
// Tasks só é necessário quando as ROWS de fato mudam (criação/edição/
// conclusão) — nunca só porque um nome de Lead/Seller ficou disponível ou
// o dia virou.
//
// ISOLAMENTO POR IDENTIDADE: mesmo contrato de remoteSnapshot.ts — a RLS
// entrega conjuntos DIFERENTES por usuário (Manager vê tudo da empresa,
// cada Seller vê só as próprias); o snapshot é vinculado a (companyId,
// identityKey), nunca servido para outro par.
import { RemoteTasksError } from '@/lib/tasks/errors';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';

export interface RemoteTaskSnapshotOwner {
  companyId: string;
  // Id do usuário autenticado dono do snapshot — mesmo contrato de
  // RemoteLeadSnapshotOwner (nunca email, role, token ou objeto User
  // completo).
  identityKey: string;
}

export interface RemoteTaskSnapshot {
  // Discriminante anti-mistura: consumidores podem afirmar a origem.
  source: 'remote';
  companyId: string;
  identityKey: string;
  // ROWS BRUTAS — ver cabeçalho do arquivo. Adaptação é responsabilidade
  // do leitor (B1-B2-B), nunca deste módulo.
  rows: readonly RemoteTaskRow[];
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// ── Construção (pura) ────────────────────────────────────────────────────
// Cópia defensiva do array recebido (§19: caller não pode contaminar o
// snapshot mutando o array original depois de construí-lo).

export function buildRemoteTaskSnapshot(
  rows: readonly RemoteTaskRow[],
  owner: RemoteTaskSnapshotOwner,
): RemoteTaskSnapshot {
  if (!isNonEmpty(owner?.companyId) || !isNonEmpty(owner?.identityKey)) {
    throw new RemoteTasksError('remote_tasks_invalid_context', {
      operation: 'buildRemoteTaskSnapshot',
    });
  }

  return {
    source: 'remote',
    companyId: owner.companyId,
    identityKey: owner.identityKey,
    rows: [...rows],
  };
}

// ── Espelho volátil ───────────────────────────────────────────────────────
// Um único slot: o app tem uma identidade ativa por sessão (mesmo desenho
// de remoteSnapshot.ts). Isolamento acontece na LEITURA e na LIMPEZA —
// ambas exigem o par (companyId, identityKey) exato; qualquer mismatch
// devolve null/false, nunca o snapshot antigo.

let _snapshot: RemoteTaskSnapshot | null = null;

export function setRemoteTaskSnapshot(snapshot: RemoteTaskSnapshot): void {
  _snapshot = snapshot;
}

export function getRemoteTaskSnapshot(
  companyId: string | null | undefined,
  identityKey: string | null | undefined,
): RemoteTaskSnapshot | null {
  if (!isNonEmpty(companyId) || !isNonEmpty(identityKey) || !_snapshot) return null;
  return _snapshot.companyId === companyId && _snapshot.identityKey === identityKey
    ? _snapshot
    : null;
}

// Limpa SOMENTE o snapshot pertencente ao par informado; snapshot de outro
// dono permanece intacto. Retorna se algo foi de fato removido (o bridge,
// B1-B2-B, usa isso para notificar apenas transições reais).
export function clearRemoteTaskSnapshot(companyId: string, identityKey: string): boolean {
  if (!_snapshot) return false;
  if (_snapshot.companyId !== companyId || _snapshot.identityKey !== identityKey) return false;
  _snapshot = null;
  return true;
}

// Limpeza incondicional — mudanças globais de identidade (logout) e testes.
export function clearAllRemoteTaskSnapshots(): void {
  _snapshot = null;
}
