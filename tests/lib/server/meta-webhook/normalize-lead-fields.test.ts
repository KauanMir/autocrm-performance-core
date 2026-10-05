// Normalizador puro de field_data Meta. Valores fictícios.
import { describe, expect, it } from 'vitest';
import {
  CAR_FALLBACK,
  META_LEAD_SOURCE,
  normalizeBrazilPhone,
  normalizeLeadgenFieldData,
} from '@/lib/server/meta-webhook/normalize-lead-fields';

const field = (name: string, ...values: unknown[]) => ({ name, values });

describe('constantes', () => {
  it('source é exatamente "Meta Lead Ads" e car fallback é "Não informado"', () => {
    expect(META_LEAD_SOURCE).toBe('Meta Lead Ads');
    expect(CAR_FALLBACK).toBe('Não informado');
  });
});

describe('normalizeBrazilPhone', () => {
  const CANONICAL = '61999999999';

  it.each([
    ['+55 61 99999-9999'],
    ['5561999999999'],
    ['61 99999-9999'],
    ['(61) 99999-9999'],
    ['61999999999'],
    ['+55 (61) 99999-9999'],
  ])('%s gera a mesma representação canônica', (raw) => {
    expect(normalizeBrazilPhone(raw)).toBe(CANONICAL);
  });

  it('fixo/antigo de 8 dígitos (10 nacionais) também é canônico', () => {
    expect(normalizeBrazilPhone('+55 61 3333-4444')).toBe('6133334444');
    expect(normalizeBrazilPhone('6133334444')).toBe('6133334444');
  });

  it('remove 55 somente quando o total tem 12 ou 13 dígitos', () => {
    expect(normalizeBrazilPhone('55 99 99999-9999')).toBe('99999999999');
    expect(normalizeBrazilPhone('55999999999')).toBe('55999999999');
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['(--)'],
    ['123'],
    ['619999999'],
    ['619999999999'],
    ['+55 61 9999'],
    ['061 99999-9999'],
    ['+1 415 555 0100'],
    ['556199999999999'],
  ])('telefone inválido %j → null', (raw) => {
    expect(normalizeBrazilPhone(raw)).toBeNull();
  });

  it('não-string → null', () => {
    expect(normalizeBrazilPhone(undefined)).toBeNull();
    expect(normalizeBrazilPhone(61999999999)).toBeNull();
  });
});

describe('normalizeLeadgenFieldData — name', () => {
  it('full_name com espaços sobrando é normalizado', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', '  Cliente   de  Teste  '),
      field('phone_number', '61 99999-9999'),
    ]);
    expect(r).toEqual({ ok: true, value: { name: 'Cliente de Teste', phone: '61999999999', car: CAR_FALLBACK } });
  });

  it('full_name vazio cai para first_name + last_name', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', '   '),
      field('first_name', ' Ana '),
      field('last_name', 'Souza'),
      field('phone_number', '61 99999-9999'),
    ]);
    expect(r.ok && r.value.name).toBe('Ana Souza');
  });

  it('first_name sozinho é aceito como nome', () => {
    const r = normalizeLeadgenFieldData([field('first_name', 'Ana'), field('phone_number', '61 99999-9999')]);
    expect(r.ok && r.value.name).toBe('Ana');
  });

  it('last_name sozinho é aceito como nome', () => {
    const r = normalizeLeadgenFieldData([field('last_name', ' Souza '), field('phone_number', '61 99999-9999')]);
    expect(r.ok && r.value.name).toBe('Souza');
  });

  it('sem nome → missing_name', () => {
    expect(normalizeLeadgenFieldData([field('phone_number', '61 99999-9999')])).toEqual({
      ok: false,
      code: 'missing_name',
    });
    expect(
      normalizeLeadgenFieldData([field('full_name', '  '), field('first_name', ''), field('phone_number', '61 99999-9999')]),
    ).toEqual({ ok: false, code: 'missing_name' });
  });
});

