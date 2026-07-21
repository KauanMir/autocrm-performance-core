// tests/server/invites/delivery.test.ts — finalização robusta da entrega
// de convites (M1-F S4-A2B, design §18). admin é um fake injetado
// diretamente — nenhuma rede real.
import { describe, expect, it, vi } from 'vitest';
import { finalizeCreateDelivery, finalizeResendDelivery } from '@/lib/server/invites/delivery';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

interface RpcResponse {
  data: { success: boolean; code: string }[] | null;
  error: { message: string } | null;
}

function fakeAdmin(rpcResponses: RpcResponse[], rowDeliveryStatus: string | undefined): {
  admin: SupabaseClient<Database>;
  rpc: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn();
  for (const response of rpcResponses) {
    rpc.mockImplementationOnce(() => Promise.resolve(response));
  }

  const limit = vi.fn().mockResolvedValue({
    data: rowDeliveryStatus !== undefined ? [{ delivery_status: rowDeliveryStatus }] : [],
    error: null,
  });
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return { admin: { rpc, from } as unknown as SupabaseClient<Database>, rpc, limit };
}

describe('finalizeCreateDelivery', () => {
  it('sucesso na primeira tentativa → finalized, sem consultar a linha', async () => {
    const { admin, rpc } = fakeAdmin([{ data: [{ success: true, code: 'ok' }], error: null }], undefined);

    const outcome = await finalizeCreateDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'invite-1',
      success: true,
    });

    expect(outcome).toBe('finalized');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('complete_invite_delivery', {
      p_actor_profile_id: 'actor-1',
      p_invite_id: 'invite-1',
      p_success: true,
    });
  });

  it('inclui p_error_code quando success=false', async () => {
    const { admin, rpc } = fakeAdmin([{ data: [{ success: true, code: 'ok' }], error: null }], undefined);

    await finalizeCreateDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'invite-1',
      success: false,
      errorCode: 'auth_email_failed',
    });

    expect(rpc).toHaveBeenCalledWith('complete_invite_delivery', {
      p_actor_profile_id: 'actor-1',
      p_invite_id: 'invite-1',
      p_success: false,
      p_error_code: 'auth_email_failed',
    });
  });

  it('erro de transporte na 1ª tentativa, sucesso na 2ª (retry) → finalized, rpc chamada 2x', async () => {
    const { admin, rpc } = fakeAdmin(
      [
        { data: null, error: { message: 'transport error' } },
        { data: [{ success: true, code: 'ok' }], error: null },
      ],
      undefined,
    );

    const outcome = await finalizeCreateDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'invite-1',
      success: true,
    });

    expect(outcome).toBe('finalized');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('erro nas 2 tentativas, mas a linha já não está not_sent → finalized (resposta perdida, 1ª aplicou)', async () => {
    const { admin, rpc } = fakeAdmin(
      [
        { data: null, error: { message: 'transport error' } },
        { data: null, error: { message: 'transport error' } },
      ],
      'sent',
    );

    const outcome = await finalizeCreateDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'invite-1',
      success: true,
    });

    expect(outcome).toBe('finalized');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('erro nas 2 tentativas e linha continua not_sent → finalize_failed', async () => {
    const { admin } = fakeAdmin(
      [
        { data: null, error: { message: 'transport error' } },
        { data: null, error: { message: 'transport error' } },
      ],
      'not_sent',
    );

    const outcome = await finalizeCreateDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'invite-1',
      success: true,
    });

    expect(outcome).toBe('finalize_failed');
  });

  it('RPC responde success:false (ex.: invite_not_actionable) e linha ainda not_sent → finalize_failed', async () => {
    const { admin } = fakeAdmin([{ data: [{ success: false, code: 'invite_not_actionable' }], error: null }], 'not_sent');

    const outcome = await finalizeCreateDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'invite-1',
      success: true,
    });

    expect(outcome).toBe('finalize_failed');
  });

  it('nunca chama complete_invite_resend_delivery', async () => {
    const { admin, rpc } = fakeAdmin([{ data: [{ success: true, code: 'ok' }], error: null }], undefined);

    await finalizeCreateDelivery({ admin, actorProfileId: 'a', inviteId: 'i', success: true });

    expect(rpc).not.toHaveBeenCalledWith('complete_invite_resend_delivery', expect.anything());
  });
});

describe('finalizeResendDelivery', () => {
  it('sucesso na primeira tentativa → finalized, chama complete_invite_resend_delivery com previous_invite_id', async () => {
    const { admin, rpc } = fakeAdmin([{ data: [{ success: true, code: 'ok' }], error: null }], undefined);

    const outcome = await finalizeResendDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'new-invite',
      previousInviteId: 'old-invite',
      success: true,
    });

    expect(outcome).toBe('finalized');
    expect(rpc).toHaveBeenCalledWith('complete_invite_resend_delivery', {
      p_actor_profile_id: 'actor-1',
      p_invite_id: 'new-invite',
      p_previous_invite_id: 'old-invite',
      p_success: true,
    });
  });

  it('erro nas 2 tentativas e linha continua not_sent → finalize_failed', async () => {
    const { admin } = fakeAdmin(
      [
        { data: null, error: { message: 'transport error' } },
        { data: null, error: { message: 'transport error' } },
      ],
      'not_sent',
    );

    const outcome = await finalizeResendDelivery({
      admin,
      actorProfileId: 'actor-1',
      inviteId: 'new-invite',
      previousInviteId: 'old-invite',
      success: true,
    });

    expect(outcome).toBe('finalize_failed');
  });

  it('nunca chama complete_invite_delivery', async () => {
    const { admin, rpc } = fakeAdmin([{ data: [{ success: true, code: 'ok' }], error: null }], undefined);

    await finalizeResendDelivery({
      admin,
      actorProfileId: 'a',
      inviteId: 'new',
      previousInviteId: 'old',
      success: true,
    });

    expect(rpc).not.toHaveBeenCalledWith('complete_invite_delivery', expect.anything());
  });
});
