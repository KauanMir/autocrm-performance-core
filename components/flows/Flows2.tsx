'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBtn, LBadge } from '@/components/ui/kit';
import { STAGES, VISIT_STATUS, DEAL_STATUS, SALE_STATUS, TASK_STATE } from '@/lib/data';
import { AuthService, LeadService, VisitService, DealService, SaleService, TaskService, SellerService } from '@/lib/services';
import {
  CARS, ORIGINS, PAYS,
  FField, FArea, Segmented, ChoiceTile, ClientChip, LeadPicker, RemoteLeadPicker, LocalSellerPicker, SellerPicker,
  FPanel, StepRail, SummaryRow, FlowShell, FlowSuccess, type SellerPickerItem,
} from './FlowsShared';
import { useCurrentCompanyAssignableSellers } from '@/lib/hooks/useCurrentCompanyAssignableSellers';
import { useCreateLead, type CreateLeadCallInput } from '@/lib/hooks/useCreateLead';
import { useUpdateLead } from '@/lib/hooks/useUpdateLead';
import { useCheckLeadPhoneDuplicate } from '@/lib/hooks/useCheckLeadPhoneDuplicate';
import { useLeadDuplicateGuard } from '@/lib/hooks/useLeadDuplicateGuard';
import type { RemoteLeadDuplicateRow } from '@/lib/leads/remoteMutationRepository';
import { resolveLeadFlowContext, type LeadFlowContext } from '@/lib/leads/leadFlowContext';
import { isRemoteLeadsError } from '@/lib/leads/errors';
import { useCreateTask } from '@/lib/hooks/useCreateTask';
import { useUpdateTask } from '@/lib/hooks/useUpdateTask';
import { resolveTaskRemoteMode } from '@/lib/tasks/remoteTasksMode';
import { combineLocalDateAndTimeToIso } from '@/lib/tasks/dueAtHelpers';
import { startOfLocalDay } from '@/lib/tasks/deriveTaskState';
import { isRemoteTasksError } from '@/lib/tasks/errors';
import { useCreateVisit } from '@/lib/hooks/useCreateVisit';
import { useUpdateVisit } from '@/lib/hooks/useUpdateVisit';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { isRemoteVisitsError } from '@/lib/visits/errors';
import { useRemoteLeadsScreenState } from '@/lib/hooks/useRemoteLeadsScreenState';
import type { LeadModel } from '@/lib/leads/adapter';
import type { RemoteVisitModel } from '@/lib/visits/adapter';
import { startOfVisitLocalDay, formatVisitTime, formatVisitShortDate } from '@/lib/visits/visitScreenGrouping';

const TEMP_MAP: Record<string, 'hot' | 'warm' | 'cold'> = { Quente: 'hot', Morno: 'warm', Frio: 'cold' };
const TEMP_INFO: Record<string, string> = {
  Quente: 'Forte intenção de compra — quer comprar agora ou nos próximos dias, já sabe o modelo e tem orçamento ou financiamento encaminhado.',
  Morno: 'Interessado, mas ainda comparando opções — precisa de acompanhamento, simulação ou mais convencimento.',
  Frio: 'Curioso, sem prazo definido ou decisão clara — precisa ser nutrido com menor urgência.',
};

// ── M1-E E4-B2 — utilitários compartilhados do caminho remoto ────────────

// Mensagens sanitizadas fixas por código estável (nunca SQL/UUID/payload) —
// mesmo modelo do reorder M1-D. Código desconhecido cai no genérico.
function remoteLeadErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'remote_leads_mutation_forbidden':
      return 'Você não tem permissão para realizar esta ação.';
    case 'remote_leads_mutation_company_required':
    case 'remote_leads_mutation_company_not_found':
    case 'remote_leads_mutation_company_read_only':
      return 'Não foi possível concluir: sua empresa não está disponível para esta ação no momento.';
    case 'remote_leads_mutation_lead_not_found':
      return 'Este cliente não foi encontrado.';
    case 'remote_leads_mutation_lead_archived':
      return 'Este cliente está arquivado e não pode ser editado.';
    case 'remote_leads_mutation_seller_not_found':
      return 'O vendedor selecionado não está mais disponível. Escolha outro.';
    case 'remote_leads_mutation_initial_stage_missing':
      return 'Não foi possível criar o cliente: configuração de etapas incompleta.';
    case 'remote_leads_mutation_invalid_phone':
      return 'Telefone inválido.';
    case 'remote_leads_mutation_stale_write':
      return 'Este Lead foi atualizado por outra pessoa. Recarregue os dados antes de tentar novamente.';
    case 'remote_leads_mutation_identity_changed':
      return 'Sua empresa atual mudou. Abra o Lead novamente para continuar.';
    default:
      return 'Não foi possível concluir a operação. Tente novamente.';
  }
}

// Fecha/reseta um flow remoto quando a identidade (empresa/membership/
// usuário) muda enquanto ele está aberto (logout, troca de empresa,
// transferência, suspensão) — nenhum draft da identidade antiga sobrevive
// à troca (decisão §16 do E4-B2).
function useCloseOnIdentityChange(identityKey: string | null, close: () => void) {
  const ref = useRef<string | null | 'unset'>('unset');
  useEffect(() => {
    if (ref.current === 'unset') { ref.current = identityKey; return; }
    if (ref.current !== identityKey) { close(); return; }
    ref.current = identityKey;
  }, [identityKey, close]);
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
      <Icon name="alert" size={18} stroke={2.2} style={{ color: 'var(--red, #FF3B3B)' }} />
      <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{children}</span>
    </div>
  );
}

// Aviso de duplicidade + confirmação explícita — nunca dispara a mutation
// sozinho; "confirmLabel" (Criar/Salvar mesmo assim) é a única forma de
// prosseguir quando há accessible/restricted/erro no check.
function DuplicateWarningPanel({ rows, checkFailed, onConfirm, confirmLabel, busy }: {
  rows: readonly RemoteLeadDuplicateRow[]; checkFailed: boolean; onConfirm: () => void; confirmLabel: string; busy: boolean;
}) {
  const accessible = rows.filter((r) => r.status === 'accessible');
  const hasRestricted = rows.some((r) => r.status === 'restricted');
  return (
    <FPanel style={{ marginTop: 16, border: '1px solid var(--amber-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="alert" size={18} stroke={2.2} style={{ color: 'var(--amber)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-900)' }}>
          {checkFailed ? 'Não foi possível verificar se este telefone já está cadastrado.' : 'Telefone já cadastrado'}
        </span>
      </div>
      {accessible.length > 0 && (
        <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
          {accessible.map((r) => (
            <li key={r.lead_id} style={{ fontSize: 13, color: 'var(--t-700)' }}>{r.lead_name}{r.lead_archived ? ' (arquivado)' : ''}</li>
          ))}
        </ul>
      )}
      {hasRestricted && (
        <div style={{ fontSize: 13, color: 'var(--t-700)', marginBottom: 10 }}>
          Já existe um Lead com este telefone, mas você não possui acesso aos detalhes.
        </div>
      )}
      <LBtn kind="gold" size="sm" icon="check" onClick={onConfirm} style={{ opacity: busy ? 0.5 : 1 }}>{confirmLabel}</LBtn>
    </FPanel>
  );
}

function isValidLeadPhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 8;
}

// ── FlowNovoCliente — router sem hooks próprios (mesmo molde de
// ScreenClientes/ScreenAndamento em ScreensOps.tsx: a escolha é de QUAL
// componente montar, nunca de qual hook chamar dentro do MESMO componente) ─

export function FlowNovoCliente({ payload, close, openFlow }: any) {
  const user = AuthService.getCurrentUser();
  const ctx = resolveLeadFlowContext(user);
  if (ctx.dataSource === 'remote') {
    return <FlowNovoClienteRemote close={close} openFlow={openFlow} ctx={ctx} />;
  }
  return <FlowNovoClienteLocal close={close} openFlow={openFlow} />;
}

// ── Caminho LOCAL: corpo original, intacto (só o import do picker mudou de
// nome — SellerPicker passou a ser o presentacional remoto) ──────────────
function FlowNovoClienteLocal({ close, openFlow }: any) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ nome: '', tel: '', origem: 'Showroom', car: '', pay: 'Financiamento', urg: 'Quente' });
  const set = (k: string, v: any) => setF(s => ({ ...s, [k]: v }));
  const user = AuthService.getCurrentUser();
  const isSeller = user?.activeMembership?.role === 'seller';
  const allSellers = SellerService.getAll();
  // A seller's own leads are always theirs; a manager/admin has no sellerId of
  // their own and must pick who the lead actually belongs to — never fall
  // back to the acting manager (same product rule as FlowRegistrarVenda).
  const [assignedSellerId, setAssignedSellerId] = useState<string | null>(isSeller ? (user?.activeMembership?.sellerId ?? null) : null);
  const finalSellerId = isSeller ? (user?.activeMembership?.sellerId ?? null) : assignedSellerId;
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
      leadId: newLeadId,
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
              <LocalSellerPicker value={finalSeller} onPick={(s: any) => setAssignedSellerId(s.id)} />
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

