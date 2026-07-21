// tests/server/invites/auth-email.test.ts — integração com o Supabase
// Auth nativo (M1-F S4-A2B, design §15/§16). admin/anon são fakes
// injetados diretamente — nenhuma rede real.
import { describe, expect, it, vi } from 'vitest';
import { classifyAuthError, sendInviteEmail } from '@/lib/server/invites/auth-email';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

function fakeAdmin(inviteUserByEmail: ReturnType<typeof vi.fn>): SupabaseClient<Database> {
  return { auth: { admin: { inviteUserByEmail } } } as unknown as SupabaseClient<Database>;
}

function fakeAnon(signInWithOtp: ReturnType<typeof vi.fn>): SupabaseClient<Database> {
  return { auth: { signInWithOtp } } as unknown as SupabaseClient<Database>;
}

describe('classifyAuthError', () => {
  it('AuthRetryableFetchError (name) → auth_unavailable', () => {
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 503 })).toBe('auth_unavailable');
  });

  it('code over_email_send_rate_limit → auth_rate_limited', () => {
    expect(classifyAuthError({ code: 'over_email_send_rate_limit', status: 429 })).toBe('auth_rate_limited');
  });

  it('status 429 sem code reconhecido → auth_rate_limited', () => {
    expect(classifyAuthError({ status: 429 })).toBe('auth_rate_limited');
  });

  it('erro com code estável desconhecido → auth_email_failed (nunca lê message)', () => {
    expect(classifyAuthError({ code: 'unexpected_failure', status: 500, message: 'texto livre que pode mudar' })).toBe(
      'auth_email_failed',
    );
  });

  it('erro sem code/status/name → unexpected_delivery_error', () => {
    expect(classifyAuthError({})).toBe('unexpected_delivery_error');
  });

  it('valor não-objeto (throw de string/undefined) → unexpected_delivery_error', () => {
    expect(classifyAuthError('boom')).toBe('unexpected_delivery_error');
    expect(classifyAuthError(undefined)).toBe('unexpected_delivery_error');
    expect(classifyAuthError(null)).toBe('unexpected_delivery_error');
  });
});

describe('sendInviteEmail', () => {
  it('inviteUserByEmail sem erro → ok, nunca chama signInWithOtp', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
    const signInWithOtp = vi.fn();

    const result = await sendInviteEmail({
      admin: fakeAdmin(inviteUserByEmail),
      anon: fakeAnon(signInWithOtp),
      email: 'novo@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=abc',
      name: 'Fulano',
    });

    expect(result).toEqual({ ok: true });
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(inviteUserByEmail).toHaveBeenCalledWith('novo@example.com', {
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=abc',
      data: { name: 'Fulano' },
    });
  });

  it('sem `name` (fluxo de resend): inviteUserByEmail é chamado sem `data`', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
    const signInWithOtp = vi.fn();

    await sendInviteEmail({
      admin: fakeAdmin(inviteUserByEmail),
      anon: fakeAnon(signInWithOtp),
      email: 'existente@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=xyz',
    });

    expect(inviteUserByEmail).toHaveBeenCalledWith('existente@example.com', {
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=xyz',
    });
  });

  it('email_exists → cai para signInWithOtp com shouldCreateUser:false', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: { code: 'email_exists', status: 422 } });
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });

    const result = await sendInviteEmail({
      admin: fakeAdmin(inviteUserByEmail),
      anon: fakeAnon(signInWithOtp),
      email: 'existente@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=xyz',
      name: 'Fulano',
    });

    expect(result).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'existente@example.com',
      options: {
        shouldCreateUser: false,
        emailRedirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=xyz',
      },
    });
  });

  it('email_exists + signInWithOtp falha → ok:false com errorCode classificado', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: { code: 'email_exists' } });
    const signInWithOtp = vi.fn().mockResolvedValue({ error: { code: 'over_email_send_rate_limit', status: 429 } });

    const result = await sendInviteEmail({
      admin: fakeAdmin(inviteUserByEmail),
      anon: fakeAnon(signInWithOtp),
      email: 'existente@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=xyz',
    });

    expect(result).toEqual({ ok: false, errorCode: 'auth_rate_limited' });
  });

  it('falha do inviteUserByEmail não relacionada a conta existente → ok:false, nunca chama signInWithOtp', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 503 } });
    const signInWithOtp = vi.fn();

    const result = await sendInviteEmail({
      admin: fakeAdmin(inviteUserByEmail),
      anon: fakeAnon(signInWithOtp),
      email: 'novo@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=abc',
      name: 'Fulano',
    });

    expect(result).toEqual({ ok: false, errorCode: 'auth_unavailable' });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('nunca diferencia usuário novo/existente no retorno (mesma forma {ok:true} nos dois casos)', async () => {
    const newUser = await sendInviteEmail({
      admin: fakeAdmin(vi.fn().mockResolvedValue({ error: null })),
      anon: fakeAnon(vi.fn()),
      email: 'a@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=a',
    });

    const existingUser = await sendInviteEmail({
      admin: fakeAdmin(vi.fn().mockResolvedValue({ error: { code: 'email_exists' } })),
      anon: fakeAnon(vi.fn().mockResolvedValue({ error: null })),
      email: 'b@example.com',
      redirectTo: 'http://127.0.0.1:3000/convite/aceitar#invite_token=b',
    });

    expect(newUser).toEqual({ ok: true });
    expect(existingUser).toEqual({ ok: true });
  });
});
