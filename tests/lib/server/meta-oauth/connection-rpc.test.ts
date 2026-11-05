// META-P4B — adaptador Supabase service_role da porta de persistência. O client
// admin é mockado; nenhuma conexão real.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { createMetaConnectionRpcPort } from '@/lib/server/meta-oauth/connection-rpc';

const ARGS = {
  p_company_id: '0a0a0a0a-0000-4000-8000-00000000c0de',
  p_page_id: '700000000000001',
  p_page_name: 'Pagina Fake',
  p_access_token_ciphertext: 'v1.fake-iv.fake-tag.fake-ct',
  p_token_key_version: 1,
  p_granted_scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval'],
  p_connected_at: '2026-10-05T12:00:00.000Z',
  p_connected_by: 'f7000000-0000-4000-8000-000000000001',
  p_leadgen_subscribed_at: '2026-10-05T12:00:01.000Z',
  p_token_origin: 'exchanged_long_lived' as const,
  p_token_expires_at: null,
  p_token_data_access_expires_at: '2027-01-05T12:00:00.000Z',
  p_token_checked_at: '2026-10-05T12:00:01.000Z',
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.createAdminClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
});

describe('createMetaConnectionRpcPort — upsert', () => {
  it('META-MVP1: chama meta_connection_upsert_v2 com os argumentos recebidos (null de validade vira ausente)', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'x' }], error: null });
    const port = createMetaConnectionRpcPort();
    await port.upsert(ARGS);
    expect(mocks.rpc).toHaveBeenCalledWith('meta_connection_upsert_v2', { ...ARGS, p_token_expires_at: undefined });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).not.toContain('meta_connection_upsert');
  });

  it('devolve data e error reduzidos a código e mensagem internos', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'page_already_connected', details: 'x', hint: 'y' } });
    const port = createMetaConnectionRpcPort();
    const result = await port.upsert(ARGS);
    expect(result).toEqual({ data: null, error: { code: 'P0001', message: 'page_already_connected' } });
    expect(JSON.stringify(result)).not.toContain('"details"');
  });

  it('erro de transporte do client propaga como exceção (a camada de serviço faz o retry)', async () => {
    mocks.rpc.mockRejectedValue(new TypeError('fetch failed'));
    const port = createMetaConnectionRpcPort();
    await expect(port.upsert(ARGS)).rejects.toThrow('fetch failed');
  });
});

describe('createMetaConnectionRpcPort — owner by page', () => {
  it('chama meta_connection_owner_by_page com p_page_id (sem ciphertext)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const port = createMetaConnectionRpcPort();
    const result = await port.ownerByPage('700000000000001');
    expect(mocks.rpc).toHaveBeenCalledWith('meta_connection_owner_by_page', { p_page_id: '700000000000001' });
    expect(result).toEqual({ data: [], error: null });
  });

  it('nunca chama a RPC de lookup com ciphertext', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const port = createMetaConnectionRpcPort();
    await port.ownerByPage('700000000000001');
    expect(mocks.rpc.mock.calls.map((c) => c[0])).not.toContain('meta_connection_lookup_by_page');
  });
});

describe('createMetaConnectionRpcPort — owner for ingestion (META-MVP1)', () => {
  it('chama meta_connection_owner_for_ingestion (connected OU error) com p_page_id', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const port = createMetaConnectionRpcPort();
    await port.ownerForIngestion('700000000000001');
    expect(mocks.rpc).toHaveBeenCalledWith('meta_connection_owner_for_ingestion', { p_page_id: '700000000000001' });
  });
});

describe('createMetaConnectionRpcPort — reutiliza o client service_role do repo', () => {
  it('usa createAdminClient (nenhuma inicialização Supabase própria)', () => {
    createMetaConnectionRpcPort();
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
  });
});
