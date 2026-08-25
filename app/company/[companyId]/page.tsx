// app/company/[companyId]/page.tsx — SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC.
// Única rota nova deste lote (§4/§7/§33 do EXEC): renderiza a MESMA árvore
// operacional (<App/>), só injetando qual empresa está explicitamente aberta
// via URL — nenhuma segunda Home, nenhuma tela duplicada. A autorização real
// (can_access_company/companies_select_accessible) acontece dentro de
// OperationalCompanyContext -> useActiveCompanyIdentity, nunca aqui: esta
// rota nunca confia no companyId da URL como autorização, só o repassa.
import { App } from '@/components/App';
import { AppProviders } from '@/components/providers/AppProviders';

export default function CompanyOperationPage({ params }: { params: { companyId: string } }) {
  return (
    <AppProviders>
      <App operationalCompanyId={params.companyId} />
    </AppProviders>
  );
}
