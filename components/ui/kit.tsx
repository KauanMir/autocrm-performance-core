'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { initials, ringFor } from '@/lib/data';

export const NAV = [
  { id: 'home',      label: 'Início',       icon: 'home' },
  { id: 'clientes',  label: 'Clientes',     icon: 'users' },
  { id: 'andamento', label: 'Em progresso', icon: 'flow' },
  { id: 'pendencias',label: 'Pendências',   icon: 'check' },
  { id: 'visitas',   label: 'Visitas',      icon: 'calendar' },
  { id: 'propostas', label: 'Propostas',    icon: 'handshake' },
  { id: 'vendas',    label: 'Vendas',       icon: 'trophy' },
  { id: 'resultados',label: 'Resultados',   icon: 'bars' },
  { id: 'ajustes',   label: 'Ajustes',      icon: 'gear' },
  // M1-F S3-B: só aparece para Super Admin da plataforma com a flag
  // NEXT_PUBLIC_FF_PLATFORM_ADMIN ON — visibilidade real decidida em
  // allowedNavIds (components/App.tsx), nunca aqui.
  { id: 'empresas',  label: 'Empresas',     icon: 'building' },
];

export const URG: Record<string, { c: string; bg: string; line: string; label: string }> = {
  red:   { c: 'var(--red)',   bg: 'var(--red-bg)',   line: 'var(--red-line)',   label: 'Atrasado' },
  amber: { c: 'var(--amber)', bg: 'var(--amber-bg)', line: 'var(--amber-line)', label: 'Aguardando' },
  green: { c: 'var(--green)', bg: 'var(--green-bg)', line: 'var(--green-line)', label: 'Saudável' },
};

export function Avatar({ name, size = 40, ring, gold = false }: {
  name: string; size?: number; ring?: string; gold?: boolean; dark?: boolean;
}) {
  const r = gold ? '#D4AF37' : (ring || ringFor(name));
  const fs = Math.round(size * 0.38);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'grid', placeItems: 'center', position: 'relative',
      background: 'radial-gradient(circle at 32% 26%, #2c2c30, #161618)',
      color: '#fff',
      fontFamily: 'Archivo, sans-serif', fontWeight: 700, fontSize: fs,
      boxShadow: `0 0 0 ${Math.max(2, size * 0.05)}px ${r}${gold ? '' : 'cc'}, inset 0 1px 0 rgba(255,255,255,.08)`,
      letterSpacing: '.02em',
    }}>
      {initials(name)}
    </div>
  );
}

export function useCountUp(target: number, active = true, dur = 900) {
  const [v, setV] = useState(active ? 0 : target);
  useEffect(() => {
    if (!active) { setV(target); return; }
    const t0 = Date.now(); let raf: number; let killed = false;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * e));
      if (p < 1 && !killed) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const fb = setTimeout(() => { killed = true; setV(target); }, dur + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(fb); killed = true; };
  }, [target, active]);
  return v;
}

export function CountUp({ value, active, className, style }: { value: number; active?: boolean; className?: string; style?: React.CSSProperties }) {
  const v = useCountUp(value, active);
  return <span className={'tnum ' + (className || '')} style={style}>{v}</span>;
}