// ── Caminho REMOTO: Manager (assignable Sellers, "Sem vendedor" incluído)
// e Seller (sem picker, backend autoatribui) — campos aceitos por
// create_lead apenas: nome, telefone, veículo, temperatura, pagamento,
// origem, sellerId (só Manager). Nunca Stage/valor/notas/urgência/
// arquivado/companyId/expectedVersion. ──────────────────────────────────
function FlowNovoClienteRemote({ close, openFlow, ctx }: { close: () => void; openFlow: (id: string, payload?: any) => void; ctx: LeadFlowContext }) {
  const isSeller = ctx.membershipRole === 'seller';
  const identityKey = ctx.userId && ctx.companyId ? `${ctx.userId}:${ctx.companyId}` : null;
  useCloseOnIdentityChange(identityKey, close);

  const [f, setF] = useState({ nome: '', tel: '', origem: 'Showroom', car: '', pay: 'Financiamento', urg: 'Quente' });
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string } | null>(null);
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));

  const assignableSellers = useCurrentCompanyAssignableSellers({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });
  const duplicateCheck = useCheckLeadPhoneDuplicate({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });
  const duplicateGuard = useLeadDuplicateGuard({
    phone: f.tel,
    isPhoneValid: isValidLeadPhone(f.tel),
    enabled: ctx.capabilities.canCreate,
    identityKey,
    duplicateCheck,
  });
  const createLeadHook = useCreateLead({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });

  if (!ctx.capabilities.canCreate) {
    return (
      <FlowShell eyebrow="NOVO ATENDIMENTO" title="Novo cliente" icon="users" accent="#E8CE72" onClose={close}>
        <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
          Você não tem permissão para criar clientes no momento.
        </div>
      </FlowShell>
    );
  }

  if (created) {
    const lead = { id: created.id, name: f.nome || 'Novo cliente' };
    return (
      <FlowShell eyebrow="NOVO ATENDIMENTO" title="Cliente criado" icon="users" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Cliente criado!" sub={`${f.nome} entrou na sua carteira.`}
          actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
      </FlowShell>
    );
  }

  const canSubmitBasic = Boolean(f.nome.trim() && f.tel.trim()) && !submitting && duplicateGuard.status !== 'checking';

  async function performCreate() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const input: CreateLeadCallInput = isSeller
        ? { actorRole: 'seller', name: f.nome, phone: f.tel, car: f.car || CARS[0], temperature: TEMP_MAP[f.urg], paymentPreference: f.pay, source: f.origem }
        : { actorRole: 'manager', sellerId, name: f.nome, phone: f.tel, car: f.car || CARS[0], temperature: TEMP_MAP[f.urg], paymentPreference: f.pay, source: f.origem };
      const record = await createLeadHook.createLead(input);
      // M1-E E7-C — achado de auditoria: esta função chamava TaskService
      // .create(...) após o create_lead remoto, mas TaskService (lib/
      // services.ts) tem assertLocalCommercialDataAllowed desde o E5-B2-A1
      // — SEMPRE lança em modo remoto. O Lead já tinha sido criado com
      // sucesso no banco, mas essa chamada local lançava e o catch abaixo
      // reportava falha ao usuário (que via um erro genérico mesmo com o
      // Lead já existindo), sem nenhuma Task realmente criada. Tarefas
      // locais não têm company_id/backend remoto (E5-B2-A0/A1) — não é
      // possível "corrigir" criando uma Task remota sem uma etapa de
      // backend nova, então esta chamada é removida do caminho remoto
      // (o caminho local, FlowNovoClienteLocal, continua criando a Task
      // normalmente).
      setCreated({ id: record.id });
    } catch (err) {
      const code = isRemoteLeadsError(err) ? err.code : undefined;
      if (code === 'remote_leads_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(remoteLeadErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateClick() {
    if (!canSubmitBasic) return;
    const verification = await duplicateGuard.verifyBeforeSubmit();
    if (verification === 'proceed') await performCreate();
  }

  function handleConfirmAndCreate() {
    duplicateGuard.confirm();
    void performCreate();
  }

  return (
    <FlowShell eyebrow="NOVO ATENDIMENTO" title="Novo cliente" icon="users" accent="#E8CE72" onClose={close}
      sub="Cadastre um novo cliente. Os dados são salvos diretamente na sua empresa."
      footer={<>
        <div style={{ flex: 1 }} />
        <LBtn kind="gold" size="lg" icon="check" onClick={handleCreateClick} style={{ opacity: canSubmitBasic ? 1 : .5 }}>
          {submitting ? 'Criando…' : 'Criar cliente'}
        </LBtn>
      </>}>
      <div style={{ maxWidth: 720 }}>
        <FPanel>
          <FField label="Nome do cliente" icon="user" placeholder="Ex.: Carlos Andrade" value={f.nome} onChange={(e: any) => set('nome', e.target.value)} />
          <FField label="Telefone / WhatsApp" icon="phone" placeholder="(11) 90000-0000" value={f.tel} onChange={(e: any) => set('tel', e.target.value)} />
          {!isSeller && (
            <div style={{ marginBottom: 14 }}>
              <SellerPicker
                items={(assignableSellers.assignableSellers as readonly { seller_id: string; name: string }[]).map((s) => ({ id: s.seller_id, name: s.name }))}
                value={sellerId}
                onChange={setSellerId}
                loading={assignableSellers.isLoading}
                error={assignableSellers.isError ? 'Não foi possível carregar os vendedores.' : null}
              />
            </div>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '6px 0 9px' }}>Como ele chegou até você?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {ORIGINS.map(([o, ic]) => <ChoiceTile key={o} icon={ic} title={o} active={f.origem === o} onClick={() => set('origem', o)} />)}
          </div>
        </FPanel>
        <FPanel style={{ marginTop: 16 }}>
          <FField label="Veículo de interesse" icon="car" placeholder="Ex.: Corolla XEI 2023, Compass Longitude, Hilux SRX…" value={f.car} onChange={(e: any) => set('car', e.target.value)} hint="Digite o modelo e versão que o cliente procura." />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '8px 0 9px' }}>Forma de pagamento</div>
          <div style={{ marginBottom: 18 }}><Segmented options={PAYS.map(p => p[0])} value={f.pay} onChange={v => set('pay', v)} /></div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 2 }}>Temperatura do lead</div>
          <Segmented options={['Quente', 'Morno', 'Frio']} value={f.urg} onChange={v => set('urg', v)} accent="#FF6B3B" />
          <div style={{ fontSize: 12, color: 'var(--t-500)', marginTop: 9, lineHeight: 1.5 }}>{TEMP_INFO[f.urg]}</div>
        </FPanel>
        {duplicateGuard.needsConfirmation && (
          <DuplicateWarningPanel
            rows={duplicateGuard.rows}
            checkFailed={duplicateGuard.status === 'error'}
            onConfirm={handleConfirmAndCreate}
            confirmLabel="Criar mesmo assim"
            busy={submitting}
          />
        )}
        {submitError && <ErrorBanner>{submitError}</ErrorBanner>}
      </div>
    </FlowShell>
  );
}

// ── FlowEditarCliente — mesmo molde de router sem hooks próprios ─────────

export function FlowEditarCliente({ payload, close }: any) {
  const user = AuthService.getCurrentUser();
  const ctx = resolveLeadFlowContext(user);
  if (ctx.dataSource === 'remote') {
    return <FlowEditarClienteRemote payload={payload} close={close} ctx={ctx} />;
  }
  return <FlowEditarClienteLocal payload={payload} close={close} />;
}

// ── Caminho LOCAL: corpo original, intacto ───────────────────────────────
function FlowEditarClienteLocal({ payload, close }: any) {
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

// ── Caminho REMOTO: nome, telefone, veículo, temperatura, pagamento,
// origem — Stage/Seller/valor/notas/urgência/arquivamento OCULTOS (não
// apenas desabilitados). expectedVersion vem de lead.version (LeadModel,
// sempre presente desde a leitura remota — auditado nesta etapa). ────────
function FlowEditarClienteRemote({ payload, close, ctx }: { payload: any; close: () => void; ctx: LeadFlowContext }) {
  const lead = payload.lead || {};
  const identityKey = ctx.userId && ctx.companyId ? `${ctx.userId}:${ctx.companyId}` : null;
  useCloseOnIdentityChange(identityKey, close);

  const [f, setF] = useState({
    nome: lead.name || '', tel: lead.phone || '', car: lead.car || CARS[0],
    pay: lead.pay || 'Financiamento', urg: lead.temperature === 'hot' ? 'Quente' : lead.temperature === 'cold' ? 'Frio' : 'Morno',
    origem: lead.origem || 'Showroom',
  });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const duplicateCheck = useCheckLeadPhoneDuplicate({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });
  const duplicateGuard = useLeadDuplicateGuard({
    phone: f.tel,
    isPhoneValid: isValidLeadPhone(f.tel),
    excludeLeadId: lead.id,
    enabled: ctx.capabilities.canEditDetails,
    identityKey,
    duplicateCheck,
  });
  const updateLeadHook = useUpdateLead({
    userId: ctx.userId, companyId: ctx.companyId, membershipRole: ctx.membershipRole, userIsActive: ctx.userIsActive,
  });

  if (!ctx.capabilities.canEditDetails) {
    return (
      <FlowShell eyebrow="EDITAR CLIENTE" title="Editar cliente" icon="edit" accent="#E8CE72" onClose={close}>
        <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
          Você não tem permissão para editar este cliente no momento.
        </div>
      </FlowShell>
    );
  }

  if (done) return (
    <FlowShell eyebrow="EDITAR CLIENTE" title="Dados atualizados" icon="edit" accent="#27C75F" onClose={close}>
      <FlowSuccess title="Dados salvos com sucesso" sub={`As informações de ${f.nome} foram atualizadas.`} actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );

  const canSubmitBasic = Boolean(f.nome.trim() && f.tel.trim() && lead.id && typeof lead.version === 'number') && !submitting && duplicateGuard.status !== 'checking';

  async function performUpdate() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await updateLeadHook.updateLead({
        leadId: lead.id,
        expectedVersion: lead.version,
        name: f.nome,
        phone: f.tel,
        car: f.car || CARS[0],
        temperature: TEMP_MAP[f.urg],
        paymentPreference: f.pay,
        source: f.origem,
      });
      setDone(true);
    } catch (err) {
      const code = isRemoteLeadsError(err) ? err.code : undefined;
      if (code === 'remote_leads_mutation_identity_changed') {
        close();
        return;
      }
      // stale_write: mantém o formulário aberto com os dados digitados,
      // nunca repete a mutation sozinho (mensagem já cobre "recarregue").
      setSubmitError(remoteLeadErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveClick() {
    if (!canSubmitBasic) return;
    const verification = await duplicateGuard.verifyBeforeSubmit();
    if (verification === 'proceed') await performUpdate();
  }

  function handleConfirmAndSave() {
    duplicateGuard.confirm();
    void performUpdate();
  }

  return (
    <FlowShell eyebrow="EDITAR CLIENTE" title={`Atualizar ${(lead.name || '').split(' ')[0]}`} icon="edit" accent="#E8CE72" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="ghost" size="lg" onClick={close}>Cancelar</LBtn>
        <LBtn kind="gold" size="lg" icon="check" onClick={handleSaveClick} style={{ opacity: canSubmitBasic ? 1 : .5 }}>
          {submitting ? 'Salvando…' : 'Salvar alterações'}
        </LBtn></>}>
      <div style={{ maxWidth: 720 }}>
        <FPanel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FField label="Nome" icon="user" value={f.nome} onChange={(e: any) => set('nome', e.target.value)} />
            <FField label="Telefone" icon="phone" value={f.tel} onChange={(e: any) => set('tel', e.target.value)} />
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '4px 0 9px' }}>Veículo de interesse</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 18 }}>
            {(lead.car ? [lead.car, ...CARS.filter((c: string) => c !== lead.car)] : CARS).slice(0, 4).map((c: string) => <ChoiceTile key={c} icon="car" title={c} active={f.car === c} onClick={() => set('car', c)} />)}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '8px 0 9px' }}>Forma de pagamento</div>
          <div style={{ marginBottom: 18 }}><Segmented options={PAYS.map(p => p[0])} value={f.pay} onChange={(v: string) => set('pay', v)} /></div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '8px 0 9px' }}>Como ele chegou até você?</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
            {ORIGINS.map(([o, ic]) => <ChoiceTile key={o} icon={ic} title={o} active={f.origem === o} onClick={() => set('origem', o)} />)}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 2 }}>Temperatura do lead</div>
          <Segmented options={['Quente', 'Morno', 'Frio']} value={f.urg} onChange={(v: string) => set('urg', v)} accent="#FF6B3B" />
        </FPanel>
        {duplicateGuard.needsConfirmation && (
          <DuplicateWarningPanel
            rows={duplicateGuard.rows}
            checkFailed={duplicateGuard.status === 'error'}
            onConfirm={handleConfirmAndSave}
            confirmLabel="Salvar mesmo assim"
            busy={submitting}
          />
        )}
        {submitError && <ErrorBanner>{submitError}</ErrorBanner>}
      </div>
    </FlowShell>
  );
}

