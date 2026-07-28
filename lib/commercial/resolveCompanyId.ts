// lib/commercial/resolveCompanyId.ts — resolução PURA de qual empresa uma
// tela comercial (Clientes/Andamento) deve usar (M1-F S8-C2-B2). Corrige o
// achado do S8-C2-A1 (ScreensOps.tsx ainda lendo currentUser?.companyId, o
// campo legado de profiles.company_id): Super Admin usa exclusivamente
// selectedCompanyId (contexto comercial, nunca automático); Manager/Seller
// usam exclusivamente activeMembership.companyId (nunca o legado); qualquer
// outro caso (sem membership, sem seleção) é null. Nenhum fallback entre as
// três fontes é permitido — decisão humana explícita do S8-C2-B2.
export function resolveCommercialCompanyId(options: {
  isSuperAdmin: boolean;
  activeMembershipCompanyId: string | null;
  selectedCompanyId: string | null;
}): string | null {
  if (options.isSuperAdmin) return options.selectedCompanyId;
  return options.activeMembershipCompanyId;
}
