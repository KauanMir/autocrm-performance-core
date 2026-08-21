// lib/deals/money.ts — formata centavos (value_cents/down_payment_cents de
// public.deals) em string R$ pt-BR. Único ponto de conversão cents→reais do
// domínio de Deals — nenhum componente/hook deve fazer `/ 100` diretamente
// (B2-A-PRECHECK §11).
//
// Os generated types (lib/supabase/database.types.ts) mapeiam a coluna
// bigint para `number` no TypeScript — seguro para valores monetários reais
// (muito abaixo de Number.MAX_SAFE_INTEGER); esta função não tenta suportar
// bigint literal, consistente com o tipo já gerado pelo Supabase CLI.
//
// Prefixo manual "R$ " (não Intl NumberFormat style:'currency') — mesma
// convenção já usada no único formatter monetário existente do projeto
// (lib/leads/adapter.ts:82, 'R$ ' + n.toLocaleString('pt-BR')). Diferente
// daquele helper (reais inteiros, sem casas decimais), este SEMPRE mostra
// 2 casas — o dado de origem é centavos, então a precisão é real, não um
// artefato de exibição.
export function formatCentsToBRL(cents: number): string {
  if (!Number.isFinite(cents)) {
    throw new RangeError('formatCentsToBRL: cents precisa ser um número finito');
  }
  const reais = cents / 100;
  return 'R$ ' + reais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
