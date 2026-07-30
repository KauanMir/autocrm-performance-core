// lib/leads/remoteMutationRepository.ts — mutations remotas de leads para
// Manager/Seller (M1-E, E4-B1): createRemoteLead/updateRemoteLead/
// checkRemoteLeadPhoneDuplicate. Arquivo próprio, deliberadamente separado
// de lib/leads/remoteRepository.ts (que permanece SOMENTE leitura da
// listagem, intocado por esta etapa) e de lib/commercial/repository.ts (a
// contraparte Platform do Super Admin — nunca importada aqui).
//
// create_lead/update_lead/check_lead_phone_duplicate aceitam um
// p_company_id opcional (docs/M1-E-DESIGN.md §6.1/6.2/6.9), mas o resolver
// compartilhado (resolve_lead_mutation_context) o IGNORA por completo para
// Manager/Seller — a empresa vem sempre da membership ativa do ator. Por
// isso este repository NUNCA envia p_company_id: enviar qualquer valor
// aqui seria fingir uma autoridade de empresa que o cliente não tem nesse
// caminho (diferente da superfície Platform, que sempre envia p_company_id
// explícito porque ali é a única fonte de autoridade possível).
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { mapRemoteLeadsMutationError } from '@/lib/leads/errors';

export type RemoteLeadRecord = Database['public']['Functions']['create_lead']['Returns'];

export type RemoteLeadDuplicateRow =
  Database['public']['Functions']['check_lead_phone_duplicate']['Returns'][number];

export type CreateRemoteLeadPayload = {
  name: string;
  phone: string;
  car: string;
  // Só significativo quando enviado pelo caminho Manager — o hook nunca
  // permite que o caminho Seller preencha este campo (tipo discriminado em
  // useCreateLead.ts). undefined/null aqui sempre omite p_seller_id (Seller
  // sempre autoatribuído pelo backend).
  sellerId?: string | null;
  temperature?: Database['public']['Enums']['lead_temperature'];
  paymentPreference?: string;
  source?: string;
};

export type UpdateRemoteLeadPayload = {
  leadId: string;
  expectedVersion: number;
  name: string;
  phone: string;
  car: string;
  temperature?: Database['public']['Enums']['lead_temperature'];
  paymentPreference?: string;
  source?: string;
};

export type CheckRemoteLeadPhoneDuplicatePayload = {
  phone: string;
  excludeLeadId?: string;
};

// create_lead sempre retorna a linha criada quando não há erro — null é
// anômalo (mesmo padrão de createPlatformLead/createCompanyRpc).
export async function createRemoteLead(payload: CreateRemoteLeadPayload): Promise<RemoteLeadRecord> {
  const { data, error } = await supabase.rpc('create_lead', {
    p_name: payload.name,
    p_phone: payload.phone,
    p_car: payload.car,
    p_seller_id: payload.sellerId || undefined,
    p_temperature: payload.temperature,
    p_payment_preference: payload.paymentPreference || undefined,
    p_source: payload.source || undefined,
    // p_company_id OMITIDO de propósito (ver cabeçalho do arquivo).
  });
  if (error) throw mapRemoteLeadsMutationError(error, 'create_lead');
  if (!data) throw mapRemoteLeadsMutationError({ message: 'empty_response' }, 'create_lead');
  return data;
}

// Só os campos REAIS de update_lead — nenhum stage/seller/archived (a RPC
// nem os aceita: editar nunca move Etapa nem atribui Vendedor no M1-E).
export async function updateRemoteLead(payload: UpdateRemoteLeadPayload): Promise<RemoteLeadRecord> {
  const { data, error } = await supabase.rpc('update_lead', {
    p_lead_id: payload.leadId,
    p_expected_version: payload.expectedVersion,
    p_name: payload.name,
    p_phone: payload.phone,
    p_car: payload.car,
    p_temperature: payload.temperature,
    p_payment_preference: payload.paymentPreference || undefined,
    p_source: payload.source || undefined,
    // p_company_id OMITIDO de propósito (ver cabeçalho do arquivo).
  });
  if (error) throw mapRemoteLeadsMutationError(error, 'update_lead');
  if (!data) throw mapRemoteLeadsMutationError({ message: 'empty_response' }, 'update_lead');
  return data;
}

// Retorna a(s) linha(s) crua(s) de status — a interpretação (mensagem,
// bloqueio de submit) é do chamador (hook/formulário futuro), nunca desta
// função. p_exclude_lead_id (E4-A1) só remove essa linha da busca já
// escopada pela empresa resolvida — nunca autoridade de acesso.
export async function checkRemoteLeadPhoneDuplicate(
  payload: CheckRemoteLeadPhoneDuplicatePayload,
): Promise<RemoteLeadDuplicateRow[]> {
  const { data, error } = await supabase.rpc('check_lead_phone_duplicate', {
    p_phone: payload.phone,
    p_exclude_lead_id: payload.excludeLeadId || undefined,
    // p_company_id OMITIDO de propósito (ver cabeçalho do arquivo).
  });
  if (error) throw mapRemoteLeadsMutationError(error, 'check_lead_phone_duplicate');
  return data ?? [];
}

// Mesma normalização usada no servidor (regexp_replace(phone, '\D', '', 'g')
// em check_lead_phone_duplicate/phone_digits) — usada aqui SOMENTE para
// associar um resultado de duplicidade ao telefone que o gerou (comparação
// de "esta resposta ainda é do telefone atual?" no E4-B2), nunca como
// autoridade de duplicidade, que continua sendo exclusivamente o backend.
export function normalizeLeadPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}
