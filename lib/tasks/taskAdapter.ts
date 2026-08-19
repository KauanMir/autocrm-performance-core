// lib/tasks/taskAdapter.ts — adapter de Tasks remotas
// (COMMERCIAL-REMOTE-B1-B2-A). Puro e determinístico: sem rede, sem React,
// sem store, sem feature flag, sem window/localStorage, sem dados globais.
// Converte RemoteTaskRow (Supabase, derivado de Database — regenerado nesta
// etapa contra o banco LOCAL, migration #51) no modelo de UI mantendo
// compatibilidade com o tipo Task legado (lib/data.ts) enquanto os
// consumidores atuais (TaskRow/ScreenPendencias) existirem.
//
// `RemoteTaskRow` (não `TaskRow`, de propósito): o componente local
// `TaskRow` (components/screens/ScreensOps.tsx) já usa esse nome — um tipo
// de dados com o mesmo nome de um componente React seria uma colisão de
// leitura real neste arquivo, mesmo sem colisão de módulo.
import type { Task, TaskState } from '@/lib/data';
import type { Database } from '@/lib/supabase/database.types';
import { deriveTaskState } from '@/lib/tasks/deriveTaskState';
import { formatTaskWhen } from '@/lib/tasks/formatTaskWhen';

export type RemoteTaskRow = Database['public']['Tables']['tasks']['Row'];

// ── Modelo de UI ─────────────────────────────────────────────────────────
// Compatível com o Task legado (prio/state/when continuam os mesmos nomes,
// mas passam a ser MAPEADOS/DERIVADOS, nunca colunas SQL cruas) + o mínimo
// de metadata remota com consumidor real identificado (precheck B1-B2 §6,
// correção do B1-B2-A-EXEC):
//   - dueAt: consumida pelo futuro fluxo de reagendamento remoto (B1-B3),
//     que precisa pré-popular um date/time picker a partir do valor atual
//     — `when` (texto formatado) não é reversível para esse fim.
//   - version: consumida pelas mutations remotas (B1-B2-C) como
//     p_expected_version.
// companyId/completedAt/updatedAt foram avaliados e REJEITADOS: nenhum
// consumidor real foi identificado (LeadModel, o precedente direto, também
// não carrega companyId — os hooks já recebem companyId pelo próprio
// parâmetro de identidade, nunca duplicado no model; completedAt não tem
// leitor porque a query remota só busca status=pending, B1-B2 precheck
// §11; updatedAt não tem nenhuma superfície de "última atualização" na UI
// atual nem planejada). Se um consumidor real surgir depois, adicionar
// então — nunca por conveniência antecipada.
export interface RemoteTaskModel extends Task {
  dueAt: string; // ISO instant cru — nunca reformatado a partir de `when`.
  version: number;
}

// ── Contexto explícito ───────────────────────────────────────────────────

export interface TaskLeadRef {
  id: string;
  name: string;
}

// CORREÇÃO ARQUITETURAL (B1-B2-B1-EXEC §0): o adapter NÃO depende mais de
// um catálogo de Sellers. Motivo: RemoteTaskModel nunca teve um campo de
// nome de Seller (só `assignedTo`, o id — mesmo shape do Task legado);
// nenhuma tela atual ou planejada exibe o nome do Seller numa Task
// (TaskRow mostra título/nota/prazo/Lead, nunca responsável); o Manager
// picker de FlowNovaPendencia usa outro catálogo (SellerService/
// useCurrentCompanyAssignableSellers), nunca este adapter; e
// TaskService/Home (B1-B3) precisam adaptar Tasks de forma síncrona, sem
// nenhum hook React de Seller disponível fora de um componente montado —
// exigir sellersById aqui os travaria estruturalmente. Integridade
// Seller/company continua garantida pelo banco (tasks_company_seller_fk,
// RLS, RPC) — o adapter nunca precisou revalidar isso, só o fazia por
// cautela; a cautela criava uma dependência fictícia. Se uma tela futura
// precisar exibir o nome do Seller, ela resolve na camada de
// apresentação (como Lead name já faz via leadsById), nunca aqui.
export interface TaskAdapterContext {
  // Lead ativo (não-arquivado) já carregado — tipicamente o snapshot
  // remoto de Leads (lib/leads/remoteSnapshot.ts), lido pelo composer
  // futuro (B1-B2-B), nunca buscado aqui. Um lead_id ausente deste mapa
  // NÃO é tratado como erro (ver leadPlaceholder abaixo) — pode ser um
  // Lead arquivado, ou o catálogo ainda não ter carregado; o adapter não
  // consegue e não tenta distinguir os dois casos.
  leadsById: Readonly<Record<string, TaskLeadRef>>;
}

// Texto neutro deliberado (B1-B2-A-EXEC §8): NÃO afirma "arquivado" porque
// o adapter não consegue distinguir "Lead realmente arquivado" de "cache
// de Leads ainda não carregado" — os dois produzem a mesma ausência em
// leadsById. Afirmar "arquivado" seria mentir para o usuário sempre que o
// segundo caso for o real.
export const TASK_LEAD_UNAVAILABLE_DISPLAY_VALUE = 'Cliente indisponível';

// ── Resultado discriminado (mesmo padrão do adapter de Leads) ───────────

export type TaskAdapterErrorCode =
  | 'invalid_due_at'
  | 'invalid_priority'
  | 'invalid_status'
  | 'invalid_version';

