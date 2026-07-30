// lib/hooks/useCheckLeadPhoneDuplicate.ts — checagem de telefone duplicado
// para Manager/Seller (M1-E, E4-B1). Identidade por parâmetro (mesmo
// padrão de useCreateLead/useUpdateLead). Deliberadamente um useMutation
// (imperativo), NUNCA um useQuery: o telefone é PII e não pode virar parte
// de uma query key persistida no cache do TanStack Query (mesmo raciocínio
// de useCheckPlatformLeadPhoneDuplicate, M1-F).
//
// Contrato de descarte de resposta fora de ordem (decisão desta etapa):
// cada chamada recebe um `sequence` monotônico (contador interno do hook);
// o resultado resolvido carrega esse `sequence` + o telefone (bruto e
// normalizado) que o gerou. `getLatestSequence()` é uma função ESTÁVEL
// (não-reativa) que devolve o `sequence` da chamada mais recente já
// iniciada — o E4-B2 compara o `sequence` de uma resposta recebida contra
// `getLatestSequence()` no momento em que a resposta chega: se forem
// diferentes, uma chamada mais nova já foi disparada (telefone mudou no
// meio do debounce) e esta resposta deve ser descartada. Este hook nunca
// decide sozinho "criar mesmo assim" — isso é inteiramente do E4-B2.
//
// Nenhuma UI conectada nesta etapa.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import {
  checkRemoteLeadPhoneDuplicate,
  normalizeLeadPhoneDigits,
  type RemoteLeadDuplicateRow,
} from '@/lib/leads/remoteMutationRepository';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
} from '@/lib/leads/errors';

export type UseCheckLeadPhoneDuplicateOptions = {
  userId?: string | null;
  companyId?: string | null;
  membershipRole?: 'manager' | 'seller' | null;
  userIsActive: boolean;
};

export type CheckLeadPhoneDuplicateCallInput = {
  phone: string;
  excludeLeadId?: string;
};

export type CheckLeadPhoneDuplicateOutcome = {
  sequence: number;
  phone: string;
  phoneDigits: string;
  rows: RemoteLeadDuplicateRow[];
};

export type UseCheckLeadPhoneDuplicateResult = {
  checkDuplicate: (input: CheckLeadPhoneDuplicateCallInput) => Promise<CheckLeadPhoneDuplicateOutcome>;
  // Função estável (não-reativa) — ver contrato de descarte no cabeçalho.
  getLatestSequence: () => number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
};

export function useCheckLeadPhoneDuplicate(
  options: UseCheckLeadPhoneDuplicateOptions,
): UseCheckLeadPhoneDuplicateResult {
  const { userId, companyId, membershipRole, userIsActive } = options;
  const queryClient = useQueryClient();
  const sequenceRef = useRef(0);

  const mutation = useMutation<CheckLeadPhoneDuplicateOutcome, unknown, CheckLeadPhoneDuplicateCallInput>({
    retry: 0,
    mutationFn: async (input) => {
      const hasIdentity =
        userIsActive
        && typeof userId === 'string' && userId.trim() !== ''
        && typeof companyId === 'string' && companyId.trim() !== ''
        && (membershipRole === 'manager' || membershipRole === 'seller');

      if (!hasIdentity) {
        throw mapRemoteLeadsMutationError({ message: 'forbidden' }, 'check_lead_phone_duplicate');
      }

      // Sequence atribuído de forma síncrona, ANTES de qualquer await — a
      // ordem de chamadas é sempre preservada mesmo que as respostas
      // cheguem fora de ordem.
      sequenceRef.current += 1;
      const sequence = sequenceRef.current;

      const capturedGeneration = getQueryCacheGeneration(queryClient);

      const rows = await checkRemoteLeadPhoneDuplicate({
        phone: input.phone,
        excludeLeadId: input.excludeLeadId,
      });

      if (getQueryCacheGeneration(queryClient) !== capturedGeneration) {
        throw createIdentityChangedMutationError('check_lead_phone_duplicate');
      }

      return {
        sequence,
        phone: input.phone,
        phoneDigits: normalizeLeadPhoneDigits(input.phone),
        rows,
      };
    },
  });

  return {
    checkDuplicate: mutation.mutateAsync,
    getLatestSequence: () => sequenceRef.current,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