export function LCard({ children, style, className, pad = 20, onClick }: {
  children: React.ReactNode; style?: React.CSSProperties; className?: string; pad?: number; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={className} style={{
      background: 'linear-gradient(180deg, #1a1a1d, #131315)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)',
      padding: pad, position: 'relative', ...style,
    }}>{children}</div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 30, fontWeight: 800, color: 'var(--t-900)', letterSpacing: '-.02em' }}>{title}</h1>
        {sub && <p style={{ margin: '6px 0 0', color: 'var(--t-500)', fontSize: 14.5 }}>{sub}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function LBtn({ children, kind = 'primary', icon, size = 'md', onClick, style }: {
  children?: React.ReactNode; kind?: 'primary' | 'gold' | 'danger' | 'ghost'; icon?: string;
  size?: 'sm' | 'md' | 'lg'; onClick?: () => void; style?: React.CSSProperties;
}) {
  const sizes: Record<string, { p: string; fs: number; ic: number }> = {
    sm: { p: '7px 12px',  fs: 13,   ic: 15 },
    md: { p: '10px 16px', fs: 14,   ic: 17 },
    lg: { p: '14px 22px', fs: 15.5, ic: 19 },
  };
  const s = sizes[size];
  const kinds: Record<string, React.CSSProperties> = {
    primary: { background: 'linear-gradient(180deg,#33333a,#222226)', color: '#fff', border: '1px solid rgba(255,255,255,.14)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.1), 0 6px 16px -8px rgba(0,0,0,.7)' },
    gold:    { background: 'linear-gradient(180deg,#E8CE72,#C9A227)', color: '#2a2104', border: '1px solid #C9A227', fontWeight: 700, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35), 0 8px 22px -8px rgba(212,175,55,.55)' },
    danger:  { background: 'linear-gradient(180deg,#FF4242,#D81F2C)', color: '#fff', border: '1px solid #FF5A5A', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.22), 0 8px 22px -8px rgba(255,46,46,.6)' },
    ghost:   { background: 'rgba(255,255,255,.04)', color: 'var(--t-700)', border: '1px solid var(--border)' },
  };
  return (
    <button onClick={onClick} className="focus-ring" style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: s.p, fontSize: s.fs,
      fontWeight: 600, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
      transition: 'transform .12s, filter .12s, box-shadow .12s', whiteSpace: 'nowrap',
      ...kinds[kind], ...style,
    }}
      onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'none'; }}>
      {icon && <Icon name={icon} size={s.ic} stroke={2.2} />}{children}
    </button>
  );
}

export function LBadge({ children, tone = 'green', solid = false, style }: {
  children: React.ReactNode; tone?: string; solid?: boolean; style?: React.CSSProperties;
}) {
  const u = URG[tone] || URG.green;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
      padding: '4px 10px', borderRadius: 999, letterSpacing: '.01em',
      color: solid ? '#fff' : u.c, background: solid ? u.c : u.bg, border: `1px solid ${solid ? u.c : u.line}`,
      ...style,
    }}>{children}</span>
  );
}

export function Chip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="focus-ring" style={{
      padding: '7px 15px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
      fontFamily: 'inherit', transition: 'all .15s',
      background: active ? 'linear-gradient(180deg,#34343a,#26262a)' : 'rgba(255,255,255,.03)',
      color: active ? '#fff' : 'var(--t-500)',
      border: `1px solid ${active ? 'rgba(255,255,255,.18)' : 'var(--border)'}`,
      boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,.08)' : 'none',
    }}>{children}</button>
  );
}