describe('normalizeLeadgenFieldData — phone', () => {
  const base = [field('full_name', 'Cliente Teste')];

  it.each([['+55 61 99999-9999'], ['5561999999999'], ['61 99999-9999'], ['(61) 99999-9999']])(
    'phone_number %s → 61999999999',
    (raw) => {
      const r = normalizeLeadgenFieldData([...base, field('phone_number', raw)]);
      expect(r).toEqual({ ok: true, value: { name: 'Cliente Teste', phone: '61999999999', car: CAR_FALLBACK } });
    },
  );

  it('phone usado quando phone_number está ausente', () => {
    const r = normalizeLeadgenFieldData([...base, field('phone', '(61) 99999-9999')]);
    expect(r.ok && r.value.phone).toBe('61999999999');
  });

  it('phone_number tem prioridade sobre phone', () => {
    const r = normalizeLeadgenFieldData([...base, field('phone', '(61) 88888-8888'), field('phone_number', '61 99999-9999')]);
    expect(r.ok && r.value.phone).toBe('61999999999');
  });

  it('phone_number presente porém inválido → missing_phone (sem fallback silencioso)', () => {
    const r = normalizeLeadgenFieldData([...base, field('phone_number', '123'), field('phone', '61 99999-9999')]);
    expect(r).toEqual({ ok: false, code: 'missing_phone' });
  });

  it('sem telefone → missing_phone', () => {
    expect(normalizeLeadgenFieldData(base)).toEqual({ ok: false, code: 'missing_phone' });
  });

  it('telefone sem dígitos → missing_phone', () => {
    expect(normalizeLeadgenFieldData([...base, field('phone_number', '---')])).toEqual({
      ok: false,
      code: 'missing_phone',
    });
  });

  it('telefone estruturalmente inválido → missing_phone', () => {
    expect(normalizeLeadgenFieldData([...base, field('phone_number', '+1 415 555 0100')])).toEqual({
      ok: false,
      code: 'missing_phone',
    });
  });
});

describe('normalizeLeadgenFieldData — car', () => {
  it('sempre "Não informado" enquanto a whitelist estiver vazia', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', 'Cliente Teste'),
      field('phone_number', '61 99999-9999'),
      field('car', 'Onix'),
      field('vehicle', 'Onix'),
      field('veiculo', 'Onix'),
      field('modelo', 'Onix'),
    ]);
    expect(r.ok && r.value.car).toBe(CAR_FALLBACK);
  });
});

describe('normalizeLeadgenFieldData — formato inválido', () => {
  const valid = [field('full_name', 'Cliente Teste'), field('phone_number', '61 99999-9999')];

  it('field_data não-array → invalid_field_data', () => {
    expect(normalizeLeadgenFieldData(undefined)).toEqual({ ok: false, code: 'invalid_field_data' });
    expect(normalizeLeadgenFieldData({ full_name: 'x' })).toEqual({ ok: false, code: 'invalid_field_data' });
    expect(normalizeLeadgenFieldData('x')).toEqual({ ok: false, code: 'invalid_field_data' });
  });

  it('item inválido (não-objeto ou null) → invalid_field_data', () => {
    expect(normalizeLeadgenFieldData([...valid, 'x'])).toEqual({ ok: false, code: 'invalid_field_data' });
    expect(normalizeLeadgenFieldData([...valid, null])).toEqual({ ok: false, code: 'invalid_field_data' });
  });

  it('name não-string → invalid_field_data', () => {
    expect(normalizeLeadgenFieldData([...valid, { name: 1, values: ['x'] }])).toEqual({
      ok: false,
      code: 'invalid_field_data',
    });
  });

  it('values ausente → invalid_field_data', () => {
    expect(normalizeLeadgenFieldData([...valid, { name: 'car' }])).toEqual({ ok: false, code: 'invalid_field_data' });
  });

  it('values não-array → invalid_field_data', () => {
    expect(normalizeLeadgenFieldData([...valid, { name: 'car', values: 'Onix' }])).toEqual({
      ok: false,
      code: 'invalid_field_data',
    });
  });

  it('elemento de values não-string → invalid_field_data', () => {
    expect(normalizeLeadgenFieldData([...valid, field('car', 42)])).toEqual({
      ok: false,
      code: 'invalid_field_data',
    });
  });

  it('values vazio ou só em branco é ausente, não inválido', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', 'Cliente Teste'),
      field('phone_number', '61 99999-9999'),
      field('car', ''),
      field('email', '  '),
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('normalizeLeadgenFieldData — campos ignorados e sanitização', () => {
  it('email, CPF e campos custom não aparecem no resultado', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', 'Cliente Teste'),
      field('phone_number', '61 99999-9999'),
      field('email', 'fake.email@test.local'),
      field('cpf', '000.000.000-00'),
      field('pergunta_custom', 'resposta fictícia'),
    ]);
    expect(r.ok).toBe(true);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain('fake.email');
    expect(serialized).not.toContain('000.000.000-00');
    expect(serialized).not.toContain('resposta fictícia');
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['car', 'name', 'phone']);
  });

  it('erro não carrega valores de entrada', () => {
    const r = normalizeLeadgenFieldData([field('phone_number', 'Cliente Secreto Fake')]);
    expect(JSON.stringify(r)).not.toContain('Cliente Secreto Fake');
  });
});
