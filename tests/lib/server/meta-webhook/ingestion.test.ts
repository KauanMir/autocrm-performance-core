// Decisão de ingestão de um change leadgen (META-MVP2 multiempresa). Sem banco
// real: deps injetadas. A empresa vem SÓ da conexão da Page no banco.
import { describe, expect, it, vi } from 'vitest';

import {
  ingestLeadgenChange,
  resolveIngestionOwner,
  type LeadgenIngestionDeps,
  type OwnerRow,
} from '@/lib/server/meta-webhook/ingestion';
import type { LeadgenChangeMeta } from '@/lib/server/meta-webhook/events';

const PAGE_A = '960000000000001';
const PAGE_B = '960000000000002';
const COMPANY_A = '11111111-0000-4000-8000-00000000000a';
const COMPANY_B = '11111111-0000-4000-8000-00000000000b';
const INTEGRATION_A = '22222222-0000-4000-8000-00000000000a';
const INTEGRATION_B = '22222222-0000-4000-8000-00000000000b';

const change = (overrides: Partial<LeadgenChangeMeta> = {}): LeadgenChangeMeta =>
  ({ pageId: PAGE_A, leadgenId: '9990001112223334', formId: '7778889990001112', ...overrides }) as LeadgenChangeMeta;

const row = (over: Partial<OwnerRow> = {}): OwnerRow => ({
  integration_id: INTEGRATION_A,
  company_id: COMPANY_A,
  page_id: PAGE_A,
  status: 'connected',
  lead_ads_enabled: true,
  ...over,
});

function deps(rows: OwnerRow[] | Error | { error: true } = [row()], held: { ok: boolean } = { ok: true }) {
  const register = vi.fn(async () => ({ ok: true as const, value: { eventId: 'e1', status: 'received', created: true } }));
  const recordUnrouted = vi.fn(async () => held);
  const ownerByPage = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    if (!Array.isArray(rows)) return { data: null, error: { code: 'XX' } };
    return { data: rows, error: null };
  });
  return { ownerByPage, register, recordUnrouted } as LeadgenIngestionDeps & {
    ownerByPage: typeof ownerByPage;
    register: typeof register;
    recordUnrouted: typeof recordUnrouted;
  };
}

describe('ingestLeadgenChange — multiempresa', () => {
  it('change sem page/leadgen → skipped_unusable, zero banco', async () => {
    const d = deps();
    expect(await ingestLeadgenChange(change({ pageId: undefined }), d)).toBe('skipped_unusable');
    expect(await ingestLeadgenChange(change({ leadgenId: undefined }), d)).toBe('skipped_unusable');
    expect(d.ownerByPage).not.toHaveBeenCalled();
  });

  it('Página de qualquer empresa habilitada é registrada para ESSA empresa (sem Página fixa)', async () => {
    const d = deps([row({ integration_id: INTEGRATION_B, company_id: COMPANY_B, page_id: PAGE_B })]);
    const onRegistered = vi.fn();
    expect(await ingestLeadgenChange(change({ pageId: PAGE_B }), d, { onRegistered })).toBe('registered');
    expect(d.register).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: INTEGRATION_B, companyId: COMPANY_B, pageId: PAGE_B, formId: '7778889990001112',
    }));
    expect(onRegistered).toHaveBeenCalledWith('e1');
  });

  it('empresa desabilitada (padrão) → skipped_company_disabled, nada registrado', async () => {
    for (const enabled of [false, null, undefined]) {
      const d = deps([row({ lead_ads_enabled: enabled as boolean | null | undefined })]);
      expect(await ingestLeadgenChange(change(), d)).toBe('skipped_company_disabled');
      expect(d.register).not.toHaveBeenCalled();
    }
  });

  it('Página sem conexão → skipped_no_connection', async () => {
    const d = deps([]);
    expect(await ingestLeadgenChange(change(), d)).toBe('skipped_no_connection');
    expect(d.register).not.toHaveBeenCalled();
  });

  it('conexão em erro (sem connected) ainda registra: o lead espera a reconexão', async () => {
    const d = deps([row({ status: 'error' })]);
    expect(await ingestLeadgenChange(change(), d)).toBe('registered');
  });

  it('a empresa nunca vem do payload: linha de outra Página é ignorada', async () => {
    const d = deps([row({ page_id: PAGE_B, company_id: COMPANY_B })]);
    expect(await ingestLeadgenChange(change(), d)).toBe('skipped_no_connection');
    expect(d.register).not.toHaveBeenCalled();
  });

  it('falha de banco no lookup ou no register → infra_failure (webhook responde 503)', async () => {
    expect(await ingestLeadgenChange(change(), deps(new Error('down')))).toBe('infra_failure');
    expect(await ingestLeadgenChange(change(), deps({ error: true }))).toBe('infra_failure');
    const d = deps();
    d.register.mockResolvedValueOnce({ ok: false } as never);
    expect(await ingestLeadgenChange(change(), d)).toBe('infra_failure');
  });

  it('entrega repetida → already_exists', async () => {
    const d = deps();
    d.register.mockResolvedValueOnce({ ok: true, value: { eventId: 'e1', status: 'processed', created: false } });
    expect(await ingestLeadgenChange(change(), d)).toBe('already_exists');
  });
});

