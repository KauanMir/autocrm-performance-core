'use client';
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBtn, LBadge } from '@/components/ui/kit';
import { STAGES, VISIT_STATUS, DEAL_STATUS, SALE_STATUS, TASK_STATE } from '@/lib/data';
import { AuthService, LeadService, VisitService, DealService, SaleService, TaskService, SellerService } from '@/lib/services';
import {
  CARS, ORIGINS, PAYS,
  FField, FArea, Segmented, ChoiceTile, ClientChip, LeadPicker, SellerPicker,
  FPanel, StepRail, SummaryRow, FlowShell, FlowSuccess,
} from './FlowsShared';

const TEMP_MAP: Record<string, 'hot' | 'warm' | 'cold'> = { Quente: 'hot', Morno: 'warm', Frio: 'cold' };
const TEMP_INFO: Record<string, string> = {
  Quente: 'Forte intenção de compra — quer comprar agora ou nos próximos dias, já sabe o modelo e tem orçamento ou financiamento encaminhado.',
  Morno: 'Interessado, mas ainda comparando opções — precisa de acompanhamento, simulação ou mais convencimento.',
  Frio: 'Curioso, sem prazo definido ou decisão clara — precisa ser nutrido com menor urgência.',
};

export function FlowNovoCliente({ payload, close, openFlow }: any) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ nome: '', tel: '', origem: 'Showroom', car: '', pay: 'Financiamento', urg: 'Quente' });
  const set = (k: string, v: any) => setF(s => ({ ...s, [k]: v }));
  const user = AuthService.getCurrentUser();
  const isSeller = user?.role === 'seller';
  const allSellers = SellerService.getAll();
  // A seller's own leads are always theirs; a manager/admin has no sellerId of
  // their own and must pick who the lead actually belongs to — never fall
  // back to the acting manager (same product rule as FlowRegistrarVenda).
  const [assignedSellerId, setAssignedSellerId] = useState<string | null>(isSeller ? (user?.sellerId ?? null) : null);
  const finalSellerId = isSeller ? (user?.sellerId ?? null) : assignedSellerId;
  const finalSeller = finalSellerId ? allSellers.find((s: any) => s.id === finalSellerId) : null;
  const steps = ['Quem é', 'O que procura', 'Revisão'];
  const canNext = step === 0 ? !!(f.nome && f.tel && (isSeller || finalSellerId)) : step === 1 ? f.car : true;

  const [newLeadId] = useState(() => 'l' + Date.now());

  const handleCreate = () => {
    if (!finalSellerId) return;
    LeadService.create({
      id: newLeadId,
      name: f.nome || 'Novo cliente',
      phone: f.tel,
      car: f.car || CARS[0],
      stage: 'Novo',
      // Urgency is operational health, not buying intent — a brand-new lead has had
      // no contact yet, so it always starts red regardless of temperature.
      urgency: 'red',
      temperature: TEMP_MAP[f.urg] || 'warm',
      pay: f.pay,
      value: '—',
      last: 'Sem contato ainda',
      alert: 'Fazer primeiro contato',
      seller: finalSeller?.name || '—',
      sellerId: finalSellerId,
      createdByUserId: user?.id ?? null,
      origem: f.origem,
      timeline: [{ icon: 'plus', c: '#27C75F', t: `Cadastrado via ${f.origem}`, when: 'Agora' }],
    });
    TaskService.create({
      title: `Ligar para ${f.nome}`,
      lead: f.nome,
      state: TASK_STATE.TODAY,
      prio: 'alta',
      when: 'Hoje',
      assignedTo: finalSellerId,
      note: 'Primeiro contato',
    });
    setStep(3);
  };

  if (step === 3) {
    const lead = { id: newLeadId, name: f.nome || 'Novo cliente', phone: f.tel, car: f.car || CARS[0], stage: 'Novo', urgency: 'red', pay: f.pay, value: '—', last: 'Sem contato ainda', alert: 'Fazer primeiro contato', seller: finalSeller?.name || '—', sellerId: finalSellerId };
    return (
      <FlowShell eyebrow="NOVO ATENDIMENTO" title="Cliente criado" icon="users" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Atendimento criado!" sub={`${f.nome} entrou na sua carteira. Que tal já fazer o primeiro contato e sair na frente?`}
          actions={<>
            <LBtn kind="gold" size="lg" icon="phone" onClick={() => openFlow('ligar', { lead })}>Ligar agora</LBtn>
            <LBtn kind="ghost" size="lg" icon="calendar" onClick={() => openFlow('criar-visita', { lead })}>Agendar visita</LBtn>
            <LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn>
          </>} />
      </FlowShell>
    );
  }

  return (
    <FlowShell eyebrow="NOVO ATENDIMENTO" title="Central de novo atendimento" icon="users" accent="#E8CE72" onClose={close}
      sub="Cadastre um novo cliente em poucos toques. Quanto mais rápido o primeiro contato, maior a chance de venda."
      footer={<>
        {step > 0 ? <LBtn kind="ghost" size="lg" onClick={() => setStep(step - 1)}>Voltar</LBtn> : <span />}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--t-500)' }}>Passo {step + 1} de 3</span>
        <LBtn kind="gold" size="lg" icon={step === 2 ? 'check' : 'arrowRight'}
          onClick={() => { if (!canNext) return; if (step === 2) handleCreate(); else setStep(step + 1); }}
          style={{ opacity: canNext ? 1 : .5 }}>
          {step === 2 ? 'Criar atendimento' : 'Continuar'}
        </LBtn>
      </>}>
      <StepRail steps={steps} current={step} />
      <div style={{ maxWidth: 720 }}>
        {step === 0 && <FPanel>
          <FField label="Nome do cliente" icon="user" placeholder="Ex.: Carlos Andrade" value={f.nome} onChange={(e: any) => set('nome', e.target.value)} />
          <FField label="Telefone / WhatsApp" icon="phone" placeholder="(11) 90000-0000" value={f.tel} onChange={(e: any) => set('tel', e.target.value)} />
          {!isSeller && (
            <div style={{ marginBottom: 14 }}>
              <SellerPicker value={finalSeller} onPick={(s: any) => setAssignedSellerId(s.id)} />
            </div>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '6px 0 9px' }}>Como ele chegou até você?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {ORIGINS.map(([o, ic]) => <ChoiceTile key={o} icon={ic} title={o} active={f.origem === o} onClick={() => set('origem', o)} />)}
          </div>
        </FPanel>}
        {step === 1 && <FPanel>
          <FField label="Veículo de interesse" icon="car" placeholder="Ex.: Corolla XEI 2023, Compass Longitude, Hilux SRX…" value={f.car} onChange={(e: any) => set('car', e.target.value)} hint="Digite o modelo e versão que o cliente procura." />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '8px 0 9px' }}>Forma de pagamento</div>
          <div style={{ marginBottom: 18 }}><Segmented options={PAYS.map(p => p[0])} value={f.pay} onChange={v => set('pay', v)} /></div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 2 }}>Temperatura do lead</div>
          <div style={{ fontSize: 11, color: 'var(--t-400)', marginBottom: 9 }}>O quanto o cliente quer comprar — não é a mesma coisa que a cor do card (essa reflete se ele precisa de ação agora).</div>
          <Segmented options={['Quente', 'Morno', 'Frio']} value={f.urg} onChange={v => set('urg', v)} accent="#FF6B3B" />
          <div style={{ fontSize: 12, color: 'var(--t-500)', marginTop: 9, lineHeight: 1.5 }}>{TEMP_INFO[f.urg]}</div>
        </FPanel>}
        {step === 2 && <FPanel title="Confira antes de criar" icon="checkCircle" accent="#27C75F">
          <SummaryRow label="Cliente" value={f.nome || '—'} />
          <SummaryRow label="Telefone" value={f.tel || '—'} />
          {!isSeller && <SummaryRow label="Vendedor responsável" value={finalSeller?.name || '—'} />}
          <SummaryRow label="Origem" value={f.origem} />
          <SummaryRow label="Veículo" value={f.car || '—'} />
          <SummaryRow label="Pagamento" value={f.pay} />
          <SummaryRow label="Temperatura" value={f.urg} accent={f.urg === 'Quente' ? '#FF6B3B' : undefined} />
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--gold-bg)', border: '1px solid var(--gold-line)' }}>
            <Icon name="sparkle" size={18} stroke={2.2} style={{ color: 'var(--gold-ink)' }} />
            <span style={{ fontSize: 13, color: 'var(--t-700)' }}>Vamos criar uma pendência de <b>primeiro contato</b> automaticamente.</span>
          </div>
        </FPanel>}
      </div>
    </FlowShell>
  );
}

