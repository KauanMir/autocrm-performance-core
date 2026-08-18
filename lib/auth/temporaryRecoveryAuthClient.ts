// lib/auth/temporaryRecoveryAuthClient.ts — fábrica de um cliente Supabase
// Auth TEMPORÁRIO, exclusivo do fluxo de recuperação de senha
// (PILOT-P0-A1-EXEC-RECOVERY). Mesmo raciocínio de
// lib/invites/temporary-auth-client.ts (duplicado deliberadamente em vez de
// generalizado — fluxos diferentes, mesma preocupação de isolamento):
// nunca singleton, `persistSession: false` garante que a sessão de
// recovery NUNCA é escrita no localStorage compartilhado com o cliente
// principal (lib/supabase/client.ts) — se o usuário abandonar o fluxo antes
// de definir a nova senha, nenhuma sessão fica esquecida pronta para
// autenticar sozinha num F5 futuro. Mesma URL/anon key públicas do cliente
// principal; nunca service_role, nunca Admin API.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export function createTemporaryRecoveryAuthClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return createClient<Database>(
    url || 'https://placeholder.supabase.co',
    anonKey || 'placeholder-anon-key',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}
