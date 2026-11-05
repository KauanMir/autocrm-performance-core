// lib/hooks/useMetaLeadOps.ts — META-MVP1. React Query da operação Lead Ads.
// `authorized` é decidido pelo chamador (capability da tela); o banco revalida
// tudo pelo auth.uid().
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthService } from '@/lib/services';
import {
  deleteMetaFormMapping,
  dismissMetaLeadEvent,
  fetchLeadFormSubmissions,
  fetchMetaConnectionHealth,
  fetchMetaFormMappings,
  fetchMetaLeadReview,
  MetaLeadOpsError,
  requeueMetaLeadEventRequest,
  setMetaFormMapping,
  type DismissResolution,
  type MetaFormMapping,
} from '@/lib/integrations/metaLeadOps';

export const metaLeadOpsKeys = {
  all: (companyId: string) => ['company', companyId, 'metaLeadOps'] as const,
  health: (companyId: string) => ['company', companyId, 'metaLeadOps', 'health'] as const,
  review: (companyId: string) => ['company', companyId, 'metaLeadOps', 'review'] as const,
  mappings: (companyId: string) => ['company', companyId, 'metaLeadOps', 'mappings'] as const,
  submissions: (companyId: string | null, leadId: string) =>
    ['company', companyId ?? 'membership', 'leads', leadId, 'formSubmissions'] as const,
};

export function useMetaConnectionHealth(companyId: string, authorized: boolean) {
  return useQuery({
    queryKey: metaLeadOpsKeys.health(companyId),
    enabled: authorized,
    queryFn: () => fetchMetaConnectionHealth(companyId),
  });
}

export function useMetaLeadReview(companyId: string, authorized: boolean) {
  return useQuery({
    queryKey: metaLeadOpsKeys.review(companyId),
    enabled: authorized,
    queryFn: () => fetchMetaLeadReview(companyId),
  });
}

export function useMetaFormMappings(companyId: string, authorized: boolean) {
  return useQuery({
    queryKey: metaLeadOpsKeys.mappings(companyId),
    enabled: authorized,
    queryFn: () => fetchMetaFormMappings(companyId),
  });
}

export function useRequeueMetaLeadEvent(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { data } = await AuthService.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new MetaLeadOpsError('forbidden');
      return requeueMetaLeadEventRequest(companyId, eventId, accessToken);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: metaLeadOpsKeys.review(companyId) }),
  });
}

export function useDismissMetaLeadEvent(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; resolution: DismissResolution }) =>
      dismissMetaLeadEvent(companyId, input.eventId, input.resolution),
    onSettled: () => queryClient.invalidateQueries({ queryKey: metaLeadOpsKeys.review(companyId) }),
  });
}

export function useSetMetaFormMapping(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { formId: string; target: MetaFormMapping['target']; fieldKey: string }) =>
      setMetaFormMapping(companyId, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: metaLeadOpsKeys.mappings(companyId) }),
  });
}

export function useDeleteMetaFormMapping(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { formId: string; target: MetaFormMapping['target'] }) =>
      deleteMetaFormMapping(companyId, input.formId, input.target),
    onSettled: () => queryClient.invalidateQueries({ queryKey: metaLeadOpsKeys.mappings(companyId) }),
  });
}

export function useLeadFormSubmissions(options: { leadId: string | null; companyId: string | null; authorized: boolean }) {
  const { leadId, companyId, authorized } = options;
  return useQuery({
    queryKey: metaLeadOpsKeys.submissions(companyId, leadId ?? 'none'),
    enabled: authorized && typeof leadId === 'string' && leadId !== '',
    queryFn: () => fetchLeadFormSubmissions(leadId as string, companyId),
  });
}
