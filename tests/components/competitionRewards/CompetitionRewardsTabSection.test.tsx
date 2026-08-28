// COMPETITION-REWARDS-V1-B2-EXEC §52-§60 — a aba "Competição" (config da
// premiação). Os dois hooks e useViewport são mockados; o comportamento
// interno de cada hook já tem cobertura própria. buildRewardMonthOptions é
// fixado (agosto=current / setembro=next) para não depender do relógio.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CompetitionRewardCampaignState } from '@/lib/hooks/useCompetitionRewardCampaign';
import type { RewardCampaignModel } from '@/lib/competitionRewards/adapter';
import { CompetitionRewardError } from '@/lib/competitionRewards/errors';

const m = vi.hoisted(() => ({
  useCampaign: vi.fn(),
  useUpsert: vi.fn(),
  upsertCampaign: vi.fn(),
  isMd: true,
  isLg: false,
}));

vi.mock('@/lib/hooks/useCompetitionRewardCampaign', () => ({
  useCompetitionRewardCampaign: m.useCampaign,
}));
vi.mock('@/lib/hooks/useUpsertCompetitionRewardCampaign', () => ({
  useUpsertCompetitionRewardCampaign: m.useUpsert,
}));
vi.mock('@/lib/hooks/useViewport', () => ({
  useViewport: () => ({ isSm: true, isMd: m.isMd, isLg: m.isLg, isDesktop: m.isLg }),
}));
vi.mock('@/lib/competitionRewards/monthOptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/competitionRewards/monthOptions')>();
  return {
    ...actual,
    buildRewardMonthOptions: () => [
      { monthStart: '2026-08-01', label: 'Agosto 2026', kind: 'current' as const },
      { monthStart: '2026-09-01', label: 'Setembro 2026', kind: 'next' as const },
    ],
  };
});

import { CompetitionRewardsTabSection } from '@/components/competitionRewards/CompetitionRewardsTabSection';

function campaign(over: Partial<RewardCampaignModel> = {}): RewardCampaignModel {
  return {
    id: 'camp-1', monthStart: '2026-08-01', timezone: 'America/Sao_Paulo',
    status: 'draft', title: 'Agosto', publishedAt: null, updatedAt: '2026-07-20T10:00:00Z',
    tiers: [{ position: 1, amountCents: 100000, rewardText: null }],
    ...over,
  };
}

function ready(camp: RewardCampaignModel | null, monthStart = '2026-08-01'): CompetitionRewardCampaignState {
  return { status: 'ready', config: { monthStart, campaign: camp } };
}

function setCampaignState(byMonth: (monthStart: string) => CompetitionRewardCampaignState) {
  m.useCampaign.mockImplementation((opts: { monthStart: string | null }) =>
    byMonth(opts.monthStart ?? '2026-08-01'));
}

const PROPS = { userId: 'u-mgr', companyId: 'co-a', readAuthorized: true, writeAuthorized: true };

beforeEach(() => {
  m.isMd = true;
  m.isLg = false;
  m.upsertCampaign.mockReset().mockResolvedValue({
    id: 'camp-1', monthStart: '2026-08-01', status: 'draft', title: null, publishedAt: null, updatedAt: 'x',
  });
  m.useUpsert.mockReset().mockReturnValue({
    upsertCampaign: m.upsertCampaign, isPending: false, isError: false, isSuccess: false, error: null, reset: vi.fn(),
  });
  setCampaignState(() => ready(null));
});

function renderTab(props = PROPS) {
  return render(<CompetitionRewardsTabSection {...props} />);
}

// ───────────────────────────────────────────────────────────────────────

describe('acesso', () => {
  it('readAuthorized=false → mensagem de acesso negado, sem editor', () => {
    renderTab({ ...PROPS, readAuthorized: false });
    expect(screen.getByTestId('competition-rewards-denied')).toBeInTheDocument();
  });
});

describe('month selector (§5)', () => {
  it('mostra Agosto 2026 (atual) e Setembro 2026 (próximo)', () => {
    renderTab();
    expect(screen.getByText('Agosto 2026')).toBeInTheDocument();
    expect(screen.getByText('Setembro 2026')).toBeInTheDocument();
  });
});

