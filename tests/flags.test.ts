// Testes das feature flags remotas (M1-D stages + M1-E leads).
// Isolamento: vi.stubEnv/unstubAllEnvs para env, localStorage limpo e globals
// restaurados após cada teste — nenhum teste depende de ordem.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isRemoteLeadsEnabled,
  isRemoteStagesEnabled,
  isRemoteTasksEnabled,
  isRemoteVisitsEnabled,
  isRemoteDealsEnabled,
  isPlatformAdminEnabled,
  isActiveUsersEnabled,
  isUserEmailEditEnabled,
  isUserLifecycleEnabled,
  isCompanySelectorEnabled,
  isSuperAdminCommercialReadEnabled,
  isSuperAdminCommercialWriteEnabled,
  REMOTE_LEADS_DEV_OVERRIDE_KEY,
  REMOTE_STAGES_DEV_OVERRIDE_KEY,
  REMOTE_TASKS_DEV_OVERRIDE_KEY,
  REMOTE_VISITS_DEV_OVERRIDE_KEY,
  REMOTE_DEALS_DEV_OVERRIDE_KEY,
  PLATFORM_ADMIN_DEV_OVERRIDE_KEY,
  ACTIVE_USERS_DEV_OVERRIDE_KEY,
  USER_EMAIL_EDIT_DEV_OVERRIDE_KEY,
  USER_LIFECYCLE_DEV_OVERRIDE_KEY,
  COMPANY_SELECTOR_DEV_OVERRIDE_KEY,
  SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY,
  SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY,
} from '@/lib/flags';

const ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_STAGES';
const LEADS_ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_LEADS';
const TASKS_ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_TASKS';
const VISITS_ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_VISITS';
const DEALS_ENV_KEY = 'NEXT_PUBLIC_FF_REMOTE_DEALS';
const PLATFORM_ADMIN_ENV_KEY = 'NEXT_PUBLIC_FF_PLATFORM_ADMIN';
const ACTIVE_USERS_ENV_KEY = 'NEXT_PUBLIC_FF_ACTIVE_USERS';
const USER_EMAIL_EDIT_ENV_KEY = 'NEXT_PUBLIC_FF_USER_EMAIL_EDIT';
const USER_LIFECYCLE_ENV_KEY = 'NEXT_PUBLIC_FF_USER_LIFECYCLE';
const COMPANY_SELECTOR_ENV_KEY = 'NEXT_PUBLIC_FF_COMPANY_SELECTOR';

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

function setTasksEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(TASKS_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(TASKS_ENV_KEY, flagValue);
  }
}

function setVisitsEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(VISITS_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(VISITS_ENV_KEY, flagValue);
  }
}

function setDealsEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(DEALS_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(DEALS_ENV_KEY, flagValue);
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

function setUserLifecycleEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(USER_LIFECYCLE_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(USER_LIFECYCLE_ENV_KEY, flagValue);
  }
}

function setCompanySelectorEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(COMPANY_SELECTOR_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(COMPANY_SELECTOR_ENV_KEY, flagValue);
  }
}

const SUPER_ADMIN_COMMERCIAL_READ_ENV_KEY = 'NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_READ';
function setSuperAdminCommercialReadEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_READ_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_READ_ENV_KEY, flagValue);
  }
}

const SUPER_ADMIN_COMMERCIAL_WRITE_ENV_KEY = 'NEXT_PUBLIC_FF_SUPER_ADMIN_COMMERCIAL_WRITE';
function setSuperAdminCommercialWriteEnv(nodeEnv: string, flagValue?: string) {
  vi.stubEnv('NODE_ENV', nodeEnv);
  if (flagValue === undefined) {
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_WRITE_ENV_KEY, undefined as unknown as string);
  } else {
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_WRITE_ENV_KEY, flagValue);
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

// ── M1-F S6-F — isUserLifecycleEnabled (mesmo contrato, chave/env próprias) ─

