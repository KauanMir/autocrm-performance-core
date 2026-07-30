'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, URG, LBtn, LBadge } from '@/components/ui/kit';
import { LeadService, TaskService, SellerService, AuthService } from '@/lib/services';
import type { LeadHealthEvent } from '@/lib/services';
import { USERS, TASK_STATE } from '@/lib/data';
import type { LeadMutationCapabilities } from '@/lib/leads/mutationCapabilities';
import { resolveLeadFlowContext, type LeadFlowContext } from '@/lib/leads/leadFlowContext';
import { canActorMutateLead } from '@/lib/leads/leadMutationOwnership';
import { useApplyLeadEvent } from '@/lib/hooks/useApplyLeadEvent';
import { mapLeadHealthEventToRemoteEventType } from '@/lib/leads/leadEventMapper';
import { isRemoteLeadsError, type RemoteLeadsErrorCode } from '@/lib/leads/errors';
import { useCurrentCompanyAssignableSellers } from '@/lib/hooks/useCurrentCompanyAssignableSellers';
import { useAssignLeadSeller, isNoOpSellerAssignment } from '@/lib/hooks/useAssignLeadSeller';
import { useArchiveLead } from '@/lib/hooks/useArchiveLead';

export const CARS = ['Golf GTI 2022', 'Honda HR-V 2023', 'Toyota Corolla 2023', 'VW Polo 2023', 'Jeep Compass 2022', 'Hyundai Creta 2023', 'Fiat Pulse 2023', 'Chevrolet Onix 2023', 'Renault Kardian 2024', 'Nissan Kicks 2023'];
export const ORIGINS: [string, string][] = [['Showroom', 'car'], ['WhatsApp', 'message'], ['Instagram', 'instagram'], ['Webmotors', 'search'], ['iCarros', 'car'], ['Mercado Livre', 'card'], ['Grupo VIP', 'star'], ['Site', 'grid'], ['Indicação', 'users'], ['Telefone', 'phone']];
export const PAYS: [string, string][] = [['À vista', 'card'], ['Financiamento 100%', 'doc'], ['Entrada + Financiamento', 'dollar'], ['Troca', 'refresh']];

export function findLead(name: string) { return LeadService.getAll().find((l: any) => l.name === name); }

const flowField: React.CSSProperties = {
  width: '100%', padding: '13px 15px', borderRadius: 12, border: '1px solid var(--border)',
  fontFamily: 'inherit', fontSize: 15, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)', outline: 'none',
  transition: 'border-color .15s, box-shadow .15s',
};

export function FField({ label, icon, hint, suffix, ...rest }: any) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      {label && <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>{label}</span>}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {icon && <span style={{ position: 'absolute', left: 14, color: 'var(--t-400)', display: 'grid' }}><Icon name={icon} size={17} stroke={2} /></span>}
        <input {...rest} style={{ ...flowField, paddingLeft: icon ? 42 : 15, paddingRight: suffix ? 56 : 15 }}
          onFocus={(e: any) => { e.target.style.borderColor = 'rgba(212,175,55,.6)'; e.target.style.boxShadow = '0 0 0 3px rgba(212,175,55,.12)'; }}
          onBlur={(e: any) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }} />
        {suffix && <span style={{ position: 'absolute', right: 14, color: 'var(--t-500)', fontSize: 13, fontWeight: 600 }}>{suffix}</span>}
      </div>
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--t-400)', marginTop: 6 }}>{hint}</span>}
    </label>
  );
}

export function FArea({ label, ...rest }: any) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      {label && <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>{label}</span>}
      <textarea {...rest} rows={rest.rows || 3} style={{ ...flowField, resize: 'vertical', lineHeight: 1.5 }}
        onFocus={(e: any) => { e.target.style.borderColor = 'rgba(212,175,55,.6)'; e.target.style.boxShadow = '0 0 0 3px rgba(212,175,55,.12)'; }}
        onBlur={(e: any) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }} />
    </label>
  );
}

export function Segmented({ options, value, onChange, accent = '#E8CE72' }: {
  options: any[]; value: any; onChange: (v: any) => void; accent?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, flexWrap: 'wrap' }}>
      {options.map((o: any) => {
        const v = Array.isArray(o) ? o[0] : o; const on = value === v;
        return (
          <button key={v} onClick={() => onChange(v)} style={{
            flex: '1 1 auto', padding: '9px 14px', borderRadius: 9, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', whiteSpace: 'nowrap',
            background: on ? `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 78%, #000))` : 'transparent',
            color: on ? '#241c04' : 'var(--t-500)', transition: 'all .15s',
          }}>{Array.isArray(o) ? o[1] : o}</button>
        );
      })}
    </div>
  );
}

export function ChoiceTile({ icon, title, desc, active, accent = '#E8CE72', onClick, big }: {
  icon?: string; title: string; desc?: string; active?: boolean; accent?: string; onClick?: () => void; big?: boolean;
}) {
  return (
    <button onClick={onClick} className="lift" style={{
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      background: active ? `linear-gradient(180deg, ${accent}1f, rgba(0,0,0,.2)), #161618` : 'linear-gradient(180deg,#1a1a1d,#131315)',
      border: `1px solid ${active ? accent + '88' : 'var(--border)'}`, borderRadius: 14, padding: big ? 18 : 15,
      boxShadow: active ? `inset 0 1px 0 rgba(255,255,255,.06), 0 12px 30px -16px ${accent}66` : 'var(--shadow-sm)',
      display: 'flex', alignItems: 'center', gap: 13,
    }}>
      {icon && <span style={{ width: big ? 46 : 40, height: big ? 46 : 40, flexShrink: 0, borderRadius: 12, background: active ? accent : 'rgba(255,255,255,.06)', color: active ? '#241c04' : 'var(--t-500)', display: 'grid', placeItems: 'center', transition: 'all .15s' }}><Icon name={icon} size={big ? 23 : 20} stroke={2.1} /></span>}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: big ? 15.5 : 14, fontWeight: 700, color: 'var(--t-900)' }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{desc}</div>}
      </div>
      {active && <span style={{ marginLeft: 'auto', color: accent }}><Icon name="checkCircle" size={20} stroke={2.2} /></span>}
    </button>
  );
}

export function ClientChip({ lead, size = 'md' }: { lead: any; size?: 'md' | 'lg' }) {
  if (!lead) return null;
  const u = URG[lead.urgency];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: size === 'lg' ? 18 : 14, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <Avatar name={lead.name} size={size === 'lg' ? 52 : 44} ring={u.c} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: size === 'lg' ? 18 : 15.5, fontWeight: 700, color: 'var(--t-900)' }}>{lead.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="car" size={13} stroke={2} /> {lead.car}
        </div>
      </div>
      <LBadge tone={lead.urgency} solid={lead.urgency === 'red'}>{URG[lead.urgency].label}</LBadge>
    </div>
  );
}

