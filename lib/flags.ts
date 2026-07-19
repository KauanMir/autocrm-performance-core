// lib/flags.ts — feature flag dos estágios remotos do pipeline (M1-D, commit 3).
//
// OFF por padrão. A ativação real acontece somente via variável de ambiente
// NEXT_PUBLIC_FF_REMOTE_STAGES depois da validação do módulo — nenhum commit
// liga a flag por padrão.
//
// Override de desenvolvimento: localStorage['autocrm_ff_remote_stages'],
// reconhecido EXCLUSIVAMENTE quando NODE_ENV === 'development'. Em produção o
// localStorage nunca é consultado — nenhum usuário ativa a flag pelo navegador.
// A flag não é reativa: mudar o override exige recarregar a página.
//
// Nenhum estado React, nenhum hook, nenhum log — é uma função pura de leitura.

export const REMOTE_STAGES_DEV_OVERRIDE_KEY = 'autocrm_ff_remote_stages';

// Somente as strings exatas 'true'/'false' são reconhecidas (case-sensitive);
// qualquer outro valor (1, yes, on, TRUE, vazio…) é tratado como inválido.
function parseFlagValue(value: string | null | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export function isRemoteStagesEnabled(): boolean {
  // process.env lido DENTRO da função (não em constante de módulo) para
  // permitir testes isolados. O acesso é por membro direto — obrigatório para
  // o inlining de NEXT_PUBLIC_* feito pelo Next.js em build.
  const envValue = parseFlagValue(process.env.NEXT_PUBLIC_FF_REMOTE_STAGES) ?? false;

  // Produção (qualquer NODE_ENV !== 'development'): retorna antes de qualquer
  // acesso a window/localStorage.
  if (process.env.NODE_ENV !== 'development') return envValue;

  // Development em SSR (window ausente): usa o env.
  if (typeof window === 'undefined') return envValue;

  // Development no browser: precedência = override válido no localStorage →
  // variável de ambiente válida → false.
  try {
    const override = parseFlagValue(window.localStorage.getItem(REMOTE_STAGES_DEV_OVERRIDE_KEY));
    return override ?? envValue;
  } catch {
    // SecurityError (cookies bloqueados etc.) — cai no valor do ambiente.
    return envValue;
  }
}
