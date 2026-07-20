// Testes das feature flags remotas (M1-D stages + M1-E leads).
// Isolamento: vi.stubEnv/unstubAllEnvs para env, localStorage limpo e globals
// restaurados após cada teste — nenhum teste depende de ordem.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRemoteLeadsEnabled,
  isRemoteStagesEnabled,
  REMOTE_LEADS_DEV_OVERRIDE_KEY,
  REMOTE_STAGES_DEV_OVERRIDE_KEY,
} from '@/lib/flags';

const ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_STAGES';
const LEADS_ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_LEADS';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function setEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(ENV_KEY, flagValue);
  }
}

function setLeadsEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(LEADS_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(LEADS_ENV_KEY, flagValue);
  }
}

describe('isRemoteStagesEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false', () => {
    setEnv('production');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setEnv('production', 'false');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setEnv('production', 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setEnv('production', invalid);
      expect(isRemoteStagesEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setEnv('production', invalid);
      expect(isRemoteStagesEnabled()).toBe(false);
    }
  });
});

describe('isRemoteStagesEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setEnv('development', 'false');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setEnv('development', 'true');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setEnv('development', 'true');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, 'yes');
    expect(isRemoteStagesEnabled()).toBe(true);

    setEnv('development', 'false');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, '1');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setEnv('development', 'true');
    expect(isRemoteStagesEnabled()).toBe(true);

    setEnv('development', 'false');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isRemoteStagesEnabled()).toBe(true);

    setEnv('development', 'false');
    expect(isRemoteStagesEnabled()).toBe(false);
  });
});

describe('isRemoteStagesEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setEnv('production', 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setEnv('production', 'false');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setEnv('production', 'false');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setEnv('production', 'true');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteStagesEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isRemoteStagesEnabled();
    setEnv('production', 'false');
    isRemoteStagesEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isRemoteStagesEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isRemoteStagesEnabled()).toBe(true);

    setEnv('development', 'false');
    expect(isRemoteStagesEnabled()).toBe(false);
  });
});

// ── M1-E — isRemoteLeadsEnabled (mesmo contrato, chave/env próprias) ──────

describe('isRemoteLeadsEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setLeadsEnv('production');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setLeadsEnv('production', 'false');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setLeadsEnv('production', 'true');
    expect(isRemoteLeadsEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setLeadsEnv('production', invalid);
      expect(isRemoteLeadsEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setLeadsEnv('production', invalid);
      expect(isRemoteLeadsEnabled()).toBe(false);
    }
  });
});

describe('isRemoteLeadsEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setLeadsEnv('development', 'false');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteLeadsEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setLeadsEnv('development', 'true');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setLeadsEnv('development', 'true');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, 'yes');
    expect(isRemoteLeadsEnabled()).toBe(true);

    setLeadsEnv('development', 'false');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, '1');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setLeadsEnv('development', 'true');
    expect(isRemoteLeadsEnabled()).toBe(true);

    setLeadsEnv('development', 'false');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setLeadsEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isRemoteLeadsEnabled()).toBe(true);

    setLeadsEnv('development', 'false');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });
});

describe('isRemoteLeadsEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setLeadsEnv('production', 'true');
    expect(isRemoteLeadsEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setLeadsEnv('production', 'false');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setLeadsEnv('production', 'false');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setLeadsEnv('production', 'true');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteLeadsEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setLeadsEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isRemoteLeadsEnabled();
    setLeadsEnv('production', 'false');
    isRemoteLeadsEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isRemoteLeadsEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setLeadsEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isRemoteLeadsEnabled()).toBe(true);

    setLeadsEnv('development', 'false');
    expect(isRemoteLeadsEnabled()).toBe(false);
  });
});

describe('isolamento entre as flags de stages e de leads', () => {
  it('as chaves de override são distintas', () => {
    expect(REMOTE_LEADS_DEV_OVERRIDE_KEY).toBe('autocrm_ff_remote_leads');
    expect(REMOTE_LEADS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
  });

  it('env/override de leads não afetam a flag de stages (e vice-versa)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ENV_KEY, 'false');
    vi.stubEnv(LEADS_ENV_KEY, 'true');
    window.localStorage.setItem(REMOTE_LEADS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
    expect(isRemoteLeadsEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ENV_KEY, 'true');
    vi.stubEnv(LEADS_ENV_KEY, 'false');
    window.localStorage.setItem(REMOTE_STAGES_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
    expect(isRemoteLeadsEnabled()).toBe(false);
  });
});
