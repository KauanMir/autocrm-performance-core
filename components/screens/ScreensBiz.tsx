'use client';
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBtn, LBadge, Chip, Guide, LightScreen, PageHead, LCard, Stat } from '@/components/ui/kit';
import { VISIT_STATUS, DEAL_STATUS, SALE_STATUS, USERS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { LeadService, VisitService, DealService, SaleService, SellerService, PipelineService, CompanyService, AuthService } from '@/lib/services';
import { PLACE } from '@/components/podiums/Podiums';
import { usePipelineStages } from '@/lib/hooks/usePipelineStages';
import { useReorderStages, getReorderStagesErrorMessage } from '@/lib/hooks/useReorderStages';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import { canAccessFullSettings, canAccessStageSettings, canReorderPipelineStages } from '@/lib/capabilities';

// Every value VISIT_STATUS can produce must have an entry here — a status
// missing from this map is what made VisitRow crash (M0-J audit, M0-K1 fix).
const VST: Record<string, { tone: string; label: string; solid?: boolean }> = {
  [VISIT_STATUS.PENDING]:         { tone: 'red',   label: 'Não confirmada' },
  [VISIT_STATUS.SCHEDULED]:       { tone: 'amber', label: 'Agendada' },
  [VISIT_STATUS.CONFIRMED]:       { tone: 'green', label: 'Confirmada' },
  [VISIT_STATUS.RESCHEDULED]:     { tone: 'amber', label: 'Remarcada' },
  [VISIT_STATUS.CANCELED]:        { tone: 'red',   label: 'Cancelada' },
  [VISIT_STATUS.AWAITING_RESULT]: { tone: 'amber', label: 'Registrar resultado' },
  [VISIT_STATUS.DONE]:            { tone: 'green', label: 'Realizada', solid: true },
  [VISIT_STATUS.NO_INTEREST]:     { tone: 'amber', label: 'Sem interesse' },
};
const VST_FALLBACK: { tone: string; label: string; solid?: boolean } = { tone: 'amber', label: 'Status desconhecido' };

function VisitRow({ v, go }: any) {
  const s = VST[v.status] || VST_FALLBACK;
  const pend = v.status === VISIT_STATUS.PENDING; const noRes = v.status === VISIT_STATUS.AWAITING_RESULT;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px', borderRadius: 11,
      background: pend ? 'var(--red-bg)' : noRes ? 'var(--amber-bg)' : 'var(--surface)',
      border: `1px solid ${pend ? 'var(--red-line)' : noRes ? 'var(--amber-line)' : 'var(--border)'}`,
    }}>
      <div className="display tnum" style={{ width: 62, textAlign: 'center', fontSize: 18, fontWeight: 800, color: 'var(--t-900)' }}>{v.time}</div>
      <div style={{ width: 1, height: 34, background: 'var(--border)' }} />
      <Avatar name={v.client} size={38} ring={pend ? 'var(--red)' : '#6B7280'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{v.client}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', display: 'flex', gap: 10, marginTop: 2 }}>
          <span><Icon name="car" size={12} stroke={2} style={{ verticalAlign: -2 }} /> {v.car}</span>
          <span>· {v.seller.split(' ')[0]}</span>
        </div>
      </div>
      <LBadge tone={s.tone} solid={s.solid}>{pend && <Icon name="alert" size={12} stroke={2.4} />}{s.label}</LBadge>
      <LBtn size="sm" kind={pend ? 'danger' : noRes ? 'primary' : 'ghost'} icon={pend ? 'phone' : noRes ? 'edit' : 'arrowRight'}
        onClick={() => {
          if (pend) { (window as any).__openFlow('confirmar-visita', { visit: v }); return; }
          if (noRes) { (window as any).__openFlow('registrar-resultado', { visit: v }); return; }
          const lead = v.leadId
            ? LeadService.getAll().find((l: any) => l.id === v.leadId)
            : LeadService.getAll().find((l: any) => l.name === v.client);
          (window as any).__openFlow('ver-cliente', { lead: lead ?? LeadService.getAll()[0] });
        }}>
        {pend ? 'Confirmar' : noRes ? 'Registrar' : 'Ver'}
      </LBtn>
    </div>
  );
}