describe('loading (§34)', () => {
  it('não pisca empty state antes da RPC resolver', () => {
    m.useCampaign.mockReturnValue({ status: 'loading' });
    renderTab();
    expect(screen.getByTestId('competition-rewards-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('competition-rewards-empty')).toBeNull();
    // selector segue visível
    expect(screen.getByText('Agosto 2026')).toBeInTheDocument();
  });
});

describe('empty state + create (§8/§9)', () => {
  it('sem campanha → copy natural + botão Criar premiação', () => {
    renderTab();
    const empty = screen.getByTestId('competition-rewards-empty');
    expect(within(empty).getByText(/Premiação de Agosto/)).toBeInTheDocument();
    expect(within(empty).getByText(/ainda mais interessante/)).toBeInTheDocument();
    expect(screen.getByText('Criar premiação')).toBeInTheDocument();
  });

  it('clicar Criar premiação abre o editor inline com 1 colocação', () => {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    expect(screen.getByTestId('tier-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-row-2')).toBeNull();
    // ações de criação
    expect(screen.getByText('Publicar premiação')).toBeInTheDocument();
    expect(screen.getByText('Salvar rascunho')).toBeInTheDocument();
  });
});

describe('tier editor (§12/§13/§14/§15)', () => {
  function openCreate() {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
  }

  it('Adicionar colocação cria a próxima posição (Manager não digita position)', () => {
    openCreate();
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    expect(screen.getByTestId('tier-row-2')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    expect(screen.getByTestId('tier-row-3')).toBeInTheDocument();
  });

  it('remover uma posição intermediária renumera (3→2, sem buracos)', () => {
    openCreate();
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    // preenche p/ diferenciar
    fireEvent.change(screen.getByLabelText('Prêmio extra do 1º lugar'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Prêmio extra do 2º lugar'), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText('Prêmio extra do 3º lugar'), { target: { value: 'C' } });
    fireEvent.click(screen.getByLabelText('Remover prêmio do 2º lugar'));
    expect(screen.getByTestId('tier-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('tier-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-row-3')).toBeNull();
    // o antigo 3º ("C") agora é o 2º
    expect((screen.getByLabelText('Prêmio extra do 2º lugar') as HTMLInputElement).value).toBe('C');
  });

  it('máximo 10 colocações → "Adicionar colocação" some no 10º', () => {
    openCreate();
    for (let i = 0; i < 12; i++) {
      const btn = screen.queryByLabelText('Adicionar colocação');
      if (btn) fireEvent.click(btn);
    }
    expect(screen.getByTestId('tier-row-10')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-row-11')).toBeNull();
    expect(screen.queryByLabelText('Adicionar colocação')).toBeNull();
  });

  it('não deixa remover a última colocação (mínimo 1 — §15)', () => {
    openCreate();
    expect(screen.queryByLabelText('Remover prêmio do 1º lugar')).toBeNull();
  });
});

describe('validação (§20)', () => {
  function openCreate() {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
  }

  it('tier vazio (sem valor e sem texto) → erro inline', () => {
    openCreate();
    expect(screen.getByTestId('tier-error-1')).toHaveTextContent('Informe um valor ou um prêmio.');
  });

  it('valor zero → erro "maior que zero"', () => {
    openCreate();
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '0' } });
    expect(screen.getByTestId('tier-error-1')).toHaveTextContent('maior que zero');
  });

  it('money only é válido (sem erro)', () => {
    openCreate();
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '100000' } });
    expect(screen.queryByTestId('tier-error-1')).toBeNull();
  });

  it('text only é válido (sem erro)', () => {
    openCreate();
    fireEvent.change(screen.getByLabelText('Prêmio extra do 1º lugar'), { target: { value: 'iPhone 17' } });
    expect(screen.queryByTestId('tier-error-1')).toBeNull();
  });
});

describe('total (§21/§56)', () => {
  it('soma os valores em tempo real; texto não entra', () => {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '100000' } });
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 2º lugar'), { target: { value: '50000' } });
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    fireEvent.change(screen.getByLabelText('Prêmio extra do 3º lugar'), { target: { value: 'Folga' } });
    expect(screen.getByTestId('reward-total')).toHaveTextContent('R$ 1.500,00');
  });
});

