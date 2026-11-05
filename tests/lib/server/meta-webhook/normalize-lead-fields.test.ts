// Normalizador puro de field_data Meta. Valores fictícios.
import { describe, expect, it } from 'vitest';
import {
  CAR_FALLBACK,
  META_LEAD_SOURCE,
  normalizeBrazilPhone,
  normalizeLeadgenFieldData,
  toFormFieldMapping,
} from '@/lib/server/meta-webhook/normalize-lead-fields';

const field = (name: string, ...values: unknown[]) => ({ name, values });

// META-MVP1: resultado completo do normalizador (sem e-mail, veículo ou respostas extras).
const fields = (over: Record<string, unknown>) => ({
  name: 'Cliente Teste', phone: '61999999999', email: null, vehicle: null, answers: [], answersTruncated: 0, sensitiveOmitted: 0,
  ...over,
});

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
    expect(r).toEqual({ ok: true, value: fields({ name: 'Cliente de Teste' }) });
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
      expect(r).toEqual({ ok: true, value: fields({ name: 'Cliente Teste' }) });
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

describe('normalizeLeadgenFieldData — veículo (META-MVP1)', () => {
  const base = [field('full_name', 'Cliente Teste'), field('phone_number', '61 99999-9999')];

  it('sem mapeamento: nunca adivinha o veículo, mas preserva os campos nas respostas', () => {
    const r = normalizeLeadgenFieldData([...base, field('car', 'Onix'), field('veiculo', 'HB20')]);
    expect(r).toEqual({
      ok: true,
      value: fields({ answers: [{ key: 'car', values: ['Onix'] }, { key: 'veiculo', values: ['HB20'] }] }),
    });
  });

  it('com mapeamento vehicle: usa o campo mapeado e não o repete nas respostas', () => {
    const r = normalizeLeadgenFieldData([...base, field('qual_carro', 'Onix 2024'), field('cor', 'Prata')], { vehicle: 'qual_carro' });
    expect(r).toEqual({ ok: true, value: fields({ vehicle: 'Onix 2024', answers: [{ key: 'cor', values: ['Prata'] }] }) });
  });

  it('veículo com várias escolhas vira uma lista separada por vírgula', () => {
    const r = normalizeLeadgenFieldData([...base, field('modelos', 'Onix', 'Tracker')], { vehicle: 'modelos' });
    expect(r.ok && r.value.vehicle).toBe('Onix, Tracker');
  });

  it('campo mapeado ausente ou longo demais: vehicle null, valor preservado nas respostas', () => {
    expect(normalizeLeadgenFieldData(base, { vehicle: 'qual_carro' })).toEqual({ ok: true, value: fields({}) });
    const long = 'x'.repeat(201);
    const r = normalizeLeadgenFieldData([...base, field('qual_carro', long)], { vehicle: 'qual_carro' });
    expect(r).toEqual({ ok: true, value: fields({ answers: [{ key: 'qual_carro', values: [long] }] }) });
  });
});

