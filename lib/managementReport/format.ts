// lib/managementReport/format.ts — formatação de exibição do relatório
// gerencial (KPI-REPORTS-B2-EXEC-FRONTEND §25/§30/§57). Puro, sem React.
// Dinheiro continua em lib/deals/money.ts (formatCentsToBRL) — não
// duplicado aqui.

// Taxa de conversão: o backend devolve um number já arredondado a 2 casas
// (ex.: 33.33, 60). Exibir com no máximo 2 casas ÚTEIS — sem zeros finais
// que não ajudam a leitura (§25): 60 -> "60%", 33.33 -> "33,33%",
// 33.3 -> "33,3%", 60.00 -> "60%". Vírgula decimal pt-BR (§57).
export function formatRatePercent(rate: number): string {
  if (!Number.isFinite(rate)) {
    throw new RangeError('formatRatePercent: rate precisa ser um número finito');
  }
  const fixed = (Math.round(rate * 100) / 100).toFixed(2); // "60.00" | "33.33"
  const trimmed = fixed.replace(/\.?0+$/, ''); // "60" | "33.33" | "33.3"
  return trimmed.replace('.', ',') + '%';
}

// Data civil 'YYYY-MM-DD' -> 'DD/MM' para o eixo X do trend, SEM new Date()
// (§30 — nunca reinterpretar o timezone; a data já é civil da empresa).
export function formatTrendDateShort(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}`;
}

// Data civil 'YYYY-MM-DD' -> 'DD/MM/AAAA' para descrição acessível/tooltip.
export function formatTrendDateLong(ymd: string): string {
  const parts = ymd.split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
