// lib/hooks/useKapaLeadsSync.ts — React Query da sincronização KAPA Leads → CRM.
// `authorized` é decidido pelo chamador; o banco revalida tudo pelo auth.uid().
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissKapaLeadsEvent,
  fetchKapaLeadsReview,
  fetchKapaLeadsSyncHealth,
  requeueKapaLeadsEvent,
  setKapaLeadsLinkEnabled,
  upsertKapaLeadsLink,
  type KapaLeadsDismissResolution,
} from '@/lib/integrations/kapaLeadsSync';

export const kapaLeadsSyncKeys = {
  all: (companyId: string) => ['company', companyId, 'kapaLeadsSync'] as const,
  health: (companyId: string) => ['company', companyId, 'kapaLeadsSync', 'health'] as const,
  review: (companyId: string) => ['company', companyId, 'kapaLeadsSync', 'review'] as const,
};

export function useKapaLeadsSyncHealth(companyId: string, authorized: boolean) {
  return useQuery({
    queryKey: kapaLeadsSyncKeys.health(companyId),
    enabled: authorized,
    queryFn: () => fetchKapaLeadsSyncHealth(companyId),
  });
}

export function useKapaLeadsReview(companyId: string, authorized: boolean) {
  return useQuery({
    queryKey: kapaLeadsSyncKeys.review(companyId),
    enabled: authorized,
    queryFn: () => fetchKapaLeadsReview(companyId),
  });
}

export function useUpsertKapaLeadsLink(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kapaStoreId: string; storeLabel: string; vehicleFormKey: string | null }) =>
      upsertKapaLeadsLink({ companyId, ...input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: kapaLeadsSyncKeys.all(companyId) }),
  });
}

export function useSetKapaLeadsLinkEnabled(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { linkId: string; enabled: boolean }) => setKapaLeadsLinkEnabled(companyId, input.linkId, input.enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: kapaLeadsSyncKeys.all(companyId) }),
  });
}

export function useRequeueKapaLeadsEvent(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => requeueKapaLeadsEvent(companyId, eventId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: kapaLeadsSyncKeys.all(companyId) }),
  });
}

export function useDismissKapaLeadsEvent(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { eventId: string; resolution: KapaLeadsDismissResolution }) =>
      dismissKapaLeadsEvent(companyId, input.eventId, input.resolution),
    onSettled: () => queryClient.invalidateQueries({ queryKey: kapaLeadsSyncKeys.all(companyId) }),
  });
}