export function ScreenVisitas({ go }: any) {
  useStore();
  const visits = VisitService.getAll();
  const KNOWN_DAYS = ['hoje', 'amanha', 'passado'];
  const groups = [
    { name: 'Hoje — 14 de junho', items: visits.filter((v: any) => v.day === 'hoje') },
    { name: 'Amanhã — 15 de junho', items: visits.filter((v: any) => v.day === 'amanha') },
    // Catches visits scheduled for any other day (custom dates, "Qui 18", etc.) so they
    // never silently disappear from this screen just for not matching hoje/amanha/passado.
    { name: 'Próximos dias', items: visits.filter((v: any) => !KNOWN_DAYS.includes(v.day)) },
    { name: 'Pendentes de resultado', items: visits.filter((v: any) => v.day === 'passado'), warn: true },
  ];
  const unconfirmed = visits.filter((v: any) => v.status === VISIT_STATUS.PENDING).length;
  return (
    <LightScreen>
      <PageHead title="Visitas" sub="A agenda do dia e o que precisa ser confirmado." actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('criar-visita')}>Agendar visita</LBtn>} />
      <Guide tone="red" icon="calendar" text={<span>Você tem <b>{unconfirmed} visitas não confirmadas</b> para hoje. Ligue para confirmar antes do horário — visita confirmada vende mais.</span>} action="Confirmar agora" onAction={() => { const v = visits.find((x: any) => x.status === VISIT_STATUS.PENDING); (window as any).__openFlow('confirmar-visita', { visit: v }); }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {groups.map((g: any) => (
          <div key={g.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              {g.warn && <Icon name="alert" size={16} stroke={2.4} style={{ color: 'var(--amber)' }} />}
              <span style={{ fontSize: 14, fontWeight: 700, color: g.warn ? 'var(--amber)' : 'var(--t-900)' }}>{g.name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--t-400)' }}>{g.items.length} {g.items.length === 1 ? 'visita' : 'visitas'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {g.items.map((v: any) => <VisitRow key={v.id} v={v} go={go} />)}
            </div>
          </div>
        ))}
      </div>
    </LightScreen>
  );
}

function SubHead({ icon, tone, children }: any) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
    <Icon name={icon} size={16} stroke={2.2} style={{ color: tone || 'var(--t-500)' }} />
    <span style={{ fontSize: 14, fontWeight: 700, color: tone || 'var(--t-900)' }}>{children}</span>
  </div>;
}

function DealRow({ d, go, approval, decided, canDecide }: any) {
  const decidedApproved = decided && d.status === DEAL_STATUS.APPROVED;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '15px 18px', borderRadius: 11,
      background: approval ? 'var(--amber-bg)' : 'var(--surface)', border: `1px solid ${approval ? 'var(--amber-line)' : 'var(--border)'}`,
    }}>
      <Avatar name={d.client} size={40} ring="#6B7280" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{d.client}</div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="car" size={13} stroke={2} /> {d.car} · {d.seller.split(' ')[0]}
        </div>
        {approval && <div style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 700, marginTop: 5 }}>{d.disc}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600 }}>{d.value}</div>
        <div style={{ fontSize: 11, color: 'var(--t-400)' }}>atualizada {d.last}</div>
      </div>
      {decided && <LBadge tone={decidedApproved ? 'green' : 'red'} solid>{decidedApproved ? 'Aprovada' : 'Recusada'}</LBadge>}
      {approval
        // Seller cannot approve/reject — not even their own proposal (Correção 1,
        // M0-K4.1). Only a badge here; the real gate lives in FlowAprovarProposta
        // and DealService.approve/reject, so this is UI-only convenience.
        ? (canDecide
            ? <LBtn size="sm" kind="primary" icon="check" onClick={() => (window as any).__openFlow('aprovar-proposta', { deal: d })}>Aprovar</LBtn>
            : <LBadge tone="amber"><Icon name="clock" size={12} stroke={2.4} />Aguardando gestor</LBadge>)
        : <LBtn size="sm" kind="ghost" icon="arrowRight" onClick={() => {
            const lead = d.leadId
              ? LeadService.getAll().find((l: any) => l.id === d.leadId)
              : LeadService.getAll().find((l: any) => l.name === d.client);
            (window as any).__openFlow('ver-cliente', { lead: lead ?? LeadService.getAll()[0] });
          }}>Ver</LBtn>}
    </div>
  );
}

