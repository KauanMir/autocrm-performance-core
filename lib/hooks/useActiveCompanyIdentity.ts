// lib/hooks/useActiveCompanyIdentity.ts — COMPANY-IDENTITY-LOGO-R1-EXEC.
// Contrato de leitura reutilizável da identidade visual da empresa ativa
// (nome + logoPath + timezone) para o Rail/shell autenticado. Reaproveita
// fetchAccessibleCompanies (lib/companies/repository.ts) — MESMA leitura já
// usada por useCompanies/useCompanySettings/useCurrentCompanyTimezone;
// nenhum SELECT novo é escrito por este hook.
//
// Namespace de cache PRÓPRIO (companyId+userId, mesma partição de
// useCurrentCompanyTimezone) — deliberadamente separado do namespace de
// useCurrentCompanyTimezone (não reescrito por esta etapa: §23 do EXEC
// pede para não quebrá-lo, e ele já tem cobertura própria via Home/Pódio).
// useUpdateCompanyLogo invalida os dois explicitamente após sucesso.
//
// Manager/Seller: companyId = activeMembership.companyId (resolvido pelo
// chamador, nunca "descoberto" aqui). Super Admin sem membership nunca
// recebe uma empresa "ativa" implícita (§25 do EXEC — nenhuma
// primeira/última empresa, nenhum hardcode); o parâmetro companyId
// aceita um valor explícito para o futuro modo "Super Admin escolhe
// empresa", mas nenhuma UI desta etapa passa um.
import { useQuery } from '@tanstack/react-query';
import { isRemoteLeadsEnabled } from '@/lib/flags';
import { fetchAccessibleCompanies, type PlatformCompanyRow } from '@/lib/companies/repository';

export type ActiveCompanyIdentity = {
  id: string;
  name: string;
  logoPath: string | null;
  timezone: string;
};

export type ActiveCompanyIdentityState =
  | { status: 'local' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; company: ActiveCompanyIdentity };

export type UseActiveCompanyIdentityOptions = {
  userId: string | null;
  companyId: string | null;
  membershipRole: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

// Key sentinela usada SOMENTE quando a query está desabilitada — nunca
// colide com uma key real (mesmo padrão de useCurrentCompanyTimezone).
const DISABLED_QUERY_KEY = ['company', null, 'identity', 'remote', null] as const;

export function currentCompanyIdentityQueryKey(companyId: string, userId: string) {
  return ['company', companyId, 'identity', 'remote', userId] as const;
}

export function useActiveCompanyIdentity(options: UseActiveCompanyIdentityOptions): ActiveCompanyIdentityState {
  const { userId, companyId, membershipRole, userIsActive } = options;

  const remoteLeadsEnabled = isRemoteLeadsEnabled();
  const hasUser = typeof userId === 'string' && userId.trim() !== '';
  const hasCompany = typeof companyId === 'string' && companyId.trim() !== '';
  const isManagerOrSeller = membershipRole === 'manager' || membershipRole === 'seller';

  const queryEnabled = remoteLeadsEnabled && hasUser && hasCompany && userIsActive && isManagerOrSeller;
  const queryKey = hasCompany && hasUser
    ? currentCompanyIdentityQueryKey(companyId, userId)
    : DISABLED_QUERY_KEY;

  // Declarada SEMPRE (flag OFF, Super Admin ou sem membership ⇒
  // enabled=false, zero chamadas) — mesma garantia de useCurrentCompanyTimezone.
  const query = useQuery<PlatformCompanyRow[]>({
    queryKey,
    enabled: queryEnabled,
    queryFn: fetchAccessibleCompanies,
  });

  if (!remoteLeadsEnabled) return { status: 'local' };
  if (!queryEnabled) return { status: 'unavailable' };
  if (query.isLoading) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: query.refetch };

  const row = (query.data ?? []).find((c) => c.id === companyId);
  if (!row) return { status: 'unavailable' };

  return {
    status: 'ready',
    company: { id: row.id, name: row.name, logoPath: row.logo_path, timezone: row.timezone },
  };
}