describe('isUserLifecycleEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setUserLifecycleEnv('production');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setUserLifecycleEnv('production', 'false');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setUserLifecycleEnv('production', 'true');
    expect(isUserLifecycleEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setUserLifecycleEnv('production', invalid);
      expect(isUserLifecycleEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setUserLifecycleEnv('production', invalid);
      expect(isUserLifecycleEnabled()).toBe(false);
    }
  });
});

describe('isUserLifecycleEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setUserLifecycleEnv('development', 'false');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, 'true');
    expect(isUserLifecycleEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setUserLifecycleEnv('development', 'true');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, 'false');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setUserLifecycleEnv('development', 'true');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, 'yes');
    expect(isUserLifecycleEnabled()).toBe(true);

    setUserLifecycleEnv('development', 'false');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, '1');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setUserLifecycleEnv('development', 'true');
    expect(isUserLifecycleEnabled()).toBe(true);

    setUserLifecycleEnv('development', 'false');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setUserLifecycleEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isUserLifecycleEnabled()).toBe(true);

    setUserLifecycleEnv('development', 'false');
    expect(isUserLifecycleEnabled()).toBe(false);
  });
});

describe('isUserLifecycleEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setUserLifecycleEnv('production', 'true');
    expect(isUserLifecycleEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setUserLifecycleEnv('production', 'false');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setUserLifecycleEnv('production', 'false');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, 'true');
    expect(isUserLifecycleEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setUserLifecycleEnv('production', 'true');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, 'false');
    expect(isUserLifecycleEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setUserLifecycleEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isUserLifecycleEnabled();
    setUserLifecycleEnv('production', 'false');
    isUserLifecycleEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isUserLifecycleEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setUserLifecycleEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isUserLifecycleEnabled()).toBe(true);

    setUserLifecycleEnv('development', 'false');
    expect(isUserLifecycleEnabled()).toBe(false);
  });
});

describe('isolamento da flag de ciclo de vida em relação às demais (incl. ACTIVE_USERS)', () => {
  it('a chave de override é distinta das outras cinco', () => {
    expect(USER_LIFECYCLE_DEV_OVERRIDE_KEY).toBe('autocrm_ff_user_lifecycle');
    expect(USER_LIFECYCLE_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(USER_LIFECYCLE_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(USER_LIFECYCLE_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(USER_LIFECYCLE_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(USER_LIFECYCLE_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
  });

  it('env/override de ciclo de vida NUNCA afeta ACTIVE_USERS (e vice-versa) — mesma decisão congelada de S5-E1: flags separadas', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'true');
    vi.stubEnv(USER_LIFECYCLE_ENV_KEY, 'false');
    window.localStorage.setItem(USER_LIFECYCLE_DEV_OVERRIDE_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(true);
    expect(isUserLifecycleEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'false');
    vi.stubEnv(USER_LIFECYCLE_ENV_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(false);
    expect(isUserLifecycleEnabled()).toBe(true);
  });
});

// ── M1-F S7 — isCompanySelectorEnabled (mesmo contrato, chave/env próprias) ─

describe('isCompanySelectorEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setCompanySelectorEnv('production');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setCompanySelectorEnv('production', 'false');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setCompanySelectorEnv('production', 'true');
    expect(isCompanySelectorEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setCompanySelectorEnv('production', invalid);
      expect(isCompanySelectorEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setCompanySelectorEnv('production', invalid);
      expect(isCompanySelectorEnabled()).toBe(false);
    }
  });
});

describe('isCompanySelectorEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setCompanySelectorEnv('development', 'false');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, 'true');
    expect(isCompanySelectorEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setCompanySelectorEnv('development', 'true');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, 'false');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setCompanySelectorEnv('development', 'true');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, 'yes');
    expect(isCompanySelectorEnabled()).toBe(true);

    setCompanySelectorEnv('development', 'false');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, '1');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setCompanySelectorEnv('development', 'true');
    expect(isCompanySelectorEnabled()).toBe(true);

    setCompanySelectorEnv('development', 'false');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setCompanySelectorEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isCompanySelectorEnabled()).toBe(true);

    setCompanySelectorEnv('development', 'false');
    expect(isCompanySelectorEnabled()).toBe(false);
  });
});

