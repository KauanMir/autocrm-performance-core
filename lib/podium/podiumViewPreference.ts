// lib/podium/podiumViewPreference.ts — PODIUM-COMPETITION-R1-EXEC §36-§39.
// Preferência visual A/B/C/D, por usuário, SOMENTE no navegador — nunca
// backend (a escolha nunca altera dados/rank/período, só apresentação).
// Puro: sem React (a camada de hook fica em
// lib/hooks/usePodiumViewPreference.ts), sem rede, nunca lança (falha de
// localStorage — modo privado, cookies bloqueados — cai no default,
// silenciosamente).
export type PodiumVariant = 'A' | 'B' | 'C' | 'D';

export const DEFAULT_PODIUM_VARIANT: PodiumVariant = 'D';

const VALID_VARIANTS: readonly PodiumVariant[] = ['A', 'B', 'C', 'D'];

function isPodiumVariant(value: string): value is PodiumVariant {
  return (VALID_VARIANTS as readonly string[]).includes(value);
}

// Chave por usuário (§39 do EXEC) — nunca uma chave global única: Kauan
// pode usar C, Lucas pode usar D, sem um alterar o do outro.
function storageKey(userId: string): string {
  return `kapa-crm:podium-view:${userId}`;
}

export function getPodiumViewPreference(userId: string | null | undefined): PodiumVariant {
  if (typeof userId !== 'string' || userId.trim() === '') return DEFAULT_PODIUM_VARIANT;
  if (typeof window === 'undefined') return DEFAULT_PODIUM_VARIANT;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    // Ausente ou inválido/corrompido: default D (§38) — nunca lança, nunca
    // um valor fora de A/B/C/D chega ao componente.
    if (typeof raw === 'string' && isPodiumVariant(raw)) return raw;
  } catch {
    // SecurityError (cookies bloqueados etc.) — cai no default.
  }
  return DEFAULT_PODIUM_VARIANT;
}

export function setPodiumViewPreference(userId: string | null | undefined, variant: PodiumVariant): void {
  if (typeof userId !== 'string' || userId.trim() === '') return;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), variant);
  } catch {
    // Falha ao persistir é só perda de conveniência — nunca crítica,
    // nunca lançada para o chamador.
  }
}