describe('resolveIngestionOwner', () => {
  it('connected tem precedência sobre error (Página mudou de empresa: vale a conexão ativa)', () => {
    const rows = [row({ status: 'error', company_id: COMPANY_B, integration_id: INTEGRATION_B }), row()];
    expect(resolveIngestionOwner(PAGE_A, rows)).toEqual(rows[1]);
  });

  it('duas connected ou duas error sem connected → ambiguous (nunca escolhe uma empresa)', () => {
    expect(resolveIngestionOwner(PAGE_A, [row(), row({ company_id: COMPANY_B })])).toBe('ambiguous');
    expect(resolveIngestionOwner(PAGE_A, [row({ status: 'error' }), row({ status: 'error', company_id: COMPANY_B })])).toBe('ambiguous');
  });

  it('status desconectado não conta', () => {
    expect(resolveIngestionOwner(PAGE_A, [row({ status: 'disconnected' })])).toBe('none');
  });
});

describe('META-MVP2 — evento sem dono fica retido, nunca descartado', () => {
  const held = (d: ReturnType<typeof deps>) => (d.recordUnrouted.mock.calls[0] as unknown as [Record<string, unknown>])[0];

  it('Página sem conexão → retido como no_connection, sem empresa', async () => {
    const d = deps([]);
    expect(await ingestLeadgenChange(change(), d)).toBe('skipped_no_connection');
    expect(held(d)).toMatchObject({ pageId: PAGE_A, leadgenId: '9990001112223334', formId: '7778889990001112', reason: 'no_connection' });
    expect(held(d)).not.toHaveProperty('companyId');
    expect(d.register).not.toHaveBeenCalled();
  });

  it('empresa desabilitada → retido como company_disabled, sem empresa e sem processar', async () => {
    const d = deps([row({ lead_ads_enabled: false })]);
    const onRegistered = vi.fn();
    expect(await ingestLeadgenChange(change(), d, { onRegistered })).toBe('skipped_company_disabled');
    expect(held(d)).toMatchObject({ reason: 'company_disabled' });
    expect(held(d)).not.toHaveProperty('companyId');
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it('habilitação ausente na resposta → retido (fail closed)', async () => {
    const d = deps([row({ lead_ads_enabled: undefined })]);
    expect(await ingestLeadgenChange(change(), d)).toBe('skipped_company_disabled');
    expect(d.register).not.toHaveBeenCalled();
  });

  it('posse ambígua → retido, nunca escolhe uma empresa', async () => {
    const d = deps([row({ status: 'error' }), row({ status: 'error', company_id: COMPANY_B, integration_id: INTEGRATION_B })]);
    expect(await ingestLeadgenChange(change(), d)).toBe('skipped_ambiguous_owner');
    expect(held(d)).toMatchObject({ reason: 'ambiguous_owner' });
    expect(d.register).not.toHaveBeenCalled();
  });

  it('falha ao reter → infra_failure: a Meta reentrega (503), nada se perde', async () => {
    expect(await ingestLeadgenChange(change(), deps([], { ok: false }))).toBe('infra_failure');
    expect(await ingestLeadgenChange(change(), deps([row({ lead_ads_enabled: false })], { ok: false }))).toBe('infra_failure');
  });

  it('evento registrado para a empresa não passa pela retenção', async () => {
    const d = deps();
    expect(await ingestLeadgenChange(change(), d)).toBe('registered');
    expect(d.recordUnrouted).not.toHaveBeenCalled();
  });

  it('change inutilizável não é retido: não há o que recuperar', async () => {
    const d = deps([]);
    expect(await ingestLeadgenChange(change({ leadgenId: undefined }), d)).toBe('skipped_unusable');
    expect(d.recordUnrouted).not.toHaveBeenCalled();
  });
});

describe('META-MVP2 — metadados do evento', () => {
  it('envia formId null quando o webhook não traz form_id, no registro e na retenção', async () => {
    const registered = deps();
    await ingestLeadgenChange(change({ formId: undefined }), registered);
    expect((registered.register.mock.calls[0] as unknown as [{ formId: unknown }])[0].formId).toBeNull();
    const held = deps([]);
    await ingestLeadgenChange(change({ formId: undefined }), held);
    expect((held.recordUnrouted.mock.calls[0] as unknown as [{ formId: unknown }])[0].formId).toBeNull();
  });
});
