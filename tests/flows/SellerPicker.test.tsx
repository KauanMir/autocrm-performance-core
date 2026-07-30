// Testes de SellerPicker (presentacional, M1-E E4-B2) e LocalSellerPicker
// (renomeado do antigo SellerPicker, mesmo comportamento de sempre — usa
// SellerService.getAll() internamente). SellerPicker NUNCA importa
// SellerService: os testes provam isso mockando o módulo e verificando que
// a lista exibida vem só de `items`.
//
// A abertura do dropdown é sempre feita clicando o ÚNICO botão existente
// ANTES de abrir (o trigger) — depois de aberto, "Sem vendedor" pode
// aparecer tanto no trigger (quando value===null) quanto como opção do
// dropdown, então getByText ficaria ambíguo.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SellerPicker, LocalSellerPicker } from '@/components/flows/FlowsShared';

const sellerServiceGetAll = vi.fn();
vi.mock('@/lib/services', () => ({
  LeadService: { getAll: () => [] },
  TaskService: { getAll: () => [] },
  SellerService: { getAll: () => sellerServiceGetAll() },
}));

function openTrigger() {
  const [trigger] = screen.getAllByRole('button');
  fireEvent.click(trigger);
}

describe('SellerPicker (presentacional) — estados', () => {
  it('loading: trigger desabilitado, sem dropdown', () => {
    render(<SellerPicker items={[]} value={null} onChange={vi.fn()} loading />);
    expect(screen.getByText('Carregando vendedores…')).toBeInTheDocument();
    openTrigger();
    expect(screen.queryByText('Sem vendedor')).toBeNull();
  });

  it('error: mensagem sanitizada, sem dropdown', () => {
    render(<SellerPicker items={[]} value={null} onChange={vi.fn()} error="Não foi possível carregar os vendedores." allowNone={false} />);
    expect(screen.getByText('Não foi possível carregar os vendedores.')).toBeInTheDocument();
    openTrigger();
    expect(screen.queryByText('Nenhum vendedor disponível no momento.')).toBeNull();
  });

  it('vazio (allowNone): trigger já mostra "Sem vendedor"; dropdown oferece a mesma opção', () => {
    render(<SellerPicker items={[]} value={null} onChange={vi.fn()} />);
    expect(screen.getAllByText('Sem vendedor').length).toBe(1); // só o trigger, dropdown fechado
    openTrigger();
    expect(screen.getAllByText('Sem vendedor').length).toBe(2); // trigger + opção do dropdown
  });

  it('sucesso: lista os itens reais', () => {
    render(<SellerPicker items={[{ id: 's1', name: 'Ana' }, { id: 's2', name: 'Bruno' }]} value={null} onChange={vi.fn()} />);
    openTrigger();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
  });
});

describe('SellerPicker (presentacional) — seleção', () => {
  it('escolher um item chama onChange com o sellerId', () => {
    const onChange = vi.fn();
    render(<SellerPicker items={[{ id: 's1', name: 'Ana' }]} value={null} onChange={onChange} />);
    openTrigger();
    fireEvent.click(screen.getByText('Ana'));
    expect(onChange).toHaveBeenCalledWith('s1');
  });

  it('escolher "Sem vendedor" no dropdown chama onChange com null', () => {
    const onChange = vi.fn();
    render(<SellerPicker items={[{ id: 's1', name: 'Ana' }]} value="s1" onChange={onChange} />);
    openTrigger(); // value='s1' ⇒ trigger mostra "Ana", único texto antes de abrir
    const options = screen.getAllByText('Sem vendedor');
    fireEvent.click(options[0]);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('value aponta para um item: nome selecionado aparece no trigger', () => {
    render(<SellerPicker items={[{ id: 's1', name: 'Ana' }]} value="s1" onChange={vi.fn()} />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('nunca importa/chama SellerService — items vêm exclusivamente da prop', () => {
    sellerServiceGetAll.mockReturnValue([{ id: 'local-1', name: 'Vendedor Local', team: 'A' }]);
    render(<SellerPicker items={[{ id: 's1', name: 'Ana' }]} value="s1" onChange={vi.fn()} />);
    openTrigger();
    expect(screen.queryByText('Vendedor Local')).toBeNull();
    expect(sellerServiceGetAll).not.toHaveBeenCalled();
  });
});

describe('LocalSellerPicker — comportamento local preservado', () => {
  it('lista sellers de SellerService.getAll()', () => {
    sellerServiceGetAll.mockReturnValue([{ id: 'local-1', name: 'Vendedor Local', team: 'Equipe A' }]);
    render(<LocalSellerPicker value={null} onPick={vi.fn()} />);
    openTrigger();
    expect(screen.getByText('Vendedor Local')).toBeInTheDocument();
    expect(sellerServiceGetAll).toHaveBeenCalled();
  });

  it('onPick recebe o objeto Seller inteiro (contrato antigo preservado)', () => {
    const seller = { id: 'local-1', name: 'Vendedor Local', team: 'Equipe A' };
    sellerServiceGetAll.mockReturnValue([seller]);
    const onPick = vi.fn();
    render(<LocalSellerPicker value={null} onPick={onPick} />);
    openTrigger();
    fireEvent.click(screen.getByText('Vendedor Local'));
    expect(onPick).toHaveBeenCalledWith(seller);
  });
});
