# Supabase — M1-B (Auth + profiles + sellers)

Escopo desta fase: só autenticação/identidade. Leads, visitas, propostas,
vendas e tarefas continuam no `localStorage` (`lib/store.ts`) até M1-C+ — ver
o plano completo em M1-A.

Nenhum projeto Supabase real está conectado a este repositório ainda. Os
arquivos abaixo são o ponto de partida para quando um projeto for criado.

## Passo a passo

1. **Criar o projeto** em [supabase.com](https://supabase.com) (ou
   `supabase init` + `supabase start` para rodar local via Docker).

2. **Aplicar a migration** `migrations/20260708120000_m1b_auth_profiles_sellers.sql`
   — cole no SQL Editor do painel, ou `supabase db push` se o CLI já estiver
   linkado ao projeto.

3. **Configurar `.env.local`** na raiz de `autocrm-next/` (nunca committar):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA-ANON-KEY
   ```
   Valores em Project Settings → API. Use sempre a **anon key** no client —
   a service role key nunca entra neste projeto Next.js.

4. **Rodar `seed.sql`, Partes 1 e 2** (company + sellers) — não dependem de
   usuário nenhum, pode rodar direto.

5. **Criar os 4 usuários de teste no Supabase Auth** — Dashboard
   (Authentication → Users → Add user, marcando "Auto Confirm User") ou a
   Admin API server-side. Ver instruções completas e a tabela de
   e-mail → role → seller_id dentro de `seed.sql`, Parte 3. Nenhuma senha
   fica registrada em texto em lugar nenhum deste repositório.

6. **Rodar `seed.sql`, Parte 3**, com os UUIDs reais dos 4 usuários criados
   no passo 5 no lugar dos placeholders.

7. **Rodar o app**: `npm run dev`, logar com um dos 4 e-mails acima.

## Por que `sellers.id` é `text`, não `uuid`

Desvio deliberado do schema de referência do M1-A — documentado com o motivo
completo no topo da própria migration. Resumo: o app comercial ainda vive no
localStorage e referencia vendedores pelos ids curtos do seed original
(`'s1'..'s12'`); um uuid novo aqui quebraria `currentUser.sellerId` contra
esses dados sem um remapeamento completo, que é trabalho de M1-C.
