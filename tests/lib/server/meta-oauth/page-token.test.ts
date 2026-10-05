// META-P4A — fetchPageAccessToken devolve pageId e pageName além do token.
// Tokens fake; sem rede (fetchImpl injetado).
import { describe, expect, it } from 'vitest';
import { fetchPageAccessToken } from '@/lib/server/meta-oauth/page-token';

const FAKE_SUAT = 'FAKE-SUAT-page-token-test-only';
const TARGET = '700000000000001';
const FAKE_PAGE_TOKEN = 'FAKE-PAGE-TOKEN-page-token-test-only';

function accountsFetch(data: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

describe('fetchPageAccessToken — pageName e pageId', () => {
  it('Page encontrada: devolve pageId, pageName, token e tasks', async () => {
    const result = await fetchPageAccessToken({
      accessToken: FAKE_SUAT,
      targetPageId: TARGET,
      graphApiVersion: 'v26.0',
      fetchImpl: accountsFetch([
        { id: TARGET, name: 'Pagina Teste Fake', access_token: FAKE_PAGE_TOKEN, tasks: ['ADVERTISE'] },
      ]),
    });
    expect(result).toEqual({
      ok: true,
      found: true,
      httpStatus: 200,
      pageId: TARGET,
      pageName: 'Pagina Teste Fake',
      pageAccessToken: FAKE_PAGE_TOKEN,
      tasks: ['ADVERTISE'],
    });
  });

  it('name ausente na resposta -> pageName vazio (o caller decide), sem quebrar', async () => {
    const result = await fetchPageAccessToken({
      accessToken: FAKE_SUAT,
      targetPageId: TARGET,
      graphApiVersion: 'v26.0',
      fetchImpl: accountsFetch([{ id: TARGET, access_token: FAKE_PAGE_TOKEN, tasks: [] }]),
    });
    expect(result.ok && result.found && result.pageName).toBe('');
  });

  it('Page ausente: found=false, sem pageName nem token', async () => {
    const result = await fetchPageAccessToken({
      accessToken: FAKE_SUAT,
      targetPageId: TARGET,
      graphApiVersion: 'v26.0',
      fetchImpl: accountsFetch([{ id: '999', name: 'Outra', access_token: 'x', tasks: [] }]),
    });
    expect(result).toEqual({ ok: true, found: false, httpStatus: 200 });
  });
});
