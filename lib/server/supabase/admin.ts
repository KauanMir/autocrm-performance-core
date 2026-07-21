// lib/server/supabase/admin.ts — cliente Supabase administrativo
// (service_role) para o módulo de convites (M1-F S4-A2B). SERVER-ONLY:
// nunca importar este módulo de um componente client-side ('use client') —
// a service_role key nunca pode chegar ao browser.
//
// Usado exclusivamente por Route Handlers server-side para chamar as RPCs
// server-only (reserve_invite_rate_limit, create_invite, resend_invite,
// complete_invite_delivery, complete_invite_resend_delivery) e a Admin API
// do Supabase Auth (inviteUserByEmail).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('supabase_admin_client_misconfigured');
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
