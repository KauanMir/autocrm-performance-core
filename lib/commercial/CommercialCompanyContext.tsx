'use client';
// lib/commercial/CommercialCompanyContext.tsx — estado comercial ESTREITO do
// Super Admin (M1-F S8-C2-B2, decisões congeladas do S8-C2-A1/§31 + a
// divergência de arquitetura resolvida nesta etapa). `selectedCompanyId` é a
// ÚNICA fonte de "empresa comercial atual" do Super Admin — nunca
// localStorage/sessionStorage/cookie/URL/Zustand, nunca ativeMembership
// (Super Admin nunca tem), nunca useCompanyScopeFilter/companyFilterId
// (semântica incompatível: lá null="visão global"; aqui null="nada
// selecionado ainda", não existe conceito de "todas as empresas").
//
// Compartilhado entre Clientes e Andamento: o Provider é montado UMA vez em
// App.tsx, acima da troca de tela — assim trocar de aba preserva a seleção.
// Troca de IDENTIDADE (login/logout/troca de usuário) nunca herda a seleção
// anterior, mesmo padrão já testado em useCompanyScopeFilter.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { platformCommercialQueryKeys } from '@/lib/commercial/queryKeys';

export type CommercialCompanyContextValue = {
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
  // M1-F S8-C2-D2 — contador monotônico, incrementado a cada troca REAL de
  // empresa (mesmo gatilho do cancelQueries abaixo). Protege contra o
  // caso raro de uma mutation pendente sobreviver a uma troca A->B->A: a
  // simples comparação de companyId não detectaria essa ida-e-volta (o
  // valor final é igual ao inicial), mas o epoch capturado no início da
  // ação nunca mais bate. Capturado pelo chamador (hooks/formulários) no
  // momento de abrir uma ação e revalidado imediatamente antes de cada
  // RPC de mutation.
  contextEpoch: number;
};

const CommercialCompanyContext = createContext<CommercialCompanyContextValue | null>(null);

export type CommercialCompanyProviderProps = {
  children: React.ReactNode;
  // Identidade do usuário autenticado (currentUser.id) — null quando não há
  // usuário resolvido. Qualquer mudança de valor (inclusive null -> id ou
  // id -> outro id) limpa a seleção.
  identityKey: string | null;
};

export function CommercialCompanyProvider({ children, identityKey }: CommercialCompanyProviderProps) {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);
  const [contextEpoch, setContextEpoch] = useState(0);
  const previousCompanyIdRef = useRef<string | null>(null);

  useEffect(() => {
    setSelectedCompanyIdState(null);
    previousCompanyIdRef.current = null;
    setContextEpoch((e) => e + 1);
  }, [identityKey]);

  const setSelectedCompanyId = useCallback((id: string | null) => {
    const previous = previousCompanyIdRef.current;
    if (previous !== null && previous !== id) {
      // Higiene de rede na troca de empresa: cancela as queries platform da
      // empresa anterior — NUNCA resetQueryCache() global (apagaria dados de
      // outras identidades/telas sem relação com esta troca). A correção
      // contra "resposta tardia cruzando empresa" nunca depende disto: as
      // keys já são particionadas por companyId (platformCommercialQueryKeys),
      // então uma resposta tardia de A jamais é escrita na key de B.
      void queryClient.cancelQueries({ queryKey: platformCommercialQueryKeys.leadsRoot(previous) });
      void queryClient.cancelQueries({ queryKey: platformCommercialQueryKeys.stages(previous) });
    }
    if (previous !== id) {
      setContextEpoch((e) => e + 1);
    }
    previousCompanyIdRef.current = id;
    setSelectedCompanyIdState(id);
  }, [queryClient]);

  return (
    <CommercialCompanyContext.Provider value={{ selectedCompanyId, setSelectedCompanyId, contextEpoch }}>
      {children}
    </CommercialCompanyContext.Provider>
  );
}

export function useCommercialCompanyContext(): CommercialCompanyContextValue {
  const ctx = useContext(CommercialCompanyContext);
  if (!ctx) {
    throw new Error('useCommercialCompanyContext: deve ser usado dentro de CommercialCompanyProvider');
  }
  return ctx;
}
