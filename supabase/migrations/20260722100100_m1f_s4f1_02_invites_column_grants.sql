-- M1-F S4-F1 (02): endurece o GRANT SELECT de public.invites para menor
-- privilégio por coluna, antes de qualquer UI administrativa consumir a
-- listagem (S4-F1, decisão do usuário — "Antes da UI, endurecer os grants
-- de SELECT da tabela invites para menor privilégio por coluna").
--
-- Estado herdado de m1f_s4a1 (20260720130000): `grant select on
-- public.invites to authenticated` concede a TABELA INTEIRA — inclui
-- token_hash, que nunca deveria ser lido por PostgREST (o hash não é o
-- token bruto, mas ainda é um detalhe interno cuja única função é validar
-- convite via RPC SECURITY DEFINER; nenhum caminho client-side legítimo
-- precisa dele). Diferente do padrão cuidadoso já usado em profiles
-- (S4-C2C, GRANT por coluna desde o início) — invites nasceu com grant
-- amplo porque nenhuma UI consumia SELECT ainda: correto na origem, agora
-- corrigido antes do primeiro consumidor real (S4-F1).
--
-- Whitelist final (auditada contra o schema real de m1f_s4a1, nenhuma
-- coluna inventada): id, company_id, invited_by_profile_id, name, email,
-- role_kind, status, expires_at, accepted_at, created_at — exatamente as
-- colunas necessárias para a listagem administrativa planejada (S4-F1
-- §6/§8). NUNCA concedidas: token_hash (o próprio motivo desta migration),
-- email_normalized (coluna GERADA redundante com email — nenhum uso
-- visual), accepted_profile_id (não exibido na listagem — quem aceitou não
-- é informação administrativa do convite em si), updated_at (metadado
-- técnico sem uso visual, mesmo padrão de profiles/companies).
--
-- Nenhuma policy é alterada — invites_select_own_or_platform (m1f_s4a1)
-- continua sendo a ÚNICA autoridade de LINHA (quem convidou vê os
-- próprios; Super Admin vê todos); esta migration só estreita QUAIS
-- COLUNAS ficam visíveis nas linhas já permitidas por essa policy — RLS e
-- GRANT continuam sendo camadas independentes, exatamente como em
-- profiles. Nenhum INSERT/UPDATE/DELETE é tocado (permanecem exclusivos
-- das RPCs SECURITY DEFINER — create_invite/resend_invite/cancel_invite/
-- accept_invite, nenhuma delas lê via SELECT direto do PostgREST, todas
-- usam PL/pgSQL interno). service_role não é afetado (não depende de
-- GRANT — SECURITY DEFINER roda com o privilégio do dono da função,
-- confirmado desde m1f_s4a2a).
begin;

revoke select on public.invites from authenticated;

grant select (
  id,
  company_id,
  invited_by_profile_id,
  name,
  email,
  role_kind,
  status,
  expires_at,
  accepted_at,
  created_at
) on public.invites to authenticated;

commit;
