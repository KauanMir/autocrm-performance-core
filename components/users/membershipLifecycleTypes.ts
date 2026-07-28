// components/users/membershipLifecycleTypes.ts — tipo estrutural comum aos
// modais de ciclo de vida empresarial (M1-F S6-F). CompanyUserRow (S5-D) e
// InactiveCompanyUserRow (S6-E) satisfazem este shape estruturalmente — os
// modais nunca importam um ou outro diretamente, para funcionar em ambas as
// listas (ativos e inativos) sem duplicar componente.
export type MembershipLifecycleTargetUser = {
  membership_id: string;
  profile_id: string;
  name: string;
  email: string;
  company_id: string;
  company_name: string;
  company_role: 'manager' | 'seller';
};
