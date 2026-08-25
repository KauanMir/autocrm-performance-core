// Testes da aba Etapas de ScreenAjustes (M1-D, commit 7).
// usePipelineStages/useReorderStages mockados; services mockados; sem rede.
// O helper getReorderStagesErrorMessage permanece REAL (partial mock).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { adaptLocalStageNames } from '@/lib/pipeline/localStages';
import type { PipelineStage } from '@/lib/pipeline/adapter';

const m = vi.hoisted(() => ({
  usePipelineStages: vi.fn(),
  useReorderStages: vi.fn(),
  reorderStagesLocal: vi.fn(),
  getStages: vi.fn(),
  leadServiceGetAll: vi.fn(() => [] as any[]),
  user: { current: null as any },
}));

vi.mock('@/lib/hooks/usePipelineStages', () => ({
  usePipelineStages: m.usePipelineStages,
}));

vi.mock('@/lib/hooks/useReorderStages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useReorderStages')>();
  return { ...actual, useReorderStages: m.useReorderStages };
});

vi.mock('@/lib/store', () => ({ useStore: () => ({}) }));

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — ScreenAjustes agora consome
// OperationalCompanyContext (aba Empresa). mode:'none' preserva 100% o
// comportamento anterior (Manager continua via activeMembership.companyId).
vi.mock('@/lib/operational/OperationalCompanyContext', () => ({
  useOperationalCompanyContext: () => ({
    mode: 'none', companyId: null, identity: { status: 'unavailable' }, isReadOnly: false,
  }),
}));

vi.mock('@/components/podiums/Podiums', () => ({ PLACE: {} }));

// Stub — este arquivo testa visibilidade de aba/guard, nunca o conteúdo da
// listagem de convites (isso é tests/components/invites/InviteList.test.tsx
// e tests/screens/ScreenAjustesInvites.test.tsx). Sem o stub, InviteList
// chamaria useInvites/useCompanies reais e exigiria QueryClientProvider.
vi.mock('@/components/invites/InviteList', () => ({
  InviteList: () => <div data-testid="invite-list-stub" />,
}));

vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => m.leadServiceGetAll() },
  VisitService: { getAll: () => [] },
  DealService: { getAll: () => [] },
  SaleService: { getAll: () => [] },
  SellerService: { getAll: () => [] },
  AuthService: { getCurrentUser: () => m.user.current },
  CompanyService: {
    get: () => ({ name: 'Loja', cnpj: '', phone: '', timezone: '' }),
    update: () => {},
  },
  PipelineService: { reorderStages: m.reorderStagesLocal, getStages: m.getStages },
}));

import { ScreenAjustes } from '@/components/screens/ScreensBiz';

const LOCAL_NAMES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

function stage(code: string, name: string, sortOrder: number, isTerminal = false): PipelineStage {
  return { id: `uuid-${code}`, code, name, sortOrder, isTerminal };
}

const REMOTE_STAGES: PipelineStage[] = [
  stage('new', 'Novo', 0),
  stage('qualified', 'Qualificado', 1),
  stage('visit_scheduled', 'Visita agendada', 2),
  stage('negotiation', 'Em negociação', 3),
  stage('closing', 'Fechamento', 4, true),
];

function pipelineResult(over: Partial<Record<string, unknown>> = {}) {
  const stages = (over.stages as PipelineStage[] | undefined) ?? [];
  return {
    source: 'remote', remoteStagesEnabled: true, queryEnabled: true,
    queryKey: ['company', 'company-a', 'pipeline-stages'],
    stages, byId: {}, byCode: {}, byName: {},
    isLoading: false, isFetching: false, isError: false, error: null,
    configError: null, isEmpty: false, hasData: stages.length > 0,
    refetch: vi.fn(),
    ...over,
  };
}

function reorderResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    reorderStages: vi.fn().mockResolvedValue({ ok: true }),
    isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
    ...over,
  };
}

function openEtapas() {
  render(<ScreenAjustes go={() => {}} />);
  fireEvent.click(screen.getByText('Etapas'));
}

