'use client';
import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, URG, LBtn, LBadge } from '@/components/ui/kit';
import { LEADS } from '@/lib/data';

export const CARS = ['Golf GTI 2022', 'Honda HR-V 2023', 'Toyota Corolla 2023', 'VW Polo 2023', 'Jeep Compass 2022', 'Hyundai Creta 2023', 'Fiat Pulse 2023', 'Chevrolet Onix 2023', 'Renault Kardian 2024', 'Nissan Kicks 2023'];
export const ORIGINS: [string, string][] = [['Showroom', 'car'], ['WhatsApp', 'message'], ['Instagram', 'instagram'], ['Webmotors', 'search'], ['iCarros', 'car'], ['Mercado Livre', 'card'], ['Grupo VIP', 'star'], ['Site', 'grid'], ['Indicação', 'users'], ['Telefone', 'phone']];
export const PAYS: [string, string][] = [['À vista', 'card'], ['Financiamento 100%', 'doc'], ['Entrada + Financiamento', 'dollar'], ['Troca', 'refresh']];

export function findLead(name: string) { return LEADS.find(l => l.name === name); }

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

export function FlowLigar({ payload, close, openFlow }: any) {
  const lead = payload.lead || LEADS[0];
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
  const outcomes = [
    { id: 'visita', icon: 'calendar', title: 'Atendeu — agendar visita', accent: '#27C75F', next: 'criar-visita' },
    { id: 'proposta', icon: 'handshake', title: 'Atendeu — montar proposta', accent: '#E8CE72', next: 'nova-proposta' },
    { id: 'retorno', icon: 'clock', title: 'Pediu retorno — agendar follow-up', accent: '#FFA31F', next: 'criar-acompanhamento' },
    { id: 'naoatendeu', icon: 'phone', title: 'Não atendeu — tentar mais tarde', accent: '#8B8B93', next: null },
  ];

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
              <LBtn kind="gold" size="lg" icon="check" onClick={() => outcome && setPhase('done')} style={{ width: '100%', justifyContent: 'center', opacity: outcome ? 1 : .5 }}>Salvar resultado e continuar</LBtn>
            </div>
          </FPanel>
        </div>
      </div>
    </FlowShell>
  );
}

export function FlowVerCliente({ payload, close, openFlow }: any) {
  const lead = payload.lead || LEADS[0];
  const u = URG[lead.urgency];
  const timeline = [
    { icon: 'phone', c: '#27C75F', t: 'Ligação realizada', d: lead.last, when: 'Hoje' },
    { icon: 'message', c: '#3B82F6', t: 'WhatsApp enviado', d: 'Apresentação do veículo', when: 'Ontem' },
    { icon: 'car', c: '#E8CE72', t: 'Demonstrou interesse', d: lead.car, when: 'há 2 dias' },
    { icon: 'plus', c: '#8B8B93', t: 'Cliente cadastrado', d: 'Origem: Showroom', when: 'há 4 dias' },
  ];
  const actions = [
    { icon: 'phone', label: 'Ligar', flow: 'ligar', accent: '#27C75F' },
    { icon: 'calendar', label: 'Agendar visita', flow: 'criar-visita', accent: '#E8CE72' },
    { icon: 'handshake', label: 'Nova proposta', flow: 'nova-proposta', accent: '#E8CE72' },
    { icon: 'refresh', label: 'Acompanhamento', flow: 'criar-acompanhamento', accent: '#3B82F6' },
    { icon: 'edit', label: 'Editar dados', flow: 'editar-cliente', accent: '#8B8B93' },
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
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actions.map(a => (
            <button key={a.label} onClick={() => openFlow(a.flow, { lead })} className="lift" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 88, padding: '13px 8px', borderRadius: 13, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, background: `${a.accent}22`, color: a.accent, display: 'grid', placeItems: 'center' }}><Icon name={a.icon} size={19} stroke={2.1} /></span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--t-700)', textAlign: 'center' }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20, alignItems: 'start' }}>
        <FPanel title="Linha do tempo" icon="history" accent="#E8CE72">
          <div style={{ position: 'relative', paddingLeft: 8 }}>
            {timeline.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i < timeline.length - 1 ? 20 : 0, position: 'relative' }}>
                {i < timeline.length - 1 && <div style={{ position: 'absolute', left: 18, top: 38, bottom: 0, width: 2, background: 'var(--border)' }} />}
                <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: `${e.c}22`, color: e.c, display: 'grid', placeItems: 'center', border: `1px solid ${e.c}44`, zIndex: 1 }}><Icon name={e.icon} size={18} stroke={2.1} /></div>
                <div style={{ flex: 1, paddingTop: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>{e.t}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--t-400)', whiteSpace: 'nowrap' }}>{e.when}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{e.d}</div>
                </div>
              </div>
            ))}
          </div>
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
          <FPanel title="Próxima ação recomendada" icon="sparkle" accent="#E8CE72">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 11, background: lead.urgency === 'red' ? 'var(--red-bg)' : 'var(--gold-bg)', border: `1px solid ${lead.urgency === 'red' ? 'var(--red-line)' : 'var(--gold-line)'}` }}>
              <Icon name={lead.urgency === 'red' ? 'flame' : 'phone'} size={20} stroke={2.2} style={{ color: lead.urgency === 'red' ? 'var(--red)' : 'var(--gold-ink)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-900)' }}>{lead.alert}</span>
            </div>
            <div style={{ marginTop: 12 }}>
              <LBtn kind="gold" icon="phone" onClick={() => openFlow('ligar', { lead })} style={{ width: '100%', justifyContent: 'center' }}>Ligar agora</LBtn>
            </div>
          </FPanel>
        </div>
      </div>
    </FlowShell>
  );
}
