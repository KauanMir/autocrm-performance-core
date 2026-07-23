// tests/invites/cancelInviteRpc.test.ts — cancelamento de convite via RPC
// (M1-F S4-F3). supabase.rpc mockado — nenhuma rede real. cancel_invite é
// SECURITY DEFINER com EXECUTE para authenticated (m1f_s4a2a); este teste
// cobre só o wrapper client-safe (forma da resposta), a autorização real é
// coberta pelos testes SQL 22/23/26.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

import { cancelInviteRpc } from '@/lib/invites/repository';

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('cancelInviteRpc — chamada', () => {
  it('chama exclusivamente a RPC cancel_invite com p_invite_id', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'canceled' }], error: null });

    await cancelInviteRpc('invite-1');

    expect(mocks.rpc).toHaveBeenCalledWith('cancel_invite', { p_invite_id: 'invite-1' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('cancelInviteRpc — sucesso', () => {
  it('outcome ok com inviteId/status', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'canceled' }], error: null });
    const result = await cancelInviteRpc('invite-1');
    expect(result).toEqual({ outcome: 'ok', inviteId: 'invite-1', status: 'canceled' });
  });
});

describe('cancelInviteRpc — erros de domínio', () => {
  it('invite_not_found: outcome domain_error (cross-tenant colapsa aqui, nunca revela o motivo real)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ success: false, code: 'invite_not_found', invite_id: null, status: null }], error: null });
    const result = await cancelInviteRpc('invite-de-outra-empresa');
    expect(result).toEqual({ outcome: 'domain_error', code: 'invite_not_found' });
  });

  it('invite_not_actionable (ex.: convite pending mas já expirado): outcome domain_error', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ success: false, code: 'invite_not_actionable', invite_id: 'invite-1', status: 'expired' }], error: null });
    const result = await cancelInviteRpc('invite-1');
    expect(result).toEqual({ outcome: 'domain_error', code: 'invite_not_actionable' });
  });
});

describe('cancelInviteRpc — respostas malformadas ou inesperadas', () => {
  it('RPC lança erro de transporte: outcome error, nunca propaga', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });
    const result = await cancelInviteRpc('invite-1');
    expect(result).toEqual({ outcome: 'error' });
  });

  it('resposta vazia (array vazio): outcome error', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await cancelInviteRpc('invite-1');
    expect(result).toEqual({ outcome: 'error' });
  });

  it('success=true mas faltando invite_id: outcome error (nunca confia cegamente no shape)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ success: true, code: 'ok', status: 'canceled' }], error: null });
    const result = await cancelInviteRpc('invite-1');
    expect(result).toEqual({ outcome: 'error' });
  });

  it('data não é array nem objeto: outcome error', async () => {
    mocks.rpc.mockResolvedValue({ data: 'unexpected-string', error: null });
    const result = await cancelInviteRpc('invite-1');
    expect(result).toEqual({ outcome: 'error' });
  });
});

describe('cancelInviteRpc — segurança', () => {
  it('nunca usa update direto — só rpc() é chamado no client mockado', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ success: true, code: 'ok', invite_id: 'invite-1', status: 'canceled' }], error: null });
    await cancelInviteRpc('invite-1');
    expect(mocks.rpc).toHaveBeenCalled();
  });
});
