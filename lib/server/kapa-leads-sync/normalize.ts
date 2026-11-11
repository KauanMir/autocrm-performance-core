// lib/server/kapa-leads-sync/normalize.ts — lead do KAPA Leads → item da fila do CRM. SERVER-ONLY.
// Sem efeitos: só monta o payload validado depois no banco (kapa_leads_payload_valid).
// Respostas no formato de lead_form_answers_valid: [{ key (1..100), values: [1..1000] (1..10) }], ≤ 50.
import type { ExportedLead } from './client';

export const SOURCE_SUFFIX = ' (KAPA Leads)';
const MAX_ANSWERS = 50;
const TIME_ZONE = 'America/Sao_Paulo';

export type IngestItem = {
  source_lead_id: string;
  source_campaign_id: string;
  source_campaign_slug: string;
  source_campaign_name: string;
  source_created_at: string;
  store_id: string;
  payload: {
    contact: { name: string; phone: string; email: string | null };
    vehicle: string | null;
    answers: { key: string; values: string[] }[];
    source_label: string;
  };
};

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Telefone do KAPA Leads já vem só com dígitos (DDD + número); +55 é removido por segurança. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return /^55[1-9][0-9]{9,10}$/.test(digits) ? digits.slice(2) : digits;
}

const SIMULATION_TERM = /^simulation([0-9]{1,3})Cents$/;

/** Rótulos padrão dos campos de simulação (docs do KAPA Leads, "Simulação apresentada"). */
function defaultLabel(key: string): string | null {
  if (key === 'simulationFinancedAmountCents') return 'Valor a financiar (simulação)';
  if (key === 'simulationMonthlyRateBps') return 'Taxa mensal (simulação)';
  if (key === 'simulationSelectedTerm') return 'Prazo escolhido (meses)';
  const term = SIMULATION_TERM.exec(key);
  if (term) return `Parcela em ${term[1]} meses (simulação)`;
  return null;
}

export function formatValue(key: string, value: string | number | boolean, format: string | null): string {
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') {
    if ((format === 'money' || key.endsWith('Cents')) && Number.isSafeInteger(value)) return money(value);
    if (key.endsWith('Bps') && Number.isSafeInteger(value)) {
      return `${(value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% a.m.`;
    }
    return value.toLocaleString('pt-BR');
  }
  return value.trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function buildAnswers(lead: ExportedLead): { key: string; values: string[] }[] {
  const answers: { key: string; values: string[] }[] = [];
  const used = new Set<string>();
  const push = (key: string, value: string | null | undefined) => {
    const k = clip(key.trim(), 100);
    const v = value?.trim();
    if (!k || !v || used.has(k) || answers.length >= MAX_ANSWERS) return;
    used.add(k);
    answers.push({ key: k, values: [clip(v, 1000)] });
  };

  push('Campanha', lead.campaign.name);

  // Campos da campanha, na ordem do formData, com o rótulo do form_schema quando existe.
  for (const [key, value] of Object.entries(lead.formData)) {
    if (value === null) continue;
    const label = lead.formLabels[key]?.label ?? defaultLabel(key) ?? key;
    const text = formatValue(key, value, lead.formLabels[key]?.format ?? null);
    if (text) push(label, text);
  }

  if (lead.illustrative) {
    push('Valor ilustrativo apresentado', `${money(lead.illustrative.amountCents)} (ilustrativo, não é aprovação de crédito)`);
    push('Validade do valor ilustrativo', formatDateTime(lead.illustrative.expiresAt));
  }
  if (lead.cpfCooldownUntil) push('Nova simulação liberada a partir de', formatDateTime(lead.cpfCooldownUntil));

  push('Consentimento', `Versão ${lead.consent.version}, aceito em ${formatDateTime(lead.consent.at)}`);

  const t = lead.tracking;
  push('utm_source', t.utmSource);
  push('utm_medium', t.utmMedium);
  push('utm_campaign', t.utmCampaign);
  push('utm_content', t.utmContent);
  push('utm_term', t.utmTerm);
  push('Página de origem', t.pageUrl);
  push('Referência', t.referrer);

  push('ID no KAPA Leads', lead.id);
  return answers;
}

export function vehicleFrom(lead: ExportedLead, vehicleFormKey: string | null): string | null {
  if (!vehicleFormKey) return null;
  const value = lead.formData[vehicleFormKey];
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? clip(text, 200) : null;
}

export function sourceLabel(lead: ExportedLead): string {
  return clip(`${lead.campaign.name.trim()}${SOURCE_SUFFIX}`, 200);
}

export function toIngestItem(lead: ExportedLead, vehicleFormKey: string | null): IngestItem {
  const email = lead.contact.email?.trim().toLowerCase() || null;
  return {
    source_lead_id: lead.id,
    source_campaign_id: lead.campaign.id,
    source_campaign_slug: lead.campaign.slug,
    source_campaign_name: lead.campaign.name.trim(),
    source_created_at: lead.createdAt,
    store_id: lead.storeId,
    payload: {
      contact: { name: lead.contact.name.trim().replace(/\s+/g, ' '), phone: normalizePhone(lead.contact.phone), email },
      vehicle: vehicleFrom(lead, vehicleFormKey),
      answers: buildAnswers(lead),
      source_label: sourceLabel(lead),
    },
  };
}
