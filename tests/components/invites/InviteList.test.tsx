// tests/components/invites/InviteList.test.tsx — listagem real de
// convites (M1-F S4-F3). useInvites/useCompanies/useResendInvite/
// useCancelInvite/AuthService mockados — nenhuma rede real. InviteUserModal
// é stubado (seu comportamento próprio já é coberto em
// InviteUserModal.test.tsx) — este arquivo cobre listagem, escopos,
// colunas, matriz de status/ações, cache e as duas mutations de ação.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminInviteListItem } from '@/lib/invites/repository';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';

const m = vi.hoisted(() => ({
  useInvites: vi.fn(),
  useCompanies: vi.fn(),
  useResendInvite: vi.fn(),
  useCancelInvite: vi.fn(),
  resendInviteMock: vi.fn(),
  cancelInviteMock: vi.fn(),
  getSession: vi.fn(),
  openFlow: vi.fn(),
  inviteModalProps: { current: null as any },
}));

vi.mock('@/lib/hooks/useInvites', () => ({ useInvites: m.useInvites }));
vi.mock('@/lib/hooks/useCompanies', () => ({ useCompanies: m.useCompanies }));

vi.mock('@/lib/hooks/useResendInvite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useResendInvite')>();
  return { ...actual, useResendInvite: m.useResendInvite };
});

vi.mock('@/lib/hooks/useCancelInvite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useCancelInvite')>();
  return { ...actual, useCancelInvite: m.useCancelInvite };
});

vi.mock('@/lib/services', () => ({
  AuthService: { getSession: m.getSession },
}));

vi.mock('@/components/invites/InviteUserModal', () => ({
  InviteUserModal: (props: any) => {
    m.inviteModalProps.current = props;
    return <div data-testid="invite-modal-stub">modal aberto</div>;
  },
}));

import { InviteList } from '@/components/invites/InviteList';

const SUPER_ADMIN: CreateInviteActor = { kind: 'super_admin' };
const MANAGER: CreateInviteActor = { kind: 'manager', companyId: 'company-a' };

function invite(overrides: Partial<AdminInviteListItem> = {}): AdminInviteListItem {
  return {
    id: 'invite-1',
    company_id: 'company-a',
    invited_by_profile_id: 'manager-1',
    name: 'Convidado Um',
    email: 'convidado1@test.local',
    role_kind: 'seller',
    status: 'pending',
    expires_at: '2099-01-01T00:00:00Z',
    accepted_at: null,
    created_at: '2026-07-20T12:00:00Z',
    ...overrides,
  };
}

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-a', name: 'Revenda Premium', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00',
    ...overrides,
  };
}

function invitesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], invites: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

function companiesResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    queryEnabled: true, queryKey: ['k'], companies: [],
    isLoading: false, isFetching: false, isError: false, error: null,
    isEmpty: true, hasData: false, refetch: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  m.useInvites.mockReturnValue(invitesResult());
  m.useCompanies.mockReturnValue(companiesResult());
  m.resendInviteMock.mockReset();
  m.cancelInviteMock.mockReset();
  m.resendInviteMock.mockResolvedValue({ outcome: 'ok', inviteId: 'invite-new', previousInviteId: 'invite-1', status: 'pending', deliveryStatus: 'sent', expiresAt: '2099-01-01T00:00:00Z' });
  m.cancelInviteMock.mockResolvedValue({ outcome: 'ok', inviteId: 'invite-1', status: 'canceled' });
  m.useResendInvite.mockReturnValue({ resendInvite: m.resendInviteMock, isPending: false, reset: vi.fn() });
  m.useCancelInvite.mockReturnValue({ cancelInvite: m.cancelInviteMock, isPending: false, reset: vi.fn() });
  m.getSession.mockResolvedValue({ data: { session: { access_token: 'access-token-x' } } });
  m.openFlow.mockReset();
  m.inviteModalProps.current = null;
  (window as any).__openFlow = m.openFlow;
});

