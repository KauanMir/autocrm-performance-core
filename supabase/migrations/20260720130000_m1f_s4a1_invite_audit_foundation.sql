-- M1-F / Módulo 1 — m1f_s4a1: fundação de schema de convites e auditoria
-- (primeiro subestágio do S4 oficial)
-- Fonte: docs/M1-F-SUPER-ADMIN-USER-LIFECYCLE-DESIGN.md (Revisão 2), §6.5
-- (invites), §6.6/§14 (audit_log), §9 (convites por e-mail), §16 (linha S4),
-- §17 (testes necessários). Depende de m1f_s1_01, m1f_s2_02, m1f_s11,
-- m1f_s3a.
--
-- ESCOPO ESTRITO (S4-A1, schema apenas): tabelas invites/audit_log,
-- enums, constraints de coerência estrutural, índices de duplicidade,
-- RLS de leitura de invites, RLS fechada de audit_log. Fora de escopo aqui,
-- propositalmente (S4-A2/S4-B/S4-C/S4-D/S4-E, ver plano de execução
-- aprovado): create_invite()/accept_invite()/cancel_invite()/
-- resend_invite(), Route Handler, geração/validação de token bruto, envio
-- de e-mail, criação de auth.users, enforcement de transição de status
-- (ex.: impedir canceled→accepted) — essa etapa cria só o MODELO que
-- permitirá essas transições depois, não a lógica de transição em si.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════════

-- §6.5: "role_kind invite_role_kind not null -- 'super_admin' | 'manager' |
-- 'seller'"
create type public.invite_role_kind as enum ('super_admin', 'manager', 'seller');

-- §6.5: "status invite_status not null default 'pending' -- 'pending' |
-- 'accepted' | 'expired' | 'canceled' | 'superseded'"
create type public.invite_status as enum ('pending', 'accepted', 'expired', 'canceled', 'superseded');

-- ═══════════════════════════════════════════════════════════════════════
-- public.invites (§6.5)
-- ═══════════════════════════════════════════════════════════════════════

