// tests/capabilities.importLeads.test.ts — canImportLeads (CRM-BULK-IMPORT-B2).
// Arquivo próprio (não tests/capabilities.test.ts) de propósito — evita
// tocar um arquivo com erros de baseline TS pré-existentes não relacionados
// a esta etapa.
import { describe, expect, it } from 'vitest';
import { canImportLeads } from '@/lib/capabilities';

const superAdmin = { platformRole: 'super_admin', activeMembership: null } as const;
const activeManager = { platformRole: null, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } } as const;
const activeSeller = { platformRole: null, activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null } } as const;
const noMembership = { platformRole: null, activeMembership: null } as const;

describe('canImportLeads — CRM-BULK-IMPORT-A2/B1/B2', () => {
  // Manager: SEM checagem de companyStatus aqui, de propósito — mesmo
  // contrato de resolveLeadMutationCapabilities.canCreate ("Novo Lead"),
  // que também nunca lê status ao vivo da empresa. bulk_import_leads
  // continua sendo a autoridade real contra empresa não-ativa (mesmo
  // comportamento que create_lead já tem hoje para "Novo Lead").
  it('Manager: true independente do companyStatus informado (irrelevante para este ramo)', () => {
    expect(canImportLeads({ actor: activeManager, companyStatus: 'ativa', superAdminWriteEnabled: false })).toBe(true);
    expect(canImportLeads({ actor: activeManager, companyStatus: 'implantacao', superAdminWriteEnabled: false })).toBe(true);
    expect(canImportLeads({ actor: activeManager, companyStatus: 'suspensa', superAdminWriteEnabled: false })).toBe(true);
    expect(canImportLeads({ actor: activeManager, companyStatus: null, superAdminWriteEnabled: false })).toBe(true);
  });

  it('Seller: sempre false, mesmo em empresa ativa (decisao de produto, nao limitacao tecnica)', () => {
    expect(canImportLeads({ actor: activeSeller, companyStatus: 'ativa', superAdminWriteEnabled: false })).toBe(false);
  });

  it('sem membership e sem platformRole: false', () => {
    expect(canImportLeads({ actor: noMembership, companyStatus: 'ativa', superAdminWriteEnabled: false })).toBe(false);
  });

  it('Super Admin contextual, flag de escrita ligada, empresa ativa: true', () => {
    expect(canImportLeads({ actor: superAdmin, companyStatus: 'ativa', superAdminWriteEnabled: true })).toBe(true);
  });
  it('Super Admin contextual, flag de escrita ligada, empresa em implantacao: true', () => {
    expect(canImportLeads({ actor: superAdmin, companyStatus: 'implantacao', superAdminWriteEnabled: true })).toBe(true);
  });
  it('Super Admin contextual, flag de escrita DESLIGADA: false mesmo com empresa ativa', () => {
    expect(canImportLeads({ actor: superAdmin, companyStatus: 'ativa', superAdminWriteEnabled: false })).toBe(false);
  });
  it('Super Admin, empresa suspensa: false mesmo com a flag ligada', () => {
    expect(canImportLeads({ actor: superAdmin, companyStatus: 'suspensa', superAdminWriteEnabled: true })).toBe(false);
  });
  it('Super Admin, empresa cancelada: false mesmo com a flag ligada', () => {
    expect(canImportLeads({ actor: superAdmin, companyStatus: 'cancelada', superAdminWriteEnabled: true })).toBe(false);
  });
  it('Super Admin GENÉRICO fora de contexto de empresa (companyStatus null): false, mesmo com a flag ligada', () => {
    expect(canImportLeads({ actor: superAdmin, companyStatus: null, superAdminWriteEnabled: true })).toBe(false);
  });
});
