// Testes de lib/visits/visitScreenGrouping.ts (COMMERCIAL-REMOTE-VISITS-
// B3). Puro: nenhum mock, nenhum relógio real do runner — `now` e todo
// `scheduledAt` são construídos via componentes locais (ano, mês
// 0-indexado, dia, hora), nunca uma string ISO/UTC crua, garantindo o
// mesmo resultado independentemente do timezone da máquina que roda o
// teste (B3-EXEC §42).
import { describe, expect, it } from 'vitest';
import {
  groupVisitsForScreen,
  formatVisitTime,
  formatVisitShortDate,
  resolveVisitSellerDisplayName,
  VISIT_SELLER_UNAVAILABLE_DISPLAY_VALUE,
  startOfVisitLocalDay,
} from '@/lib/visits/visitScreenGrouping';
import type { RemoteVisitModel } from '@/lib/visits/adapter';

function visit(over: Partial<RemoteVisitModel> = {}): RemoteVisitModel {
  return {
    id: 'v1',
    clientName: 'Cliente',
    leadId: null,
    assignedSellerId: 's1',
    vehicles: ['Onix'],
    scheduledAt: new Date(2026, 7, 21, 12, 0, 0).toISOString(),
    status: 'scheduled',
    outcome: null,
    note: '',
    resultNote: null,
    version: 1,
    createdAt: new Date(2026, 7, 1, 0, 0, 0).toISOString(),
    ...over,
  };
}

const NOW = new Date(2026, 7, 21, 12, 0, 0); // 21/ago/2026 (sexta), 12:00 local
const iso = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min, 0).toISOString();

describe('groupVisitsForScreen', () => {
  it('futuro hoje (mesmo dia local, instante > now) → today', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 21, 18) });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.today).toEqual([v]);
    expect(groups.tomorrow).toEqual([]);
    expect(groups.future).toEqual([]);
    expect(groups.pendingResult).toEqual([]);
  });

  it('passado hoje (mesmo dia local, instante < now) → pendingResult, nunca today', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 21, 9) });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.pendingResult).toEqual([v]);
    expect(groups.today).toEqual([]);
  });

  it('amanhã → tomorrow', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 22, 9) });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.tomorrow).toEqual([v]);
  });

  it('depois de amanhã → future', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 24, 9) });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.future).toEqual([v]);
  });

  it('passado, dias atrás, status scheduled → pendingResult', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 15, 9) });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.pendingResult).toEqual([v]);
  });

  it('passado, status confirmed → pendingResult (mesma regra de scheduled)', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 20, 9), status: 'confirmed' });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.pendingResult).toEqual([v]);
  });

  it('status completed nunca entra em nenhum grupo, mesmo no passado', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 15, 9), status: 'completed', outcome: 'sold' });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.today).toEqual([]);
    expect(groups.tomorrow).toEqual([]);
    expect(groups.future).toEqual([]);
    expect(groups.pendingResult).toEqual([]);
  });

  it('status canceled nunca entra em nenhum grupo, mesmo no futuro', () => {
    const v = visit({ scheduledAt: iso(2026, 7, 24, 9), status: 'canceled' });
    const groups = groupVisitsForScreen([v], NOW);
    expect(groups.today).toEqual([]);
    expect(groups.tomorrow).toEqual([]);
    expect(groups.future).toEqual([]);
    expect(groups.pendingResult).toEqual([]);
  });

  it('fronteira de virada de mês: 31/ago 23:59 é "hoje" quando now=31/ago 12:00, e 01/set é "amanhã"', () => {
    const now = new Date(2026, 7, 31, 12, 0, 0);
    const today = visit({ id: 'today', scheduledAt: new Date(2026, 7, 31, 23, 59, 0).toISOString() });
    const tomorrow = visit({ id: 'tomorrow', scheduledAt: new Date(2026, 8, 1, 0, 30, 0).toISOString() });
    const groups = groupVisitsForScreen([today, tomorrow], now);
    expect(groups.today).toEqual([today]);
    expect(groups.tomorrow).toEqual([tomorrow]);
  });

  it('fronteira de virada de ano: 31/dez → today, 01/jan → tomorrow', () => {
    const now = new Date(2026, 11, 31, 8, 0, 0);
    const today = visit({ id: 'today', scheduledAt: new Date(2026, 11, 31, 20, 0, 0).toISOString() });
    const tomorrow = visit({ id: 'tomorrow', scheduledAt: new Date(2027, 0, 1, 9, 0, 0).toISOString() });
    const groups = groupVisitsForScreen([today, tomorrow], now);
    expect(groups.today).toEqual([today]);
    expect(groups.tomorrow).toEqual([tomorrow]);
  });

  it('lote misto: cada Visit cai em exatamente um grupo, ordem preservada dentro do grupo', () => {
    const a = visit({ id: 'a', scheduledAt: iso(2026, 7, 21, 8) }); // passado hoje
    const b = visit({ id: 'b', scheduledAt: iso(2026, 7, 21, 20) }); // hoje
    const c = visit({ id: 'c', scheduledAt: iso(2026, 7, 22, 8) }); // amanhã
    const d = visit({ id: 'd', scheduledAt: iso(2026, 7, 25, 8) }); // futuro
    const e = visit({ id: 'e', scheduledAt: iso(2026, 7, 21, 20), status: 'completed' }); // fora de todos
    const groups = groupVisitsForScreen([a, b, c, d, e], NOW);
    expect(groups.pendingResult).toEqual([a]);
    expect(groups.today).toEqual([b]);
    expect(groups.tomorrow).toEqual([c]);
    expect(groups.future).toEqual([d]);
  });

  it('lista vazia → todos os grupos vazios', () => {
    expect(groupVisitsForScreen([], NOW)).toEqual({ today: [], tomorrow: [], future: [], pendingResult: [] });
  });
});

describe('startOfVisitLocalDay', () => {
  it('zera horas/minutos/segundos/ms mantendo o dia local', () => {
    const d = startOfVisitLocalDay(new Date(2026, 7, 21, 23, 59, 59, 999));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(21);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('formatVisitTime', () => {
  it('formata HH:mm com zero à esquerda', () => {
    expect(formatVisitTime(new Date(2026, 7, 21, 9, 5, 0))).toBe('09:05');
    expect(formatVisitTime(new Date(2026, 7, 21, 18, 30, 0))).toBe('18:30');
  });
});

describe('formatVisitShortDate', () => {
  it('formata "Abrev, dd/mm" em PT-BR', () => {
    // 21/ago/2026 é sexta-feira.
    expect(formatVisitShortDate(new Date(2026, 7, 21, 9, 0, 0))).toBe('Sex, 21/08');
  });
});

describe('resolveVisitSellerDisplayName', () => {
  it('Seller resolvido: primeiro nome', () => {
    const sellersById = { s1: { id: 's1', name: 'Lucas Martins' } };
    expect(resolveVisitSellerDisplayName('s1', sellersById)).toBe('Lucas');
  });

  it('Seller resolvido com nome de uma palavra só: nome inteiro', () => {
    const sellersById = { s1: { id: 's1', name: 'Madonna' } };
    expect(resolveVisitSellerDisplayName('s1', sellersById)).toBe('Madonna');
  });

  it('Seller não resolvido: placeholder neutro inteiro, sem split', () => {
    expect(resolveVisitSellerDisplayName('s-desconhecido', {})).toBe(VISIT_SELLER_UNAVAILABLE_DISPLAY_VALUE);
  });
});
