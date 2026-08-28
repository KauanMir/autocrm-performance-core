// lib/competitionRewards/money.ts — COMPETITION-REWARDS-V1-B2-EXEC §16/§17.
// Conversão entre o input BRL do Manager e amount_cents (integer) do
// contrato de upsert_competition_reward_campaign. A UI mostra "dinheiro
// normal" (R$ 1.000,00); o payload NUNCA carrega float — só o inteiro de
// centavos ou null.
//
// Estratégia: o campo é sempre re-renderizado com formatCentsToBRL(cents),
// e cada digitação é reinterpretada a partir dos DÍGITOS da string (os
// dígitos acumulam pela direita, como um caixa eletrônico). Isso garante
// roundtrip perfeito: format(cents) -> parse -> os mesmos cents (§55).
//   "" / sem dígitos        -> null   (campo vazio; validação decide)
//   "1"                     -> 1      (R$ 0,01)
//   "100"  / "R$ 1,00"      -> 100    (R$ 1,00)          — §16
//   "100000" / "R$ 1.000,00"-> 100000 (R$ 1.000,00)      — §16
// O display continua sendo responsabilidade de formatCentsToBRL
// (lib/deals/money.ts) — único formatter monetário cents->R$ do projeto.
import { formatCentsToBRL } from '@/lib/deals/money';

// Só dígitos; interpreta como centavos. Máximo defensivo em 12 dígitos
// (R$ 9.999.999.999,99) para nunca estourar Number com colar acidental.
export function parseBrlInputToCents(input: string): number | null {
  const digits = (input ?? '').replace(/\D/g, '').slice(0, 12);
  if (digits === '') return null;
  const cents = Number.parseInt(digits, 10);
  return Number.isFinite(cents) ? cents : null;
}

// Valor exibido no <input>. null -> string vazia (mostra o placeholder).
export function formatCentsForInput(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return '';
  return formatCentsToBRL(cents);
}

// Soma dos amount_cents não-nulos — total da premiação (§21). reward_text
// NUNCA entra na soma. Resultado NUNCA é persistido.
export function sumTierAmountCents(tiers: readonly { amountCents: number | null }[]): number {
  return tiers.reduce((acc, t) => acc + (t.amountCents ?? 0), 0);
}

export { formatCentsToBRL };
