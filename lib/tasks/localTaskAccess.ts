// lib/tasks/localTaskAccess.ts — isolamento fail-closed do domínio local de
// Tasks (COMMERCIAL-REMOTE-B1-B1). Espelha lib/leads/localCommercialAccess.ts
// (mesmo formato de gate), mas com o resolver PRÓPRIO de Tasks
// (resolveTaskRemoteMode) — nunca resolveRemoteLeadsFlagMode diretamente.
//
// Só 'task_local' permite acesso; 'task_blocked', 'task_remote_ready' e
// 'task_remote_misconfigured' bloqueiam igualmente — falha fechada também
// no caso "rollout parcial" (task_blocked): Tasks não tem backend remoto
// ativo ainda nesse estado, mas também não pode voltar a escrever em
// localStorage ao lado de Leads já remoto (regra central do B1-B1-EXEC §0).
//
// Função pura: sem React, sem identidade de empresa/usuário, sem
// StoreAdapter.
//
// NÃO CONECTADO a TaskService nesta subetapa (B1-B1) de propósito — ligar
// este gate agora, sem o restante da infraestrutura remota (adapter/
// snapshot/bridge/hooks, B1-B2/B1-B3), faria TaskService.getAll/create/
// update lançarem em qualquer superfície que hoje depende dele (ex.:
// ScreenPendencias, FlowNovaPendencia) assim que REMOTE_LEADS chegasse a
// remote_ready — comportamento incompleto em runtime antes da infra que o
// sustenta existir. TaskService continua usando exclusivamente
// lib/leads/localCommercialAccess.ts (intocado) até B1-B2/B1-B3.
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';

export function isLocalTaskDataAllowed(): boolean {
  return resolveTaskRemoteMode() === 'task_local';
}

// Erro estável da camada de serviços — nunca carrega stack/payload/dado de
// negócio; a mensagem é sempre o próprio código (mesmo padrão de
// LocalCommercialDataDisabledError/RemoteLeadsError). A UI converte para
// uma mensagem sanitizada própria, nunca exibindo este código bruto ao
// usuário.
export class LocalTaskDataDisabledError extends Error {
  readonly code = 'remote_task_local_data_disabled' as const;
  readonly operation: string;

  constructor(operation: string) {
    super('remote_task_local_data_disabled');
    this.name = 'LocalTaskDataDisabledError';
    this.operation = operation;
  }
}

export function isLocalTaskDataDisabledError(
  error: unknown,
): error is LocalTaskDataDisabledError {
  return error instanceof LocalTaskDataDisabledError;
}

// Barreira de camada de serviços — chamada SEMPRE antes de qualquer acesso
// ao StoreAdapter para Task, nunca depois (mesmo contrato de
// assertLocalCommercialDataAllowed). Reservada para quando TaskService for
// migrado para este gate (B1-B2/B1-B3) — não é chamada por nenhum call
// site ainda nesta subetapa.
export function assertLocalTaskDataAllowed(operation: string): void {
  if (!isLocalTaskDataAllowed()) {
    throw new LocalTaskDataDisabledError(operation);
  }
}
