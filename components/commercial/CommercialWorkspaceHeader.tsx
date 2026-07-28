'use client';
// components/commercial/CommercialWorkspaceHeader.tsx — cabeçalho comum às
// duas superfícies platform (Clientes/Andamento), M1-F S8-C2-B2. Puramente
// visual e independente de modelo (não importa LeadService/StoreAdapter/
// tipos Lead mock) — reaproveitado pelos dois para não duplicar o bloco de
// seletor + status + selo "Somente leitura".
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBadge } from '@/components/ui/kit';
import { CommercialCompanySelector } from '@/components/commercial/CommercialCompanySelector';
import type { CommercialCompanyRow } from '@/lib/commercial/repository';

export type CommercialWorkspaceHeaderProps = {
  selectedCompanyId: string | null;
  onSelectCompany: (id: string) => void;
  companies: readonly CommercialCompanyRow[];
  companiesLoading: boolean;
  companiesError?: boolean;
};

export function CommercialWorkspaceHeader({
  selectedCompanyId, onSelectCompany, companies, companiesLoading, companiesError,
}: CommercialWorkspaceHeaderProps) {
  const selected = companies.find((c) => c.id === selectedCompanyId) ?? null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <LBadge tone="amber">
          <Icon name="eye" size={12} stroke={2.2} /> Modo comercial — somente leitura
        </LBadge>
        {selected && (
          <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
            Acompanhando: <strong style={{ color: 'var(--t-900)' }}>{selected.name}</strong>
          </span>
        )}
      </div>
      <CommercialCompanySelector
        selectedCompanyId={selectedCompanyId}
        onChange={onSelectCompany}
        companies={companies}
        companiesLoading={companiesLoading}
        companiesError={companiesError}
      />
    </div>
  );
}

export function CommercialWorkspaceEmptyState({ label }: { label: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 280, color: 'var(--t-500)', fontSize: 13.5, textAlign: 'center', padding: 20 }}>
      {label}
    </div>
  );
}
