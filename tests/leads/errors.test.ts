// Testes da extensão aditiva de lib/leads/errors.ts (M1-E, E4-B1):
// mapRemoteLeadsMutationError e createIdentityChangedMutationError. Os 4
// códigos do E3 (RemoteLeadsError/isRemoteLeadsError) já são cobertos
// indiretamente pelos testes existentes de remoteRepository/remoteSnapshot
// — este arquivo cobre exclusivamente o grupo de mutation novo.
import { describe, expect, it } from 'vitest';
import {
  mapRemoteLeadsMutationError,
  createIdentityChangedMutationError,
  isRemoteLeadsError,
  RemoteLeadsError,
} from '@/lib/leads/errors';

describe('mapRemoteLeadsMutationError — mensagens conhecidas', () => {
  const cases: Array<[string, string]> = [
    ['forbidden', 'remote_leads_mutation_forbidden'],
    ['company_required', 'remote_leads_mutation_company_required'],
    ['company_not_found', 'remote_leads_mutation_company_not_found'],
    ['company_read_only', 'remote_leads_mutation_company_read_only'],
    ['lead_not_found', 'remote_leads_mutation_lead_not_found'],
    ['lead_archived', 'remote_leads_mutation_lead_archived'],
    ['seller_not_found', 'remote_leads_mutation_seller_not_found'],
    ['initial_stage_missing', 'remote_leads_mutation_initial_stage_missing'],
    ['invalid_phone', 'remote_leads_mutation_invalid_phone'],
    // M1-E E5-A1 — stage_not_found (move_lead_to_stage/apply_lead_event).
    ['stage_not_found', 'remote_leads_mutation_stage_not_found'],
    ['stale_write', 'remote_leads_mutation_stale_write'],
  ];

  it.each(cases)('mensagem "%s" mapeia para o código "%s"', (message, expectedCode) => {
    const error = mapRemoteLeadsMutationError({ code: '42501', message }, 'create_lead');
    expect(error).toBeInstanceOf(RemoteLeadsError);
    expect(error.code).toBe(expectedCode);
  });

  it('preserva code/message/operation em detail, sem outro campo', () => {
    // Erro real do Supabase carrega mais campos do que o tipo declarado
    // aceita (por isso a variável intermediária: TS só faz excess property
    // checking em literais atribuídos diretamente ao parâmetro).
    const rawSupabaseError = { code: '42501', message: 'forbidden', apikey: 'nunca-copiar', details: 'interno' };
    const error = mapRemoteLeadsMutationError(rawSupabaseError, 'create_lead');
    expect(error.detail).toEqual({ code: '42501', message: 'forbidden', operation: 'create_lead' });
    expect(JSON.stringify(error.detail)).not.toContain('nunca-copiar');
  });
});

describe('mapRemoteLeadsMutationError — mensagem desconhecida', () => {
  it('mensagem não reconhecida vira SEMPRE generic_error, nunca stale_write/forbidden por adivinhação', () => {
    const error = mapRemoteLeadsMutationError({ code: 'XX000', message: 'algo_nunca_visto' }, 'update_lead');
    expect(error.code).toBe('remote_leads_mutation_generic_error');
    expect(error.detail.message).toBe('algo_nunca_visto');
  });

  it('sem message (undefined/não-string) também vira generic_error', () => {
    const error = mapRemoteLeadsMutationError({ code: 'XX000' }, 'check_lead_phone_duplicate');
    expect(error.code).toBe('remote_leads_mutation_generic_error');
    expect(error.detail.message).toBeUndefined();
  });
});

describe('createIdentityChangedMutationError', () => {
  it('produz RemoteLeadsError com código identity_changed e a operação informada', () => {
    const error = createIdentityChangedMutationError('create_lead');
    expect(isRemoteLeadsError(error)).toBe(true);
    expect(error.code).toBe('remote_leads_mutation_identity_changed');
    expect(error.detail).toEqual({ operation: 'create_lead' });
  });

  it('nunca carrega code/message de backend (é sempre um erro local)', () => {
    const error = createIdentityChangedMutationError('update_lead');
    expect(error.detail.code).toBeUndefined();
    expect(error.detail.message).toBeUndefined();
  });
});
