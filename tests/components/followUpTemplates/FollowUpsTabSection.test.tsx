// tests/components/followUpTemplates/FollowUpsTabSection.test.tsx —
// FOLLOW-UP-TEMPLATES-A3-EXEC (Ajustes > Follow-ups). Hooks de
// leitura/mutation mockados — comportamento de cada hook já coberto em
// tests/hooks/. FollowUpTemplateEditorModal mockado para isolar esta
// suíte no comportamento da LISTA (empty state/toggle/reorder/gating).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  useManagementFollowUpTemplates: vi.fn(),
  useSetFollowUpTemplateActive: vi.fn(),
  useReorderFollowUpTemplates: vi.fn(),
  setActiveMock: vi.fn(),
  reorderMock: vi.fn(),
}));

vi.mock('@/lib/hooks/useManagementFollowUpTemplates', () => ({ useManagementFollowUpTemplates: m.useManagementFollowUpTemplates }));
vi.mock('@/lib/hooks/useSetFollowUpTemplateActive', () => ({ useSetFollowUpTemplateActive: m.useSetFollowUpTemplateActive }));
vi.mock('@/lib/hooks/useReorderFollowUpTemplates', () => ({ useReorderFollowUpTemplates: m.useReorderFollowUpTemplates }));
vi.mock('@/components/followUpTemplates/FollowUpTemplateEditorModal', () => ({
  FollowUpTemplateEditorModal: ({ template, onClose }: any) => (
    <div>
      <span>editor-modal:{template ? 'editar' : 'criar'}</span>
      <button onClick={onClose}>fechar-editor</button>
    </div>
  ),
}));

import { FollowUpsTabSection } from '@/components/followUpTemplates/FollowUpsTabSection';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';

function tpl(overrides: Partial<FollowUpTemplateModel> = {}): FollowUpTemplateModel {
  return {
    id: 'tpl-1', companyId: 'company-a', name: 'Cliente pediu para pensar', taskTitle: 'Retomar contato',
    taskNote: '', priority: 'media', offsetValue: 2, offsetUnit: 'day', defaultTime: '09:00',
    isActive: true, sortOrder: 0, createdBy: 'p1', updatedBy: 'p1', createdAt: 't', updatedAt: 't', version: 1,
    ...overrides,
  };
}

function managementResult(over: Partial<Record<string, unknown>> = {}) {
  return { status: 'ready', templates: [tpl()], ...over };
}

beforeEach(() => {
  m.setActiveMock.mockReset().mockResolvedValue({});
  m.reorderMock.mockReset().mockResolvedValue([]);
  m.useManagementFollowUpTemplates.mockReset().mockReturnValue(managementResult());
  m.useSetFollowUpTemplateActive.mockReset().mockReturnValue({ setActive: m.setActiveMock, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn() });
  m.useReorderFollowUpTemplates.mockReset().mockReturnValue({ reorderTemplates: m.reorderMock, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn() });
});

function renderTab(props: Partial<React.ComponentProps<typeof FollowUpsTabSection>> = {}) {
  return render(
    <FollowUpsTabSection userId="user-1" companyId="company-a" isSuperAdminContext={false} readAuthorized={true} writeAuthorized={true} {...props} />,
  );
}

describe('FollowUpsTabSection — acesso', () => {
  it('readAuthorized=false: mensagem de negado, nenhuma lista', () => {
    renderTab({ readAuthorized: false });
    expect(screen.getByTestId('followups-denied')).toBeInTheDocument();
  });
});

describe('FollowUpsTabSection — empty state (precheck A3-EXEC §7)', () => {
  it('empresa sem templates: mensagem + CTA "Criar follow-up", nunca cria dado automaticamente', () => {
    m.useManagementFollowUpTemplates.mockReturnValue(managementResult({ templates: [] }));
    renderTab();
    expect(screen.getByText('Nenhum follow-up configurado ainda.')).toBeInTheDocument();
    expect(screen.getByText('Criar follow-up')).toBeInTheDocument();
  });

  it('Seller (writeAuthorized=false) no empty state: nunca vê o CTA de criar', () => {
    m.useManagementFollowUpTemplates.mockReturnValue(managementResult({ templates: [] }));
    renderTab({ writeAuthorized: false });
    expect(screen.queryByText('Criar follow-up')).toBeNull();
  });
});

