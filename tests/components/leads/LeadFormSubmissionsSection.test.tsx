// META-MVP1 — seção de respostas do formulário Meta no detalhe do lead.
// Repositório mockado; sem rede.
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient } from '@/tests/helpers/renderWithQueryClient';

const mocks = vi.hoisted(() => ({ fetchLeadFormSubmissions: vi.fn() }));
vi.mock('@/lib/integrations/metaLeadOps', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/integrations/metaLeadOps')>();
  return { ...original, fetchLeadFormSubmissions: mocks.fetchLeadFormSubmissions };
});

import { formatBrazilPhoneDigits, LeadFormSubmissionsSection } from '@/components/leads/LeadFormSubmissionsSection';

const SUBMISSION = {
  id: 's1',
  outcome: 'created' as const,
  formId: '1086',
  adId: null,
  submittedAt: '2026-11-05T12:00:00.000Z',
  receivedAt: '2026-11-05T12:00:05.000Z',
  contactName: 'Cliente Fictício',
  contactPhone: '61999990001',
  contactEmail: null,
  vehicleInterest: null,
  answers: [{ key: 'forma_pagamento', values: ['Financiamento', 'Troca'] }],
};

beforeEach(() => {
  mocks.fetchLeadFormSubmissions.mockReset();
});

describe('LeadFormSubmissionsSection', () => {
  it('mostra contato, ausências explícitas e respostas personalizadas', async () => {
    mocks.fetchLeadFormSubmissions.mockResolvedValue([SUBMISSION]);
    renderWithQueryClient(<LeadFormSubmissionsSection leadId="lead-1" companyId={null} authorized />);
    expect(await screen.findByTestId('lead-form-submissions')).toBeInTheDocument();
    expect(screen.getByText('Cliente Fictício')).toBeInTheDocument();
    expect(screen.getByText('(61) 99999-0001')).toBeInTheDocument();
    expect(screen.getAllByText('Não informado no formulário')).toHaveLength(2);
    expect(screen.getByText('forma_pagamento')).toBeInTheDocument();
    expect(screen.getByText('Financiamento, Troca')).toBeInTheDocument();
    expect(screen.getByText('Lead criado por este formulário')).toBeInTheDocument();
    expect(mocks.fetchLeadFormSubmissions).toHaveBeenCalledWith('lead-1', null);
  });

  it('novo envio para lead existente é identificado', async () => {
    mocks.fetchLeadFormSubmissions.mockResolvedValue([{ ...SUBMISSION, outcome: 'linked_existing', vehicleInterest: 'Onix' }]);
    renderWithQueryClient(<LeadFormSubmissionsSection leadId="lead-1" companyId="c1" authorized />);
    expect(await screen.findByText('Novo envio para lead já existente')).toBeInTheDocument();
    expect(screen.getByText('Onix')).toBeInTheDocument();
  });

  it('lead sem formulário: a seção não aparece', async () => {
    mocks.fetchLeadFormSubmissions.mockResolvedValue([]);
    const { container } = renderWithQueryClient(<LeadFormSubmissionsSection leadId="lead-1" companyId={null} authorized />);
    await waitFor(() => expect(mocks.fetchLeadFormSubmissions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('sem autorização: não consulta nada', () => {
    const { container } = renderWithQueryClient(<LeadFormSubmissionsSection leadId="lead-1" companyId={null} authorized={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.fetchLeadFormSubmissions).not.toHaveBeenCalled();
  });

  it('erro: mensagem traduzida, nunca o erro bruto', async () => {
    mocks.fetchLeadFormSubmissions.mockRejectedValue(new Error('relation secret_table'));
    renderWithQueryClient(<LeadFormSubmissionsSection leadId="lead-1" companyId={null} authorized />);
    expect(await screen.findByTestId('lead-form-submissions-error')).toHaveTextContent('Não foi possível carregar as respostas do formulário.');
    expect(screen.queryByText(/secret_table/)).not.toBeInTheDocument();
  });

  it('formatBrazilPhoneDigits', () => {
    expect(formatBrazilPhoneDigits('6133334444')).toBe('(61) 3333-4444');
    expect(formatBrazilPhoneDigits('123')).toBe('123');
  });
});
