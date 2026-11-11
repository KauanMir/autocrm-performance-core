'use client';
// lib/commercial/useEffectiveCommercialCompany.ts — empresa comercial EFETIVA
// do Super Admin, lida por TODA a árvore comercial (telas, modais, detalhe).
//
// Duas autoridades existem, nunca simultâneas (SUPER-ADMIN-COMPANY-CONTEXT-
// B1-EXEC §15/§24):
//   - rota /company/[id] (OperationalCompanyContext mode 'super_admin'):
//     a empresa vem da URL e o seletor manual é ignorado;
//   - fora dela: o seletor manual do CommercialCompanyContext.
//
// Antes, as telas resolviam a empresa assim, mas os modais de criação/edição
// e o detalhe do lead liam apenas o seletor manual (null no modo
// operacional). O modal comparava null com company.id e se fechava no
// primeiro efeito; as ações do detalhe eram recusadas como "contexto
// trocado". Este hook é a única fonte para os dois casos.
//
// contextEpoch: muda a cada troca de (modo, empresa, epoch do seletor
// manual). Quem captura o epoch ao abrir uma ação e revalida antes da RPC
// detecta também a ida-e-volta A->B->A, como no S8-C2-D2.
import { useRef } from 'react';
import { useCommercialCompanyContext } from '@/lib/commercial/CommercialCompanyContext';
import { useOperationalCompanyContext } from '@/lib/operational/OperationalCompanyContext';

export type EffectiveCommercialCompany = {
  companyId: string | null;
  contextEpoch: number;
  isOperationalMode: boolean;
};

export function useEffectiveCommercialCompany(): EffectiveCommercialCompany {
  const operational = useOperationalCompanyContext();
  const commercial = useCommercialCompanyContext();
  const isOperationalMode = operational.mode === 'super_admin';
  const companyId = isOperationalMode ? operational.companyId : commercial.selectedCompanyId;
  const key = `${isOperationalMode ? 'op' : 'sel'}|${companyId ?? ''}|${commercial.contextEpoch}`;

  // Atualização idempotente durante o render (comparar e só então trocar):
  // renders repetidos do StrictMode não avançam o epoch duas vezes.
  const stateRef = useRef<{ key: string; epoch: number }>({ key, epoch: 0 });
  if (stateRef.current.key !== key) {
    stateRef.current = { key, epoch: stateRef.current.epoch + 1 };
  }

  return { companyId, contextEpoch: stateRef.current.epoch, isOperationalMode };
}