describe('preview (§23/§24)', () => {
  it('money / text / combined; sem "R$ 0" quando não há valor', () => {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText('Prêmio extra do 1º lugar'), { target: { value: '1 dia de folga' } });
    fireEvent.click(screen.getByLabelText('Adicionar colocação'));
    fireEvent.change(screen.getByLabelText('Prêmio extra do 2º lugar'), { target: { value: 'iPhone 17' } });

    const preview = screen.getByTestId('reward-preview');
    expect(preview).toHaveTextContent('PRÊMIOS DE AGOSTO');
    expect(preview).toHaveTextContent('R$ 1.000,00');
    expect(preview).toHaveTextContent('1 dia de folga');
    expect(preview).toHaveTextContent('iPhone 17');
    expect(preview).not.toHaveTextContent('R$ 0,00');
    expect(preview.textContent ?? '').not.toMatch(/Valor não informado|Sem valor/);
  });
});

describe('draft / publish payload (§25/§26/§57)', () => {
  it('Salvar rascunho → upsert status=draft, month_start=2026-08-01', async () => {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '100000' } });
    fireEvent.click(screen.getByText('Salvar rascunho'));
    await screen.findByTestId('save-success');
    expect(m.upsertCampaign).toHaveBeenCalledWith(expect.objectContaining({
      monthStart: '2026-08-01', status: 'draft',
      tiers: [{ amountCents: 100000, rewardText: null }],
    }));
    expect(screen.getByTestId('save-success')).toHaveTextContent('Rascunho salvo.');
  });

  it('Publicar premiação → status=published + copy neutra', async () => {
    m.upsertCampaign.mockResolvedValue({
      id: 'camp-1', monthStart: '2026-08-01', status: 'published', title: null, publishedAt: 'x', updatedAt: 'y',
    });
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    fireEvent.change(screen.getByLabelText('Prêmio extra do 1º lugar'), { target: { value: 'iPhone 17' } });
    fireEvent.click(screen.getByText('Publicar premiação'));
    await screen.findByTestId('save-success');
    expect(m.upsertCampaign).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
      tiers: [{ amountCents: null, rewardText: 'iPhone 17' }],
    }));
    expect(screen.getByTestId('save-success')).toHaveTextContent('Premiação publicada com sucesso.');
  });

  it('erro no save preserva o que foi digitado (§36)', async () => {
    m.upsertCampaign.mockRejectedValue(new CompetitionRewardError('reward_campaign_month_closed'));
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '100000' } });
    fireEvent.click(screen.getByText('Salvar rascunho'));
    await screen.findByTestId('save-error');
    expect(screen.getByTestId('save-error')).toHaveTextContent('Este mês já foi encerrado');
    // editor + valor digitado continuam lá
    expect((screen.getByLabelText('Valor em dinheiro do 1º lugar') as HTMLInputElement).value).toBe('R$ 1.000,00');
  });
});

