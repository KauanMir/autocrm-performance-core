'use client';
import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, CountUp, FitBox } from '@/components/ui/kit';
import { PLACE, Podium } from '@/components/podiums/Podiums';
import { useStore } from '@/lib/store';
import { AuthService, SellerService, LeadService, VisitService, DealService, SaleService, TaskService } from '@/lib/services';
import { VISIT_STATUS, DEAL_STATUS, TASK_STATE } from '@/lib/data';

const PERIODS = ['Hoje', '7 dias', '15 dias', '30 dias', 'Personalizado'];

const DEFAULT_SELLER = {
  id: '', name: 'Equipe', first: 'Equipe', team: '',
  leads: 0, scheduled: 0, visits: 0, sales: 0, conv: 0, move: 0,
};

function getCompetition(sellers: any[]) {
  const currentUser = AuthService.getCurrentUser();
  const me = (currentUser?.sellerId ? SellerService.getById(currentUser.sellerId) : null)
    ?? SellerService.getAll()[0]
    ?? DEFAULT_SELLER;
  const meIdx = sellers.findIndex((s: any) => s.id === me.id);
  const rivalAhead = meIdx > 0 ? sellers[meIdx - 1] : null;
  const chaser = meIdx >= 0 && meIdx < sellers.length - 1 ? sellers[meIdx + 1] : null;
  const third = sellers[2] ?? sellers[sellers.length - 1] ?? null;
  const top3Gap = Math.max(0, (third?.sales ?? 0) - (me.sales ?? 0));
  const aheadGap = Math.max(0, (rivalAhead?.sales ?? 0) - (me.sales ?? 0));
  return { meIdx, me, pos: meIdx >= 0 ? meIdx + 1 : 1, rivalAhead, chaser, third, top3Gap, aheadGap, weeklyDone: 2, weeklyGoal: 3, leader: sellers[0] ?? DEFAULT_SELLER };
}

