// tests/components/followUpTemplates/FollowUpTemplateEditorModal.test.tsx —
// FOLLOW-UP-TEMPLATES-A3-EXEC. useCreateFollowUpTemplate/
// useUpdateFollowUpTemplate mockados — comportamento do hook já coberto em
// tests/hooks/. Cobre client-side UX: singular/plural, horário condicional
// por unidade, validação antes do submit.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useCreateFollowUpTemplate: vi.fn(),
  useUpdateFollowUpTemplate: vi.fn(),
  createTemplateMock: vi.fn(),
  updateTemplateMock: vi.fn(),
}));

vi.mock('@/lib/hooks/useCreateFollowUpTemplate', () => ({ useCreateFollowUpTemplate: m.useCreateFollowUpTemplate }));
vi.mock('@/lib/hooks/useUpdateFollowUpTemplate', () => ({ useUpdateFollowUpTemplate: m.useUpdateFollowUpTemplate }));

import { FollowUpTemplateEditorModal } from '@/components/followUpTemplates/FollowUpTemplateEditorModal';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';

const EXISTING: FollowUpTemplateModel = {
  id: 'tpl-1', companyId: 'company-a', name: 'Não respondeu', taskTitle: 'Tentar novo contato',
  taskNote: 'obs', priority: 'alta', offsetValue: 1, offsetUnit: 'hour', defaultTime: null,
  isActive: true, sortOrder: 0, createdBy: 'p1', updatedBy: 'p1', createdAt: 't', updatedAt: 't', version: 3,
};

beforeEach(() => {
  m.createTemplateMock.mockReset().mockResolvedValue({});
  m.updateTemplateMock.mockReset().mockResolvedValue({});
  m.useCreateFollowUpTemplate.mockReset().mockReturnValue({ createTemplate: m.createTemplateMock, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn() });
  m.useUpdateFollowUpTemplate.mockReset().mockReturnValue({ updateTemplate: m.updateTemplateMock, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn() });
});

function renderModal(template: FollowUpTemplateModel | null = null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<FollowUpTemplateEditorModal userId="user-1" companyId="company-a" isSuperAdminContext={false} template={template} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

describe('FollowUpTemplateEditorModal — modo criação', () => {
  it('título "Novo follow-up", campos vazios, unidade padrão dia', () => {
    renderModal();
    expect(screen.getByText('Novo follow-up')).toBeInTheDocument();
  });

  it('não submete com nome/título em branco', () => {
    renderModal();
    fireEvent.click(screen.getByText('Salvar follow-up'));
    expect(m.createTemplateMock).not.toHaveBeenCalled();
  });

  it('preenchendo nome+título e confirmando cria o template com os valores certos', async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Ex.: Cliente pediu para pensar'), { target: { value: 'Cliente pediu para pensar' } });
    fireEvent.change(screen.getByPlaceholderText('Ex.: Retomar contato'), { target: { value: 'Retomar contato' } });
    fireEvent.click(screen.getByText('Salvar follow-up'));
    expect(m.createTemplateMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cliente pediu para pensar',
      taskTitle: 'Retomar contato',
      offsetUnit: 'day',
      offsetValue: 1,
      defaultTime: null,
    }));
  });

  it('unidade "Hora": nunca mostra o campo de horário padrão', () => {
    renderModal();
    fireEvent.click(screen.getByText('Hora'));
    expect(screen.queryByText('Definir um horário padrão')).toBeNull();
  });

  it('unidade "Dia": mostra o toggle de horário padrão, desmarcado por padrão', () => {
    renderModal();
    expect(screen.getByText('Definir um horário padrão')).toBeInTheDocument();
    expect(screen.getByText(/Sem horário padrão/)).toBeInTheDocument();
  });

  it('trocar de Dia para Hora depois de marcar horário padrão limpa o horário (nunca envia valor stale)', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Definir um horário padrão'));
    fireEvent.change(screen.getByLabelText('Horário padrão'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByText('Hora'));
    fireEvent.change(screen.getByPlaceholderText('Ex.: Cliente pediu para pensar'), { target: { value: 'x' } });
    fireEvent.change(screen.getByPlaceholderText('Ex.: Retomar contato'), { target: { value: 'y' } });
    fireEvent.click(screen.getByText('Salvar follow-up'));
    expect(m.createTemplateMock).toHaveBeenCalledWith(expect.objectContaining({ offsetUnit: 'hour', defaultTime: null }));
  });

  it('singular/plural do rótulo de unidade reflete o valor digitado', () => {
    renderModal();
    const valueInput = screen.getByDisplayValue('1');
    expect(screen.getByText('Dia')).toBeInTheDocument();
    fireEvent.change(valueInput, { target: { value: '3' } });
    expect(screen.getByText('Dias')).toBeInTheDocument();
  });
});

describe('FollowUpTemplateEditorModal — modo edição', () => {
  it('título "Editar follow-up", campos pré-preenchidos com o template', () => {
    renderModal(EXISTING);
    expect(screen.getByText('Editar follow-up')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Não respondeu')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tentar novo contato')).toBeInTheDocument();
  });

  it('salvar chama updateTemplate com expectedVersion do template, nunca createTemplate', async () => {
    renderModal(EXISTING);
    fireEvent.click(screen.getByText('Salvar follow-up'));
    expect(m.updateTemplateMock).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tpl-1', expectedVersion: 3,
    }));
    expect(m.createTemplateMock).not.toHaveBeenCalled();
  });
});