function dragTo(fromTestId: string, toTestId: string) {
  fireEvent.dragStart(screen.getByTestId(fromTestId), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
  fireEvent.drop(screen.getByTestId(toTestId), { dataTransfer: {} });
}

beforeEach(() => {
  m.user.current = { id: 'user-1', name: 'Admin', email: 'a@a.com' };
  m.leadServiceGetAll.mockReset().mockReturnValue([]);
  m.getStages.mockReturnValue(LOCAL_NAMES);
  m.usePipelineStages.mockReturnValue(pipelineResult({
    source: 'local', remoteStagesEnabled: false, queryEnabled: false,
    stages: adaptLocalStageNames(LOCAL_NAMES),
  }));
  m.useReorderStages.mockReturnValue(reorderResult());
});

// ── A. Caminho local ─────────────────────────────────────────────────────

describe('ScreenAjustes/Etapas — caminho local (flag OFF)', () => {
  // M1-F S8-B1: canAccessFullSettings migrou de role='admin' (legado) para
  // platformRole='super_admin' — estes testes cobrem o comportamento da
  // aba Etapas em si (drag local), não a matriz de capabilities (isso é o
  // bloco D), então representam o ator com acesso pleno via Super Admin.
  beforeEach(() => {
    m.user.current = { ...m.user.current, platformRole: 'super_admin' };
  });

  it('usa a ordem local, reordena por NAMES via PipelineService e não chama a mutation', () => {
    openEtapas();
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();

    // Arrasta 'Qualificado' sobre 'Fechamento' — na semântica LEGADA o índice
    // do alvo é calculado antes da remoção, então o item cai DEPOIS do alvo.
    dragTo('stage-row-qualified', 'stage-row-closing');
    expect(m.reorderStagesLocal).toHaveBeenCalledTimes(1);
    expect(m.reorderStagesLocal).toHaveBeenCalledWith([
      'Novo', 'Visita agendada', 'Em negociação', 'Fechamento', 'Qualificado',
    ]);
    const remote = m.useReorderStages.mock.results[0]?.value;
    expect(remote.reorderStages).not.toHaveBeenCalled();
  });

  it('mantém "Novo" fixado: primeira linha não é draggable e drop na posição 0 é ignorado', () => {
    openEtapas();
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    expect(screen.getByTestId('stage-row-qualified')).toHaveAttribute('draggable', 'true');

    dragTo('stage-row-qualified', 'stage-row-new');
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });
});

// ── B. Caminho remoto ────────────────────────────────────────────────────

describe('ScreenAjustes/Etapas — caminho remoto (flag ON)', () => {
  // M1-F S8-B1: mesma migração do bloco A — Super Admin representa o ator
  // com acesso pleno de Etapas/reorder nestes testes de mecânica de drag.
  beforeEach(() => {
    m.user.current = { ...m.user.current, platformRole: 'super_admin' };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
  });

  it('renderiza os stages remotos e envia TODOS os stage.id na nova ordem (sem names/codes)', () => {
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    openEtapas();

    // Arrasta 'Novo' para a posição de 'Em negociação' — "Novo" É móvel no remoto.
    dragTo('stage-row-new', 'stage-row-negotiation');

    expect(reorder.reorderStages).toHaveBeenCalledTimes(1);
    const sent = reorder.reorderStages.mock.calls[0][0];
    expect(sent).toEqual(['uuid-qualified', 'uuid-visit_scheduled', 'uuid-negotiation', 'uuid-new', 'uuid-closing']);
    expect(sent.every((id: string) => id.startsWith('uuid-'))).toBe(true);
    expect(sent).not.toContain('Novo');
    expect(sent).not.toContain('new');
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });

  it('não persiste mudança visual antes da resposta (ordem vem só do hook/cache)', () => {
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    openEtapas();
    dragTo('stage-row-closing', 'stage-row-new');
    // A mutation foi disparada, mas a ordem exibida continua a do hook.
    const rows = screen.getAllByTestId(/^stage-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'stage-row-new', 'stage-row-qualified', 'stage-row-visit_scheduled',
      'stage-row-negotiation', 'stage-row-closing',
    ]);
  });

  it('isPending bloqueia novos drags e mostra "Salvando ordem…"', () => {
    const reorder = reorderResult({ isPending: true });
    m.useReorderStages.mockReturnValue(reorder);
    openEtapas();

    expect(screen.getByTestId('stages-saving')).toHaveTextContent('Salvando ordem…');
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false');
    dragTo('stage-row-new', 'stage-row-closing');
    expect(reorder.reorderStages).not.toHaveBeenCalled();
  });

  it('erro mostra mensagem amigável e mantém a lista para nova tentativa', () => {
    m.useReorderStages.mockReturnValue(reorderResult({
      isError: true, error: { message: 'forbidden: manager/admin only' },
    }));
    openEtapas();
    expect(screen.getByTestId('stages-reorder-error'))
      .toHaveTextContent('Você não tem permissão para reordenar as etapas.');
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();
  });

  it('seller: acesso negado, nenhuma linha de etapa e hook recebe canReorder=false', () => {
    // platformRole explicitamente limpo, sem activeMembership — um Seller
    // sem capability alguma (User não carrega mais role/sellerId próprios,
    // §28.5 do design).
    m.user.current = { ...m.user.current, platformRole: null };
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    render(<ScreenAjustes go={() => {}} />);
    // Capabilities (commit 8): seller não tem NENHUMA aba — conteúdo proibido
    // não é montado, então não existe handler de reorder alcançável.
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
    expect(m.useReorderStages).toHaveBeenCalledWith(
      expect.objectContaining({ canReorder: false }),
    );
  });
});

