'use client';
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBtn, LBadge, Chip, Guide, LightScreen, PageHead, LCard, Stat } from '@/components/ui/kit';
import { STAGES, VISIT_STATUS, DEAL_STATUS, SALE_STATUS } from '@/lib/data';
import { useStore } from '@/lib/store';
import { LeadService, VisitService, DealService, SaleService, SellerService } from '@/lib/services';
import { PLACE } from '@/components/podiums/Podiums';

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

function DealRow({ d, go, approval, decided }: any) {
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
        ? <LBtn size="sm" kind="primary" icon="check" onClick={() => (window as any).__openFlow('aprovar-proposta', { deal: d })}>Aprovar</LBtn>
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
  const open = deals.filter((d: any) => d.status === DEAL_STATUS.OPEN);
  const appr = deals.filter((d: any) => d.status === DEAL_STATUS.APPROVAL);
  const decided = deals.filter((d: any) => d.status === DEAL_STATUS.APPROVED || d.status === DEAL_STATUS.REJECTED);
  return (
    <LightScreen>
      <PageHead title="Propostas" sub="As negociações em aberto e o que precisa de aprovação." actions={<LBtn kind="primary" icon="plus" onClick={() => (window as any).__openFlow('nova-proposta')}>Nova proposta</LBtn>} />
      {appr.length > 0 && <Guide tone="amber" icon="clock" text={<span><b>{appr.length} propostas</b> aguardam aprovação do gestor por desconto acima do limite.</span>} action="Revisar" onAction={() => (window as any).__openFlow('aprovar-proposta', { deal: appr[0] })} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {appr.length > 0 && <div>
          <SubHead icon="clock" tone="var(--amber)">Aguardando aprovação · {appr.length}</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{appr.map((d: any) => <DealRow key={d.id} d={d} go={go} approval />)}</div>
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

export function ScreenVendas({ go }: any) {
  useStore();
  const sales = SaleService.getAll();
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
        {sales.map((s: any, i: number) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderTop: i ? '1px solid var(--border-2)' : 'none' }}>
            <Avatar name={s.client} size={38} ring="#15924B" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--t-900)' }}>{s.client}</div>
              <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 2 }}><Icon name="car" size={12} stroke={2} style={{ verticalAlign: -2 }} /> {s.car} · {s.pay}</div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--t-500)' }}>{s.seller.split(' ')[0]}</div>
            <div className="tnum" style={{ fontSize: 13, color: 'var(--t-400)', fontWeight: 600, width: 100, textAlign: 'right' }}>{s.value}</div>
            <span style={{ fontSize: 12.5, color: 'var(--t-400)', width: 56 }}>{s.date}</span>
            <LBadge tone={s.status === SALE_STATUS.DELIVERED ? 'green' : 'amber'} solid={s.status === SALE_STATUS.DELIVERED}>{s.status === SALE_STATUS.DELIVERED ? 'Entregue' : 'Ag. entrega'}</LBadge>
          </div>
        ))}
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

export function ScreenResultados({ go }: any) {
  useStore();
  const top = SellerService.getAll();
  return (
    <LightScreen>
      <PageHead title="Resultados" sub="Como a equipe está performando — em números simples." actions={<LBtn kind="ghost" icon="file">Exportar</LBtn>} />
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-700)', marginBottom: 6 }}>{label}</label>
      <input defaultValue={value} style={{ width: '100%', padding: '10px 13px', borderRadius: 9, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'var(--surface-2)', outline: 'none' }} />
    </div>
  );
}

export function ScreenAjustes({ go }: any) {
  useStore();
  const sellers = SellerService.getAll();
  const leads = LeadService.getAll();
  const [tab, setTab] = useState('Empresa');
  return (
    <LightScreen>
      <PageHead title="Ajustes" sub="Configure o sistema para a realidade da sua loja." />
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['Empresa', 'Usuários', 'Etapas'].map(t => <Chip key={t} active={tab === t} onClick={() => setTab(t)}>{t}</Chip>)}
      </div>
      {tab === 'Empresa' && (
        <LCard style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Dados da loja</div>
          <Field label="Nome da loja" value="Revenda Premium Veículos" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="CNPJ" value="00.000.000/0001-00" />
            <Field label="Telefone" value="(11) 3000-0000" />
          </div>
          <Field label="Fuso horário" value="América/São Paulo (GMT-3)" />
          <div style={{ marginTop: 8 }}><LBtn kind="primary" icon="check">Salvar alterações</LBtn></div>
        </LCard>
      )}
      {tab === 'Usuários' && (
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
      {tab === 'Etapas' && (
        <LCard style={{ maxWidth: 520 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Etapas do andamento</div>
          <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 16 }}>Arraste para reordenar. A primeira etapa é sempre "Novo".</div>
          {(STAGES as string[]).map((s: string, i: number) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }}>
              <Icon name="list" size={16} stroke={2} style={{ color: 'var(--t-400)' }} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{s}</span>
              <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--t-400)' }}>{leads.filter((l: any) => l.stage === s).length} clientes</span>
            </div>
          ))}
        </LCard>
      )}
    </LightScreen>
  );
}
