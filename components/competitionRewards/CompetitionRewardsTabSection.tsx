'use client';
// components/competitionRewards/CompetitionRewardsTabSection.tsx —
// COMPETITION-REWARDS-V1-B2-EXEC. Aba "Competição" de Ajustes: o Manager
// configura a premiação mensal da competição (mês atual ou próximo).
// Seller e Super Admin NUNCA chegam aqui — ScreenAjustes só monta esta
// seção para canManageCompetitionRewards (Manager com membership ativa), e
// o backend (get_competition_reward_campaign / upsert_competition_reward_
// campaign) é Manager-only e nega os demais com 42501.
//
// Leitura do editor: get_competition_reward_campaign(month) via
// useCompetitionRewardCampaign — NUNCA get_competition_rewards_overview
// (§1). Escrita: upsert_competition_reward_campaign via
// useUpsertCompetitionRewardCampaign. Zero migration, zero RPC nova.
//
// O seletor de mês deriva "mês atual / próximo" do relógio do navegador
// (buildRewardMonthOptions). A timezone civil real da empresa é a
// autoridade no backend — um mês recém-encerrado volta como month_closed e
// vira uma mensagem amigável, nunca um estado quebrado.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LBadge, LCard, Chip } from '@/components/ui/kit';
import { Stack, Cluster, FormGrid, ChipRow } from '@/components/ui/primitives';
import { useViewport } from '@/lib/hooks/useViewport';
import { useCompetitionRewardCampaign } from '@/lib/hooks/useCompetitionRewardCampaign';
import { useUpsertCompetitionRewardCampaign } from '@/lib/hooks/useUpsertCompetitionRewardCampaign';
import { getCompetitionRewardErrorMessage } from '@/lib/competitionRewards/errors';
import {
  buildRewardMonthOptions,
  monthName,
  type RewardMonthOption,
} from '@/lib/competitionRewards/monthOptions';
import {
  parseBrlInputToCents,
  formatCentsForInput,
  formatCentsToBRL,
  sumTierAmountCents,
} from '@/lib/competitionRewards/money';
import type { RewardCampaignModel, RewardCampaignStatus } from '@/lib/competitionRewards/adapter';

const MAX_TIERS = 10;
const MAX_TITLE = 120;
const MAX_REWARD_TEXT = 120;

export type CompetitionRewardsTabSectionProps = {
  userId: string;
  companyId: string | null;
  readAuthorized: boolean;
  writeAuthorized: boolean;
};

type DraftTier = { amountCents: number | null; rewardText: string };
type DraftSnapshot = { title: string; tiers: DraftTier[] };

const EMPTY_SNAPSHOT: DraftSnapshot = { title: '', tiers: [{ amountCents: null, rewardText: '' }] };

function snapshotFromCampaign(campaign: RewardCampaignModel): DraftSnapshot {
  return {
    title: campaign.title ?? '',
    tiers: campaign.tiers.length > 0
      ? campaign.tiers.map((t) => ({ amountCents: t.amountCents, rewardText: t.rewardText ?? '' }))
      : [{ amountCents: null, rewardText: '' }],
  };
}

function serialize(snapshot: DraftSnapshot): string {
  return JSON.stringify({
    title: snapshot.title.trim(),
    tiers: snapshot.tiers.map((t) => ({ a: t.amountCents, t: t.rewardText.trim() })),
  });
}

function ordinalLabel(position: number): string {
  return `${position}º lugar`;
}

const MEDAL_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

// ─────────────────────────────────────────────────────────────────────────

type TierValidation = { tierErrors: (string | null)[]; formError: string | null; ok: boolean };

function validate(title: string, tiers: DraftTier[]): TierValidation {
  const tierErrors = tiers.map((t) => {
    const text = t.rewardText.trim();
    if (t.amountCents !== null && t.amountCents <= 0) return 'Informe um valor maior que zero.';
    if (text.length > MAX_REWARD_TEXT) return `O prêmio extra pode ter no máximo ${MAX_REWARD_TEXT} caracteres.`;
    if (t.amountCents === null && text === '') return 'Informe um valor ou um prêmio.';
    return null;
  });

  let formError: string | null = null;
  if (title.trim().length > MAX_TITLE) {
    formError = `O título pode ter no máximo ${MAX_TITLE} caracteres.`;
  } else if (tiers.length === 0) {
    formError = 'Adicione pelo menos uma colocação.';
  }

  const ok = formError === null && tierErrors.every((e) => e === null);
  return { tierErrors, formError, ok };
}