export interface TaskAdapterError {
  ok: false;
  reason: 'invalid_task_configuration';
  code: TaskAdapterErrorCode;
  taskId: string;
  // Posição do registro inválido quando o erro vem de adaptRemoteTaskRows;
  // null em chamadas unitárias.
  rowIndex: number | null;
}

export type AdaptTaskRowResult = { ok: true; task: RemoteTaskModel } | TaskAdapterError;
export type AdaptTaskRowsResult = { ok: true; tasks: RemoteTaskModel[] } | TaskAdapterError;

// Type predicate — o narrowing por truthiness do discriminante não é
// confiável com strict:false no tsconfig atual (mesmo padrão de
// usePipelineStages/lib/leads/adapter.ts). Exportado para uso pelos
// consumidores/testes, não só internamente. Aceita tanto o resultado
// unitário quanto o de lote — TaskAdapterError é o mesmo tipo nos dois.
export function isTaskAdapterError(
  result: AdaptTaskRowResult | AdaptTaskRowsResult,
): result is TaskAdapterError {
  return result.ok === false;
}

const VALID_PRIORITIES = new Set(['alta', 'media', 'baixa']);
const VALID_STATUSES = new Set(['pending', 'completed']);

// ── Adaptação unitária ───────────────────────────────────────────────────
// `now` é sempre o MESMO Date para deriveTaskState e formatTaskWhen dentro
// de uma adaptação (B1-B2-A-EXEC §13/§14/§26) — evita um boundary
// inconsistente (ex.: o relógio virar meia-noite entre as duas chamadas)
// que produziria um `state` e um `when` descrevendo dias diferentes.

export function adaptRemoteTaskRow(
  row: RemoteTaskRow,
  context: TaskAdapterContext,
  now: Date = new Date(),
): AdaptTaskRowResult {
  return adaptOne(row, context, now, null);
}

function adaptOne(
  row: RemoteTaskRow,
  context: TaskAdapterContext,
  now: Date,
  rowIndex: number | null,
): AdaptTaskRowResult {
  // Runtime guards (§11): os tipos gerados já restringem em compile-time,
  // mas o dado real vem de um transporte externo (PostgREST/JSON) — nunca
  // confiar cegamente num cast. Verificação leve, sem duplicar o parser.
  if (!VALID_PRIORITIES.has(row.priority)) {
    return { ok: false, reason: 'invalid_task_configuration', code: 'invalid_priority', taskId: row.id, rowIndex };
  }
  if (!VALID_STATUSES.has(row.status)) {
    return { ok: false, reason: 'invalid_task_configuration', code: 'invalid_status', taskId: row.id, rowIndex };
  }
  if (!Number.isInteger(row.version) || row.version < 1) {
    return { ok: false, reason: 'invalid_task_configuration', code: 'invalid_version', taskId: row.id, rowIndex };
  }

  const dueAtDate = new Date(row.due_at);
  if (Number.isNaN(dueAtDate.getTime())) {
    return { ok: false, reason: 'invalid_task_configuration', code: 'invalid_due_at', taskId: row.id, rowIndex };
  }

  // Lead: null = sem Lead relacionado; presente-e-resolvido = nome real;
  // presente-e-ausente = placeholder neutro (nunca erro, nunca outro Lead,
  // nunca inventado — política congelada acima em TASK_LEAD_UNAVAILABLE_
  // DISPLAY_VALUE).
  let leadName = '';
  if (row.lead_id !== null) {
    const lead = context.leadsById[row.lead_id];
    leadName = lead ? lead.name : TASK_LEAD_UNAVAILABLE_DISPLAY_VALUE;
  }

  // Seller: mapeado diretamente, sem lookup/validação de catálogo (B1-B2-
  // B1-EXEC §0/§3) — assigned_seller_id vira assignedTo tal como é. null
  // = sem responsável (schema permite defensivamente, RPC de criação não
  // produz isso hoje, mas o adapter não assume o writer). Nenhum
  // fallback, nenhum nome inventado, nenhuma dependência de Seller
  // catalog — a integridade real (Seller pertence à mesma company) já é
  // garantida pelo banco (tasks_company_seller_fk).

  const state: TaskState = deriveTaskState(row.status, dueAtDate, now);
  const when = formatTaskWhen(dueAtDate, now);

  const task: RemoteTaskModel = {
    id: row.id,
    title: row.title,
    lead: leadName,
    leadId: row.lead_id,
    assignedTo: row.assigned_seller_id,
    when,
    prio: row.priority,
    state,
    note: row.note,
    createdAt: row.created_at,
    dueAt: row.due_at,
    version: row.version,
  };

  return { ok: true, task };
}

// ── Adaptação de lista ───────────────────────────────────────────────────
// Mesmo `now` para TODAS as rows do lote (não um `new Date()` por row) —
// garante consistência interna do lote inteiro, não só dentro de uma row.
// Preserva a ordem recebida; falha determinística no PRIMEIRO registro
// inválido (mesmo padrão de adaptLeadRows) — nunca produz uma lista
// parcial silenciosa.

export function adaptRemoteTaskRows(
  rows: readonly RemoteTaskRow[],
  context: TaskAdapterContext,
  now: Date = new Date(),
): AdaptTaskRowsResult {
  const tasks: RemoteTaskModel[] = [];
  for (let i = 0; i < rows.length; i++) {
    const result = adaptOne(rows[i], context, now, i);
    if (isTaskAdapterError(result)) return result;
    tasks.push(result.task);
  }
  return { ok: true, tasks };
}
