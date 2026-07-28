// lib/commercial/queryKeys.ts — query keys da leitura comercial do Super
// Admin (M1-F S8-C2-B2). Isolamento obrigatório (decisão humana do S8-C2-B2,
// achado da divergência de arquitetura): NUNCA compartilhar cache com o
// caminho RLS de Manager/Seller (leadQueryKeys/pipelineStageQueryKeys) — o
// segmento 'platform' garante que a mesma empresa nunca colide entre os dois
// caminhos, mesmo que ambos leiam a mesma company_id.
//
// companyId/leadId são obrigatórios e não vazios — mesmo contrato de
// leadQueryKeys (falha alto em vez de particionar em key inválida).

function requireId(value: string, label: 'companyId' | 'leadId' | 'userId'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`platformCommercialQueryKeys: ${label} é obrigatório e não pode ser vazio`);
  }
  return value;
}

export const platformCommercialQueryKeys = {
  // Lista global de empresas comerciais (inclui 'cancelada') — partição por
  // userId (identidade do Super Admin), nunca por empresa (não há empresa
  // alvo nesta listagem). Raiz própria ('platform-commercial'), nunca
  // 'platform-admin' (que é fetchAccessibleCompanies/useCompanies, exclui
  // cancelada e serve a tela ScreenEmpresas — dataset diferente).
  companies: (userId: string) =>
    ['platform-commercial', requireId(userId, 'userId'), 'companies'] as const,

  leadsRoot: (companyId: string) =>
    ['company', requireId(companyId, 'companyId'), 'leads', 'platform'] as const,

  leadsActive: (companyId: string) =>
    [...platformCommercialQueryKeys.leadsRoot(companyId), 'active'] as const,

  leadsArchived: (companyId: string) =>
    [...platformCommercialQueryKeys.leadsRoot(companyId), 'archived'] as const,

  leadTimeline: (companyId: string, leadId: string) =>
    [...platformCommercialQueryKeys.leadsRoot(companyId), 'timeline', requireId(leadId, 'leadId')] as const,

  stages: (companyId: string) =>
    ['company', requireId(companyId, 'companyId'), 'pipeline-stages', 'platform'] as const,
};
