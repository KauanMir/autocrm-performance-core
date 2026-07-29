// Testes das query keys da leitura comercial do Super Admin (M1-F S8-C2-B2).
// Isolamento obrigatório em relação ao caminho RLS de Manager/Seller
// (leadQueryKeys/pipelineStageQueryKeys) — o segmento 'platform' garante que
// a mesma empresa nunca colide entre os dois caminhos.
import { describe, expect, it } from 'vitest';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';
import { leadQueryKeys } from '@/lib/leads/queryKeys';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';

describe('platformCommercialQueryKeys — estrutura exata', () => {
  it('companies: ["platform-commercial", userId, "companies"]', () => {
    expect(platformCommercialQueryKeys.companies('user-1')).toEqual([
      'platform-commercial', 'user-1', 'companies',
    ]);
  });

  it('leadsRoot: ["company", companyId, "leads", "platform"]', () => {
    expect(platformCommercialQueryKeys.leadsRoot('company-a')).toEqual([
      'company', 'company-a', 'leads', 'platform',
    ]);
  });

  it('leadsActive: [...leadsRoot, "active"]', () => {
    expect(platformCommercialQueryKeys.leadsActive('company-a')).toEqual([
      'company', 'company-a', 'leads', 'platform', 'active',
    ]);
  });

  it('leadsArchived: [...leadsRoot, "archived"]', () => {
    expect(platformCommercialQueryKeys.leadsArchived('company-a')).toEqual([
      'company', 'company-a', 'leads', 'platform', 'archived',
    ]);
  });

  it('leadTimeline: [...leadsRoot, "timeline", leadId]', () => {
    expect(platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1')).toEqual([
      'company', 'company-a', 'leads', 'platform', 'timeline', 'lead-1',
    ]);
  });

  it('stages: ["company", companyId, "pipeline-stages", "platform"]', () => {
    expect(platformCommercialQueryKeys.stages('company-a')).toEqual([
      'company', 'company-a', 'pipeline-stages', 'platform',
    ]);
  });

  it('sellers: ["company", companyId, "commercial-sellers", "platform"]', () => {
    expect(platformCommercialQueryKeys.sellers('company-a')).toEqual([
      'company', 'company-a', 'commercial-sellers', 'platform',
    ]);
  });
});

describe('platformCommercialQueryKeys — isolamento do caminho RLS de Manager/Seller', () => {
  it('leads: a raiz platform nunca colide com a raiz RLS da mesma empresa', () => {
    expect(platformCommercialQueryKeys.leadsRoot('company-a'))
      .not.toEqual(leadQueryKeys.root('company-a'));
    expect(platformCommercialQueryKeys.leadsActive('company-a'))
      .not.toEqual(leadQueryKeys.active('company-a'));
    expect(platformCommercialQueryKeys.leadsArchived('company-a'))
      .not.toEqual(leadQueryKeys.archived('company-a'));
  });

  it('timeline: platform nunca colide com a timeline RLS do mesmo lead', () => {
    expect(platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1'))
      .not.toEqual(leadQueryKeys.timeline('company-a', 'lead-1'));
  });

  it('stages: platform nunca colide com a key RLS da mesma empresa', () => {
    expect(platformCommercialQueryKeys.stages('company-a'))
      .not.toEqual(pipelineStageQueryKeys.byCompany('company-a'));
  });

  it('companies: raiz própria, nunca "platform-admin" (dataset de useCompanies, exclui cancelada)', () => {
    expect(platformCommercialQueryKeys.companies('user-1')[0]).toBe('platform-commercial');
  });

  it('sellers: raiz própria, nunca compartilhada com leadsRoot/stages da mesma empresa', () => {
    expect(platformCommercialQueryKeys.sellers('company-a'))
      .not.toEqual(platformCommercialQueryKeys.leadsRoot('company-a'));
    expect(platformCommercialQueryKeys.sellers('company-a'))
      .not.toEqual(platformCommercialQueryKeys.stages('company-a'));
  });
});

describe('platformCommercialQueryKeys — isolamento entre empresas/leads', () => {
  it('empresas diferentes nunca colidem', () => {
    expect(platformCommercialQueryKeys.leadsRoot('company-a'))
      .not.toEqual(platformCommercialQueryKeys.leadsRoot('company-b'));
    expect(platformCommercialQueryKeys.stages('company-a'))
      .not.toEqual(platformCommercialQueryKeys.stages('company-b'));
  });

  it('ativos e arquivados nunca compartilham a mesma key', () => {
    expect(platformCommercialQueryKeys.leadsActive('company-a'))
      .not.toEqual(platformCommercialQueryKeys.leadsArchived('company-a'));
  });

  it('leads diferentes na timeline geram keys diferentes', () => {
    expect(platformCommercialQueryKeys.leadTimeline('company-a', 'lead-1'))
      .not.toEqual(platformCommercialQueryKeys.leadTimeline('company-a', 'lead-2'));
  });

  it('usuários diferentes na listagem de empresas geram keys diferentes', () => {
    expect(platformCommercialQueryKeys.companies('user-a'))
      .not.toEqual(platformCommercialQueryKeys.companies('user-b'));
  });

  it('sellers: empresas diferentes nunca colidem', () => {
    expect(platformCommercialQueryKeys.sellers('company-a'))
      .not.toEqual(platformCommercialQueryKeys.sellers('company-b'));
  });
});

describe('platformCommercialQueryKeys — entradas inválidas', () => {
  it('companyId/userId/leadId vazio, em branco, null ou undefined ⇒ erro explícito', () => {
    for (const invalid of ['', '   ', null, undefined]) {
      expect(() => platformCommercialQueryKeys.companies(invalid as unknown as string)).toThrow(/userId/);
      expect(() => platformCommercialQueryKeys.leadsRoot(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => platformCommercialQueryKeys.leadsActive(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => platformCommercialQueryKeys.leadsArchived(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => platformCommercialQueryKeys.stages(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => platformCommercialQueryKeys.sellers(invalid as unknown as string)).toThrow(/companyId/);
      expect(() => platformCommercialQueryKeys.leadTimeline('company-a', invalid as unknown as string)).toThrow(/leadId/);
    }
  });
});