describe('isCompanySelectorEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setCompanySelectorEnv('production', 'true');
    expect(isCompanySelectorEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setCompanySelectorEnv('production', 'false');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setCompanySelectorEnv('production', 'false');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, 'true');
    expect(isCompanySelectorEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setCompanySelectorEnv('production', 'true');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, 'false');
    expect(isCompanySelectorEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setCompanySelectorEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isCompanySelectorEnabled();
    setCompanySelectorEnv('production', 'false');
    isCompanySelectorEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isCompanySelectorEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setCompanySelectorEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isCompanySelectorEnabled()).toBe(true);

    setCompanySelectorEnv('development', 'false');
    expect(isCompanySelectorEnabled()).toBe(false);
  });
});

describe('isolamento da flag de filtro de empresa em relação às demais', () => {
  it('a chave de override é distinta das outras seis', () => {
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).toBe('autocrm_ff_company_selector');
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
    expect(COMPANY_SELECTOR_DEV_OVERRIDE_KEY).not.toBe(USER_LIFECYCLE_DEV_OVERRIDE_KEY);
  });

  it('env/override do filtro de empresa nunca afeta as demais flags (e vice-versa)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'true');
    vi.stubEnv(COMPANY_SELECTOR_ENV_KEY, 'false');
    window.localStorage.setItem(COMPANY_SELECTOR_DEV_OVERRIDE_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(true);
    expect(isCompanySelectorEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'false');
    vi.stubEnv(COMPANY_SELECTOR_ENV_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(false);
    expect(isCompanySelectorEnabled()).toBe(true);
  });
});

// M1-F S8-C2-B2 — leitura comercial do Super Admin.
describe('isSuperAdminCommercialReadEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setSuperAdminCommercialReadEnv('production');
    expect(isSuperAdminCommercialReadEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setSuperAdminCommercialReadEnv('production', 'false');
    expect(isSuperAdminCommercialReadEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setSuperAdminCommercialReadEnv('production', 'true');
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setSuperAdminCommercialReadEnv('production', invalid);
      expect(isSuperAdminCommercialReadEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setSuperAdminCommercialReadEnv('production', invalid);
      expect(isSuperAdminCommercialReadEnabled()).toBe(false);
    }
  });
});

describe('isSuperAdminCommercialReadEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setSuperAdminCommercialReadEnv('development', 'false');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY, 'true');
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setSuperAdminCommercialReadEnv('development', 'true');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY, 'false');
    expect(isSuperAdminCommercialReadEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setSuperAdminCommercialReadEnv('development', 'true');
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);

    setSuperAdminCommercialReadEnv('development', 'false');
    expect(isSuperAdminCommercialReadEnabled()).toBe(false);
  });
});

describe('isSuperAdminCommercialReadEnabled — production (localStorage ignorado)', () => {
  it('override "true" com env false ⇒ continua false', () => {
    setSuperAdminCommercialReadEnv('production', 'false');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY, 'true');
    expect(isSuperAdminCommercialReadEnabled()).toBe(false);
  });
});

describe('isolamento da flag comercial do Super Admin em relação às demais', () => {
  it('a chave de override é distinta de todas as outras', () => {
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).toBe('autocrm_ff_super_admin_commercial_read');
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(COMPANY_SELECTOR_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY).not.toBe(USER_LIFECYCLE_DEV_OVERRIDE_KEY);
  });

  it('env/override da flag comercial nunca afeta as demais flags (e vice-versa)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'true');
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_READ_ENV_KEY, 'false');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(true);
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ACTIVE_USERS_ENV_KEY, 'false');
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_READ_ENV_KEY, 'true');
    expect(isActiveUsersEnabled()).toBe(false);
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);
  });
});

