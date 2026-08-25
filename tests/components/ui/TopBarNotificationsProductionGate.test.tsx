// PILOT-UI-TRUTH-FIXES-R1-EXEC §8 — achado surgido durante a execução deste
// lote (fora do escopo original do PILOT-UI-TRUTH-AUDIT-A1): o sino de
// notificações do TopBar (components/ui/kit.tsx) é um SEGUNDO ponto de
// entrada, independente do TweaksPanel, para FlowNotificacoes — cujo
// conteúdo ("Hoje"/"Esta semana") é hardcoded incondicionalmente. TopBar
// monta em toda tela exceto Início (Clientes/Andamento/Pendências/Visitas/
// Propostas/Vendas/Resultados/Ajustes/Empresas), para Manager/Seller/Super
// Admin reais — só gatear o TweaksPanel não bastava para cumprir o objetivo
// do §8 ("não pode mais ser alcançável por usuário remoto real"). Mesmo
// contrato de NODE_ENV que já gateia TweaksPanel/AuthFlow.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from '@/components/ui/kit';

describe('TopBar — sino de notificações em produção/preview (NODE_ENV padrão de teste)', () => {
  it('o botão do sino não é renderizado', () => {
    render(<TopBar />);
    // Busca do topo (⌘K) continua presente — só o sino é removido.
    expect(screen.getByPlaceholderText('Buscar cliente, telefone, veículo...')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('TopBar — sino de notificações em dev preview (NODE_ENV=development)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('o botão do sino continua disponível', () => {
    render(<TopBar />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
