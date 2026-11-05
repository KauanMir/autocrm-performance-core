// META-MVP1 — tentativa imediata + sweep oportunístico. Processor e sweep
// mockados; nada de rede ou banco.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  sweep: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/server/meta-webhook/process-leadgen-event', () => ({
  processMetaLeadgenEvent: mocks.process,
  createMetaLeadgenProcessorDeps: () => ({ fake: true }),
}));
vi.mock('@/lib/server/meta-webhook/sweep-leadgen-events', () => ({ sweepMetaLeadgenEvents: mocks.sweep }));

import {
  OPPORTUNISTIC_SWEEP_LIMIT,
  runLeadgenProcessingSafely,
  scheduleManualRequeueProcessing,
  scheduleMetaLeadgenProcessing,
} from '@/lib/server/meta-webhook/schedule-leadgen-processing';

beforeEach(() => {
  mocks.process.mockReset().mockResolvedValue({ outcome: 'created' });
  mocks.sweep.mockReset().mockResolvedValue({ attempted: 0 });
  mocks.waitUntil.mockReset();
});

describe('runLeadgenProcessingSafely', () => {
  it('processa o evento e depois faz sweep de até 5 vencidos com as mesmas deps', async () => {
    await runLeadgenProcessingSafely('e1', 'webhook');
    expect(mocks.process).toHaveBeenCalledWith('e1', { fake: true }, 'webhook');
    expect(mocks.sweep).toHaveBeenCalledWith({ limit: OPPORTUNISTIC_SWEEP_LIMIT, deps: { fake: true } });
    expect(OPPORTUNISTIC_SWEEP_LIMIT).toBe(5);
  });

  it('falha do processor não impede o sweep; nenhuma rejeição escapa', async () => {
    mocks.process.mockRejectedValue(new Error('secret'));
    await expect(runLeadgenProcessingSafely('e1', 'webhook')).resolves.toBeUndefined();
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
  });

  it('falha ao montar deps: não processa nem lança', async () => {
    await expect(runLeadgenProcessingSafely('e1', 'webhook', () => { throw new Error('env missing'); })).resolves.toBeUndefined();
    expect(mocks.process).not.toHaveBeenCalled();
  });
});

describe('agendadores', () => {
  it('webhook e reprocessamento manual usam waitUntil com o gatilho correto', async () => {
    scheduleMetaLeadgenProcessing('e1');
    scheduleManualRequeueProcessing('e2');
    expect(mocks.waitUntil).toHaveBeenCalledTimes(2);
    await Promise.all(mocks.waitUntil.mock.calls.map((c) => c[0]));
    expect(mocks.process.mock.calls.map((c) => [c[0], c[2]])).toEqual([['e1', 'webhook'], ['e2', 'manual_requeue']]);
  });
});
