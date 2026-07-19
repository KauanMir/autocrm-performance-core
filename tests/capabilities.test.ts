// Testes das capabilities puras (M1-D, commit 8).
import { describe, expect, it } from 'vitest';
import {
  canAccessFullSettings,
  canAccessStageSettings,
  canReorderPipelineStages,
} from '@/lib/capabilities';

const admin = { role: 'admin' } as const;
const manager = { role: 'manager' } as const;
const seller = { role: 'seller' } as const;

describe('canAccessFullSettings', () => {
  it('admin acessa full settings', () => expect(canAccessFullSettings(admin)).toBe(true));
  it('manager não acessa full settings', () => expect(canAccessFullSettings(manager)).toBe(false));
  it('seller não acessa full settings', () => expect(canAccessFullSettings(seller)).toBe(false));
});

describe('canAccessStageSettings', () => {
  it('admin acessa stage settings', () => expect(canAccessStageSettings(admin)).toBe(true));
  it('manager acessa stage settings', () => expect(canAccessStageSettings(manager)).toBe(true));
  it('seller não acessa stage settings', () => expect(canAccessStageSettings(seller)).toBe(false));
});

describe('canReorderPipelineStages', () => {
  it('admin pode reordenar', () => expect(canReorderPipelineStages(admin)).toBe(true));
  it('manager pode reordenar', () => expect(canReorderPipelineStages(manager)).toBe(true));
  it('seller não pode reordenar', () => expect(canReorderPipelineStages(seller)).toBe(false));
});

describe('entradas nulas e integridade', () => {
  it('null retorna false nas três', () => {
    expect(canAccessFullSettings(null)).toBe(false);
    expect(canAccessStageSettings(null)).toBe(false);
    expect(canReorderPipelineStages(null)).toBe(false);
  });

  it('undefined retorna false nas três', () => {
    expect(canAccessFullSettings(undefined)).toBe(false);
    expect(canAccessStageSettings(undefined)).toBe(false);
    expect(canReorderPipelineStages(undefined)).toBe(false);
  });

  it('o objeto do usuário não é modificado', () => {
    const user = { role: 'manager' as const };
    const frozen = Object.freeze(user);
    canAccessFullSettings(frozen);
    canAccessStageSettings(frozen);
    canReorderPipelineStages(frozen);
    expect(user).toEqual({ role: 'manager' });
  });
});
