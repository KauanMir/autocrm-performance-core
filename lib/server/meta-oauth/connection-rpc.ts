// lib/server/meta-oauth/connection-rpc.ts — adaptador Supabase service_role
// para a porta MetaConnectionRpcPort. SERVER-ONLY. Reutiliza o client
// service_role oficial do repo (createAdminClient). Não cria inicialização
// própria. Erros do Supabase são reduzidos a código/mensagem internos: quem
// consome (connection-persistence) só compara códigos conhecidos e nunca
// devolve a mensagem ao browser.
import { createAdminClient } from '@/lib/server/supabase/admin';
import type { MetaConnectionRpcPort, RpcFailure, UpsertRpcArgs } from './connection-persistence';

function toRpcFailure(error: { code?: string; message?: string } | null): RpcFailure | null {
  return error ? { code: error.code, message: error.message } : null;
}

export function createMetaConnectionRpcPort(): MetaConnectionRpcPort {
  const admin = createAdminClient();
  return {
    // META-MVP1: upsert v2 grava também a validade verificada do token.
    async upsert(args: UpsertRpcArgs) {
      const { data, error } = await admin.rpc('meta_connection_upsert_v2', {
        ...args,
        p_token_expires_at: args.p_token_expires_at ?? undefined,
        p_token_data_access_expires_at: args.p_token_data_access_expires_at ?? undefined,
      });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    // Só conexões connected: usado pelo callback antes de inscrever a Page.
    async ownerByPage(pageId: string) {
      const { data, error } = await admin.rpc('meta_connection_owner_by_page', { p_page_id: pageId });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    // connected OU error: usado pela ingestão do webhook.
    async ownerForIngestion(pageId: string) {
      const { data, error } = await admin.rpc('meta_connection_owner_for_ingestion', { p_page_id: pageId });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
  };
}
