'use client';
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, URG, LBtn, LBadge, Chip, Guide, LightScreen, PageHead, LCard } from '@/components/ui/kit';
import { STAGES, TASK_STATE } from '@/lib/data';
import { useStore } from '@/lib/store';
import { LeadService, TaskService, PipelineService, AuthService, SellerService } from '@/lib/services';

const STAGE_TONE: Record<string, string> = {
  'Novo': 'green', 'Qualificado': 'green', 'Visita agendada': 'amber',
  'Em negociação': 'amber', 'Fechamento': 'green',
};

function LeadCard({ lead, go }: any) {
  const u = (URG as any)[lead.urgency];
  const red = lead.urgency === 'red';
  const green = lead.urgency === 'green';
  const av = red ? 50 : green ? 36 : 42;
  return (
    <div className="lift" onClick={() => (window as any).__openFlow('ver-cliente', { lead })} style={{
      background: red
        ? 'linear-gradient(180deg, rgba(255,46,46,.18), rgba(255,46,46,.03)), #161618'
        : green ? 'linear-gradient(180deg, #151517, #0f0f11)'
        : 'linear-gradient(180deg, #1a1a1d, #131315)',
      border: `1px solid ${red ? 'var(--red-line)' : 'var(--border)'}`,
      borderLeft: `${red ? 5 : 3}px solid ${u.c}`, borderRadius: 'var(--radius)',
      boxShadow: red ? '0 20px 46px -20px rgba(255,30,30,.42)' : 'var(--shadow-md)',
      animation: red ? 'redScream 2.4s ease-in-out infinite' : 'none',
      padding: red ? 20 : green ? 15 : 18, display: 'flex', flexDirection: 'column', gap: green ? 10 : 13,
      opacity: green ? 0.94 : 1, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar name={lead.name} size={av} ring={u.c} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: red ? 17.5 : green ? 14.5 : 16, color: 'var(--t-900)' }}>{lead.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: green ? 12 : 13, color: 'var(--t-500)', marginTop: 2 }}>
            <Icon name="phone" size={12} stroke={2} /> {lead.phone}
          </div>
        </div>
        <LBadge tone={lead.urgency} solid={red}>{red && <Icon name="flame" size={12} stroke={2.4} />}{u.label}</LBadge>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: green ? 12.5 : 13.5, color: 'var(--t-700)' }}>
        <Icon name="car" size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
        <span style={{ fontWeight: 600 }}>{lead.car}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,255,255,.06)', color: 'var(--t-700)', fontWeight: 600 }}>{lead.stage}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--t-500)' }}>
        <Icon name="users" size={12} stroke={2} /> {lead.seller || '-'}
      </div>

      {green ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <Icon name="check" size={14} stroke={2.4} style={{ color: u.c }} />
          <span style={{ color: 'var(--t-500)', fontWeight: 600 }}>{lead.alert}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t-400)' }}>{lead.last}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: red ? '12px 14px' : '10px 12px', borderRadius: 10, background: red ? 'rgba(255,46,46,.16)' : u.bg, border: `1px solid ${u.line}` }}>
          <Icon name={red ? 'flame' : 'clock'} size={red ? 18 : 16} stroke={2.2} style={{ color: u.c }} />
          <span style={{ fontSize: red ? 14 : 13, fontWeight: 700, color: u.c }}>{lead.alert}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: red ? '#FFB3B3' : 'var(--t-400)' }}>{lead.last}</span>
        </div>
      )}

      {/* Card itself opens Central do Cliente (M0-K3.2, correção 4) — internal
          buttons stop propagation so Ligar/Visita don't also trigger it. */}
      <div style={{ display: 'flex', gap: 8 }} onClick={(e: any) => e.stopPropagation()}>
        <LBtn size="sm" kind={red ? 'danger' : green ? 'ghost' : 'primary'} icon="phone" style={{ flex: 1, justifyContent: 'center' }} onClick={() => (window as any).__openFlow('ligar', { lead })}>{green ? 'Ligar' : 'Ligar agora'}</LBtn>
        {!green && <LBtn size="sm" kind="ghost" icon="calendar" onClick={() => (window as any).__openFlow('criar-visita', { lead })}>Visita</LBtn>}
        <LBtn size="sm" kind="ghost" icon="arrowRight" onClick={() => (window as any).__openFlow('ver-cliente', { lead })} />
      </div>
    </div>
  );
}

