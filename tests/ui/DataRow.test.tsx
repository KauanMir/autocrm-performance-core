// tests/ui/DataRow.test.tsx — MOBILE-RESPONSIVENESS-V1-B2-EXEC §35/§37.
// DataRow (branch desktop x mobile, slots, truncation), RowActionMenu
// (abrir/ESC/click-fora/selecionar), ChipRow (scroller < md).
// jsdom não faz layout — os testes verificam o CONTRATO estrutural/estilo,
// não pixels.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataRow, RowActionMenu } from '@/components/ui/DataRow';
import { ChipRow } from '@/components/ui/primitives';

const ORIGINAL_WIDTH = window.innerWidth;
function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: px });
}
afterEach(() => setWidth(ORIGINAL_WIDTH));

function baseRow(over: Partial<React.ComponentProps<typeof DataRow>> = {}) {
  return (
    <DataRow
      testId="row"
      leading={<div data-testid="lead">L</div>}
      title="Fulano da Silva"
      subtitle={<span data-testid="sub">carro · vendedor</span>}
      status={<span data-testid="status">Agendada</span>}
      meta={<span data-testid="meta">14:00</span>}
      actions={<button data-testid="act">Confirmar</button>}
      {...over}
    />
  );
}

describe('DataRow — branch desktop (>= md)', () => {
  beforeEach(() => setWidth(1200));

  it('renderiza todos os slots numa linha (flex row)', () => {
    render(baseRow());
    const row = screen.getByTestId('row');
    expect(row.style.display).toBe('flex');
    expect(row.style.flexDirection === '' || row.style.flexDirection === 'row').toBe(true);
    for (const id of ['lead', 'sub', 'status', 'meta', 'act']) {
      expect(within(row).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(row).getByText('Fulano da Silva')).toBeInTheDocument();
  });

  it('onClick torna a linha clicável', () => {
    const onClick = vi.fn();
    render(baseRow({ onClick }));
    fireEvent.click(screen.getByTestId('row'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('DataRow — branch mobile (< md)', () => {
  beforeEach(() => setWidth(390));

  it('empilha em coluna e preserva TODOS os dados (nada removido)', () => {
    render(baseRow());
    const row = screen.getByTestId('row');
    expect(row.style.flexDirection).toBe('column');
    for (const id of ['lead', 'sub', 'status', 'meta', 'act']) {
      expect(within(row).getByTestId(id)).toBeInTheDocument();
    }
  });

  it('sem actions: não renderiza a zona de ações, mas mantém título/status', () => {
    render(baseRow({ actions: undefined }));
    const row = screen.getByTestId('row');
    expect(within(row).queryByTestId('act')).toBeNull();
    expect(within(row).getByText('Fulano da Silva')).toBeInTheDocument();
    expect(within(row).getByTestId('status')).toBeInTheDocument();
  });
});

describe('RowActionMenu', () => {
  beforeEach(() => setWidth(390));

  it('fechado por padrão; abre no clique; itens viram menuitem', () => {
    const remarcar = vi.fn();
    const cancelar = vi.fn();
    render(
      <RowActionMenu items={[
        { label: 'Remarcar', icon: 'refresh', onSelect: remarcar },
        { label: 'Cancelar', icon: 'xCircle', tone: 'danger', onSelect: cancelar },
      ]} />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Remarcar' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('selecionar um item dispara onSelect e fecha o menu', () => {
    const remarcar = vi.fn();
    render(<RowActionMenu items={[{ label: 'Remarcar', onSelect: remarcar }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remarcar' }));
    expect(remarcar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ESC fecha o menu', () => {
    render(<RowActionMenu items={[{ label: 'X', onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('clique fora fecha o menu', () => {
    render(<div><RowActionMenu items={[{ label: 'X', onSelect: vi.fn() }]} /><span data-testid="outside">fora</span></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lista vazia: não renderiza nada', () => {
    const { container } = render(<RowActionMenu items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('botão gatilho tem área de toque >= 40px', () => {
    render(<RowActionMenu items={[{ label: 'X', onSelect: vi.fn() }]} />);
    const btn = screen.getByRole('button', { name: 'Mais ações' });
    expect(btn.style.width).toBe('40px');
    expect(btn.style.height).toBe('40px');
  });
});

describe('ChipRow', () => {
  const chips = <><button>A</button><button>B</button><button>C</button></>;

  it('>= md: quebra organizada (flex-wrap: wrap)', () => {
    setWidth(1200);
    const { container } = render(<ChipRow>{chips}</ChipRow>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.flexWrap).toBe('wrap');
    expect(el.style.overflowX === '' || el.style.overflowX === 'visible').toBe(true);
  });

  it('< md: scroller horizontal de uma linha (nowrap + overflow-x auto)', () => {
    setWidth(390);
    const { container } = render(<ChipRow>{chips}</ChipRow>);
    const el = container.firstChild as HTMLElement;
    expect(el.style.flexWrap).toBe('nowrap');
    expect(el.style.overflowX).toBe('auto');
    // todos os chips continuam presentes
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});
