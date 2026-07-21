// tests/invites/fragment.test.ts — parser puro do fragmento de aceite de
// convite (M1-F S4-C2B). Nenhuma rede, nenhum DOM — função pura sobre
// string.
import { describe, expect, it } from 'vitest';
import { parseInviteFragment } from '@/lib/invites/fragment';

const VALID_TOKEN = 'A'.repeat(43);
const VALID_HASH = 'b'.repeat(40);

function fragment(overrides: Partial<{ invite_token: string; auth_token_hash: string; auth_type: string }> = {}, extra = ''): string {
  const params = new URLSearchParams();
  const values = { invite_token: VALID_TOKEN, auth_token_hash: VALID_HASH, auth_type: 'invite', ...overrides };
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) params.append(k, v as string);
  }
  return `#${params.toString()}${extra}`;
}

describe('parseInviteFragment — casos válidos', () => {
  it('aceita fragmento válido auth_type=invite', () => {
    const result = parseInviteFragment(fragment({ auth_type: 'invite' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ inviteToken: VALID_TOKEN, authTokenHash: VALID_HASH, authType: 'invite' });
    }
  });

  it('aceita fragmento válido auth_type=magiclink', () => {
    const result = parseInviteFragment(fragment({ auth_type: 'magiclink' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.authType).toBe('magiclink');
    }
  });

  it('aceita a string já sem o "#" inicial', () => {
    const withHash = fragment();
    const result = parseInviteFragment(withHash.slice(1));
    expect(result.ok).toBe(true);
  });
});

describe('parseInviteFragment — campos ausentes/duplicados/extras', () => {
  it('rejeita invite_token ausente', () => {
    const params = new URLSearchParams({ auth_token_hash: VALID_HASH, auth_type: 'invite' });
    expect(parseInviteFragment(`#${params.toString()}`).ok).toBe(false);
  });

  it('rejeita auth_token_hash ausente', () => {
    const params = new URLSearchParams({ invite_token: VALID_TOKEN, auth_type: 'invite' });
    expect(parseInviteFragment(`#${params.toString()}`).ok).toBe(false);
  });

  it('rejeita auth_type ausente', () => {
    const params = new URLSearchParams({ invite_token: VALID_TOKEN, auth_token_hash: VALID_HASH });
    expect(parseInviteFragment(`#${params.toString()}`).ok).toBe(false);
  });

  it('rejeita campo duplicado (invite_token aparece duas vezes)', () => {
    const raw = `invite_token=${VALID_TOKEN}&invite_token=${VALID_TOKEN}&auth_token_hash=${VALID_HASH}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });

  it('rejeita chave extra inesperada', () => {
    const raw = `invite_token=${VALID_TOKEN}&auth_token_hash=${VALID_HASH}&auth_type=invite&extra=1`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });

  it('rejeita fragmento vazio', () => {
    expect(parseInviteFragment('#').ok).toBe(false);
    expect(parseInviteFragment('').ok).toBe(false);
  });
});

describe('parseInviteFragment — auth_type inválido', () => {
  it('rejeita auth_type fora de invite|magiclink', () => {
    expect(parseInviteFragment(fragment({ auth_type: 'recovery' })).ok).toBe(false);
    expect(parseInviteFragment(fragment({ auth_type: 'email' })).ok).toBe(false);
    expect(parseInviteFragment(fragment({ auth_type: '' })).ok).toBe(false);
  });
});

describe('parseInviteFragment — invite_token: formato estrito', () => {
  it('rejeita token curto (42 caracteres)', () => {
    expect(parseInviteFragment(fragment({ invite_token: 'a'.repeat(42) })).ok).toBe(false);
  });

  it('rejeita token longo (44 caracteres)', () => {
    expect(parseInviteFragment(fragment({ invite_token: 'a'.repeat(44) })).ok).toBe(false);
  });

  it('rejeita padding "="', () => {
    expect(parseInviteFragment(fragment({ invite_token: `${'a'.repeat(42)}=` })).ok).toBe(false);
  });

  it('rejeita caractere base64 inválido (+ ou /)', () => {
    expect(parseInviteFragment(fragment({ invite_token: `${'a'.repeat(42)}+` })).ok).toBe(false);
    expect(parseInviteFragment(fragment({ invite_token: `${'a'.repeat(42)}/` })).ok).toBe(false);
  });

  it('rejeita espaço embutido (encoded)', () => {
    const raw = `invite_token=${encodeURIComponent(`${'a'.repeat(21)} ${'a'.repeat(21)}`)}&auth_token_hash=${VALID_HASH}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });

  it('rejeita Unicode embutido', () => {
    const raw = `invite_token=${encodeURIComponent(`${'a'.repeat(40)}✓✓✓`)}&auth_token_hash=${VALID_HASH}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });

  it('nunca faz trim silencioso (valor com espaço nas pontas continua rejeitado)', () => {
    const raw = `invite_token=${encodeURIComponent(` ${'a'.repeat(43)}`)}&auth_token_hash=${VALID_HASH}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });
});

describe('parseInviteFragment — auth_token_hash', () => {
  it('rejeita vazio', () => {
    expect(parseInviteFragment(fragment({ auth_token_hash: '' })).ok).toBe(false);
  });

  it('rejeita excessivamente longo (>512)', () => {
    expect(parseInviteFragment(fragment({ auth_token_hash: 'a'.repeat(600) })).ok).toBe(false);
  });

  it('aceita alfanumérico simples (não impõe formato hex-only)', () => {
    expect(parseInviteFragment(fragment({ auth_token_hash: 'AbC123-_.~' })).ok).toBe(true);
  });

  it('rejeita espaço embutido', () => {
    const raw = `invite_token=${VALID_TOKEN}&auth_token_hash=${encodeURIComponent('a b')}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });

  it('rejeita caractere de controle embutido', () => {
    const raw = `invite_token=${VALID_TOKEN}&auth_token_hash=${encodeURIComponent('ab')}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });

  it('rejeita Unicode embutido', () => {
    const raw = `invite_token=${VALID_TOKEN}&auth_token_hash=${encodeURIComponent('a✓b')}&auth_type=invite`;
    expect(parseInviteFragment(`#${raw}`).ok).toBe(false);
  });
});

describe('parseInviteFragment — encoding e ambiguidade', () => {
  it('rejeita segundo "#" embutido no restante', () => {
    const raw = fragment().slice(1);
    expect(parseInviteFragment(`#${raw}#outro`).ok).toBe(false);
  });

  it('rejeita encoding inválido/malformado sem lançar exceção', () => {
    expect(() => parseInviteFragment('#invite_token=%E0%A4%A')).not.toThrow();
    expect(parseInviteFragment('#invite_token=%E0%A4%A').ok).toBe(false);
  });

  it('token nunca é lido de query string — função só processa o valor recebido como fragmento', () => {
    // Simula alguém passando erroneamente uma query string: sem "#" também
    // é aceito como corpo do fragmento (o contrato é "string já isolada",
    // nunca uma URL completa) — mas com chave fora da whitelist já falha.
    const result = parseInviteFragment(`?invite_token=${VALID_TOKEN}`);
    expect(result.ok).toBe(false);
  });

  it('valor não-string é rejeitado sem lançar', () => {
    // @ts-expect-error — entrada propositalmente inválida
    expect(() => parseInviteFragment(null)).not.toThrow();
    // @ts-expect-error
    expect(parseInviteFragment(null).ok).toBe(false);
  });
});

describe('parseInviteFragment — nenhum token na representação de erro', () => {
  it('resultado de erro nunca contém os valores originais', () => {
    const result = parseInviteFragment(fragment({ invite_token: 'invalid-token-value' }));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('invalid-token-value');
    expect(JSON.stringify(result)).not.toContain(VALID_HASH);
  });
});