describe('InviteList — guard', () => {
  it('actor null: não renderiza nada', () => {
    const { container } = render(<InviteList userId="user-1" actor={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(m.useInvites).toHaveBeenCalledWith(expect.objectContaining({ authorized: false, scope: null }));
  });
});

describe('InviteList — escopos', () => {
  it('Super Admin: useInvites com escopo platform', () => {
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(m.useInvites).toHaveBeenCalledWith({ userId: 'user-1', authorized: true, scope: { kind: 'platform' } });
  });

  it('Manager: useInvites com escopo company e companyId da activeMembership', () => {
    render(<InviteList userId="user-2" actor={MANAGER} />);
    expect(m.useInvites).toHaveBeenCalledWith({ userId: 'user-2', authorized: true, scope: { kind: 'company', companyId: 'company-a' } });
  });

  it('Super Admin: useCompanies autorizado; Manager: useCompanies NÃO autorizado (nunca busca só para exibir a própria empresa)', () => {
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: true }));
    render(<InviteList userId="user-2" actor={MANAGER} />);
    expect(m.useCompanies).toHaveBeenCalledWith(expect.objectContaining({ authorized: false }));
  });
});

describe('InviteList — estados de carregamento/vazio/erro', () => {
  it('loading: mostra texto de carregamento, nunca a lista', () => {
    m.useInvites.mockReturnValue(invitesResult({ isLoading: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Carregando convites…')).toBeInTheDocument();
  });

  it('vazio: mensagem "Nenhum convite enviado ainda." e botão Convidar usuário', () => {
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Nenhum convite enviado ainda.')).toBeInTheDocument();
    expect(screen.getByText('Convidar usuário')).toBeInTheDocument();
  });

  it('erro: mensagem amigável e botão Tentar novamente, sem erro bruto', () => {
    m.useInvites.mockReturnValue(invitesResult({ isError: true, isEmpty: false, error: { message: 'permission denied', code: '42501' } }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Não foi possível carregar os convites.')).toBeInTheDocument();
    expect(screen.queryByText(/42501/)).toBeNull();
    expect(screen.queryByText(/permission denied/)).toBeNull();
  });

  it('Tentar novamente chama refetch, nunca retry automático (só no clique)', () => {
    const refetch = vi.fn();
    m.useInvites.mockReturnValue(invitesResult({ isError: true, isEmpty: false, refetch }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('botão Convidar continua visível mesmo em estado de erro', () => {
    m.useInvites.mockReturnValue(invitesResult({ isError: true, isEmpty: false }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Convidar')).toBeInTheDocument();
  });
});

describe('InviteList — colunas e mapeamento de empresa (Super Admin)', () => {
  it('exibe nome/email/função e o nome da empresa mapeado por company_id', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ role_kind: 'manager' })], isEmpty: false, hasData: true }));
    m.useCompanies.mockReturnValue(companiesResult({ companies: [company()], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Convidado Um')).toBeInTheDocument();
    expect(screen.getByText('convidado1@test.local')).toBeInTheDocument();
    expect(screen.getByText('Gerente')).toBeInTheDocument();
    expect(screen.getByText('Revenda Premium')).toBeInTheDocument();
  });

  it('company_id=null: exibe "Plataforma KAPA"', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ company_id: null, role_kind: 'super_admin' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Plataforma KAPA')).toBeInTheDocument();
  });

  it('empresa não encontrada na lista acessível: texto neutro, lista não falha', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ company_id: 'company-invisivel' })], isEmpty: false, hasData: true }));
    m.useCompanies.mockReturnValue(companiesResult({ companies: [], isEmpty: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Convidado Um')).toBeInTheDocument();
    expect(screen.getByText('Empresa não disponível')).toBeInTheDocument();
  });

  it('Manager: coluna Empresa não aparece (ele já sabe qual é a própria empresa)', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-2" actor={MANAGER} />);
    expect(screen.queryByText('Revenda Premium')).toBeNull();
    expect(screen.queryByText('Plataforma KAPA')).toBeNull();
  });

  it('nenhum id técnico, invited_by_profile_id ou company_id bruto aparece como texto visível', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.queryByText('invite-1')).toBeNull();
    expect(screen.queryByText('manager-1')).toBeNull();
    expect(screen.queryByText('company-a')).toBeNull();
  });

  it('nenhum token/hash/link aparece em nenhum lugar do DOM', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(document.body.innerHTML).not.toMatch(/token_hash|invite_token|auth_token_hash|convite\/aceitar/i);
  });
});

