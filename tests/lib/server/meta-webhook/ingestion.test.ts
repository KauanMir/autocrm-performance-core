// Decisão de ingestão de um change leadgen. Sem banco real: deps injetadas.
import { describe, expect, it, vi } from 'vitest';

import { META_TEST_COMPANY_ID, META_TEST_PAGE_ID } from '@/lib/server/meta-oauth/config';
import { ingestLeadgenChange, type LeadgenIngestionDeps, type OwnerRow } from '@/lib/server/meta-webhook/ingestion';
import type { LeadgenChangeMeta } from '@/lib/server/meta-webhook/events';

const INTEGRATION_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_COMPANY_ID = '66666666-7777-4888-8999-000000000000';

const change = (overrides: Partial<LeadgenChangeMeta> = {}): LeadgenChangeMeta =>
  ({
    pageId: META_TEST_PAGE_ID,
    leadgenId: '9990001112223334',
    formId: '7778889990001112',
    ...overrides,
  }) as LeadgenChangeMeta;

const owner = (rows: Partial<OwnerRow>[] = [{}]): { data: OwnerRow[]; error: null } => ({
  data: rows.map((r) => ({
    integration_id: INTEGRATION_ID,
    company_id: META_TEST_COMPANY_ID,
    page_id: META_TEST_PAGE_ID,
    status: 'connected',
    ...r,
  })),
  error: null,
});

function deps(overrides: Partial<LeadgenIngestionDeps> = {}): LeadgenIngestionDeps & {
  ownerByPage: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
} {
  return {
    ownerByPage: vi.fn(async () => owner()),
    register: vi.fn(async () => ({
      ok: true as const,
      value: { eventId: 'e', status: 'received', created: true },
    })),
    ...overrides,
  } as LeadgenIngestionDeps & { ownerByPage: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> };
}

describe('ingestLeadgenChange', () => {
  it('change sem page/leadgen → skipped_unusable, zero banco', async () => {
    const d = deps();
    expect(await ingestLeadgenChange(change({ pageId: undefined }), d)).toBe('skipped_unusable');
    expect(await ingestLeadgenChange(change({ leadgenId: undefined }), d)).toBe('skipped_unusable');
    expect(d.ownerByPage).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
  });

  it('Page diferente da Page de teste → skipped_other_company, zero banco', async () => {
    const d = deps();
    expect(await ingestLeadgenChange(change({ pageId: '123' }), d)).toBe('skipped_other_company');
    expect(d.ownerByPage).not.toHaveBeenCalled();
    expect(d.register).not.toHaveBeenCalled();
  });

  it('sem conexão conectada → skipped_no_connection, sem register', async () => {
    const d = deps({ ownerByPage: vi.fn(async () => ({ data: [], error: null })) });
    expect(await ingestLeadgenChange(change(), d)).toBe('skipped_no_connection');
    expect(d.register).not.toHaveBeenCalled();
  });

  it('dono de outra company ou status não conectado → skipped_other_company, sem register', async () => {
    const otherCompany = deps({ ownerByPage: vi.fn(async () => owner([{ company_id: OTHER_COMPANY_ID }])) });
    expect(await ingestLeadgenChange(change(), otherCompany)).toBe('skipped_other_company');
    const disconnected = deps({ ownerByPage: vi.fn(async () => owner([{ status: 'disconnected' }])) });
    expect(await ingestLeadgenChange(change(), disconnected)).toBe('skipped_other_company');
    expect(otherCompany.register).not.toHaveBeenCalled();
    expect(disconnected.register).not.toHaveBeenCalled();
  });

  it('erro na consulta de dono (throw ou error) → infra_failure', async () => {
    const thrown = deps({
      ownerByPage: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await ingestLeadgenChange(change(), thrown)).toBe('infra_failure');
    const errored = deps({ ownerByPage: vi.fn(async () => ({ data: null, error: { code: 'x' } })) });
    expect(await ingestLeadgenChange(change(), errored)).toBe('infra_failure');
    expect(errored.register).not.toHaveBeenCalled();
  });

  it('register com falha → infra_failure', async () => {
    const d = deps({ register: vi.fn(async () => ({ ok: false as const, code: 'register_failed' as const })) });
    expect(await ingestLeadgenChange(change(), d)).toBe('infra_failure');
  });

  it('primeira entrega → registered; repetições → already_exists', async () => {
    const d = deps({
      register: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: { eventId: 'e', status: 'received', created: true } })
        .mockResolvedValue({ ok: true, value: { eventId: 'e', status: 'received', created: false } }),
    });
    expect(await ingestLeadgenChange(change(), d)).toBe('registered');
    for (let i = 0; i < 19; i += 1) {
      expect(await ingestLeadgenChange(change(), d)).toBe('already_exists');
    }
    expect(d.register).toHaveBeenCalledTimes(20);
  });

  it('envia formId null quando o webhook não traz form_id', async () => {
    const d = deps();
    await ingestLeadgenChange(change({ formId: undefined }), d);
    expect(d.register).toHaveBeenCalledWith(expect.objectContaining({ formId: null, leadgenId: '9990001112223334' }));
  });
});