export function ScreenPropostas({ go }: any) {
  useStore();
  const deals = DealService.getAll();
  const canDecide = AuthService.isManager();
  const open = deals.filter((d: any) => d.status === DEAL_STATUS.OPEN);
  const appr = deals.filter((d: any) => d.status === DEAL_STATUS.APPROVAL);
  const decided = deals.filter((d: any) => d.status === DEAL_STATUS.APPROVED || d.status === DEAL_STATUS.REJECTED);
  return (
    <LightScreen>
      <PageHead title="Propostas" sub="As negociações em aberto e o que precisa de aprovação." actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('nova-proposta')}>Nova proposta</LBtn>} />
      {appr.length > 0 && <Guide tone="amber" icon="clock" text={<span><b>{appr.length} propostas</b> aguardam aprovação do gestor por desconto acima do limite.</span>} action={canDecide ? 'Revisar' : undefined} onAction={canDecide ? () => (window as any).__openFlow('aprovar-proposta', { deal: appr[0] }) : undefined} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {appr.length > 0 && <div>
          <SubHead icon="clock" tone="var(--amber)">Aguardando aprovação · {appr.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{appr.map((d: any) => <DealRow key={d.id} d={d} go={go} approval canDecide={canDecide} />)}</div>
        </div>}
        <div>
          <SubHead icon="handshake">Em aberto · {open.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{open.map((d: any) => <DealRow key={d.id} d={d} go={go} />)}</div>
        </div>
        {decided.length > 0 && <div>
          <SubHead icon="history">Decididas · {decided.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{decided.map((d: any) => <DealRow key={d.id} d={d} go={go} decided />)}</div>
        </div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 11, background: 'var(--green-bg)', border: '1px solid var(--green-line)' }}>
          <Icon name="trophy" size={20} stroke={2} style={{ color: 'var(--green)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>8 propostas fechadas este mês</span>
          <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>— continue assim para subir no ranking.</span>
        </div>
      </div>
    </LightScreen>
  );
}

// Every value SALE_STATUS can produce must have an entry here (same discipline
// as VST for Visits) — CANCELED added in M0-K4.2.
const SST: Record<string, { tone: string; label: string }> = {
  [SALE_STATUS.PENDING]:   { tone: 'amber', label: 'Ag. entrega' },
  [SALE_STATUS.DELIVERED]: { tone: 'green', label: 'Entregue' },
  [SALE_STATUS.CANCELED]:  { tone: 'red',   label: 'Cancelada' },
};

export function ScreenVendas({ go }: any) {
  useStore();
  const sales = SaleService.getAll();
  const canCancel = AuthService.isManager();
  const delivered = sales.filter((s: any) => s.status === SALE_STATUS.DELIVERED).length;
  const pending = sales.filter((s: any) => s.status === SALE_STATUS.PENDING).length;
  return (
    <LightScreen>
      <PageHead title="Vendas" sub="O que importa primeiro: quantas vendas você fechou." actions={<LBtn kind="gold" icon="plus" size="lg" onClick={() => (window as any).__openFlow('registrar-venda')}>Registrar venda</LBtn>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 22 }}>
        <Stat label="Vendas no mês" value={sales.length} icon="trophy" tone="gold" active sub="meta: 30" />
        <Stat label="Entregas pendentes" value={pending} icon="car" tone="amber" active sub="agendar entrega" />
        <Stat label="Entregues" value={delivered} icon="check" tone="green" active />
        <Stat label="Receita do mês" value="R$ 1,38M" icon="bars" tone="ink" sub="indicador secundário" />
      </div>
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>Vendas recentes</span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--t-400)' }}>Junho 2026</span>
        </div>
        {sales.map((s: any, i: number) => {
          const badge = SST[s.status] || SST[SALE_STATUS.PENDING];
          const canceled = s.status === SALE_STATUS.CANCELED;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderTop: i ? '1px solid var(--border-2)' : 'none', opacity: canceled ? .6 : 1 }}>
              <Avatar name={s.client} size={38} ring={canceled ? '#6B7280' : '#15924B'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{s.client}</div>
                <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}><Icon name="car" size={12} stroke={2} style={{ verticalAlign: -2 }} /> {s.car} · {s.pay}</div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--t-500)' }}>{s.seller.split(' ')[0]}</div>
              <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600, width: 100, textAlign: 'right' }}>{s.value}</div>
              <span style={{ fontSize: 12.5, color: 'var(--t-400)', width: 56 }}>{s.date}</span>
              <LBadge tone={badge.tone} solid={s.status !== SALE_STATUS.PENDING}>{badge.label}</LBadge>
              {!canceled && canCancel && (
                <LBtn size="sm" kind="ghost" icon="xCircle" onClick={() => (window as any).__openFlow('confirmar', {
                  title: 'Cancelar esta venda?',
                  message: `A venda de ${s.car} para ${s.client} será desfeita: o ranking do vendedor e a proposta/lead relacionados voltam ao estado anterior.`,
                  confirmLabel: 'Cancelar venda',
                  tone: 'danger',
                  icon: 'xCircle',
                  onConfirm: () => SaleService.cancel(s.id),
                })}>Cancelar</LBtn>
              )}
            </div>
          );
        })}
      </LCard>
    </LightScreen>
  );
}

