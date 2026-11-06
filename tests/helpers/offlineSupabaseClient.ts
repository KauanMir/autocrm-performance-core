// tests/helpers/offlineSupabaseClient.ts — cliente Supabase verdadeiro, sem rede.
// Para testes que montam o shell real do App, onde hooks usam `@/lib/supabase/client`.
// A biblioteca roda de verdade e cada chamada falha como rede indisponível: os hooks
// seguem pelo caminho de erro normal, sem abrir socket.
//
// vi.mock('@/lib/supabase/client', async () => (await import('@/tests/helpers/offlineSupabaseClient')).offlineSupabaseModule());
import { createClient } from '@supabase/supabase-js';

export function offlineSupabaseModule() {
  return {
    isSupabaseConfigured: false,
    supabase: createClient('http://supabase-offline.invalid', 'chave-offline', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
      },
    }),
  };
}
