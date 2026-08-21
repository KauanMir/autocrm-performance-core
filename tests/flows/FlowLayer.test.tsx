// Testes de FlowLayer (M1-E, E5-B2-A1) — gate central dos flows comerciais
// locais. Todos os componentes de Flows2/Flows3/FlowsShared são mockados por
// stubs simples (identificam-se pelo texto) — o teste cobre exclusivamente
// o roteamento/gate do FlowLayer, nunca a lógica interna de cada flow (já
// coberta em seus próprios arquivos de teste). isLocalCommercialDataAllowed
// é mockado para controlar o modo determinística; resolveVisitRemoteMode
// idem (COMMERCIAL-REMOTE-VISITS-B4) — só o gate dedicado de criar-visita
// o consulta. resolveDealRemoteMode idem (COMMERCIAL-REMOTE-DEALS-B4) — só
// o gate dedicado de nova-proposta o consulta.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  isLocalCommercialDataAllowed: vi.fn(),
  resolveVisitRemoteMode: vi.fn(),
  resolveDealRemoteMode: vi.fn(),
}));

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: mocks.isLocalCommercialDataAllowed,
}));

vi.mock('@/lib/visits/remoteVisitsMode', () => ({
  resolveVisitRemoteMode: mocks.resolveVisitRemoteMode,
}));

vi.mock('@/lib/deals/remoteDealsMode', () => ({
  resolveDealRemoteMode: mocks.resolveDealRemoteMode,
}));

function stub(label: string) {
  return function Stub({ close }: any) {
    return (
      <div>
        <span>{label}</span>
        <button onClick={close}>fechar-stub</button>
      </div>
    );
  };
}

vi.mock('@/components/flows/FlowsShared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/flows/FlowsShared')>();
  return {
    ...actual,
    FlowLigar: stub('FlowLigar'),
    FlowVerCliente: stub('FlowVerCliente'),
  };
});

vi.mock('@/components/flows/Flows2', () => ({
  FlowNovoCliente: stub('FlowNovoCliente'),
  FlowEditarCliente: stub('FlowEditarCliente'),
  FlowCriarVisita: stub('FlowCriarVisita'),
  FlowReagendarVisita: stub('FlowReagendarVisita'),
  FlowConfirmarVisita: stub('FlowConfirmarVisita'),
  FlowRegistrarResultado: stub('FlowRegistrarResultado'),
  FlowRegistrarResultadoRemoto: stub('FlowRegistrarResultadoRemoto'),
  FlowNovaProposta: stub('FlowNovaProposta'),
  FlowAprovarProposta: stub('FlowAprovarProposta'),
  FlowRegistrarVenda: stub('FlowRegistrarVenda'),
  FlowNovaPendencia: stub('FlowNovaPendencia'),
  FlowReagendarPendencia: stub('FlowReagendarPendencia'),
  FlowCriarAcompanhamento: stub('FlowCriarAcompanhamento'),
}));

vi.mock('@/components/flows/Flows3', () => ({
  FlowPerfilVendedor: stub('FlowPerfilVendedor'),
  FlowNotificacoes: stub('FlowNotificacoes'),
  FlowBusca: stub('FlowBusca'),
  FlowEnviarMensagem: stub('FlowEnviarMensagem'),
  FlowConfirmar: stub('FlowConfirmar'),
  FlowEstados: stub('FlowEstados'),
}));

import { FlowLayer } from '@/components/flows/FlowLayer';

// 'criar-visita' SAIU desta lista (COMMERCIAL-REMOTE-VISITS-B4) — não é
// mais gated por isLocalCommercialDataAllowed(); tem seu próprio gate
// dedicado (resolveVisitRemoteMode()), testado separadamente abaixo.
// 'nova-proposta' SAIU pelo mesmo motivo (COMMERCIAL-REMOTE-DEALS-B4) —
// gate dedicado (resolveDealRemoteMode()), testado separadamente abaixo.
const COMMERCIAL_FLOW_IDS = [
  'confirmar-visita', 'registrar-resultado',
  'aprovar-proposta', 'registrar-venda',
  'criar-acompanhamento',
];

const NON_COMMERCIAL_FLOW_IDS = [
  'ligar', 'ver-cliente', 'novo-cliente', 'editar-cliente',
  'perfil-vendedor', 'notificacoes', 'busca', 'enviar-mensagem', 'confirmar', 'estados',
];

function renderFlow(id: string, payload: any = {}) {
  return render(
    <FlowLayer flow={{ id, payload }} close={() => {}} openFlow={() => {}} go={() => {}} />,
  );
}