// COMMERCIAL-REMOTE-VISITS-B4 — mensagens sanitizadas fixas da criação
// remota de Visit, mesmo modelo de remoteTaskCreateErrorMessage (acima) —
// helper próprio deste flow, não compartilhado (mesma convenção). Cobre
// exatamente os códigos que create_visit pode produzir (migration #52,
// comentário "Erros estáveis" da função): forbidden, seller_required,
// seller_not_found, lead_not_found, lead_archived, client_name_required,
// invalid_vehicles. identity_changed nunca chega aqui — tratado antes, no
// catch do handler (fecha o flow, mesmo padrão de FlowNovaPendencia).
function remoteVisitCreateErrorMessage(error: unknown): string {
  const code = isRemoteVisitsError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_visits_mutation_forbidden':
      return 'Você não tem permissão para agendar esta visita.';
    case 'remote_visits_mutation_seller_required':
      return 'Selecione um vendedor responsável.';
    case 'remote_visits_mutation_seller_not_found':
      return 'O vendedor selecionado não está mais disponível.';
    case 'remote_visits_mutation_lead_not_found':
      return 'O cliente selecionado não está mais disponível.';
    case 'remote_visits_mutation_lead_archived':
      return 'Não é possível agendar uma nova visita para um cliente arquivado.';
    case 'remote_visits_mutation_client_name_required':
      return 'Informe o nome do cliente.';
    case 'remote_visits_mutation_invalid_vehicles':
      return 'Informe pelo menos um veículo válido.';
    default:
      return 'Não foi possível agendar a visita. Tente novamente.';
  }
}

// COMMERCIAL-REMOTE-VISITS-B4 — mesmo padrão de resolveRemoteDueAt (Tasks,
// mais abaixo neste arquivo): Hoje/Amanhã derivam a DATA do calendário
// local REAL (nunca strings hardcoded tipo 'Qui 18'/'Sex 19'/'Sáb 20', que
// é o que o branch local ainda usa — intocado, só o branch remoto evita
// essas strings falsas), Personalizado usa a data escolhida pelo usuário.
// combineLocalDateAndTimeToIso continua a única autoridade de parsing —
// nenhum parser duplicado. Reimplementado aqui (não compartilhado com
// Tasks nem com resolveRemoteDueAt) — único consumidor é FlowCriarVisita,
// mesmo raciocínio que manteve resolveRemoteDueAt privado até ganhar um
// segundo consumidor real (nunca compartilhar antecipadamente).
function resolveRemoteVisitScheduledAt(when: string, customDate: string, time: string, now: Date = new Date()) {
  const todayYMD = localYMD(now);
  const tomorrowYMD = localYMD(addLocalDays(now, 1));
  const dateForWhen = when === 'Hoje' ? todayYMD : when === 'Amanhã' ? tomorrowYMD : customDate;
  const result = combineLocalDateAndTimeToIso({ date: dateForWhen, time });
  // Regra do B4-PRECHECK §9/§24: comparação por INSTANTE real (nunca
  // string), client-side apenas — create_visit (migration #52) não valida
  // isso no backend, decisão consciente de não alterar a migration neste
  // lote (mesma lacuna já existe no branch local, que nunca validou isto).
  const isPast = result.ok && new Date(result.iso).getTime() < now.getTime();
  return { todayYMD, tomorrowYMD, result, isPast };
}