export function FlowEditarCliente({ payload, close }: any) {
  const lead = payload.lead || {};
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ nome: lead.name || '', tel: lead.phone || '', car: lead.car || CARS[0], stage: lead.stage || 'Novo', pay: lead.pay || 'Financiamento' });
  const set = (k: string, v: any) => setF(s => ({ ...s, [k]: v }));

  if (done) return (
    <FlowShell eyebrow="EDITAR CLIENTE" title="Dados atualizados" icon="edit" accent="#27C75F" onClose={close}>
      <FlowSuccess title="Dados salvos com sucesso" sub={`As informações de ${f.nome} foram atualizadas.`} actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="EDITAR CLIENTE" title={`Atualizar ${(lead.name || '').split(' ')[0]}`} icon="edit" accent="#E8CE72" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="ghost" size="lg" onClick={close}>Cancelar</LBtn>
        <LBtn kind="gold" size="lg" icon="check" onClick={() => {
          if (lead.id) LeadService.update(lead.id, { name: f.nome, phone: f.tel, car: f.car, stage: f.stage, pay: f.pay });
          setDone(true);
        }}>Salvar alterações</LBtn></>}>
      <div style={{ maxWidth: 720 }}>
        <FPanel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FField label="Nome" icon="user" value={f.nome} onChange={(e: any) => set('nome', e.target.value)} />
            <FField label="Telefone" icon="phone" value={f.tel} onChange={(e: any) => set('tel', e.target.value)} />
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '4px 0 9px' }}>Veículo de interesse</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 18 }}>
            {(lead.car ? [lead.car, ...CARS.filter((c: string) => c !== lead.car)] : CARS).slice(0, 4).map(c => <ChoiceTile key={c} icon="car" title={c} active={f.car === c} onClick={() => set('car', c)} />)}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Etapa atual</div>
          <div style={{ marginBottom: 18 }}><Segmented options={STAGES} value={f.stage} onChange={v => set('stage', v)} /></div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Pagamento</div>
          <Segmented options={PAYS.map(p => p[0])} value={f.pay} onChange={v => set('pay', v)} />
        </FPanel>
      </div>
    </FlowShell>
  );
}