// M1-F S8-C2-C2 — mutation comercial do Super Admin. Só o valor bruto da
// própria flag — a combinação "WRITE só é EFETIVA quando READ também está
// ligada" é decisão do chamador (canMutateCommercialWorkspace), nunca desta
// função, então os testes abaixo cobrem SÓ o comportamento isolado da flag.
describe('isSuperAdminCommercialWriteEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setSuperAdminCommercialWriteEnv('production');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setSuperAdminCommercialWriteEnv('production', 'false');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setSuperAdminCommercialWriteEnv('production', 'true');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setSuperAdminCommercialWriteEnv('production', invalid);
      expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setSuperAdminCommercialWriteEnv('production', invalid);
      expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
    }
  });
});

describe('isSuperAdminCommercialWriteEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setSuperAdminCommercialWriteEnv('development', 'false');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY, 'true');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setSuperAdminCommercialWriteEnv('development', 'true');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY, 'false');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setSuperAdminCommercialWriteEnv('development', 'true');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(true);

    setSuperAdminCommercialWriteEnv('development', 'false');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
  });
});

describe('isSuperAdminCommercialWriteEnabled — production (localStorage ignorado)', () => {
  it('override "true" com env false ⇒ continua false', () => {
    setSuperAdminCommercialWriteEnv('production', 'false');
    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY, 'true');
    expect(isSuperAdminCommercialWriteEnabled()).toBe(false);
  });
});

describe('isolamento da flag WRITE comercial do Super Admin em relação às demais (incl. READ)', () => {
  it('a chave de override é distinta de todas as outras, inclusive READ', () => {
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).toBe('autocrm_ff_super_admin_commercial_write');
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(COMPANY_SELECTOR_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
    expect(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY).not.toBe(USER_LIFECYCLE_DEV_OVERRIDE_KEY);
  });

  it('env/override de WRITE nunca afeta READ (e vice-versa) — flags totalmente independentes', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_READ_ENV_KEY, 'true');
    vi.stubEnv(SUPER_ADMIN_COMMERCIAL_WRITE_ENV_KEY, 'false');
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);
    expect(isSuperAdminCommercialWriteEnabled()).toBe(false);

    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_WRITE_DEV_OVERRIDE_KEY, 'true');
    expect(isSuperAdminCommercialReadEnabled()).toBe(true);
    expect(isSuperAdminCommercialWriteEnabled()).toBe(true);

    window.localStorage.setItem(SUPER_ADMIN_COMMERCIAL_READ_DEV_OVERRIDE_KEY, 'false');
    expect(isSuperAdminCommercialReadEnabled()).toBe(false);
    expect(isSuperAdminCommercialWriteEnabled()).toBe(true);
  });
});

// COMMERCIAL-REMOTE-B1-B1 — isRemoteTasksEnabled (mesmo contrato de
// isRemoteStagesEnabled/isRemoteLeadsEnabled, chave/env próprias). Só o
// valor bruto da flag — a combinação com o estado de Leads/Stages
// (task_local/task_blocked/task_remote_ready/task_remote_misconfigured)
// é testada isoladamente em tests/tasks/remoteTasksMode.test.ts.

describe('isRemoteTasksEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setTasksEnv('production');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setTasksEnv('production', 'false');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setTasksEnv('production', 'true');
    expect(isRemoteTasksEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setTasksEnv('production', invalid);
      expect(isRemoteTasksEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setTasksEnv('production', invalid);
      expect(isRemoteTasksEnabled()).toBe(false);
    }
  });
});

describe('isRemoteTasksEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setTasksEnv('development', 'false');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteTasksEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setTasksEnv('development', 'true');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setTasksEnv('development', 'true');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, 'yes');
    expect(isRemoteTasksEnabled()).toBe(true);

    setTasksEnv('development', 'false');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, '1');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setTasksEnv('development', 'true');
    expect(isRemoteTasksEnabled()).toBe(true);

    setTasksEnv('development', 'false');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setTasksEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isRemoteTasksEnabled()).toBe(true);

    setTasksEnv('development', 'false');
    expect(isRemoteTasksEnabled()).toBe(false);
  });
});

