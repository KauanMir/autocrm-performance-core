'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, URG, LBtn, LBadge, Chip } from '@/components/ui/kit';
import { SellerService, LeadService, DealService, VisitService, SaleService } from '@/lib/services';
import { PLACE } from '@/components/podiums/Podiums';
import {
  findLead,
  FArea, Segmented, ChoiceTile,
  FPanel, FlowShell, FlowSuccess,
} from './FlowsShared';

export function MiniBars({ data, accent = '#E8CE72', h = 60 }: {
  data: { l: string; v: number; hi?: boolean }[]; accent?: string; h?: number;
}) {
  const max = Math.max(...data.map(d => d.v), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: h }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <div style={{ width: '100%', maxWidth: 30, height: `${Math.max(8, (d.v / max) * (h - 22))}px`, borderRadius: '6px 6px 2px 2px', background: d.hi ? `linear-gradient(180deg,${accent},color-mix(in srgb,${accent} 65%,#000))` : 'rgba(255,255,255,.1)', boxShadow: d.hi ? `0 6px 16px -8px ${accent}` : 'none', transition: 'height .5s cubic-bezier(.2,.7,.2,1)' }} />
          <span style={{ fontSize: 10.5, color: 'var(--t-400)', fontWeight: 600 }}>{d.l}</span>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ pct, accent = '#E8CE72' }: { pct: number; accent?: string }) {
  return (
    <div style={{ height: 9, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', borderRadius: 999, background: `linear-gradient(90deg,${accent},color-mix(in srgb,${accent} 70%,#000))`, boxShadow: `0 0 12px ${accent}88`, animation: 'barFill 1s ease-out' }} />
    </div>
  );
}

export function FlowPerfilVendedor({ payload, close, openFlow }: any) {
  const seller = payload.seller || SellerService.getAll()[0];
  const idx = SellerService.getAll().findIndex((s: any) => s.id === seller.id);
  const pos = payload.pos || idx + 1;
  const up = seller.move > 0, down = seller.move < 0;
  const kpis = [
    { label: 'Vendas no mês', v: seller.sales, icon: 'trophy', gold: true },
    { label: 'Visitas realizadas', v: seller.visits, icon: 'check' },
    { label: 'Clientes ativos', v: seller.leads, icon: 'users' },
    { label: 'Conversão', v: seller.conv, suf: '%', icon: 'target' },
  ];
  const weekly = [{ l: 'Sem 1', v: 4 }, { l: 'Sem 2', v: 6 }, { l: 'Sem 3', v: 5 }, { l: 'Sem 4', v: seller.sales, hi: true }];
  const monthly = [{ l: 'Fev', v: 18 }, { l: 'Mar', v: 22 }, { l: 'Abr', v: 19 }, { l: 'Mai', v: 26 }, { l: 'Jun', v: seller.sales + 14, hi: true }];
  const goal = 14; const goalPct = Math.min(100, Math.round((seller.sales / goal) * 100));
  const history = [
    { icon: 'trophy', c: '#E8CE72', t: 'Venda registrada', d: 'Golf GTI 2022', when: 'Hoje' },
    { icon: 'check', c: '#27C75F', t: 'Visita realizada', d: 'Honda HR-V 2023', when: 'Ontem' },
    { icon: 'handshake', c: '#3B82F6', t: 'Proposta enviada', d: 'Toyota Corolla 2023', when: 'há 2 dias' },
    { icon: 'phone', c: '#8B8B93', t: 'Contato com cliente', d: 'Jeep Compass 2022', when: 'há 3 dias' },
  ];
  return (
    <FlowShell eyebrow="PERFIL DO VENDEDOR" title={seller.name} icon="user" accent="#E8CE72" onClose={close}
      status={<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 13px', borderRadius: 999, background: up ? 'var(--green-bg)' : down ? 'var(--red-bg)' : 'rgba(255,255,255,.05)', border: `1px solid ${up ? 'var(--green-line)' : down ? 'var(--red-line)' : 'var(--border)'}` }}>
        {up && <Icon name="arrowUp" size={14} stroke={3} style={{ color: 'var(--green)' }} />}
        {down && <Icon name="arrowDown" size={14} stroke={3} style={{ color: 'var(--red)' }} />}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: up ? 'var(--green)' : down ? 'var(--red)' : 'var(--t-500)' }}>{up ? `Subiu ${seller.move} ${seller.move > 1 ? 'posições' : 'posição'}` : down ? `Caiu ${Math.abs(seller.move)} ${Math.abs(seller.move) > 1 ? 'posições' : 'posição'}` : 'Posição estável'}</span>
      </div>}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 26, padding: 28, borderRadius: 20, overflow: 'hidden', background: 'radial-gradient(120% 120% at 0% 0%, #221c08, #161618 46%, #121214)', border: '1px solid rgba(212,175,55,.32)', boxShadow: 'var(--shadow-lg)', marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="ambient" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(50% 60% at 12% 30%, rgba(212,175,55,.16), transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <Avatar name={seller.name} size={110} gold={pos === 1} ring={pos <= 3 ? PLACE[pos - 1].ring : '#3B82F6'} />
          <div style={{ position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)', padding: '4px 14px', borderRadius: 999, background: pos <= 3 ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'rgba(255,255,255,.1)', color: pos <= 3 ? '#241c04' : '#fff', fontFamily: 'Archivo, sans-serif', fontWeight: 900, fontSize: 14, border: '2px solid #161618' }}>{pos}º</div>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <div className="display" style={{ fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: '-.02em' }}>{seller.name}</div>
          <div style={{ fontSize: 14, color: 'var(--txt-mid)', marginTop: 4 }}>Equipe {seller.team} · {pos}º lugar no ranking</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12, background: 'rgba(0,0,0,.3)', border: '1px solid var(--line-dark)' }}>
              <Icon name="trend" size={15} stroke={2.4} style={{ color: seller.growth >= 0 ? '#27C75F' : '#FF6B6B' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{seller.growth >= 0 ? '+' : ''}{seller.growth}%</span>
              <span style={{ fontSize: 12, color: 'var(--txt-lo)' }}>na semana</span>
            </div>
            <LBtn kind="ghost" size="md" icon="trophy">Ver no ranking</LBtn>
          </div>
        </div>
        <div style={{ position: 'relative', textAlign: 'center', padding: '14px 24px', borderRadius: 16, background: 'rgba(0,0,0,.35)', border: '1px solid rgba(212,175,55,.3)' }}>
          <div className="display tnum" style={{ fontSize: 56, fontWeight: 900, color: '#E8CE72', lineHeight: 1, textShadow: '0 6px 24px rgba(212,175,55,.5)' }}>{seller.sales}</div>
          <div style={{ fontSize: 11, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 6 }}>vendas no mês</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {kpis.map(k => (
          <div key={k.label} className="lift" style={{ background: 'linear-gradient(180deg,#1a1a1d,#131315)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12.5, color: 'var(--t-500)', fontWeight: 600 }}>{k.label}</span>
              <span style={{ width: 32, height: 32, borderRadius: 10, background: k.gold ? 'var(--gold-bg)' : 'rgba(255,255,255,.06)', color: k.gold ? '#E8CE72' : 'var(--t-500)', display: 'grid', placeItems: 'center' }}><Icon name={k.icon} size={16} stroke={2.2} /></span>
            </div>
            <div className="display tnum" style={{ fontSize: 34, fontWeight: 800, color: k.gold ? '#E8CE72' : '#fff', lineHeight: 1 }}>{k.v}{(k as any).suf || ''}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <FPanel title="Evolução semanal" icon="trend" accent="#E8CE72"><MiniBars data={weekly} /></FPanel>
          <FPanel title="Evolução mensal" icon="bars" accent="#27C75F"><MiniBars data={monthly} accent="#27C75F" /></FPanel>
          <FPanel title="Meta mensal" icon="target" accent="#E8CE72">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--t-500)' }}>{seller.sales} de {goal} vendas</span>
              <span className="display tnum" style={{ fontSize: 20, fontWeight: 800, color: '#E8CE72' }}>{goalPct}%</span>
            </div>
            <ProgressBar pct={goalPct} />
            <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 10 }}>{goal - seller.sales > 0 ? `Faltam ${goal - seller.sales} vendas para bater a meta do mês.` : 'Meta do mês batida! 🏁'}</div>
          </FPanel>
        </div>
        <FPanel title="Histórico recente" icon="history" accent="#E8CE72">
          <div style={{ position: 'relative' }}>
            {history.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i < history.length - 1 ? 18 : 0, position: 'relative' }}>
                {i < history.length - 1 && <div style={{ position: 'absolute', left: 18, top: 38, bottom: 0, width: 2, background: 'var(--border)' }} />}
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
      </div>
    </FlowShell>
  );
}

export function FlowNotificacoes({ payload, close, openFlow }: any) {
  const groups = [
    { name: 'Urgente', tone: 'red', items: [
      { icon: 'flame', t: <span>Cliente <b>Carlos Andrade</b> está sem resposta há 3 dias</span>, when: 'há 1h', action: () => openFlow('ligar', { lead: findLead('Carlos Andrade') || LeadService.getAll()[0] }), label: 'Ligar' },
      { icon: 'target', t: <span><b>João Ferreira</b> ultrapassou você no ranking</span>, when: 'há 2h', action: () => openFlow('perfil-vendedor', { seller: SellerService.getAll()[2] }), label: 'Ver' },
      { icon: 'calendar', t: <span>Visita de <b>Juliana Prado</b> ainda não confirmada</span>, when: 'há 3h', action: () => openFlow('confirmar-visita', { visit: VisitService.getAll().find((v: any) => v.status === 'pendente') }), label: 'Confirmar' },
    ]},
    { name: 'Hoje', tone: 'amber', items: [
      { icon: 'handshake', t: <span>Nova proposta aguardando sua aprovação</span>, when: '14:20', action: () => openFlow('aprovar-proposta', { deal: DealService.getAll().find((d: any) => d.status === 'aprovacao') }), label: 'Revisar' },
      { icon: 'checkCircle', t: <span><b>Mariana Luz</b> confirmou a visita das 14:00</span>, when: '11:05' },
      { icon: 'trophy', t: <span>Venda do <b>Jeep Compass</b> registrada com sucesso</span>, when: '09:30' },
    ]},
    { name: 'Esta semana', tone: 'green', items: [
      { icon: 'xCircle', t: <span><b>Anderson Melo</b> cancelou a visita</span>, when: 'Seg' },
      { icon: 'users', t: <span><b>Beatriz Lima</b> subiu 3 posições no ranking</span>, when: 'Seg' },
      { icon: 'trend', t: <span>Sua conversão subiu 4% esta semana</span>, when: 'Dom' },
    ]},
  ];
  return (
    <FlowShell eyebrow="CENTRAL DE NOTIFICAÇÕES" title="Notificações" icon="bell" accent="#E8CE72" onClose={close}
      status={<LBtn kind="ghost" size="sm" icon="check">Marcar todas como lidas</LBtn>} wide={820}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {groups.map(g => {
          const u = URG[g.tone];
          return (
            <div key={g.name}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.c, boxShadow: `0 0 8px ${u.c}` }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: g.name === 'Urgente' ? 'var(--red)' : 'var(--t-900)' }}>{g.name}</span>
                <span style={{ fontSize: 12, color: 'var(--t-400)' }}>{g.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.items.map((n: any, i) => (
                  <div key={i} className="lift" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 13, background: g.name === 'Urgente' ? 'linear-gradient(180deg, rgba(255,46,46,.1), rgba(0,0,0,.15)), #161618' : 'linear-gradient(180deg,#1a1a1d,#131315)', border: `1px solid ${g.name === 'Urgente' ? 'var(--red-line)' : 'var(--border)'}` }}>
                    <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: `${u.c}22`, color: u.c, display: 'grid', placeItems: 'center', border: `1px solid ${u.c}44` }}><Icon name={n.icon} size={19} stroke={2.1} /></div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--t-900)', fontWeight: 500 }}>{n.t}</div>
                    <span style={{ fontSize: 11.5, color: 'var(--t-400)', whiteSpace: 'nowrap' }}>{n.when}</span>
                    {n.action && <button onClick={n.action} style={{ background: `linear-gradient(180deg,${u.c},color-mix(in srgb,${u.c} 78%,#000))`, color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 9, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{n.label}</button>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </FlowShell>
  );
}

export function FlowBusca({ payload, close, openFlow }: any) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const match = (s: string) => ql && s.toLowerCase().includes(ql);
  const clientes = LeadService.getAll().filter((l: any) => !ql || match(l.name) || match(l.phone) || match(l.car));
  const vendedores = SellerService.getAll().filter((s: any) => !ql || match(s.name) || match(s.team));
  const propostas = DealService.getAll().filter((d: any) => !ql || match(d.client) || match(d.car));
  const vendas = SaleService.getAll().filter((s: any) => !ql || match(s.client) || match(s.car));
  const visitas = VisitService.getAll().filter((v: any) => !ql || match(v.client) || match(v.car));
  const groups = [
    { name: 'Clientes', icon: 'users', items: clientes.slice(0, 4).map((l: any) => ({ title: l.name, sub: `${l.car} · ${l.phone}`, tone: l.urgency, onClick: () => openFlow('ver-cliente', { lead: l }) })) },
    { name: 'Vendedores', icon: 'trophy', items: vendedores.slice(0, 3).map((s: any) => ({ title: s.name, sub: `Equipe ${s.team} · ${s.sales} vendas`, onClick: () => openFlow('perfil-vendedor', { seller: s }) })) },
    { name: 'Propostas', icon: 'handshake', items: propostas.slice(0, 3).map((d: any) => ({ title: `Proposta · ${d.client}`, sub: `${d.car} · ${d.value}`, onClick: () => openFlow('ver-cliente', { lead: findLead(d.client) || LeadService.getAll()[0] }) })) },
    { name: 'Vendas', icon: 'car', items: vendas.slice(0, 3).map((s: any) => ({ title: s.client, sub: `${s.car} · ${s.date}`, onClick: close })) },
    { name: 'Visitas', icon: 'calendar', items: visitas.slice(0, 3).map((v: any) => ({ title: v.client, sub: `${v.car} · ${v.time}`, onClick: () => openFlow('ver-cliente', { lead: findLead(v.client) || LeadService.getAll()[0] }) })) },
  ].filter(g => g.items.length > 0);
  const empty = ql && groups.length === 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(4,4,5,.72)', backdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '9vh', animation: 'flowFade .22s' }} onClick={close}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ width: 'min(680px, 92vw)', animation: 'flowIn .26s cubic-bezier(.2,.7,.2,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px', borderRadius: 18, background: 'linear-gradient(180deg,#1c1c20,#141416)', border: '1px solid var(--line-dark-2)', boxShadow: 'var(--shadow-lg)' }}>
          <Icon name="search" size={23} stroke={2.2} style={{ color: '#E8CE72' }} />
          <input autoFocus value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Buscar cliente, telefone, veículo, vendedor, proposta…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 18, color: '#fff' }} />
          <kbd style={{ fontSize: 11, color: 'var(--t-400)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontFamily: 'inherit' }}>ESC</kbd>
        </div>

        <div style={{ marginTop: 12, maxHeight: '64vh', overflowY: 'auto', borderRadius: 18, background: 'linear-gradient(180deg,#161618,#101012)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', padding: groups.length || empty ? 10 : 0 }}>
          {!ql && <div style={{ padding: '34px 24px', textAlign: 'center' }}>
            <div style={{ display: 'inline-grid', placeItems: 'center', width: 56, height: 56, borderRadius: 16, background: 'var(--gold-bg)', color: '#E8CE72', marginBottom: 14 }}><Icon name="search" size={28} stroke={2} /></div>
            <div style={{ fontSize: 14.5, color: 'var(--t-500)' }}>Comece a digitar para buscar em todo o sistema</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
              {['Clientes', 'Vendedores', 'Propostas', 'Vendas', 'Visitas'].map(t => <span key={t} style={{ fontSize: 12, color: 'var(--t-500)', padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)' }}>{t}</span>)}
            </div>
          </div>}
          {empty && <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--t-500)' }}>
            <Icon name="search" size={30} stroke={2} style={{ color: 'var(--t-400)' }} />
            <div style={{ marginTop: 12, fontSize: 14.5 }}>Nenhum resultado para "<b style={{ color: 'var(--t-900)' }}>{q}</b>"</div>
          </div>}
          {groups.map(g => (
            <div key={g.name} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 6px' }}>
                <Icon name={g.icon} size={14} stroke={2.2} style={{ color: 'var(--t-400)' }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t-400)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{g.name}</span>
              </div>
              {g.items.map((it: any, i: number) => (
                <button key={i} onClick={it.onClick} className="lift" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '11px 14px', borderRadius: 12, border: '1px solid transparent', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                  onMouseEnter={(e: any) => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
                  onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}>
                  <Avatar name={it.title.replace(/^Proposta · /, '')} size={36} ring={it.tone ? URG[it.tone].c : '#3B82F6'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--t-500)' }}>{it.sub}</div>
                  </div>
                  <Icon name="arrowRight" size={16} stroke={2} style={{ color: 'var(--t-400)' }} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FlowEnviarMensagem({ payload, close }: any) {
  const lead = payload.lead || null;
  const name = lead ? lead.name : (payload.name || 'Cliente');
  const phone = lead ? lead.phone : '(11) 90000-0000';
  const templates = ['Olá! Tudo bem? Aqui é da concessionária 🚗', 'Seu veículo está disponível para test drive!', 'Consigo uma condição especial hoje. Posso te ligar?', 'Confirmando sua visita. Nos vemos em breve!'];
  const [msg, setMsg] = useState(templates[0]);
  const [sent, setSent] = useState(false);
  if (sent) return (
    <FlowShell eyebrow="MENSAGEM" title="Mensagem enviada" icon="message" accent="#27C75F" onClose={close}>
      <FlowSuccess icon="send" title="Mensagem enviada!" sub={`Sua mensagem foi enviada para ${name} via WhatsApp.`} actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="ENVIAR MENSAGEM" title={`Mensagem para ${name.split(' ')[0]}`} icon="message" accent="#27C75F" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="ghost" size="lg" onClick={close}>Cancelar</LBtn><LBtn kind="gold" size="lg" icon="send" onClick={() => setSent(true)} style={{ background: 'linear-gradient(180deg,#2EDC72,#15924B)', color: '#fff', border: '1px solid #2EDC72' }}>Enviar pelo WhatsApp</LBtn></>}>
      <div style={{ maxWidth: 680 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', marginBottom: 16 }}>
          <Avatar name={name} size={44} ring="#27C75F" />
          <div><div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--t-900)' }}>{name}</div><div style={{ fontSize: 12.5, color: 'var(--t-500)' }}><Icon name="phone" size={12} stroke={2} style={{ verticalAlign: -1 }} /> {phone}</div></div>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#27C75F', fontWeight: 700 }}><Icon name="message" size={14} stroke={2.2} /> WhatsApp</span>
        </div>
        <FPanel>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Modelos rápidos</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {templates.map((tp, i) => <button key={i} onClick={() => setMsg(tp)} style={{ padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${msg === tp ? 'rgba(39,199,95,.5)' : 'var(--border)'}`, background: msg === tp ? 'var(--green-bg)' : 'rgba(255,255,255,.03)', color: msg === tp ? 'var(--green)' : 'var(--t-700)', textAlign: 'left', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tp}</button>)}
          </div>
          <FArea label="Mensagem" rows={4} value={msg} onChange={(e: any) => setMsg(e.target.value)} />
        </FPanel>
      </div>
    </FlowShell>
  );
}

export function FlowConfirmar({ payload, close }: any) {
  // cancelLabel (M1-F S4-F3): opcional, default 'Cancelar' preserva todo
  // chamador existente (ex.: logout em App.tsx) — só o diálogo de cancelar
  // convite precisa de 'Voltar' para não colidir com o próprio verbo da
  // ação confirmada ("Cancelar convite").
  // onDismiss (M1-F S4-F3): opcional, chamado quando o usuário desiste
  // (backdrop ou botão de dispensa) SEM confirmar — nunca no caminho de
  // confirmação (que já tem onConfirm próprio). Permite ao chamador
  // devolver o foco ao elemento que abriu o diálogo nos dois desfechos.
  const { title = 'Confirmar ação?', message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tone = 'danger', icon = 'alert', onConfirm, onDismiss } = payload;
  const accent = tone === 'danger' ? '#FF3B3B' : '#E8CE72';
  const dismiss = () => { onDismiss && onDismiss(); close(); };
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  // Foco no diálogo ao abrir (não num botão específico — evita enviesar
  // ação destrutiva x segura) e Escape fecha, mesmo padrão de FlowShell.
  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 75, background: 'rgba(4,4,5,.7)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', padding: 24, animation: 'flowFade .2s' }} onClick={dismiss}>
      <div ref={cardRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onClick={(e: any) => e.stopPropagation()} style={{ width: 'min(440px, 92vw)', background: 'linear-gradient(180deg,#1a1a1d,#131315)', border: '1px solid var(--border)', borderRadius: 20, padding: 30, boxShadow: 'var(--shadow-lg)', textAlign: 'center', animation: 'flowIn .26s cubic-bezier(.2,.7,.2,1)', outline: 'none' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, margin: '0 auto 18px', background: `${accent}22`, border: `1px solid ${accent}55`, color: accent, display: 'grid', placeItems: 'center' }}><Icon name={icon} size={32} stroke={2.2} /></div>
        <h3 id={titleId} className="display" style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#fff' }}>{title}</h3>
        {message && <p style={{ margin: '0 0 24px', color: 'var(--t-500)', fontSize: 14.5, lineHeight: 1.55 }}>{message}</p>}
        <div style={{ display: 'flex', gap: 12 }}>
          <LBtn kind="ghost" size="lg" onClick={dismiss} style={{ flex: 1, justifyContent: 'center' }}>{cancelLabel}</LBtn>
          <LBtn kind={tone === 'danger' ? 'danger' : 'gold'} size="lg" icon={icon} onClick={() => { close(); onConfirm && onConfirm(); }} style={{ flex: 1, justifyContent: 'center' }}>{confirmLabel}</LBtn>
        </div>
      </div>
    </div>
  );
}

export function StateCard({ icon, accent = '#E8CE72', title, sub, btn, btnIcon = 'plus', danger }: {
  icon: string; accent?: string; title: string; sub: string; btn?: string | null; btnIcon?: string; danger?: boolean;
}) {
  return (
    <div style={{ borderRadius: 18, border: `1px solid ${danger ? 'var(--red-line)' : 'var(--border)'}`, background: danger ? 'linear-gradient(180deg, rgba(255,46,46,.06), rgba(0,0,0,.15)), #141416' : 'linear-gradient(180deg,#16161a,#101012)', padding: '40px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minHeight: 280, justifyContent: 'center', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ position: 'relative', width: 92, height: 92, marginBottom: 20, display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `radial-gradient(circle, ${accent}26, transparent 68%)` }} />
        <div style={{ width: 68, height: 68, borderRadius: 20, background: `${accent}1c`, border: `1px solid ${accent}44`, color: accent, display: 'grid', placeItems: 'center' }}><Icon name={icon} size={34} stroke={1.9} /></div>
      </div>
      <div className="display" style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginBottom: 8 }}>{title}</div>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: 'var(--t-500)', maxWidth: 280, lineHeight: 1.5 }}>{sub}</p>
      {btn && <LBtn kind={danger ? 'danger' : 'gold'} size="md" icon={btnIcon}>{btn}</LBtn>}
    </div>
  );
}

export function FlowEstados({ payload, close }: any) {
  const [tab, setTab] = useState('vazios');
  const vazios = [
    { icon: 'users', title: 'Nenhum cliente ainda', sub: 'Você ainda não possui clientes cadastrados. Crie o primeiro e comece a vender.', btn: 'Criar primeiro cliente' },
    { icon: 'calendar', title: 'Nenhuma visita agendada', sub: 'Sua agenda está livre. Agende uma visita e aproxime o cliente da compra.', btn: 'Agendar visita', btnIcon: 'calendar' },
    { icon: 'trophy', title: 'Nenhuma venda este mês', sub: 'Seu mês está começando. A primeira venda te coloca no ranking.', btn: 'Registrar venda', btnIcon: 'trophy' },
    { icon: 'handshake', title: 'Nenhuma proposta ativa', sub: 'Não há propostas em aberto. Monte uma proposta para um cliente quente.', btn: 'Nova proposta', btnIcon: 'plus' },
    { icon: 'checkCircle', title: 'Tudo em dia. Parabéns!', sub: 'Você não tem nenhuma pendência atrasada. Continue no ritmo de campeão.', btn: null, accent: '#27C75F' },
    { icon: 'inbox', title: 'Sem notificações', sub: 'Quando algo importante acontecer, você verá aqui primeiro.', btn: null },
  ];
  const erros = [
    { icon: 'wifiOff', title: 'Não foi possível carregar', sub: 'Não conseguimos carregar seus clientes. Verifique sua conexão e tente novamente.', btn: 'Tentar novamente', btnIcon: 'refresh', danger: true, accent: '#FF3B3B' },
    { icon: 'alert', title: 'Não conseguimos salvar', sub: 'Suas alterações não foram salvas. Tente novamente em alguns instantes.', btn: 'Tentar novamente', btnIcon: 'refresh', danger: true, accent: '#FF3B3B' },
    { icon: 'search', title: 'Página não encontrada', sub: 'Essa página não existe ou foi movida. Vamos te levar de volta ao sistema.', btn: 'Voltar ao início', btnIcon: 'home', accent: '#E8CE72' },
    { icon: 'wifiOff', title: 'Conexão perdida', sub: 'Você está offline. Reconectaremos automaticamente assim que possível.', btn: 'Reconectar', btnIcon: 'refresh', danger: true, accent: '#FF8A00' },
  ];
  const list = tab === 'vazios' ? vazios : erros;
  return (
    <FlowShell eyebrow="BIBLIOTECA DE ESTADOS" title="Estados vazios & de erro" icon="grid" accent="#E8CE72" onClose={close}
      sub="Todos os estados premium do sistema para quando não há dados ou algo falha. Mantêm a identidade visual e sempre indicam a próxima ação.">
      <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
        <Chip active={tab === 'vazios'} onClick={() => setTab('vazios')}>Estados vazios</Chip>
        <Chip active={tab === 'erros'} onClick={() => setTab('erros')}>Estados de erro</Chip>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 18 }}>
        {list.map((s, i) => <StateCard key={i} {...(s as any)} />)}
      </div>
    </FlowShell>
  );
}
