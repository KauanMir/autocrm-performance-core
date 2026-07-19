// lib/pipeline/queryKeys.ts — query keys de pipeline_stages (M1-D, commit 5).
// A key é SEMPRE particionada por companyId (nunca global); ausência é
// normalizada para null para manter a key serializável e estável. userId fica
// fora da key de propósito — o cache é por empresa, não por usuário.

export const pipelineStageQueryKeys = {
  byCompany: (companyId: string | null | undefined) =>
    ['company', companyId ?? null, 'pipeline-stages'] as const,
};