describe('normalizeLeadgenFieldData — mapeamento de nome/telefone/e-mail (META-MVP1)', () => {
  it('telefone mapeado tem precedência sobre phone_number', () => {
    const r = normalizeLeadgenFieldData(
      [field('full_name', 'Cliente Teste'), field('phone_number', '61 88888-8888'), field('whatsapp', '61 99999-9999')],
      { phone: 'whatsapp' },
    );
    expect(r).toEqual({ ok: true, value: fields({ answers: [{ key: 'phone_number', values: ['61 88888-8888'] }] }) });
  });

  it('telefone mapeado inválido → missing_phone (não cai para outro campo)', () => {
    const r = normalizeLeadgenFieldData(
      [field('full_name', 'Cliente Teste'), field('phone_number', '61 99999-9999'), field('whatsapp', '123')],
      { phone: 'whatsapp' },
    );
    expect(r).toEqual({ ok: false, code: 'missing_phone' });
  });

  it('nome mapeado tem precedência sobre full_name', () => {
    const r = normalizeLeadgenFieldData(
      [field('full_name', 'Outro Nome'), field('nome_completo', 'Cliente Teste'), field('phone_number', '61 99999-9999')],
      { name: 'nome_completo' },
    );
    expect(r).toEqual({ ok: true, value: fields({ answers: [{ key: 'full_name', values: ['Outro Nome'] }] }) });
  });

  it('e-mail padrão é normalizado; e-mail mapeado tem precedência', () => {
    const base = [field('full_name', 'Cliente Teste'), field('phone_number', '61 99999-9999')];
    expect(normalizeLeadgenFieldData([...base, field('email', ' Fake.Email@Test.Local ')])).toEqual({
      ok: true,
      value: fields({ email: 'fake.email@test.local' }),
    });
    const r = normalizeLeadgenFieldData([...base, field('email', 'a@b.co'), field('email_trabalho', 'c@d.co')], { email: 'email_trabalho' });
    expect(r).toEqual({ ok: true, value: fields({ email: 'c@d.co', answers: [{ key: 'email', values: ['a@b.co'] }] }) });
  });

  it('e-mail inválido não vira email, mas é preservado nas respostas', () => {
    const r = normalizeLeadgenFieldData([field('full_name', 'Cliente Teste'), field('phone_number', '61 99999-9999'), field('email', 'sem-arroba')]);
    expect(r).toEqual({ ok: true, value: fields({ answers: [{ key: 'email', values: ['sem-arroba'] }] }) });
  });

  it('toFormFieldMapping ignora alvo desconhecido e chave vazia', () => {
    expect(
      toFormFieldMapping([
        { target: 'vehicle', fieldKey: ' qual_carro ' },
        { target: 'cpf', fieldKey: 'cpf' },
        { target: 'email', fieldKey: '  ' },
      ]),
    ).toEqual({ vehicle: 'qual_carro' });
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

describe('normalizeLeadgenFieldData — preservação e minimização (META-MVP1)', () => {
  it('perguntas personalizadas são preservadas na ordem; documentos (CPF/RG/CNPJ) são omitidos', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', 'Cliente Teste'),
      field('phone_number', '61 99999-9999'),
      field('email', 'fake.email@test.local'),
      field('CPF', '000.000.000-00'),
      field('rg', '0000000'),
      field('pergunta_custom', 'resposta fictícia'),
      field('forma_pagamento', 'Financiamento', 'Troca'),
    ]);
    expect(r).toEqual({
      ok: true,
      value: fields({
        email: 'fake.email@test.local',
        answers: [
          { key: 'pergunta_custom', values: ['resposta fictícia'] },
          { key: 'forma_pagamento', values: ['Financiamento', 'Troca'] },
        ],
        sensitiveOmitted: 2,
      }),
    });
    expect(JSON.stringify(r)).not.toContain('000.000.000-00');
  });

  it('limites: no máximo 50 respostas, 10 valores e 1000 caracteres; caracteres de controle viram espaço', () => {
    const many = Array.from({ length: 55 }, (_, i) => field(`q${i}`, `r${i}`));
    const r = normalizeLeadgenFieldData([
      field('full_name', 'Cliente Teste'),
      field('phone_number', '61 99999-9999'),
      field('longa', 'a'.repeat(1500)),
      field('multi', ...Array.from({ length: 12 }, (_, i) => `v${i}`)),
      field('controle', 'linha1\nlinha2\u0000'),
      ...many,
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.answers).toHaveLength(50);
    expect(r.value.answersTruncated).toBe(8);
    expect(r.value.answers[0].values[0]).toHaveLength(1000);
    expect(r.value.answers[1].values).toHaveLength(10);
    expect(r.value.answers[2].values[0]).toBe('linha1 linha2');
  });

  it('chave repetida: vale a primeira ocorrência', () => {
    const r = normalizeLeadgenFieldData([
      field('full_name', 'Cliente Teste'),
      field('phone_number', '61 99999-9999'),
      field('cor', 'Prata'),
      field('cor', 'Preto'),
    ]);
    expect(r.ok && r.value.answers).toEqual([{ key: 'cor', values: ['Prata'] }]);
  });

  it('erro não carrega valores de entrada', () => {
    const r = normalizeLeadgenFieldData([field('phone_number', 'Cliente Secreto Fake')]);
    expect(JSON.stringify(r)).not.toContain('Cliente Secreto Fake');
  });
});