create table public.invites (
  id                    uuid primary key default gen_random_uuid(),
  -- null SÓ para convite de Super Admin (role_kind='super_admin') — §6.5,
  -- §9.1. ON DELETE RESTRICT (correção pós-auditoria — divergência
  -- deliberada do padrão CASCADE usado em profiles.company_id/
  -- sellers.company_id/pipeline_stages.company_id/leads.company_id/
  -- company_memberships.company_id): diferente dessas tabelas
  -- operacionais, §9.3 declara "nunca apagado" DUAS VEZES como princípio
  -- de design específico de invites (reenvio: "o antigo vira superseded,
  -- nunca é apagado"; cancelamento: "nunca apagado") — um nível de ênfase
  -- em preservação de histórico que nenhuma outra tabela do schema tem.
  -- companies nunca são fisicamente apagadas neste design (§8: "nenhuma
  -- exclusão física prevista"), então RESTRICT nunca bloqueia nenhuma
  -- operação real — é puramente defensivo: se uma exclusão de company
  -- fosse tentada, falha alto e preserva o convite, em vez de apagá-lo
  -- silenciosamente. Não altera o padrão das outras tabelas (fora de
  -- escopo desta correção pontual).
  company_id            uuid references public.companies(id) on delete restrict,
  email                 text not null,
  -- Normalização de e-mail (decisão aprovada nesta etapa): coluna GERADA,
  -- nunca escrita diretamente — impossível ficar dessincronizada de
  -- `email`. lower(btrim(email)) cobre exatamente "caixa diferente" e
  -- "espaços externos" convergem para a mesma identidade lógica; não é
  -- validação de RFC (não pedida, não inventada).
  email_normalized      text generated always as (lower(btrim(email))) stored,
  name                  text not null,
  role_kind             public.invite_role_kind not null,
  -- hash do token; o token em si NUNCA fica em texto plano no banco —
  -- §6.5, §9.1, §9.4. Geração/algoritmo ficam para S4-A2/S4-B (fora de
  -- escopo aqui) — texto livre para não travar essa decisão futura a um
  -- tamanho fixo.
  token_hash            text not null,
  status                public.invite_status not null default 'pending',
  -- nullable: preserva o convite mesmo se o profile de quem convidou for
  -- futuramente removido (nunca ocorre para profiles com histórico, §10.2,
  -- mas a FK não destrutiva é a mesma defesa já usada em toda a base desde
  -- M1-C). "Obrigatório" na prática é responsabilidade da RPC futura
  -- (S4-A2), que sempre deriva de auth.uid() — não pode ser NOT NULL no
  -- banco porque isso entraria em conflito direto com ON DELETE SET NULL
  -- (uma linha NOT NULL rejeitaria a própria ação de "setar NULL" no
  -- delete, quebrando a FK exatamente no caso raro que ela existe para
  -- cobrir).
  invited_by_profile_id uuid references public.profiles(id) on delete set null,
  expires_at            timestamptz not null,
  accepted_at           timestamptz,
  -- ON DELETE SET NULL deliberado (ver justificativa completa no CHECK
  -- invites_accepted_coherence_ck abaixo, corrigido pós-auditoria).
  accepted_profile_id   uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint invites_token_hash_key unique (token_hash),

  -- e-mail vazio após trim é inválido (§ desta etapa) — mesmo padrão de
  -- companies_name_not_blank_ck (m1f_s3a).
  constraint invites_email_not_blank_ck check (email_normalized <> ''),

  -- Coerência company_id × role_kind (§8 desta etapa, §6.5, §9.1): convite
  -- de empresa (manager/seller) exige company_id; convite de plataforma
  -- (super_admin) exige company_id nulo. Estrutural — não depende de
  -- conhecer o ator da futura RPC.
  constraint invites_company_role_coherence_ck check (
    (role_kind = 'super_admin' and company_id is null)
    or (role_kind in ('manager', 'seller') and company_id is not null)
  ),

  -- Coerência accepted_at/accepted_profile_id × status (§7 desta etapa;
  -- CORRIGIDO pós-auditoria — versão original exigia accepted_profile_id
  -- NOT NULL para status='accepted', o que entrava em conflito direto e
  -- comprovado empiricamente com ON DELETE SET NULL da FK abaixo: apagar
  -- o profile aceitante de um convite JÁ aceito falhava com violação
  -- deste CHECK, porque a própria ação interna "SET accepted_profile_id =
  -- NULL" da FK violava a exigência "NOT NULL quando accepted" — a FK
  -- estava declarada como SET NULL mas nunca conseguia executar com
  -- sucesso nesse caso. Resolvido preservando o princípio geral do §10.2
  -- ("a própria política de FK ON DELETE SET NULL (coluna) já adotada
  -- desde M1-C existe EXATAMENTE PARA ISSO" — permitir apagar um profile
  -- sem destruir os registros que o referenciam) em vez de bloquear a
  -- exclusão do profile (Opção A, RESTRICT, teria sido inconsistente com
  -- esse princípio geral e com TODAS as outras FKs de profile do projeto,
  -- que usam SET NULL sem exceção):
  --   * accepted_at continua OBRIGATÓRIO para status='accepted' — o FATO
  --     "isto foi aceito, e quando" nunca se perde;
  --   * accepted_profile_id pode ficar NULL mesmo com status='accepted',
  --     SOMENTE como consequência histórica de o profile ter sido
  --     removido depois — nunca como estado inicial válido por si só (a
  --     RPC futura, S4-A2, continua obrigada a preencher os dois no
  --     momento da aceitação; o schema, sozinho, não consegue distinguir
  --     "nunca foi preenchido" de "foi preenchido e depois anulado pela
  --     FK" — limitação reconhecida e documentada aqui, não escondida;
  --     ver teste dedicado no arquivo 22 provando essa limitação);
  --   * qualquer status diferente de 'accepted' continua exigindo os DOIS
  --     nulos (nenhum desses estados jamais foi aceito, por definição).
  -- Não é enforcement de TRANSIÇÃO (ex.: impedir canceled→accepted) — é
  -- validade do estado atual da linha, a cada momento; transições ficam
  -- para as RPCs de S4-A2.
  constraint invites_accepted_coherence_ck check (
    (status = 'accepted' and accepted_at is not null)
    or (status <> 'accepted' and accepted_at is null and accepted_profile_id is null)
  )
);

-- ── índices de apoio ──────────────────────────────────────────────────
create index invites_company_id_idx on public.invites(company_id);
create index invites_invited_by_profile_id_idx on public.invites(invited_by_profile_id);
create index invites_email_normalized_idx on public.invites(email_normalized);
create index invites_status_idx on public.invites(status);

-- ── proteção estrutural contra duplicidade pendente (§9 desta etapa) ────
-- Dois índices únicos parciais SEPARADOS em vez de COALESCE com sentinela
-- de UUID: a forma idiomática do Postgres para "único, exceto quando uma
-- coluna nullable difere sua ausência de valor" — sem inventar um UUID
-- mágico para representar "sem empresa", que poderia colidir com um id
-- real ou exigir justificativa adicional de segurança.
--
-- 1) Empresa não pode ter dois convites PENDING para o mesmo e-mail
--    canônico, independente de role_kind (a duplicidade é por e-mail, não
--    por papel — dois convites pendentes com papéis diferentes para a
--    mesma pessoa na mesma empresa são igualmente ambíguos).
create unique index invites_pending_company_email_uidx
  on public.invites (company_id, email_normalized)
  where status = 'pending' and company_id is not null;

-- 2) Convite de PLATAFORMA (company_id null) não pode ter dois PENDING
--    para o mesmo e-mail canônico.
create unique index invites_pending_platform_email_uidx
  on public.invites (email_normalized)
  where status = 'pending' and company_id is null;

-- accepted/canceled/expired/superseded permanecem no histórico e NÃO
-- entram nesses índices (WHERE status = 'pending' os exclui) — um novo
-- convite pendente pode coexistir livremente com qualquer quantidade de
-- convites não-pendentes anteriores para o mesmo e-mail, exatamente como
-- §9.3 descreve para reenvio (convite antigo vira superseded, nunca é
-- apagado nem bloqueia o novo).

-- ── updated_at automático (reaproveita a função já existente desde
--    M1-B — nenhuma função duplicada) ────────────────────────────────────
create trigger invites_set_updated_at
  before update on public.invites
  for each row execute function public.set_updated_at();

-- ── RLS de invites (§9.3, §12 desta etapa) ──────────────────────────────
-- Somente SELECT: quem convidou vê os próprios; Super Admin vê todos.
-- Nenhuma policy de INSERT/UPDATE/DELETE — toda escrita é exclusiva das
-- RPCs futuras (SECURITY DEFINER, S4-A2), mesmo padrão de zero-grants-
-- diretos já usado em toda tabela comercial desde M1-C. O aceite público
-- (alguém sem sessão ainda, só com o token) NUNCA lê esta tabela via
-- SELECT — será uma RPC SECURITY DEFINER restrita validando o token
-- (S4-C), nunca uma policy baseada em e-mail/token.
alter table public.invites enable row level security;

revoke all on public.invites from public;
revoke all on public.invites from anon;
revoke all on public.invites from authenticated;

create policy invites_select_own_or_platform on public.invites
  for select to authenticated
  using (
    public.is_platform_super_admin()
    or invited_by_profile_id = auth.uid()
  );

grant select on public.invites to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- public.audit_log (§6.6, §14.1)
-- ═══════════════════════════════════════════════════════════════════════
-- Nomes de coluna EXATOS do documento — nota: o campo de data/hora chama-se
-- `occurred_at`, não `created_at` (diferente de toda outra tabela do
-- projeto até aqui) — extraído literalmente do §14.1, não presumido por
-- convenção. Append-only por design (§14.1: "escrita somente por RPCs
-- SECURITY DEFINER... nunca INSERT direto do cliente") — sem updated_at
-- (o documento não define nem exige um; auditoria não é editada).

create table public.audit_log (
  id                uuid primary key default gen_random_uuid(),
  -- autor REAL, nunca a identidade "efetiva" (§14.1) — nullable com ON
  -- DELETE SET NULL, mesmo motivo de invited_by_profile_id acima.
  actor_profile_id  uuid references public.profiles(id) on delete set null,
  -- empresa afetada; null para ações de plataforma (ex.: criar empresa) —
  -- §14.1, literal.
  company_id        uuid references public.companies(id) on delete set null,
  -- Texto livre de propósito (não enum): §14.2 descreve um "catálogo
  -- MÍNIMO" explicitamente extensível por etapas futuras (S5+ adiciona
  -- ações novas) — um enum fechado exigiria ALTER TYPE a cada nova RPC
  -- administrativa, o que o próprio documento não pede.
  action            text not null,
  entity_type       text not null,
  -- text (não uuid): acomoda uuid e ids legados (ex.: sellers.id é text) —
  -- §14.1, literal. Sem FK (o tipo de entidade varia por linha).
  entity_id         text,
  occurred_at       timestamptz not null default now(),
  -- 'success' | 'failure' é um par fechado e explícito no documento
  -- (diferente de `action`) — CHECK constraint, não enum (troca de um
  -- valor por outro nunca precisa de nova migration, e um enum de 2
  -- valores não traria benefício adicional de integridade).
  result            text not null,
  reason            text,
  -- antes/depois: SÓ campos seguros — nunca senha/token/segredo. A lista
  -- explícita de colunas permitidas por tipo de entidade é responsabilidade
  -- de cada RPC futura (§14.1: "preenchidos por uma lista explícita de
  -- colunas permitidas... nunca um row_to_json genérico"); esta migration
  -- não pode impor isso via constraint (o conteúdo do jsonb é decidido no
  -- momento da escrita, não é validável estruturalmente sem duplicar a
  -- lógica de cada RPC aqui) — reforçado só nos testes desta etapa
  -- (nenhuma linha de fixture contém segredo) e será reforçado de novo por
  -- auditoria adversarial em S4-E.
  before_data       jsonb,
  after_data        jsonb,
  origin            text,

  constraint audit_log_result_ck check (result in ('success', 'failure'))
);

create index audit_log_company_id_idx on public.audit_log(company_id);
create index audit_log_actor_profile_id_idx on public.audit_log(actor_profile_id);
create index audit_log_action_idx on public.audit_log(action);
create index audit_log_occurred_at_idx on public.audit_log(occurred_at);

-- ── RLS de audit_log (§13 desta etapa): fechada por completo ────────────
-- Nenhuma policy — mesmo padrão exato de company_memberships (m1f_s1_01):
-- RLS habilitada e SEM NENHUMA policy/grant, inacessível ao navegador até
-- uma etapa futura decidir explicitamente uma policy de leitura (o design,
-- §14.3, já prevê MANAGER/SUPER_ADMIN lendo via can_access_company(), mas
-- essa policy não tem nenhum consumidor real ainda nesta etapa — mesma
-- decisão de adiamento já tomada e documentada para company_memberships no
-- S2). Nenhuma RPC futura precisa de grant de tabela para escrever aqui:
-- SECURITY DEFINER (owner postgres, BYPASSRLS) escreve sem depender de
-- GRANT nenhum a authenticated/anon.
alter table public.audit_log enable row level security;

revoke all on public.audit_log from public;
revoke all on public.audit_log from anon;
revoke all on public.audit_log from authenticated;

commit;
