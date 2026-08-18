// lib/auth/recoveryLink.ts — parser puro do link de recuperação de senha
// (PILOT-P0-A1-EXEC-RECOVERY). Nunca toca window/document diretamente —
// recebe search/hash já lidos pelo chamador. Suporta defensivamente os dois
// formatos reais que o Supabase Auth pode produzir para type=recovery,
// dependendo do template de e-mail configurado no dashboard (externo a
// este repo, não confirmável por aqui):
//
//   A) token_hash (query string) — template com {{ .TokenHash }}, verificado
//      via supabase.auth.verifyOtp({ token_hash, type: 'recovery' }).
//   B) access_token + refresh_token (hash) — redirect padrão do GoTrue
//      quando o e-mail usa {{ .ConfirmationURL }} (fluxo implícito — o
//      client instalado usa flowType:'implicit' por padrão, confirmado em
//      node_modules/@supabase/auth-js/dist/module/GoTrueClient.js),
//      estabelecido via supabase.auth.setSession({ access_token, refresh_token }).
//
// Nenhuma normalização silenciosa: formato ausente/inesperado é 'none',
// nunca corrigido ou adivinhado.
export type RecoveryLink =
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'implicit_tokens'; accessToken: string; refreshToken: string }
  | { kind: 'none' };

function parseTokenHashFromQuery(search: string): RecoveryLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (params.get('type') !== 'recovery') return null;
  const tokenHash = params.get('token_hash');
  if (!tokenHash) return null;
  return { kind: 'token_hash', tokenHash };
}

function parseImplicitTokensFromHash(hash: string): RecoveryLink {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!body) return { kind: 'none' };
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return { kind: 'none' };
  }
  if (params.get('type') !== 'recovery') return { kind: 'none' };
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return { kind: 'none' };
  return { kind: 'implicit_tokens', accessToken, refreshToken };
}

export function parseRecoveryLink(search: string, hash: string): RecoveryLink {
  const fromQuery = parseTokenHashFromQuery(search);
  if (fromQuery) return fromQuery;
  return parseImplicitTokensFromHash(hash);
}