export function FlowCriarVisita({ payload, close, openFlow }: any) {
  const [lead, setLead] = useState<any>(payload.lead || null);
  const [done, setDone] = useState(false);
  const [client, setClient] = useState(lead ? lead.name : '');
  const [day, setDay] = useState('Amanhã');
  const [customDay, setCustomDay] = useState('');
  const [time, setTime] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [vehicles, setVehicles] = useState<string[]>(lead ? [lead.car] : []);
  const [customCar, setCustomCar] = useState('');
  const [note, setNote] = useState('');
  const days = ['Hoje', 'Amanhã', 'Qui 18', 'Sex 19', 'Sáb 20'];
  const slots = ['09:00', '10:30', '14:00', '15:30', '17:00', '18:30'];

  const pickLead = (l: any) => { setLead(l); setClient(l.name); setVehicles([l.car]); setCustomCar(''); };
  const clearLead = () => { setLead(null); setClient(''); setVehicles([]); };

  const toggleVehicle = (c: string) => {
    setVehicles(vs => vs.includes(c) ? vs.filter(v => v !== c) : [...vs, c]);
  };

  const finalDay = customDay.trim() || day;
  const finalTime = customTime.trim() || time;
  const finalVehicles = customCar.trim() ? [...vehicles, customCar.trim()] : vehicles;
  const ok = client && finalDay && finalTime && finalVehicles.length > 0;
  // Normalize accents (e.g. "Amanhã" -> "amanha") so it matches the plain-ASCII
  // 'hoje'/'amanha'/'passado' buckets ScreenVisitas groups by — a mismatched
  // accent silently hid scheduled visits from the Visitas screen.
  const normalizeDay = (d: string) => Array.from(d.toLowerCase().normalize('NFD'))
    .filter(ch => { const code = ch.codePointAt(0) || 0; return code < 0x300 || code > 0x36f; })
    .join('');

  const handleSchedule = () => {
    if (!ok) return;
    const user = AuthService.getCurrentUser();
    VisitService.create({
      client: lead ? lead.name : client,
      car: finalVehicles[0],
      vehicles: finalVehicles.length > 1 ? finalVehicles : undefined,
      day: normalizeDay(finalDay),
      time: finalTime,
      status: VISIT_STATUS.SCHEDULED,
      seller: lead?.seller || user?.name || '—',
      sellerId: lead?.sellerId ?? user?.sellerId ?? null,
      leadId: lead?.id ?? null,
      note: note.trim() || undefined,
    });
    if (lead?.id) {
      LeadService.addToTimeline(lead.id, { icon: 'calendar', c: '#E8CE72', t: 'Visita agendada', d: `${finalDay} às ${finalTime}` });
      LeadService.updateHealth(lead.id, { type: 'visit_scheduled', hasDate: !!finalDay, hasTime: !!finalTime });
    }
    setDone(true);
  };

  if (done) return (
    <FlowShell eyebrow="AGENDAR VISITA" title="Visita agendada" icon="calendar" accent="#27C75F" onClose={close}>
      <FlowSuccess title="Visita agendada!" sub={`${client} · ${finalDay} às ${finalTime}. Enviamos um lembrete e criamos uma pendência para confirmar a presença.`}
          actions={<><LBtn kind="gold" size="lg" icon="message" onClick={() => openFlow('enviar-mensagem', { name: client })}>Enviar confirmação</LBtn><LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn></>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="AGENDAR VISITA" title="Agendar uma visita" icon="calendar" accent="#E8CE72" onClose={close}
      sub="Escolha o dia e o horário. Visita confirmada é o passo que mais aproxima da venda."
      footer={<><div style={{ flex: 1 }} /><span style={{ fontSize: 13, color: 'var(--t-500)' }}>{ok ? `${finalDay} às ${finalTime}` : 'Selecione veículo, dia e horário'}</span><LBtn kind="gold" size="lg" icon="check" onClick={handleSchedule} style={{ opacity: ok ? 1 : .5 }}>Agendar visita</LBtn></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start', maxWidth: 900 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {lead ? <div>
            <ClientChip lead={lead} size="lg" />
            <button onClick={clearLead} style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--t-500)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Trocar cliente</button>
          </div> : <FPanel><LeadPicker value={client} onChange={setClient} onPick={pickLead} placeholder="Buscar cliente pelo nome..." /></FPanel>}
          <FPanel title="Veículo(s) de interesse" icon="car" accent="#E8CE72">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(lead ? [lead.car, ...CARS.filter((c: string) => c !== lead.car)] : CARS).slice(0, 4).map((c: string) => <ChoiceTile key={c} icon="car" title={c} active={vehicles.includes(c)} onClick={() => toggleVehicle(c)} />)}
            </div>
            <div style={{ marginTop: 14 }}>
              <FField label="Outro veículo (opcional)" icon="edit" placeholder="Cliente também quer ver..." value={customCar} onChange={(e: any) => setCustomCar(e.target.value)} />
            </div>
          </FPanel>
          <FPanel title="Observações (opcional)" icon="clipboard" accent="#E8CE72">
            <FArea placeholder="Ex.: cliente quer ver Golf e Civic, levar simulação de financiamento, vem com esposa..." value={note} onChange={(e: any) => setNote(e.target.value)} />
          </FPanel>
        </div>
        <FPanel title="Dia e horário" icon="calendar" accent="#E8CE72">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {days.map(d => <button key={d} onClick={() => { setDay(d); setCustomDay(''); }} className="lift" style={{ flex: '1 1 80px', padding: '14px 8px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${!customDay && day === d ? 'rgba(212,175,55,.6)' : 'var(--border)'}`, background: !customDay && day === d ? 'var(--gold-bg)' : 'rgba(255,255,255,.03)', color: !customDay && day === d ? 'var(--gold-ink)' : 'var(--t-700)', fontWeight: 700, fontSize: 13.5 }}>{d}</button>)}
          </div>
          <FField label="Outra data (opcional)" icon="calendar" placeholder="Ex.: 22/07 ou daqui 2 semanas" value={customDay} onChange={(e: any) => setCustomDay(e.target.value)} />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '4px 0 9px' }}>Horário disponível</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
            {slots.map(s => <button key={s} onClick={() => { setTime(s); setCustomTime(''); }} className="lift" style={{ padding: '14px 8px', borderRadius: 12, cursor: 'pointer', fontFamily: 'Archivo, sans-serif', border: `1px solid ${!customTime && time === s ? 'rgba(212,175,55,.6)' : 'var(--border)'}`, background: !customTime && time === s ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'rgba(255,255,255,.03)', color: !customTime && time === s ? '#241c04' : 'var(--t-700)', fontWeight: 800, fontSize: 16 }}>{s}</button>)}
          </div>
          <FField label="Outro horário (opcional)" icon="clock" placeholder="Ex.: 19:30" value={customTime} onChange={(e: any) => setCustomTime(e.target.value)} />
        </FPanel>
      </div>
    </FlowShell>
  );
}

export function FlowConfirmarVisita({ payload, close, openFlow }: any) {
  const v = payload.visit;
  const [done, setDone] = useState<string | null>(null);
  const [remind, setRemind] = useState(true);

  if (!v) return null;

  const lead = v.leadId ? LeadService.getAll().find((l: any) => l.id === v.leadId) ?? null : null;

  if (done) {
    const map: Record<string, any> = {
      confirmada: { icon: 'checkCircle', accent: '#27C75F', title: 'Visita confirmada!', sub: `${v.client} confirmou presença ${remind ? '— lembrete enviado por WhatsApp.' : '.'}` },
      remarcar: { icon: 'calendar', accent: '#FFA31F', title: 'Vamos remarcar', sub: 'Escolha um novo dia e horário para a visita.' },
      cancelou: { icon: 'xCircle', accent: '#FF3B3B', title: 'Visita cancelada', sub: 'Registramos o cancelamento e criamos um follow-up para retomar o cliente.' },
    };
    const m = map[done];
    return (
      <FlowShell eyebrow="CONFIRMAR VISITA" title={m.title} icon="calendar" accent={m.accent} onClose={close}>
        <FlowSuccess icon={m.icon} accent={m.accent} title={m.title} sub={m.sub}
          actions={done === 'remarcar' ? <LBtn kind="gold" size="lg" icon="calendar" onClick={() => openFlow('criar-visita', { lead })}>Remarcar agora</LBtn> : <LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
      </FlowShell>
    );
  }
  return (
    <FlowShell eyebrow="CONFIRMAR VISITA" title="Confirmar presença" icon="calendar" accent="#FF3B3B" onClose={close}
      status={<LBadge tone="red" solid><Icon name="alert" size={12} stroke={2.4} />Não confirmada</LBadge>}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <FPanel style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div className="display" style={{ fontSize: 40, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{v.time}</div>
            <div style={{ width: 1, height: 48, background: 'var(--border)' }} />
            <Avatar name={v.client} size={56} ring="#FF3B3B" />
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--t-900)' }}>{v.client}</div>
              <div style={{ fontSize: 13, color: 'var(--t-500)', marginTop: 3, display: 'flex', gap: 12 }}>
                <span><Icon name="car" size={13} stroke={2} style={{ verticalAlign: -2 }} /> {v.vehicles?.length > 1 ? v.vehicles.join(' + ') : v.car}</span>
                <span><Icon name="user" size={13} stroke={2} style={{ verticalAlign: -2 }} /> {v.seller.split(' ')[0]}</span>
              </div>
            </div>
          </div>
          {v.note && <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-2)', display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, color: 'var(--t-500)' }}>
            <Icon name="clipboard" size={14} stroke={2} style={{ marginTop: 1, flexShrink: 0 }} /> {v.note}
          </div>}
        </FPanel>
        <button onClick={() => setRemind(r => !r)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 18 }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${remind ? 'var(--green)' : 'var(--border)'}`, background: remind ? 'var(--green)' : 'transparent', display: 'grid', placeItems: 'center', color: '#fff' }}>{remind && <Icon name="check" size={12} stroke={3} />}</span>
          <Icon name="message" size={17} stroke={2} style={{ color: '#27C75F' }} />
          <span style={{ fontSize: 14, color: 'var(--t-900)', fontWeight: 600 }}>Enviar lembrete por WhatsApp ao confirmar</span>
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <ChoiceTile icon="checkCircle" title="Confirmou" desc="Vai comparecer" accent="#27C75F" onClick={() => {
            VisitService.update(v.id, { status: VISIT_STATUS.CONFIRMED });
            if (v.leadId) {
              LeadService.addToTimeline(v.leadId, { icon: 'checkCircle', c: '#27C75F', t: 'Visita confirmada', d: remind ? 'Lembrete enviado' : undefined });
              LeadService.updateHealth(v.leadId, { type: 'visit_confirmed' });
            }
            setDone('confirmada');
          }} />
          <ChoiceTile icon="calendar" title="Remarcar" desc="Outro dia/horário" accent="#FFA31F" onClick={() => {
            VisitService.update(v.id, { status: VISIT_STATUS.RESCHEDULED });
            if (v.leadId) {
              LeadService.addToTimeline(v.leadId, { icon: 'calendar', c: '#FFA31F', t: 'Visita remarcada' });
              LeadService.updateHealth(v.leadId, { type: 'visit_rescheduled' });
            }
            setDone('remarcar');
          }} />
          <ChoiceTile icon="xCircle" title="Cancelou" desc="Não vem mais" accent="#FF3B3B" onClick={() => {
            VisitService.update(v.id, { status: VISIT_STATUS.CANCELED });
            if (v.leadId) {
              LeadService.addToTimeline(v.leadId, { icon: 'xCircle', c: '#FF3B3B', t: 'Visita cancelada' });
              LeadService.updateHealth(v.leadId, { type: 'visit_canceled' });
            }
            setDone('cancelou');
          }} />
        </div>
      </div>
    </FlowShell>
  );
}

export function FlowRegistrarResultado({ payload, close, openFlow }: any) {
  const v = payload.visit;
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const opts = [
    { id: 'vendeu', icon: 'trophy', title: 'Fechou negócio', desc: 'Cliente vai comprar', accent: '#E8CE72', next: 'registrar-venda' },
    { id: 'negociando', icon: 'handshake', title: 'Em negociação', desc: 'Montar proposta', accent: '#27C75F', next: 'nova-proposta' },
    { id: 'pensar', icon: 'clock', title: 'Vai pensar', desc: 'Agendar follow-up', accent: '#FFA31F', next: 'criar-acompanhamento' },
    { id: 'sem', icon: 'xCircle', title: 'Sem interesse', desc: 'Encerrar por agora', accent: '#8B8B93', next: null },
  ];

  if (!v) return null;

  const handleSave = () => {
    if (!outcome) return;
    const statusMap: Record<string, string> = { vendeu: VISIT_STATUS.DONE, negociando: VISIT_STATUS.DONE, pensar: VISIT_STATUS.DONE, sem: VISIT_STATUS.NO_INTEREST };
    VisitService.update(v.id, { status: statusMap[outcome] || VISIT_STATUS.DONE });
    if (v.leadId) {
      const o = opts.find(x => x.id === outcome)!;
      LeadService.addToTimeline(v.leadId, {
        icon: o.icon, c: o.accent === '#8B8B93' ? '#888' : o.accent, t: `Visita: ${o.title}`, d: note || undefined,
      });
    }
    setDone(true);
  };

  if (done) {
    const o = opts.find(x => x.id === outcome)!;
    const lead = v.leadId ? LeadService.getAll().find((l: any) => l.id === v.leadId) ?? null : null;
    return (
      <FlowShell eyebrow="RESULTADO DA VISITA" title="Resultado registrado" icon="clipboard" accent={o.accent} onClose={close}>
        <FlowSuccess icon="checkCircle" accent={o.accent === '#8B8B93' ? '#27C75F' : o.accent} title="Resultado salvo!" sub={`Visita de ${v.client} registrada como "${o.title}".`}
          actions={<>
            {o.next && <LBtn kind="gold" size="lg" icon={o.icon} onClick={() => openFlow(o.next, { lead })}>{o.id === 'vendeu' ? 'Registrar venda' : o.id === 'negociando' ? 'Montar proposta' : 'Criar follow-up'}</LBtn>}
            <LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn>
          </>} />
      </FlowShell>
    );
  }
  return (
    <FlowShell eyebrow="RESULTADO DA VISITA" title="Como foi a visita?" icon="clipboard" accent="#E8CE72" onClose={close}
      sub={`Registre o que aconteceu na visita de ${v.client}. Isso mantém o ranking e o acompanhamento sempre certos.`}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check" onClick={handleSave} style={{ opacity: outcome ? 1 : .5 }}>Salvar resultado</LBtn></>}>
      <div style={{ maxWidth: 760 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
          {opts.map(o => <ChoiceTile key={o.id} big icon={o.icon} title={o.title} desc={o.desc} accent={o.accent} active={outcome === o.id} onClick={() => setOutcome(o.id)} />)}
        </div>
        <FPanel><FArea label="Anotações da visita (opcional)" placeholder="O que o cliente achou, objeções, próximos passos…" value={note} onChange={(e: any) => setNote(e.target.value)} /></FPanel>
      </div>
    </FlowShell>
  );
}

function parseCurrency(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function FlowNovaProposta({ payload, close, openFlow }: any) {
  const [lead, setLead] = useState<any>(payload.lead || null);
  const [step, setStep] = useState(0);
  const [clientQuery, setClientQuery] = useState(lead ? lead.name : '');
  const [car, setCar] = useState(lead ? lead.car : CARS[0]);
  const [customCar, setCustomCar] = useState('');
  const [pay, setPay] = useState(lead ? lead.pay : 'Financiamento');
  const [disc, setDisc] = useState(3);
  const [baseValueInput, setBaseValueInput] = useState(String(parseCurrency(lead?.value, 120000)));
  const [downPayment, setDownPayment] = useState('');
  const [installments, setInstallments] = useState('');
  const [note, setNote] = useState('');
  const base = parseCurrency(baseValueInput, 120000);
  const steps = ['Cliente e veículo', 'Condições', 'Revisão'];
  const needsApproval = disc > 5;
  const finalCar = customCar.trim() || car;
  const finalV = Math.round(base * (1 - disc / 100));
  const fmt = (n: number) => 'R$ ' + n.toLocaleString('pt-BR');
  // Proposta comercial precisa estar ligada a um cliente cadastrado — texto
  // livre não vinculado a um lead real é o que gerava propostas com
  // client:'—' (ver M0-K1.5, bug 4). Regra de produto: Opção A.
  const canNext = step === 0 ? !!lead : true;

  const pickLead = (l: any) => { setLead(l); setClientQuery(l.name); setCar(l.car); setCustomCar(''); setPay(l.pay || pay); setBaseValueInput(String(parseCurrency(l.value, base))); };
  const clearLead = () => { setLead(null); setClientQuery(''); };

  const handleCreateDeal = () => {
    if (!lead) return;
    const user = AuthService.getCurrentUser();
    DealService.create({
      client: lead.name,
      car: finalCar,
      value: fmt(finalV),
      disc: `${disc}%`,
      payment: pay,
      downPayment: downPayment.trim() || undefined,
      installments: installments.trim() || undefined,
      note: note.trim() || undefined,
      status: needsApproval ? DEAL_STATUS.APPROVAL : DEAL_STATUS.OPEN,
      last: 'Agora',
      seller: lead.seller || user?.name || '—',
      sellerId: lead.sellerId ?? user?.sellerId ?? null,
      leadId: lead.id,
    });
    LeadService.addToTimeline(lead.id, { icon: 'handshake', c: '#E8CE72', t: 'Proposta criada', d: `${finalCar} · ${fmt(finalV)}` });
    LeadService.updateHealth(lead.id, { type: 'deal_created', needsApproval });
    setStep(3);
  };

  if (step === 3) {
    return (
      <FlowShell eyebrow="MONTAR PROPOSTA" title="Proposta criada" icon="handshake" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Proposta enviada!" sub={needsApproval ? 'A proposta foi enviada para aprovação do gestor (desconto acima do limite).' : `Proposta de ${finalCar} pronta. Envie ao cliente e acompanhe pela tela de Propostas.`}
          actions={<><LBtn kind="gold" size="lg" icon="message" onClick={() => openFlow('enviar-mensagem', { lead })}>Enviar ao cliente</LBtn><LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn></>} />
      </FlowShell>
    );
  }
  return (
    <FlowShell eyebrow="MONTAR PROPOSTA" title="Montar uma proposta" icon="handshake" accent="#E8CE72" onClose={close}
      footer={<>
        {step > 0 ? <LBtn kind="ghost" size="lg" onClick={() => setStep(step - 1)}>Voltar</LBtn> : <span />}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--t-500)' }}>Passo {step + 1} de 3</span>
        <LBtn kind="gold" size="lg" icon={step === 2 ? 'check' : 'arrowRight'}
          onClick={() => { if (!canNext) return; if (step === 2) handleCreateDeal(); else setStep(step + 1); }}
          style={{ opacity: canNext ? 1 : .5 }}>
          {step === 2 ? 'Criar proposta' : 'Continuar'}
        </LBtn>
      </>}>
      <StepRail steps={steps} current={step} />
      <div style={{ maxWidth: 760 }}>
        {step === 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {lead ? <div>
            <ClientChip lead={lead} size="lg" />
            <button onClick={clearLead} style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--t-500)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Trocar cliente</button>
          </div> : <FPanel>
            <LeadPicker value={clientQuery} onChange={setClientQuery} onPick={pickLead} placeholder="Buscar cliente pelo nome..." />
            {clientQuery.trim() && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>Selecione um cliente cadastrado para criar a proposta.</div>}
          </FPanel>}
          <FPanel title="Veículo da proposta" icon="car" accent="#E8CE72">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
              {(lead ? [lead.car, ...CARS.filter((c: string) => c !== lead.car)] : CARS).slice(0, 4).map((c: string) => <ChoiceTile key={c} icon="car" title={c} active={!customCar.trim() && car === c} onClick={() => { setCar(c); setCustomCar(''); }} />)}
            </div>
            <div style={{ marginTop: 14 }}>
              <FField label="Outro veículo (opcional)" icon="edit" placeholder="Digitar um veículo diferente" value={customCar} onChange={(e: any) => setCustomCar(e.target.value)} />
            </div>
          </FPanel>
        </div>}
        {step === 1 && <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <FPanel title="Condições" icon="card" accent="#E8CE72">
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Forma de pagamento</div>
            <div style={{ marginBottom: 22 }}><Segmented options={PAYS.map(p => p[0])} value={pay} onChange={setPay} /></div>
            <FField label="Valor do veículo (R$)" icon="dollar" placeholder="120000" value={baseValueInput} onChange={(e: any) => setBaseValueInput(e.target.value)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FField label="Entrada (opcional)" icon="card" placeholder="Ex.: R$ 20.000" value={downPayment} onChange={(e: any) => setDownPayment(e.target.value)} />
              <FField label="Parcelas / condição (opcional)" icon="refresh" placeholder="Ex.: 48x de R$ 2.100" value={installments} onChange={(e: any) => setInstallments(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)' }}>Desconto aplicado</span>
              <span className="display tnum" style={{ fontSize: 22, fontWeight: 800, color: needsApproval ? 'var(--amber)' : 'var(--gold-ink)' }}>{disc}%</span>
            </div>
            <input type="range" min="0" max="10" step="1" value={disc} onChange={e => setDisc(+e.target.value)} style={{ width: '100%', accentColor: needsApproval ? '#FFA31F' : '#D4AF37' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t-400)', marginTop: 4 }}><span>0%</span><span>limite 5%</span><span>10%</span></div>
            {needsApproval && <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--amber-bg)', border: '1px solid var(--amber-line)' }}>
              <Icon name="shield" size={18} stroke={2.2} style={{ color: 'var(--amber)' }} />
              <span style={{ fontSize: 13, color: 'var(--t-700)' }}>Desconto acima de 5% precisará de <b>aprovação do gestor</b>.</span>
            </div>}
          </FPanel>
          <FPanel title="Observação interna (opcional)" icon="clipboard" accent="#E8CE72">
            <FArea placeholder="Comentário interno sobre a proposta..." value={note} onChange={(e: any) => setNote(e.target.value)} />
          </FPanel>
        </div>}
        {step === 2 && <FPanel title="Resumo da proposta" icon="checkCircle" accent="#27C75F">
          <SummaryRow label="Cliente" value={lead?.name || '—'} />
          <SummaryRow label="Veículo" value={finalCar} />
          <SummaryRow label="Pagamento" value={pay} />
          {downPayment.trim() && <SummaryRow label="Entrada" value={downPayment} />}
          {installments.trim() && <SummaryRow label="Parcelas" value={installments} />}
          <SummaryRow label="Desconto" value={`${disc}%`} accent={needsApproval ? 'var(--amber)' : undefined} />
          {note.trim() && <SummaryRow label="Observação" value={note} />}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, color: 'var(--t-400)' }}>Valor final (referência)</span>
            <span className="display tnum" style={{ fontSize: 22, fontWeight: 700, color: 'var(--t-700)' }}>{fmt(finalV)}</span>
          </div>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: needsApproval ? 'var(--amber-bg)' : 'var(--green-bg)', border: `1px solid ${needsApproval ? 'var(--amber-line)' : 'var(--green-line)'}` }}>
            <Icon name={needsApproval ? 'shield' : 'checkCircle'} size={18} stroke={2.2} style={{ color: needsApproval ? 'var(--amber)' : 'var(--green)' }} />
            <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{needsApproval ? 'Será enviada para aprovação do gestor.' : 'Dentro do seu limite — pode enviar direto ao cliente.'}</span>
          </div>
        </FPanel>}
      </div>
    </FlowShell>
  );
}

export function FlowAprovarProposta({ payload, close }: any) {
  const d = payload.deal;
  const [done, setDone] = useState<string | null>(null);

  if (!d) return null;

  if (done) return (
    <FlowShell eyebrow="APROVAÇÃO" title={done === 'aprovada' ? 'Proposta aprovada' : 'Proposta recusada'} icon="shield" accent={done === 'aprovada' ? '#27C75F' : '#FF3B3B'} onClose={close}>
      <FlowSuccess icon={done === 'aprovada' ? 'checkCircle' : 'xCircle'} accent={done === 'aprovada' ? '#27C75F' : '#FF3B3B'} title={done === 'aprovada' ? 'Proposta aprovada!' : 'Proposta recusada'} sub={done === 'aprovada' ? `O vendedor ${d.seller.split(' ')[0]} foi avisado e já pode fechar com ${d.client}.` : `O vendedor ${d.seller.split(' ')[0]} foi avisado para renegociar com ${d.client}.`}
        actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="APROVAÇÃO DO GESTOR" title="Aprovar proposta" icon="shield" accent="#FFA31F" onClose={close}
      status={<LBadge tone="amber"><Icon name="clock" size={12} stroke={2.4} />Aguardando decisão</LBadge>}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <FPanel style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
            <Avatar name={d.client} size={52} ring="#FFA31F" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--t-900)' }}>{d.client}</div>
              <div style={{ fontSize: 13, color: 'var(--t-500)', marginTop: 3 }}><Icon name="car" size={13} stroke={2} style={{ verticalAlign: -2 }} /> {d.car} · vendedor {d.seller.split(' ')[0]}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber-line)' }}>
            <Icon name="percent" size={20} stroke={2.2} style={{ color: 'var(--amber)' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>{d.disc || 'Desconto acima do limite de 5%'}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <SummaryRow label="Valor da proposta" value={d.value} />
            <SummaryRow label="Margem estimada" value="Dentro do aceitável" accent="var(--green)" />
            <SummaryRow label="Atualizada" value={d.last} />
          </div>
        </FPanel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <LBtn kind="gold" size="lg" icon="checkCircle" onClick={() => {
            DealService.approve(d.id);
            if (d.leadId) {
              LeadService.addToTimeline(d.leadId, { icon: 'checkCircle', c: '#27C75F', t: 'Proposta aprovada' });
              LeadService.updateHealth(d.leadId, { type: 'deal_approved' });
            }
            setDone('aprovada');
          }} style={{ justifyContent: 'center', background: 'linear-gradient(180deg,#2EDC72,#15924B)', color: '#fff', border: '1px solid #2EDC72', padding: '16px' }}>Aprovar proposta</LBtn>
          <LBtn kind="danger" size="lg" icon="xCircle" onClick={() => {
            DealService.reject(d.id);
            if (d.leadId) {
              LeadService.addToTimeline(d.leadId, { icon: 'xCircle', c: '#FF3B3B', t: 'Proposta recusada' });
              LeadService.updateHealth(d.leadId, { type: 'deal_rejected' });
            }
            setDone('recusada');
          }} style={{ justifyContent: 'center', padding: '16px' }}>Recusar</LBtn>
        </div>
      </div>
    </FlowShell>
  );
}

export function Confetti() {
  const cols = ['#E8CE72', '#C1121F', '#27C75F', '#fff', '#FFA31F'];
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden="true">
      {Array.from({ length: 40 }).map((_, i) => (
        <span key={i} style={{ position: 'absolute', top: -20, left: (i * 2.6 + (i % 3)) + '%', width: i % 2 ? 7 : 9, height: i % 2 ? 7 : 12, background: cols[i % cols.length], borderRadius: i % 3 ? 2 : '50%', opacity: 0, animation: `confettiFall ${2.6 + (i % 5) * 0.5}s ease-in ${(i % 10) * 0.15}s infinite` }} />
      ))}
    </div>
  );
}

export function FlowRegistrarVenda({ payload, close }: any) {
  const [lead, setLead] = useState<any>(payload.lead || null);
  const [step, setStep] = useState(lead ? 'confirm' : 'pick');
  const [car, setCar] = useState(lead ? lead.car : '');
  const [customCar, setCustomCar] = useState('');
  const [client, setClient] = useState(lead ? lead.name : '');

  const user = AuthService.getCurrentUser();
  const isSeller = user?.role === 'seller';
  const storeSellers = SellerService.getAll();
  // A seller's sale is always theirs. A manager/admin has no sellerId of
  // their own — the sale must be attributed to a real Seller, never to the
  // acting manager (that's the exact "Parabéns, Carlos" bug this fixes).
  // Pre-select the lead's own seller when one is picked; otherwise the
  // manager must choose — never silently falls back to currentUser.
  const [assignedSellerId, setAssignedSellerId] = useState<string | null>(
    isSeller ? (user?.sellerId ?? null) : (lead?.sellerId ?? null),
  );
  const finalSellerId = isSeller ? (user?.sellerId ?? null) : assignedSellerId;
  const finalSeller = finalSellerId ? storeSellers.find((s: any) => s.id === finalSellerId) ?? null : null;

  const [doneSeller, setDoneSeller] = useState<any>(null);
  const [donePos, setDonePos] = useState<number>(-1);
  const [doneGap, setDoneGap] = useState<number>(0);

  const pickLead = (l: any) => {
    setLead(l);
    setClient(l.name);
    setCar(l.car);
    setCustomCar('');
    if (!isSeller) setAssignedSellerId(l.sellerId ?? null);
  };

  const clearLead = () => {
    setLead(null);
    setClient('');
    setCar('');
    setCustomCar('');
    if (!isSeller) setAssignedSellerId(null);
  };

  const handleConfirmSale = () => {
    if (!client && !lead) return;
    const finalCar = customCar.trim() || car;
    if (!finalCar) return;
    if (!finalSeller) return; // guarded by the disabled button below too

    SaleService.create({
      client: lead ? lead.name : client,
      car: finalCar,
      seller: finalSeller.name,
      sellerId: finalSeller.id,
      leadId: lead?.id ?? null,
      dealId: null,
      value: '—',
      pay: lead?.pay || 'Financiamento',
      date: 'Hoje',
      status: SALE_STATUS.PENDING,
      createdByUserId: user?.id ?? null,
    });
    if (lead?.id) {
      LeadService.addToTimeline(lead.id, { icon: 'trophy', c: '#E8CE72', t: 'Venda fechada!', d: finalCar });
      LeadService.updateHealth(lead.id, { type: 'sale_registered' });
    }

    // Re-read after the sale so the podium reflects the post-increment,
    // post-resort ranking (store.addSale already re-sorts sellers — M0-K3) —
    // never derived from currentUser (Correção 2).
    const freshSellers = SellerService.getAll();
    const idx = freshSellers.findIndex((s: any) => s.id === finalSeller.id);
    const third = freshSellers[2] ?? null;
    const winner = idx >= 0 ? freshSellers[idx] : finalSeller;
    setDoneSeller(winner);
    setDonePos(idx);
    setDoneGap(third ? Math.max(0, (third.sales ?? 0) - (winner.sales ?? 0)) : 0);
    setCar(finalCar);
    setStep('done');
  };

  if (step === 'done') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 80% at 50% -10%, #2a2208, #0a0a0b 60%)', animation: 'flowIn .34s' }}>
        <Confetti />
        <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .25, pointerEvents: 'none' }} />
        <button onClick={close} style={{ position: 'absolute', top: 22, right: 26, width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.05)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-500)', zIndex: 2 }}><Icon name="x" size={20} stroke={2.2} /></button>
        <div style={{ position: 'relative', flex: 1, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 28 }}>
          <div>
            <div style={{ position: 'relative', width: 150, height: 150, margin: '0 auto 28px' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.3s ease-out' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.3s ease-out .3s' }} />
              <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #E8CE72, #A9831F)', display: 'grid', placeItems: 'center', color: '#241c04', boxShadow: '0 24px 64px -16px rgba(212,175,55,.8)', animation: 'goldPulse 3s ease-in-out infinite' }}>
                <Icon name="trophy" size={68} stroke={1.9} />
              </div>
            </div>
            <div className="display" style={{ fontSize: 13, fontWeight: 800, color: '#E8CE72', letterSpacing: '.28em', marginBottom: 10 }}>VENDA CONFIRMADA</div>
            <h1 className="display" style={{ margin: '0 0 14px', fontSize: 46, fontWeight: 900, color: '#fff', letterSpacing: '-.02em', lineHeight: 1 }}>Parabéns, {doneSeller?.first || doneSeller?.name?.split(' ')[0] || 'vendedor'}! 🏁</h1>
            <p style={{ margin: '0 auto 24px', color: 'var(--txt-mid)', fontSize: 16, maxWidth: 500 }}>Você fechou a venda do <b style={{ color: '#fff' }}>{car}</b>{(lead?.name || client) ? <> para <b style={{ color: '#fff' }}>{lead?.name || client}</b></> : ''}. Mais um passo rumo ao topo do ranking.</p>
            <div style={{ display: 'inline-flex', gap: 14, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
              <div style={{ padding: '16px 26px', borderRadius: 16, background: 'linear-gradient(180deg,#1f1a08,#141103)', border: '1px solid rgba(212,175,55,.4)' }}>
                <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#E8CE72', lineHeight: 1 }}>{doneSeller?.sales ?? '—'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>vendas no mês</div>
              </div>
              <div style={{ padding: '16px 26px', borderRadius: 16, background: 'rgba(255,255,255,.04)', border: '1px solid var(--line-dark)' }}>
                <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{donePos >= 0 ? `${donePos + 1}º` : '—'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>posição</div>
              </div>
              <div style={{ padding: '16px 26px', borderRadius: 16, background: 'rgba(39,199,95,.1)', border: '1px solid var(--green-line)' }}>
                <div className="display tnum" style={{ fontSize: 38, fontWeight: 900, color: '#27C75F', lineHeight: 1 }}>{doneGap}</div>
                <div style={{ fontSize: 11.5, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginTop: 4 }}>p/ o TOP 3</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <LBtn kind="gold" size="lg" icon="car" onClick={() => { clearLead(); setStep('pick'); }}>Registrar outra venda</LBtn>
              <LBtn kind="ghost" size="lg" icon="check" onClick={close}>Voltar ao sistema</LBtn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canConfirm = !!(client || lead) && !!(customCar.trim() || car) && !!finalSeller;

  return (
    <FlowShell eyebrow="REGISTRAR VENDA" title="Confirmar venda" icon="trophy" accent="#E8CE72" onClose={close}
      sub="Confirme os dados da venda. Esse é o número que mais importa — e que te leva ao topo do ranking."
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="trophy" onClick={handleConfirmSale} style={{ opacity: canConfirm ? 1 : .5, background: 'linear-gradient(180deg,#E8CE72,#C9A227)' }}>Confirmar venda 🏁</LBtn></>}>
      <div style={{ maxWidth: 720 }}>
        {!isSeller && (
          <FPanel style={{ marginBottom: 16 }}>
            <SellerPicker value={finalSeller} onPick={(s: any) => setAssignedSellerId(s.id)} />
            {!finalSeller && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>Selecione o vendedor responsável por esta venda.</div>}
          </FPanel>
        )}
        {!lead && (
          <FPanel style={{ marginBottom: 16, position: 'relative' }}>
            <LeadPicker value={client} onChange={setClient} onPick={pickLead} placeholder="Buscar lead pelo nome ou digitar (venda avulsa)…" />
          </FPanel>
        )}
        {lead && <div style={{ marginBottom: 16 }}>
          <ClientChip lead={lead} size="lg" />
          <button onClick={clearLead} style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--t-500)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Trocar cliente</button>
        </div>}
        <FPanel title="Veículo vendido" icon="car" accent="#E8CE72">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
            {(lead ? [lead.car, ...CARS.filter((c: string) => c !== lead.car)] : CARS).slice(0, 6).map((c: string) => <ChoiceTile key={c} icon="car" title={c} active={!customCar.trim() && car === c} onClick={() => { setCar(c); setCustomCar(''); }} />)}
          </div>
          <div style={{ marginTop: 14 }}>
            <FField label="Outro veículo (opcional)" icon="edit" placeholder="Digitar um veículo diferente" value={customCar} onChange={(e: any) => setCustomCar(e.target.value)} />
          </div>
        </FPanel>
      </div>
    </FlowShell>
  );
}

export function FlowNovaPendencia({ payload, close }: any) {
  const [done, setDone] = useState(false);
  const [type, setType] = useState('Ligar');
  const [client, setClient] = useState(payload.lead ? payload.lead.name : '');
  const [when, setWhen] = useState('Hoje');
  const [prio, setPrio] = useState('Alta');
  const types: [string, string][] = [['Ligar', 'phone'], ['Visita', 'calendar'], ['Follow-up', 'refresh'], ['Proposta', 'handshake'], ['Documento', 'doc']];

  if (done) return (
    <FlowShell eyebrow="NOVA PENDÊNCIA" title="Pendência criada" icon="check" accent="#27C75F" onClose={close}>
      <FlowSuccess title="Pendência criada!" sub={`"${type}${client ? ' — ' + client : ''}" foi adicionada para ${when.toLowerCase()}.`} actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="NOVA PENDÊNCIA" title="Criar uma pendência" icon="check" accent="#E8CE72" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check" onClick={() => {
        const user = AuthService.getCurrentUser();
        const prioMap: Record<string, string> = { Alta: 'alta', Média: 'media', Baixa: 'baixa' };
        TaskService.create({
          title: `${type}${client ? ' — ' + client : ''}`,
          lead: client,
          state: TASK_STATE.TODAY,
          prio: prioMap[prio] || 'media',
          when,
          assignedTo: user?.sellerId ?? null,
          note: '',
        });
        setDone(true);
      }}>Criar pendência</LBtn></>}>
      <div style={{ maxWidth: 720 }}>
        <FPanel style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Tipo de tarefa</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
            {types.map(([tp, ic]) => (
              <button key={tp} onClick={() => setType(tp)} className="lift" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '15px 8px', borderRadius: 13, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${type === tp ? 'rgba(212,175,55,.6)' : 'var(--border)'}`, background: type === tp ? 'var(--gold-bg)' : 'rgba(255,255,255,.03)' }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, background: type === tp ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'rgba(255,255,255,.06)', color: type === tp ? '#241c04' : 'var(--t-500)', display: 'grid', placeItems: 'center' }}><Icon name={ic} size={20} stroke={2.1} /></span>
                <span style={{ fontSize: 12, fontWeight: 600, color: type === tp ? 'var(--gold-ink)' : 'var(--t-700)' }}>{tp}</span>
              </button>
            ))}
          </div>
        </FPanel>
        <FPanel>
          <FField label="Cliente relacionado (opcional)" icon="user" placeholder="Buscar cliente" value={client} onChange={(e: any) => setClient(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Quando</div>
              <Segmented options={['Hoje', 'Amanhã', 'Esta semana']} value={when} onChange={setWhen} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Prioridade</div>
              <Segmented options={['Alta', 'Média', 'Baixa']} value={prio} onChange={setPrio} accent={prio === 'Alta' ? '#FF3B3B' : '#E8CE72'} />
            </div>
          </div>
        </FPanel>
      </div>
    </FlowShell>
  );
}

