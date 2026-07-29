// lib/hooks/useCheckPlatformLeadPhoneDuplicate.ts — verificação de telefone
// duplicado na superfície platform do Super Admin (M1-F S8-C2-C2). Chama
// check_lead_phone_duplicate SEMPRE com companyId explícito (nunca global —
// decisão §9 do design). Deliberadamente um useMutation (imperativo), NUNCA
// um useQuery: o telefone é PII e não pode virar parte de uma query key
// persistida no cache do TanStack Query.
//
// O status devolvido pode ser 'accessible' ou 'restricted' — nenhum dos
// dois é usado para decidir a mensagem: o chamador (formulário) NUNCA lê
// lead_id/lead_name/lead_archived da resposta (dado de outro Lead nunca é
// revelado, decisão §9), só se `status !== 'none'` para bloquear o envio
// com a mensagem genérica "Já existe um Lead com este telefone nesta
// empresa.".
//
// Descarte de resposta atrasada (digitação rápida): responsabilidade do
// CHAMADOR (um contador de requisição/epoch local ao formulário) — este
// hook não cancela nem deduplica chamadas por si só, cada chamada a
// `checkDuplicate` é uma promise independente.
import { useMutation } from '@tanstack/react-query';
import {
  checkPlatformLeadPhoneDuplicate,
  type PlatformLeadDuplicateRow,
} from '@/lib/commercial/repository';

export type CheckPlatformLeadPhoneDuplicateCallInput = {
  companyId: string;
  phone: string;
};

export type UseCheckPlatformLeadPhoneDuplicateResult = {
  checkDuplicate: (input: CheckPlatformLeadPhoneDuplicateCallInput) => Promise<PlatformLeadDuplicateRow[]>;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  reset: () => void;
};

export function useCheckPlatformLeadPhoneDuplicate(): UseCheckPlatformLeadPhoneDuplicateResult {
  const mutation = useMutation<PlatformLeadDuplicateRow[], unknown, CheckPlatformLeadPhoneDuplicateCallInput>({
    mutationFn: ({ companyId, phone }) => checkPlatformLeadPhoneDuplicate(companyId, phone),
  });

  return {
    checkDuplicate: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}
