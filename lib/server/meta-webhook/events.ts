// lib/server/meta-webhook/events.ts — extração TOLERANTE de metadados
// técnicos mínimos de um payload de webhook da Meta que JÁ passou pela
// validação de assinatura e pelo JSON.parse. Este módulo:
//   - NÃO persiste nada;
//   - NÃO chama a Graph API;
//   - NÃO cria lead, tarefa, visita, negociação, timeline;
//   - só devolve o que pode ser logado com segurança para diagnóstico.
// Qualquer forma inesperada é ignorada sem lançar (contrato: tolerar
// payloads desconhecidos sem quebrar).

export interface LeadgenChangeMeta {
  pageId?: string;
  formId?: string;
  leadgenId?: string;
  createdTime?: number | string;
}

export interface ParsedMetaWebhook {
  object: string | null;
  isPage: boolean;
  // Só metadados técnicos — nunca conteúdo do formulário / PII.
  leadgenChanges: LeadgenChangeMeta[];
  // Mudanças em objeto Page que não são `field === 'leadgen'`.
  otherChangeCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

// `payload` é o resultado de JSON.parse(rawBody) — `unknown` de propósito.
export function parseMetaWebhookPayload(payload: unknown): ParsedMetaWebhook {
  const root = asRecord(payload);
  const object = root ? asString(root.object) ?? null : null;
  const isPage = object === 'page';

  const leadgenChanges: LeadgenChangeMeta[] = [];
  let otherChangeCount = 0;

  const entries = root && Array.isArray(root.entry) ? root.entry : [];
  for (const entryRaw of entries) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeRaw of changes) {
      const change = asRecord(changeRaw);
      if (!change || change.field !== 'leadgen') {
        otherChangeCount += 1;
        continue;
      }

      const changeValue = asRecord(change.value) ?? {};
      leadgenChanges.push({
        // page_id no value; fallback para o id do entry.
        pageId: asString(changeValue.page_id) ?? asString(entry.id),
        formId: asString(changeValue.form_id),
        leadgenId: asString(changeValue.leadgen_id),
        createdTime: asStringOrNumber(changeValue.created_time),
      });
    }
  }

  return { object, isPage, leadgenChanges, otherChangeCount };
}
