// lib/deals/labels.ts — mapeamento centralizado de enums remotos de Deals
// para rótulos PT-BR (COMMERCIAL-REMOTE-DEALS-B2-A). Mesmo papel de
// REMOTE_VISITS_MUTATION_ERROR_MESSAGES_PT (lib/visits/errors.ts): NÃO
// renderizado por nenhum componente neste lote (B2-A é infraestrutura, sem
// UI/cutover) — mantido aqui, junto do tipo que o origina, para nenhuma
// tela futura duplicar essas strings por conta própria (B2-A-PRECHECK
// §12/§13).
//
// Vocabulário de produto do pivot (B1-A-PRODUCT-PIVOT): ZERO alias do
// workflow de aprovação removido — nunca "Em aberto"/"Aguardando
// aprovação"/"Aprovada"/"Recusada".
import type { RemoteDealRow } from '@/lib/deals/adapter';

export const DEAL_STATUS_LABELS_PT: Readonly<Record<RemoteDealRow['status'], string>> = {
  open: 'Em negociação',
  lost: 'Perdida',
  sold: 'Vendida',
};

// Mesmos 4 valores/labels de PAYS (components/flows/FlowsShared.tsx:24) —
// mapping inverso (enum -> label), não duplica o array original, só
// espelha o vocabulário já validado na UI local.
export const DEAL_PAYMENT_METHOD_LABELS_PT: Readonly<Record<RemoteDealRow['payment_method'], string>> = {
  a_vista: 'À vista',
  financiamento_100: 'Financiamento 100%',
  entrada_financiamento: 'Entrada + Financiamento',
  troca: 'Troca',
};
