// tests/components/commercial/PlatformLeadDetails.test.tsx — ação "Editar"
// (M1-F S8-C2-C2) somada ao detalhe somente-leitura já existente (S8-C2-B2).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PlatformLeadRow, PlatformPipelineStageRow } from '@/lib/commercial/repository';

vi.mock('@/lib/hooks/usePlatformLeadTimeline', () => ({
  usePlatformLeadTimeline: () => ({
    entries: [], isLoading: false, isError: false, isEmpty: true, hasData: false, refetch: vi.fn(),
  }),
}));

import { PlatformLeadDetails } from '@/components/commercial/PlatformLeadDetails';

function lead(overrides: Partial<PlatformLeadRow> = {}): PlatformLeadRow {
  return {
    id: 'lead-1', company_id: 'company-a', name: 'Cliente Teste', phone: '11988887777', car: 'Onix',
    stage_id: 'stage-1', seller_id: null, archived_at: null, created_at: '2026-01-01T00:00:00Z',
    created_by_profile_id: null, updated_at: '2026-01-01T00:00:00Z', updated_by_profile_id: null,
    urgency: 'green', temperature: null, payment_preference: null, source: null, value_amount: null,
    phone_digits: '11988887777', alert_label: null, last_activity_label: null, version: 1,
    ...overrides,
  } as PlatformLeadRow;
}

const stagesById: Readonly<Record<string, PlatformPipelineStageRow>> = {};

describe('PlatformLeadDetails — canMutate=false (comportamento original do B2)', () => {
  it('mostra o selo "Somente leitura", nenhum botão Editar', () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} onClose={vi.fn()} />);
    expect(screen.getAllByText(/somente leitura/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Editar')).toBeNull();
  });
});

describe('PlatformLeadDetails — canMutate=true', () => {
  it('mostra o botão Editar, nunca o selo "Somente leitura"', () => {
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} onClose={vi.fn()} canMutate onEdit={vi.fn()} />);
    expect(screen.getByText('Editar')).toBeInTheDocument();
    expect(screen.queryByText(/somente leitura/i)).toBeNull();
  });

  it('clicar Editar chama onEdit', () => {
    const onEdit = vi.fn();
    render(<PlatformLeadDetails lead={lead()} companyId="company-a" stagesById={stagesById} onClose={vi.fn()} canMutate onEdit={onEdit} />);
    fireEvent.click(screen.getByText('Editar'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
