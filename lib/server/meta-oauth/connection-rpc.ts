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
    async upsert(args: UpsertRpcArgs) {
      const { data, error } = await admin.rpc('meta_connection_upsert', args);
      return { data: data ?? null, error: toRpcFailure(error) };
    },
    async ownerByPage(pageId: string) {
      const { data, error } = await admin.rpc('meta_connection_owner_by_page', { p_page_id: pageId });
      return { data: data ?? null, error: toRpcFailure(error) };
    },
  };
}