// COMMERCIAL-REMOTE-VISITS-B4 — cutover de CREATE. `visitDataSource`
// decide local/remoto do mesmo jeito que `taskDataSource` em
// FlowNovaPendencia (resolveVisitRemoteMode(), nunca fallback local sob
// modo remoto). O branch local abaixo é BYTE-IDÊNTICO ao código anterior a
// este lote (só movido para dentro de `if (visitDataSource === 'local')
// return (...)`) — nenhuma linha do caminho local foi reescrita.
//
// Entry points remotos (B4-PRECHECK §3): hoje só o botão "Agendar visita"
// de ScreenVisitas abre este flow em modo remoto, sempre sem payload.lead
// (LeadCard/FlowVerCliente continuam atrás de capabilities.canApplyEvents,
// sempre false, fora de escopo aqui) — por isso o branch remoto nunca lê
// payload.lead; a vinculação a um Lead acontece inteiramente DENTRO do
// formulário via RemoteLeadPicker (B4-PRECHECK-R1 §1-3), nunca por prop.
export function FlowCriarVisita({ payload, close, openFlow }: any) {
  const visitDataSource: 'local' | 'remote' = resolveVisitRemoteMode() === 'visit_local' ? 'local' : 'remote';

  // ── Estado do branch LOCAL — intocado ────────────────────────────────
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
      sellerId: lead?.sellerId ?? user?.activeMembership?.sellerId ?? null,
      leadId: lead?.id ?? null,
      note: note.trim() || undefined,
    });
    if (lead?.id) {
      LeadService.addToTimeline(lead.id, { icon: 'calendar', c: '#E8CE72', t: 'Visita agendada', d: `${finalDay} às ${finalTime}` });
      LeadService.updateHealth(lead.id, { type: 'visit_scheduled', hasDate: !!finalDay, hasTime: !!finalTime });
    }
    setDone(true);
  };

  // ── Estado do branch REMOTO ───────────────────────────────────────────
  // Hooks/identidade chamados SEMPRE, na mesma ordem (Rules of Hooks) —
  // em modo local eles simplesmente nunca são exercitados via submit.
  const user = AuthService.getCurrentUser();
  const isSeller = user?.activeMembership?.role === 'seller';
  const identityUserId = user?.id ?? null;
  const identityCompanyId = user?.activeMembership?.companyId ?? null;
  const identityMembershipRole = user?.activeMembership?.role ?? null;
  const identityUserIsActive = Boolean(user);
  const identityKey = identityUserId && identityCompanyId ? `${identityUserId}:${identityCompanyId}` : null;

  const remoteLeadsScreen = useRemoteLeadsScreenState(user);
  const assignableSellers = useCurrentCompanyAssignableSellers({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  const createHook = useCreateVisit({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  useCloseOnIdentityChange(identityKey, close);

  const [remoteSelectedLead, setRemoteSelectedLead] = useState<LeadModel | null>(null);
  const [remoteClient, setRemoteClient] = useState('');
  const [remoteVehicles, setRemoteVehicles] = useState<string[]>([]);
  const [remoteCustomCar, setRemoteCustomCar] = useState('');
  const [remoteWhen, setRemoteWhen] = useState('Amanhã');
  const [remoteCustomDate, setRemoteCustomDate] = useState('');
  const [remoteTime, setRemoteTime] = useState('');
  const [remoteCustomTime, setRemoteCustomTime] = useState('');
  const [remoteNote, setRemoteNote] = useState('');
  const [remoteAssignedSellerId, setRemoteAssignedSellerId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const remoteSellerItems: SellerPickerItem[] = assignableSellers.assignableSellers.map((s) => ({ id: s.seller_id, name: s.name }));

  // B4-PRECHECK-R1 §5-§7/§13-§15: selecionar um Lead pré-preenche veículo
  // (mesmo comportamento do pickLead local) e recalcula o default de
  // Seller a cada troca — mesmo Lead sem seller assignable limpa a
  // seleção, forçando escolha explícita. Limpar o Lead NUNCA reseta o
  // Seller já escolhido (standalone Manager também exige Seller — não há
  // "vazio" mais correto para onde voltar).
  const pickRemoteLead = (l: LeadModel) => {
    setRemoteSelectedLead(l);
    setRemoteClient(l.name);
    if (l.car) setRemoteVehicles([l.car]);
    setRemoteCustomCar('');
    if (!isSeller) {
      const leadSellerAssignable = l.sellerId !== null
        && assignableSellers.assignableSellers.some((s) => s.seller_id === l.sellerId);
      setRemoteAssignedSellerId(leadSellerAssignable ? l.sellerId : null);
    }
  };
  const clearRemoteLead = () => { setRemoteSelectedLead(null); setRemoteClient(''); setRemoteVehicles([]); };

  const toggleRemoteVehicle = (c: string) => {
    setRemoteVehicles(vs => vs.includes(c) ? vs.filter(v => v !== c) : [...vs, c]);
  };

  const remoteFinalTime = remoteCustomTime.trim() || remoteTime;
  const remoteScheduled = resolveRemoteVisitScheduledAt(remoteWhen, remoteCustomDate, remoteFinalTime);
  const remoteFinalVehiclesRaw = remoteCustomCar.trim() ? [...remoteVehicles, remoteCustomCar.trim()] : remoteVehicles;
  const remoteFinalVehicles = remoteFinalVehiclesRaw.map((v) => v.trim()).filter((v) => v !== '');
  const remoteClientNameTrimmed = remoteClient.trim();
  const remoteSellerOk = isSeller || (remoteAssignedSellerId !== null && !assignableSellers.isLoading);
  const remoteLeadOrClientOk = remoteSelectedLead !== null || remoteClientNameTrimmed !== '';
  const canCreateRemote = Boolean(
    remoteScheduled.result.ok
    && !remoteScheduled.isPast
    && remoteFinalVehicles.length > 0
    && remoteLeadOrClientOk
    && remoteSellerOk
    && !submitting
    && !createHook.isPending,
  );

  const handleScheduleRemote = async () => {
    if (!canCreateRemote || submitting || createHook.isPending || !remoteScheduled.result.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const commonFields = {
        scheduledAt: remoteScheduled.result.iso,
        vehicles: remoteFinalVehicles,
        leadId: remoteSelectedLead?.id ?? null,
        // clientName nunca é autoridade quando leadId existe (B4-PRECHECK-
        // R1 §8/§9) — RPC descarta p_client_name nesse caso de qualquer
        // forma (migration #52, linha do insert), omitido aqui só para
        // não sugerir que teria efeito.
        clientName: remoteSelectedLead ? undefined : remoteClientNameTrimmed,
        note: remoteNote.trim(),
      };
      if (isSeller) {
        await createHook.createVisit({ ...commonFields, actorRole: 'seller' });
      } else {
        if (!remoteAssignedSellerId) return;
        await createHook.createVisit({ ...commonFields, actorRole: 'manager', assignedSellerId: remoteAssignedSellerId });
      }
      setDone(true);
    } catch (err) {
      // Mesmo padrão de FlowNovaPendencia: identity_changed fecha o flow
      // diretamente, nunca mostra o erro da sessão antiga.
      if (isRemoteVisitsError(err) && err.code === 'remote_visits_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(remoteVisitCreateErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    // Branch LOCAL — byte-idêntico ao original, apenas movido para dentro
    // deste `if`.
    if (visitDataSource === 'local') return (
      <FlowShell eyebrow="AGENDAR VISITA" title="Visita agendada" icon="calendar" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Visita agendada!" sub={`${client} · ${finalDay} às ${finalTime}. Enviamos um lembrete e criamos uma pendência para confirmar a presença.`}
            actions={<><LBtn kind="gold" size="lg" icon="message" onClick={() => openFlow('enviar-mensagem', { name: client })}>Enviar confirmação</LBtn><LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn></>} />
      </FlowShell>
    );
    const doneClientName = remoteSelectedLead ? remoteSelectedLead.name : remoteClient;
    const doneWhenLabel = `${remoteWhen === 'Personalizado' ? remoteCustomDate : remoteWhen} às ${remoteFinalTime}`;
    return (
      <FlowShell eyebrow="AGENDAR VISITA" title="Visita agendada" icon="calendar" accent="#27C75F" onClose={close}>
        <FlowSuccess title="Visita agendada!" sub={`${doneClientName} · ${doneWhenLabel}.`}
          actions={<LBtn kind="ghost" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
      </FlowShell>
    );
  }

  if (visitDataSource === 'local') return (
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

  // ── Branch REMOTO ─────────────────────────────────────────────────────
  return (
    <FlowShell eyebrow="AGENDAR VISITA" title="Agendar uma visita" icon="calendar" accent="#E8CE72" onClose={close}
      sub="Escolha o dia e o horário. Visita confirmada é o passo que mais aproxima da venda."
      footer={<>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--t-500)' }}>
          {remoteScheduled.isPast
            ? 'Escolha uma data e horário futuros'
            : canCreateRemote
              ? `${remoteWhen === 'Personalizado' ? remoteCustomDate : remoteWhen} às ${remoteFinalTime}`
              : 'Selecione cliente, veículo, data e horário'}
        </span>
        <LBtn kind="gold" size="lg" icon="check" onClick={handleScheduleRemote} style={{ opacity: canCreateRemote ? 1 : .5 }}>
          {(submitting || createHook.isPending) ? 'Agendando…' : 'Agendar visita'}
        </LBtn>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start', maxWidth: 900 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {remoteSelectedLead ? (
            <div>
              <ClientChip lead={remoteSelectedLead} size="lg" />
              <button onClick={clearRemoteLead} style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, color: 'var(--t-500)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Trocar cliente</button>
            </div>
          ) : (
            <FPanel>
              <RemoteLeadPicker
                items={remoteLeadsScreen.leads.leads}
                value={remoteClient}
                onChange={setRemoteClient}
                onPick={pickRemoteLead}
                loading={remoteLeadsScreen.leads.isLoading}
                error={remoteLeadsScreen.leads.isError ? 'Não foi possível carregar os clientes.' : null}
                placeholder="Buscar cliente existente ou digitar o nome de um cliente avulso..."
              />
            </FPanel>
          )}
          <FPanel title="Veículo(s) de interesse" icon="car" accent="#E8CE72">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {(remoteSelectedLead?.car ? [remoteSelectedLead.car, ...CARS.filter((c: string) => c !== remoteSelectedLead.car)] : CARS).slice(0, 4).map((c: string) => <ChoiceTile key={c} icon="car" title={c} active={remoteVehicles.includes(c)} onClick={() => toggleRemoteVehicle(c)} />)}
            </div>
            <div style={{ marginTop: 14 }}>
              <FField label="Outro veículo (opcional)" icon="edit" placeholder="Cliente também quer ver..." value={remoteCustomCar} onChange={(e: any) => setRemoteCustomCar(e.target.value)} />
            </div>
          </FPanel>
          {!isSeller && (
            <FPanel>
              <SellerPicker
                items={remoteSellerItems}
                value={remoteAssignedSellerId}
                onChange={setRemoteAssignedSellerId}
                loading={assignableSellers.isLoading}
                disabled={submitting || createHook.isPending}
                error={assignableSellers.isError ? 'Não foi possível carregar os vendedores.' : null}
                allowNone={false}
                placeholder="Selecione o vendedor…"
              />
            </FPanel>
          )}
          <FPanel title="Observações (opcional)" icon="clipboard" accent="#E8CE72">
            <FArea placeholder="Ex.: cliente quer ver Golf e Civic, levar simulação de financiamento, vem com esposa..." value={remoteNote} onChange={(e: any) => setRemoteNote(e.target.value)} />
          </FPanel>
        </div>
        <FPanel title="Dia e horário" icon="calendar" accent="#E8CE72">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {['Hoje', 'Amanhã', 'Personalizado'].map(d => <button key={d} onClick={() => setRemoteWhen(d)} className="lift" style={{ flex: '1 1 100px', padding: '14px 8px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${remoteWhen === d ? 'rgba(212,175,55,.6)' : 'var(--border)'}`, background: remoteWhen === d ? 'var(--gold-bg)' : 'rgba(255,255,255,.03)', color: remoteWhen === d ? 'var(--gold-ink)' : 'var(--t-700)', fontWeight: 700, fontSize: 13.5 }}>{d}</button>)}
          </div>
          {remoteWhen === 'Personalizado' && (
            <FField label="Data" icon="calendar" type="date" value={remoteCustomDate} onChange={(e: any) => setRemoteCustomDate(e.target.value)} min={remoteScheduled.todayYMD} />
          )}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '4px 0 9px' }}>Horário disponível</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
            {slots.map(s => <button key={s} onClick={() => { setRemoteTime(s); setRemoteCustomTime(''); }} className="lift" style={{ padding: '14px 8px', borderRadius: 12, cursor: 'pointer', fontFamily: 'Archivo, sans-serif', border: `1px solid ${!remoteCustomTime && remoteTime === s ? 'rgba(212,175,55,.6)' : 'var(--border)'}`, background: !remoteCustomTime && remoteTime === s ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'rgba(255,255,255,.03)', color: !remoteCustomTime && remoteTime === s ? '#241c04' : 'var(--t-700)', fontWeight: 800, fontSize: 16 }}>{s}</button>)}
          </div>
          <FField label="Outro horário (opcional)" icon="clock" type="time" value={remoteCustomTime} onChange={(e: any) => setRemoteCustomTime(e.target.value)} />
          {remoteScheduled.isPast && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--amber)' }}>Escolha uma data e horário futuros.</div>}
        </FPanel>
      </div>
      {submitError && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
          <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
        </div>
      )}
    </FlowShell>
  );
}

// COMMERCIAL-REMOTE-VISITS-B5 — reagendamento remoto de uma Visit
// EXISTENTE (mesma row, mesmo id, nunca cria uma segunda Visit). Flow
// NOVO, REMOTE-ONLY (B5-PRECHECK §3/§24-25): o reagendamento local
// continua inteiramente dentro do tile "Remarcar" de FlowConfirmarVisita
// (abaixo, intocado) — marca a Visit antiga como RESCHEDULED e reabre
// 'criar-visita' do zero, mesmo comportamento de sempre, este flow nunca
// é chamado a partir dali.
//
// Escopo editável: SOMENTE data/hora (B5-PRECHECK §5) — vehicles/note/
// assignedSellerId são sempre reenviados EXATAMENTE como já estão na
// Visit (update_visit é full-replace no banco, mas a UI não expõe esses
// campos aqui: não existe precedente local de editá-los durante
// "Remarcar", e FlowReagendarPendencia — o precedente real mais próximo —
// segue a mesma disciplina para Tasks, sem Seller picker e sem editar
// title/note/priority). Seller enviado sempre = visit.assignedSellerId,
// nunca alterado — confirmado contra a RPC (migration #52, update_visit):
// reenviar o valor atual sem mudança nunca aciona a checagem de Seller
// ativo/assignable, então um Seller histórico inativo nunca bloqueia o
// reagendamento (B5-PRECHECK §15/§20).
export function FlowReagendarVisita({ payload, close }: any) {
  const visit: RemoteVisitModel | undefined = payload.visit;
  const slots = ['09:00', '10:30', '14:00', '15:30', '17:00', '18:30'];

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // REOPEN REQUIRED (mesmo padrão de FlowReagendarPendencia): true após
  // qualquer erro que não seja generic_error — bloqueia novos submits
  // NESTA instância do flow (retry com o mesmo expectedVersion nunca
  // teria sucesso).
  const [blocked, setBlocked] = useState(false);

  const user = AuthService.getCurrentUser();
  const identityUserId = user?.id ?? null;
  const identityCompanyId = user?.activeMembership?.companyId ?? null;
  const identityMembershipRole = user?.activeMembership?.role ?? null;
  const identityUserIsActive = Boolean(user);
  const identityKey = identityUserId && identityCompanyId ? `${identityUserId}:${identityCompanyId}` : null;

  // Hooks SEMPRE chamados, incondicionalmente, antes de qualquer return
  // (inclusive o `!visit` abaixo) — Rules of Hooks.
  const updateHook = useUpdateVisit({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  useCloseOnIdentityChange(identityKey, close);

  // Prefill (B5-PRECHECK §7-9/§11-12): construído a partir do scheduledAt
  // ATUAL da Visit via componentes LOCAIS do Date (nunca getUTCHours/
  // getUTCDate) — tolerante a `visit` ausente (defaults neutros) só para
  // manter os hooks de estado abaixo sempre chamáveis; o guard `!visit`
  // real vem depois, após todos os hooks.
  const prefillDate = visit ? new Date(visit.scheduledAt) : null;
  const initialWhen = (() => {
    if (!prefillDate) return 'Amanhã';
    const now = new Date();
    const diffDays = Math.round(
      (startOfVisitLocalDay(prefillDate).getTime() - startOfVisitLocalDay(now).getTime()) / (24 * 60 * 60 * 1000),
    );
    if (diffDays === 0) return 'Hoje';
    if (diffDays === 1) return 'Amanhã';
    return 'Personalizado';
  })();
  const initialCustomDate = prefillDate
    ? `${prefillDate.getFullYear()}-${String(prefillDate.getMonth() + 1).padStart(2, '0')}-${String(prefillDate.getDate()).padStart(2, '0')}`
    : '';
  const initialTimeValue = prefillDate ? formatVisitTime(prefillDate) : '';
  const initialSlot = slots.includes(initialTimeValue) ? initialTimeValue : '';
  const initialCustomTime = prefillDate && !slots.includes(initialTimeValue) ? initialTimeValue : '';

  const [when, setWhen] = useState(initialWhen);
  const [customDate, setCustomDate] = useState(initialCustomDate);
  const [timeSlot, setTimeSlot] = useState(initialSlot);
  const [customTime, setCustomTime] = useState(initialCustomTime);

  if (!visit) return null;

  const currentScheduledAtDate = new Date(visit.scheduledAt);
  const finalTime = customTime.trim() || timeSlot;
  const scheduled = resolveRemoteVisitScheduledAt(when, customDate, finalTime);
  const hasRealChange = scheduled.result.ok
    && new Date(scheduled.result.iso).getTime() !== currentScheduledAtDate.getTime();

  const canSave = Boolean(
    scheduled.result.ok
    && !scheduled.isPast
    && hasRealChange
    && !submitting
    && !updateHook.isPending
    && !blocked,
  );

  const handleSave = async () => {
    if (!canSave || !scheduled.result.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await updateHook.updateVisit({
        visitId: visit.id,
        expectedVersion: visit.version,
        scheduledAt: scheduled.result.iso,
        vehicles: visit.vehicles,
        note: visit.note,
        assignedSellerId: visit.assignedSellerId,
      });
      close();
    } catch (err) {
      // Mesmo padrão de FlowReagendarPendencia/FlowNovaPendencia:
      // identity_changed fecha o flow diretamente, nunca mostra erro da
      // sessão antiga.
      if (isRemoteVisitsError(err) && err.code === 'remote_visits_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(remoteVisitUpdateErrorMessage(err));
      if (!isRemoteVisitUpdateRetryable(err)) setBlocked(true);
    } finally {
      setSubmitting(false);
    }
  };

  const currentLabel = `${formatVisitShortDate(currentScheduledAtDate)}, ${formatVisitTime(currentScheduledAtDate)}`;

  return (
    <FlowShell eyebrow="REAGENDAR VISITA" title="Remarcar visita" icon="refresh" accent="#3B82F6" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check"
        onClick={handleSave}
        style={{ opacity: canSave ? 1 : .5 }}>
        {(submitting || updateHook.isPending) ? 'Reagendando…' : 'Reagendar'}
      </LBtn></>}>
      <div style={{ maxWidth: 520 }}>
        <FPanel>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)', marginBottom: 4 }}>{visit.clientName}</div>
          <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginBottom: 16 }}>Atualmente: {currentLabel}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Nova data</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {['Hoje', 'Amanhã', 'Personalizado'].map(d => <button key={d} onClick={() => setWhen(d)} className="lift" style={{ flex: '1 1 100px', padding: '14px 8px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${when === d ? 'rgba(59,130,246,.6)' : 'var(--border)'}`, background: when === d ? 'rgba(59,130,246,.12)' : 'rgba(255,255,255,.03)', color: when === d ? '#3B82F6' : 'var(--t-700)', fontWeight: 700, fontSize: 13.5 }} disabled={blocked}>{d}</button>)}
          </div>
          {when === 'Personalizado' && (
            <FField label="Data" icon="calendar" type="date" value={customDate} onChange={(e: any) => setCustomDate(e.target.value)} min={scheduled.todayYMD} disabled={blocked} />
          )}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '4px 0 9px' }}>Horário disponível</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
            {slots.map(s => <button key={s} onClick={() => { setTimeSlot(s); setCustomTime(''); }} className="lift" style={{ padding: '14px 8px', borderRadius: 12, cursor: 'pointer', fontFamily: 'Archivo, sans-serif', border: `1px solid ${!customTime && timeSlot === s ? 'rgba(59,130,246,.6)' : 'var(--border)'}`, background: !customTime && timeSlot === s ? 'rgba(59,130,246,.16)' : 'rgba(255,255,255,.03)', color: !customTime && timeSlot === s ? '#3B82F6' : 'var(--t-700)', fontWeight: 800, fontSize: 16 }} disabled={blocked}>{s}</button>)}
          </div>
          <FField label="Outro horário" icon="clock" type="time" value={customTime} onChange={(e: any) => setCustomTime(e.target.value)} disabled={blocked} />
          {scheduled.isPast && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--amber)' }}>Escolha uma data e horário futuros.</div>}
          {scheduled.result.ok && !hasRealChange && !scheduled.isPast && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--t-500)' }}>Escolha uma nova data ou horário para reagendar.</div>
          )}
          {submitError && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
              <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
            </div>
          )}
        </FPanel>
      </div>
    </FlowShell>
  );
}

// Mensagens sanitizadas fixas do reagendamento remoto de Visit — mesmo
// modelo de remoteVisitCreateErrorMessage/remoteTaskUpdateErrorMessage
// (helper próprio deste flow, não compartilhado — mesma convenção usada
// em toda a série). Cobre exatamente os códigos reais de update_visit
// (migration #52, comentário "Erros estáveis" da função): forbidden,
// visit_not_found, visit_closed, seller_required, seller_not_found,
// invalid_vehicles, stale_write. identity_changed nunca chega aqui —
// tratado antes, no catch do handler.
function remoteVisitUpdateErrorMessage(error: unknown): string {
  const code = isRemoteVisitsError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_visits_mutation_forbidden':
      return 'Você não tem permissão para reagendar esta visita.';
    case 'remote_visits_mutation_visit_not_found':
      return 'Esta visita não está mais disponível.';
    case 'remote_visits_mutation_visit_closed':
      return 'Esta visita já foi encerrada.';
    case 'remote_visits_mutation_seller_required':
      return 'Esta visita está sem um vendedor responsável válido.';
    case 'remote_visits_mutation_seller_not_found':
      return 'O vendedor responsável desta visita não está mais disponível.';
    case 'remote_visits_mutation_invalid_vehicles':
      return 'Esta visita possui dados de veículo inválidos e precisa ser atualizada.';
    case 'remote_visits_mutation_stale_write':
      return 'Esta visita foi alterada. Os dados foram atualizados.';
    default:
      return 'Não foi possível reagendar a visita. Tente novamente.';
  }
}

// B5-PRECHECK §32: dentro deste flow o usuário não consegue corrigir
// permissão/veículo/seller — resubmeter com o MESMO payload depois de
// qualquer um desses erros sempre falharia de novo (stale_write em
// particular: expectedVersion ficaria definitivamente obsoleto). Único
// código genuinamente transitório é generic_error (ou qualquer erro não
// reconhecido) — só ele permite nova tentativa na mesma instância do
// flow; todos os outros exigem fechar e reabrir. Mesmo padrão exato de
// isRemoteTaskUpdateRetryable.
function isRemoteVisitUpdateRetryable(error: unknown): boolean {
  const code = isRemoteVisitsError(error) ? error.code : undefined;
  return code === undefined || code === 'remote_visits_mutation_generic_error';
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

  // Maps the visit outcome to a Lead Health Engine event — a registered result
  // must always move the lead's operational health, not just the Visit record,
  // or urgency/alert stay frozen at whatever they were before the visit
  // (Correção 3, M0-K4.1).
  const healthEventMap: Record<string, 'visit_result_done' | 'visit_result_thinking' | 'visit_result_no_interest'> = {
    vendeu: 'visit_result_done',
    negociando: 'visit_result_done',
    pensar: 'visit_result_thinking',
    sem: 'visit_result_no_interest',
  };

  const handleSave = () => {
    if (!outcome) return;
    const statusMap: Record<string, string> = { vendeu: VISIT_STATUS.DONE, negociando: VISIT_STATUS.DONE, pensar: VISIT_STATUS.DONE, sem: VISIT_STATUS.NO_INTEREST };
    VisitService.update(v.id, { status: statusMap[outcome] || VISIT_STATUS.DONE });
    if (v.leadId) {
      const o = opts.find(x => x.id === outcome)!;
      LeadService.addToTimeline(v.leadId, {
        icon: o.icon, c: o.accent === '#8B8B93' ? '#888' : o.accent, t: `Visita: ${o.title}`, d: note || undefined,
      });
      LeadService.updateHealth(v.leadId, { type: healthEventMap[outcome] });
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
      sellerId: lead.sellerId ?? user?.activeMembership?.sellerId ?? null,
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
  // Internal guard — never trust that the caller already hid the Aprovar/Recusar
  // buttons. A Seller reaching this flow by any path (deep link, notification,
  // stale UI) still can't decide; DealService.approve/reject re-check this too
  // (Correção 1, M0-K4.1).
  const canDecide = AuthService.isManager();

  if (!d) return null;

  if (!canDecide) {
    return (
      <FlowShell eyebrow="APROVAÇÃO DO GESTOR" title="Acesso restrito" icon="shield" accent="#FF3B3B" onClose={close}>
        <FlowSuccess icon="xCircle" accent="#FF3B3B" title="Apenas gestores decidem propostas"
          sub="Aprovar ou recusar uma proposta é uma ação exclusiva de gerente/admin. Peça para o seu gestor revisar esta proposta."
          actions={<LBtn kind="ghost" size="lg" icon="check" onClick={close}>Fechar</LBtn>} />
      </FlowShell>
    );
  }

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

// Only deals that could still legitimately be sold — a pending-approval or
// already-rejected proposal must never show up as sellable, and a SOLD one
// is excluded by construction (Correção 2, M0-K4.1).
function dealsForLead(leadId: string) {
  return DealService.getAll().filter((d: any) => d.leadId === leadId && (d.status === DEAL_STATUS.OPEN || d.status === DEAL_STATUS.APPROVED));
}
function bestDealFor(leadId: string) {
  const ds = dealsForLead(leadId);
  return ds.find((d: any) => d.status === DEAL_STATUS.APPROVED) || ds[0] || null;
}

export function FlowRegistrarVenda({ payload, close }: any) {
  const [lead, setLead] = useState<any>(payload.lead || null);
  const [deal, setDeal] = useState<any>(() => (payload.lead ? bestDealFor(payload.lead.id) : null));
  const [step, setStep] = useState(lead ? 'confirm' : 'pick');
  const [car, setCar] = useState(() => (deal ? deal.car : (lead ? lead.car : '')));
  const [customCar, setCustomCar] = useState('');
  const [client, setClient] = useState(lead ? lead.name : '');
  const [blocked, setBlocked] = useState(false);

  const user = AuthService.getCurrentUser();
  const isSeller = user?.activeMembership?.role === 'seller';
  const storeSellers = SellerService.getAll();
  // A seller's sale is always theirs. A manager/admin has no sellerId of
  // their own — the sale must be attributed to a real Seller, never to the
  // acting manager (that's the exact "Parabéns, Carlos" bug this fixes).
  // Pre-select the lead's own seller when one is picked; otherwise the
  // manager must choose — never silently falls back to currentUser.
  const [assignedSellerId, setAssignedSellerId] = useState<string | null>(
    isSeller ? (user?.activeMembership?.sellerId ?? null) : (deal?.sellerId ?? lead?.sellerId ?? null),
  );
  const finalSellerId = isSeller ? (user?.activeMembership?.sellerId ?? null) : assignedSellerId;
  const finalSeller = finalSellerId ? storeSellers.find((s: any) => s.id === finalSellerId) ?? null : null;

  const [doneSeller, setDoneSeller] = useState<any>(null);
  const [donePos, setDonePos] = useState<number>(-1);
  const [doneGap, setDoneGap] = useState<number>(0);

  const leadDeals = lead ? dealsForLead(lead.id) : [];
  // A lead can have only one active (non-canceled) sale — this drives the
  // button state proactively, SaleService.create is still the authoritative
  // guard if this check misses anything (Correção 1, M0-K4.2).
  const existingActiveSale = lead
    ? SaleService.getAll().find((s: any) => s.leadId === lead.id && s.status !== SALE_STATUS.CANCELED)
    : null;

  const pickLead = (l: any) => {
    setLead(l);
    setClient(l.name);
    const best = bestDealFor(l.id);
    setDeal(best);
    setCar(best ? best.car : l.car);
    setCustomCar('');
    setBlocked(false);
    if (!isSeller) setAssignedSellerId(best?.sellerId ?? l.sellerId ?? null);
  };

  const clearLead = () => {
    setLead(null);
    setDeal(null);
    setClient('');
    setCar('');
    setCustomCar('');
    setBlocked(false);
    if (!isSeller) setAssignedSellerId(null);
  };

  // Lead → Deal → Sale: picking a proposta fills veículo, valor, vendedor and
  // dealId all at once (Correção 2). Picking "venda avulsa" clears the link.
  const selectDeal = (d: any | null) => {
    setDeal(d);
    setBlocked(false);
    if (d) {
      setCar(d.car);
      setCustomCar('');
      if (!isSeller) setAssignedSellerId(d.sellerId ?? assignedSellerId);
    }
  };

  const handleConfirmSale = () => {
    if (!client && !lead) return;
    const finalCar = customCar.trim() || car;
    if (!finalCar) return;
    if (!finalSeller) return; // guarded by the disabled button below too
    if (existingActiveSale) { setBlocked(true); return; } // guarded by the disabled button below too

    // SaleService.create refuses (and creates nothing) if the lead already has
    // an active sale, or the linked Deal was already sold — and marks the
    // Deal SOLD on success. Same lead/proposta never generates two vendas
    // (Correção 1, M0-K4.2 — was only checking the Deal, not the Lead).
    const ok = SaleService.create({
      client: lead ? lead.name : client,
      car: finalCar,
      seller: finalSeller.name,
      sellerId: finalSeller.id,
      leadId: lead?.id ?? null,
      dealId: deal?.id ?? null,
      value: deal?.value ?? '—',
      pay: lead?.pay || 'Financiamento',
      date: 'Hoje',
      status: SALE_STATUS.PENDING,
      createdByUserId: user?.id ?? null,
    });
    if (!ok) {
      setBlocked(true);
      return;
    }
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

  const canConfirm = !!(client || lead) && !!(customCar.trim() || car) && !!finalSeller && !existingActiveSale;

  return (
    <FlowShell eyebrow="REGISTRAR VENDA" title="Confirmar venda" icon="trophy" accent="#E8CE72" onClose={close}
      sub="Confirme os dados da venda. Esse é o número que mais importa — e que te leva ao topo do ranking."
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="trophy" onClick={handleConfirmSale} style={{ opacity: canConfirm ? 1 : .5, background: 'linear-gradient(180deg,#E8CE72,#C9A227)' }}>Confirmar venda 🏁</LBtn></>}>
      <div style={{ maxWidth: 720 }}>
        {!isSeller && (
          <FPanel style={{ marginBottom: 16 }}>
            <LocalSellerPicker value={finalSeller} onPick={(s: any) => setAssignedSellerId(s.id)} />
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
        {(blocked || existingActiveSale) && <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--amber-bg)', border: '1px solid var(--amber-line)' }}>
          <Icon name="alert" size={18} stroke={2.2} style={{ color: 'var(--amber)' }} />
          <span style={{ fontSize: 13, color: 'var(--t-700)' }}>Este cliente já possui uma venda registrada. Cancele a venda atual antes de registrar outra.</span>
        </div>}
        {lead && leadDeals.length > 0 && (
          <FPanel title="Proposta vinculada" icon="handshake" accent="#E8CE72" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leadDeals.map((d: any) => (
                <ChoiceTile key={d.id} icon="handshake" title={`${d.car} · ${d.value}`} desc={d.status === DEAL_STATUS.APPROVED ? 'Aprovada' : 'Em aberto'} accent={d.status === DEAL_STATUS.APPROVED ? '#27C75F' : '#E8CE72'} active={deal?.id === d.id} onClick={() => selectDeal(d)} />
              ))}
              <ChoiceTile icon="car" title="Venda avulsa (sem proposta)" active={!deal} onClick={() => selectDeal(null)} />
            </div>
          </FPanel>
        )}
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

// 'Hoje' is the only state naturally due today — every other option (including
// a custom hand-typed prazo, which could be anything from "amanhã" to "daqui
// 10 dias") lands in UPCOMING rather than guessing (Correção 4, M0-K4.2).
const NOVA_PENDENCIA_WHEN_STATE: Record<string, string> = {
  'Hoje': TASK_STATE.TODAY,
  'Amanhã': TASK_STATE.UPCOMING,
  'Esta semana': TASK_STATE.UPCOMING,
  'Personalizado': TASK_STATE.UPCOMING,
};

// COMMERCIAL-REMOTE-B1-B3-D: 'YYYY-MM-DD' local (mesmo formato de <input
// type="date">/dueAtHelpers.ts) — nunca via toISOString() (que converteria
// para UTC e poderia mostrar o dia errado perto da virada de meia-noite
// local). addLocalDays reusa startOfLocalDay (lib/tasks/deriveTaskState.ts)
// — mesmo conceito de "dia local" do resto do rollout, nunca uma segunda
// noção divergente.
function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addLocalDays(d: Date, days: number): Date {
  const base = startOfLocalDay(d);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

// COMMERCIAL-REMOTE-B1-B3-E: extração mínima da regra remota de dueAt —
// mesma lógica exata que já vivia inline em FlowNovaPendencia (B1-B3-D),
// agora compartilhada com FlowReagendarPendencia. Continua neste arquivo
// (nenhum módulo/lib novo) — os dois únicos consumidores já estão aqui.
// Hoje/Amanhã derivam a DATA do calendário local (nunca now+24h em ms);
// Esta semana/Personalizado usam a data escolhida pelo usuário; Esta semana
// é limitada a [hoje, domingo local] (weekInRange), nunca só via min/max do
// <input>. combineLocalDateAndTimeToIso continua a única autoridade de
// parsing/validação de data+hora — nenhum parser duplicado aqui.
function resolveRemoteDueAt(when: string, dueDate: string, dueTime: string, now: Date = new Date()) {
  const todayYMD = localYMD(now);
  const tomorrowYMD = localYMD(addLocalDays(now, 1));
  const sundayYMD = localYMD(addLocalDays(now, (7 - now.getDay()) % 7));
  const dateForWhen = when === 'Hoje' ? todayYMD : when === 'Amanhã' ? tomorrowYMD : dueDate;
  const weekInRange = when !== 'Esta semana' || (dueDate >= todayYMD && dueDate <= sundayYMD);
  const result = combineLocalDateAndTimeToIso({ date: dateForWhen, time: dueTime });
  return { todayYMD, sundayYMD, weekInRange, valid: result.ok && weekInRange, result };
}

// Mensagens sanitizadas fixas da criação remota de Task — mesmo modelo de
// remoteLeadErrorMessage (topo deste arquivo)/remoteTaskCompleteErrorMessage
// (ScreensOps.tsx, não compartilhado entre arquivos de propósito, mesma
// convenção já usada para os erros de Lead). identity_changed nunca chega
// aqui — useCloseOnIdentityChange fecha o flow antes.
function remoteTaskCreateErrorMessage(error: unknown): string {
  const code = isRemoteTasksError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_tasks_mutation_forbidden':
      return 'Você não tem permissão para criar esta pendência.';
    case 'remote_tasks_mutation_seller_required':
      return 'Selecione um responsável para a pendência.';
    case 'remote_tasks_mutation_seller_not_found':
      return 'O responsável selecionado não está mais disponível.';
    case 'remote_tasks_mutation_lead_not_found':
      return 'O cliente vinculado não está mais disponível.';
    case 'remote_tasks_mutation_invalid_title':
      return 'Informe um título válido para a pendência.';
    default:
      return 'Não foi possível criar a pendência. Tente novamente.';
  }
}

// COMMERCIAL-REMOTE-B1-B3-E: mensagens sanitizadas do reagendamento remoto —
// mesmo modelo de remoteTaskCreateErrorMessage acima (helper próprio deste
// flow, não compartilhado — mesma convenção de remoteLeadMoveErrorMessage
// vs remoteCallOutcomeErrorMessage para Leads). identity_changed nunca
// chega aqui — tratado antes, no catch do handler.
function remoteTaskUpdateErrorMessage(error: unknown): string {
  const code = isRemoteTasksError(error) ? error.code : undefined;
  switch (code) {
    case 'remote_tasks_mutation_stale_write':
      return 'Esta pendência foi alterada. Os dados foram atualizados.';
    case 'remote_tasks_mutation_task_completed':
      return 'Esta pendência já foi concluída.';
    case 'remote_tasks_mutation_task_not_found':
      return 'Esta pendência não está mais disponível.';
    case 'remote_tasks_mutation_forbidden':
      return 'Você não tem permissão para reagendar esta pendência.';
    case 'remote_tasks_mutation_seller_required':
      return 'Esta pendência está sem um responsável válido.';
    case 'remote_tasks_mutation_seller_not_found':
      return 'O responsável desta pendência não está mais disponível.';
    case 'remote_tasks_mutation_invalid_title':
      return 'Esta pendência possui dados inválidos e precisa ser atualizada.';
    default:
      return 'Não foi possível reagendar a pendência. Tente novamente.';
  }
}

// COMMERCIAL-REMOTE-B1-B3-E §0: dentro deste flow o usuário não consegue
// corrigir title/assignedSellerId/permissão — resubmeter com o MESMO
// payload depois de qualquer um desses erros sempre falharia de novo
// (stale_write em particular: expectedVersion ficaria definitivamente
// obsoleto). Único código genuinamente transitório é generic_error (ou
// qualquer erro não reconhecido como RemoteTasksError) — só ele permite
// nova tentativa na mesma instância do flow; todos os outros exigem
// fechar e reabrir (Task/contexto atualizados na nova abertura).
function isRemoteTaskUpdateRetryable(error: unknown): boolean {
  const code = isRemoteTasksError(error) ? error.code : undefined;
  return code === undefined || code === 'remote_tasks_mutation_generic_error';
}

export function FlowNovaPendencia({ payload, close }: any) {
  const [done, setDone] = useState(false);
  const [type, setType] = useState('Ligar');
  const [client, setClient] = useState(payload.lead ? payload.lead.name : '');
  const [when, setWhen] = useState('Hoje');
  const [customWhen, setCustomWhen] = useState('');
  // COMMERCIAL-REMOTE-B1-B3-D: só usados no branch remoto (§0/§13-18) — data/
  // hora do local (customWhen, texto livre) permanecem intocados.
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [prio, setPrio] = useState('Alta');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const types: [string, string][] = [['Ligar', 'phone'], ['Visita', 'calendar'], ['Follow-up', 'refresh'], ['Proposta', 'handshake'], ['Documento', 'doc']];

  const user = AuthService.getCurrentUser();
  const isSeller = user?.activeMembership?.role === 'seller';

  // COMMERCIAL-REMOTE-B1-B3-D: mesmo contrato de resolveLeadFlowContext
  // (lib/leads/leadFlowContext.ts) — 'remote' sempre que Task não estiver em
  // task_local, inclusive blocked/misconfigured (nunca fallback local
  // silencioso). Na prática este flow só é aberto em task_local ou
  // task_remote_active (ScreenPendencias oculta o botão, FlowLayer bloqueia
  // o flow-id nos outros modos) — useCreateTask falha fechado (forbidden)
  // de qualquer forma se isso não for verdade.
  const taskDataSource: 'local' | 'remote' = resolveTaskRemoteMode() === 'task_local' ? 'local' : 'remote';

  // Catálogo local só é lido em task_local — remoto nunca chama
  // SellerService (§7: nem para a seleção, nem para resolver o label de
  // exibição).
  const allSellers = taskDataSource === 'local' ? SellerService.getAll() : [];
  // Seller creates a task for themself. Manager/admin has no sellerId of
  // their own — an avulsa task must never save with assignedTo null (that's
  // what let it silently show up for every seller, Correção 4, M0-K4.1). If
  // it came from a lead, pre-select that lead's own seller.
  const [assignedSellerId, setAssignedSellerId] = useState<string | null>(
    isSeller ? (user?.activeMembership?.sellerId ?? null) : (payload.lead?.sellerId ?? null),
  );
  const finalSellerId = isSeller ? (user?.activeMembership?.sellerId ?? null) : assignedSellerId;
  const finalSeller = taskDataSource === 'local' && finalSellerId ? allSellers.find((s: any) => s.id === finalSellerId) : null;
  const isCustomWhen = when === 'Personalizado';
  const finalWhen = isCustomWhen ? customWhen.trim() : when;

  // Identidade — mesma forma canônica de useRemoteTasksScreenState/
  // useTasksRemoteBridgeLifecycle/useCreateTask/useCompleteTask (TaskRow,
  // ScreensOps.tsx). Hooks chamados SEMPRE, na mesma ordem (Rules of Hooks)
  // — em task_local eles simplesmente nunca são exercitados via submit.
  const identityUserId = user?.id ?? null;
  const identityCompanyId = user?.activeMembership?.companyId ?? null;
  const identityMembershipRole = user?.activeMembership?.role ?? null;
  const identityUserIsActive = Boolean(user);
  const identityKey = identityUserId && identityCompanyId ? `${identityUserId}:${identityCompanyId}` : null;

  const createHook = useCreateTask({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  const assignableSellers = useCurrentCompanyAssignableSellers({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  // useCloseOnIdentityChange já existe neste arquivo (linha ~63, reusado por
  // FlowNovoClienteRemote/FlowEditarCliente) — mesma proteção, nunca uma
  // segunda implementação.
  useCloseOnIdentityChange(identityKey, close);

  // COMMERCIAL-REMOTE-B1-B3-E: cálculo movido para resolveRemoteDueAt
  // (compartilhado com FlowReagendarPendencia) — mesmos nomes de variável
  // de antes, refatoração puramente mecânica, nenhuma mudança de
  // comportamento (§0/§13-18 do B1-B3-D continuam valendo).
  const { todayYMD, sundayYMD, weekInRange: remoteWeekInRange, valid: remoteDueAtValid, result: remoteDueAtResult } = resolveRemoteDueAt(when, dueDate, dueTime);

  const remoteSellerItems: SellerPickerItem[] = assignableSellers.assignableSellers.map((s) => ({ id: s.seller_id, name: s.name }));

  const canCreate = taskDataSource === 'local'
    ? !!finalSellerId && !!finalWhen
    : Boolean(
        remoteDueAtValid
        && !submitting
        && !createHook.isPending
        && (isSeller || (!!finalSellerId && !assignableSellers.isLoading)),
      );

  // Só para o texto de sucesso — em remoto, finalWhen/customWhen não
  // representam mais o "quando" real (o campo livre saiu de uso nesse
  // branch, item §16); usar o rótulo do Segmented em vez de um texto vazio.
  const successWhenLabel = taskDataSource === 'local' ? finalWhen : when;

  const handleCreateLocal = () => {
    if (!finalSellerId || !finalWhen) return;
    const prioMap: Record<string, string> = { Alta: 'alta', Média: 'media', Baixa: 'baixa' };
    TaskService.create({
      title: `${type}${client ? ' — ' + client : ''}`,
      lead: client,
      leadId: payload.lead?.id ?? null,
      state: NOVA_PENDENCIA_WHEN_STATE[when] || TASK_STATE.UPCOMING,
      prio: prioMap[prio] || 'media',
      when: finalWhen,
      assignedTo: finalSellerId,
      note: '',
    });
    setDone(true);
  };

  const handleCreateRemote = async () => {
    if (!canCreate || submitting || createHook.isPending || !remoteDueAtResult.ok) return;
    const prioMap: Record<string, 'alta' | 'media' | 'baixa'> = { Alta: 'alta', Média: 'media', Baixa: 'baixa' };
    const priority = prioMap[prio] || 'media';
    const title = `${type}${client ? ' — ' + client : ''}`;
    const leadId = payload.lead?.id ?? null;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isSeller) {
        await createHook.createTask({ actorRole: 'seller', title, priority, dueAt: remoteDueAtResult.iso, leadId, note: '' });
      } else {
        if (!finalSellerId) return;
        await createHook.createTask({ actorRole: 'manager', title, priority, dueAt: remoteDueAtResult.iso, assignedSellerId: finalSellerId, leadId, note: '' });
      }
      setDone(true);
    } catch (err) {
      // Mesmo padrão de FlowAtribuirVendedor (FlowsShared.tsx:1166-1170):
      // identity_changed fecha o flow diretamente, nunca mostra o erro da
      // sessão antiga — useCloseOnIdentityChange acima é proteção
      // complementar (identidade muda enquanto o flow está aberto, fora de
      // uma mutation em voo), não substitui este close() explícito aqui.
      if (isRemoteTasksError(err) && err.code === 'remote_tasks_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(remoteTaskCreateErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) return (
    <FlowShell eyebrow="NOVA PENDÊNCIA" title="Pendência criada" icon="check" accent="#27C75F" onClose={close}>
      <FlowSuccess title="Pendência criada!" sub={`"${type}${client ? ' — ' + client : ''}" foi adicionada para ${successWhenLabel.toLowerCase()}.`} actions={<LBtn kind="gold" size="lg" icon="check" onClick={close}>Concluir</LBtn>} />
    </FlowShell>
  );
  return (
    <FlowShell eyebrow="NOVA PENDÊNCIA" title="Criar uma pendência" icon="check" accent="#E8CE72" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check"
        onClick={taskDataSource === 'local' ? handleCreateLocal : handleCreateRemote}
        style={{ opacity: canCreate ? 1 : .5 }}>
        {taskDataSource === 'remote' && (submitting || createHook.isPending) ? 'Criando…' : 'Criar pendência'}
      </LBtn></>}>
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
        {!isSeller && (
          <FPanel style={{ marginBottom: 16 }}>
            {taskDataSource === 'local' ? (
              <>
                <LocalSellerPicker value={finalSeller} onPick={(s: any) => setAssignedSellerId(s.id)} />
                {!finalSeller && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--amber)' }}>Selecione o vendedor responsável por esta pendência.</div>}
              </>
            ) : (
              <SellerPicker
                items={remoteSellerItems}
                value={assignedSellerId}
                onChange={(id: string | null) => setAssignedSellerId(id)}
                loading={assignableSellers.isLoading}
                disabled={submitting || createHook.isPending}
                error={assignableSellers.isError ? 'Não foi possível carregar os vendedores.' : null}
                allowNone={false}
                placeholder="Selecione o vendedor…"
              />
            )}
          </FPanel>
        )}
        <FPanel>
          <FField label="Cliente relacionado (opcional)" icon="user" placeholder="Buscar cliente" value={client} onChange={(e: any) => setClient(e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Quando</div>
              <Segmented options={['Hoje', 'Amanhã', 'Esta semana', 'Personalizado']} value={when} onChange={setWhen} />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Prioridade</div>
              <Segmented options={['Alta', 'Média', 'Baixa']} value={prio} onChange={setPrio} accent={prio === 'Alta' ? '#FF3B3B' : '#E8CE72'} />
            </div>
          </div>
          {taskDataSource === 'local' ? (
            isCustomWhen && (
              <div style={{ marginTop: 4 }}>
                <FField label="Data ou prazo" icon="calendar" placeholder="Ex.: 12/07/2026, sexta-feira, daqui 10 dias…" value={customWhen} onChange={(e: any) => setCustomWhen(e.target.value)} />
              </div>
            )
          ) : (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: (when === 'Esta semana' || when === 'Personalizado') ? '1fr 1fr' : '1fr', gap: 18 }}>
                {(when === 'Esta semana' || when === 'Personalizado') && (
                  <FField label="Data" icon="calendar" type="date" value={dueDate} onChange={(e: any) => setDueDate(e.target.value)}
                    min={when === 'Esta semana' ? todayYMD : undefined}
                    max={when === 'Esta semana' ? sundayYMD : undefined} />
                )}
                <FField label="Hora" icon="clock" type="time" value={dueTime} onChange={(e: any) => setDueTime(e.target.value)} />
              </div>
              {when === 'Esta semana' && dueDate && !remoteWeekInRange && (
                <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--amber)' }}>Escolha uma data entre hoje e domingo desta semana.</div>
              )}
            </div>
          )}
        </FPanel>
        {taskDataSource === 'remote' && submitError && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
            <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
          </div>
        )}
      </div>
    </FlowShell>
  );
}

// COMMERCIAL-REMOTE-B1-B3-E: `taskDataSource` decide local/remoto do mesmo
// jeito que FlowNovaPendencia (resolveTaskRemoteMode(), nunca fallback
// local sob modo remoto). Diferente do Create: nenhum picker de
// responsável em nenhum papel — este flow só reagenda, nunca reatribui
// (Manager E Seller reenviam task.assignedTo intacto, backend continua
// autoridade sobre quem pode fazer o quê).
export function FlowReagendarPendencia({ payload, close }: any) {
  const task = payload.task;
  const [when, setWhen] = useState('Amanhã');
  const [customWhen, setCustomWhen] = useState('');
  // COMMERCIAL-REMOTE-B1-B3-E: só usados no branch remoto — começam vazios
  // de propósito (§10-12 do precheck: mesma convenção "sem prefill
  // silencioso" já usada no Create; usuário escolhe explicitamente).
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // REOPEN REQUIRED (§0 do EXEC): true após qualquer erro que não seja
  // generic_error — bloqueia permanentemente novos submits NESTA instância
  // do flow (retry com o mesmo expectedVersion/payload nunca teria sucesso).
  const [blocked, setBlocked] = useState(false);

  const user = AuthService.getCurrentUser();
  const taskDataSource: 'local' | 'remote' = resolveTaskRemoteMode() === 'task_local' ? 'local' : 'remote';

  // Identidade — mesma forma canônica de useRemoteTasksScreenState/
  // useCreateTask/useCompleteTask/TaskRow.
  const identityUserId = user?.id ?? null;
  const identityCompanyId = user?.activeMembership?.companyId ?? null;
  const identityMembershipRole = user?.activeMembership?.role ?? null;
  const identityUserIsActive = Boolean(user);
  const identityKey = identityUserId && identityCompanyId ? `${identityUserId}:${identityCompanyId}` : null;

  // Hooks SEMPRE chamados, incondicionalmente, antes de qualquer return
  // (inclusive o `!task` abaixo) — Rules of Hooks.
  const updateHook = useUpdateTask({
    userId: identityUserId, companyId: identityCompanyId,
    membershipRole: identityMembershipRole, userIsActive: identityUserIsActive,
  });
  useCloseOnIdentityChange(identityKey, close);

  const remoteDueAt = resolveRemoteDueAt(when, dueDate, dueTime);
  const { todayYMD, sundayYMD, weekInRange: remoteWeekInRange, valid: remoteDueAtValid, result: remoteDueAtResult } = remoteDueAt;

  if (!task) return null;

  const whenState: Record<string, string> = { 'Hoje': TASK_STATE.TODAY, 'Amanhã': TASK_STATE.UPCOMING, 'Esta semana': TASK_STATE.UPCOMING, 'Personalizado': TASK_STATE.UPCOMING };
  const isCustomWhen = when === 'Personalizado';
  const finalWhen = isCustomWhen ? customWhen.trim() : when;
  const canSaveLocal = !!finalWhen;

  // §6/§12/§13 do EXEC: version/assignedSeller nunca fabricados; no-op
  // (mesmo instante) bloqueado por epoch-ms, sem normalização complexa.
  const hasValidVersion = Number.isInteger(task.version) && task.version >= 1;
  const hasValidAssignedSeller = typeof task.assignedTo === 'string' && task.assignedTo.trim() !== '';
  const remoteDueAtChanged =
    remoteDueAtValid && remoteDueAtResult.ok && task.dueAt != null
    && new Date(remoteDueAtResult.iso).getTime() !== new Date(task.dueAt).getTime();

  const canSaveRemote = Boolean(
    remoteDueAtValid
    && remoteDueAtChanged
    && hasValidVersion
    && hasValidAssignedSeller
    && !submitting
    && !updateHook.isPending
    && !blocked,
  );
  const canSave = taskDataSource === 'local' ? canSaveLocal : canSaveRemote;

  const handleSaveLocal = () => {
    if (!finalWhen) return;
    TaskService.update(task.id, { when: finalWhen, state: whenState[when] });
    close();
  };

  const handleSaveRemote = async () => {
    if (!canSaveRemote || !remoteDueAtResult.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // FULL REPLACE (§10/§14/§15 do EXEC): title/note/priority/
      // assignedSellerId vêm DIRETO de task — nunca de LeadService/
      // SellerService/TaskService/label de UI — mesmo sem terem mudado.
      await updateHook.updateTask({
        taskId: task.id,
        expectedVersion: task.version,
        title: task.title,
        note: task.note,
        priority: task.prio,
        dueAt: remoteDueAtResult.iso,
        assignedSellerId: task.assignedTo,
      });
      close();
    } catch (err) {
      // Mesmo padrão de FlowAtribuirVendedor/FlowNovaPendencia:
      // identity_changed fecha o flow diretamente, nunca mostra erro da
      // sessão antiga.
      if (isRemoteTasksError(err) && err.code === 'remote_tasks_mutation_identity_changed') {
        close();
        return;
      }
      setSubmitError(remoteTaskUpdateErrorMessage(err));
      if (!isRemoteTaskUpdateRetryable(err)) setBlocked(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FlowShell eyebrow="REAGENDAR PENDÊNCIA" title="Reagendar" icon="refresh" accent="#3B82F6" onClose={close}
      footer={<><div style={{ flex: 1 }} /><LBtn kind="gold" size="lg" icon="check"
        onClick={taskDataSource === 'local' ? handleSaveLocal : handleSaveRemote}
        style={{ opacity: canSave ? 1 : .5 }}>
        {taskDataSource === 'remote' && (submitting || updateHook.isPending) ? 'Reagendando…' : 'Reagendar'}
      </LBtn></>}>
      <div style={{ maxWidth: 520 }}>
        <FPanel>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)', marginBottom: 4 }}>{task.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginBottom: 16 }}>Atualmente: {task.when}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Nova data</div>
          <Segmented options={['Hoje', 'Amanhã', 'Esta semana', 'Personalizado']} value={when} onChange={setWhen} accent="#3B82F6" />
          {taskDataSource === 'local' ? (
            isCustomWhen && (
              <div style={{ marginTop: 14 }}>
                <FField label="Data ou prazo" icon="calendar" placeholder="Ex.: 12/07/2026, sexta-feira, daqui 10 dias…" value={customWhen} onChange={(e: any) => setCustomWhen(e.target.value)} />
              </div>
            )
          ) : (
            <div style={{ marginTop: 14 }}>
              {!hasValidAssignedSeller ? (
                <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>Esta pendência está sem um responsável válido. Não é possível reagendá-la agora.</div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: (when === 'Esta semana' || when === 'Personalizado') ? '1fr 1fr' : '1fr', gap: 18 }}>
                    {(when === 'Esta semana' || when === 'Personalizado') && (
                      <FField label="Data" icon="calendar" type="date" value={dueDate} onChange={(e: any) => setDueDate(e.target.value)}
                        min={when === 'Esta semana' ? todayYMD : undefined}
                        max={when === 'Esta semana' ? sundayYMD : undefined}
                        disabled={blocked} />
                    )}
                    <FField label="Hora" icon="clock" type="time" value={dueTime} onChange={(e: any) => setDueTime(e.target.value)} disabled={blocked} />
                  </div>
                  {when === 'Esta semana' && dueDate && !remoteWeekInRange && (
                    <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--amber)' }}>Escolha uma data entre hoje e domingo desta semana.</div>
                  )}
                </>
              )}
              {submitError && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 11, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))' }}>
                  <span style={{ fontSize: 13, color: 'var(--t-700)' }}>{submitError}</span>
                </div>
              )}
            </div>
          )}
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
          leadId: lead?.id ?? null,
          state: TASK_STATE.UPCOMING,
          prio: 'media',
          when,
          // Task vinda de um lead: vendedor responsável é o dono do lead, não
          // o gestor que abriu o acompanhamento (Correção 4).
          assignedTo: lead?.sellerId ?? user?.activeMembership?.sellerId ?? null,
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
