// lib/followupTemplates/queryKeys.ts — query keys de Follow-up Templates
// (FOLLOW-UP-TEMPLATES-A3-EXEC). Mesmo padrão de lib/tasks/taskQueryKeys.ts:
// partição SEMPRE por companyId (só partição de cache, nunca prova de
// autorização — RLS/RPC decidem). Três namespaces SEPARADOS de propósito
// (precheck A3-EXEC §4):
//   - active: Lead > Follow-up (Manager/Seller, só templates ativos).
//   - management: Ajustes > Follow-ups (Manager, ativos+inativos via RLS).
//   - platform: Ajustes > Follow-ups para Super Admin contextual (RPC
//     list_platform_followup_templates_for_company — fonte/autoridade
//     diferente de management, nunca deve colidir/reaproveitar o mesmo
//     cache, mesmo raciocínio de taskQueryKeys.platform).

function requireCompanyId(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('followUpTemplateQueryKeys: companyId é obrigatório e não pode ser vazio');
  }
  return value;
}

export const followUpTemplateQueryKeys = {
  active: (companyId: string) => ['company', requireCompanyId(companyId), 'followup-templates', 'active'] as const,
  management: (companyId: string) => ['company', requireCompanyId(companyId), 'followup-templates', 'management'] as const,
  platform: (companyId: string) => ['company', requireCompanyId(companyId), 'followup-templates', 'platform'] as const,
};
