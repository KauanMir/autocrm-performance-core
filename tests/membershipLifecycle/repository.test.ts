// tests/membershipLifecycle/repository.test.ts — camada de dados das cinco
// RPCs de ciclo de vida empresarial (M1-F S6-F): suspend_membership/
// reactivate_membership (S6-B), offboard_seller (S6-E2)/offboard_manager
// (S6-C), transfer_membership (S6-D). supabase.rpc mockado — nenhuma rede
// real. Cobertura central: nomes exatos das RPCs, argumentos exatos (em
// especial o tipo do sucessor — membership_id para offboard_seller,
// profile_id para offboard_manager/transfer_membership), validação de forma
// da resposta e propagação crua de erro de domínio.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mocks.rpc },
  isSupabaseConfigured: true,
}));

import {
  suspendMembershipRpc,
  reactivateMembershipRpc,
  offboardSellerRpc,
  offboardManagerRpc,
  transferMembershipRpc,
} from '@/lib/membershipLifecycle/repository';
import { isMembershipLifecycleError } from '@/lib/membershipLifecycle/errors';

const SUSPEND_ROW = {
  membership_id: 'membership-1', profile_id: 'profile-1', company_id: 'company-1',
  company_role: 'seller' as const, lifecycle_status: 'suspended' as const, is_active: false,
  seller_id: 'seller-1', seller_active: false,
};

const OFFBOARD_SELLER_ROW = {
  membership_id: 'membership-1', profile_id: 'profile-1', company_id: 'company-1',
  company_role: 'seller' as const, lifecycle_status: 'offboarded' as const, is_active: false,
  seller_id: 'seller-1', seller_active: false, successor_seller_id: 'seller-2', leads_reassigned: 2,
};

const OFFBOARD_MANAGER_ROW = {
  membership_id: 'membership-2', profile_id: 'profile-2', company_id: 'company-1',
  company_role: 'manager' as const, lifecycle_status: 'offboarded' as const, is_active: false,
  successor_profile_id: 'profile-3',
};

const TRANSFER_ROW = {
  profile_id: 'profile-1', source_membership_id: 'membership-1', destination_membership_id: 'membership-9',
  source_company_id: 'company-1', destination_company_id: 'company-2', destination_role: 'seller' as const,
  source_seller_id: 'seller-1', destination_seller_id: 'seller-9', leads_reassigned: 0,
};

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('suspendMembershipRpc', () => {
  it('chama suspend_membership com p_membership_id/p_note', async () => {
    mocks.rpc.mockResolvedValue({ data: [SUSPEND_ROW], error: null });
    await suspendMembershipRpc('membership-1', 'motivo válido');
    expect(mocks.rpc).toHaveBeenCalledWith('suspend_membership', { p_membership_id: 'membership-1', p_note: 'motivo válido' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('sucesso: retorna a linha exatamente como veio', async () => {
    mocks.rpc.mockResolvedValue({ data: [SUSPEND_ROW], error: null });
    const result = await suspendMembershipRpc('membership-1', 'motivo válido');
    expect(result).toEqual(SUSPEND_ROW);
  });

  it('erro de domínio (ex.: last_manager_requires_successor): propaga cru, nunca embrulha', async () => {
    const domainError = { message: 'last_manager_requires_successor', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(suspendMembershipRpc('membership-1', 'motivo')).rejects.toBe(domainError);
  });

  it('resposta com forma inválida: lança membership_lifecycle_invalid_response', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...SUSPEND_ROW, lifecycle_status: 'invalido' }], error: null });
    let caught: unknown;
    try { await suspendMembershipRpc('membership-1', 'motivo'); } catch (err) { caught = err; }
    expect(isMembershipLifecycleError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe('membership_lifecycle_invalid_response');
  });
});

describe('reactivateMembershipRpc', () => {
  it('nota null: envia p_note=undefined (omitido)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...SUSPEND_ROW, lifecycle_status: 'active', is_active: true }], error: null });
    await reactivateMembershipRpc('membership-1', null);
    expect(mocks.rpc).toHaveBeenCalledWith('reactivate_membership', { p_membership_id: 'membership-1', p_note: undefined });
  });

  it('nota presente: envia exatamente o texto', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...SUSPEND_ROW, lifecycle_status: 'active', is_active: true }], error: null });
    await reactivateMembershipRpc('membership-1', 'motivo opcional');
    expect(mocks.rpc).toHaveBeenCalledWith('reactivate_membership', { p_membership_id: 'membership-1', p_note: 'motivo opcional' });
  });

  it('erro de domínio (membership_lifecycle_conflict): propaga cru', async () => {
    const domainError = { message: 'membership_lifecycle_conflict', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(reactivateMembershipRpc('membership-1', null)).rejects.toBe(domainError);
  });
});

