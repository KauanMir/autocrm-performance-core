// tests/server/invites/ip.test.ts — extração/normalização/hash de IP para
// o rate limit por IP do endpoint público de validação de convite (M1-F
// S4-C2A). Nenhuma rede — funções puras sobre Request/Headers nativos e
// node:crypto/node:net.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp, hashIp, UntrustedIpSourceError } from '@/lib/server/invites/ip';

const PEPPER_A = Buffer.from('a'.repeat(64), 'hex');
const PEPPER_B = Buffer.from('b'.repeat(64), 'hex');

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('http://127.0.0.1:3000/api/invites/validate', { method: 'POST', headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getClientIp — ambiente Vercel (VERCEL=1)', () => {
  it('usa x-vercel-forwarded-for com prioridade máxima', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({
      'x-vercel-forwarded-for': '203.0.113.10',
      'x-forwarded-for': '198.51.100.20',
      'x-real-ip': '192.0.2.30',
    });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('cai para x-forwarded-for quando x-vercel-forwarded-for está ausente', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-forwarded-for': '198.51.100.20', 'x-real-ip': '192.0.2.30' });
    expect(getClientIp(request)).toBe('198.51.100.20');
  });

  it('cai para x-real-ip como último fallback', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '192.0.2.30' });
    expect(getClientIp(request)).toBe('192.0.2.30');
  });

  it('considera somente o primeiro item de uma lista x-forwarded-for', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-forwarded-for': '203.0.113.10, 198.51.100.20, 192.0.2.30' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('múltiplas vírgulas sem espaço também extraem só o primeiro item', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-forwarded-for': '203.0.113.10,198.51.100.20,192.0.2.30' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });
});

describe('getClientIp — formatos de endereço', () => {
  it('IPv4 simples', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '203.0.113.10' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('IPv4 com porta (formato inequívoco)', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '203.0.113.10:8443' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('IPv6 simples', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '2001:db8::1' });
    expect(getClientIp(request)).toBe('2001:db8::1');
  });

  it('IPv6 entre colchetes', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '[2001:db8::1]' });
    expect(getClientIp(request)).toBe('2001:db8::1');
  });

  it('IPv6 entre colchetes com porta', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '[2001:db8::1]:8443' });
    expect(getClientIp(request)).toBe('2001:db8::1');
  });

  it('IPv6 expandido e comprimido produzem a mesma normalização', () => {
    vi.stubEnv('VERCEL', '1');
    const expanded = requestWithHeaders({ 'x-real-ip': '2001:0db8:0000:0000:0000:0000:0000:0001' });
    const compressed = requestWithHeaders({ 'x-real-ip': '2001:db8::1' });
    expect(getClientIp(expanded)).toBe(getClientIp(compressed));
  });

  it('loopback IPv6 expandido normaliza para ::1', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '0000:0000:0000:0000:0000:0000:0000:0001' });
    expect(getClientIp(request)).toBe('::1');
  });

  it('header vazio é ignorado, cai para o próximo da prioridade', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-vercel-forwarded-for': '', 'x-real-ip': '203.0.113.10' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('texto arbitrário não reconhecido cai no sentinela (nunca refletido)', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': 'not-an-ip-at-all' });
    const result = getClientIp(request);
    expect(result).not.toBe('not-an-ip-at-all');
    expect(result).not.toContain('not-an-ip-at-all');
  });

  it('IPv4-mapped IPv6 é rejeitado — nunca produz um bucket diferente do IPv4 puro equivalente (auditoria adversarial)', () => {
    vi.stubEnv('VERCEL', '1');
    const plainIpv4 = requestWithHeaders({ 'x-real-ip': '203.0.113.10' });
    const mappedForm = requestWithHeaders({ 'x-real-ip': '::ffff:203.0.113.10' });
    // A forma mapeada é rejeitada (cai no sentinela, sem outro header
    // disponível) — nunca deve coincidir silenciosamente com o IPv4 puro
    // por um caminho diferente que produza outro valor não determinístico.
    expect(getClientIp(mappedForm)).not.toBe(getClientIp(plainIpv4));
  });

  it('IPv4-mapped IPv6 em forma hexadecimal também é rejeitado', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-real-ip': '::ffff:cb00:710a' });
    const result = getClientIp(request);
    expect(result).not.toContain('ffff');
  });

  it('IPv4-mapped IPv6 rejeitado cai para o próximo header da prioridade', () => {
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({
      'x-vercel-forwarded-for': '::ffff:203.0.113.10',
      'x-forwarded-for': '198.51.100.20',
    });
    expect(getClientIp(request)).toBe('198.51.100.20');
  });

  it('zone identifier IPv6 (link-local) é rejeitado, nunca produz variações por sufixo arbitrário', () => {
    vi.stubEnv('VERCEL', '1');
    const withZoneA = requestWithHeaders({ 'x-real-ip': 'fe80::1%eth0' });
    const withZoneB = requestWithHeaders({ 'x-real-ip': 'fe80::1%eth1' });
    // Ambos caem no sentinela (rejeitados) — nunca dois hashes diferentes
    // para o que seria o "mesmo" endereço com sufixo variável.
    expect(getClientIp(withZoneA)).toBe(getClientIp(withZoneB));
  });

  it('header com tamanho excessivo (milhares de itens) nunca é totalmente materializado — extrai o primeiro item real rapidamente', () => {
    vi.stubEnv('VERCEL', '1');
    const huge = `203.0.113.10,${'x'.repeat(100_000)}`;
    const request = requestWithHeaders({ 'x-real-ip': huge });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('header hostil sem vírgula alguma (só lixo grande) cai no sentinela sem travar', () => {
    vi.stubEnv('VERCEL', '1');
    const huge = 'y'.repeat(200_000);
    const request = requestWithHeaders({ 'x-real-ip': huge, 'x-vercel-forwarded-for': huge });
    const result = getClientIp(request);
    expect(result.length).toBeLessThan(100);
  });
});

