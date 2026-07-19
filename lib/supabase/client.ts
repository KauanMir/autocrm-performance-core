// lib/supabase/client.ts — single Supabase client for the whole app (M1-B).
// Only Auth/profiles/sellers talk to this so far — leads/visits/deals/sales/
// tasks still live in lib/store.ts (localStorage) until M1-C+.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Real env vars missing must not crash `next build` — the App Router still
// evaluates this module during the server-side prerender pass of 'use client'
// components, even though nothing here ever runs on a real server at runtime.
// A syntactically valid placeholder keeps createClient() from throwing on an
// invalid URL; any actual network call against it fails loudly and obviously,
// which is exactly what should happen before .env.local is configured.
export const isSupabaseConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

if (!isSupabaseConfigured && typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.warn(
    '[AutoCRM] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configurados — ' +
    'login real não vai funcionar até .env.local ser preenchido (ver .env.local.example).',
  );
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No OAuth redirect flow in this phase (login é e-mail/senha; o botão
      // "Entrar com Google" na tela de login é só visual, não chama OAuth
      // real) — desligar evita parsing de URL desnecessário a cada navegação.
      detectSessionInUrl: false,
    },
  },
);
