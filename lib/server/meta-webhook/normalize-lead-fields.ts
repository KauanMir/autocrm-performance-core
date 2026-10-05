// Normalização pura do field_data de um lead Meta para os campos do CRM.
// SERVER-ONLY. Sem banco, sem rede. Nunca devolve field_data bruto, e-mail,
// CPF nem campos customizados. Validação esperada devolve código tipado.
import type { MetaLeadErrorCode } from './error-codes';

// Rótulo legível gravado em leads.source (texto livre, sem enum). Única fonte.
export const META_LEAD_SOURCE = 'Meta Lead Ads';

export const CAR_FALLBACK = 'Não informado';

// Whitelist vazia de propósito: nomes de campos de veículo só entram depois de
// conferir o formulário real da KAPA CRM Teste. Não adivinhar aliases.
export const CAR_FIELD_ALIASES: readonly string[] = [];

export type LeadgenNormalizationErrorCode = Extract<
  MetaLeadErrorCode,
  'invalid_field_data' | 'missing_name' | 'missing_phone'
>;

export interface NormalizedLeadFields {
  name: string;
  // Dígitos nacionais canônicos (DDD + número). Igual ao phone_digits do CRM.
  phone: string;
  car: string;
}

export type NormalizeLeadgenResult =
  | { ok: true; value: NormalizedLeadFields }
  | { ok: false; code: LeadgenNormalizationErrorCode };

const COUNTRY_CODE = '55';
// DDD (2 dígitos) + 8 dígitos (fixo/antigo) ou 9 dígitos (celular).
const NATIONAL_LENGTHS: readonly number[] = [10, 11];

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

function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

type ParsedFields = Map<string, string>;

// Retorna null quando o formato geral é inválido. Campo com values vazio ou
// só em branco é tratado como ausente, não como inválido.
function parseFieldData(input: unknown): ParsedFields | null {
  if (!Array.isArray(input)) return null;
  const fields: ParsedFields = new Map();
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null;
    const { name, values } = item as { name?: unknown; values?: unknown };
    if (typeof name !== 'string' || !Array.isArray(values)) return null;
    let first: string | null = null;
    for (const value of values) {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (trimmed !== '') {
        first = trimmed;
        break;
      }
    }
    if (first !== null && !fields.has(name)) fields.set(name, first);
  }
  return fields;
}

function resolveName(fields: ParsedFields): string | null {
  const fullName = fields.get('full_name');
  if (fullName !== undefined) {
    const collapsed = collapseSpaces(fullName);
    if (collapsed !== '') return collapsed;
  }
  const parts = [fields.get('first_name'), fields.get('last_name')]
    .filter((part): part is string => part !== undefined)
    .map(collapseSpaces)
    .filter((part) => part !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

function resolvePhone(fields: ParsedFields): string | null {
  const primary = fields.get('phone_number');
  if (primary !== undefined) return normalizeBrazilPhone(primary);
  const fallback = fields.get('phone');
  if (fallback !== undefined) return normalizeBrazilPhone(fallback);
  return null;
}

function resolveCar(fields: ParsedFields): string {
  for (const alias of CAR_FIELD_ALIASES) {
    const value = fields.get(alias);
    if (value !== undefined) return value;
  }
  return CAR_FALLBACK;
}

export function normalizeLeadgenFieldData(input: unknown): NormalizeLeadgenResult {
  const fields = parseFieldData(input);
  if (fields === null) return { ok: false, code: 'invalid_field_data' };

  const name = resolveName(fields);
  if (name === null) return { ok: false, code: 'missing_name' };

  const phone = resolvePhone(fields);
  if (phone === null) return { ok: false, code: 'missing_phone' };

  return { ok: true, value: { name, phone, car: resolveCar(fields) } };
}
