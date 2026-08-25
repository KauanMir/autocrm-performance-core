// lib/podium/leaderboardRepository.ts — PODIUM-COMPETITION-R1-EXEC. Único
// caminho de leitura do leaderboard company-wide (list_company_seller_
// leaderboard). Agregado server-side — nunca lê sales/visits/deals/leads
// diretamente (RLS dessas tabelas continua exatamente como está, ver
// migration desta etapa). Retorna SOMENTE o shape mínimo autorizado
// (§11 do EXEC): sellerId, sellerLabel, saleCount, completedVisitCount,
// rank — nunca revenueCents, nunca uma linha de Sale/Visit bruta.
import { supabase } from '@/lib/supabase/client';
import { PodiumLeaderboardError } from '@/lib/podium/errors';

export interface CompanySellerLeaderboardRow {
  sellerId: string;
  sellerLabel: string;
  saleCount: number;
  completedVisitCount: number;
  rank: number;
}

export type FetchCompanySellerLeaderboardInput = {
  periodStartMillis: number;
  periodEndMillis: number;
  // Explícito só para o futuro modo "Super Admin escolhe empresa" (§3 do
  // EXEC) — nenhuma UI desta etapa envia isto; Manager/Seller nunca
  // precisam, a RPC deriva a empresa da própria membership.
  companyId?: string;
};

export async function fetchCompanySellerLeaderboard(
  input: FetchCompanySellerLeaderboardInput,
): Promise<CompanySellerLeaderboardRow[]> {
  const { data, error } = await supabase.rpc('list_company_seller_leaderboard', {
    p_period_start: new Date(input.periodStartMillis).toISOString(),
    p_period_end: new Date(input.periodEndMillis).toISOString(),
    p_company_id: input.companyId,
  });

  if (error) {
    throw new PodiumLeaderboardError('podium_leaderboard_fetch_failed', {
      code: typeof error.code === 'string' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }

  return (data ?? []).map((row) => ({
    sellerId: row.seller_id,
    sellerLabel: row.seller_label,
    saleCount: row.sale_count,
    completedVisitCount: row.completed_visit_count,
    rank: row.rank,
  }));
}