export function ScreenClientes({ go }: any) {
  useStore();
  const allLeads = LeadService.getAll(); // already RBAC-scoped: seller sees only their own here
  const currentUser = AuthService.getCurrentUser();
  const isSeller = currentUser?.role === 'seller';
  const sellers = SellerService.getAll();
  const [sellerFilter, setSellerFilter] = useState<string>('Todos');
  const leads = (!isSeller && sellerFilter !== 'Todos')
    ? allLeads.filter((l: any) => l.sellerId === sellerFilter)
    : allLeads;
  const [filter, setFilter] = useState('Todos');
  const delayed = leads.filter((l: any) => l.urgency === 'red').length;
  const filters = ['Todos', 'Atrasados', 'Novo', 'Qualificado', 'Visita agendada', 'Em negociação'];
  const list = leads.filter((l: any) => {
    if (filter === 'Todos') return true;
    if (filter === 'Atrasados') return l.urgency === 'red';
    return l.stage === filter;
  });
  const rank: Record<string, number> = { red: 0, amber: 1, green: 2 };
  const sorted = [...list].sort((a: any, b: any) => rank[a.urgency] - rank[b.urgency]);
  return (
    <LightScreen>
      <PageHead title="Clientes" sub="Cada cliente mostra na cor o que precisa de você. Vermelho = aja agora." actions={<LBtn kind="gold" icon="plus" size="lg" onClick={() => (window as any).__openFlow('novo-cliente')}>Novo cliente</LBtn>} />
      <Guide tone="red" icon="flame" scream text={<span>Você tem <b>{delayed} clientes atrasados</b> sem contato. Comece por eles — são os que mais esfriam.</span>} action="Ver atrasados" onAction={() => setFilter('Atrasados')} />
      {!isSeller && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Chip active={sellerFilter === 'Todos'} onClick={() => setSellerFilter('Todos')}>Todos</Chip>
          {sellers.map((s: any) => <Chip key={s.id} active={sellerFilter === s.id} onClick={() => setSellerFilter(s.id)}>{s.first}</Chip>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {filters.map(f => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f === 'Atrasados' ? `Atrasados (${delayed})` : f}</Chip>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>
        {sorted.map((l: any) => <LeadCard key={l.id} lead={l} go={go} />)}
      </div>
    </LightScreen>
  );
}

function PipeCard({ lead, go, dragging, onDragStart, onDragEnd }: any) {
  const u = (URG as any)[lead.urgency];
  return (
    <div
      draggable
      onDragStart={(e: any) => {
        // dataTransfer.setData is required for Firefox to allow the drag to start at
        // all, but the id is read back from lifted React state on drop, not from
        // dataTransfer.getData — some browsers restrict/lose that payload depending
        // on the drag phase, which was silently swallowing the drop (M0-K1.5, bug 1).
        e.dataTransfer.setData('text/plain', lead.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(lead.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => (window as any).__openFlow('ver-cliente', { lead })} style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${u.c}`,
      borderRadius: 10, padding: 12, cursor: 'grab', boxShadow: 'var(--shadow-sm)', opacity: dragging ? 0.4 : 1,
      transition: 'transform .12s, box-shadow .12s, opacity .12s',
    }}
      onMouseEnter={(e: any) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
      onMouseLeave={(e: any) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>{lead.name}</span>
        {lead.urgency === 'red' && <Icon name="flame" size={15} stroke={2.4} style={{ color: 'var(--red)' }} />}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon name="car" size={13} stroke={2} /> {lead.car}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border-2)' }}>
        <Avatar name={lead.seller} size={20} />
        <span style={{ fontSize: 11.5, color: 'var(--t-500)' }}>{lead.seller.split(' ')[0]}</span>
      </div>
    </div>
  );
}

export function ScreenAndamento({ go }: any) {
  useStore();
  const allLeads = LeadService.getAll(); // seller already RBAC-scoped to their own leads here
  const currentUser = AuthService.getCurrentUser();
  const isSeller = currentUser?.role === 'seller';
  const sellers = SellerService.getAll();
  // Manager/admin see everyone by default and narrow by seller — a seller
  // never sees this control at all, since LeadService.getAll() already
  // scoped them to their own leads (M0-K3.1: dropped "Só os meus", which was
  // either redundant for sellers or meaningless for manager/admin, who have
  // no sellerId of their own to filter "mine" by).
  const [sellerFilter, setSellerFilter] = useState<string>('Todos');
  const leads = (!isSeller && sellerFilter !== 'Todos')
    ? allLeads.filter((l: any) => l.sellerId === sellerFilter)
    : allLeads;
  const stages = PipelineService.getStages();
  const [overStage, setOverStage] = useState<string | null>(null);
  // Source of truth for "which lead is being dragged" — deliberately not
  // dataTransfer.getData() at drop time, which is what silently dropped
  // moves before they ever reached PipelineService.moveCard (M0-K1.5, bug 1).
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const colTone: Record<string, string> = {
    'Novo': '#8B8B93', 'Qualificado': '#27C75F', 'Visita agendada': '#FFA31F',
    'Em negociação': '#3B82F6', 'Fechamento': '#E8CE72',
  };
  const endDrag = () => { setDraggedId(null); setOverStage(null); };
  return (
    <LightScreen>
      <PageHead title="Em progresso" sub="Onde cada cliente está no caminho até a venda. Arraste de etapa quando avançar." />
      {!isSeller && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Chip active={sellerFilter === 'Todos'} onClick={() => setSellerFilter('Todos')}>Todos</Chip>
          {sellers.map((s: any) => <Chip key={s.id} active={sellerFilter === s.id} onClick={() => setSellerFilter(s.id)}>{s.first}</Chip>)}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stages.length}, minmax(210px, 1fr))`, gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
        {stages.map((stage: string) => {
          const items = leads.filter((l: any) => l.stage === stage);
          const isOver = overStage === stage;
          return (
            <div key={stage}
              onDragOver={(e: any) => { e.preventDefault(); if (draggedId && overStage !== stage) setOverStage(stage); }}
              onDragLeave={() => setOverStage((s: string | null) => (s === stage ? null : s))}
              onDrop={(e: any) => {
                e.preventDefault();
                if (draggedId) PipelineService.moveCard(draggedId, stage);
                endDrag();
              }}
              style={{ background: 'var(--surface-2)', border: `1px solid ${isOver ? 'var(--gold-line)' : 'var(--border)'}`, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 360, transition: 'border-color .15s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 3, background: colTone[stage] }} />
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--t-900)' }}>{stage}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--t-500)', background: 'rgba(255,255,255,.06)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 8px' }}>{items.length}</span>
              </div>
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                {items.length ? items.map((l: any) => (
                  <PipeCard key={l.id} lead={l} go={go} dragging={draggedId === l.id} onDragStart={setDraggedId} onDragEnd={endDrag} />
                ))
                  : <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--t-400)', fontSize: 12.5, textAlign: 'center', padding: 20 }}>Nenhum cliente nesta etapa</div>}
              </div>
            </div>
          );
        })}
      </div>
    </LightScreen>
  );
}

const PRIO: Record<string, { c: string; label: string }> = {
  alta: { c: 'var(--red)', label: 'Alta' },
  media: { c: 'var(--amber)', label: 'Média' },
  baixa: { c: 'var(--t-400)', label: 'Baixa' },
};

function TaskRow({ task, go }: any) {
  // No local "done" state — a task marked TASK_STATE.DONE stops matching any
  // of the 3 active groups in ScreenPendencias and simply stops rendering
  // here, via the real store mutation + F5-safe persistence (M0-K2, was a
  // cosmetic-only useState before that reset on every reload).
  const late = task.state === TASK_STATE.LATE;
  const p = PRIO[task.prio];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
      background: late ? 'var(--red-bg)' : 'var(--surface)',
      border: `1px solid ${late ? 'var(--red-line)' : 'var(--border)'}`,
      borderRadius: 11, transition: 'all .2s',
    }}>
      <button onClick={() => TaskService.update(task.id, { state: TASK_STATE.DONE })} className="focus-ring" title="Concluir pendência" style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0, cursor: 'pointer',
        border: `2px solid ${late ? 'var(--red)' : 'var(--border)'}`,
        background: 'transparent', display: 'grid', placeItems: 'center', color: '#fff',
      }} />
      <div style={{ width: 4, height: 34, borderRadius: 3, background: p.c, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--t-900)' }}>{task.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}>{task.note}</div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: late ? 'var(--red)' : 'var(--t-500)', whiteSpace: 'nowrap' }}>{task.when}</span>
      <button onClick={() => (window as any).__openFlow('reagendar-pendencia', { task })} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--t-500)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        <Icon name="refresh" size={14} stroke={2} /> Reagendar
      </button>
      <button onClick={() => {
        const lead = LeadService.getAll().find((l: any) => l.name === task.lead);
        (window as any).__openFlow('ver-cliente', { lead: lead ?? LeadService.getAll()[0] });
      }} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--t-500)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        <Icon name="user" size={14} stroke={2} /> {task.lead.split(' ')[0]}
      </button>
    </div>
  );
}