// Client search-and-select used by any flow that must link its record to a
// real Lead instead of free text (see M0-K1.5 — a plain uncontrolled text
// field is what let "Nova proposta" save with client:'—' regardless of what
// was typed). Always resolves to a real lead via LeadService.getAll(), never
// a static seed list, so leads created earlier in the session show up too.
export function LeadPicker({ value, onChange, onPick, placeholder }: {
  value: string; onChange: (v: string) => void; onPick: (lead: any) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const q = value.trim().toLowerCase();
  // Empty query still shows something on focus/click (M0-K3.2, correção 5) —
  // getAll() unshifts on create, so the first 8 are already the most recent.
  const matches = q
    ? LeadService.getAll().filter((l: any) => l.name.toLowerCase().includes(q)).slice(0, 8)
    : LeadService.getAll().slice(0, 8);
  return (
    <div style={{ position: 'relative' }}>
      <FField label="Cliente" icon="user" placeholder={placeholder || 'Buscar cliente pelo nome...'} value={value}
        onChange={(e: any) => { onChange(e.target.value); setShow(true); }}
        onFocus={() => setShow(true)} />
      {show && matches.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 74, zIndex: 5, background: '#1a1a1d', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
          {matches.map((l: any) => (
            <button key={l.id} onClick={() => { onPick(l); setShow(false); }} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <Avatar name={l.name} size={28} ring="#3B82F6" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{l.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--t-500)' }}>{l.car}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Vendor selector for manager/admin flows — a native <select> renders its
// options in the browser's own light chrome regardless of the app's dark
// theme, so the list came out unreadable (M0-K3.2, problem 1). Same visual
// language as LeadPicker: dark trigger, dark dropdown, avatar rows, visible
// hover — just a closed list instead of type-to-search, since sellers are a
// short, known set.
//
// M1-E E4-B2: renomeado de SellerPicker para LocalSellerPicker — o caminho
// LOCAL (SellerService.getAll() interno) precisava conviver com um
// SellerPicker presentacional novo, alimentado por dados reais no caminho
// remoto (assignable sellers, E4-A1), sem nunca cair de volta no
// SellerService. Nenhuma mudança de comportamento para os callers locais
// existentes (FlowNovoCliente ramo local, FlowRegistrarVenda,
// FlowNovaPendencia — nenhum deles pertence ao escopo do M1-E).
export function LocalSellerPicker({ value, onPick, placeholder }: {
  value: any; onPick: (seller: any) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const sellers = SellerService.getAll();
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Vendedor responsável</span>
      <button type="button" onClick={() => setShow((s) => !s)}
        style={{ ...flowField, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left' }}>
        {value ? (
          <>
            <Avatar name={value.name} size={24} ring="#3B82F6" />
            <span style={{ color: '#fff', fontWeight: 600, flex: 1 }}>{value.name}</span>
          </>
        ) : (
          <span style={{ color: 'var(--t-400)', flex: 1 }}>{placeholder || 'Selecione o vendedor…'}</span>
        )}
        <Icon name="arrowDown" size={16} stroke={2} style={{ color: 'var(--t-400)', transform: show ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />
      </button>
      {show && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 74, zIndex: 5, maxHeight: 280, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
          {sellers.map((s: any) => (
            <button key={s.id} onClick={() => { onPick(s); setShow(false); }} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <Avatar name={s.name} size={28} ring="#3B82F6" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{s.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--t-500)' }}>{s.team}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// M1-E E4-B2 — SellerPicker presentacional: recebe os itens por prop, nunca
// importa SellerService, nunca faz fallback para ele. Usado exclusivamente
// pelo caminho remoto de criação (Manager), alimentado por
// useCurrentCompanyAssignableSellers (E4-A1) — nunca pelo catálogo
// histórico (list_current_company_seller_labels, E3-A1). `value`/`onChange`
// trabalham com o sellerId (string) diretamente, não com o objeto Seller
// local — contrato mais simples e correto para dados remotos, que só têm
// {id, name}. `allowNone` cobre a decisão de produto "Manager pode deixar o
// Lead sem vendedor" (diferente do LocalSellerPicker, que nunca teve essa
// opção — decisão antiga, fora de escopo).
export type SellerPickerItem = { id: string; name: string };

// M1-E E6-B2-A — `value` aceita também `undefined`: "nenhuma escolha
// explícita ainda" (Seller atual histórico/inativo, fora do catálogo
// operacional — decisão humana do E6-B2-A). Mudança somente de tipo: a
// lógica abaixo já tratava `undefined` de forma idêntica a `null` no
// cálculo de `selected` (`value ? ... : null`) e já caía no placeholder por
// não satisfazer `value === null` — nenhum comportamento muda para os
// callers existentes do E4, que nunca passam `undefined`.
export function SellerPicker({
  items,
  value,
  onChange,
  loading,
  disabled,
  error,
  allowNone = true,
  noneLabel = 'Sem vendedor',
  emptyLabel = 'Nenhum vendedor disponível no momento.',
  placeholder,
}: {
  items: readonly SellerPickerItem[];
  value: string | null | undefined;
  onChange: (sellerId: string | null) => void;
  loading?: boolean;
  disabled?: boolean;
  error?: string | null;
  allowNone?: boolean;
  noneLabel?: string;
  emptyLabel?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const selected = value ? items.find((s) => s.id === value) ?? null : null;
  const isDisabled = Boolean(disabled) || Boolean(loading) || Boolean(error);

  let triggerLabel: React.ReactNode;
  if (loading) {
    triggerLabel = <span style={{ color: 'var(--t-400)', flex: 1 }}>Carregando vendedores…</span>;
  } else if (error) {
    triggerLabel = <span style={{ color: 'var(--red, #FF3B3B)', flex: 1 }}>{error}</span>;
  } else if (selected) {
    triggerLabel = (
      <>
        <Avatar name={selected.name} size={24} ring="#3B82F6" />
        <span style={{ color: '#fff', fontWeight: 600, flex: 1 }}>{selected.name}</span>
      </>
    );
  } else if (value === null && allowNone) {
    triggerLabel = <span style={{ color: 'var(--t-400)', flex: 1 }}>{noneLabel}</span>;
  } else {
    triggerLabel = <span style={{ color: 'var(--t-400)', flex: 1 }}>{placeholder || 'Selecione o vendedor…'}</span>;
  }

  return (
    <div style={{ position: 'relative' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Vendedor responsável</span>
      <button type="button" disabled={isDisabled} onClick={() => setShow((s) => !s)}
        style={{ ...flowField, display: 'flex', alignItems: 'center', gap: 10, cursor: isDisabled ? 'default' : 'pointer', textAlign: 'left', opacity: isDisabled ? 0.6 : 1 }}>
        {triggerLabel}
        {!isDisabled && <Icon name="arrowDown" size={16} stroke={2} style={{ color: 'var(--t-400)', transform: show ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} />}
      </button>
      {show && !isDisabled && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 74, zIndex: 5, maxHeight: 280, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
          {allowNone && (
            <button onClick={() => { onChange(null); setShow(false); }} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-500)' }}>{noneLabel}</span>
            </button>
          )}
          {items.length === 0 && !allowNone && (
            <div style={{ padding: '14px', fontSize: 12.5, color: 'var(--t-500)', textAlign: 'center' }}>{emptyLabel}</div>
          )}
          {items.map((s) => (
            <button key={s.id} onClick={() => { onChange(s.id); setShow(false); }} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.background = 'transparent'; }}>
              <Avatar name={s.name} size={28} ring="#3B82F6" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{s.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FPanel({ title, icon, children, accent = 'var(--t-500)', style }: {
  title?: string; icon?: string; children?: React.ReactNode; accent?: string; style?: React.CSSProperties;
}) {
  return (
    <div style={{ background: 'linear-gradient(180deg,#1a1a1d,#131315)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, boxShadow: 'var(--shadow-md)', ...style }}>
      {title && <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
        {icon && <Icon name={icon} size={16} stroke={2.2} style={{ color: accent }} />}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--t-900)', letterSpacing: '.01em' }}>{title}</span>
      </div>}
      {children}
    </div>
  );
}

export function StepRail({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 26 }}>
      {steps.map((s, i) => {
        const done = i < current; const on = i === current;
        return (
          <React.Fragment key={s}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                background: done ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : on ? 'rgba(212,175,55,.16)' : 'rgba(255,255,255,.05)',
                border: `1px solid ${done || on ? 'rgba(212,175,55,.5)' : 'var(--border)'}`,
                color: done ? '#241c04' : on ? '#E8CE72' : 'var(--t-400)', fontWeight: 800, fontSize: 13, fontFamily: 'Archivo, sans-serif' }}>
                {done ? <Icon name="check" size={15} stroke={3} /> : i + 1}
              </div>
              <span style={{ fontSize: 13, fontWeight: on ? 700 : 500, color: on ? 'var(--t-900)' : 'var(--t-500)', whiteSpace: 'nowrap' }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 1, margin: '0 14px', background: done ? 'rgba(212,175,55,.4)' : 'var(--border)' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-2)' }}>
      <span style={{ fontSize: 13, color: 'var(--t-500)' }}>{label}</span>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: accent || 'var(--t-900)' }}>{value}</span>
    </div>
  );
}

export function Info({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
      <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>{label}</span>
      <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: tone || 'var(--t-900)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export function FlowShell({ eyebrow, title, sub, icon, accent = '#E8CE72', status, onClose, footer, children, wide = 1180 }: {
  eyebrow?: string; title: string; sub?: string; icon: string; accent?: string; status?: React.ReactNode;
  onClose: () => void; footer?: React.ReactNode; children: React.ReactNode; wide?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 80% at 50% -10%, #1a1a1e, #0a0a0b 60%)', animation: 'flowIn .34s cubic-bezier(.2,.7,.2,1)' }}>
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .3, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)', width: 700, height: 320, background: `radial-gradient(ellipse, ${accent}1f, transparent 70%)`, pointerEvents: 'none' }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, padding: '18px 28px', borderBottom: '1px solid var(--border)', background: 'rgba(8,8,9,.6)', backdropFilter: 'blur(10px)' }}>
        <button onClick={onClose} className="focus-ring lift" style={{ width: 42, height: 42, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)' }}>
          <Icon name="arrowRight" size={19} stroke={2.2} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: `linear-gradient(180deg, ${accent}, color-mix(in srgb, ${accent} 72%, #000))`, display: 'grid', placeItems: 'center', color: '#241c04', boxShadow: `0 8px 22px -8px ${accent}`, flexShrink: 0 }}>
          <Icon name={icon} size={23} stroke={2.2} />
        </div>
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div className="display" style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: '.18em' }}>{eyebrow}</div>}
          <div className="display" style={{ fontSize: 21, fontWeight: 800, color: '#fff', letterSpacing: '-.01em', lineHeight: 1.1 }}>{title}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {status}
          <button onClick={onClose} className="focus-ring" style={{ width: 42, height: 42, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-500)' }}>
            <Icon name="x" size={20} stroke={2.2} />
          </button>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: wide, margin: '0 auto', padding: '28px 28px 40px' }}>
          {sub && <p style={{ margin: '0 0 22px', color: 'var(--t-500)', fontSize: 14.5, maxWidth: 680 }}>{sub}</p>}
          {children}
        </div>
      </div>

      {footer && <div style={{ position: 'relative', borderTop: '1px solid var(--border)', background: 'rgba(8,8,9,.7)', backdropFilter: 'blur(10px)', padding: '16px 28px' }}>
        <div style={{ maxWidth: wide, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>{footer}</div>
      </div>}
    </div>
  );
}

export function FlowSuccess({ icon = 'checkCircle', accent = '#27C75F', title, sub, actions }: {
  icon?: string; accent?: string; title: string; sub?: string; actions?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '52vh', textAlign: 'center', animation: 'flowFade .4s' }}>
      <div>
        <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto 26px' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${accent}`, animation: 'burstRing 1.1s ease-out' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${accent}`, animation: 'burstRing 1.1s ease-out .25s' }} />
          <div style={{ position: 'absolute', inset: 12, borderRadius: '50%', background: `radial-gradient(circle at 38% 30%, ${accent}, color-mix(in srgb, ${accent} 55%, #000))`, display: 'grid', placeItems: 'center', color: '#fff', boxShadow: `0 20px 50px -16px ${accent}` }}>
            <Icon name={icon} size={54} stroke={2.2} />
          </div>
        </div>
        <h2 className="display" style={{ margin: '0 0 10px', fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>{title}</h2>
        {sub && <p style={{ margin: '0 auto 26px', color: 'var(--t-500)', fontSize: 15, maxWidth: 460 }}>{sub}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>{actions}</div>
      </div>
    </div>
  );
}

// ── FlowLigar — router sem hooks próprios (mesmo molde de FlowNovoCliente/
// FlowEditarCliente em Flows2.tsx: a escolha é de QUAL componente montar,
// nunca de qual hook chamar dentro do MESMO componente). M1-E E5-B2-A2. ──
export function FlowLigar({ payload, close, openFlow }: any) {
  const user = AuthService.getCurrentUser();
  const ctx = resolveLeadFlowContext(user);
  if (ctx.dataSource === 'remote') {
    return <FlowLigarRemote payload={payload} close={close} ctx={ctx} />;
  }
  return <FlowLigarLocal payload={payload} close={close} openFlow={openFlow} />;
}

// ── Caminho LOCAL: corpo original, intacto (só o nome mudou de FlowLigar
// para FlowLigarLocal) ───────────────────────────────────────────────────
function FlowLigarLocal({ payload, close, openFlow }: any) {
  const lead = payload.lead || LeadService.getAll()[0];
  const [phase, setPhase] = useState('ready');
  const [secs, setSecs] = useState(0);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (phase === 'calling') { const t = setTimeout(() => setPhase('live'), 2200); return () => clearTimeout(t); }
    if (phase === 'live') { const t = setInterval(() => setSecs(s => s + 1), 1000); return () => clearInterval(t); }
  }, [phase]);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0'); const ss2 = String(secs % 60).padStart(2, '0');
  const script = ['Cumprimentar e confirmar o nome', 'Confirmar interesse no veículo', 'Apresentar condições e diferenciais', 'Propor uma visita ou test drive', 'Confirmar próximo passo'];
  const outcomes: Array<{
    id: 'visita' | 'proposta' | 'retorno' | 'naoatendeu'; icon: string; title: string; accent: string; next: string | null;
    task: null | { title: string; when: string; prio: string; state: string };
  }> = [
    { id: 'visita', icon: 'calendar', title: 'Atendeu — agendar visita', accent: '#27C75F', next: 'criar-visita', task: null },
    { id: 'proposta', icon: 'handshake', title: 'Atendeu — montar proposta', accent: '#E8CE72', next: 'nova-proposta', task: null },
    { id: 'retorno', icon: 'clock', title: 'Pediu retorno — agendar follow-up', accent: '#FFA31F', next: 'criar-acompanhamento',
      task: { title: 'Follow-up', when: 'Amanhã', prio: 'media', state: TASK_STATE.UPCOMING } },
    { id: 'naoatendeu', icon: 'phone', title: 'Não atendeu — tentar mais tarde', accent: '#8B8B93', next: null,
      task: { title: 'Tentar contato novamente', when: 'Hoje', prio: 'alta', state: TASK_STATE.TODAY } },
  ];

  const handleSaveOutcome = () => {
    if (!outcome) return;
    const o = outcomes.find(x => x.id === outcome);
    if (!o) return;
    LeadService.updateHealth(lead.id, { type: 'call', outcome: o.id } as LeadHealthEvent);
    LeadService.addToTimeline(lead.id, { icon: 'phone', c: o.accent === '#8B8B93' ? '#8B8B93' : o.accent, t: `Ligação: ${o.title}` });
    if (o.task) {
      TaskService.create({
        title: `${o.task.title} — ${lead.name}`,
        lead: lead.name,
        leadId: lead.id,
        assignedTo: lead.sellerId ?? null,
        when: o.task.when,
        prio: o.task.prio,
        state: o.task.state,
        note: '',
      });
    }
    setPhase('done');
  };

  if (phase === 'done') {
    const o = outcomes.find(x => x.id === outcome);
    return (
      <FlowShell eyebrow="CENTRAL DE CONTATO" title="Ligação registrada" icon="phone" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Ligação registrada com sucesso" sub={`O resultado da sua ligação para ${lead.name} foi salvo. ${o && o.next ? 'Vamos para o próximo passo.' : 'Um lembrete foi criado para tentar novamente.'}`}
          actions={<>
            {o && o.next && <LBtn kind="gold" size="lg" icon={o.icon} onClick={() => openFlow(o.next, { lead })}>{o.id === 'visita' ? 'Agendar visita' : o.id === 'proposta' ? 'Montar proposta' : 'Criar follow-up'}</LBtn>}
            <LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn>
          </>} />
      </FlowShell>
    );
  }

  return (
    <FlowShell eyebrow="CENTRAL DE CONTATO" title={`Ligar para ${lead.name.split(' ')[0]}`} icon="phone" accent="#27C75F" onClose={close}
      status={lead.urgency === 'red' ? <LBadge tone="red" solid><Icon name="flame" size={12} stroke={2.4} />{lead.last}</LBadge> : null}>
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FPanel>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4 }}>
              <Avatar name={lead.name} size={84} ring={URG[lead.urgency].c} />
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--t-900)', marginTop: 12 }}>{lead.name}</div>
              <div className="display tnum" style={{ fontSize: 22, fontWeight: 700, color: '#27C75F', letterSpacing: '.01em' }}>{lead.phone}</div>
            </div>
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 11 }}>
              <Info icon="car" label="Veículo" value={lead.car} />
              <Info icon="flow" label="Etapa" value={lead.stage} />
              <Info icon="card" label="Pagamento" value={lead.pay} />
              <Info icon="clock" label="Situação" value={lead.last} tone={lead.urgency === 'red' ? 'var(--red)' : null} />
            </div>
          </FPanel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <FPanel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                <div style={{ width: 90, height: 90, borderRadius: '50%', background: phase === 'live' ? 'radial-gradient(circle at 38% 30%, #27C75F, #14803d)' : 'rgba(255,255,255,.05)', border: '1px solid', borderColor: phase === 'ready' ? 'var(--border)' : 'rgba(39,199,95,.6)', display: 'grid', placeItems: 'center', color: phase === 'live' ? '#fff' : '#27C75F', animation: phase !== 'ready' ? 'callPulse 1.6s ease-out infinite' : 'none' }}>
                  <Icon name="phone" size={34} stroke={2} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, color: 'var(--t-500)', fontWeight: 600 }}>
                  {phase === 'ready' ? 'Pronto para ligar' : phase === 'calling' ? 'Chamando…' : 'Em ligação'}
                </div>
                <div className="display tnum" style={{ fontSize: 34, fontWeight: 800, color: '#fff', lineHeight: 1.1 }}>
                  {phase === 'live' ? `${mm}:${ss2}` : phase === 'calling' ? '···' : lead.phone}
                </div>
              </div>
              {phase === 'ready' && <LBtn kind="gold" size="lg" icon="phone" onClick={() => setPhase('calling')} style={{ background: 'linear-gradient(180deg,#2EDC72,#15924B)', color: '#fff', border: '1px solid #2EDC72' }}>Iniciar chamada</LBtn>}
              {phase !== 'ready' && <div style={{ display: 'flex', gap: 8 }}>
                <button className="lift" style={{ width: 48, height: 48, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)' }}><Icon name="mic" size={20} stroke={2} /></button>
                <LBtn kind="danger" size="lg" icon="phone" onClick={() => setPhase('live')} style={{ display: phase === 'calling' ? 'none' : 'inline-flex' }}>Encerrar</LBtn>
                {phase === 'calling' && <LBtn kind="ghost" size="lg" onClick={() => setPhase('ready')}>Cancelar</LBtn>}
              </div>}
            </div>
          </FPanel>

          <FPanel title="Roteiro da ligação" icon="clipboard" accent="#E8CE72">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {script.map((s, i) => (
                <button key={i} onClick={() => setChecks(c => ({ ...c, [i]: !c[i] }))} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: checks[i] ? 'rgba(39,199,95,.08)' : 'rgba(255,255,255,.02)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: `2px solid ${checks[i] ? 'var(--green)' : 'var(--border)'}`, background: checks[i] ? 'var(--green)' : 'transparent', display: 'grid', placeItems: 'center', color: '#fff' }}>{checks[i] && <Icon name="check" size={12} stroke={3} />}</span>
                  <span style={{ fontSize: 14, color: checks[i] ? 'var(--t-500)' : 'var(--t-900)', textDecoration: checks[i] ? 'line-through' : 'none' }}>{s}</span>
                </button>
              ))}
            </div>
          </FPanel>

          <FPanel title="Resultado da ligação" icon="flag" accent="#27C75F">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {outcomes.map(o => <ChoiceTile key={o.id} icon={o.icon} title={o.title} accent={o.accent} active={outcome === o.id} onClick={() => setOutcome(o.id)} />)}
            </div>
            <div style={{ marginTop: 14 }}>
              <LBtn kind="gold" size="lg" icon="check" onClick={handleSaveOutcome} style={{ width: '100%', justifyContent: 'center', opacity: outcome ? 1 : .5 }}>Salvar resultado e continuar</LBtn>
            </div>
          </FPanel>
        </div>
      </div>
    </FlowShell>
  );
}

const CALL_OUTCOME_REMOTE_OPTIONS: ReadonlyArray<{
  id: 'visita' | 'proposta' | 'retorno' | 'naoatendeu'; icon: string; title: string; accent: string;
}> = [
  { id: 'visita', icon: 'calendar', title: 'Demonstrou interesse em visita', accent: '#27C75F' },
  { id: 'proposta', icon: 'handshake', title: 'Solicitou proposta', accent: '#E8CE72' },
  { id: 'retorno', icon: 'clock', title: 'Pediu retorno', accent: '#FFA31F' },
  { id: 'naoatendeu', icon: 'phone', title: 'Não atendeu', accent: '#8B8B93' },
];

// Mesma proteção de identidade do E4-B2 (useCloseOnIdentityChange, privado
// em Flows2.tsx) — versão própria deste arquivo, nunca importada de lá:
// Flows2.tsx já importa DESTE arquivo, então o sentido contrário criaria um
// ciclo de módulos. Fecha o flow sem mostrar sucesso quando a identidade
// (empresa/membership/usuário) muda enquanto ele está aberto.
function useCloseRemoteCallFlowOnIdentityChange(identityKey: string | null, close: () => void) {
  const ref = useRef<string | null | 'unset'>('unset');
  useEffect(() => {
    if (ref.current === 'unset') { ref.current = identityKey; return; }
    if (ref.current !== identityKey) { close(); return; }
    ref.current = identityKey;
  }, [identityKey, close]);
}

// Mensagens sanitizadas fixas do resultado remoto de ligação — mesmo modelo
// de remoteLeadErrorMessage (Flows2.tsx)/remoteLeadMoveErrorMessage
// (ScreensOps.tsx), próprio deste arquivo: nenhum UUID/SQL/RPC/payload/
// stack. identity_changed nunca chega aqui (tratado antes, fecha o flow).
function remoteCallOutcomeErrorMessage(code: RemoteLeadsErrorCode | undefined): string {
  switch (code) {
    case 'remote_leads_mutation_forbidden':
      return 'Você não possui permissão para registrar uma ligação neste Lead.';
    case 'remote_leads_mutation_lead_not_found':
      return 'Este Lead não está mais disponível.';
    case 'remote_leads_mutation_lead_archived':
      return 'Este Lead foi arquivado e não pode receber novas atividades.';
    case 'remote_leads_mutation_company_read_only':
      return 'Esta empresa está em modo somente leitura.';
    case 'remote_leads_mutation_stage_not_found':
      return 'A etapa atual do Lead não está mais disponível.';
    default:
      return 'Não foi possível registrar o resultado da ligação.';
  }
}

// ── Caminho REMOTO: somente os 4 resultados de ligação, via
// apply_lead_event (useApplyLeadEvent + mapLeadHealthEventToRemoteEventType,
// M1-E E5-B2-A2). Nunca chama LeadService/TaskService/VisitService/
// DealService/SaleService/StoreAdapter — nenhuma Task, nenhuma timeline
// (E7). Payload da RPC é somente leadId/eventType (dentro do próprio hook,
// já aprovado no E5-A1) — nunca companyId/expectedVersion/texto/objeto
// completo do Lead. ──────────────────────────────────────────────────────
function FlowLigarRemote({ payload, close, ctx }: { payload: any; close: () => void; ctx: LeadFlowContext }) {
  const lead = payload.lead || {};
  const identityKey = ctx.userId && ctx.companyId ? `${ctx.userId}:${ctx.companyId}` : null;
  useCloseRemoteCallFlowOnIdentityChange(identityKey, close);

  const [outcome, setOutcome] = useState<'visita' | 'proposta' | 'retorno' | 'naoatendeu' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const applyEventHook = useApplyLeadEvent({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });

  // Posse por Lead (Manager: qualquer Lead da empresa; Seller: só o
  // próprio) — o backend continua sendo a autoridade final; esta checagem
  // é só a autorização visual (mesmo padrão do E5-B1/PipeCard).
  const authorized = canActorMutateLead({
    capability: ctx.capabilities.canLogCallOutcome,
    actorRole: ctx.membershipRole,
    actorSellerId: ctx.sellerId,
    leadSellerId: lead.sellerId ?? null,
  });

  if (!authorized) {
    return (
      <FlowShell eyebrow="CENTRAL DE CONTATO" title="Ligar" icon="phone" accent="#8B8B93" onClose={close}>
        <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
          Você não tem permissão para registrar uma ligação neste Lead.
        </div>
      </FlowShell>
    );
  }

  if (done) {
    return (
      <FlowShell eyebrow="CENTRAL DE CONTATO" title="Ligação registrada" icon="phone" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Resultado da ligação registrado." sub={`O andamento de ${lead.name ?? 'este Lead'} foi atualizado.`}
          actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
      </FlowShell>
    );
  }

  async function handleSaveOutcome() {
    if (!outcome || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const eventType = mapLeadHealthEventToRemoteEventType({ type: 'call', outcome });
      await applyEventHook.applyLeadEvent({ leadId: lead.id, eventType });
      setDone(true);
    } catch (err) {
      const code = isRemoteLeadsError(err) ? err.code : undefined;
      if (code === 'remote_leads_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(remoteCallOutcomeErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FlowShell eyebrow="CENTRAL DE CONTATO" title={`Ligar para ${(lead.name || '').split(' ')[0]}`} icon="phone" accent="#27C75F" onClose={close}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <FPanel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="alert" size={16} stroke={2.2} style={{ color: 'var(--t-500)', flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
              Nesta etapa, o resultado será salvo no andamento do Lead. Tarefas e linha do tempo serão disponibilizadas depois.
            </span>
          </div>
        </FPanel>
        <FPanel title="Resultado da ligação" icon="flag" accent="#27C75F" style={{ marginTop: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {CALL_OUTCOME_REMOTE_OPTIONS.map((o) => (
              <ChoiceTile key={o.id} icon={o.icon} title={o.title} accent={o.accent} active={outcome === o.id}
                onClick={() => { if (!submitting) setOutcome(o.id); }} />
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <LBtn kind="gold" size="lg" icon="check" onClick={handleSaveOutcome} style={{ width: '100%', justifyContent: 'center', opacity: outcome && !submitting ? 1 : .5 }}>
              {submitting ? 'Salvando…' : 'Salvar resultado'}
            </LBtn>
          </div>
        </FPanel>
        {submitError && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
            <Icon name="alert" size={18} stroke={2.2} style={{ color: 'var(--red, #FF3B3B)' }} />
            <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
          </div>
        )}
      </div>
    </FlowShell>
  );
}

export function FlowVerCliente({ payload, close, openFlow }: any) {
  const lead = payload.lead || LeadService.getAll()[0];
  // M1-E E4-B2: payload.capabilities (LeadMutationCapabilities), quando
  // presente, é a autoridade — substitui inteiramente a decisão antiga por
  // payload.readOnly, que continua funcionando exatamente como antes para
  // qualquer caller que só passe readOnly (nenhum caller existente precisa
  // migrar). Sem os dois: comportamento local integral (todas as 5 ações),
  // igual a antes do E3-B1.
  const capabilities: LeadMutationCapabilities | null = payload.capabilities ?? null;
  const legacyReadOnly = Boolean(payload.readOnly);
  const canEditDetails = capabilities ? capabilities.canEditDetails : !legacyReadOnly;
  // M1-E E3-B1/E4-B2: leads remotos nunca liberam Visita/Proposta/
  // Acompanhar por completo — isso é o picker de 18 eventos, ainda fora do
  // E5-B2-A2 (só a Ligação foi conectada). capabilities.canApplyEvents
  // cobre o mesmo caso que payload.readOnly cobria (sempre false no
  // caminho remoto), mais granular quando presente.
  const canApplyEvents = capabilities ? capabilities.canApplyEvents : !legacyReadOnly;
  // M1-E E5-B2-A2: Ligar agora é independente de canApplyEvents — usa
  // canLogCallOutcome + posse do Lead (canActorMutateLead), nunca infere
  // propriedade pelo nome do Seller. Só calculado quando capabilities está
  // presente (caminho remoto real) — o caminho legado (payload.readOnly,
  // sem capabilities) preserva o agrupamento antigo (Ligar sob o mesmo
  // booleano das demais ações), sem chamar AuthService.
  let canLigar: boolean;
  if (capabilities) {
    const currentUser = AuthService.getCurrentUser();
    const membershipRole: 'manager' | 'seller' | null =
      currentUser?.activeMembership?.role === 'manager' || currentUser?.activeMembership?.role === 'seller'
        ? currentUser.activeMembership.role
        : null;
    canLigar = canActorMutateLead({
      capability: capabilities.canLogCallOutcome,
      actorRole: membershipRole,
      actorSellerId: currentUser?.activeMembership?.sellerId ?? null,
      leadSellerId: lead.sellerId ?? null,
    });
  } else {
    canLigar = canApplyEvents;
  }
  const u = URG[lead.urgency];
  // lead.timeline is already the real record — addToTimeline() unshifts onto it
  // from Ligar/Visita/Proposta/Venda/Acompanhamento, so insertion order is
  // already newest-first. Seed leads and brand-new leads with no events yet
  // have no timeline at all, hence the null fallback below (M0-K3).
  const timeline: any[] | null = lead.timeline && lead.timeline.length > 0 ? lead.timeline : null;
  const createdByName = lead.createdByUserId ? (USERS.find((u: any) => u.id === lead.createdByUserId)?.name || '-') : '-';
  const createdAtLabel = (() => {
    if (!lead.createdAt) return '-';
    const d = new Date(lead.createdAt);
    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
  })();
  // M1-E E6-B2-A: Alterar responsável/Arquivar Lead são Manager-only,
  // independentes de canActorMutateLead (decisão humana do E6-A0/E6-A1 —
  // Seller é proibido de forma incondicional no backend para estas duas
  // ações, nunca uma questão de posse do Lead). Ausência de capabilities
  // (caminho local) nunca mostra estes botões — só existem no remoto.
  const canAssignSeller = capabilities ? capabilities.canAssignSeller : false;
  const canArchiveLead = capabilities ? capabilities.canArchive : false;
  const actions = [
    ...(canLigar ? [{ icon: 'phone', label: 'Ligar', flow: 'ligar', accent: '#27C75F' }] : []),
    ...(canApplyEvents ? [
      { icon: 'calendar', label: 'Agendar visita', flow: 'criar-visita', accent: '#E8CE72' },
      { icon: 'handshake', label: 'Nova proposta', flow: 'nova-proposta', accent: '#E8CE72' },
      // "Acompanhamento" is one unbreakable word wider than the 88px button —
      // it overflowed the box (M0-K3.2, problem 5). Shorter label + a word-break
      // safety net so no future long label leaks the same way.
      { icon: 'refresh', label: 'Acompanhar', flow: 'criar-acompanhamento', accent: '#3B82F6' },
    ] : []),
    ...(canEditDetails ? [{ icon: 'edit', label: 'Editar dados', flow: 'editar-cliente', accent: '#8B8B93' }] : []),
    ...(canAssignSeller ? [{ icon: 'users', label: 'Alterar responsável', flow: 'atribuir-vendedor', accent: '#3B82F6' }] : []),
    ...(canArchiveLead ? [{ icon: 'inbox', label: 'Arquivar Lead', flow: 'arquivar-lead', accent: '#FF3B3B' }] : []),
  ];
  return (
    <FlowShell eyebrow="CENTRAL DO CLIENTE" title={lead.name} icon="user"
      accent={u.c === 'var(--green)' ? '#27C75F' : u.c === 'var(--red)' ? '#FF3B3B' : '#FFA31F'} onClose={close}
      status={<LBadge tone={lead.urgency} solid={lead.urgency === 'red'}>{lead.urgency === 'red' && <Icon name="flame" size={12} stroke={2.4} />}{u.label}</LBadge>}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 22, borderRadius: 16, background: 'linear-gradient(120deg,#1b1b1f,#121214)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', marginBottom: 20, flexWrap: 'wrap' }}>
        <Avatar name={lead.name} size={72} ring={u.c} />
        <div style={{ minWidth: 0 }}>
          <div className="display" style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{lead.name}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="phone" size={14} stroke={2} /> {lead.phone}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="car" size={14} stroke={2} /> {lead.car}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="flow" size={14} stroke={2} /> {lead.stage}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="users" size={14} stroke={2} /> {lead.seller || '-'}</span>
          </div>
        </div>
        {actions.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {actions.map(a => (
              <button key={a.label} onClick={() => openFlow(a.flow, { lead })} className="lift" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 88, padding: '13px 8px', borderRadius: 13, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, background: `${a.accent}22`, color: a.accent, display: 'grid', placeItems: 'center' }}><Icon name={a.icon} size={19} stroke={2.1} /></span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t-700)', textAlign: 'center', overflowWrap: 'break-word', wordBreak: 'break-word', maxWidth: '100%' }}>{a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20, alignItems: 'start' }}>
        <FPanel title="Linha do tempo" icon="history" accent="#E8CE72">
          {timeline ? (
            <div style={{ position: 'relative', paddingLeft: 8 }}>
              {timeline.map((e: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i < timeline.length - 1 ? 20 : 0, position: 'relative' }}>
                  {i < timeline.length - 1 && <div style={{ position: 'absolute', left: 18, top: 38, bottom: 0, width: 2, background: 'var(--border)' }} />}
                  <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `${e.c}22`, color: e.c, display: 'grid', placeItems: 'center', border: `1px solid ${e.c}44`, zIndex: 1 }}><Icon name={e.icon} size={18} stroke={2.1} /></div>
                  <div style={{ flex: 1, paddingTop: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>{e.t}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--t-400)', whiteSpace: 'nowrap' }}>{e.when}</span>
                    </div>
                    {e.d && <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{e.d}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--t-500)', fontSize: 13 }}>Nenhum histórico registrado ainda.</div>
          )}
        </FPanel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FPanel title="Veículo de interesse" icon="car" accent="#E8CE72">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 56, height: 56, borderRadius: 13, background: 'rgba(255,255,255,.05)', display: 'grid', placeItems: 'center', color: 'var(--t-500)' }}><Icon name="car" size={28} stroke={1.8} /></div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t-900)' }}>{lead.car}</div>
                <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{lead.pay} · {lead.value}</div>
              </div>
            </div>
          </FPanel>
          <FPanel title="Cadastro" icon="clipboard" accent="#E8CE72">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <Info icon="users" label="Vendedor responsável" value={lead.seller || '-'} />
              {lead.origem && <Info icon="flag" label="Origem" value={lead.origem} />}
              <Info icon="user" label="Criado por" value={createdByName} />
              <Info icon="calendar" label="Data de cadastro" value={createdAtLabel} />
            </div>
          </FPanel>
          <FPanel title="Próxima ação recomendada" icon="sparkle" accent="#E8CE72">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 11, background: lead.urgency === 'red' ? 'var(--red-bg)' : 'var(--gold-bg)', border: `1px solid ${lead.urgency === 'red' ? 'var(--red-line)' : 'var(--gold-line)'}` }}>
              <Icon name={lead.urgency === 'red' ? 'flame' : 'phone'} size={20} stroke={2.2} style={{ color: lead.urgency === 'red' ? 'var(--red)' : 'var(--gold-ink)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-900)' }}>{lead.alert}</span>
            </div>
            {canLigar && (
              <div style={{ marginTop: 12 }}>
                <LBtn kind="gold" icon="phone" onClick={() => openFlow('ligar', { lead })} style={{ width: '100%', justifyContent: 'center' }}>Ligar agora</LBtn>
              </div>
            )}
          </FPanel>
        </div>
      </div>
    </FlowShell>
  );
}

// Mensagens sanitizadas fixas do resultado de assign_lead_seller — mesmo
// modelo de remoteCallOutcomeErrorMessage/remoteLeadMoveErrorMessage.
// identity_changed nunca chega aqui (tratado antes, fecha o flow).
function assignSellerErrorMessage(code: RemoteLeadsErrorCode | undefined): string {
  switch (code) {
    case 'remote_leads_mutation_seller_not_found':
      return 'O vendedor selecionado não está mais disponível.';
    case 'remote_leads_mutation_stale_write':
      return 'Este Lead foi alterado por outra pessoa. Feche e abra novamente para continuar.';
    case 'remote_leads_mutation_lead_archived':
      return 'Este Lead foi arquivado e não pode ser reatribuído.';
    case 'remote_leads_mutation_lead_not_found':
      return 'Este Lead não está mais disponível.';
    case 'remote_leads_mutation_forbidden':
      return 'Você não possui permissão para alterar o responsável deste Lead.';
    case 'remote_leads_mutation_company_read_only':
      return 'Esta empresa está em modo somente leitura.';
    default:
      return 'Não foi possível alterar o responsável.';
  }
}

// ── FlowAtribuirVendedor — troca/remoção de responsável, Manager-only
// (M1-E, E6-B2-A). Autorização vem exclusivamente de
// ctx.capabilities.canAssignSeller — NUNCA canActorMutateLead (decisão
// humana do E6-A0/E6-A1: assign_lead_seller proíbe Seller de forma
// incondicional no backend, não é questão de posse do Lead). Usa somente
// useCurrentCompanyAssignableSellers (catálogo OPERACIONAL, nunca o
// histórico list_current_company_seller_labels) + SellerPicker +
// useAssignLeadSeller + isNoOpSellerAssignment — nunca SellerService,
// StoreAdapter ou list_platform_sellers_for_company. ──────────────────────
export function FlowAtribuirVendedor({ payload, close }: any) {
  const lead = payload.lead || {};
  const user = AuthService.getCurrentUser();
  const ctx = resolveLeadFlowContext(user);
  const identityKey = ctx.userId && ctx.companyId ? `${ctx.userId}:${ctx.companyId}` : null;
  useCloseRemoteCallFlowOnIdentityChange(identityKey, close);

  const currentSellerId: string | null = lead.sellerId ?? null;
  // Nome de exibição já resolvido pelo catálogo histórico no adapter
  // (lib/leads/adapter.ts) — nunca recalculado aqui, e nunca escondido
  // mesmo quando o Seller está fora do catálogo operacional (decisão
  // humana: nome histórico sempre visível, nunca "Sem vendedor" forçado).
  const currentSellerName: string = lead.seller || '—';

  const assignableSellers = useCurrentCompanyAssignableSellers({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });
  const items: SellerPickerItem[] = assignableSellers.assignableSellers.map((s) => ({ id: s.seller_id, name: s.name }));

  // Cenário C (E6-B2-A §6): Seller atual fora do catálogo operacional
  // (histórico/inativo/offboarded) — picker começa SEM escolha explícita
  // (undefined), nunca representado como null (null = "Sem vendedor"
  // escolhido deliberadamente, algo bem diferente de "nada escolhido
  // ainda"). A decisão só pode ser tomada DEPOIS que o catálogo
  // operacional carregar — enquanto `isLoading`, `assignableSellers
  // .sellersById` está vazio e classificaria erroneamente até um Seller
  // realmente operacional como "fora do catálogo" (falso Cenário C).
  // `initializedRef` garante que a escolha inicial rode só uma vez, assim
  // que o carregamento terminar — nunca recalculada depois (senão uma
  // escolha explícita do usuário, incluindo "Sem vendedor", seria
  // silenciosamente revertida a cada render). Visualmente inofensivo
  // enquanto carrega: o SellerPicker prioriza o estado `loading` sobre
  // `value` (mostra "Carregando vendedores…" e fica desabilitado).
  const [selectedSellerId, setSelectedSellerId] = useState<string | null | undefined>(undefined);
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || assignableSellers.isLoading) return;
    initializedRef.current = true;
    if (currentSellerId === null) {
      setSelectedSellerId(null);
    } else if (assignableSellers.sellersById[currentSellerId]) {
      setSelectedSellerId(currentSellerId);
    } else {
      setSelectedSellerId(undefined);
    }
  }, [assignableSellers.isLoading, assignableSellers.sellersById, currentSellerId]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const assignHook = useAssignLeadSeller({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });

  if (!ctx.capabilities.canAssignSeller) {
    return (
      <FlowShell eyebrow="RESPONSÁVEL" title="Alterar responsável" icon="users" accent="#8B8B93" onClose={close}>
        <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
          Você não possui permissão para alterar o responsável deste Lead.
        </div>
      </FlowShell>
    );
  }

  if (done) {
    return (
      <FlowShell eyebrow="RESPONSÁVEL" title="Responsável atualizado" icon="users" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Responsável atualizado com sucesso" sub={`O vendedor responsável por ${lead.name || 'este Lead'} foi atualizado.`}
          actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
      </FlowShell>
    );
  }

  // selectedSellerId === undefined: nenhuma escolha explícita ainda — nunca
  // permite submit, mesmo que o Seller atual pareça "sem mudança" (decisão
  // humana: "Sem vendedor" precisa ser selecionado explicitamente).
  const isNoOp = selectedSellerId === undefined ? true : isNoOpSellerAssignment(currentSellerId, selectedSellerId);
  const canSubmit = Boolean(lead.id) && typeof lead.version === 'number' && !isNoOp && !submitting;

  async function handleSave() {
    if (!canSubmit || selectedSellerId === undefined || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await assignHook.assignLeadSeller({ leadId: lead.id, sellerId: selectedSellerId, expectedVersion: lead.version });
      setDone(true);
    } catch (err) {
      const code = isRemoteLeadsError(err) ? err.code : undefined;
      if (code === 'remote_leads_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(assignSellerErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FlowShell eyebrow="RESPONSÁVEL" title={`Alterar responsável de ${(lead.name || '').split(' ')[0]}`} icon="users" accent="#3B82F6" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="ghost" size="lg" onClick={close}>Cancelar</LBtn>
        <LBtn kind="gold" size="lg" icon="check" onClick={handleSave} style={{ opacity: canSubmit ? 1 : .5 }}>
          {submitting ? 'Salvando…' : 'Salvar'}
        </LBtn></>}>
      <div style={{ maxWidth: 560 }}>
        <FPanel title="Responsável atual" icon="users" accent="#3B82F6">
          <Info icon="user" label="Vendedor responsável" value={currentSellerName} />
        </FPanel>
        <div style={{ marginTop: 16 }}>
          <SellerPicker
            items={items}
            value={selectedSellerId}
            onChange={(sellerId) => { if (!submitting) setSelectedSellerId(sellerId); }}
            loading={assignableSellers.isLoading}
            disabled={submitting}
            error={assignableSellers.isError ? 'Não foi possível carregar os vendedores.' : null}
            placeholder="Selecione uma nova opção"
          />
        </div>
        {submitError && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
            <Icon name="alert" size={18} stroke={2.2} style={{ color: 'var(--red, #FF3B3B)' }} />
            <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
          </div>
        )}
      </div>
    </FlowShell>
  );
}

// Mensagens sanitizadas fixas do resultado de archive_lead.
function archiveLeadErrorMessage(code: RemoteLeadsErrorCode | undefined): string {
  switch (code) {
    case 'remote_leads_mutation_stale_write':
      return 'Este Lead foi alterado por outra pessoa. Atualize os dados antes de arquivar.';
    case 'remote_leads_mutation_lead_not_found':
      return 'Este Lead não está mais disponível.';
    case 'remote_leads_mutation_forbidden':
      return 'Você não possui permissão para arquivar este Lead.';
    case 'remote_leads_mutation_company_read_only':
      return 'Esta empresa está em modo somente leitura.';
    default:
      return 'Não foi possível arquivar o Lead.';
  }
}

// ── FlowArquivarLead — arquivamento com confirmação explícita, Manager-only
// (M1-E, E6-B2-A). Autorização vem exclusivamente de
// ctx.capabilities.canArchive — NUNCA canActorMutateLead (mesma razão de
// FlowAtribuirVendedor). Não cria aba de arquivados nem chama
// useArchivedLeads/useUnarchiveLead — só remove o Lead das listas ativas
// via invalidation (dentro do próprio hook), sem nenhuma escrita local. ───
export function FlowArquivarLead({ payload, close }: any) {
  const lead = payload.lead || {};
  const user = AuthService.getCurrentUser();
  const ctx = resolveLeadFlowContext(user);
  const identityKey = ctx.userId && ctx.companyId ? `${ctx.userId}:${ctx.companyId}` : null;
  useCloseRemoteCallFlowOnIdentityChange(identityKey, close);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const archiveHook = useArchiveLead({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });

  if (!ctx.capabilities.canArchive) {
    return (
      <FlowShell eyebrow="ARQUIVAMENTO" title="Arquivar Lead" icon="inbox" accent="#8B8B93" onClose={close}>
        <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
          Você não possui permissão para arquivar este Lead.
        </div>
      </FlowShell>
    );
  }

  if (done) {
    return (
      <FlowShell eyebrow="ARQUIVAMENTO" title="Lead arquivado" icon="inbox" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Lead arquivado com sucesso" sub={`${lead.name || 'Este Lead'} saiu das listas ativas. As informações continuam preservadas.`}
          actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
      </FlowShell>
    );
  }

  async function handleConfirm() {
    if (submitting || !lead.id || typeof lead.version !== 'number') return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await archiveHook.archiveLead({ leadId: lead.id, expectedVersion: lead.version });
      setDone(true);
    } catch (err) {
      const code = isRemoteLeadsError(err) ? err.code : undefined;
      if (code === 'remote_leads_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(archiveLeadErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FlowShell eyebrow="ARQUIVAMENTO" title={`Arquivar ${(lead.name || '').split(' ')[0]}`} icon="inbox" accent="#FF3B3B" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="ghost" size="lg" onClick={close}>Cancelar</LBtn>
        <LBtn kind="danger" size="lg" icon="inbox" onClick={handleConfirm} style={{ opacity: submitting ? .5 : 1 }}>
          {submitting ? 'Arquivando…' : 'Arquivar Lead'}
        </LBtn></>}>
      <div style={{ maxWidth: 560 }}>
        <FPanel>
          <div style={{ fontSize: 14, color: 'var(--t-700)' }}>
            Arquivar este Lead? Ele sairá das listas ativas, mas suas informações continuarão preservadas.
          </div>
        </FPanel>
        {submitError && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
            <Icon name="alert" size={18} stroke={2.2} style={{ color: 'var(--red, #FF3B3B)' }} />
            <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
          </div>
        )}
      </div>
    </FlowShell>
  );
}