describe('isRemoteTasksEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setTasksEnv('production', 'true');
    expect(isRemoteTasksEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setTasksEnv('production', 'false');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setTasksEnv('production', 'false');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteTasksEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setTasksEnv('production', 'true');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteTasksEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setTasksEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isRemoteTasksEnabled();
    setTasksEnv('production', 'false');
    isRemoteTasksEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isRemoteTasksEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setTasksEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isRemoteTasksEnabled()).toBe(true);

    setTasksEnv('development', 'false');
    expect(isRemoteTasksEnabled()).toBe(false);
  });
});

describe('isolamento da flag de tasks em relação às demais (incl. Leads/Stages)', () => {
  it('a chave de override é distinta de todas as outras', () => {
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).toBe('autocrm_ff_remote_tasks');
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(USER_LIFECYCLE_DEV_OVERRIDE_KEY);
    expect(REMOTE_TASKS_DEV_OVERRIDE_KEY).not.toBe(COMPANY_SELECTOR_DEV_OVERRIDE_KEY);
  });

  it('env/override de tasks não afeta leads/stages (e vice-versa)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ENV_KEY, 'true');
    vi.stubEnv(LEADS_ENV_KEY, 'true');
    vi.stubEnv(TASKS_ENV_KEY, 'false');
    window.localStorage.setItem(REMOTE_TASKS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
    expect(isRemoteLeadsEnabled()).toBe(true);
    expect(isRemoteTasksEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ENV_KEY, 'false');
    vi.stubEnv(LEADS_ENV_KEY, 'false');
    vi.stubEnv(TASKS_ENV_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
    expect(isRemoteLeadsEnabled()).toBe(false);
    expect(isRemoteTasksEnabled()).toBe(true);
  });
});

// COMMERCIAL-REMOTE-VISITS-B2 — isRemoteVisitsEnabled (mesmo contrato de
// isRemoteTasksEnabled, chave/env próprias). Só o valor bruto da flag — a
// combinação com o estado de Leads (visit_local/visit_blocked/
// visit_remote_ready/visit_remote_misconfigured) é testada isoladamente em
// tests/visits/remoteVisitsMode.test.ts.

describe('isRemoteVisitsEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setVisitsEnv('production');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setVisitsEnv('production', 'false');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setVisitsEnv('production', 'true');
    expect(isRemoteVisitsEnabled()).toBe(true);
  });

  it('valores inválidos ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setVisitsEnv('production', invalid);
      expect(isRemoteVisitsEnabled()).toBe(false);
    }
  });

  it('comparação é estrita e case-sensitive ("TRUE"/"True" não ativam)', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setVisitsEnv('production', invalid);
      expect(isRemoteVisitsEnabled()).toBe(false);
    }
  });
});

describe('isRemoteVisitsEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setVisitsEnv('development', 'false');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteVisitsEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setVisitsEnv('development', 'true');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setVisitsEnv('development', 'true');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, 'yes');
    expect(isRemoteVisitsEnabled()).toBe(true);

    setVisitsEnv('development', 'false');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, '1');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setVisitsEnv('development', 'true');
    expect(isRemoteVisitsEnabled()).toBe(true);

    setVisitsEnv('development', 'false');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('localStorage lançando erro ⇒ usa o env sem propagar', () => {
    setVisitsEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isRemoteVisitsEnabled()).toBe(true);

    setVisitsEnv('development', 'false');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });
});

