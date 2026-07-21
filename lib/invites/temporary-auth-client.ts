// lib/invites/temporary-auth-client.ts — fábrica de um cliente Supabase
// Auth TEMPORÁRIO, exclusivo do fluxo de aceite de convite (M1-F S4-C2B).
// Nunca singleton: cada tentativa consciente de autenticação chama esta
// função de novo, criando uma instância isolada — nunca compartilha
// storage/sessão com o cliente principal (lib/supabase/client.ts). Mesma
// URL/anon key públicas do cliente principal; nunca service_role, nunca
// Admin API. A sessão obtida aqui fica só em memória (useRef do
// chamador) até o aceite ser confirmado.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export function createTemporaryInviteAuthClient(): SupabaseClient<Database> {
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
