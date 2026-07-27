// Testes das feature flags remotas (M1-D stages + M1-E leads).
// Isolamento: vi.stubEnv/unstubAllEnvs para env, localStorage limpo e globals
// restaurados após cada teste — nenhum teste depende de ordem.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRemoteLeadsEnabled,
  isRemoteStagesEnabled,
  isPlatformAdminEnabled,
  isActiveUsersEnabled,
  isUserEmailEditEnabled,
  REMOTE_LEADS_DEV_OVERRIDE_KEY,
  REMOTE_STAGES_DEV_OVERRIDE_KEY,
  PLATFORM_ADMIN_DEV_OVERRIDE_KEY,
  ACTIVE_USERS_DEV_OVERRIDE_KEY,
  USER_EMAIL_EDIT_DEV_OVERRIDE_KEY,
} from '@/lib/flags';

const ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_STAGES';
const LEADS_ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_LEADS';
const PLATFORM_ADMIN_ENV_KEY = 'NEXT_PUBLIC_FF_PLATFORM_ADMIN';
const ACTIVE_USERS_ENV_KEY = 'NEXT_PUBLIC_FF_ACTIVE_USERS';
const USER_EMAIL_EDIT_ENV_KEY = 'NEXT_PUBLIC_FF_USER_EMAIL_EDIT';

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

function setPlatformAdminEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(PLATFORM_ADMIN_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(PLATFORM_ADMIN_ENV_KEY, flagValue);
  }
}

function setActiveUsersEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, flagValue);
  }
}

function setUserEmailEditEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(USER_EMAIL_EDIT_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(USER_EMAIL_EDIT_ENV_KEY, flagValue);
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

// ── M1-F S3-B — isPlatformAdminEnabled (mesmo contrato, chave/env próprias) ─

describe('isPlatformAdminEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setPlatformAdminEnv('production');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setPlatformAdminEnv('production', 'false');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setPlatformAdminEnv('production', 'true');
    expect(isPlatformAdminEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setPlatformAdminEnv('production', invalid);
      expect(isPlatformAdminEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setPlatformAdminEnv('production', invalid);
      expect(isPlatformAdminEnabled()).toBe(false);
    }
  });
});

describe('isPlatformAdminEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setPlatformAdminEnv('development', 'false');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, 'true');
    expect(isPlatformAdminEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setPlatformAdminEnv('development', 'true');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, 'false');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setPlatformAdminEnv('development', 'true');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, 'yes');
    expect(isPlatformAdminEnabled()).toBe(true);

    setPlatformAdminEnv('development', 'false');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, '1');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setPlatformAdminEnv('development', 'true');
    expect(isPlatformAdminEnabled()).toBe(true);

    setPlatformAdminEnv('development', 'false');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setPlatformAdminEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isPlatformAdminEnabled()).toBe(true);

    setPlatformAdminEnv('development', 'false');
    expect(isPlatformAdminEnabled()).toBe(false);
  });
});

describe('isPlatformAdminEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setPlatformAdminEnv('production', 'true');
    expect(isPlatformAdminEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setPlatformAdminEnv('production', 'false');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setPlatformAdminEnv('production', 'false');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, 'true');
    expect(isPlatformAdminEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setPlatformAdminEnv('production', 'true');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, 'false');
    expect(isPlatformAdminEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setPlatformAdminEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isPlatformAdminEnabled();
    setPlatformAdminEnv('production', 'false');
    isPlatformAdminEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isPlatformAdminEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setPlatformAdminEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isPlatformAdminEnabled()).toBe(true);

    setPlatformAdminEnv('development', 'false');
    expect(isPlatformAdminEnabled()).toBe(false);
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

// ── M1-F S5-D — isActiveUsersEnabled (mesmo contrato, chave/env próprias) ──

describe('isActiveUsersEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setActiveUsersEnv('production');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setActiveUsersEnv('production', 'false');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setActiveUsersEnv('production', 'true');
    expect(isActiveUsersEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setActiveUsersEnv('production', invalid);
      expect(isActiveUsersEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setActiveUsersEnv('production', invalid);
      expect(isActiveUsersEnabled()).toBe(false);
    }
  });
});

describe('isActiveUsersEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setActiveUsersEnv('development', 'false');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setActiveUsersEnv('development', 'true');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, 'false');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setActiveUsersEnv('development', 'true');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, 'yes');
    expect(isActiveUsersEnabled()).toBe(true);

    setActiveUsersEnv('development', 'false');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, '1');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setActiveUsersEnv('development', 'true');
    expect(isActiveUsersEnabled()).toBe(true);

    setActiveUsersEnv('development', 'false');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setActiveUsersEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isActiveUsersEnabled()).toBe(true);

    setActiveUsersEnv('development', 'false');
    expect(isActiveUsersEnabled()).toBe(false);
  });
});

describe('isActiveUsersEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setActiveUsersEnv('production', 'true');
    expect(isActiveUsersEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setActiveUsersEnv('production', 'false');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setActiveUsersEnv('production', 'false');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setActiveUsersEnv('production', 'true');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, 'false');
    expect(isActiveUsersEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setActiveUsersEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isActiveUsersEnabled();
    setActiveUsersEnv('production', 'false');
    isActiveUsersEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isActiveUsersEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setActiveUsersEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isActiveUsersEnabled()).toBe(true);

    setActiveUsersEnv('development', 'false');
    expect(isActiveUsersEnabled()).toBe(false);
  });
});