describe('InviteList — status e matriz de ações', () => {
  it('pending (não expirado): rótulo Pendente, Reenviar e Cancelar disponíveis', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ status: 'pending', expires_at: '2099-01-01T00:00:00Z' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reenviar convite/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancelar convite/ })).toBeInTheDocument();
  });

  it('pending com expires_at no passado: exibido como Expirado (nunca Pendente), só Reenviar disponível (backend nunca cancela um expirado de fato)', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ status: 'pending', expires_at: '2020-01-01T00:00:00Z' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Expirado')).toBeInTheDocument();
    expect(screen.queryByText('Pendente')).toBeNull();
    expect(screen.getByRole('button', { name: /Reenviar convite/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancelar convite/ })).toBeNull();
  });

  it('expired (já materializado no banco): rótulo Expirado, só Reenviar', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ status: 'expired' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Expirado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reenviar convite/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancelar convite/ })).toBeNull();
  });

  it('accepted: rótulo Aceito, nenhuma ação', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ status: 'accepted', accepted_at: '2026-07-21T00:00:00Z' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Aceito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reenviar convite/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar convite/ })).toBeNull();
  });

  it('canceled: rótulo Cancelado, nenhuma ação', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ status: 'canceled' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reenviar convite/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar convite/ })).toBeNull();
  });

  it('superseded: rótulo Substituído, nenhuma ação', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite({ status: 'superseded' })], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(screen.getByText('Substituído')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reenviar convite/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar convite/ })).toBeNull();
  });
});

describe('InviteList — criação atualiza a lista', () => {
  it('onSent do InviteUserModal chama refetch da query correta', () => {
    const refetch = vi.fn();
    m.useInvites.mockReturnValue(invitesResult({ refetch }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByText('Convidar'));
    expect(m.inviteModalProps.current).toBeTruthy();
    m.inviteModalProps.current.onSent();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('modal recebe o actor exato repassado ao InviteList', () => {
    render(<InviteList userId="user-1" actor={MANAGER} />);
    fireEvent.click(screen.getByText('Convidar'));
    expect(m.inviteModalProps.current.actor).toEqual(MANAGER);
    expect(m.inviteModalProps.current.userId).toBe('user-1');
  });
});

describe('InviteList — reenvio', () => {
  function renderWithPendingInvite() {
    const refetch = vi.fn();
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true, refetch }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    return { refetch };
  }

  it('clicar Reenviar abre confirmação via window.__openFlow com título/aviso corretos, sem link antigo/novo', () => {
    renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Reenviar convite/ }));
    expect(m.openFlow).toHaveBeenCalledWith('confirmar', expect.objectContaining({
      title: 'Reenviar convite?',
      confirmLabel: 'Reenviar convite',
    }));
    const payload = m.openFlow.mock.calls[0][1];
    expect(payload.message).not.toMatch(/http|token|hash/i);
  });

  it('confirmar reenvio: chama resendInvite com o id certo, sucesso atualiza a lista (refetch)', async () => {
    const { refetch } = renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Reenviar convite/ }));
    const onConfirm = m.openFlow.mock.calls[0][1].onConfirm;
    onConfirm();
    await waitFor(() => expect(m.resendInviteMock).toHaveBeenCalledWith('invite-1'));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('erro no reenvio: mensagem amigável aparece na linha, lista NÃO some, refetch não é chamado', async () => {
    m.resendInviteMock.mockResolvedValue({ outcome: 'domain_error', code: 'invite_not_actionable' });
    const { refetch } = renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Reenviar convite/ }));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByText(/não pode mais ser reenviado/)).toBeInTheDocument());
    expect(screen.getByText('Convidado Um')).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('duplo clique (onConfirm chamado duas vezes) gera uma única chamada a resendInvite', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    m.resendInviteMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Reenviar convite/ }));
    const onConfirm = m.openFlow.mock.calls[0][1].onConfirm;
    onConfirm();
    onConfirm();
    resolveFn({ outcome: 'ok', inviteId: 'invite-new', previousInviteId: 'invite-1', status: 'pending', deliveryStatus: 'sent', expiresAt: '2099-01-01T00:00:00Z' });
    await waitFor(() => expect(m.resendInviteMock).toHaveBeenCalledTimes(1));
  });

  it('durante o reenvio, mostra "Processando…" em vez dos botões de ação', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    m.resendInviteMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Reenviar convite/ }));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByText('Processando…')).toBeInTheDocument());
    resolveFn({ outcome: 'ok', inviteId: 'invite-new', previousInviteId: 'invite-1', status: 'pending', deliveryStatus: 'sent', expiresAt: '2099-01-01T00:00:00Z' });
  });
});

