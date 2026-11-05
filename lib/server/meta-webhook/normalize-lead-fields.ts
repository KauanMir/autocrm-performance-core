// Normalização pura do field_data de um lead Meta. SERVER-ONLY. Sem banco,
// sem rede, sem log.
//
// META-MVP1: além de nome e telefone (obrigatórios para criar o lead), devolve
// e-mail, veículo de interesse e TODAS as demais respostas, para que nada do
// que o cliente preencheu se perca. Regras:
//   - nada é inventado: campo ausente fica null / fora das respostas;
//   - veículo só vem de um campo mapeado para o formulário (sem adivinhar
//     nomes de campos de campanha);
//   - o mapeamento por formulário tem precedência sobre os nomes padrão da Meta;
//   - um valor que não serve para o campo normalizado (ex.: e-mail inválido)
//     continua preservado nas respostas;
//   - limites de tamanho iguais aos da tabela lead_form_submissions.
import type { MetaLeadErrorCode } from './error-codes';

// Rótulo legível gravado em leads.source (texto livre, sem enum). Única fonte.
export const META_LEAD_SOURCE = 'Meta Lead Ads';

// Valor exibido em leads.car quando o formulário não traz veículo (o CRM exige
// o campo). É o mesmo marcador de "ausente" da importação CSV; o valor real
// (ou a ausência dele) fica em lead_form_submissions.vehicle_interest.
export const CAR_FALLBACK = 'Não informado';

export const LEAD_FIELD_TARGETS = ['name', 'phone', 'email', 'vehicle'] as const;
export type LeadFieldTarget = (typeof LEAD_FIELD_TARGETS)[number];

// target -> nome do campo no formulário (field_data[].name).
export type FormFieldMapping = Partial<Record<LeadFieldTarget, string>>;

export const ANSWERS_MAX_ITEMS = 50;
export const ANSWER_KEY_MAX = 100;
export const ANSWER_VALUES_MAX = 10;
export const ANSWER_VALUE_MAX = 1000;
export const NAME_MAX = 200;
export const VEHICLE_MAX = 200;
export const EMAIL_MAX = 254;

export type LeadgenNormalizationErrorCode = Extract<
  MetaLeadErrorCode,
  'invalid_field_data' | 'missing_name' | 'missing_phone'
>;

export interface LeadFormAnswer {
  key: string;
  values: string[];
}

// Minimização: números de documento não são necessários para o primeiro
// atendimento e não são guardados nas respostas (comparação sem acento/caixa).
// Guardá-los exige decisão explícita de política (ver relatório MVP-1).
export const SENSITIVE_FIELD_KEYS: readonly string[] = ['cpf', 'cnpj', 'rg', 'national_id', 'national_id_number', 'documento'];

function isSensitiveKey(key: string): boolean {
  const normalized = key.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return SENSITIVE_FIELD_KEYS.includes(normalized);
}

export interface NormalizedLeadFields {
  name: string;
  // Dígitos nacionais canônicos (DDD + número). Igual ao phone_digits do CRM.
  phone: string;
  email: string | null;
  vehicle: string | null;
  // Respostas não consumidas pelos campos acima, na ordem do formulário.
  answers: LeadFormAnswer[];
  // Quantas respostas ficaram fora por exceder ANSWERS_MAX_ITEMS (sinal para log).
  answersTruncated: number;
  // Quantos campos de documento foram omitidos por minimização (sinal para log).
  sensitiveOmitted: number;
}

export type NormalizeLeadgenResult =
  | { ok: true; value: NormalizedLeadFields }
  | { ok: false; code: LeadgenNormalizationErrorCode };

const COUNTRY_CODE = '55';
// DDD (2 dígitos) + 8 dígitos (fixo/antigo) ou 9 dígitos (celular).
const NATIONAL_LENGTHS: readonly number[] = [10, 11];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// Aceita +55, 55 ou nacional, com ou sem máscara. Só remove o 55 quando o
// total tem 12 ou 13 dígitos. Trunk "0" e DDD que começa com 0 são rejeitados.
// Qualquer "+" que não seja "+55" é outro país e é rejeitado. Sem "+", um
// número estrangeiro de 11 dígitos não é detectável e é tratado como nacional.
export function normalizeBrazilPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('+') && !trimmed.startsWith('+55')) return null;
  let digits = raw.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith(COUNTRY_CODE)) {
    digits = digits.slice(COUNTRY_CODE.length);
  }
  if (!NATIONAL_LENGTHS.includes(digits.length)) return null;
  if (digits.startsWith('0')) return null;
  return digits;
}

export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value.length < 3 || value.length > EMAIL_MAX) return null;
  return EMAIL_PATTERN.test(value) ? value : null;
}

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function cleanValue(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').trim().slice(0, ANSWER_VALUE_MAX);
}

interface ParsedField {
  key: string;
  values: string[];
}

