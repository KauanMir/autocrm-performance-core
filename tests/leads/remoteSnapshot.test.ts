// Testes do snapshot remoto de leads (M1-E, E3): construção pura + espelho
// volátil isolado por (companyId, identityKey). Sem rede, sem store, sem
// localStorage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipelineStage } from '@/lib/pipeline/adapter';
import type { LeadRow } from '@/lib/supabase/types';
import type { LeadAdapterContext } from '@/lib/leads/adapter';
import { isRemoteLeadsError } from '@/lib/leads/errors';
import {
  buildRemoteLeadSnapshot,
  clearAllRemoteLeadSnapshots,
  clearRemoteLeadSnapshot,
  getRemoteLeadSnapshot,
  setRemoteLeadSnapshot,
} from '@/lib/leads/remoteSnapshot';

afterEach(() => {
  clearAllRemoteLeadSnapshots();
});

function leadRow(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead-1',
    company_id: 'company-a',
    name: 'Carlos Andrade',
    phone: '(11) 99421-1190',
    phone_digits: '11994211190',
    car: 'Golf GTI 2022',
    stage_id: 'stage-new',
    seller_id: 's1',
    urgency: 'red',
    temperature: null,
    last_activity_label: 'Sem contato ainda',
    alert_label: 'Fazer primeiro contato',
    payment_preference: null,
    value_amount: null,
    source: null,
    created_by_profile_id: null,
    updated_by_profile_id: null,
    archived_at: null,
    version: 1,
    created_at: '2026-07-19T12:00:00+00:00',
    updated_at: '2026-07-19T12:00:00+00:00',
    ...overrides,
  };
}

function stage(id: string, code: string, name: string): PipelineStage {
  return { id, code, name, sortOrder: 0, isTerminal: false };
}

function makeContext(): LeadAdapterContext {
  return {
    stagesById: { 'stage-new': stage('stage-new', 'new', 'Novo') },
    sellersById: { s1: { id: 's1', name: 'Marcos Silva' } },
  };
}

const OWNER = { companyId: 'company-a', identityKey: 'user-admin' };

describe('buildRemoteLeadSnapshot', () => {
  it('adapta as rows via adaptLeadRows preservando a ordem e grava o dono', () => {
    const rows = [leadRow({ id: 'lead-b' }), leadRow({ id: 'lead-a', seller_id: null })];
    const snapshot = buildRemoteLeadSnapshot(rows, makeContext(), OWNER);
    expect(snapshot.source).toBe('remote');
    expect(snapshot.companyId).toBe('company-a');
    expect(snapshot.identityKey).toBe('user-admin');
    expect(snapshot.leads.map((l) => l.id)).toEqual(['lead-b', 'lead-a']);
    expect(snapshot.leads[0].stage).toBe('Novo');
    expect(snapshot.leads[0].seller).toBe('Marcos Silva');
    expect(snapshot.leads[1].seller).toBe('—');
  });

  it('lista remota vazia vira snapshot VÁLIDO com leads: [] — nunca leads locais', () => {
    const snapshot = buildRemoteLeadSnapshot([], makeContext(), OWNER);
    expect(snapshot.leads).toEqual([]);
  });

  it('não muta rows nem context', () => {
    const rows = [leadRow()];
    const context = makeContext();
    const rowsBefore = JSON.parse(JSON.stringify(rows));
    const contextBefore = JSON.parse(JSON.stringify(context));
    buildRemoteLeadSnapshot(rows, context, OWNER);
    expect(rows).toEqual(rowsBefore);
    expect(context).toEqual(contextBefore);
  });

  it('stage órfão propaga como remote_leads_invalid_context com a causa do adapter', () => {
    const rows = [leadRow({ id: 'lead-ok' }), leadRow({ id: 'lead-ruim', stage_id: 'stage-x' })];
    let caught: unknown = null;
    try {
      buildRemoteLeadSnapshot(rows, makeContext(), OWNER);
    } catch (e) {
      caught = e;
    }
    expect(isRemoteLeadsError(caught)).toBe(true);
    if (!isRemoteLeadsError(caught)) return;
    expect(caught.code).toBe('remote_leads_invalid_context');
    expect(caught.detail.adapterError?.code).toBe('stage_not_found');
    expect(caught.detail.adapterError?.leadId).toBe('lead-ruim');
    expect(caught.detail.adapterError?.rowIndex).toBe(1);
  });

  it('seller órfão propaga da mesma forma — nenhum registro é pulado', () => {
    const rows = [leadRow({ seller_id: 's-fantasma' })];
    const caught = ((): unknown => {
      try { buildRemoteLeadSnapshot(rows, makeContext(), OWNER); } catch (e) { return e; }
      return null;
    })();
    expect(isRemoteLeadsError(caught)).toBe(true);
    if (!isRemoteLeadsError(caught)) return;
    expect(caught.code).toBe('remote_leads_invalid_context');
    expect(caught.detail.adapterError?.code).toBe('seller_not_found');
  });

  it('companyId ou identityKey vazios ⇒ remote_leads_invalid_context', () => {
    expect(() => buildRemoteLeadSnapshot([], makeContext(), { companyId: '', identityKey: 'u' }))
      .toThrow('remote_leads_invalid_context');
    expect(() => buildRemoteLeadSnapshot([], makeContext(), { companyId: 'c', identityKey: '  ' }))
      .toThrow('remote_leads_invalid_context');
  });

  it('timeline não é inventada e o snapshot não carrega sessão/token/cliente/função', () => {
    const snapshot = buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER);
    expect(snapshot.leads[0].timeline).toBeUndefined();
    expect(Object.keys(snapshot).sort()).toEqual(['companyId', 'identityKey', 'leads', 'source']);
    for (const value of Object.values(snapshot)) {
      expect(typeof value).not.toBe('function');
    }
  });
});

