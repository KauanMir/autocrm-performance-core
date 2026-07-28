// Testes de lib/commercial/leadDisplay.ts (M1-F S8-C2-B2). Funções puras —
// nenhum nome de vendedor é inventado (sellers não tem policy de SELECT
// nenhuma desde o S8-C1-A, e não existe RPC própria nesta etapa); etapa fora
// do índice recebido nunca desaparece silenciosamente.
import { describe, expect, it } from 'vitest';
import {
  resolveLeadAssignmentState,
  formatLeadAssignmentLabel,
  resolveLeadStageName,
  LEAD_ASSIGNED_LABEL,
  LEAD_UNASSIGNED_LABEL,
  LEAD_STAGE_UNAVAILABLE_LABEL,
} from '@/lib/commercial/leadDisplay';

describe('resolveLeadAssignmentState', () => {
  it('seller_id presente ⇒ assigned', () => {
    expect(resolveLeadAssignmentState('seller-1')).toBe('assigned');
  });
  it('seller_id null ⇒ unassigned', () => {
    expect(resolveLeadAssignmentState(null)).toBe('unassigned');
  });
});

describe('formatLeadAssignmentLabel — nunca um nome, só atribuído/não atribuído', () => {
  it('seller_id presente ⇒ "Vendedor atribuído" (nunca o nome real)', () => {
    expect(formatLeadAssignmentLabel('seller-1')).toBe(LEAD_ASSIGNED_LABEL);
    expect(formatLeadAssignmentLabel('seller-1')).not.toContain('seller-1');
  });
  it('seller_id null ⇒ "Sem vendedor"', () => {
    expect(formatLeadAssignmentLabel(null)).toBe(LEAD_UNASSIGNED_LABEL);
  });
});

describe('resolveLeadStageName', () => {
  const stagesById = { 'stage-1': { name: 'Novo' }, 'stage-2': { name: 'Fechamento' } };

  it('stage_id presente no índice ⇒ nome real da etapa', () => {
    expect(resolveLeadStageName('stage-1', stagesById)).toBe('Novo');
    expect(resolveLeadStageName('stage-2', stagesById)).toBe('Fechamento');
  });

  it('stage_id ausente do índice ⇒ "Etapa indisponível" (nunca desaparece silenciosamente, nunca inventa nome)', () => {
    expect(resolveLeadStageName('stage-inexistente', stagesById)).toBe(LEAD_STAGE_UNAVAILABLE_LABEL);
  });

  it('índice vazio ⇒ sempre "Etapa indisponível"', () => {
    expect(resolveLeadStageName('stage-1', {})).toBe(LEAD_STAGE_UNAVAILABLE_LABEL);
  });
});
