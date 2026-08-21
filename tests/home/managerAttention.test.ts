// Testes de lib/home/managerAttention.ts (COMMERCIAL-REMOTE-DEALS-B7-B2).
// Puro — sem mocks, sem React, sem Supabase, sem relógio: lateTasks/
// openDeals chegam pré-filtrados/pré-classificados (mesmo array já usado
// por useHomeTasksSummary/useHomeDealsSummary), o helper só agrupa.
import { describe, expect, it } from 'vitest';
import {
  groupLateTasksBySeller,
  groupOpenDealsBySeller,
  SELLER_ATTENTION_UNAVAILABLE_LABEL,
} from '@/lib/home/managerAttention';
import type { RemoteTaskModel } from '@/lib/tasks/taskAdapter';
import type { RemoteDealModel } from '@/lib/deals/adapter';

function task(over: Partial<RemoteTaskModel> = {}): RemoteTaskModel {
  return {
    id: 'task-1', title: 'Ligar para o cliente', lead: 'Cliente Remoto', leadId: null,
    assignedTo: 's1', when: 'Hoje', prio: 'alta', state: 'late', note: '',
    createdAt: '2026-08-01T10:00:00Z', dueAt: '2026-08-01T10:00:00Z', version: 1,
    ...over,
  } as RemoteTaskModel;
}

function deal(over: Partial<RemoteDealModel> = {}): RemoteDealModel {
  return {
    id: 'deal-1', leadId: 'lead-1', clientName: 'Carlos Andrade', assignedSellerId: 's1',
    vehicle: 'Golf GTI 2022', valueCents: 12000000, discountPercent: 3,
    paymentMethod: 'financiamento_100', downPaymentCents: null, installments: null, note: '',
    status: 'open', lostBy: null, lostAt: null,
    createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-21T10:00:00Z', version: 1,
    ...over,
  };
}

const SELLERS_BY_ID = {
  s1: { id: 's1', name: 'Lucas Martins' },
  s2: { id: 's2', name: 'Ana Souza' },
};

describe('groupLateTasksBySeller', () => {
  it('agrupa por Seller responsável (assignedTo), contagem exata', () => {
    const rows = groupLateTasksBySeller(
      [task({ id: 't1', assignedTo: 's1' }), task({ id: 't2', assignedTo: 's1' }), task({ id: 't3', assignedTo: 's1' }), task({ id: 't4', assignedTo: 's2' })],
      SELLERS_BY_ID,
    );
    expect(rows).toEqual([
      { sellerId: 's1', sellerLabel: 'Lucas Martins', count: 3 },
      { sellerId: 's2', sellerLabel: 'Ana Souza', count: 1 },
    ]);
  });

  it('nunca reclassifica: o array recebido já é a autoridade (nenhum filtro extra por state)', () => {
    // Fixtures TODAY/COMPLETED nunca deveriam chegar aqui — o chamador
    // (useHomeTasksSummary) já filtra por TASK_STATE.LATE antes de passar
    // o array. Provamos que o helper conta TUDO que recebe, sem refiltrar
    // por `state` — a responsabilidade de "só LATE" é do chamador.
    const rows = groupLateTasksBySeller(
      [task({ id: 't1', assignedTo: 's1', state: 'late' })],
      SELLERS_BY_ID,
    );
    expect(rows).toEqual([{ sellerId: 's1', sellerLabel: 'Lucas Martins', count: 1 }]);
  });
});

describe('groupOpenDealsBySeller', () => {
  it('agrupa por assignedSellerId, contagem exata', () => {
    const rows = groupOpenDealsBySeller(
      [
        deal({ id: 'd1', assignedSellerId: 's1' }),
        deal({ id: 'd2', assignedSellerId: 's1' }),
        deal({ id: 'd3', assignedSellerId: 's1' }),
        deal({ id: 'd4', assignedSellerId: 's1' }),
        deal({ id: 'd5', assignedSellerId: 's2' }),
        deal({ id: 'd6', assignedSellerId: 's2' }),
      ],
      SELLERS_BY_ID,
    );
    expect(rows).toEqual([
      { sellerId: 's1', sellerLabel: 'Lucas Martins', count: 4 },
      { sellerId: 's2', sellerLabel: 'Ana Souza', count: 2 },
    ]);
  });
});