function Bar({ label, pct, value, tone }: { label: string; pct: number; value: string; tone?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
        <span style={{ color: 'var(--t-700)', fontWeight: 600 }}>{label}</span>
        <span className="tnum" style={{ color: 'var(--t-500)', fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 9, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', borderRadius: 999, background: tone || 'var(--t-900)' }} />
      </div>
    </div>
  );
}

// Client-side CSV, no dependency — one file, sections separated by a blank
// line (a real multi-sheet export would need a library, out of scope here).
//
// Role scoping happens at the *Service.getAll() layer (same RBAC every
// screen already relies on) — a seller calling this only ever sees their own
// leads/visits/deals/sales. SellerService.getAll() is the one exception
// (unfiltered by design, since Home's podium needs the whole team), so it's
// narrowed by hand here to just the seller's own row (M0-K3.1, correção 6).
function exportResultadosCSV() {
  const user = AuthService.getCurrentUser();
  const isSeller = user?.role === 'seller';
  const esc = (v: any) => {
    const s = v === null || v === undefined || v === '' ? '-' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const row = (cells: any[]) => cells.map(esc).join(',');
  const rows: string[] = [];

  const fmtDate = (x: any): string => {
    if (x?.createdAt) {
      const d = new Date(x.createdAt);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
    }
    return x?.date || x?.day || x?.last || '-';
  };
  const userName = (id: string | null | undefined): string => {
    if (!id) return '-';
    return USERS.find((u) => u.id === id)?.name || '-';
  };
  const phoneForLead = (leadId: string | null): string => {
    if (!leadId) return '-';
    return LeadService.getById(leadId)?.phone || '-';
  };

  const allSellers = SellerService.getAll();
  const sellers = isSeller ? allSellers.filter((s: any) => s.id === user?.sellerId) : allSellers;
  rows.push('Vendedores');
  rows.push(row(['Nome', 'Vendas', 'Receita', 'Leads', 'Visitas', 'Conversão']));
  sellers.forEach((s: any) => rows.push(row([s.name, s.sales, s.revenue, s.leads, s.visits, s.conv + '%'])));
  rows.push('');

  const leads = LeadService.getAll();
  rows.push('Leads');
  rows.push(row(['Nome', 'Telefone', 'Veículo de interesse', 'Vendedor responsável', 'Criado por', 'Data de cadastro']));
  leads.forEach((l: any) => rows.push(row([
    l.name, l.phone, l.car, l.seller, userName(l.createdByUserId), fmtDate(l),
  ])));
  rows.push('');

  const sales = SaleService.getAll();
  rows.push('Vendas');
  rows.push(row(['Cliente', 'Telefone', 'Veículo', 'Valor', 'Vendedor responsável', 'Registrado por', 'Status', 'Data']));
  sales.forEach((s: any) => rows.push(row([
    s.client, phoneForLead(s.leadId), s.car, s.value, s.seller, userName(s.createdByUserId), s.status, fmtDate(s),
  ])));
  rows.push('');

  const deals = DealService.getAll();
  rows.push('Propostas');
  rows.push(row(['Cliente', 'Telefone', 'Veículo', 'Valor', 'Vendedor responsável', 'Status', 'Data']));
  deals.forEach((d: any) => rows.push(row([
    d.client, phoneForLead(d.leadId), d.car, d.value, d.seller, d.status, fmtDate(d),
  ])));
  rows.push('');

  const visits = VisitService.getAll();
  rows.push('Visitas');
  rows.push(row(['Cliente', 'Telefone', 'Veículo', 'Vendedor responsável', 'Dia/Data', 'Horário', 'Status']));
  visits.forEach((v: any) => rows.push(row([
    v.client, phoneForLead(v.leadId), v.car, v.seller, fmtDate(v), v.time, v.status,
  ])));

  const BOM = '\uFEFF'; // explicit escape — Excel needs this to read acentos corretamente
  const csv = BOM + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resultados-autocrm-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ScreenResultados({ go }: any) {
  useStore();
  const top = SellerService.getAll();
  return (
    <LightScreen>
      <PageHead title="Resultados" sub="Como a equipe está performando — em números simples." actions={<LBtn kind="ghost" icon="file" onClick={exportResultadosCSV}>Exportar</LBtn>} />
      <LCard pad={0} style={{ overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14, color: 'var(--t-900)' }}>Desempenho por vendedor — Junho</div>
        <div style={{ display: 'grid', gridTemplateColumns: '32px 1.6fr repeat(4, .8fr)', padding: '10px 18px', borderBottom: '1px solid var(--border)', fontSize: 11.5, color: 'var(--t-400)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          <span>#</span><span>Vendedor</span><span style={{ textAlign: 'right' }}>Leads</span><span style={{ textAlign: 'right' }}>Visitas</span><span style={{ textAlign: 'right' }}>Conv.</span><span style={{ textAlign: 'right' }}>Vendas</span>
        </div>
        {top.map((s: any, i: number) => (
          <div key={s.id} onClick={() => (window as any).__openFlow && (window as any).__openFlow('perfil-vendedor', { seller: s, pos: i + 1 })} className="lift" style={{ display: 'grid', gridTemplateColumns: '32px 1.6fr repeat(4, .8fr)', alignItems: 'center', padding: '11px 18px', borderTop: i ? '1px solid var(--border-2)' : 'none', background: i === 0 ? 'linear-gradient(90deg, rgba(212,175,55,.12), transparent)' : 'transparent', cursor: 'pointer', borderRadius: 8 }}>
            <span className="display tnum" style={{ fontWeight: 800, color: i < 3 ? (PLACE as any[])[i].ring : 'var(--t-400)' }}>{i + 1}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Avatar name={s.name} size={28} ring={i < 3 ? (PLACE as any[])[i].ring : '#3a3a40'} gold={i === 0} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</span></div>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.leads}</span>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.visits}</span>
            <span className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{s.conv}%</span>
            <span className="display tnum" style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, color: i === 0 ? 'var(--gold-ink)' : 'var(--t-900)' }}>{s.sales}</span>
          </div>
        ))}
      </LCard>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <LCard>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Conversão por etapa</div>
          <Bar label="Lead → Qualificado" pct={67} value="67%" tone="var(--green)" />
          <Bar label="Qualificado → Visita" pct={49} value="49%" tone="var(--green)" />
          <Bar label="Visita → Proposta" pct={58} value="58%" tone="var(--amber)" />
          <Bar label="Proposta → Venda" pct={34} value="34%" tone="var(--gold-ink)" />
        </LCard>
        <LCard>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Motivos de perda</div>
          <Bar label="Preço" pct={40} value="40%" tone="var(--red)" />
          <Bar label="Produto" pct={25} value="25%" tone="var(--t-700)" />
          <Bar label="Concorrente" pct={20} value="20%" tone="var(--t-700)" />
          <Bar label="Prazo" pct={10} value="10%" tone="var(--t-400)" />
        </LCard>
      </div>
    </LightScreen>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-700)', marginBottom: 6 }}>{label}</label>
      <input value={value} onChange={(e: any) => onChange(e.target.value)} style={{ width: '100%', padding: '10px 13px', borderRadius: 9, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'var(--surface-2)', outline: 'none' }} />
    </div>
  );
}

export function ScreenAjustes({ go }: any) {
  useStore();
  const sellers = SellerService.getAll();
  const leads = LeadService.getAll();
  const currentUser = AuthService.getCurrentUser();
  const [tab, setTab] = useState('Empresa');
  const [companyForm, setCompanyForm] = useState(() => CompanyService.get());
  const [saved, setSaved] = useState(false);
  const setField = (k: keyof typeof companyForm, v: string) => { setCompanyForm((f: any) => ({ ...f, [k]: v })); setSaved(false); };

  // Same drag-and-drop pattern as the Pipeline Kanban (M0-K1): lifted React
  // state as the source of truth for what's being dragged, dataTransfer only
  // used to satisfy Firefox's requirement to start a drag at all. No caminho
  // LOCAL o token do drag é o NAME (como sempre); no REMOTO é o stage.id.
  const [draggedStage, setDraggedStage] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  // M1-D (commit 7+8): etapas podem vir do Supabase sob a flag, e o reorder
  // remoto vai pela RPC. Permissões agora vêm de capabilities explícitas
  // (lib/capabilities) combinadas com a flag AQUI, na camada de UI.
  // Boolean(currentUser) significa "profile ativo resolvido" (AuthService
  // rejeita inativos).
  const pipeline = usePipelineStages({
    userId: currentUser?.id ?? null,
    companyId: currentUser?.companyId ?? null,
    userIsActive: Boolean(currentUser),
    localStageNames: PipelineService.getStages(),
  });

  // Acesso efetivo: admin sempre tem os Ajustes completos; manager só a área
  // de Etapas e SOMENTE com a flag remota ON; seller nada. Flag OFF ⇒
  // stageSettingsAccess=false ⇒ manager não ganha nenhum acesso (legado).
  const fullSettingsAccess = canAccessFullSettings(currentUser);
  const stageSettingsAccess = pipeline.remoteStagesEnabled && canAccessStageSettings(currentUser);
  const allowedTabs: string[] = fullSettingsAccess
    ? ['Empresa', 'Usuários', 'Etapas']
    : stageSettingsAccess ? ['Etapas'] : [];
  // Derivação SÍNCRONA: aba proibida nunca renderiza, nem por um frame, e o
  // estado antigo de aba não atravessa troca de usuário.
  const activeTab: string | null = allowedTabs.includes(tab) ? tab : (allowedTabs[0] ?? null);

  // Permissão efetiva do reorder REMOTO fornecida ao hook: capability +
  // flag/área de Etapas. (remoteReady e isPending são reavaliados no handler.)
  const canReorderRemote = stageSettingsAccess && canReorderPipelineStages(currentUser);
  const reorder = useReorderStages({
    companyId: currentUser?.companyId ?? null,
    canReorder: canReorderRemote,
  });

  const isRemote = pipeline.source === 'remote';
  const remoteReady = isRemote && pipeline.queryEnabled && !pipeline.isLoading
    && !pipeline.isError && !pipeline.configError && !pipeline.isEmpty;
  const stages: readonly PipelineStage[] = pipeline.stages;
  const stageDragKey = (s: PipelineStage) => (isRemote ? s.id : s.name);
  const stageDraggable = (s: PipelineStage, index: number) => {
    if (isRemote) {
      // Remoto: qualquer permutação é válida (a regra "Novo fixado" era só
      // frontend e foi removida deste caminho — a RPC aceita qualquer ordem).
      return remoteReady && canReorderRemote && !reorder.isPending;
    }
    return index !== 0; // legado: "Novo" fixado no caminho local
  };

  const handleDropStage = (target: PipelineStage) => {
    const targetKey = stageDragKey(target);
    if (isRemote) {
      // SEM optimistic update: a ordem visual só muda quando o cache é
      // atualizado com o retorno da RPC (onSuccess do hook). Erro ⇒ ordem
      // anterior permanece na tela. O handler REVALIDA a capability.
      if (draggedStage && draggedStage !== targetKey
        && remoteReady && canReorderRemote && !reorder.isPending) {
        const ids = stages.map((s) => s.id);
        const from = ids.indexOf(draggedStage);
        const to = ids.indexOf(targetKey);
        if (from >= 0 && to >= 0 && from !== to) {
          const nextIds = [...ids];
          nextIds.splice(from, 1);
          nextIds.splice(to, 0, draggedStage);
          reorder.reorderStages(nextIds).catch(() => { /* exposto em reorder.error */ });
        }
      }
    } else {
      // Legado intacto: names + "Novo" fixado + persistência local.
      const names = stages.map((s) => s.name);
      const to = names.indexOf(target.name);
      if (draggedStage && draggedStage !== target.name && to !== 0) {
        const order = [...names];
        order.splice(order.indexOf(draggedStage), 1);
        order.splice(to, 0, draggedStage);
        PipelineService.reorderStages(order);
      }
    }
    setDraggedStage(null);
    setOverStage(null);
  };

  return (
    <LightScreen>
      <PageHead title="Ajustes" sub="Configure o sistema para a realidade da sua loja." />
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {allowedTabs.map(t => <Chip key={t} active={activeTab === t} onClick={() => setTab(t)}>{t}</Chip>)}
      </div>
      {activeTab === null && (
        <LCard style={{ maxWidth: 520 }}>
          <div data-testid="settings-denied" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
            Você não tem acesso às configurações.
          </div>
        </LCard>
      )}
      {activeTab === 'Empresa' && (
        <LCard style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Dados da loja</div>
          <Field label="Nome da loja" value={companyForm.name} onChange={(v: string) => setField('name', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="CNPJ" value={companyForm.cnpj} onChange={(v: string) => setField('cnpj', v)} />
            <Field label="Telefone" value={companyForm.phone} onChange={(v: string) => setField('phone', v)} />
          </div>
          <Field label="Fuso horário" value={companyForm.timezone} onChange={(v: string) => setField('timezone', v)} />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <LBtn kind="primary" icon="check" onClick={() => { CompanyService.update(companyForm); setSaved(true); }}>Salvar alterações</LBtn>
            {saved && <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>Salvo.</span>}
          </div>
        </LCard>
      )}
      {activeTab === 'Usuários' && (
        <LCard pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Equipe</span>
            <LBtn size="sm" kind="primary" icon="plus" style={{ marginLeft: 'auto' }}>Convidar</LBtn>
          </div>
          {sellers.slice(0, 6).map((s: any, i: number) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: i ? '1px solid var(--border-2)' : 'none' }}>
              <Avatar name={s.name} size={34} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div><div style={{ fontSize: 12, color: 'var(--t-500)' }}>{s.first.toLowerCase()}@revenda.com.br</div></div>
              <span style={{ fontSize: 12, color: 'var(--t-500)', background: 'rgba(255,255,255,.06)', padding: '3px 10px', borderRadius: 999, fontWeight: 600 }}>Vendedor</span>
              <LBadge tone="green">Ativo</LBadge>
            </div>
          ))}
        </LCard>
      )}
      {activeTab === 'Etapas' && (
        <LCard style={{ maxWidth: 520 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Etapas do andamento</div>
          <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 16 }}>
            {isRemote
              ? 'Arraste para reordenar as etapas da sua loja.'
              : 'Arraste para reordenar. A primeira etapa é sempre "Novo".'}
          </div>
          {isRemote && !remoteReady ? (
            <div data-testid="stages-remote-state" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
              {!pipeline.queryEnabled ? 'Sessão indisponível. Entre novamente para gerenciar as etapas.'
                : pipeline.isLoading ? 'Carregando etapas…'
                : pipeline.configError ? 'As etapas da loja não correspondem à configuração esperada.'
                : pipeline.isError ? 'Não foi possível carregar as etapas.'
                : 'Nenhuma etapa configurada para sua loja.'}
            </div>
          ) : (
            <>
              {stages.map((s: PipelineStage, i: number) => (
                <div key={s.id} data-testid={`stage-row-${s.code}`}
                  draggable={stageDraggable(s, i)}
                  onDragStart={(e: any) => {
                    if (!stageDraggable(s, i)) return;
                    e.dataTransfer.setData('text/plain', stageDragKey(s));
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedStage(stageDragKey(s));
                  }}
                  onDragEnd={() => { setDraggedStage(null); setOverStage(null); }}
                  onDragOver={(e: any) => { e.preventDefault(); if (draggedStage && overStage !== stageDragKey(s)) setOverStage(stageDragKey(s)); }}
                  onDrop={(e: any) => { e.preventDefault(); handleDropStage(s); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${overStage === stageDragKey(s) ? 'var(--gold-line)' : 'var(--border)'}`, borderRadius: 10, marginBottom: 8, cursor: stageDraggable(s, i) ? 'grab' : 'default', opacity: draggedStage === stageDragKey(s) ? 0.4 : 1, transition: 'opacity .12s, border-color .15s' }}>
                  <Icon name="list" size={16} stroke={2} style={{ color: 'var(--t-400)' }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</span>
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-400)' }}>{leads.filter((l: any) => l.stage === s.name).length} clientes</span>
                </div>
              ))}
              {isRemote && reorder.isPending && (
                <div data-testid="stages-saving" style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 4 }}>Salvando ordem…</div>
              )}
              {isRemote && reorder.isError && !reorder.isPending && (
                <div data-testid="stages-reorder-error" style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 4 }}>
                  {getReorderStagesErrorMessage(reorder.error)}
                </div>
              )}
              {isRemote && reorder.isSuccess && !reorder.isPending && !reorder.isError && (
                <div data-testid="stages-reorder-saved" style={{ fontSize: 12.5, color: 'var(--green)', marginTop: 4 }}>Ordem salva.</div>
              )}
            </>
          )}
        </LCard>
      )}
    </LightScreen>
  );
}
