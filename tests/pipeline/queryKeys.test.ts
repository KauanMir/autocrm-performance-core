// Testes das query keys de pipeline_stages (M1-D, commit 5).
import { describe, expect, it } from 'vitest';
import { pipelineStageQueryKeys } from '@/lib/pipeline/queryKeys';

describe('pipelineStageQueryKeys.byCompany', () => {
  it('company A gera ["company", "company-a", "pipeline-stages"]', () => {
    expect(pipelineStageQueryKeys.byCompany('company-a')).toEqual([
      'company', 'company-a', 'pipeline-stages',
    ]);
  });

  it('company B gera key diferente da de company A', () => {
    const a = pipelineStageQueryKeys.byCompany('company-a');
    const b = pipelineStageQueryKeys.byCompany('company-b');
    expect(a).not.toEqual(b);
    expect(b[1]).toBe('company-b');
  });

  it('null é preservado como null', () => {
    expect(pipelineStageQueryKeys.byCompany(null)).toEqual([
      'company', null, 'pipeline-stages',
    ]);
  });

  it('undefined é normalizado para null', () => {
    expect(pipelineStageQueryKeys.byCompany(undefined)).toEqual([
      'company', null, 'pipeline-stages',
    ]);
  });

  it('conteúdo é estável entre chamadas com o mesmo companyId', () => {
    expect(pipelineStageQueryKeys.byCompany('x')).toEqual(
      pipelineStageQueryKeys.byCompany('x'),
    );
  });
});