export function ScreenPendencias({ go }: any) {
  useStore();
  const tasks = TaskService.getAll();
  const [tab, setTab] = useState('Atrasadas');
  const groups: Record<string, any[]> = {
    'Atrasadas': tasks.filter((t: any) => t.state === TASK_STATE.LATE),
    'Hoje': tasks.filter((t: any) => t.state === TASK_STATE.TODAY),
    'Próximas': tasks.filter((t: any) => t.state === TASK_STATE.UPCOMING),
  };
  const late = groups['Atrasadas'].length;
  const view = tab === 'Todas' ? Object.entries(groups) : [[tab, groups[tab]]];
  return (
    <LightScreen>
      <PageHead title="Pendências" sub="O que você precisa fazer — e o que já passou da hora." actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('nova-pendencia')}>Nova pendência</LBtn>} />
      <Guide tone="red" icon="alert" text={<span>Você tem <b>{late} pendências atrasadas</b>. Resolva primeiro as vermelhas — cada dia parado é uma venda mais distante.</span>} action="Ver atrasadas" onAction={() => setTab('Atrasadas')} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {['Atrasadas', 'Hoje', 'Próximas', 'Todas'].map(t => (
          <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t === 'Atrasadas' ? `Atrasadas (${late})` : t}</Chip>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {(view as [string, any[]][]).map(([name, items]) => (
          <div key={name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              {name === 'Atrasadas' && <Icon name="alert" size={17} stroke={2.4} style={{ color: 'var(--red)' }} />}
              <span style={{ fontSize: 14, fontWeight: 700, color: name === 'Atrasadas' ? 'var(--red)' : 'var(--t-900)' }}>{name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--t-400)' }}>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.length ? items.map((t: any) => <TaskRow key={t.id} task={t} go={go} />)
                : <LCard style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 600 }}>Tudo em dia por aqui. Ótimo trabalho!</LCard>}
            </div>
          </div>
        ))}
      </div>
    </LightScreen>
  );
}