describe('sorting — count DESC, tie-break sellerLabel ASC', () => {
  it('Tasks: mesmo count ordena por label', () => {
    const rows = groupLateTasksBySeller(
      [task({ id: 't1', assignedTo: 's2' }), task({ id: 't2', assignedTo: 's1' })],
      SELLERS_BY_ID,
    );
    expect(rows.map((r) => r.sellerId)).toEqual(['s2', 's1']); // Ana < Lucas
  });

  it('Deals: mesmo count ordena por label', () => {
    const rows = groupOpenDealsBySeller(
      [deal({ id: 'd1', assignedSellerId: 's2' }), deal({ id: 'd2', assignedSellerId: 's1' })],
      SELLERS_BY_ID,
    );
    expect(rows.map((r) => r.sellerId)).toEqual(['s2', 's1']);
  });

  it('count DESC tem prioridade sobre o label', () => {
    const rows = groupLateTasksBySeller(
      [task({ id: 't1', assignedTo: 's2' }), task({ id: 't2', assignedTo: 's1' }), task({ id: 't3', assignedTo: 's1' })],
      SELLERS_BY_ID,
    );
    expect(rows.map((r) => r.sellerId)).toEqual(['s1', 's2']); // 2 > 1, apesar de Ana < Lucas
  });

  it('sem score combinado: Tasks e Deals ordenam de forma totalmente independente', () => {
    const taskRows = groupLateTasksBySeller([task({ id: 't1', assignedTo: 's2' })], SELLERS_BY_ID);
    const dealRows = groupOpenDealsBySeller(
      [deal({ id: 'd1', assignedSellerId: 's1' }), deal({ id: 'd2', assignedSellerId: 's1' })],
      SELLERS_BY_ID,
    );
    expect(taskRows.map((r) => r.sellerId)).toEqual(['s2']);
    expect(dealRows.map((r) => r.sellerId)).toEqual(['s1']);
  });
});

describe('Vendedor indisponível — sellerId não resolvido nunca some', () => {
  it('Task com assignedTo null: bucket único "Vendedor indisponível"', () => {
    const rows = groupLateTasksBySeller(
      [task({ id: 't1', assignedTo: null }), task({ id: 't2', assignedTo: null })],
      SELLERS_BY_ID,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].sellerLabel).toBe(SELLER_ATTENTION_UNAVAILABLE_LABEL);
    expect(rows[0].count).toBe(2);
  });

  it('Deal com assignedSellerId fora do catálogo (Seller antigo/inativo): contagem preservada', () => {
    const rows = groupOpenDealsBySeller(
      [deal({ id: 'd1', assignedSellerId: 's-old-inactive' })],
      SELLERS_BY_ID,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].sellerLabel).toBe(SELLER_ATTENTION_UNAVAILABLE_LABEL);
    expect(rows[0].count).toBe(1);
  });

  it('IDs desconhecidos diferentes viram UM único bucket agregado, nunca linhas separadas', () => {
    const rows = groupOpenDealsBySeller(
      [deal({ id: 'd1', assignedSellerId: 'ghost-1' }), deal({ id: 'd2', assignedSellerId: 'ghost-2' })],
      SELLERS_BY_ID,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(2);
  });

  it('bucket indisponível participa do mesmo sort determinístico (count DESC, label ASC) — nenhuma regra especial', () => {
    const rows = groupLateTasksBySeller(
      [task({ id: 't1', assignedTo: null }), task({ id: 't2', assignedTo: 's1' })],
      SELLERS_BY_ID,
    );
    // Empate 1x1: "Lucas Martins" < "Vendedor indisponível" alfabeticamente.
    expect(rows.map((r) => r.sellerLabel)).toEqual(['Lucas Martins', SELLER_ATTENTION_UNAVAILABLE_LABEL]);
  });
});

describe('zero-noise — Sellers sem item no array recebido nunca aparecem', () => {
  it('Seller conhecido sem nenhuma Task no array: ausente do resultado', () => {
    const rows = groupLateTasksBySeller([task({ id: 't1', assignedTo: 's1' })], SELLERS_BY_ID);
    expect(rows.find((r) => r.sellerId === 's2')).toBeUndefined();
  });

  it('array vazio produz resultado vazio (nunca lista o catálogo inteiro)', () => {
    expect(groupLateTasksBySeller([], SELLERS_BY_ID)).toEqual([]);
    expect(groupOpenDealsBySeller([], SELLERS_BY_ID)).toEqual([]);
  });
});