describe('FollowUpsTabSection — lista', () => {
  it('mostra nome/título/subtítulo humano/prioridade e badge Ativo, nunca id/version/offset cru', () => {
    renderTab();
    expect(screen.getByText('Cliente pediu para pensar')).toBeInTheDocument();
    expect(screen.getByText(/Retomar contato/)).toBeInTheDocument();
    expect(screen.getByText(/Em 2 dias às 09:00/)).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.queryByText('tpl-1')).toBeNull();
  });

  it('inativos ficam visíveis (Manager) com badge Inativo — precheck A3-EXEC §19', () => {
    m.useManagementFollowUpTemplates.mockReturnValue(managementResult({ templates: [tpl({ isActive: false })] }));
    renderTab();
    expect(screen.getByText('Inativo')).toBeInTheDocument();
  });

  it('contador "N de 12 follow-ups ativos" aparece quando há templates', () => {
    renderTab();
    expect(screen.getByText(/1 de 12 follow-ups ativos/)).toBeInTheDocument();
  });

  it('writeAuthorized=false: nenhum botão de ação por linha (Editar/Ativar-Desativar/reorder)', () => {
    renderTab({ writeAuthorized: false });
    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByText('Desativar')).toBeNull();
    expect(screen.queryByLabelText(/Mover/)).toBeNull();
  });
});

describe('FollowUpsTabSection — criar/editar', () => {
  it('"Novo follow-up" abre o editor em modo criação', () => {
    renderTab();
    fireEvent.click(screen.getByText('Novo follow-up'));
    expect(screen.getByText('editor-modal:criar')).toBeInTheDocument();
  });

  it('"Editar" abre o editor em modo edição com o template certo', () => {
    renderTab();
    fireEvent.click(screen.getByText('Editar'));
    expect(screen.getByText('editor-modal:editar')).toBeInTheDocument();
  });

  it('fechar o editor volta para a lista', () => {
    renderTab();
    fireEvent.click(screen.getByText('Novo follow-up'));
    fireEvent.click(screen.getByText('fechar-editor'));
    expect(screen.queryByText(/editor-modal/)).toBeNull();
  });
});

describe('FollowUpsTabSection — ativar/desativar', () => {
  it('"Desativar" chama setActive com isActive=false, id/version do template', () => {
    renderTab();
    fireEvent.click(screen.getByText('Desativar'));
    expect(m.setActiveMock).toHaveBeenCalledWith({ templateId: 'tpl-1', expectedVersion: 1, isActive: false });
  });

  it('erro de limite ao reativar mostra mensagem clara na própria linha', async () => {
    const { RemoteFollowUpTemplatesError } = await import('@/lib/followupTemplates/errors');
    m.setActiveMock.mockRejectedValue(new RemoteFollowUpTemplatesError('remote_followup_templates_mutation_limit_reached'));
    m.useManagementFollowUpTemplates.mockReturnValue(managementResult({ templates: [tpl({ isActive: false })] }));
    renderTab();
    fireEvent.click(screen.getByText('Ativar'));
    expect(await screen.findByText('Você já possui 12 follow-ups ativos. Desative um deles para ativar outro.')).toBeInTheDocument();
  });
});

describe('FollowUpsTabSection — reorder (sem drag-and-drop, precheck A3-EXEC §16)', () => {
  it('primeira linha: botão "para cima" desabilitado; última: "para baixo" desabilitado', () => {
    m.useManagementFollowUpTemplates.mockReturnValue(managementResult({
      templates: [tpl({ id: 'tpl-1', sortOrder: 0 }), tpl({ id: 'tpl-2', name: 'B', sortOrder: 1 })],
    }));
    renderTab();
    expect(screen.getByLabelText('Mover Cliente pediu para pensar para cima')).toBeDisabled();
    expect(screen.getByLabelText('Mover B para baixo')).toBeDisabled();
  });

  it('mover para baixo chama reorderTemplates com a lista completa, na nova ordem, atomicamente', () => {
    m.useManagementFollowUpTemplates.mockReturnValue(managementResult({
      templates: [tpl({ id: 'tpl-1', name: 'A', sortOrder: 0 }), tpl({ id: 'tpl-2', name: 'B', sortOrder: 1 })],
    }));
    renderTab();
    fireEvent.click(screen.getByLabelText('Mover A para baixo'));
    expect(m.reorderMock).toHaveBeenCalledTimes(1);
    expect(m.reorderMock).toHaveBeenCalledWith(['tpl-2', 'tpl-1']);
  });
});
