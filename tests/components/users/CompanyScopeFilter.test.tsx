// tests/components/users/CompanyScopeFilter.test.tsx — seletor visual do
// filtro contextual de empresa (M1-F S7-C). Componente puramente
// controlado — nenhum hook de rede, nenhum mock necessário além dos
// próprios props.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CompanyScopeFilter } from '@/components/users/CompanyScopeFilter';
import type { PlatformCompanyRow } from '@/lib/companies/repository';

function company(overrides: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    id: 'company-a', name: 'Revenda Premium', trade_name: null, cnpj: null, phone: null,
    timezone: 'America/Sao_Paulo', status: 'ativa', created_at: '2026-07-20T12:00:00+00:00', logo_path: null,
    ...overrides,
  };
}

describe('CompanyScopeFilter — estado inicial e rótulos', () => {
  it('sem seleção: mostra "Todas as empresas"', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[]} companiesLoading={false} />);
    expect(screen.getByText('Todas as empresas')).toBeInTheDocument();
  });

  it('com seleção: mostra o nome da empresa e o status', () => {
    render(<CompanyScopeFilter companyFilterId="company-a" onChange={vi.fn()} companies={[company()]} companiesLoading={false} />);
    expect(screen.getByRole('button', { name: /Revenda Premium/ })).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
  });

  it('loading: botão mostra "Carregando…" e fica desabilitado', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[]} companiesLoading />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Carregando/ })).toBeDisabled();
  });

  it('texto auxiliar explica que o filtro é visual', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[]} companiesLoading={false} />);
    expect(screen.getByText('Filtre os usuários exibidos por empresa.')).toBeInTheDocument();
  });
});

describe('CompanyScopeFilter — status exibido nunca só por cor', () => {
  it('empresa em implantação/ativa/suspensa: cada uma tem texto próprio, não só cor', () => {
    const companies = [
      company({ id: 'c1', name: 'Empresa Implantação', status: 'implantacao' }),
      company({ id: 'c2', name: 'Empresa Ativa', status: 'ativa' }),
      company({ id: 'c3', name: 'Empresa Suspensa', status: 'suspensa' }),
    ];
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={companies} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    expect(screen.getByText('Em implantação')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('Suspensa')).toBeInTheDocument();
  });
});

describe('CompanyScopeFilter — abrir/selecionar/buscar', () => {
  it('abre a listbox ao clicar no botão (aria-expanded correto)', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[company()]} companiesLoading={false} />);
    const button = screen.getByRole('button', { name: /Todas as empresas/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('selecionar "Todas as empresas" chama onChange(null) e fecha', () => {
    const onChange = vi.fn();
    render(<CompanyScopeFilter companyFilterId="company-a" onChange={onChange} companies={[company()]} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Revenda Premium/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Todas as empresas' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selecionar uma empresa chama onChange(id) e fecha', () => {
    const onChange = vi.fn();
    render(<CompanyScopeFilter companyFilterId={null} onChange={onChange} companies={[company()]} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    fireEvent.click(screen.getByRole('option', { name: /Revenda Premium/ }));
    expect(onChange).toHaveBeenCalledWith('company-a');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('busca filtra a lista por nome (case-insensitive)', () => {
    const companies = [company({ id: 'c1', name: 'Alfa' }), company({ id: 'c2', name: 'Beta' })];
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={companies} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: 'alf' } });
    expect(screen.getByRole('option', { name: 'Alfa' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Beta' })).toBeNull();
  });

  it('busca sem resultado: mensagem "Nenhuma empresa encontrada."', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[company()]} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: 'zzz-inexistente' } });
    expect(screen.getByText('Nenhuma empresa encontrada.')).toBeInTheDocument();
  });

  it('erro: mensagem de erro dentro da listbox, sem opções', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[]} companiesLoading={false} companiesError />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar as empresas.');
    expect(screen.queryByRole('option')).toBeNull();
  });
});

describe('CompanyScopeFilter — teclado e foco', () => {
  it('Escape fecha a listbox e devolve o foco ao botão', () => {
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[company()]} companiesLoading={false} />);
    const button = screen.getByRole('button', { name: /Todas as empresas/ });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Enter na opção ativa seleciona (ArrowDown navega, Enter confirma)', () => {
    const onChange = vi.fn();
    const companies = [company({ id: 'c1', name: 'Alfa' }), company({ id: 'c2', name: 'Beta' })];
    render(<CompanyScopeFilter companyFilterId={null} onChange={onChange} companies={companies} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // Todas -> Alfa
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c1');
  });
});

describe('CompanyScopeFilter — sem persistência', () => {
  it('nunca lê ou escreve localStorage/sessionStorage', () => {
    const lsSet = vi.spyOn(Storage.prototype, 'setItem');
    render(<CompanyScopeFilter companyFilterId={null} onChange={vi.fn()} companies={[company()]} companiesLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Todas as empresas/ }));
    fireEvent.click(screen.getByRole('option', { name: /Revenda Premium/ }));
    expect(lsSet).not.toHaveBeenCalled();
    lsSet.mockRestore();
  });
});