export function Guide({ tone = 'red', icon = 'alert', text, action, onAction, scream = false }: {
  tone?: string; icon?: string; text: React.ReactNode; action?: string; onAction?: () => void; scream?: boolean;
}) {
  const u = URG[tone] || URG.red;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px', borderRadius: 13,
      background: `linear-gradient(180deg, ${u.bg}, rgba(0,0,0,.18)), #161618`, border: `1px solid ${u.line}`, marginBottom: 14,
      boxShadow: 'var(--shadow-sm)',
      animation: scream ? 'redScream 2.4s ease-in-out infinite' : 'none',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(180deg, ${u.c}, color-mix(in srgb, ${u.c} 70%, #000))`, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: `0 6px 16px -6px ${u.c}` }}>
        <Icon name={icon} size={19} stroke={2.4} />
      </div>
      <div style={{ flex: 1, color: 'var(--t-900)', fontSize: 14.5, fontWeight: 500 }}>{text}</div>
      {action && <button onClick={onAction} className="focus-ring" style={{
        background: `linear-gradient(180deg, ${u.c}, color-mix(in srgb, ${u.c} 78%, #000))`, color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 10,
        fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', boxShadow: `0 6px 16px -8px ${u.c}`,
      }}>{action}</button>}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = 'ink', active }: {
  label: string; value: number | string; sub?: string; icon?: string; tone?: string; active?: boolean;
}) {
  const tones: Record<string, { c: string; bg: string; ic: string }> = {
    ink:   { c: 'var(--t-900)',    bg: 'rgba(255,255,255,.06)', ic: 'var(--t-500)' },
    red:   { c: 'var(--red)',      bg: 'var(--red-bg)',         ic: 'var(--red)' },
    amber: { c: 'var(--amber)',    bg: 'var(--amber-bg)',       ic: 'var(--amber)' },
    green: { c: 'var(--green)',    bg: 'var(--green-bg)',       ic: 'var(--green)' },
    gold:  { c: 'var(--gold-ink)', bg: 'var(--gold-bg)',        ic: 'var(--gold-ink)' },
  };
  const tn = tones[tone] || tones.ink;
  return (
    <LCard className="lift" pad={18} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t-500)' }}>{label}</span>
        {icon && <span style={{ width: 34, height: 34, borderRadius: 10, background: tn.bg, color: tn.ic, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)' }}><Icon name={icon} size={17} stroke={2.2} /></span>}
      </div>
      <div className="display tnum" style={{ fontSize: 34, fontWeight: 800, color: tn.c, lineHeight: 1, letterSpacing: '-.02em' }}>
        {typeof value === 'number' ? <CountUp value={value} active={active} /> : value}
      </div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--t-400)' }}>{sub}</div>}
    </LCard>
  );
}

export function FitBox({ naturalWidth, align = 'center', children }: {
  naturalWidth: number; align?: 'center' | 'bottom'; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => { const w = el.clientWidth; setScale(Math.min(1, w / naturalWidth)); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [naturalWidth]);
  return (
    <div ref={ref} style={{ width: '100%', height: '100%', display: 'grid', placeItems: align === 'bottom' ? 'end center' : 'center', overflow: 'hidden' }}>
      <div style={{ width: naturalWidth, transform: scale >= 0.96 ? 'none' : `scale(${scale})`, transformOrigin: align === 'bottom' ? 'center bottom' : 'center center' }}>{children}</div>
    </div>
  );
}

export function TopBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 28px', borderBottom: '1px solid var(--border)', background: 'rgba(10,10,11,.7)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 6 }}>
      <div onClick={() => (window as any).__openFlow && (window as any).__openFlow('busca')} className="lift" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, maxWidth: 460, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 14px', cursor: 'pointer' }}>
        <Icon name="search" size={17} stroke={2.2} style={{ color: 'var(--t-400)' }} />
        <input readOnly placeholder="Buscar cliente, telefone, veículo..." style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', width: '100%', cursor: 'pointer' }} />
        <kbd style={{ fontSize: 10.5, color: 'var(--t-400)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px', fontFamily: 'inherit', flexShrink: 0 }}>⌘K</kbd>
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={() => (window as any).__openFlow && (window as any).__openFlow('notificacoes')} className="focus-ring lift" style={{ position: 'relative', width: 42, height: 42, borderRadius: 11, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)' }}>
        <Icon name="bell" size={19} stroke={2} />
        <span style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: '#FF3B3B', border: '2px solid #0a0a0b', boxShadow: '0 0 8px 1px rgba(255,46,46,.7)', animation: 'dotPulse 2s ease-in-out infinite' }} />
      </button>
    </div>
  );
}

export function LightScreen({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)', color: 'var(--t-900)', position: 'relative' }}>
      <div style={{ position: 'fixed', top: -160, right: '6%', width: 520, height: 360, background: 'radial-gradient(ellipse, rgba(193,18,31,.06), transparent 70%)', pointerEvents: 'none' }} />
      <TopBar />
      <div style={{ padding: '26px 30px 60px', maxWidth: 1360, margin: '0 auto', position: 'relative' }}>{children}</div>
    </div>
  );
}
