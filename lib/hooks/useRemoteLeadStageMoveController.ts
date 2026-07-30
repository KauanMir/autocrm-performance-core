// lib/hooks/useRemoteLeadStageMoveController.ts — controlador de movimento
// remoto do Kanban para Manager/Seller (M1-E, E5-B1). Envolve
// useMoveLeadToStage com o que a UI do Kanban precisa e o hook sozinho não
// oferece: pendência ESCOPADA POR LEAD (Leads diferentes podem mover ao
// mesmo tempo; o mesmo Lead nunca dispara duas mutations simultâneas),
// proteção contra resposta obsoleta sobrescrever um movimento mais novo do
// MESMO Lead (token por Lead), no-op de same-stage (isNoOpStageMove) e
// descarte de estado visual (pendência/erro) na troca de identidade.
//
// Não busca Leads, não busca Stages, não duplica a bridge, não mantém cópia
// do Pipeline, não faz atualização otimista, não persiste nada — só chama
// useMoveLeadToStage e observa o resultado. A query remota (via
// invalidateQueries dentro do próprio useMoveLeadToStage) continua sendo a
// única fonte de verdade de onde o card aparece.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useMoveLeadToStage,
  isNoOpStageMove,
  type UseMoveLeadToStageOptions,
} from '@/lib/hooks/useMoveLeadToStage';
import { isRemoteLeadsError, type RemoteLeadsErrorCode } from '@/lib/leads/errors';

export type UseRemoteLeadStageMoveControllerOptions = UseMoveLeadToStageOptions & {
  // Muda em logout/troca de empresa/membership/transferência/suspensão —
  // qualquer mudança descarta pendência/erro visuais imediatamente (decisão
  // humana #15 do E5-B1). Uma mutation já enviada pode concluir no servidor,
  // mas useMoveLeadToStage já garante que ela nunca aterrissa (identity_
  // changed) na identidade nova; aqui só limpamos o estado VISUAL antigo.
  identityKey: string;
};

export type MoveLeadToStageAttemptInput = {
  leadId: string;
  sourceStageId: string;
  targetStageId: string;
};

// Código do último erro de cada Lead (chave ausente = sem erro pendente de
// exibição) — a tradução para mensagem sanitizada é responsabilidade do
// chamador (mesmo padrão de remoteLeadErrorMessage em Flows2.tsx).
type ErrorCodeByLead = Record<string, RemoteLeadsErrorCode | undefined>;

export type UseRemoteLeadStageMoveControllerResult = {
  isLeadPending: (leadId: string) => boolean;
  errorCodeByLead: Readonly<ErrorCodeByLead>;
  attemptMove: (input: MoveLeadToStageAttemptInput) => void;
  clearError: (leadId: string) => void;
};

export function useRemoteLeadStageMoveController(
  options: UseRemoteLeadStageMoveControllerOptions,
): UseRemoteLeadStageMoveControllerResult {
  const { identityKey, ...moveOptions } = options;
  const { moveLeadToStage } = useMoveLeadToStage(moveOptions);

  const [pendingLeadIds, setPendingLeadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [errorCodeByLead, setErrorCodeByLead] = useState<ErrorCodeByLead>({});
  // Token por Lead: incrementado a cada tentativa. Uma resposta (sucesso ou
  // erro) só tem efeito se ainda for o token mais recente daquele Lead —
  // protege contra uma resposta antiga limpar/sobrescrever um movimento mais
  // novo do MESMO Lead (decisão humana #4).
  const tokensRef = useRef<Record<string, number>>({});

  useEffect(() => {
    tokensRef.current = {};
    setPendingLeadIds(new Set());
    setErrorCodeByLead({});
  }, [identityKey]);

  const isLeadPending = useCallback(
    (leadId: string) => pendingLeadIds.has(leadId),
    [pendingLeadIds],
  );

  const clearError = useCallback((leadId: string) => {
    setErrorCodeByLead((prev: ErrorCodeByLead): ErrorCodeByLead => {
      if (!(leadId in prev)) return prev;
      const next: ErrorCodeByLead = { ...prev };
      delete next[leadId];
      return next;
    });
  }, []);

  const attemptMove = useCallback((input: MoveLeadToStageAttemptInput) => {
    const { leadId, sourceStageId, targetStageId } = input;

    if (isNoOpStageMove(sourceStageId, targetStageId)) return;
    if (pendingLeadIds.has(leadId)) return;

    const token = (tokensRef.current[leadId] ?? 0) + 1;
    tokensRef.current[leadId] = token;

    setErrorCodeByLead((prev: ErrorCodeByLead): ErrorCodeByLead => (leadId in prev ? { ...prev, [leadId]: undefined } : prev));
    setPendingLeadIds((prev) => {
      const next = new Set(prev);
      next.add(leadId);
      return next;
    });

    moveLeadToStage({ leadId, stageId: targetStageId })
      .then(() => {
        // Resposta obsoleta (um movimento mais novo do MESMO Lead já
        // assumiu o token) — nunca limpa a pendência do movimento atual.
        if (tokensRef.current[leadId] !== token) return;
        setPendingLeadIds((prev) => {
          if (!prev.has(leadId)) return prev;
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
      })
      .catch((err: unknown) => {
        if (tokensRef.current[leadId] !== token) return;
        setPendingLeadIds((prev) => {
          if (!prev.has(leadId)) return prev;
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
        // identity_changed nunca produz mensagem visível (decisão #15) — o
        // resultado pertence a uma identidade que não existe mais na tela.
        const code = isRemoteLeadsError(err) ? err.code : undefined;
        if (code === 'remote_leads_mutation_identity_changed') return;
        setErrorCodeByLead((prev: ErrorCodeByLead): ErrorCodeByLead => ({ ...prev, [leadId]: code }));
      });
  }, [moveLeadToStage, pendingLeadIds]);

  return { isLeadPending, errorCodeByLead, attemptMove, clearError };
}