// ─────────────────────────────────────────────────────────────────────────

function MoneyField({
  value, onChange, ariaLabel,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  ariaLabel: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-700)', marginBottom: 6 }}>
        Valor em dinheiro
      </label>
      <input
        inputMode="numeric"
        aria-label={ariaLabel}
        value={formatCentsForInput(value)}
        placeholder="R$ 0,00"
        onChange={(e) => onChange(parseBrlInputToCents(e.target.value))}
        style={{
          width: '100%', padding: '10px 13px', borderRadius: 9, border: '1px solid var(--border)',
          fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'var(--surface-2)', outline: 'none',
        }}
      />
    </div>
  );
}

function RewardTextField({
  value, onChange, ariaLabel,
}: {
  value: string;
  onChange: (text: string) => void;
  ariaLabel: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-700)', marginBottom: 6 }}>
        Prêmio extra <span style={{ color: 'var(--t-400)', fontWeight: 500 }}>(opcional)</span>
      </label>
      <input
        aria-label={ariaLabel}
        value={value}
        maxLength={MAX_REWARD_TEXT}
        placeholder="Ex.: 1 dia de folga"
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '10px 13px', borderRadius: 9, border: '1px solid var(--border)',
          fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'var(--surface-2)', outline: 'none',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function RewardPreview({ monthStart, tiers }: { monthStart: string; tiers: DraftTier[] }) {
  const shown = tiers
    .map((t, i) => ({ position: i + 1, amountCents: t.amountCents, rewardText: t.rewardText.trim() }))
    .filter((t) => t.amountCents !== null || t.rewardText !== '');

  return (
    <div data-testid="reward-preview" style={{
      border: '1px solid var(--border)', borderRadius: 12, padding: 16,
      background: 'linear-gradient(180deg, rgba(232,206,114,.06), rgba(0,0,0,.12))',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon name="trophy" size={16} stroke={2.2} style={{ color: 'var(--gold-ink)' }} />
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', color: 'var(--gold-ink)' }}>
          PRÊMIOS DE {monthName(monthStart).toUpperCase()}
        </span>
      </div>
      {shown.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--t-400)' }}>Adicione um valor ou um prêmio para ver a prévia.</div>
      ) : (
        <Stack gap={10}>
          {shown.map((t) => (
            <div key={t.position} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span aria-hidden style={{ fontSize: 16, width: 22, textAlign: 'center' }}>
                {MEDAL_EMOJI[t.position] ?? '•'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-900)' }}>{ordinalLabel(t.position)}</div>
                {t.amountCents !== null && (
                  <div style={{ fontSize: 13, color: 'var(--t-700)' }}>{formatCentsToBRL(t.amountCents)}</div>
                )}
                {t.rewardText !== '' && (
                  <div style={{ fontSize: 13, color: 'var(--t-700)' }}>{t.rewardText}</div>
                )}
              </div>
            </div>
          ))}
        </Stack>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

export function CompetitionRewardsTabSection({
  userId, companyId, readAuthorized, writeAuthorized,
}: CompetitionRewardsTabSectionProps) {
  const { isMd, isLg } = useViewport();

  const [monthOptions] = useState<RewardMonthOption[]>(() => buildRewardMonthOptions(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].monthStart);
  const selectedOption = monthOptions.find((o) => o.monthStart === selectedMonth) ?? monthOptions[0];

  const [draftTitle, setDraftTitle] = useState('');
  const [draftTiers, setDraftTiers] = useState<DraftTier[]>(EMPTY_SNAPSHOT.tiers);
  const [baseline, setBaseline] = useState<DraftSnapshot>(EMPTY_SNAPSHOT);
  const [isCreating, setIsCreating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  // COMPETITION-REWARDS-V1-B2-R1-EXEC §4 — confirmação de "Retirar publicação"
  // (published → draft). Nunca executa com um clique só.
  const [pendingWithdraw, setPendingWithdraw] = useState(false);
  // Retenção otimista: entre o sucesso do upsert e o refetch invalidado
  // pousar, `state` ainda pode trazer campaign=null (stale). Isso mantém o
  // editor estável (sem piscar para o empty state, sem sumir o toast).
  const [savedCampaign, setSavedCampaign] = useState<{ id: string; status: RewardCampaignStatus } | null>(null);
  const withdrawDialogRef = useRef<HTMLDivElement | null>(null);

  const state = useCompetitionRewardCampaign({
    userId,
    companyId,
    membershipRole: 'manager',
    userIsActive: true,
    monthStart: selectedMonth,
    readAuthorized,
  });
  const upsert = useUpsertCompetitionRewardCampaign({ userId, companyId, writeAuthorized });

  const campaign = state.status === 'ready' ? state.config.campaign : null;

  const current: DraftSnapshot = { title: draftTitle, tiers: draftTiers };
  const isDirty = serialize(current) !== serialize(baseline);

  const isDirtyRef = useRef(isDirty);
  const isCreatingRef = useRef(isCreating);
  isDirtyRef.current = isDirty;
  isCreatingRef.current = isCreating;
  const loadedRef = useRef<string>('');

  const applySnapshot = (snap: DraftSnapshot) => {
    setDraftTitle(snap.title);
    setDraftTiers(snap.tiers.map((t) => ({ ...t })));
    setBaseline(snap);
  };

  // §15 — o diálogo de confirmação: ESC fecha, foco entra no diálogo.
  useEffect(() => {
    if (!pendingWithdraw) return;
    withdrawDialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPendingWithdraw(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingWithdraw]);

  // Chave estável (string) — o efeito só dispara quando o mês, a identidade
  // OU o updated_at da campanha mudam; NUNCA a cada render (o objeto `state`
  // é recriado a cada render).
  const readyKey = state.status === 'ready'
    ? `${selectedMonth}::${state.config.campaign?.id ?? 'none'}::${state.config.campaign?.updatedAt ?? ''}`
    : `pending::${selectedMonth}`;

  // Reconstrói o editor quando o mês/identidade da campanha muda; num
  // refetch de background com a MESMA identidade só reaplica se o Manager
  // não estiver no meio de uma edição (nunca sobrescreve digitação).
  useEffect(() => {
    if (state.status !== 'ready') return;
    const camp = state.config.campaign;
    const identityKey = `${selectedMonth}::${camp?.id ?? 'none'}`;
    if (loadedRef.current === identityKey) {
      if (!isDirtyRef.current && !isCreatingRef.current && camp) {
        // O refetch invalidado pousou com a mesma identidade e um novo
        // updated_at ⇒ o servidor é a verdade; solta a retenção otimista.
        setSavedCampaign(null);
        applySnapshot(snapshotFromCampaign(camp));
      }
      return;
    }
    loadedRef.current = identityKey;
    setIsCreating(false);
    setSaveError(null);
    if (camp) setSavedCampaign(null); // dado real supera a retenção otimista
    applySnapshot(camp ? snapshotFromCampaign(camp) : EMPTY_SNAPSHOT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);

  const validation = useMemo(() => validate(draftTitle, draftTiers), [draftTitle, draftTiers]);
  const totalCents = sumTierAmountCents(draftTiers);

  // effectiveCampaign = a retenção otimista pós-save (mais recente que o
  // `state`, até o refetch invalidado pousar) OU a campanha real do state.
  // savedCampaign vence: depois de publicar/retirar, `campaign` ainda pode
  // trazer o status anterior por um instante.
  const effectiveCampaign: { status: RewardCampaignStatus } | null = savedCampaign ?? campaign;
  const showEditor = isCreating || effectiveCampaign !== null;
  const showDraftAndPublish = isCreating || (effectiveCampaign !== null && effectiveCampaign.status === 'draft');
  const showSaveChanges = effectiveCampaign !== null && effectiveCampaign.status === 'published';
  const canSave = validation.ok && isDirty && writeAuthorized && !upsert.isPending;

  // ── handlers ───────────────────────────────────────────────────────────
  const commitMonth = (month: string) => {
    setPendingMonth(null);
    setPendingWithdraw(false);
    setSuccessMsg(null);
    setSaveError(null);
    setIsCreating(false);
    setSavedCampaign(null);
    setSelectedMonth(month);
  };

  const handleSelectMonth = (month: string) => {
    if (month === selectedMonth) return;
    if (isDirty) { setPendingMonth(month); return; }
    commitMonth(month);
  };

  const startCreate = () => {
    setSuccessMsg(null);
    setSaveError(null);
    setPendingWithdraw(false);
    setIsCreating(true);
    applySnapshot({ title: '', tiers: [{ amountCents: null, rewardText: '' }] });
  };

  const handleCancel = () => {
    setSaveError(null);
    setSuccessMsg(null);
    setPendingWithdraw(false);
    if (isCreating) {
      setIsCreating(false);
      setSavedCampaign(null);
      applySnapshot(EMPTY_SNAPSHOT);
      return;
    }
    applySnapshot(baseline);
  };

  const addTier = () => {
    if (draftTiers.length >= MAX_TIERS) return;
    setSuccessMsg(null);
    setDraftTiers([...draftTiers, { amountCents: null, rewardText: '' }]);
  };

  const removeTier = (index: number) => {
    if (draftTiers.length <= 1) return;
    setSuccessMsg(null);
    setDraftTiers(draftTiers.filter((_, i) => i !== index));
  };

  const updateTier = (index: number, patch: Partial<DraftTier>) => {
    setSuccessMsg(null);
    setDraftTiers(draftTiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const doSave = async (status: 'draft' | 'published') => {
    if (!validation.ok || !writeAuthorized) return;
    setSaveError(null);
    setSuccessMsg(null);
    const snapshot: DraftSnapshot = { title: draftTitle, tiers: draftTiers.map((t) => ({ ...t })) };
    const wasPublished = effectiveCampaign !== null && effectiveCampaign.status === 'published';
    try {
      const result = await upsert.upsertCampaign({
        monthStart: selectedMonth,
        status,
        title: draftTitle.trim() === '' ? null : draftTitle.trim(),
        tiers: draftTiers.map((t) => ({
          amountCents: t.amountCents,
          rewardText: t.rewardText.trim() === '' ? null : t.rewardText.trim(),
        })),
      });
      // Estado limpo imediato (§25/§36/§37); o refetch invalidado confirma.
      loadedRef.current = `${selectedMonth}::${result.id}`;
      setIsCreating(false);
      setSavedCampaign({ id: result.id, status: result.status });
      applySnapshot(snapshot);
      setSuccessMsg(
        wasPublished
          ? 'Alterações salvas.'
          : status === 'published'
            ? 'Premiação publicada com sucesso.'
            : 'Rascunho salvo.',
      );
    } catch (err) {
      // §36 — preserva o que o Manager digitou.
      setSaveError(getCompetitionRewardErrorMessage(err));
    }
  };

  // COMPETITION-REWARDS-V1-B2-R1-EXEC §2/§5/§11 — "Retirar publicação":
  // published → draft SEM apagar nada. Reusa useUpsertCompetitionRewardCampaign
  // (§11) com o MESMO month_start / title / tiers PERSISTIDOS (baseline), só
  // status='draft'. Nunca usa os campos possivelmente meio-editados na tela.
  const doWithdraw = async () => {
    if (!writeAuthorized) return;
    setPendingWithdraw(false);
    setSaveError(null);
    setSuccessMsg(null);
    try {
      const result = await upsert.upsertCampaign({
        monthStart: selectedMonth,
        status: 'draft',
        title: baseline.title.trim() === '' ? null : baseline.title.trim(),
        tiers: baseline.tiers.map((t) => ({
          amountCents: t.amountCents,
          rewardText: t.rewardText.trim() === '' ? null : t.rewardText.trim(),
        })),
      });
      loadedRef.current = `${selectedMonth}::${result.id}`;
      setIsCreating(false);
      setSavedCampaign({ id: result.id, status: result.status });
      applySnapshot(baseline); // §13 — dirty=false, dados intactos
      setSuccessMsg('Premiação retirada. A equipe não verá mais esses prêmios até uma nova publicação.');
    } catch (err) {
      // §14 — segue visualmente Publicado, nenhum estado otimista.
      setSaveError(getCompetitionRewardErrorMessage(err));
    }
  };

  // ── render ─────────────────────────────────────────────────────────────
  if (!readAuthorized) {
    return (
      <LCard style={{ maxWidth: 640 }}>
        <div data-testid="competition-rewards-denied" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
          Você não tem acesso à configuração da premiação.
        </div>
      </LCard>
    );
  }

  const statusBadge = effectiveCampaign
    ? <LBadge tone={effectiveCampaign.status === 'published' ? 'green' : 'amber'}>
        {effectiveCampaign.status === 'published' ? 'Publicado' : 'Rascunho'}
      </LBadge>
    : isCreating
      ? <LBadge tone="amber">Rascunho</LBadge>
      : null;

  const monthLabelShort = monthName(selectedMonth);

  const header = (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Competição</div>
      <div style={{ fontSize: 13, color: 'var(--t-500)' }}>
        Configure a premiação mensal para deixar a disputa mais interessante.
      </div>
    </div>
  );

  const monthSelector = (
    <ChipRow style={{ marginBottom: 16 }}>
      {monthOptions.map((o) => (
        <Chip key={o.monthStart} active={o.monthStart === selectedMonth} onClick={() => handleSelectMonth(o.monthStart)}>
          {o.label}
        </Chip>
      ))}
    </ChipRow>
  );

  const discardConfirm = pendingMonth && (
    <div role="alertdialog" aria-label="Descartar alterações" data-testid="discard-confirm"
      style={{ border: '1px solid var(--amber)', background: 'var(--amber-bg)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-900)', marginBottom: 10 }}>
        Você tem alterações não salvas. Descartar alterações?
      </div>
      <Cluster gap={8}>
        <LBtn kind="ghost" size="sm" onClick={() => setPendingMonth(null)}>Continuar editando</LBtn>
        <LBtn kind="danger" size="sm" onClick={() => commitMonth(pendingMonth)}>Descartar</LBtn>
      </Cluster>
    </div>
  );

  // §4/§15 — confirmação de "Retirar publicação".
  const withdrawConfirm = pendingWithdraw && (
    <div
      ref={withdrawDialogRef}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="withdraw-confirm-title"
      data-testid="withdraw-confirm"
      style={{ border: '1px solid var(--amber)', background: 'var(--amber-bg)', borderRadius: 12, padding: 16, marginBottom: 16, outline: 'none' }}
    >
      <div id="withdraw-confirm-title" style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)', marginBottom: 8 }}>
        Retirar esta premiação?
      </div>
      <div style={{ fontSize: 13, color: 'var(--t-700)', marginBottom: 12, maxWidth: 460 }}>
        A equipe deixará de ver os prêmios imediatamente. A configuração continuará salva
        como rascunho e poderá ser publicada novamente depois.
      </div>
      <Cluster gap={8}>
        <LBtn kind="ghost" size="sm" onClick={() => setPendingWithdraw(false)}>Continuar publicada</LBtn>
        <LBtn kind="danger" size="sm" onClick={doWithdraw}>
          {upsert.isPending ? 'Retirando…' : 'Retirar publicação'}
        </LBtn>
      </Cluster>
    </div>
  );

  let body: React.ReactNode = null;

  if (state.status === 'loading') {
    body = (
      <div data-testid="competition-rewards-loading" style={{ padding: '24px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
        Carregando premiação…
      </div>
    );
  } else if (state.status === 'error' || state.status === 'contract-error') {
    body = (
      <div data-testid="competition-rewards-error" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--red)' }}>
        {state.status === 'contract-error'
          ? 'A premiação retornou em um formato inesperado.'
          : 'Não foi possível carregar a premiação.'}{' '}
        <button type="button" onClick={state.retry}
          style={{ background: 'none', border: 'none', color: 'var(--gold-ink)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
          Tentar novamente
        </button>
      </div>
    );
  } else if (state.status === 'unavailable') {
    body = (
      <div data-testid="competition-rewards-unavailable" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
        A configuração da premiação não está disponível no momento.
      </div>
    );
  } else if (!showEditor) {
    // Empty state (§8)
    body = (
      <div data-testid="competition-rewards-empty" style={{ padding: '20px 4px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Premiação de {monthLabelShort}</div>
        <div style={{ fontSize: 13.5, color: 'var(--t-500)', maxWidth: 420, marginBottom: writeAuthorized ? 16 : 0 }}>
          Você pode adicionar prêmios para deixar a competição deste mês ainda mais interessante.
        </div>
        {writeAuthorized && <LBtn kind="gold" icon="plus" onClick={startCreate}>Criar premiação</LBtn>}
      </div>
    );
  } else {
    // Editor
    const editorColumn = (
      <Stack gap={16}>
        {/* Summary strip (§22) */}
        <div data-testid="campaign-summary" style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'rgba(255,255,255,.02)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Premiação de {monthLabelShort}</span>
          {statusBadge}
          <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
            {draftTiers.length} {draftTiers.length === 1 ? 'colocação' : 'colocações'}
          </span>
          <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--t-500)' }}>
            Premiação total <strong style={{ color: 'var(--t-900)' }}>{formatCentsToBRL(totalCents)}</strong>
          </span>
        </div>

        {/* Title (§10) */}
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-700)', marginBottom: 6 }}>
            Título da campanha <span style={{ color: 'var(--t-400)', fontWeight: 500 }}>(opcional)</span>
          </label>
          <input
            aria-label="Título da campanha"
            value={draftTitle}
            maxLength={MAX_TITLE + 20}
            placeholder={`Premiação de ${monthLabelShort}`}
            onChange={(e) => { setSuccessMsg(null); setDraftTitle(e.target.value); }}
            style={{
              width: '100%', padding: '10px 13px', borderRadius: 9, border: '1px solid var(--border)',
              fontFamily: 'inherit', fontSize: 14, color: 'var(--t-900)', background: 'var(--surface-2)', outline: 'none',
            }}
          />
        </div>

        {/* Tier editor (§12/§13/§14) */}
        <Stack gap={12}>
          {draftTiers.map((tier, index) => {
            const position = index + 1;
            const tierError = validation.tierErrors[index];
            return (
              <div key={index} data-testid={`tier-row-${position}`} style={{
                border: `1px solid ${tierError ? 'var(--red-line)' : 'var(--border)'}`, borderRadius: 12, padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span aria-hidden style={{ fontSize: 16 }}>{MEDAL_EMOJI[position] ?? '•'}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{ordinalLabel(position)}</span>
                  {draftTiers.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remover prêmio do ${ordinalLabel(position)}`}
                      onClick={() => removeTier(index)}
                      className="focus-ring"
                      style={{
                        marginLeft: 'auto', border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)',
                        color: 'var(--t-500)', borderRadius: 9, padding: '5px 8px', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontFamily: 'inherit',
                      }}>
                      <Icon name="x" size={14} stroke={2.4} /> Remover
                    </button>
                  )}
                </div>
                <FormGrid columns={2} gap={12}>
                  <MoneyField
                    value={tier.amountCents}
                    ariaLabel={`Valor em dinheiro do ${ordinalLabel(position)}`}
                    onChange={(cents) => updateTier(index, { amountCents: cents })}
                  />
                  <RewardTextField
                    value={tier.rewardText}
                    ariaLabel={`Prêmio extra do ${ordinalLabel(position)}`}
                    onChange={(text) => updateTier(index, { rewardText: text })}
                  />
                </FormGrid>
                {tierError && (
                  <div data-testid={`tier-error-${position}`} style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>
                    {tierError}
                  </div>
                )}
              </div>
            );
          })}

          {draftTiers.length < MAX_TIERS && (
            <LBtn kind="ghost" size="sm" icon="plus" aria-label="Adicionar colocação" onClick={addTier}>
              Adicionar colocação
            </LBtn>
          )}
        </Stack>

        {/* Total (§21) */}
        <div data-testid="reward-total" style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          padding: '12px 14px', border: '1px solid var(--gold-line)', borderRadius: 12, background: 'var(--gold-bg)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold-ink)' }}>Premiação total</span>
          <span className="display tnum" style={{ fontSize: 20, fontWeight: 800, color: 'var(--gold-ink)' }}>
            {formatCentsToBRL(totalCents)}
          </span>
        </div>

        {selectedOption.kind === 'next' && (
          <div style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
            Se publicada agora, ela ficará disponível para a equipe quando o mês começar.
          </div>
        )}

        {validation.formError && (
          <div data-testid="form-error" style={{ fontSize: 12.5, color: 'var(--red)' }}>{validation.formError}</div>
        )}
        {saveError && (
          <div data-testid="save-error" style={{ fontSize: 12.5, color: 'var(--red)' }}>{saveError}</div>
        )}
        {successMsg && (
          <div data-testid="save-success" style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>{successMsg}</div>
        )}

        {/* Actions (§25/§26/§29/§37) */}
        {isMd ? (
          <Cluster gap={10}>
            {showSaveChanges && (
              <LBtn kind="gold" icon="check" onClick={() => doSave('published')} style={{ opacity: canSave ? 1 : 0.5 }}>
                {upsert.isPending ? 'Salvando…' : 'Salvar alterações'}
              </LBtn>
            )}
            {showSaveChanges && (
              <LBtn kind="ghost" onClick={() => setPendingWithdraw(true)} style={{ color: 'var(--amber)' }}>
                Retirar publicação
              </LBtn>
            )}
            {showDraftAndPublish && (
              <>
                <LBtn kind="gold" icon="rocket" onClick={() => doSave('published')} style={{ opacity: canSave ? 1 : 0.5 }}>
                  {upsert.isPending ? 'Publicando…' : 'Publicar premiação'}
                </LBtn>
                <LBtn kind="primary" icon="check" onClick={() => doSave('draft')} style={{ opacity: canSave ? 1 : 0.5 }}>
                  Salvar rascunho
                </LBtn>
              </>
            )}
            {(isDirty || isCreating) && (
              <LBtn kind="ghost" onClick={handleCancel}>
                {isCreating ? 'Cancelar' : 'Cancelar alterações'}
              </LBtn>
            )}
          </Cluster>
        ) : (
          <Stack gap={8}>
            {showSaveChanges && (
              <LBtn kind="gold" icon="check" block onClick={() => doSave('published')} style={{ opacity: canSave ? 1 : 0.5 }}>
                {upsert.isPending ? 'Salvando…' : 'Salvar alterações'}
              </LBtn>
            )}
            {showSaveChanges && (
              <LBtn kind="ghost" block onClick={() => setPendingWithdraw(true)} style={{ color: 'var(--amber)' }}>
                Retirar publicação
              </LBtn>
            )}
            {showDraftAndPublish && (
              <>
                <LBtn kind="gold" icon="rocket" block onClick={() => doSave('published')} style={{ opacity: canSave ? 1 : 0.5 }}>
                  {upsert.isPending ? 'Publicando…' : 'Publicar premiação'}
                </LBtn>
                <LBtn kind="primary" icon="check" block onClick={() => doSave('draft')} style={{ opacity: canSave ? 1 : 0.5 }}>
                  Salvar rascunho
                </LBtn>
              </>
            )}
            {(isDirty || isCreating) && (
              <LBtn kind="ghost" block onClick={handleCancel}>
                {isCreating ? 'Cancelar' : 'Cancelar alterações'}
              </LBtn>
            )}
          </Stack>
        )}
      </Stack>
    );

    const previewColumn = (
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t-500)', marginBottom: 8 }}>Prévia para a equipe</div>
        <RewardPreview monthStart={selectedMonth} tiers={draftTiers} />
      </div>
    );

    body = isLg ? (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 24, alignItems: 'start' }}>
        {editorColumn}
        {previewColumn}
      </div>
    ) : (
      <Stack gap={20}>
        {editorColumn}
        {previewColumn}
      </Stack>
    );
  }

  return (
    <LCard style={{ maxWidth: isLg ? 900 : 640 }}>
      {header}
      {monthSelector}
      {discardConfirm}
      {withdrawConfirm}
      {body}
    </LCard>
  );
}