// ── C. Estados remotos que bloqueiam reorder ─────────────────────────────

describe('ScreenAjustes/Etapas — estados remotos bloqueiam reorder', () => {
  // M1-F S8-B1: mesma migração dos blocos A/B.
  beforeEach(() => {
    m.user.current = { ...m.user.current, platformRole: 'super_admin' };
  });

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['loading', { stages: [], isLoading: true, hasData: false }, 'Carregando etapas…'],
    ['error', { stages: [], isError: true, error: new Error('x'), hasData: false }, 'Não foi possível carregar as etapas.'],
    ['configError', { stages: [], configError: { ok: false, reason: 'name-mismatch' }, hasData: false }, 'As etapas da loja não correspondem à configuração esperada.'],
    ['empty', { stages: [], isEmpty: true, hasData: false }, 'Nenhuma etapa configurada para sua loja.'],
    ['disabled', { stages: [], queryEnabled: false, hasData: false }, 'Sessão indisponível. Entre novamente para gerenciar as etapas.'],
  ];

  it.each(cases)('estado %s: sem linhas de etapa e com a mensagem correta', (_label, over, text) => {
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    m.usePipelineStages.mockReturnValue(pipelineResult(over));
    openEtapas();
    expect(screen.getByTestId('stages-remote-state')).toHaveTextContent(text);
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
  });
});

// ── D. Capabilities por role (commit 8) ──────────────────────────────────

