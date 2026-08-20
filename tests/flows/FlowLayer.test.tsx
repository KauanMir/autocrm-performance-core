// Testes de FlowLayer (M1-E, E5-B2-A1) — gate central dos flows comerciais
// locais. Todos os componentes de Flows2/Flows3/FlowsShared são mockados por
// stubs simples (identificam-se pelo texto) — o teste cobre exclusivamente
// o roteamento/gate do FlowLayer, nunca a lógica interna de cada flow (já
// coberta em seus próprios arquivos de teste). isLocalCommercialDataAllowed
// é mockado para controlar o modo determinística.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ isLocalCommercialDataAllowed: vi.fn() }));

vi.mock('@/lib/leads/localCommercialAccess', () => ({
  isLocalCommercialDataAllowed: mocks.isLocalCommercialDataAllowed,
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
  FlowConfirmarVisita: stub('FlowConfirmarVisita'),
  FlowRegistrarResultado: stub('FlowRegistrarResultado'),
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

const COMMERCIAL_FLOW_IDS = [
  'criar-visita', 'confirmar-visita', 'registrar-resultado',
  'nova-proposta', 'aprovar-proposta', 'registrar-venda',
  'criar-acompanhamento', 'reagendar-pendencia',
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
    render(<FlowLayer flow={{ id: 'criar-visita', payload: {} }} close={close} openFlow={() => {}} go={() => {}} />);
    // FlowShell real (não mockado) renderiza dois botões de fechar (header) —
    // qualquer um deles deve chamar close.
    const buttons = screen.getAllByRole('button');
    buttons[0].click();
    expect(close).toHaveBeenCalled();
  });
});

// COMMERCIAL-REMOTE-B1-B3-D: 'nova-pendencia' SAIU de LOCAL_COMMERCIAL_FLOW_
// IDS — Task tem backend remoto próprio (FlowNovaPendencia decide local/
// remoto sozinho via resolveTaskRemoteMode(), nunca mais lançando em modo
// remoto). Diferente de NON_COMMERCIAL_FLOW_IDS (flows que nunca foram
// comerciais) — este é um flow comercial que deixou de ser bloqueado por
// ESTE gate especificamente, por isso tem sua própria suíte.
describe('FlowLayer — nova-pendencia não é mais bloqueado por isLocalCommercialDataAllowed', () => {
  it('modo local: monta o componente real', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(true);
    renderFlow('nova-pendencia');
    expect(screen.getByText('FlowNovaPendencia')).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });

  it('modo NÃO local (Leads remoto): monta o componente real mesmo assim — o próprio flow decide local/remoto', () => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow('nova-pendencia');
    expect(screen.getByText('FlowNovaPendencia')).toBeInTheDocument();
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});

describe('FlowLayer — reagendar-pendencia/criar-acompanhamento continuam bloqueados (regressão)', () => {
  it.each(['reagendar-pendencia', 'criar-acompanhamento'])('%s: continua mostrando estado indisponível em modo NÃO local', (id) => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow(id);
    expect(screen.getByText('Módulo indisponível')).toBeInTheDocument();
    expect(screen.queryByText(STUB_LABEL_BY_FLOW_ID[id])).toBeNull();
  });
});

describe('FlowLayer — flows NÃO comerciais nunca são afetados pelo gate', () => {
  it.each(NON_COMMERCIAL_FLOW_IDS)('%s: monta normalmente mesmo com isLocalCommercialDataAllowed=false', (id) => {
    mocks.isLocalCommercialDataAllowed.mockReturnValue(false);
    renderFlow(id);
    expect(screen.queryByText('Módulo indisponível')).toBeNull();
  });
});
