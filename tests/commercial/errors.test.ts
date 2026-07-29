// Testes de lib/commercial/errors.ts — foco no tradutor centralizado
// getPlatformCommercialErrorMessage (M1-F S8-C2-C2). Cobre os códigos
// estáveis das RPCs de mutation/Sellers/duplicidade e os erros LOCAIS dos
// hooks (pré-RPC), sempre com mensagens PT-BR simples, nunca SQL/UUID/stack.
import { describe, expect, it } from 'vitest';
import { PlatformCommercialError, getPlatformCommercialErrorMessage } from '@/lib/commercial/errors';

describe('getPlatformCommercialErrorMessage — códigos estáveis das RPCs', () => {
  const cases: Array<[string, string]> = [
    ['company_required', 'Selecione uma empresa.'],
    ['company_not_found', 'Esta empresa não foi encontrada.'],
    ['company_read_only', 'Esta empresa está disponível somente para consulta.'],
    ['forbidden', 'Você não tem permissão para esta ação.'],
    ['initial_stage_missing', 'Esta empresa não possui uma etapa inicial configurada.'],
    ['seller_not_found', 'O vendedor selecionado não está mais disponível.'],
    ['lead_not_found', 'Este Lead não foi encontrado.'],
    ['lead_archived', 'Este Lead está arquivado e não pode ser editado.'],
    ['stale_write', 'Este Lead foi alterado em outro lugar. Abra novamente para editar.'],
    ['invalid_phone', 'Informe um telefone válido.'],
    // M1-F S8-C2-D2
    ['stage_not_found', 'A etapa selecionada não está mais disponível.'],
    ['invalid_event', 'Este evento não é reconhecido pelo sistema.'],
  ];

  it.each(cases)('detail.message=%s ⇒ mensagem PT-BR estável', (message, expected) => {
    const error = new PlatformCommercialError('platform_commercial_lead_create_failed', { message });
    expect(getPlatformCommercialErrorMessage(error)).toBe(expected);
  });

  it('código desconhecido ⇒ mensagem genérica de fallback', () => {
    const error = new PlatformCommercialError('platform_commercial_lead_create_failed', { message: 'algo_novo_nao_mapeado' });
    expect(getPlatformCommercialErrorMessage(error)).toBe('Não foi possível concluir esta ação.');
  });

  it('PlatformCommercialError sem detail.message ⇒ fallback genérico', () => {
    const error = new PlatformCommercialError('platform_commercial_sellers_fetch_failed');
    expect(getPlatformCommercialErrorMessage(error)).toBe('Não foi possível concluir esta ação.');
  });
});

describe('getPlatformCommercialErrorMessage — erros locais dos hooks (pré-RPC)', () => {
  it('create-platform-lead-not-allowed ⇒ mensagem de permissão', () => {
    expect(getPlatformCommercialErrorMessage(new Error('create-platform-lead-not-allowed')))
      .toBe('Você não tem permissão para criar Leads nesta empresa.');
  });

  it('create-platform-lead-stale-context ⇒ mensagem de contexto mudou', () => {
    expect(getPlatformCommercialErrorMessage(new Error('create-platform-lead-stale-context')))
      .toBe('A empresa selecionada mudou antes da conclusão. Tente novamente.');
  });

  it('update-platform-lead-not-allowed ⇒ mensagem de permissão', () => {
    expect(getPlatformCommercialErrorMessage(new Error('update-platform-lead-not-allowed')))
      .toBe('Você não tem permissão para editar Leads nesta empresa.');
  });

  it('update-platform-lead-stale-context ⇒ mensagem de contexto mudou', () => {
    expect(getPlatformCommercialErrorMessage(new Error('update-platform-lead-stale-context')))
      .toBe('A empresa selecionada mudou antes da conclusão. Tente novamente.');
  });

  // M1-F S8-C2-D2 — mesmas duas mensagens locais, reaplicadas às seis
  // mutations restantes.
  const localErrorCases: Array<[string, string]> = [
    ['move-platform-lead-not-allowed', 'Você não tem permissão para mover Leads nesta empresa.'],
    ['move-platform-lead-stale-context', 'O contexto da empresa mudou. Tente novamente.'],
    ['apply-platform-lead-event-not-allowed', 'Você não tem permissão para registrar eventos nesta empresa.'],
    ['apply-platform-lead-event-stale-context', 'O contexto da empresa mudou. Tente novamente.'],
    ['assign-platform-lead-seller-not-allowed', 'Você não tem permissão para atribuir vendedores nesta empresa.'],
    ['assign-platform-lead-seller-stale-context', 'O contexto da empresa mudou. Tente novamente.'],
    ['archive-platform-lead-not-allowed', 'Você não tem permissão para arquivar Leads nesta empresa.'],
    ['archive-platform-lead-stale-context', 'O contexto da empresa mudou. Tente novamente.'],
    ['unarchive-platform-lead-not-allowed', 'Você não tem permissão para desarquivar Leads nesta empresa.'],
    ['unarchive-platform-lead-stale-context', 'O contexto da empresa mudou. Tente novamente.'],
    ['add-platform-lead-timeline-entry-not-allowed', 'Você não tem permissão para adicionar entradas nesta empresa.'],
    ['add-platform-lead-timeline-entry-stale-context', 'O contexto da empresa mudou. Tente novamente.'],
  ];

  it.each(localErrorCases)('%s ⇒ mensagem local estável', (message, expected) => {
    expect(getPlatformCommercialErrorMessage(new Error(message))).toBe(expected);
  });
});

describe('getPlatformCommercialErrorMessage — entradas anômalas', () => {
  it('null/undefined ⇒ fallback genérico, nunca lança', () => {
    expect(getPlatformCommercialErrorMessage(null)).toBe('Não foi possível concluir esta ação.');
    expect(getPlatformCommercialErrorMessage(undefined)).toBe('Não foi possível concluir esta ação.');
  });

  it('erro plano sem mensagem conhecida ⇒ fallback genérico, nunca a mensagem crua', () => {
    expect(getPlatformCommercialErrorMessage(new Error('duplicate key value violates unique constraint "leads_pkey"')))
      .toBe('Não foi possível concluir esta ação.');
  });

  it('string solta ⇒ fallback genérico', () => {
    expect(getPlatformCommercialErrorMessage('forbidden')).toBe('Não foi possível concluir esta ação.');
  });
});