describe('ScreenAjustes — capabilities e abas permitidas', () => {
  it('Super Admin flag OFF: Usuários/Etapas (nunca Empresa) e Etapas local preservada', () => {
    // COMPANY-SETTINGS-R1-EXEC: Empresa deixou de ser superfície de Super
    // Admin (canAccessFullSettings removida) — Super Admin nunca tem
    // activeMembership.companyId, então nunca ganha esta aba na Ajustes
    // genérica. "Abas completas" para Super Admin agora é Usuários+Etapas.
    m.user.current = { ...m.user.current, platformRole: 'super_admin' };
    render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Etapas')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Etapas'));
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'false'); // Novo fixado no legado
    expect(screen.getByTestId('stage-row-qualified')).toHaveAttribute('draggable', 'true');
  });

  it('Super Admin flag ON: Usuários/Etapas (nunca Empresa) e reorder remoto permitido, mesmo sem membership (canReorder=true, companyId=null)', () => {
    // M1-F S8-B1: Super Admin nunca tem activeMembership, por design — o
    // pipeline nunca é autorizado por Super Admin sem membership real
    // (§26.10/§27.6, inalterado por esta etapa): companyId chega null ao
    // hook mesmo com canReorder=true. COMPANY-SETTINGS-R1-EXEC: Empresa
    // nunca aparece para Super Admin na Ajustes genérica (sem company
    // context) — o teste equivalente para Manager real (que agora VÊ
    // Empresa) está logo abaixo.
    m.user.current = { ...m.user.current, platformRole: 'super_admin', activeMembership: null };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    openEtapas();
    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'true');
    expect(m.useReorderStages).toHaveBeenCalledWith(
      expect.objectContaining({ canReorder: true, companyId: null }),
    );
  });

  it('Manager com membership ATIVA, flag ON: Empresa, Usuários e Etapas (Empresa é superfície exclusiva de Manager)', () => {
    // COMPANY-SETTINGS-R1-EXEC: Manager com membership ativa agora ganha
    // Empresa (canManageCompanySettings) além de Usuários (canManageInvites)
    // e Etapas (canAccessStageSettings, flag ON) — as três capabilities são
    // independentes entre si, todas satisfeitas aqui.
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    render(<ScreenAjustes go={() => {}} />);

    // Empresa, Usuários E Etapas aparecem. Aba default 'Empresa' já
    // renderiza o fixture local (isLocalCommercialDataAllowed não é
    // mockado neste arquivo — flag remota OFF por padrão no ambiente de
    // teste, então o caminho local do fixture é o que sempre roda aqui).
    expect(screen.getByText('Empresa')).toBeInTheDocument();
    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Etapas')).toBeInTheDocument();
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Etapas'));
    expect(screen.getByTestId('stage-row-new')).toHaveAttribute('draggable', 'true');
    expect(m.useReorderStages).toHaveBeenCalledWith(
      expect.objectContaining({ canReorder: true }),
    );

    // Manager pode mover inclusive "Novo"; mutation recebe os ids; local nunca.
    dragTo('stage-row-new', 'stage-row-closing');
    expect(reorder.reorderStages).toHaveBeenCalledTimes(1);
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });

  it('manager flag OFF: acesso negado, sem Etapas local, sem reorder algum', () => {
    // Sem platformRole/activeMembership (fixture-base do describe) — nenhuma
    // capability concede acesso.
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    render(<ScreenAjustes go={() => {}} />); // pipeline default = local/flag OFF
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
    expect(m.reorderStagesLocal).not.toHaveBeenCalled();
  });

  it('troca Super Admin → Manager com membership ativa: Empresa aparece pela primeira vez (Super Admin nunca a tinha)', () => {
    // COMPANY-SETTINGS-R1-EXEC: Super Admin nunca vê Empresa (allowedTabs
    // cai para Usuários, primeiro item permitido — o `tab` state interno
    // continua 'Empresa' por baixo, sem efeito visível enquanto não está em
    // allowedTabs). Ao virar Manager, Empresa passa a existir em
    // allowedTabs e o `tab` state (nunca alterado por clique) já aponta pra
    // ela — reaparece imediatamente, sem precisar clicar em nada.
    m.user.current = { ...m.user.current, platformRole: 'super_admin' };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    const view = render(<ScreenAjustes go={() => {}} />);
    // Super Admin: sem Empresa, cai em 'Usuários' (primeiro item permitido).
    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.queryByText('Dados da loja')).toBeNull();
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();

    m.user.current = {
      ...m.user.current,
      platformRole: null,
      activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    };
    view.rerender(<ScreenAjustes go={() => {}} />);
    expect(screen.getByText('Empresa')).toBeInTheDocument();
    expect(screen.getByText('Dados da loja')).toBeInTheDocument();
    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Etapas')).toBeInTheDocument();
  });

  it('troca Manager (membership ativa) → Seller: todo o conteúdo some e nenhum handler antigo funciona', () => {
    // M1-F S8-B1: fixture desatualizado — manager real precisa de
    // activeMembership para o estado inicial ("tem acesso a Etapas") ser
    // alcançável.
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    const reorder = reorderResult();
    m.useReorderStages.mockReturnValue(reorder);
    const view = render(<ScreenAjustes go={() => {}} />);
    fireEvent.click(screen.getByText('Etapas'));
    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();

    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null },
    };
    view.rerender(<ScreenAjustes go={() => {}} />);
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-row-new')).toBeNull();
    expect(reorder.reorderStages).not.toHaveBeenCalled();
  });
});

// ── E. canManageInvites — aba "Usuários" (M1-F S4-F1) ────────────────────
// capability PRÓPRIA, independente de canManageCompanySettings/flag de
// Etapas. Manager com membership ativa vê Usuários E Empresa (COMPANY-
// SETTINGS-R1-EXEC: canManageCompanySettings, capability independente).
// Super Admin (platformRole) vê Usuários, mas NUNCA Empresa (exclusiva de
// Manager agora). Seller e Manager sem membership ativa continuam sem
// nenhum acesso, exatamente como antes desta etapa.