export function FlowReagendarPendencia({ payload, close }: any) {
  const task = payload.task;
  const [when, setWhen] = useState('Amanhã');
  if (!task) return null;
  const whenState: Record<string, string> = { 'Hoje': TASK_STATE.TODAY, 'Amanhã': TASK_STATE.UPCOMING, 'Esta semana': TASK_STATE.UPCOMING };
  return (
    <FlowShell eyebrow="REAGENDAR PENDÊNCIA" title="Reagendar" icon="refresh" accent="#3B82F6" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check" onClick={() => {
        TaskService.update(task.id, { when, state: whenState[when] });
        close();
      }}>Reagendar</LBtn></>}>
      <div style={{ maxWidth: 520 }}>
        <FPanel>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)', marginBottom: 4 }}>{task.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginBottom: 16 }}>Atualmente: {task.when}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Nova data</div>
          <Segmented options={['Hoje', 'Amanhã', 'Esta semana']} value={when} onChange={setWhen} accent="#3B82F6" />
        </FPanel>
      </div>
    </FlowShell>
  );
}

export function FlowCriarAcompanhamento({ payload, close }: any) {
  const lead = payload.lead || null;
  const [done, setDone] = useState(false);
  const [canal, setCanal] = useState('WhatsApp');
  const [when, setWhen] = useState('Amanhã');
  const [note, setNote] = useState('');
  const canais: [string, string][] = [['WhatsApp', 'message'], ['Ligação', 'phone'], ['E-mail', 'send'], ['Presencial', 'mapPin']];

  if (done) return (
    <FlowShell eyebrow="ACOMPANHAMENTO" title="Follow-up agendado" icon="refresh" accent="#27C75F" onClose={close}>
      <FlowSuccess title="Acompanhamento criado!" sub={`Vamos te lembrar de retomar ${lead ? lead.name : 'o cliente'} via ${canal}, ${when.toLowerCase()}.`} actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="ACOMPANHAMENTO" title="Criar acompanhamento" icon="refresh" accent="#3B82F6" onClose={close}
      sub="Não deixe o cliente esfriar. Agende o próximo toque e o sistema te lembra na hora certa."
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check" onClick={() => {
        const user = AuthService.getCurrentUser();
        if (lead?.id) {
          LeadService.addToTimeline(lead.id, { icon: 'refresh', c: '#3B82F6', t: `Follow-up via ${canal}`, d: note || when });
        }
        TaskService.create({
          title: `${canal}${lead ? ' — ' + lead.name : ''}`,
          lead: lead ? lead.name : '',
          state: 'proxima',
          prio: 'media',
          when,
          assignedTo: user?.sellerId ?? null,
          note: note || '',
        });
        setDone(true);
      }}>Agendar follow-up</LBtn></>}>
      <div style={{ maxWidth: 720 }}>
        {lead && <div style={{ marginBottom: 16 }}><ClientChip lead={lead} size="lg" /></div>}
        <FPanel>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Canal do contato</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 18 }}>
            {canais.map(([c, ic]) => <ChoiceTile key={c} icon={ic} title={c} accent="#3B82F6" active={canal === c} onClick={() => setCanal(c)} />)}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Quando retomar</div>
          <div style={{ marginBottom: 18 }}><Segmented options={['Hoje', 'Amanhã', 'Em 3 dias', 'Próxima semana']} value={when} onChange={setWhen} accent="#3B82F6" /></div>
          <FArea label="Sobre o que falar (opcional)" placeholder="Ex.: enviar simulação, confirmar interesse, condição especial…" value={note} onChange={(e: any) => setNote(e.target.value)} />
        </FPanel>
      </div>
    </FlowShell>
  );
}