// Retorna null quando o formato geral é inválido. Campo com values vazio ou
// só em branco é tratado como ausente. Chave repetida: vale a primeira.
function parseFieldData(input: unknown): ParsedField[] | null {
  if (!Array.isArray(input)) return null;
  const fields: ParsedField[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null;
    const { name, values } = item as { name?: unknown; values?: unknown };
    if (typeof name !== 'string' || !Array.isArray(values)) return null;
    const kept: string[] = [];
    for (const value of values) {
      if (typeof value !== 'string') return null;
      const cleaned = cleanValue(value);
      if (cleaned !== '' && kept.length < ANSWER_VALUES_MAX) kept.push(cleaned);
    }
    const key = name.replace(CONTROL_CHARS, '').trim().slice(0, ANSWER_KEY_MAX);
    if (key === '' || kept.length === 0 || seen.has(key)) continue;
    seen.add(key);
    fields.push({ key, values: kept });
  }
  return fields;
}

function firstValue(fields: ParsedField[], key: string | undefined): string | undefined {
  if (!key) return undefined;
  return fields.find((field) => field.key === key)?.values[0];
}

function resolveName(fields: ParsedField[], mapping: FormFieldMapping): { name: string; keys: string[] } | null {
  const candidates: { keys: string[]; value: string | undefined }[] = [];
  if (mapping.name) candidates.push({ keys: [mapping.name], value: firstValue(fields, mapping.name) });
  candidates.push({ keys: ['full_name'], value: firstValue(fields, 'full_name') });
  for (const candidate of candidates) {
    if (candidate.value === undefined) continue;
    const collapsed = collapseSpaces(candidate.value).slice(0, NAME_MAX);
    if (collapsed !== '') return { name: collapsed, keys: candidate.keys };
  }
  const parts = (['first_name', 'last_name'] as const)
    .map((key) => ({ key, value: firstValue(fields, key) }))
    .filter((part): part is { key: 'first_name' | 'last_name'; value: string } => part.value !== undefined)
    .map((part) => ({ key: part.key, value: collapseSpaces(part.value) }))
    .filter((part) => part.value !== '');
  if (parts.length === 0) return null;
  return { name: parts.map((part) => part.value).join(' ').slice(0, NAME_MAX), keys: parts.map((part) => part.key) };
}

function resolvePhone(fields: ParsedField[], mapping: FormFieldMapping): { phone: string; key: string } | null {
  const keys = mapping.phone ? [mapping.phone, 'phone_number', 'phone'] : ['phone_number', 'phone'];
  for (const key of keys) {
    const value = firstValue(fields, key);
    if (value === undefined) continue;
    // O primeiro campo de telefone presente decide; inválido não cai para o próximo.
    const phone = normalizeBrazilPhone(value);
    return phone ? { phone, key } : null;
  }
  return null;
}

function resolveEmail(fields: ParsedField[], mapping: FormFieldMapping): { email: string; key: string } | null {
  const key = mapping.email ?? 'email';
  const value = firstValue(fields, key);
  if (value === undefined) return null;
  const email = normalizeEmail(value);
  return email ? { email, key } : null;
}

function resolveVehicle(fields: ParsedField[], mapping: FormFieldMapping): { vehicle: string; key: string } | null {
  if (!mapping.vehicle) return null;
  const field = fields.find((candidate) => candidate.key === mapping.vehicle);
  if (!field) return null;
  const joined = collapseSpaces(field.values.join(', '));
  if (joined === '' || joined.length > VEHICLE_MAX) return null;
  return { vehicle: joined, key: field.key };
}

export function normalizeLeadgenFieldData(input: unknown, mapping: FormFieldMapping = {}): NormalizeLeadgenResult {
  const fields = parseFieldData(input);
  if (fields === null) return { ok: false, code: 'invalid_field_data' };

  const name = resolveName(fields, mapping);
  if (name === null) return { ok: false, code: 'missing_name' };

  const phone = resolvePhone(fields, mapping);
  if (phone === null) return { ok: false, code: 'missing_phone' };

  const email = resolveEmail(fields, mapping);
  const vehicle = resolveVehicle(fields, mapping);

  const consumed = new Set<string>([...name.keys, phone.key]);
  if (email) consumed.add(email.key);
  if (vehicle) consumed.add(vehicle.key);

  const unconsumed = fields.filter((field) => !consumed.has(field.key));
  const remaining = unconsumed.filter((field) => !isSensitiveKey(field.key));
  const answers = remaining.slice(0, ANSWERS_MAX_ITEMS).map((field) => ({ key: field.key, values: field.values }));

  return {
    ok: true,
    value: {
      name: name.name,
      phone: phone.phone,
      email: email?.email ?? null,
      vehicle: vehicle?.vehicle ?? null,
      answers,
      answersTruncated: remaining.length - answers.length,
      sensitiveOmitted: unconsumed.length - remaining.length,
    },
  };
}

// Converte as linhas de meta_form_mapping_for_processing em FormFieldMapping.
// Alvo desconhecido ou chave vazia é ignorado.
export function toFormFieldMapping(rows: readonly { target: string; fieldKey: string }[]): FormFieldMapping {
  const mapping: FormFieldMapping = {};
  for (const row of rows) {
    if ((LEAD_FIELD_TARGETS as readonly string[]).includes(row.target) && row.fieldKey.trim() !== '') {
      mapping[row.target as LeadFieldTarget] = row.fieldKey.trim();
    }
  }
  return mapping;
}