describe('ScreenAjustes — canManageInvites (S4-F1)', () => {
  it('Manager com membership ATIVA (role=manager) vê Usuários E Empresa mesmo com flag de Etapas OFF, mas NÃO vê Etapas', () => {
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    };
    render(<ScreenAjustes go={() => {}} />);

    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
    expect(screen.queryByText('Etapas')).toBeNull();
    expect(screen.queryByTestId('settings-denied')).toBeNull();
  });

  it('Manager com membership ATIVA + flag de Etapas ON: vê Usuários, Etapas E Empresa', () => {
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    render(<ScreenAjustes go={() => {}} />);

    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Etapas')).toBeInTheDocument();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
  });

  it('Manager com membership INATIVA (activeMembership null): sem acesso a Usuários — sem identidade empresarial, nenhuma capability concede nada', () => {
    m.user.current = { ...m.user.current, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);

    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
  });

  it('Super Admin (platformRole=super_admin) vê Usuários e Etapas — nunca Empresa (canManageCompanySettings é Manager-only), mesmo sem companyId/membership', () => {
    // COMPANY-SETTINGS-R1-EXEC: canAccessFullSettings foi removida —
    // Empresa não acompanha mais platformRole nenhum. Super Admin continua
    // vendo Usuários (canManageInvites) e Etapas (canAccessStageSettings),
    // capabilities independentes, intocadas por este lote.
    m.user.current = {
      ...m.user.current,
      platformRole: 'super_admin',
      activeMembership: null,
    };
    render(<ScreenAjustes go={() => {}} />);

    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.getByText('Etapas')).toBeInTheDocument();
  });

  it('Seller (activeMembership.role=seller) nunca vê Usuários nem nenhum outro controle administrativo', () => {
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'seller', sellerId: null },
    };
    render(<ScreenAjustes go={() => {}} />);

    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByText('Empresa')).toBeNull();
    expect(screen.queryByText('Etapas')).toBeNull();
    expect(screen.getByTestId('settings-denied')).toBeInTheDocument();
  });

  it('troca Manager-sem-membership → Manager-com-membership-ativa: Usuários E Empresa aparecem imediatamente juntos', () => {
    // COMPANY-SETTINGS-R1-EXEC: Empresa (canManageCompanySettings) e
    // Usuários (canManageInvites) são capabilities independentes, mas
    // ambas dependem da MESMA membership ativa — aparecem juntas.
    m.user.current = { ...m.user.current, activeMembership: null };
    const view = render(<ScreenAjustes go={() => {}} />);
    expect(screen.queryByText('Usuários')).toBeNull();
    expect(screen.queryByText('Empresa')).toBeNull();

    m.user.current = { ...m.user.current, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
    view.rerender(<ScreenAjustes go={() => {}} />);
    expect(screen.getByText('Usuários')).toBeInTheDocument();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
  });
});

// ── F. M1-F S7-B — companyId do pipeline/reorder deriva EXCLUSIVAMENTE de
//    activeMembership (correção dos dois consumidores legados) ─────────────
// usePipelineStages/useReorderStages são chamados incondicionalmente no topo
// do componente (Rules of Hooks) — não é preciso navegar para a aba Etapas
// para inspecionar os argumentos recebidos.

