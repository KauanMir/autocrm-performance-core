'use client';
// components/commercial/CommercialCompanySelector.tsx — seletor visual da
// empresa comercial do Super Admin (M1-F S8-C2-B2). Componente CONTROLADO —
// nunca duplica selectedCompanyId internamente; o estado real vive em
// CommercialCompanyContext, compartilhado entre Clientes/Andamento.
//
// Diferente de CompanyScopeFilter (S7-C, aba Usuários): NÃO existe opção
// "Todas as empresas" — não há conceito de visão global nesta superfície
// (decisão congelada do S8-C2-A1/§31). Inclui as 4 empresas de status
// (ativa/implantação/suspensa/cancelada), pois o dataset vem de
// list_commercial_companies (nunca de fetchAccessibleCompanies).
//
// Puramente visual: nunca decide autorização, nunca altera activeMembership/
// sessão/platform_role — a RPC continua sendo a proteção real.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { CommercialCompanyRow } from '@/lib/commercial/repository';

type CompanyStatus = CommercialCompanyRow['status'];

const STATUS_LABEL: Record<CompanyStatus, string> = {
  implantacao: 'Em implantação',
  ativa: 'Ativa',
  suspensa: 'Suspensa',
  cancelada: 'Cancelada',
};

const STATUS_COLOR: Record<CompanyStatus, string> = {
  implantacao: 'var(--amber)',
  ativa: 'var(--green)',
  suspensa: 'var(--red)',
  cancelada: 'var(--t-400)',
};

export type CommercialCompanySelectorProps = {
  selectedCompanyId: string | null;
  onChange: (id: string) => void;
  companies: readonly CommercialCompanyRow[];
  companiesLoading: boolean;
  companiesError?: boolean;
};

export function CommercialCompanySelector({
  selectedCompanyId, onChange, companies, companiesLoading, companiesError = false,
}: CommercialCompanySelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = companies.find((c) => c.id === selectedCompanyId) ?? null;
  const filtered = search.trim() === ''
    ? companies
    : companies.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setActiveIndex(Math.max(0, filtered.findIndex((c) => c.id === selectedCompanyId)));
    const id = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const select = (id: string) => {
    onChange(id);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const company = filtered[activeIndex];
      if (company) select(company.id);
    }
  };

  return (
    <div style={{ marginBottom: 20 }} data-testid="commercial-company-selector">
      <span id="commercial-company-selector-label" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>
        Empresa
      </span>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--t-400)' }}>
        Selecione a empresa que deseja acompanhar. Não existe visão de todas as empresas ao mesmo tempo.
      </p>
      <div style={{ position: 'relative', maxWidth: 320 }}>
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls="commercial-company-selector-listbox"
          aria-labelledby="commercial-company-selector-label commercial-company-selector-value"
          onClick={() => setOpen((o) => !o)}
          disabled={companiesLoading}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 12px',
            borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)',
            fontFamily: 'inherit', fontSize: 13.5, color: 'var(--t-900)',
            cursor: companiesLoading ? 'wait' : 'pointer',
          }}
        >
          <Icon name="building" size={14} stroke={2} style={{ color: 'var(--t-400)', flexShrink: 0 }} />
          <span id="commercial-company-selector-value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
            {companiesLoading ? 'Carregando…' : selected ? selected.name : 'Selecionar empresa'}
          </span>
          {selected && (
            <span aria-hidden="true" style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, flexShrink: 0, color: STATUS_COLOR[selected.status], border: `1px solid ${STATUS_COLOR[selected.status]}` }}>
              {STATUS_LABEL[selected.status]}
            </span>
          )}
          <Icon name="arrowDown" size={13} stroke={2} style={{ color: 'var(--t-400)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>

        {open && (
          <div
            id="commercial-company-selector-listbox"
            role="listbox"
            aria-label="Selecionar empresa"
            onKeyDown={handleKeyDown}
            style={{
              position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 10,
              maxHeight: 320, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)',
              borderRadius: 12, boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div style={{ padding: 8, borderBottom: '1px solid var(--border-2)', position: 'sticky', top: 0, background: '#1a1a1d' }}>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
                placeholder="Buscar empresa"
                aria-label="Buscar empresa"
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', color: '#fff', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
              />
            </div>

            {companiesError ? (
              <div role="alert" style={{ padding: 14, fontSize: 12.5, color: 'var(--red)' }}>
                Não foi possível carregar as empresas.
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 14, fontSize: 12.5, color: 'var(--t-500)' }}>Nenhuma empresa encontrada.</div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={selectedCompanyId === c.id}
                  onClick={() => select(c.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '10px 14px',
                    border: 'none', background: activeIndex === i ? 'rgba(255,255,255,.08)' : 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit', color: '#fff', fontSize: 13.5,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.name}</span>
                  <span aria-hidden="true" style={{ fontSize: 10.5, flexShrink: 0, color: STATUS_COLOR[c.status] }}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