beforeEach(() => {
  mocks.isLocalCommercialDataAllowed.mockReset();
  // Default 'visit_local' — irrelevante para a maioria destes testes (só
  // criar-visita consulta este resolver); mantém os demais determinísticos
  // sem precisar mockar em cada teste que não fala sobre Visits.
  mocks.resolveVisitRemoteMode.mockReset().mockReturnValue('visit_local');
  // Default 'deal_local' — mesmo raciocínio, só nova-proposta consulta.
  mocks.resolveDealRemoteMode.mockReset().mockReturnValue('deal_local');
});

describe('FlowLayer — flow.id nulo/desconhecido', () => {
  it('flow null: não renderiza nada', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    const { container } = render(
      <FlowLayer flow={null} close={() => {}} openFlow={() => {}} go={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('flow.id desconhecido: não renderiza nada, mesmo em modo local', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    const { container } = renderFlow('flow-inexistente');
    expect(container).toBeEmptyDOMElement();
  });
});

const STUB_LABEL_BY_FLOW_ID: Record<string, string> = {
  'criar-visita': 'FlowCriarVisita',
  'confirmar-visita': 'FlowConfirmarVisita',
  'registrar-resultado': 'FlowRegistrarResultado',
  'nova-proposta': 'FlowNovaProposta',
  'aprovar-proposta': 'FlowAprovarProposta',
  'registrar-venda': 'FlowRegistrarVenda',
  'criar-acompanhamento': 'FlowCriarAcompanhamento',
  'nova-pendencia': 'FlowNovaPendencia',
  'reagendar-pendencia': 'FlowReagendarPendencia',
};

describe('FlowLayer — modo local: todos os flows comerciais montam normalmente', () => {
  it.each(COMMERCIAL_FLOW_IDS)('%s monta o componente real em modo local', (id) => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow(id);
    expect(screen.getByText(STUB_LABEL_BY_FLOW_ID[id])).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

describe('FlowLayer — modo NÃO local: gate bloqueia todos os flows comerciais', () => {
  it.each(COMMERCIAL_FLOW_IDS)('%s: mostra estado indisponível, nunca monta o componente real', (id) => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow(id, { lead: { id: 'lead-remoto-1' }, visit: { id: 'v1' }, deal: { id: 'd1' }, task: { id: 't1' } });
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.getByText(/serão disponibilizados após a migração/)).toBeInTheDocument();
  });

  it('não depende do payload — mesmo com um Lead/Visit/Deal "antigo" no payload, recusa sem lê-lo', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow('confirmar-visita', { visit: { id: 'visit-orfa', client: 'Nome Real' } });
    expect(screen.queryByText('Nome Real')).toBeNull();
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
  });

  it('estado indisponível tem botão de fechar funcional', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    const close = vi.fn();
    render(<FlowLayer flow={{ id: 'confirmar-visita', payload: {} }} close={close} openFlow={() => {}} go={() => {}} />);
    // FlowShell real (não mockado) renderiza dois botões de fechar (header) —
    // qualquer um deles deve chamar close.
    const buttons = screen.getAllByRole('button');
    buttons[0].click();
    expect(close).toHaveBeenCalled();
  });
});

// COMMERCIAL-REMOTE-B1-B3-D/E: 'nova-pendencia' e 'reagendar-pendencia'
// SAÍRAM de LOCAL_COMMERCIAL_FLOW_IDS — Task tem backend remoto próprio
// (FlowNovaPendencia/FlowReagendarPendencia decidem local/remoto sozinhos
// via resolveTaskRemoteMode(), nunca mais lançando em modo remoto).
// Diferente de NON_COMMERCIAL_FLOW_IDS (flows que nunca foram comerciais)
// — são flows comerciais que deixaram de ser bloqueados por ESTE gate
// especificamente, por isso têm sua própria suíte.
describe.each(['nova-pendencia', 'reagendar-pendencia'])('FlowLayer — %s não é mais bloqueado por isLocalCommercialDataAllowed', (id) => {
  it('modo local: monta o componente real', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow(id, { task: { id: 't1' } });
    expect(screen.getByText(STUB_LABEL_BY_FLOW_ID[id])).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });

  it('modo NÃO local (Leads remoto): monta o componente real mesmo assim — o próprio flow decide local/remoto', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow(id, { task: { id: 't1' } });
    expect(screen.getByText(STUB_LABEL_BY_FLOW_ID[id])).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

// COMMERCIAL-REMOTE-VISITS-B4 — 'criar-visita' SAIU de
// LOCAL_COMMERCIAL_FLOW_IDS mas, diferente de nova-pendencia/reagendar-
// pendencia (que não ganharam gate nenhum em FlowLayer), ganhou um gate
// DEDICADO baseado em resolveVisitRemoteMode() (B4-PRECHECK-R1 §9) — a
// abertura é bloqueada, não só a mutation. isLocalCommercialDataAllowed é
// irrelevante aqui de propósito (o gate de criar-visita nunca a consulta).
describe.each(['visit_local', 'visit_remote_ready'] as const)('FlowLayer — criar-visita permitido em %s', (mode) => {
  it('monta o componente real, independente de isLocalCommercialDataAllowed', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    mocks.isLocalCommercialDataAllowed.mockReturnValue(mode === 'visit_local');
    renderFlow('criar-visita');
    expect(screen.getByText('FlowCriarVisita')).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

describe.each(['visit_blocked', 'visit_remote_misconfigured'] as const)('FlowLayer — criar-visita bloqueado em %s', (mode) => {
  it('mostra estado indisponível, nunca monta o componente real', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    // isLocalCommercialDataAllowed=true não pode "salvar" a abertura — o
    // gate de criar-visita depende só do modo de Visits.
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow('criar-visita');
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('FlowCriarVisita')).toBeNull();
  });
});

describe('FlowLayer — criar-visita: gate caller-independent (B4-PRECHECK-R1 §11)', () => {
  it('bloqueia mesmo com um payload.lead anexado, sem lê-lo', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_blocked');
    renderFlow('criar-visita', { lead: { id: 'lead-1', name: 'Nome Real' } });
    expect(screen.queryByText('Nome Real')).toBeNull();
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
  });
});

// COMMERCIAL-REMOTE-DEALS-B4 — 'nova-proposta' SAIU de
// LOCAL_COMMERCIAL_FLOW_IDS e ganhou um gate DEDICADO baseado em
// resolveDealRemoteMode(), mesmo contrato exato de criar-visita (Visits
// B4): a abertura é bloqueada, não só a mutation.
// isLocalCommercialDataAllowed é irrelevante aqui de propósito (o gate de
// nova-proposta nunca a consulta).
describe.each(['deal_local', 'deal_remote_ready'] as const)('FlowLayer — nova-proposta permitido em %s', (mode) => {
  it('monta o componente real, independente de isLocalCommercialDataAllowed', () => {
    mocks.resolveDealRemoteMode.mockReturnValue(mode);
    mocks.isLocalCommercialDataAllowed.mockReturnValue(mode === 'deal_local');
    renderFlow('nova-proposta');
    expect(screen.getByText('FlowNovaProposta')).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

describe.each(['deal_blocked', 'deal_remote_misconfigured'] as const)('FlowLayer — nova-proposta bloqueado em %s', (mode) => {
  it('mostra estado indisponível, nunca monta o componente real', () => {
    mocks.resolveDealRemoteMode.mockReturnValue(mode);
    // isLocalCommercialDataAllowed=true não pode "salvar" a abertura — o
    // gate de nova-proposta depende só do modo de Deals.
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow('nova-proposta');
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('FlowNovaProposta')).toBeNull();
  });
});

describe('FlowLayer — nova-proposta: gate caller-independent', () => {
  it('bloqueia mesmo com um payload.lead anexado, sem lê-lo', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_blocked');
    renderFlow('nova-proposta', { lead: { id: 'lead-1', name: 'Nome Real' } });
    expect(screen.queryByText('Nome Real')).toBeNull();
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
  });

  it('criar-visita continua correto (regressão B4 de Visits, não afetado pelo B4 de Deals)', () => {
    mocks.resolveDealRemoteMode.mockReturnValue('deal_blocked');
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_local');
    renderFlow('criar-visita');
    expect(screen.getByText('FlowCriarVisita')).toBeInTheDocument();
  });

  it('aprovar-proposta/registrar-venda continuam local-only (regressão)', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow('aprovar-proposta');
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    renderFlow('registrar-venda');
    expect(screen.getAllByText('Módulo indisponível').length).toBeGreaterThan(0);
  });
});

// COMMERCIAL-REMOTE-VISITS-B5 — 'reagendar-visita' é um flow id NOVO
// (nunca existiu em LOCAL_COMMERCIAL_FLOW_IDS), REMOTE-ONLY: diferente de
// criar-visita, 'visit_local' também BLOQUEIA aqui — não existe
// implementação local deste flow (o reagendamento local continua dentro
// de FlowConfirmarVisita, que abre 'criar-visita', nunca este id).
describe('FlowLayer — reagendar-visita permitido em visit_remote_ready', () => {
  it('monta o componente real', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    renderFlow('reagendar-visita', { visit: { id: 'v1' } });
    expect(screen.getByText('FlowReagendarVisita')).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

describe.each(['visit_local', 'visit_blocked', 'visit_remote_misconfigured'] as const)('FlowLayer — reagendar-visita bloqueado em %s', (mode) => {
  it('mostra estado indisponível, nunca monta o componente real', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow('reagendar-visita', { visit: { id: 'v1' } });
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('FlowReagendarVisita')).toBeNull();
  });
});

describe('FlowLayer — reagendar-visita: gate caller-independent, e criar-visita/confirmar-visita/registrar-resultado sem widening', () => {
  it('bloqueia reagendar-visita mesmo com payload.visit anexado, sem lê-lo', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_blocked');
    renderFlow('reagendar-visita', { visit: { id: 'v1', clientName: 'Nome Real' } });
    expect(screen.queryByText('Nome Real')).toBeNull();
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
  });

  it('criar-visita continua permitido em visit_local e visit_remote_ready (regressão B4, não afetado por B5)', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_local');
    renderFlow('criar-visita');
    expect(screen.getByText('FlowCriarVisita')).toBeInTheDocument();
  });

  it('confirmar-visita/registrar-resultado continuam bloqueados fora do modo local (regressão)', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow('confirmar-visita');
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    renderFlow('registrar-resultado');
    expect(screen.getAllByText('Módulo indisponível').length).toBeGreaterThan(0);
  });
});

// COMMERCIAL-REMOTE-VISITS-B6-B — 'registrar-resultado-remoto' é outro
// flow id NOVO REMOTE-ONLY, mesmo contrato exato de 'reagendar-visita'
// (B5): 'visit_local' também bloqueia (o registro local continua atrás de
// 'registrar-resultado', em LOCAL_COMMERCIAL_FLOW_IDS, intocado).
describe('FlowLayer — registrar-resultado-remoto permitido em visit_remote_ready', () => {
  it('monta o componente real', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    renderFlow('registrar-resultado-remoto', { visit: { id: 'v1' } });
    expect(screen.getByText('FlowRegistrarResultadoRemoto')).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

describe.each(['visit_local', 'visit_blocked', 'visit_remote_misconfigured'] as const)('FlowLayer — registrar-resultado-remoto bloqueado em %s', (mode) => {
  it('mostra estado indisponível, nunca monta o componente real', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue(mode);
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow('registrar-resultado-remoto', { visit: { id: 'v1' } });
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('FlowRegistrarResultadoRemoto')).toBeNull();
  });
});

describe('FlowLayer — registrar-resultado-remoto: gate caller-independent, e demais flows Visits sem widening', () => {
  it('bloqueia mesmo com payload.visit anexado, sem lê-lo', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_blocked');
    renderFlow('registrar-resultado-remoto', { visit: { id: 'v1', clientName: 'Nome Real' } });
    expect(screen.queryByText('Nome Real')).toBeNull();
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
  });

  it('criar-visita e reagendar-visita continuam corretos (regressão B4/B5, não afetados por B6-B)', () => {
    mocks.resolveVisitRemoteMode.mockReturnValue('visit_local');
    renderFlow('criar-visita');
    expect(screen.getByText('FlowCriarVisita')).toBeInTheDocument();

    mocks.resolveVisitRemoteMode.mockReturnValue('visit_remote_ready');
    renderFlow('reagendar-visita', { visit: { id: 'v1' } });
    expect(screen.getByText('FlowReagendarVisita')).toBeInTheDocument();
  });

  it('registrar-resultado local continua local-only (regressão)', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow('registrar-resultado');
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('FlowRegistrarResultado')).toBeNull();
  });
});

describe('FlowLayer — criar-acompanhamento continua bloqueado (regressão)', () => {
  it('continua mostrando estado indisponível em modo NÃO local', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow('criar-acompanhamento');
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('FlowCriarAcompanhamento')).toBeNull();
  });
});

describe('FlowLayer — flows NÃO comerciais nunca são afetados pelo gate', () => {
  it.each(NON_COMMERCIAL_FLOW_IDS)('%s: monta normalmente mesmo com isLocalCommercialDataAllowed=false', (id) => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow(id);
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});