describe('campanha existente', () => {
  it('draft carregado → "Salvar rascunho" + "Publicar premiação" (§31)', () => {
    setCampaignState(() => ready(campaign({ status: 'draft', title: 'Agosto', tiers: [{ position: 1, amountCents: 100000, rewardText: null }] })));
    renderTab();
    expect(screen.getByText('Salvar rascunho')).toBeInTheDocument();
    expect(screen.getByText('Publicar premiação')).toBeInTheDocument();
    expect((screen.getByLabelText('Título da campanha') as HTMLInputElement).value).toBe('Agosto');
  });

  it('published carregado → só "Salvar alterações"; SEM despublicar / rascunho (§29/§30)', () => {
    setCampaignState(() => ready(campaign({ status: 'published', publishedAt: '2026-07-20T10:00:00Z' })));
    renderTab();
    expect(screen.getByText('Salvar alterações')).toBeInTheDocument();
    expect(screen.queryByText('Salvar rascunho')).toBeNull();
    expect(screen.queryByText('Publicar premiação')).toBeNull();
    expect(screen.queryByText(/Despublicar|Voltar para rascunho/)).toBeNull();
    expect(screen.getByText('Publicado')).toBeInTheDocument();
  });

  it('editar published mantém status=published no payload', async () => {
    setCampaignState(() => ready(campaign({ status: 'published', publishedAt: '2026-07-20T10:00:00Z' })));
    m.upsertCampaign.mockResolvedValue({ id: 'camp-1', monthStart: '2026-08-01', status: 'published', title: 'x', publishedAt: '2026-07-20T10:00:00Z', updatedAt: 'y' });
    renderTab();
    fireEvent.change(screen.getByLabelText('Valor em dinheiro do 1º lugar'), { target: { value: '200000' } });
    fireEvent.click(screen.getByText('Salvar alterações'));
    await screen.findByTestId('save-success');
    expect(m.upsertCampaign).toHaveBeenCalledWith(expect.objectContaining({ status: 'published' }));
    expect(screen.getByTestId('save-success')).toHaveTextContent('Alterações salvas.');
  });
});

describe('dirty state + cancel (§37/§38/§58)', () => {
  it('carregado limpo → sem botão Cancelar; editar → aparece; Cancelar restaura', () => {
    setCampaignState(() => ready(campaign({ status: 'draft', title: 'Agosto' })));
    renderTab();
    expect(screen.queryByText('Cancelar alterações')).toBeNull();

    fireEvent.change(screen.getByLabelText('Título da campanha'), { target: { value: 'Novo título' } });
    expect(screen.getByText('Cancelar alterações')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Cancelar alterações'));
    expect((screen.getByLabelText('Título da campanha') as HTMLInputElement).value).toBe('Agosto');
    expect(screen.queryByText('Cancelar alterações')).toBeNull();
  });

  it('criar → Cancelar volta ao empty state', () => {
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    fireEvent.click(screen.getByText('Cancelar'));
    expect(screen.getByTestId('competition-rewards-empty')).toBeInTheDocument();
  });
});

describe('troca de mês com alterações não salvas (§7)', () => {
  it('pede confirmação e só troca ao Descartar', () => {
    setCampaignState((month) =>
      month === '2026-09-01' ? ready(null, '2026-09-01') : ready(campaign({ title: 'Agosto' })));
    renderTab();
    fireEvent.change(screen.getByLabelText('Título da campanha'), { target: { value: 'editado' } });

    fireEvent.click(screen.getByText('Setembro 2026'));
    expect(screen.getByTestId('discard-confirm')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Continuar editando'));
    expect(screen.queryByTestId('discard-confirm')).toBeNull();
    expect((screen.getByLabelText('Título da campanha') as HTMLInputElement).value).toBe('editado');

    fireEvent.click(screen.getByText('Setembro 2026'));
    fireEvent.click(screen.getByText('Descartar'));
    expect(screen.getByTestId('competition-rewards-empty')).toBeInTheDocument();
  });
});

describe('mês futuro (§27)', () => {
  it('selecionar Setembro mostra a nota de publicação antecipada', () => {
    setCampaignState((month) =>
      month === '2026-09-01' ? ready(null, '2026-09-01') : ready(null));
    renderTab();
    fireEvent.click(screen.getByText('Setembro 2026'));
    fireEvent.click(screen.getByText('Criar premiação'));
    expect(screen.getByText(/ficará disponível para a equipe quando o mês começar/)).toBeInTheDocument();
  });
});

describe('mobile (§41/§60)', () => {
  it('em < md o editor ainda renderiza (stack)', () => {
    m.isMd = false;
    renderTab();
    fireEvent.click(screen.getByText('Criar premiação'));
    expect(screen.getByTestId('tier-row-1')).toBeInTheDocument();
    expect(screen.getByText('Publicar premiação')).toBeInTheDocument();
  });
});