describe('ScreenAjustes — M1-F S7-B/S8-D1: companyId deriva exclusivamente de activeMembership', () => {
  it('activeMembership presente: os dois hooks recebem companyId da membership', () => {
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-real', role: 'manager', sellerId: null },
    };
    render(<ScreenAjustes go={() => {}} />);
    expect(m.usePipelineStages).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: 'company-real' }),
    );
    expect(m.useReorderStages).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: 'company-real' }),
    );
  });

  it('activeMembership ausente (null): companyId é null', () => {
    m.user.current = {
      ...m.user.current,
      activeMembership: null,
    };
    render(<ScreenAjustes go={() => {}} />);
    expect(m.usePipelineStages).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: null }),
    );
    expect(m.useReorderStages).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: null }),
    );
  });

  it('Super Admin sem activeMembership: companyId é null (Super Admin nunca tem empresa própria)', () => {
    m.user.current = {
      ...m.user.current,
      platformRole: 'super_admin',
      activeMembership: null,
    };
    render(<ScreenAjustes go={() => {}} />);
    expect(m.usePipelineStages).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: null }),
    );
    expect(m.useReorderStages).toHaveBeenLastCalledWith(
      expect.objectContaining({ companyId: null }),
    );
  });

  it('mudança de membership de empresa A para empresa B (transferência) atualiza os dois hooks', () => {
    m.user.current = { ...m.user.current, activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null } };
    const view = render(<ScreenAjustes go={() => {}} />);
    expect(m.usePipelineStages).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'company-a' }));
    expect(m.useReorderStages).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'company-a' }));

    m.user.current = { ...m.user.current, activeMembership: { companyId: 'company-b', role: 'manager', sellerId: null } };
    view.rerender(<ScreenAjustes go={() => {}} />);
    expect(m.usePipelineStages).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'company-b' }));
    expect(m.useReorderStages).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 'company-b' }));
  });

  it('membership suspensa/desligada (activeMembership null) não fornece empresa ativa', () => {
    m.user.current = { ...m.user.current, activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);
    expect(m.usePipelineStages).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: null }));
    expect(m.useReorderStages).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: null }));
  });
});

// ── G. COMMERCIAL-REMOTE-SUPER-ADMIN-S1-R1 — LeadService.getAll() isolado
//    do render de Super Admin (achado real do S1 smoke autenticado) ────────
// Os testes acima sempre mockaram LeadService.getAll como um retorno vazio
// que nunca lança — por isso nunca capturaram o crash real: em modo remoto
// o bridge de Leads nunca monta para Super Admin (sem activeMembership, por
// design) e LeadService.getAll() lança RemoteLeadsError:
// remote_leads_invalid_context nesse caso. Aqui o mock LANÇA, do mesmo jeito
// que o real, para provar que ScreenAjustes nunca mais chama a função para
// quem não tem contexto comercial.

describe('ScreenAjustes — Super Admin nunca toca LeadService (COMMERCIAL-REMOTE-SUPER-ADMIN-S1-R1)', () => {
  beforeEach(() => {
    m.leadServiceGetAll.mockReset().mockImplementation(() => {
      throw new Error('RemoteLeadsError: remote_leads_invalid_context');
    });
  });

  it('Super Admin (activeMembership=null): ScreenAjustes monta sem crash, LeadService.getAll zero chamadas', () => {
    m.user.current = { ...m.user.current, platformRole: 'super_admin', activeMembership: null };
    render(<ScreenAjustes go={() => {}} />);

    // COMPANY-SETTINGS-R1-EXEC: Super Admin nunca vê Empresa — aba default
    // cai para 'Usuários' (primeiro item permitido), que renderiza
    // normalmente — a tela inteira não caiu no AuthenticatedShellErrorBoundary.
    expect(screen.getByTestId('invite-list-stub')).toBeInTheDocument();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });

  it('Super Admin navega até a aba Etapas (onde `leads` seria consumido): ainda sem crash, ainda zero chamadas', () => {
    m.user.current = { ...m.user.current, platformRole: 'super_admin', activeMembership: null };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    openEtapas();

    expect(screen.getByTestId('stage-row-new')).toBeInTheDocument();
    expect(m.leadServiceGetAll).not.toHaveBeenCalled();
  });
});

describe('ScreenAjustes — Manager preserva a leitura de Leads (COMMERCIAL-REMOTE-SUPER-ADMIN-S1-R1)', () => {
  it('Manager com membership ativa, aba Etapas: LeadService.getAll É chamado (comportamento existente preservado)', () => {
    m.leadServiceGetAll.mockReset().mockReturnValue([
      { id: 'lead-1', stage: 'Novo' },
      { id: 'lead-2', stage: 'Novo' },
    ]);
    m.user.current = {
      ...m.user.current,
      activeMembership: { companyId: 'company-a', role: 'manager', sellerId: null },
    };
    m.usePipelineStages.mockReturnValue(pipelineResult({ stages: REMOTE_STAGES }));
    openEtapas();

    expect(m.leadServiceGetAll).toHaveBeenCalled();
    expect(screen.getByTestId('stage-row-new')).toHaveTextContent('2 clientes');
  });
});