describe('offboardSellerRpc — sucessor é MEMBERSHIP_ID (S6-E2)', () => {
  it('sucessor presente: envia p_successor_membership_id (uuid de membership, nunca seller_id)', async () => {
    mocks.rpc.mockResolvedValue({ data: [OFFBOARD_SELLER_ROW], error: null });
    await offboardSellerRpc('membership-1', 'membership-2', 'motivo');
    expect(mocks.rpc).toHaveBeenCalledWith('offboard_seller', {
      p_seller_membership_id: 'membership-1',
      p_successor_membership_id: 'membership-2',
      p_note: 'motivo',
    });
  });

  it('sucessor null: envia p_successor_membership_id=undefined', async () => {
    mocks.rpc.mockResolvedValue({ data: [OFFBOARD_SELLER_ROW], error: null });
    await offboardSellerRpc('membership-1', null, 'motivo');
    expect(mocks.rpc).toHaveBeenCalledWith('offboard_seller', {
      p_seller_membership_id: 'membership-1',
      p_successor_membership_id: undefined,
      p_note: 'motivo',
    });
  });

  it('sucesso: retorna leads_reassigned/successor_seller_id', async () => {
    mocks.rpc.mockResolvedValue({ data: [OFFBOARD_SELLER_ROW], error: null });
    const result = await offboardSellerRpc('membership-1', 'membership-2', 'motivo');
    expect(result).toEqual(OFFBOARD_SELLER_ROW);
  });

  it('erro de domínio (successor_required, novo em S6-E2): propaga cru', async () => {
    const domainError = { message: 'successor_required', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(offboardSellerRpc('membership-1', null, 'motivo')).rejects.toBe(domainError);
  });

  it('resposta faltando leads_reassigned: lança membership_lifecycle_invalid_response', async () => {
    const { leads_reassigned, ...invalid } = OFFBOARD_SELLER_ROW;
    mocks.rpc.mockResolvedValue({ data: [invalid], error: null });
    await expect(offboardSellerRpc('membership-1', null, 'motivo')).rejects.toMatchObject({
      code: 'membership_lifecycle_invalid_response',
    });
  });
});

describe('offboardManagerRpc — sucessor é PROFILE_ID', () => {
  it('sucessor presente: envia p_successor_profile_id (uuid de profiles)', async () => {
    mocks.rpc.mockResolvedValue({ data: [OFFBOARD_MANAGER_ROW], error: null });
    await offboardManagerRpc('membership-2', 'profile-3', 'motivo');
    expect(mocks.rpc).toHaveBeenCalledWith('offboard_manager', {
      p_manager_membership_id: 'membership-2',
      p_successor_profile_id: 'profile-3',
      p_note: 'motivo',
    });
  });

  it('sucessor null: envia p_successor_profile_id=undefined', async () => {
    mocks.rpc.mockResolvedValue({ data: [OFFBOARD_MANAGER_ROW], error: null });
    await offboardManagerRpc('membership-2', null, 'motivo');
    expect(mocks.rpc).toHaveBeenCalledWith('offboard_manager', {
      p_manager_membership_id: 'membership-2',
      p_successor_profile_id: undefined,
      p_note: 'motivo',
    });
  });

  it('erro de domínio (last_manager_requires_successor): propaga cru', async () => {
    const domainError = { message: 'last_manager_requires_successor', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(offboardManagerRpc('membership-2', null, 'motivo')).rejects.toBe(domainError);
  });
});

describe('transferMembershipRpc — sucessor é PROFILE_ID (nunca membership_id — contrato distinto de offboard_seller)', () => {
  it('chama transfer_membership com os 5 parâmetros nomeados exatos', async () => {
    mocks.rpc.mockResolvedValue({ data: [TRANSFER_ROW], error: null });
    await transferMembershipRpc('membership-1', 'company-2', 'seller', 'profile-5', 'motivo');
    expect(mocks.rpc).toHaveBeenCalledWith('transfer_membership', {
      p_source_membership_id: 'membership-1',
      p_target_company_id: 'company-2',
      p_target_role: 'seller',
      p_successor_id: 'profile-5',
      p_note: 'motivo',
    });
  });

  it('sucessor null: envia p_successor_id=undefined', async () => {
    mocks.rpc.mockResolvedValue({ data: [TRANSFER_ROW], error: null });
    await transferMembershipRpc('membership-1', 'company-2', 'manager', null, 'motivo');
    expect(mocks.rpc).toHaveBeenCalledWith('transfer_membership', {
      p_source_membership_id: 'membership-1',
      p_target_company_id: 'company-2',
      p_target_role: 'manager',
      p_successor_id: undefined,
      p_note: 'motivo',
    });
  });

  it('sucesso: retorna leads_reassigned/destination_*', async () => {
    mocks.rpc.mockResolvedValue({ data: [TRANSFER_ROW], error: null });
    const result = await transferMembershipRpc('membership-1', 'company-2', 'seller', null, 'motivo');
    expect(result).toEqual(TRANSFER_ROW);
  });

  it('erro de domínio (successor_required): propaga cru', async () => {
    const domainError = { message: 'successor_required', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(transferMembershipRpc('membership-1', 'company-2', 'seller', null, 'motivo')).rejects.toBe(domainError);
  });

  it('erro de domínio (same_company_transfer_forbidden): propaga cru', async () => {
    const domainError = { message: 'same_company_transfer_forbidden', code: 'P0001' };
    mocks.rpc.mockResolvedValue({ data: null, error: domainError });
    await expect(transferMembershipRpc('membership-1', 'company-1', 'seller', null, 'motivo')).rejects.toBe(domainError);
  });
});
