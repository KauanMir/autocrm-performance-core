// app/company/[companyId]/page.tsx — SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC.
// Única rota nova deste lote (§4/§7/§33 do EXEC): renderiza a MESMA árvore
// operacional (<App/>), só injetando qual empresa está explicitamente aberta
// via URL — nenhuma segunda Home, nenhuma tela duplicada. A autorização real
// (can_access_company/companies_select_accessible) acontece dentro de
// OperationalCompanyContext -> useActiveCompanyIdentity, nunca aqui: esta
// rota nunca confia no companyId da URL como autorização, só o repassa.
import { App } from '@/components/App';
import { AppProviders } from '@/components/providers/AppProviders';

// META-OAUTH-REVIEW-UI: `meta_review` na querystring é o único marcador que
// esta rota reconhece — presente SÓ quando o callback OAuth Meta (ver
// app/api/integrations/meta/oauth/callback/route.ts) redirecionou de volta
// para cá após validar o `state.flow === "review_ui"` assinado. Não é um
// mecanismo genérico de deep link: nenhum outro valor de searchParams abre
// nenhuma outra tela. `initialScreen="ajustes"` é o único efeito — a
// verificação real do token (assinado, efêmero) acontece dentro da aba
// Integrações, nunca aqui.
export default function CompanyOperationPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const hasMetaReviewMarker = typeof searchParams?.meta_review === 'string' && searchParams.meta_review !== '';
  return (
    <AppProviders>
      <App operationalCompanyId={params.companyId} initialScreen={hasMetaReviewMarker ? 'ajustes' : undefined} />
    </AppProviders>
  );
}