describe('isRemoteVisitsEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setVisitsEnv('production', 'true');
    expect(isRemoteVisitsEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setVisitsEnv('production', 'false');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setVisitsEnv('production', 'false');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setVisitsEnv('production', 'true');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteVisitsEnabled()).toBe(true);
  });

  it('localStorage.getItem NUNCA é chamado em produção (spy)', () => {
    setVisitsEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isRemoteVisitsEnabled();
    setVisitsEnv('production', 'false');
    isRemoteVisitsEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isRemoteVisitsEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setVisitsEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isRemoteVisitsEnabled()).toBe(true);

    setVisitsEnv('development', 'false');
    expect(isRemoteVisitsEnabled()).toBe(false);
  });
});

describe('isolamento da flag de visits em relação às demais (incl. Leads/Stages/Tasks)', () => {
  it('a chave de override é distinta de todas as outras', () => {
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).toBe('autocrm_ff_remote_visits');
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_TASKS_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(USER_LIFECYCLE_DEV_OVERRIDE_KEY);
    expect(REMOTE_VISITS_DEV_OVERRIDE_KEY).not.toBe(COMPANY_SELECTOR_DEV_OVERRIDE_KEY);
  });

  it('env/override de visits não afeta leads/stages/tasks (e vice-versa) — sem dependência de Tasks', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ENV_KEY, 'true');
    vi.stubEnv(LEADS_ENV_KEY, 'true');
    vi.stubEnv(TASKS_ENV_KEY, 'true');
    vi.stubEnv(VISITS_ENV_KEY, 'false');
    window.localStorage.setItem(REMOTE_VISITS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
    expect(isRemoteLeadsEnabled()).toBe(true);
    expect(isRemoteTasksEnabled()).toBe(true);
    expect(isRemoteVisitsEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ENV_KEY, 'false');
    vi.stubEnv(LEADS_ENV_KEY, 'false');
    vi.stubEnv(TASKS_ENV_KEY, 'false');
    vi.stubEnv(VISITS_ENV_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
    expect(isRemoteLeadsEnabled()).toBe(false);
    expect(isRemoteTasksEnabled()).toBe(false);
    expect(isRemoteVisitsEnabled()).toBe(true);
  });
});

// COMMERCIAL-REMOTE-DEALS-B2-A — isRemoteDealsEnabled (mesmo contrato de
// isRemoteTasksEnabled/isRemoteVisitsEnabled, chave/env próprias). Só o
// valor bruto da flag — a combinação com o estado de Leads
// (deal_local/deal_blocked/deal_remote_ready/deal_remote_misconfigured) é
// testada separadamente em tests/deals/remoteDealsMode.test.ts.

