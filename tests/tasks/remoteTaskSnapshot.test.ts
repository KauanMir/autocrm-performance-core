// Testes do snapshot remoto de Tasks (COMMERCIAL-REMOTE-B1-B2-A):
// construção pura + espelho volátil isolado por (companyId, identityKey).
// Sem rede, sem store, sem localStorage.
//
// Diferente de tests/leads/remoteSnapshot.test.ts: build aqui NÃO recebe
// contexto de adapter nem pode falhar por Lead/Seller órfão — o snapshot
// guarda ROWS BRUTAS de propósito (correção arquitetural B1-B2-A-EXEC §0),
// então build só pode falhar por owner inválido.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isRemoteTasksError } from '@/lib/tasks/errors';
import type { RemoteTaskRow } from '@/lib/tasks/taskAdapter';
import {
  buildRemoteTaskSnapshot,
  clearAllRemoteTaskSnapshots,
  clearRemoteTaskSnapshot,
  getRemoteTaskSnapshot,
  setRemoteTaskSnapshot,
} from '@/lib/tasks/remoteTaskSnapshot';

afterEach(() => {
  clearAllRemoteTaskSnapshots();
});

function taskRow(overrides: Partial<RemoteTaskRow> = {}): RemoteTaskRow {
  return {
    id: 'task-1',
    company_id: 'company-a',
    lead_id: 'lead-1',
    assigned_seller_id: 's1',
    title: 'Ligar para Carlos',
    note: '',
    priority: 'alta',
    status: 'pending',
    due_at: '2026-08-21T17:00:00+00:00',
    completed_at: null,
    created_by: 'profile-1',
    updated_by: 'profile-1',
    completed_by: null,
    created_at: '2026-08-20T10:00:00+00:00',
    updated_at: '2026-08-20T10:00:00+00:00',
    version: 1,
    ...overrides,
  };
}

const OWNER = { companyId: 'company-a', identityKey: 'user-admin' };

describe('buildRemoteTaskSnapshot', () => {
  it('grava rows BRUTAS (nunca adaptadas) e o dono, preservando a ordem', () => {
    const rows = [taskRow({ id: 'task-b' }), taskRow({ id: 'task-a' })];
    const snapshot = buildRemoteTaskSnapshot(rows, OWNER);
    expect(snapshot.source).toBe('remote');
    expect(snapshot.companyId).toBe('company-a');
    expect(snapshot.identityKey).toBe('user-admin');
    expect(snapshot.rows.map((r) => r.id)).toEqual(['task-b', 'task-a']);
    // Rows continuam no shape cru do banco — nenhum campo de RemoteTaskModel
    // (state/when/prio/lead/assignedTo) é adicionado aqui.
    expect(snapshot.rows[0]).toHaveProperty('due_at');
    expect(snapshot.rows[0]).not.toHaveProperty('state');
    expect(snapshot.rows[0]).not.toHaveProperty('when');
  });

  it('lista remota vazia vira snapshot VÁLIDO com rows: [] — nunca tasks locais', () => {
    const snapshot = buildRemoteTaskSnapshot([], OWNER);
    expect(snapshot.rows).toEqual([]);
  });

  it('cópia defensiva: mutar o array original depois de construir não contamina o snapshot', () => {
    const rows = [taskRow({ id: 'task-1' })];
    const snapshot = buildRemoteTaskSnapshot(rows, OWNER);
    rows.push(taskRow({ id: 'task-intruso' }));
    expect(snapshot.rows.map((r) => r.id)).toEqual(['task-1']);
  });

  it('companyId ou identityKey vazios ⇒ remote_tasks_invalid_context', () => {
    let caught: unknown = null;
    try { buildRemoteTaskSnapshot([], { companyId: '', identityKey: 'u' }); } catch (e) { caught = e; }
    expect(isRemoteTasksError(caught)).toBe(true);
    if (isRemoteTasksError(caught)) expect(caught.code).toBe('remote_tasks_invalid_context');

    expect(() => buildRemoteTaskSnapshot([], { companyId: 'c', identityKey: '  ' }))
      .toThrow('remote_tasks_invalid_context');
  });

  it('snapshot não carrega sessão/token/cliente/função', () => {
    const snapshot = buildRemoteTaskSnapshot([taskRow()], OWNER);
    expect(Object.keys(snapshot).sort()).toEqual(['companyId', 'identityKey', 'rows', 'source']);
    for (const value of Object.values(snapshot)) {
      expect(typeof value).not.toBe('function');
    }
  });
});

describe('espelho volátil — isolamento por (companyId, identityKey)', () => {
  it('mesmo usuário + mesma empresa acessa o snapshot', () => {
    const snapshot = buildRemoteTaskSnapshot([taskRow()], OWNER);
    setRemoteTaskSnapshot(snapshot);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBe(snapshot);
  });

  it('usuário DIFERENTE da mesma empresa não acessa (admin → seller)', () => {
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow()], OWNER));
    expect(getRemoteTaskSnapshot('company-a', 'user-seller-1')).toBeNull();
  });

  it('seller A → seller B da mesma empresa não reutiliza snapshot', () => {
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow()], {
      companyId: 'company-a', identityKey: 'user-seller-1',
    }));
    expect(getRemoteTaskSnapshot('company-a', 'user-seller-2')).toBeNull();
  });

  it('mesmo usuário + empresa DIFERENTE não acessa', () => {
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow()], OWNER));
    expect(getRemoteTaskSnapshot('company-b', 'user-admin')).toBeNull();
  });

  it('identidade ausente (logout) nunca acessa o snapshot anterior', () => {
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow()], OWNER));
    expect(getRemoteTaskSnapshot(null, null)).toBeNull();
    expect(getRemoteTaskSnapshot('company-a', null)).toBeNull();
    expect(getRemoteTaskSnapshot('company-a', undefined)).toBeNull();
    expect(getRemoteTaskSnapshot('company-a', '')).toBeNull();
  });

  it('clear escopado remove somente o snapshot do dono exato', () => {
    const snapshot = buildRemoteTaskSnapshot([taskRow()], OWNER);
    setRemoteTaskSnapshot(snapshot);

    expect(clearRemoteTaskSnapshot('company-a', 'user-outro')).toBe(false);
    expect(clearRemoteTaskSnapshot('company-b', 'user-admin')).toBe(false);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBe(snapshot);

    expect(clearRemoteTaskSnapshot('company-a', 'user-admin')).toBe(true);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBeNull();
    expect(clearRemoteTaskSnapshot('company-a', 'user-admin')).toBe(false); // idempotente
  });

  it('substituição troca o snapshot por inteiro (mesmas rows não se acumulam)', () => {
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow({ id: 'task-old' })], OWNER));
    const second = buildRemoteTaskSnapshot([], OWNER);
    setRemoteTaskSnapshot(second);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')).toBe(second);
    expect(getRemoteTaskSnapshot('company-a', 'user-admin')?.rows).toEqual([]);
  });

  it('nenhum acesso a localStorage em set/get/clear', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setRemoteTaskSnapshot(buildRemoteTaskSnapshot([taskRow()], OWNER));
    getRemoteTaskSnapshot('company-a', 'user-admin');
    clearRemoteTaskSnapshot('company-a', 'user-admin');
    clearAllRemoteTaskSnapshots();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
