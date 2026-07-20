// lib/leads/remoteSnapshot.ts — espelho remoto somente-leitura (M1-E, E3).
// Autorizado explicitamente pelo design §10: memória volátil, escrito SOMENTE
// pelo bridge, nunca persistido, derivado 1:1 do cache do TanStack (que
// deriva do banco). Apagá-lo apenas força os consumidores síncronos legados
// ao estado "indisponível" — nenhuma informação existe só aqui.
//
// ISOLAMENTO POR IDENTIDADE: a RLS entrega conjuntos DIFERENTES para usuários
// da mesma empresa (admin/manager veem tudo; cada seller vê só os próprios).
// Por isso o snapshot é vinculado a (companyId, identityKey) — identityKey é
// o id do usuário autenticado (profiles.id = auth.users.id, o mesmo contrato
// de identidade do AuthService). Snapshot de outra empresa OU de outro
// usuário da mesma empresa NUNCA é servido; mismatch é tratado pelo chamador
// como remote_leads_snapshot_unavailable, jamais como fallback.
//
// A UI jamais escreve neste módulo; erro remoto limpa o espelho da identidade
// (via bridge) — dados locais jamais entram aqui.
import {
  adaptLeadRows,
  type LeadAdapterContext,
  type LeadModel,
} from '@/lib/leads/adapter';
import { RemoteLeadsError } from '@/lib/leads/errors';
import type { LeadRow } from '@/lib/supabase/types';

export interface RemoteLeadSnapshotOwner {
  companyId: string;
  // Id do usuário autenticado dono do snapshot. Nunca email, nunca role,
  // nunca token ou objeto User completo.
  identityKey: string;
}

export interface RemoteLeadSnapshot {
  // Discriminante anti-mistura: consumidores podem afirmar a origem.
  source: 'remote';
  companyId: string;
  identityKey: string;
  leads: readonly LeadModel[];
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// ── Construção (pura) ────────────────────────────────────────────────────

export function buildRemoteLeadSnapshot(
  rows: readonly LeadRow[],
  context: LeadAdapterContext,
  owner: RemoteLeadSnapshotOwner,
): RemoteLeadSnapshot {
  if (!isNonEmpty(owner?.companyId) || !isNonEmpty(owner?.identityKey)) {
    throw new RemoteLeadsError('remote_leads_invalid_context', {
      operation: 'buildRemoteLeadSnapshot',
    });
  }

  const adapted = adaptLeadRows(rows, context);
  if (adapted.ok === false) {
    // Stage/seller órfão NUNCA é ocultado nem pulado — vira o código público
    // aprovado, com o LeadAdapterError completo como causa técnica.
    throw new RemoteLeadsError('remote_leads_invalid_context', {
      adapterError: adapted,
      operation: 'buildRemoteLeadSnapshot',
    });
  }

  return {
    source: 'remote',
    companyId: owner.companyId,
    identityKey: owner.identityKey,
    leads: adapted.leads,
  };
}

// ── Espelho volátil (design §10) ─────────────────────────────────────────
// Um único slot: o app tem uma identidade ativa por sessão. O isolamento
// acontece na LEITURA e na LIMPEZA — ambas exigem o par (companyId,
// identityKey) exato; qualquer mismatch devolve null/false, nunca o snapshot
// antigo.

let _snapshot: RemoteLeadSnapshot | null = null;

export function setRemoteLeadSnapshot(snapshot: RemoteLeadSnapshot): void {
  _snapshot = snapshot;
}

export function getRemoteLeadSnapshot(
  companyId: string | null | undefined,
  identityKey: string | null | undefined,
): RemoteLeadSnapshot | null {
  if (!isNonEmpty(companyId) || !isNonEmpty(identityKey) || !_snapshot) return null;
  return _snapshot.companyId === companyId && _snapshot.identityKey === identityKey
    ? _snapshot
    : null;
}

// Limpa SOMENTE o snapshot pertencente ao par informado; snapshot de outro
// dono permanece intacto. Retorna se algo foi de fato removido (o bridge usa
// isso para notificar apenas transições reais).
export function clearRemoteLeadSnapshot(companyId: string, identityKey: string): boolean {
  if (!_snapshot) return false;
  if (_snapshot.companyId !== companyId || _snapshot.identityKey !== identityKey) return false;
  _snapshot = null;
  return true;
}

// Limpeza incondicional — mudanças globais de identidade (logout) e testes.
export function clearAllRemoteLeadSnapshots(): void {
  _snapshot = null;
}