describe('getClientIp — comportamento por ambiente', () => {
  it('development sem nenhum header cai num sentinela fixo, nunca string vazia', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '');
    const request = requestWithHeaders({});
    const result = getClientIp(request);
    expect(result).not.toBe('');
    expect(typeof result).toBe('string');
  });

  it('development: mesmo sentinela em duas chamadas sem header (determinístico)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '');
    const first = getClientIp(requestWithHeaders({}));
    const second = getClientIp(requestWithHeaders({}));
    expect(first).toBe(second);
  });

  it('development fora da Vercel ainda aceita headers para testes determinísticos', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '');
    const request = requestWithHeaders({ 'x-forwarded-for': '203.0.113.10' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('production SEM Vercel falha fechado (nunca confia em header espofável)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '');
    const request = requestWithHeaders({ 'x-forwarded-for': '203.0.113.10' });
    expect(() => getClientIp(request)).toThrow(UntrustedIpSourceError);
  });

  it('production SEM Vercel falha fechado mesmo sem nenhum header presente', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '');
    expect(() => getClientIp(requestWithHeaders({}))).toThrow(UntrustedIpSourceError);
  });

  it('production COM Vercel (VERCEL=1) confia normalmente nos headers', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    const request = requestWithHeaders({ 'x-vercel-forwarded-for': '203.0.113.10' });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });
});

describe('hashIp', () => {
  it('devolve 64 caracteres hexadecimais minúsculos', () => {
    const hash = hashIp('203.0.113.10', PEPPER_A);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('determinístico: mesmo IP + mesmo pepper sempre produz o mesmo hash', () => {
    expect(hashIp('203.0.113.10', PEPPER_A)).toBe(hashIp('203.0.113.10', PEPPER_A));
  });

  it('peppers diferentes geram hashes diferentes para o mesmo IP', () => {
    expect(hashIp('203.0.113.10', PEPPER_A)).not.toBe(hashIp('203.0.113.10', PEPPER_B));
  });

  it('IPs diferentes geram hashes diferentes com o mesmo pepper', () => {
    expect(hashIp('203.0.113.10', PEPPER_A)).not.toBe(hashIp('198.51.100.20', PEPPER_A));
  });

  it('nunca é um hash reversível trivial (createHash puro do IP não bate)', () => {
    const naiveSha256 = require('node:crypto').createHash('sha256').update('203.0.113.10').digest('hex');
    expect(hashIp('203.0.113.10', PEPPER_A)).not.toBe(naiveSha256);
  });
});
