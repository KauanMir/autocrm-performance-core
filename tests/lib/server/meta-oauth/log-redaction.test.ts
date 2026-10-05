// Guarda contra regressão: nenhum campo de log do fluxo Meta carrega o Page ID
// real. Verificação estática nos tipos de logger e nas chamadas de log.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8');

describe('redação de Page ID nos logs', () => {
  it('logger OAuth não declara testPageId', () => {
    expect(read('lib/server/meta-oauth/logger.ts')).not.toMatch(/testPageId\??:/);
  });

  it('logger do webhook não declara pageId', () => {
    expect(read('lib/server/meta-webhook/logger.ts')).not.toMatch(/\bpageId\??:/);
  });

  it('callback não passa testPageId em nenhum log', () => {
    expect(read('app/api/integrations/meta/oauth/callback/route.ts')).not.toMatch(/testPageId/);
  });

  it('webhook não registra IDs do evento leadgen nos logs (só booleanos)', () => {
    const source = read('app/api/webhooks/meta/route.ts');
    expect(source).not.toMatch(/pageId: change\.pageId/);
    expect(source).not.toMatch(/formId: change\.formId/);
    expect(source).not.toMatch(/leadgenId: change\.leadgenId/);
    expect(source).toMatch(/formPresent: change\.formId !== undefined/);
    expect(source).toMatch(/leadgenPresent: change\.leadgenId !== undefined/);
  });

  it('o Page ID continua sendo usado na lógica (Graph, ownership, persistência)', () => {
    const callback = read('app/api/integrations/meta/oauth/callback/route.ts');
    expect(callback).toMatch(/targetPageId: META_TEST_PAGE_ID/);
    expect(callback).toMatch(/findMetaConnectionOwnerByPage\(\{ rpc: persistencePort \}, META_TEST_PAGE_ID\)/);
    expect(callback).toMatch(/pageId: META_TEST_PAGE_ID,\s*pageName/);
  });
});
