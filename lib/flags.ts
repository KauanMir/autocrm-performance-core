// lib/flags.ts — feature flags dos módulos remotos (M1-D stages, M1-E leads).
//
// OFF por padrão. A ativação real acontece somente via variável de ambiente
// (NEXT_PUBLIC_FF_REMOTE_STAGES / NEXT_PUBLIC_FF_REMOTE_LEADS) depois da
// validação de cada módulo — nenhum commit liga flag por padrão.
//
// Override de desenvolvimento: localStorage['autocrm_ff_remote_stages'] /
// localStorage['autocrm_ff_remote_leads'], reconhecido EXCLUSIVAMENTE quando
// NODE_ENV === 'development'. Em produção o localStorage nunca é consultado —
// nenhum usuário ativa flag pelo navegador. As flags não são reativas: mudar
// o override exige recarregar a página.
//
// Nenhum estado React, nenhum hook, nenhum log — funções puras de leitura.

export const REMOTE_STAGES_DEV_OVERRIDE_KEY = 'autocrm_ff_remote_stages';
export const REMOTE_LEADS_DEV_OVERRIDE_KEY = 'autocrm_ff_remote_leads';

// Somente as strings exatas 'true'/'false' são reconhecidas (case-sensitive);
// qualquer outro valor (1, yes, on, TRUE, vazio…) é tratado como inválido.
function parseFlagValue(value: string | null | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// Contrato único das duas flags. O valor bruto do env chega por parâmetro
// porque o inlining de NEXT_PUBLIC_* do Next.js exige acesso por membro
// direto (process.env.NEXT_PUBLIC_…) no call site — nunca acesso dinâmico.
function resolveFlag(envRawValue: string | null | undefined, devOverrideKey: string): boolean {
  const envValue = parseFlagValue(envRawValue) ?? false;

  // Produção (qualquer NODE_ENV !== 'development'): retorna antes de qualquer
  // acesso a window/localStorage.
  if (process.env.NODE_ENV !== 'development') return envValue;

  // Development em SSR (window ausente): usa o env.
  if (typeof window === 'undefined') return envValue;

  // Development no browser: precedência = override válido no localStorage →
  // variável de ambiente válida → false.
  try {
    const override = parseFlagValue(window.localStorage.getItem(devOverrideKey));
    return override ?? envValue;
  } catch {
    // SecurityError (cookies bloqueados etc.) — cai no valor do ambiente.
    return envValue;
  }
}

export function isRemoteStagesEnabled(): boolean {
  // process.env lido DENTRO da função (não em constante de módulo) para
  // permitir testes isolados.
  return resolveFlag(process.env.NEXT_PUBLIC_FF_REMOTE_STAGES, REMOTE_STAGES_DEV_OVERRIDE_KEY);
}

export function isRemoteLeadsEnabled(): boolean {
  return resolveFlag(process.env.NEXT_PUBLIC_FF_REMOTE_LEADS, REMOTE_LEADS_DEV_OVERRIDE_KEY);
}
