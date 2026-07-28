// lib/hooks/useCompanyScopeFilter.ts — estado compartilhado do filtro
// contextual de empresa (M1-F S7-B, decisões congeladas em §26 do design
// doc). Existe para a aba de Usuários do Super Admin poder, futuramente
// (S7-C), oferecer UM único seletor compartilhado entre ActiveUserList/
// InactiveUserList/InviteList (se compatível) em vez de cada lista manter
// seu próprio `companyFilter` local isolado — sem, ainda, criar nenhuma
// interface visual (§26.2/§26.9).
//
// `companyFilterId` é EXCLUSIVAMENTE um filtro visual — nunca autorização,
// nunca activeMembership, nunca sessão, nunca platform_role (§26.3). A
// única fonte de empresas é `useCompanies`/`fetchAccessibleCompanies`
// (RLS já auditada), usada aqui só para VALIDAR que a seleção atual
// continua existindo — nunca para decidir o que o servidor aceita.
//
// Nomenclatura deliberada (§26.3): `companyFilterId`, nunca `activeCompany`/
// `currentCompany`/`activeTenant`/`selectedMembership` — esses nomes
// carregam semântica de identidade/sessão que este estado não tem.
import { useEffect, useState } from 'react';
import { useCompanies } from '@/lib/hooks/useCompanies';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

export type UseCompanyScopeFilterOptions = {
  userId?: string | null;
  // Mesmo tipo já usado por ActiveUserList/InactiveUserList/InviteList —
  // null quando o ator ainda não foi resolvido ou não tem capability
  // nenhuma sobre a tela de Usuários.
  actor: CreateInviteActor | null;
};

export type UseCompanyScopeFilterResult = {
  // null = visão global ("Todas as empresas"); uuid = empresa
  // visualmente focada. SEMPRE null para Manager/Seller, independente do
  // estado interno (defesa em profundidade — nunca decide autorização).
  companyFilterId: string | null;
  // Não-op para Manager/Seller — nunca decide autorização, só evita que um
  // estado indevido escape para um ator que não deveria tê-lo.
  setCompanyFilterId: (id: string | null) => void;
  isSuperAdmin: boolean;
  // Exposto para o futuro seletor visual (S7-C) reaproveitar a MESMA
  // chamada de useCompanies já feita aqui — nunca duplicar a query.
  companies: readonly PlatformCompanyRow[];
  companiesLoading: boolean;
};

export function useCompanyScopeFilter(options: UseCompanyScopeFilterOptions): UseCompanyScopeFilterResult {
  const { userId, actor } = options;
  const isSuperAdmin = actor?.kind === 'super_admin';

  const [companyFilterId, setCompanyFilterIdState] = useState<string | null>(null);

  // Fonte segura e única das empresas acessíveis — nunca autoriza nada (a
  // RLS já decide o que volta); usada aqui só para validar a seleção atual.
  const companiesQuery = useCompanies({ userId, authorized: isSuperAdmin });

  // Troca de identidade (login/logout/troca de usuário) ou de tipo de ator
  // (Super Admin <-> Manager, inclusive mudança de platform_role) nunca
  // herda a seleção anterior — mesmo padrão já testado em
  // ActiveUserList/InactiveUserList (§26.5).
  useEffect(() => {
    setCompanyFilterIdState(null);
  }, [userId, actor?.kind]);

  // Empresa selecionada que deixou de existir na lista acessível (removida,
  // cancelada, ou qualquer outro motivo pelo qual a RLS parou de devolvê-la)
  // nunca permanece selecionada — volta silenciosamente para a visão
  // global assim que a lista carrega (§26.5/§26.7). Nunca dispara por um
  // re-render comum: só quando a lista real muda e de fato não contém mais
  // o id selecionado.
  useEffect(() => {
    if (!isSuperAdmin) return;
    if (companyFilterId === null) return;
    if (companiesQuery.isLoading) return;
    const stillAccessible = companiesQuery.companies.some((c) => c.id === companyFilterId);
    if (!stillAccessible) setCompanyFilterIdState(null);
  }, [isSuperAdmin, companyFilterId, companiesQuery.isLoading, companiesQuery.companies]);

  const setCompanyFilterId = (id: string | null) => {
    if (!isSuperAdmin) return;
    setCompanyFilterIdState(id);
  };

  return {
    companyFilterId: isSuperAdmin ? companyFilterId : null,
    setCompanyFilterId,
    isSuperAdmin,
    companies: companiesQuery.companies,
    companiesLoading: companiesQuery.isLoading,
  };
}
