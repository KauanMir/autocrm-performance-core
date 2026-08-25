// lib/hooks/usePodiumViewPreference.ts — PODIUM-COMPETITION-R1-EXEC.
// Camada de React sobre lib/podium/podiumViewPreference.ts (puro). Lê a
// preferência salva UMA vez por userId (nunca reconsultada a cada render),
// resincroniza se o userId mudar (troca de sessão/conta no mesmo tab), e
// grava no localStorage a cada escolha do usuário.
import { useCallback, useEffect, useState } from 'react';
import {
  getPodiumViewPreference,
  setPodiumViewPreference,
  type PodiumVariant,
} from '@/lib/podium/podiumViewPreference';

export function usePodiumViewPreference(userId: string | null | undefined): [PodiumVariant, (variant: PodiumVariant) => void] {
  const [variant, setVariantState] = useState<PodiumVariant>(() => getPodiumViewPreference(userId));

  // Resincroniza quando o userId muda de verdade (ex.: logout/login de
  // outra conta na mesma aba) — nunca a cada render.
  useEffect(() => {
    setVariantState(getPodiumViewPreference(userId));
  }, [userId]);

  const setVariant = useCallback((next: PodiumVariant) => {
    setVariantState(next);
    setPodiumViewPreference(userId, next);
  }, [userId]);

  return [variant, setVariant];
}
