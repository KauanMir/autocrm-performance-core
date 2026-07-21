// lib/server/supabase/user-token-client.ts — clientes Supabase server-side
// que operam com a chave anon (nunca service_role), para o módulo de
// convites (M1-F S4-A2B). SERVER-ONLY.
//
// Dois usos, mesma chave anon:
//   1. createAnonServerClient() — sem identidade, usado para
//      signInWithOtp() do fluxo de magic link (usuário Auth já existente).
//   2. createUserScopedClient(jwt) — encaminha o Bearer do chamador via
//      header Authorization, usado para auth.getUser(jwt) (validação do
//      Bearer) e para consultas .from() que precisam respeitar a RLS como
//      aquele usuário específico (ex.: SELECT de invites no resend).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

function requireAnonConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('supabase_anon_client_misconfigured');
  }

  return { url, anonKey };
}

export function createAnonServerClient(): SupabaseClient<Database> {
  const { url, anonKey } = requireAnonConfig();

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createUserScopedClient(jwt: string): SupabaseClient<Database> {
  const { url, anonKey } = requireAnonConfig();

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
}