describe('isolamento da flag de usuários ativos em relação às demais', () => {
  it('a chave de override é distinta das outras três', () => {
    expect(ACTIVE_USERS_DEV_OVERRIDE_KEY).toBe('autocrm_ff_active_users');
    expect(ACTIVE_USERS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(ACTIVE_USERS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(ACTIVE_USERS_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
  });

  it('env/override de usuários ativos não afeta as demais flags (e vice-versa)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ENV_KEY, 'true');
    vi.stubEnv(LEADS_ENV_KEY, 'true');
    vi.stubEnv(PLATFORM_ADMIN_ENV_KEY, 'true');
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'false');
    window.localStorage.setItem(ACTIVE_USERS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
    expect(isRemoteLeadsEnabled()).toBe(true);
    expect(isPlatformAdminEnabled()).toBe(true);
    expect(isActiveUsersEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ENV_KEY, 'false');
    vi.stubEnv(LEADS_ENV_KEY, 'false');
    vi.stubEnv(PLATFORM_ADMIN_ENV_KEY, 'false');
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
    expect(isRemoteLeadsEnabled()).toBe(false);
    expect(isPlatformAdminEnabled()).toBe(false);
    expect(isActiveUsersEnabled()).toBe(true);
  });
});

describe('isolamento da flag de platform admin em relação às demais', () => {
  it('a chave de override é distinta das outras duas', () => {
    expect(PLATFORM_ADMIN_DEV_OVERRIDE_KEY).toBe('autocrm_ff_platform_admin');
    expect(PLATFORM_ADMIN_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(PLATFORM_ADMIN_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
  });

  it('env/override de platform admin não afeta stages/leads (e vice-versa)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ENV_KEY, 'true');
    vi.stubEnv(LEADS_ENV_KEY, 'true');
    vi.stubEnv(PLATFORM_ADMIN_ENV_KEY, 'false');
    window.localStorage.setItem(PLATFORM_ADMIN_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
    expect(isRemoteLeadsEnabled()).toBe(true);
    expect(isPlatformAdminEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ENV_KEY, 'false');
    vi.stubEnv(LEADS_ENV_KEY, 'false');
    vi.stubEnv(PLATFORM_ADMIN_ENV_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
    expect(isRemoteLeadsEnabled()).toBe(false);
    expect(isPlatformAdminEnabled()).toBe(true);
  });
});

// ── M1-F S5-E1 — isUserEmailEditEnabled (mesmo contrato, chave/env próprias) ─

describe('isUserEmailEditEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setUserEmailEditEnv('production');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setUserEmailEditEnv('production', 'false');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setUserEmailEditEnv('production', 'true');
    expect(isUserEmailEditEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setUserEmailEditEnv('production', invalid);
      expect(isUserEmailEditEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setUserEmailEditEnv('production', invalid);
      expect(isUserEmailEditEnabled()).toBe(false);
    }
  });
});

describe('isUserEmailEditEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setUserEmailEditEnv('development', 'false');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, 'true');
    expect(isUserEmailEditEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setUserEmailEditEnv('development', 'true');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, 'false');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setUserEmailEditEnv('development', 'true');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, 'yes');
    expect(isUserEmailEditEnabled()).toBe(true);

    setUserEmailEditEnv('development', 'false');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, '1');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setUserEmailEditEnv('development', 'true');
    expect(isUserEmailEditEnabled()).toBe(true);

    setUserEmailEditEnv('development', 'false');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setUserEmailEditEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isUserEmailEditEnabled()).toBe(true);

    setUserEmailEditEnv('development', 'false');
    expect(isUserEmailEditEnabled()).toBe(false);
  });
});

describe('isUserEmailEditEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setUserEmailEditEnv('production', 'true');
    expect(isUserEmailEditEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setUserEmailEditEnv('production', 'false');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setUserEmailEditEnv('production', 'false');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, 'true');
    expect(isUserEmailEditEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setUserEmailEditEnv('production', 'true');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, 'false');
    expect(isUserEmailEditEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setUserEmailEditEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isUserEmailEditEnabled();
    setUserEmailEditEnv('production', 'false');
    isUserEmailEditEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isUserEmailEditEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setUserEmailEditEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isUserEmailEditEnabled()).toBe(true);

    setUserEmailEditEnv('development', 'false');
    expect(isUserEmailEditEnabled()).toBe(false);
  });
});

describe('isolamento da flag de edição de e-mail em relação às demais (incl. ACTIVE_USERS)', () => {
  it('a chave de override é distinta das outras quatro', () => {
    expect(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY).toBe('autocrm_ff_user_email_edit');
    expect(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
  });

  it('env/override de edição de e-mail NUNCA afeta ACTIVE_USERS (e vice-versa) — decisão congelada: flags separadas', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'true');
    vi.stubEnv(USER_EMAIL_EDIT_ENV_KEY, 'false');
    window.localStorage.setItem(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(true);
    expect(isUserEmailEditEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'false');
    vi.stubEnv(USER_EMAIL_EDIT_ENV_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(false);
    expect(isUserEmailEditEnabled()).toBe(true);
  });
});
