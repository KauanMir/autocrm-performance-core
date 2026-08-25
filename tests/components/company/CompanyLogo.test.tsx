// Testes de CompanyLogo (COMPANY-IDENTITY-LOGO-R1-EXEC §27/§28/§29):
// fallback de iniciais sem logo, <img> com a URL pública quando há
// logoPath, fallback de iniciais quando a imagem falha ao carregar (nunca
// uma logo fake, nunca repete a mesma request em loop).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyLogo } from '@/components/company/CompanyLogo';

const mocks = vi.hoisted(() => ({ getCompanyLogoPublicUrl: vi.fn() }));

vi.mock('@/lib/companies/logoStorage', () => ({
  getCompanyLogoPublicUrl: mocks.getCompanyLogoPublicUrl,
}));

beforeEach(() => {
  mocks.getCompanyLogoPublicUrl.mockImplementation(
    (path: string) => `https://storage.example/company-logos/${path}`,
  );
});

describe('CompanyLogo — sem logo', () => {
  it('logoPath null/undefined: mostra iniciais reais, nunca uma logo fake', () => {
    render(<CompanyLogo name="Rcar Seminovos Gama" logoPath={null} />);
    expect(screen.getByText('RS')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('logoPath string vazia: mesmo tratamento de null (iniciais)', () => {
    render(<CompanyLogo name="Rcar Seminovos Gama" logoPath="" />);
    expect(screen.getByText('RS')).toBeInTheDocument();
  });
});

describe('CompanyLogo — com logo válida', () => {
  it('resolve a URL pública via getCompanyLogoPublicUrl e renderiza <img> object-fit contain', () => {
    render(<CompanyLogo name="Rcar Seminovos Gama" logoPath="company-1/logos/abc.png" />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://storage.example/company-logos/company-1/logos/abc.png');
    expect(img.style.objectFit).toBe('contain');
    expect(screen.queryByText('RS')).toBeNull();
  });
});

describe('CompanyLogo — falha ao carregar a imagem (§29)', () => {
  it('onError troca para iniciais, sem re-tentar a mesma request', () => {
    render(<CompanyLogo name="Rcar Seminovos Gama" logoPath="company-1/logos/broken.png" />);
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('RS')).toBeInTheDocument();
  });

  it('trocar para um logoPath NOVO depois de um erro reseta o fallback (tenta a imagem nova)', () => {
    const { rerender } = render(<CompanyLogo name="Rcar Seminovos Gama" logoPath="company-1/logos/broken.png" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('RS')).toBeInTheDocument();

    rerender(<CompanyLogo name="Rcar Seminovos Gama" logoPath="company-1/logos/new.png" />);
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://storage.example/company-logos/company-1/logos/new.png');
  });
});
