// lib/leads/localCommercialAccess.ts — isolamento fail-closed dos módulos
// comerciais locais (Visit/Deal/Sale/Task), M1-E E5-B2-A1.
//
// Achado da auditoria E5-B2-A0: Visit/Deal/Sale/Task (lib/data.ts) não têm
// `company_id` e são persistidos em chaves de localStorage GLOBAIS, sem
// nenhum namespace por empresa/usuário (lib/store.ts) — diferente de Lead,
// que já migrou para Supabase com RLS por empresa. Enquanto REMOTE_LEADS não
// estiver em modo 'local', esses quatro domínios não têm nenhum backend
// remoto equivalente (confirmado por auditoria linha a linha do catálogo de
// RPCs) — mantê-los graváveis nesse cenário arriscaria registros órfãos
// (referenciando um Lead que só existe no Supabase) e, em tese, mistura de
// dados entre empresas no mesmo navegador.
//
// Função pura: sem React, sem identidade de empresa/usuário, sem
// StoreAdapter. Usa EXCLUSIVAMENTE o resolver central de flags
// (resolveRemoteLeadsFlagMode) — nunca lê process.env diretamente, nunca
// depende de empresa selecionada/primeiro Lead/primeiro usuário. Só
// mode === 'local' permite acesso; remote_ready E remote_misconfigured
// bloqueiam igualmente (falha fechada também quando a configuração remota
// está incoerente).
import { resolveRemoteLeadsFlagMode } from '@/lib/leads/remoteLeadsMode';

export function isLocalCommercialDataAllowed(): boolean {
  return resolveRemoteLeadsFlagMode() === 'local';
}

// Erro estável da camada de serviços — nunca carrega stack/payload/dado de
// negócio; a mensagem é sempre o próprio código (mesmo padrão de
// RemoteLeadsError). A UI converte para uma mensagem sanitizada própria,
// nunca exibindo este código bruto ao usuário.
export class LocalCommercialDataDisabledError extends Error {
  readonly code = 'remote_commercial_local_data_disabled' as const;
  readonly operation: string;

  constructor(operation: string) {
    super('remote_commercial_local_data_disabled');
    this.name = 'LocalCommercialDataDisabledError';
    this.operation = operation;
  }
}

export function isLocalCommercialDataDisabledError(
  error: unknown,
): error is LocalCommercialDataDisabledError {
  return error instanceof LocalCommercialDataDisabledError;
}

// Barreira 2 (camada de serviços) — chamada SEMPRE antes de qualquer acesso
// ao StoreAdapter, nunca depois. Mesmo que a Barreira 1 (UI) seja burlada
// (chamada direta/programática), nenhuma leitura ou escrita de Visit/Deal/
// Sale/Task chega ao StoreAdapter fora do modo local.
export function assertLocalCommercialDataAllowed(operation: string): void {
  if (!isLocalCommercialDataAllowed()) {
    throw new LocalCommercialDataDisabledError(operation);
  }
}