describe('isRemoteDealsEnabled — valor do ambiente', () => {
  it('variável ausente ⇒ false (OFF por padrão)', () => {
    setDealsEnv('production');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('"false" ⇒ false', () => {
    setDealsEnv('production', 'false');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('"true" ⇒ true', () => {
    setDealsEnv('production', 'true');
    expect(isRemoteDealsEnabled()).toBe(true);
  });

  it('valores não reconhecidos (case-sensitive, sem 1/yes/on/vazio) ⇒ false', () => {
    for (const invalid of ['1', 'yes', 'on', '', 'enabled']) {
      setDealsEnv('production', invalid);
      expect(isRemoteDealsEnabled()).toBe(false);
    }
  });

  it('variações de maiúsculas/espaços não são reconhecidas ⇒ false', () => {
    for (const invalid of ['TRUE', 'True', ' true', 'true ']) {
      setDealsEnv('production', invalid);
      expect(isRemoteDealsEnabled()).toBe(false);
    }
  });
});

describe('isRemoteDealsEnabled — development (override via localStorage)', () => {
  it('env false + override "true" ⇒ true', () => {
    setDealsEnv('development', 'false');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteDealsEnabled()).toBe(true);
  });

  it('env true + override "false" ⇒ false', () => {
    setDealsEnv('development', 'true');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('override inválido ⇒ usa o env', () => {
    setDealsEnv('development', 'true');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, 'yes');
    expect(isRemoteDealsEnabled()).toBe(true);

    setDealsEnv('development', 'false');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, '1');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('override ausente ⇒ usa o env', () => {
    setDealsEnv('development', 'true');
    expect(isRemoteDealsEnabled()).toBe(true);

    setDealsEnv('development', 'false');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('SecurityError no localStorage cai no env, sem lançar', () => {
    setDealsEnv('development', 'true');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(isRemoteDealsEnabled()).toBe(true);

    setDealsEnv('development', 'false');
    expect(isRemoteDealsEnabled()).toBe(false);
  });
});

describe('isRemoteDealsEnabled — production (localStorage ignorado)', () => {
  it('env true ⇒ true', () => {
    setDealsEnv('production', 'true');
    expect(isRemoteDealsEnabled()).toBe(true);
  });

  it('env false ⇒ false', () => {
    setDealsEnv('production', 'false');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('override "true" com env false ⇒ continua false', () => {
    setDealsEnv('production', 'false');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteDealsEnabled()).toBe(false);
  });

  it('override "false" com env true ⇒ continua true', () => {
    setDealsEnv('production', 'true');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, 'false');
    expect(isRemoteDealsEnabled()).toBe(true);
  });

  it('localStorage nunca é consultado em produção', () => {
    setDealsEnv('production', 'true');
    const spy = vi.spyOn(Storage.prototype, 'getItem');
    isRemoteDealsEnabled();
    setDealsEnv('production', 'false');
    isRemoteDealsEnabled();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isRemoteDealsEnabled — ambiente sem window (SSR)', () => {
  it('sem window ⇒ usa o env sem lançar erro', () => {
    setDealsEnv('development', 'true');
    vi.stubGlobal('window', undefined);
    expect(isRemoteDealsEnabled()).toBe(true);

    setDealsEnv('development', 'false');
    expect(isRemoteDealsEnabled()).toBe(false);
  });
});

describe('isolamento da flag de deals em relação às demais (incl. Leads/Stages/Tasks/Visits)', () => {
  it('a chave de override é distinta de todas as outras', () => {
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).toBe('autocrm_ff_remote_deals');
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_STAGES_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_LEADS_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_TASKS_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(REMOTE_VISITS_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(PLATFORM_ADMIN_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(ACTIVE_USERS_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(USER_EMAIL_EDIT_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(USER_LIFECYCLE_DEV_OVERRIDE_KEY);
    expect(REMOTE_DEALS_DEV_OVERRIDE_KEY).not.toBe(COMPANY_SELECTOR_DEV_OVERRIDE_KEY);
  });

  it('env/override de deals não afeta leads/stages/tasks/visits (e vice-versa) — sem dependência de Visits/Tasks', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(ENV_KEY, 'true');
    vi.stubEnv(LEADS_ENV_KEY, 'true');
    vi.stubEnv(TASKS_ENV_KEY, 'true');
    vi.stubEnv(VISITS_ENV_KEY, 'true');
    vi.stubEnv(DEALS_ENV_KEY, 'false');
    window.localStorage.setItem(REMOTE_DEALS_DEV_OVERRIDE_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(true);
    expect(isRemoteLeadsEnabled()).toBe(true);
    expect(isRemoteTasksEnabled()).toBe(true);
    expect(isRemoteVisitsEnabled()).toBe(true);
    expect(isRemoteDealsEnabled()).toBe(true);

    window.localStorage.clear();
    vi.stubEnv(ENV_KEY, 'false');
    vi.stubEnv(LEADS_ENV_KEY, 'false');
    vi.stubEnv(TASKS_ENV_KEY, 'false');
    vi.stubEnv(VISITS_ENV_KEY, 'false');
    vi.stubEnv(DEALS_ENV_KEY, 'true');
    expect(isRemoteStagesEnabled()).toBe(false);
    expect(isRemoteLeadsEnabled()).toBe(false);
    expect(isRemoteTasksEnabled()).toBe(false);
    expect(isRemoteVisitsEnabled()).toBe(false);
    expect(isRemoteDealsEnabled()).toBe(true);
  });
});
