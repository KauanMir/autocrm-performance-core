// lib/server/invites/delivery.ts — finalização robusta da entrega de
// convites (M1-F S4-A2B, design §18). Depois que a API do Supabase Auth
// aceitou ou recusou o envio, a RPC de finalização correspondente é
// chamada com o resultado. Nunca chama a função de finalização diferente
// da proveniência do convite (create → complete_invite_delivery, resend →
// complete_invite_resend_delivery) — cada uma tem seu próprio wrapper
// aqui, nunca compartilham a mesma chamada de RPC.
//
// Tratamento de perda de resposta: uma tentativa, um retry se o transporte
// falhar; se ainda assim não confirmar sucesso, consulta a linha
// diretamente (service_role) — se delivery_status já não for 'not_sent',
// considera finalizada (a primeira tentativa aplicou, só a resposta se
// perdeu); senão, reporta finalize_failed. Nunca altera a linha via UPDATE
// direto, nunca chama outra RPC diferente da esperada.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { DeliveryErrorCode } from '@/lib/server/invites/auth-email';

export type FinalizeOutcome = 'finalized' | 'finalize_failed';

type RpcResult = { data: { success: boolean; code: string }[] | null; error: { message: string } | null };

async function finalizeWithRetry(
  admin: SupabaseClient<Database>,
  inviteId: string,
  callRpc: () => PromiseLike<RpcResult>,
): Promise<FinalizeOutcome> {
  let result = await callRpc();

  if (result.error) {
    result = await callRpc();
  }

  if (!result.error && result.data?.[0]?.success) {
    return 'finalized';
  }

  const { data: rows, error: rowError } = await admin
    .from('invites')
    .select('delivery_status')
    .eq('id', inviteId)
    .limit(1);

  if (!rowError && rows?.[0] && rows[0].delivery_status !== 'not_sent') {
    return 'finalized';
  }

  return 'finalize_failed';
}

export interface FinalizeCreateDeliveryArgs {
  admin: SupabaseClient<Database>;
  actorProfileId: string;
  inviteId: string;
  success: boolean;
  errorCode?: DeliveryErrorCode;
}

export async function finalizeCreateDelivery(args: FinalizeCreateDeliveryArgs): Promise<FinalizeOutcome> {
  const { admin, actorProfileId, inviteId, success, errorCode } = args;

  return finalizeWithRetry(admin, inviteId, () =>
    admin.rpc('complete_invite_delivery', {
      p_actor_profile_id: actorProfileId,
      p_invite_id: inviteId,
      p_success: success,
      ...(errorCode !== undefined ? { p_error_code: errorCode } : {}),
    }),
  );
}

export interface FinalizeResendDeliveryArgs {
  admin: SupabaseClient<Database>;
  actorProfileId: string;
  inviteId: string;
  previousInviteId: string;
  success: boolean;
  errorCode?: DeliveryErrorCode;
}

export async function finalizeResendDelivery(args: FinalizeResendDeliveryArgs): Promise<FinalizeOutcome> {
  const { admin, actorProfileId, inviteId, previousInviteId, success, errorCode } = args;

  return finalizeWithRetry(admin, inviteId, () =>
    admin.rpc('complete_invite_resend_delivery', {
      p_actor_profile_id: actorProfileId,
      p_invite_id: inviteId,
      p_previous_invite_id: previousInviteId,
      p_success: success,
      ...(errorCode !== undefined ? { p_error_code: errorCode } : {}),
    }),
  );
}