describe('espelho volátil — isolamento por (companyId, identityKey)', () => {
  it('mesmo usuário + mesma empresa acessa o snapshot', () => {
    const snapshot = buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER);
    setRemoteLeadSnapshot(snapshot);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBe(snapshot);
  });

  it('usuário DIFERENTE da mesma empresa não acessa (admin → seller)', () => {
    setRemoteLeadSnapshot(buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER));
    expect(getRemoteLeadSnapshot('company-a', 'user-seller-1')).toBeNull();
  });

  it('seller A → seller B da mesma empresa não reutiliza snapshot', () => {
    setRemoteLeadSnapshot(buildRemoteLeadSnapshot([leadRow()], makeContext(), {
      companyId: 'company-a', identityKey: 'user-seller-1',
    }));
    expect(getRemoteLeadSnapshot('company-a', 'user-seller-2')).toBeNull();
  });

  it('mesmo usuário + empresa DIFERENTE não acessa', () => {
    setRemoteLeadSnapshot(buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER));
    expect(getRemoteLeadSnapshot('company-b', 'user-admin')).toBeNull();
  });

  it('identidade ausente (logout) nunca acessa o snapshot anterior', () => {
    setRemoteLeadSnapshot(buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER));
    expect(getRemoteLeadSnapshot(null, null)).toBeNull();
    expect(getRemoteLeadSnapshot('company-a', null)).toBeNull();
    expect(getRemoteLeadSnapshot('company-a', undefined)).toBeNull();
    expect(getRemoteLeadSnapshot('company-a', '')).toBeNull();
  });

  it('clear escopado remove somente o snapshot do dono exato', () => {
    const snapshot = buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER);
    setRemoteLeadSnapshot(snapshot);

    // Dono errado: nada é removido, nada é retornado como fallback.
    expect(clearRemoteLeadSnapshot('company-a', 'user-outro')).toBe(false);
    expect(clearRemoteLeadSnapshot('company-b', 'user-admin')).toBe(false);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBe(snapshot);

    // Dono exato: remove e reporta a transição.
    expect(clearRemoteLeadSnapshot('company-a', 'user-admin')).toBe(true);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBeNull();
    expect(clearRemoteLeadSnapshot('company-a', 'user-admin')).toBe(false); // idempotente
  });

  it('substituição troca o snapshot por inteiro', () => {
    setRemoteLeadSnapshot(buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER));
    const second = buildRemoteLeadSnapshot([], makeContext(), OWNER);
    setRemoteLeadSnapshot(second);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')).toBe(second);
    expect(getRemoteLeadSnapshot('company-a', 'user-admin')?.leads).toEqual([]);
  });

  it('nenhum acesso a localStorage em set/get/clear', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setRemoteLeadSnapshot(buildRemoteLeadSnapshot([leadRow()], makeContext(), OWNER));
    getRemoteLeadSnapshot('company-a', 'user-admin');
    clearRemoteLeadSnapshot('company-a', 'user-admin');
    clearAllRemoteLeadSnapshots();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