describe('InviteList — cancelamento', () => {
  function renderWithPendingInvite() {
    const refetch = vi.fn();
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true, refetch }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    return { refetch };
  }

  it('clicar Cancelar abre confirmação com botão de dispensa "Voltar" (nunca "Cancelar", que colidiria com a ação)', () => {
    renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar convite/ }));
    expect(m.openFlow).toHaveBeenCalledWith('confirmar', expect.objectContaining({
      title: 'Cancelar convite?',
      confirmLabel: 'Cancelar convite',
      cancelLabel: 'Voltar',
      message: expect.stringContaining('histórico será preservado'),
    }));
  });

  it('confirmar cancelamento: usa somente useCancelInvite (RPC cancel_invite), sucesso atualiza a lista', async () => {
    const { refetch } = renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar convite/ }));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.cancelInviteMock).toHaveBeenCalledWith('invite-1'));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('erro no cancelamento (cross-tenant/invite_not_found): mensagem segura, linha não é removida', async () => {
    m.cancelInviteMock.mockResolvedValue({ outcome: 'domain_error', code: 'invite_not_found' });
    renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar convite/ }));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(screen.getByText(/não está mais disponível/)).toBeInTheDocument());
    expect(screen.getByText('Convidado Um')).toBeInTheDocument();
  });

  it('duplo clique (onConfirm duas vezes) gera uma única chamada a cancelInvite', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    m.cancelInviteMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    renderWithPendingInvite();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar convite/ }));
    const onConfirm = m.openFlow.mock.calls[0][1].onConfirm;
    onConfirm();
    onConfirm();
    resolveFn({ outcome: 'ok', inviteId: 'invite-1', status: 'canceled' });
    await waitFor(() => expect(m.cancelInviteMock).toHaveBeenCalledTimes(1));
  });
});

describe('InviteList — segurança', () => {
  it('nenhum acesso a localStorage/sessionStorage durante listagem e ações', async () => {
    const lsSpy = vi.spyOn(Storage.prototype, 'setItem');
    const refetch = vi.fn();
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true, refetch }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    fireEvent.click(screen.getByRole('button', { name: /Reenviar convite/ }));
    m.openFlow.mock.calls[0][1].onConfirm();
    await waitFor(() => expect(m.resendInviteMock).toHaveBeenCalled());
    expect(lsSpy).not.toHaveBeenCalled();
    lsSpy.mockRestore();
  });

  it('access token nunca aparece em nenhum atributo do DOM', () => {
    m.useInvites.mockReturnValue(invitesResult({ invites: [invite()], isEmpty: false, hasData: true }));
    render(<InviteList userId="user-1" actor={SUPER_ADMIN} />);
    expect(document.body.innerHTML).not.toContain('access-token-x');
  });
});