function ControlBar({ period, setPeriod, variant, setVariant, team, setTeam }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 26px', borderBottom: '1px solid var(--line-dark)', background: 'rgba(8,8,9,.78)', backdropFilter: 'blur(10px)', position: 'sticky', top: 0, zIndex: 8 }}>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
        {PERIODS.map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{ padding: '8px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: period === p ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'transparent', color: period === p ? '#2a2104' : 'var(--txt-mid)', transition: 'all .15s' }}>{p}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
        {['Todos', 'Novos', 'Seminovos'].map(tm => (
          <button key={tm} onClick={() => setTeam(tm)} style={{ padding: '8px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: team === tm ? 'rgba(255,255,255,.08)' : 'transparent', color: team === tm ? '#fff' : 'var(--txt-lo)', transition: 'all .15s' }}>{tm}</button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Pódio</span>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.03)', border: '1px solid var(--line-dark)', borderRadius: 12, padding: 3 }}>
          {[['A', 'Pódio'], ['B', 'Líder'], ['C', 'Galeria'], ['D', 'Campeão']].map(([v, name]) => (
            <button key={v} onClick={() => setVariant(v)} title={name} style={{ padding: '8px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: 'none', fontFamily: 'Archivo, sans-serif', background: variant === v ? 'rgba(212,175,55,.16)' : 'transparent', color: variant === v ? '#E8CE72' : 'var(--txt-lo)', boxShadow: variant === v ? 'inset 0 0 0 1px rgba(212,175,55,.4)' : 'none', transition: 'all .15s' }}>{v}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 14, borderLeft: '1px solid var(--line-dark)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#27C75F', animation: 'livePulse 2s infinite' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>AO VIVO</span>
        <span style={{ fontSize: 11.5, color: 'var(--txt-lo)' }}>· agora</span>
      </div>
    </div>
  );
}

function CompTicker({ comp }: any) {
  const msgs = [
    { icon: 'flag', c: '#E8CE72', t: <span>Faltam <b>{comp.top3Gap} vendas</b> para você entrar no <b>TOP 3</b></span> },
    { icon: 'flame', c: '#FF6B3B', t: <span><b>{comp.chaser?.first ?? '—'}</b> subiu 3 posições e empatou com você</span> },
    { icon: 'target', c: '#E23744', t: <span>Seu rival direto: <b>{comp.rivalAhead?.first ?? '—'}</b> — {comp.aheadGap} vendas à frente</span> },
    { icon: 'trophy', c: '#E8CE72', t: <span><b>{comp.leader?.first}</b> lidera com {comp.leader?.sales} vendas</span> },
    { icon: 'zap', c: '#27C75F', t: <span>Meta da semana: <b>+{comp.weeklyGoal} vendas</b></span> },
  ];
  const row = (key: string) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 38, padding: '0 19px', flexShrink: 0 }}>
      {msgs.map((m, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <Icon name={m.icon} size={15} stroke={2.2} style={{ color: m.c }} />
          <span style={{ fontSize: 13, color: 'var(--txt-mid)', whiteSpace: 'nowrap' }}>{m.t}</span>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--line-dark-2)', marginLeft: 18 }} />
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ borderBottom: '1px solid var(--line-dark)', background: 'linear-gradient(180deg,#0d0d0e,#0a0a0b)', overflow: 'hidden', position: 'sticky', top: 57, zIndex: 7, height: 42, display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', width: 'max-content', animation: 'tickerScroll 42s linear infinite' }}>
        {row('a')}{row('b')}
      </div>
    </div>
  );
}

function Col({ label, v }: { label: string; v: any }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 40 }}>
      <div className="tnum" style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt-mid)', lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 9, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function RankingRow({ s, pos, active, leader, me, target }: any) {
  const pl = pos <= 3 ? (PLACE as any[])[pos - 1] : null;
  const moveIcon = s.move > 0 ? 'arrowUp' : s.move < 0 ? 'arrowDown' : null;
  const moveColor = s.move > 0 ? '#27C75F' : s.move < 0 ? '#E23744' : 'var(--txt-lo)';
  const bg = leader ? 'linear-gradient(90deg,rgba(212,175,55,.14),rgba(212,175,55,.02))'
    : me ? 'linear-gradient(90deg,rgba(59,130,246,.16),rgba(59,130,246,.02))'
    : target ? 'linear-gradient(90deg,rgba(212,175,55,.07),transparent)' : 'transparent';
  const bd = leader ? 'rgba(212,175,55,.32)' : me ? 'rgba(59,130,246,.45)' : target ? 'rgba(212,175,55,.22)' : 'transparent';
  return (
    <div onClick={() => (window as any).__openFlow && (window as any).__openFlow('perfil-vendedor', { seller: s, pos })}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 12, background: bg, border: `1px solid ${bd}`, transition: 'background .15s', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
      onMouseEnter={(e: any) => { if (!leader && !me) e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
      onMouseLeave={(e: any) => { if (!leader && !me) e.currentTarget.style.background = bg; }}>
      {leader && active && <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><div style={{ position: 'absolute', top: 0, left: 0, width: '30%', height: '100%', background: 'linear-gradient(90deg,transparent,rgba(212,175,55,.14),transparent)', animation: 'sweep 6s ease-in-out 1s infinite' }} /></div>}
      <div className="display tnum" style={{ width: 26, textAlign: 'center', fontSize: 19, fontWeight: 900, color: pl ? pl.ring : me ? '#5B9BFF' : 'var(--txt-lo)' }}>{pos}</div>
      <div style={{ width: 13, color: moveColor }}>{moveIcon && <Icon name={moveIcon} size={13} stroke={3} />}</div>
      <Avatar name={s.name} size={34} ring={pl ? pl.ring : me ? '#3B82F6' : '#3a3a40'} gold={pos === 1} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
          {me && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', color: '#fff', background: '#3B82F6', padding: '2px 7px', borderRadius: 999 }}>VOCÊ</span>}
          {target && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', color: '#E8CE72', background: 'rgba(212,175,55,.14)', border: '1px solid rgba(212,175,55,.4)', padding: '1px 7px', borderRadius: 999 }}>SEU ALVO</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{s.team}</div>
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Col label="Leads" v={s.leads} />
        <Col label="Visitas" v={s.visits} />
        <Col label="Conv." v={s.conv + '%'} />
        <div style={{ textAlign: 'center', minWidth: 44 }}>
          <div className="display tnum" style={{ fontSize: 23, fontWeight: 900, color: pos === 1 ? '#E8CE72' : me ? '#5B9BFF' : '#fff', lineHeight: 1 }}>{s.sales}</div>
          <div style={{ fontSize: 9, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>vendas</div>
        </div>
      </div>
    </div>
  );
}

function RankingList({ sellers, active, comp }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(180deg,#161618,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, overflow: 'hidden', height: '100%', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '17px 18px', borderBottom: '1px solid var(--line-dark)' }}>
        <Icon name="trophy" size={17} stroke={2} style={{ color: '#D4AF37' }} />
        <span className="display" style={{ fontWeight: 800, fontSize: 15.5, color: '#fff', letterSpacing: '.01em' }}>Ranking completo</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--txt-lo)' }}>{sellers.length} vendedores</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {(sellers as any[]).map((s: any, i: number) => <RankingRow key={s.id} s={s} pos={i + 1} active={active} leader={i === 0} me={s.id === (AuthService.getCurrentUser()?.sellerId ?? null)} target={comp && s.id === (comp.rivalAhead && comp.rivalAhead.id)} />)}
      </div>
    </div>
  );
}

function RaceMsg({ icon, c, title, children }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 16px', borderRadius: 13, background: `linear-gradient(180deg, ${c}1f, rgba(0,0,0,.18)), #161618`, border: `1px solid ${c}55` }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: `${c}26`, color: c, display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07)' }}>
        <Icon name={icon} size={19} stroke={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 3 }}>{children}</div>
      </div>
    </div>
  );
}

function MinhaDisputa({ active, comp }: any) {
  const me = comp.me;
  const stats = [
    { label: 'Meus leads', v: me.leads, icon: 'users' },
    { label: 'Agendadas', v: me.scheduled, icon: 'calendar' },
    { label: 'Visitas feitas', v: me.visits, icon: 'check' },
    { label: 'Minhas vendas', v: me.sales, icon: 'trophy', gold: true },
    { label: 'Conversão', v: me.conv, suf: '%', icon: 'target' },
  ];
  const goalPct = Math.round((comp.weeklyDone / comp.weeklyGoal) * 100);
  return (
    <div style={{ background: 'linear-gradient(135deg,#19191c,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, padding: 24, boxShadow: 'var(--shadow-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <Avatar name={me.name} size={52} ring="#3B82F6" />
        <div>
          <div style={{ fontSize: 12, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>Minha disputa</div>
          <div className="display" style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{me.name}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,.35)', border: '1px solid var(--line-dark)', borderRadius: 14, padding: '12px 20px' }}>
          <span style={{ fontSize: 11.5, color: 'var(--txt-lo)' }}>Minha posição</span>
          <span className="display" style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{comp.pos}º</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, alignContent: 'start' }}>
          {stats.map((s: any) => (
            <div key={s.label} style={{ background: 'rgba(0,0,0,.3)', border: '1px solid var(--line-dark)', borderRadius: 13, padding: '14px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
                <Icon name={s.icon} size={14} stroke={2} style={{ color: s.gold ? '#D4AF37' : 'var(--txt-lo)' }} />
              </div>
              <div className="display tnum" style={{ fontSize: 28, fontWeight: 800, color: s.gold ? '#E8CE72' : '#fff', lineHeight: 1 }}>
                {active ? <CountUp value={s.v} active={active} /> : s.v}{s.suf || ''}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--txt-lo)', fontWeight: 600, marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
          <div style={{ gridColumn: '1 / -1', background: 'rgba(0,0,0,.3)', border: '1px solid var(--line-dark)', borderRadius: 13, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--txt-mid)' }}><Icon name="zap" size={13} stroke={2.4} style={{ color: '#27C75F', verticalAlign: -2 }} /> Meta da semana: <b style={{ color: '#fff' }}>+{comp.weeklyGoal} vendas</b></span>
              <span className="tnum" style={{ fontSize: 12.5, color: 'var(--txt-lo)', fontWeight: 700 }}>{comp.weeklyDone}/{comp.weeklyGoal}</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div style={{ width: goalPct + '%', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#1DB954,#27C75F)', boxShadow: '0 0 12px rgba(39,199,95,.6)', animation: 'barFill 1.1s ease-out' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <RaceMsg icon="flag" c="#D4AF37" title="Sua meta agora">Faltam <b style={{ color: '#E8CE72' }}>{comp.top3Gap} vendas</b> para entrar no TOP 3</RaceMsg>
          <RaceMsg icon="target" c="#E23744" title="Rival direto">Ultrapasse <b>{comp.rivalAhead?.first ?? '—'}</b> — está só {comp.aheadGap} vendas à frente</RaceMsg>
          <RaceMsg icon="flame" c="#FF8A00" title="Atenção">{comp.chaser?.first ?? '—'} empatou com você e vem subindo rápido</RaceMsg>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, tone, children, right }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      {icon && <Icon name={icon} size={18} stroke={2.2} style={{ color: tone || '#D4AF37' }} />}
      <span className="display" style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '.01em' }}>{children}</span>
      {right}
    </div>
  );
}

function UrgentAttention({ go }: { go: (id: string) => void }) {
  // Real counts via services (RBAC-filtered for sellers automatically) —
  // no fixed name or fixed count (M0-K3). Sub-labels stay generic since the
  // specific record isn't singled out.
  const items = [
    { n: LeadService.getAll().filter((l: any) => l.urgency === 'red').length, label: 'leads atrasados', sub: 'Sem contato recente', icon: 'flame', to: 'clientes' },
    { n: VisitService.getAll().filter((v: any) => v.status === VISIT_STATUS.PENDING).length, label: 'visitas não confirmadas', sub: 'Confirme antes do horário', icon: 'calendar', to: 'visitas' },
    { n: DealService.getAll().filter((d: any) => d.status === DEAL_STATUS.APPROVAL).length, label: 'propostas aguardando aprovação', sub: 'Desconto acima do limite', icon: 'handshake', to: 'propostas' },
    { n: TaskService.getAll().filter((t: any) => t.state === TASK_STATE.LATE).length, label: 'pendências atrasadas', sub: 'Resolva o quanto antes', icon: 'check', to: 'pendencias' },
  ];
  return (
    <div>
      <SectionTitle icon="alert" tone="#FF3B3B">Atenção imediata</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {items.map((it, i) => (
          <button key={i} onClick={() => go(it.to)} style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: 'linear-gradient(160deg,#2a0d0e,#180809)', border: '1px solid rgba(255,46,46,.45)', borderRadius: 16, padding: 18, position: 'relative', overflow: 'hidden', animation: `redScream 2.8s ease-in-out infinite`, animationDelay: (i * .35) + 's' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: '#FF3B3B' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Icon name={it.icon} size={18} stroke={2.2} style={{ color: '#FF6B6B' }} />
              <span style={{ fontSize: 11, color: '#FF8A8A', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>Urgente</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="display tnum" style={{ fontSize: 40, fontWeight: 900, color: '#fff', lineHeight: .9 }}>{it.n}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{it.label}</span>
            </div>
            <div style={{ fontSize: 12, color: '#E5A6A6', marginTop: 8 }}>{it.sub}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 13, fontSize: 12.5, fontWeight: 700, color: '#FF6B6B' }}>
              Resolver agora <Icon name="arrowRight" size={14} stroke={2.5} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickActions({ go }: { go: (id: string) => void }) {
  const actions = [
    { label: 'Novo cliente', icon: 'plus', tone: 'gold', to: 'clientes' },
    { label: 'Agendar visita', icon: 'calendar', to: 'visitas' },
    { label: 'Registrar venda', icon: 'trophy', to: 'vendas' },
    { label: 'Atualizar cliente', icon: 'user', to: 'clientes' },
    { label: 'Ver atrasados', icon: 'flame', tone: 'red', to: 'clientes' },
    { label: 'Criar proposta', icon: 'handshake', to: 'propostas' },
  ];
  return (
    <div>
      <SectionTitle icon="zap">Ações rápidas</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 14 }}>
        {actions.map((a, i) => {
          const gold = a.tone === 'gold'; const red = a.tone === 'red';
          return (
            <button key={i} onClick={() => go(a.to)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '24px 12px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', transition: 'transform .14s, box-shadow .14s', background: gold ? 'linear-gradient(180deg,#211b09,#161103)' : red ? 'linear-gradient(180deg,#241011,#170a0b)' : 'linear-gradient(180deg,#1a1a1d,#131315)', border: `1px solid ${gold ? 'rgba(212,175,55,.4)' : red ? 'rgba(255,46,46,.38)' : 'var(--line-dark)'}`, boxShadow: 'var(--shadow-sm)' }}
              onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 16px 32px -16px ${gold ? 'rgba(212,175,55,.5)' : red ? 'rgba(255,46,46,.5)' : 'rgba(0,0,0,.8)'}`; }}
              onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, display: 'grid', placeItems: 'center', background: gold ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : red ? 'linear-gradient(180deg,#FF4242,#D81F2C)' : 'rgba(255,255,255,.06)', color: gold ? '#2a2104' : '#fff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.2)' }}>
                <Icon name={a.icon} size={25} stroke={2.2} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', textAlign: 'center' }}>{a.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConversionFunnel({ active }: { active: boolean }) {
  // Real totals via services — these are independent counts (how many of each
  // exist right now), not a true step-by-step conversion rate: there's no
  // event history to say how many leads actually became each visit/proposta/
  // venda. So no "X% da etapa anterior" here — that would be exactly the
  // fake percentage the audit flagged (M0-K3).
  const stages = [
    { label: 'Leads', sub: 'clientes cadastrados', v: LeadService.getAll().length, icon: 'users', c: '#5B9BFF' },
    { label: 'Visitas', sub: 'agendadas no total', v: VisitService.getAll().length, icon: 'calendar', c: '#A855F7' },
    { label: 'Propostas', sub: 'criadas no total', v: DealService.getAll().length, icon: 'handshake', c: '#27C75F' },
    { label: 'Vendas', sub: 'registradas no total', v: SaleService.getAll().length, icon: 'trophy', c: '#E8CE72', gold: true },
  ];
  const top = Math.max(stages[0].v, stages[1].v, stages[2].v, stages[3].v, 1);
  return (
    <div>
      <SectionTitle icon="flow">Funil de conversão</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, alignItems: 'stretch', background: 'linear-gradient(180deg,#161618,#111113)', border: '1px solid var(--line-dark)', borderRadius: 18, padding: '8px', boxShadow: 'var(--shadow-md)', position: 'relative' }}>
        {stages.map((s: any, i: number) => {
          const pct = Math.round((s.v / top) * 100);
          return (
            <div key={s.label} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <div className="lift" style={{ flex: 1, height: '100%', borderRadius: 14, padding: '20px 18px', background: s.gold ? 'linear-gradient(180deg, rgba(212,175,55,.12), rgba(0,0,0,.12)), #161618' : 'rgba(255,255,255,.02)', border: `1px solid ${s.gold ? 'rgba(212,175,55,.4)' : 'var(--line-dark)'}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 38, height: 38, borderRadius: 11, background: `${s.c}22`, color: s.c, display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06)' }}><Icon name={s.icon} size={19} stroke={2.2} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{s.sub}</div>
                  </div>
                </div>
                <div className="display tnum" style={{ fontSize: 44, fontWeight: 900, color: s.gold ? '#E8CE72' : '#fff', lineHeight: 1, letterSpacing: '-.02em' }}>
                  {active ? <CountUp value={s.v} active={active} /> : s.v}
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${s.c}, color-mix(in srgb, ${s.c} 65%, #000))`, boxShadow: `0 0 10px ${s.c}66`, animation: 'barFill 1.1s ease-out' }} />
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--txt-lo)' }}>total no sistema</div>
              </div>
              {i < stages.length - 1 && <div style={{ position: 'absolute', right: -2, top: '50%', transform: 'translate(50%,-50%)', zIndex: 2, width: 26, height: 26, borderRadius: '50%', background: '#1b1b1e', border: '1px solid var(--line-dark-2)', display: 'grid', placeItems: 'center', color: 'var(--txt-lo)' }}><Icon name="arrowRight" size={14} stroke={2.4} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Home({ t, setTweak, go, active }: any) {
  const [period, setPeriod] = useState('30 dias');
  const [team, setTeam] = useState('Todos');
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 1240);

  useEffect(() => {
    const onR = () => setNarrow(window.innerWidth < 1240);
    onR(); window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  useStore(); // subscribes to store changes for re-render — sellers read via SellerService below (Correção 9)
  const variant = t.podium;
  const allSellers = SellerService.getAll();
  const sellers = team === 'Todos' ? allSellers : allSellers.filter((s: any) => s.team === team);
  const top3 = sellers.slice(0, 3);
  const comp = getCompetition(allSellers);

  const podiumStage = (
    <div style={{ position: 'relative', background: 'radial-gradient(120% 80% at 50% 6%, #1d1d21 0%, #131315 48%, #0b0b0c 100%)', border: '1px solid var(--line-dark)', borderRadius: 22, padding: '0 16px 14px', height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
      <div className="ambient" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 50% 0%, rgba(212,175,55,.14), transparent 70%), radial-gradient(40% 40% at 12% 92%, rgba(193,18,31,.07), transparent 70%)', pointerEvents: 'none' }} />
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .25, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', textAlign: 'center', padding: '20px 0 6px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          <Icon name="medal" size={17} stroke={2} style={{ color: '#D4AF37' }} />
          <span className="display" style={{ fontSize: 13, fontWeight: 800, color: '#E8CE72', letterSpacing: '.22em' }}>PÓDIO DE CAMPEÕES</span>
          <Icon name="medal" size={17} stroke={2} style={{ color: '#D4AF37' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 7 }}>
          <span style={{ height: 1, width: 60, background: 'linear-gradient(90deg, transparent, rgba(212,175,55,.6))' }} />
          <span style={{ fontSize: 12, color: 'var(--txt-mid)', fontWeight: 600 }}>{period} · {team}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--txt-lo)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#27C75F', animation: 'livePulse 2s infinite' }} /> ao vivo
          </span>
          <span style={{ height: 1, width: 60, background: 'linear-gradient(90deg, rgba(212,175,55,.6), transparent)' }} />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
        {variant === 'B'
          ? <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: '8px 2px' }}><div style={{ width: '100%' }}><Podium variant="B" top3={top3} anim={t.anim} active={active} /></div></div>
          : <FitBox naturalWidth={variant === 'A' ? 840 : variant === 'D' ? 900 : 866} align={(variant === 'A' || variant === 'D') ? 'bottom' : 'center'}>
              <Podium variant={variant} top3={top3} anim={t.anim} active={active} />
            </FitBox>}
      </div>
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--ink-900)', position: 'relative' }}>
      <ControlBar period={period} setPeriod={setPeriod} variant={variant} setVariant={(v: string) => setTweak('podium', v)} team={team} setTeam={setTeam} />
      <CompTicker comp={comp} />

      <div style={{ padding: '22px 26px 44px', position: 'relative' }}>
        {narrow ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 26 }}>
            <div style={{ height: variant === 'A' ? 620 : variant === 'B' ? 540 : variant === 'D' ? 700 : 560 }}>{podiumStage}</div>
            <div style={{ height: 520 }}><RankingList sellers={sellers} active={active} comp={comp} /></div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.9fr) minmax(360px, .92fr)', gap: 20, alignItems: 'stretch', height: 'calc(100vh - 168px)', minHeight: 600, marginBottom: 26 }}>
            {podiumStage}
            <RankingList sellers={sellers} active={active} comp={comp} />
          </div>
        )}

        <div style={{ marginBottom: 26 }}><ConversionFunnel active={active} /></div>
        <div style={{ marginBottom: 26 }}><MinhaDisputa active={active} comp={comp} /></div>
        <div style={{ marginBottom: 26 }}><UrgentAttention go={go} /></div>
        <QuickActions go={go} />
      </div>
    </div>
  );
}
