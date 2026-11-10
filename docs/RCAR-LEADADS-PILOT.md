# Piloto RCAR — Meta Lead Ads

Status 2026-11-09 (noite). **Preparado localmente; nada publicado.** Nenhum push,
deploy, migration remota, variável ou flag foi alterado. Cada passo de produção
abaixo exige aprovação do dono.

## 1. Onde está o código

| Item | Valor |
| --- | --- |
| Branch de publicação | `codex/leadads-rcar-release` (worktree `C:\Users\jaque\.codex\worktrees\leadads-rcar-release`) |
| Base | `9c11545` = código em produção (`dpl_2kNxk4mGMrdLCGmmEEcRM4522yqp`, registrado em 2026-11-06; não reconferido hoje) |
| Conteúdo | MVP-1 (confiabilidade) + MVP-2 (multiempresa) + ajuste de grants, **sem** WhatsApp W2B-9, intake de canais nem Instagram |
| Branch integrada (não publicar para o piloto) | `codex/meta-leadads-multicompany`: traz 7 migrations de WhatsApp/Instagram além das do Lead Ads |

Por que uma branch própria: a branch integrada publicaria junto
`20261107100000`–`20261107160000` (vínculo de conversa, intake de canais, Instagram),
que não fazem parte do piloto e ainda não têm smoke controlado. A branch de
publicação foi montada a partir do código de produção com os 12 commits do Lead Ads
(cherry-pick dos commits já integrados; conflitos só com linhas do Instagram, que
ficaram de fora). Os arquivos de Lead Ads são idênticos aos da branch integrada.

Migrations novas em relação à produção (82 → 85), nesta ordem:

1. `20261106100000_meta_leadads_mvp1_reliability.sql`
2. `20261109100000_core_table_grants_hardening.sql`
3. `20261109110000_meta_leadads_mvp2_multicompany.sql`

Nenhuma depende de WhatsApp ou Instagram. Nenhuma variável de ambiente nova.

**Consequência para a próxima liberação de WhatsApp/Instagram:** as versões
`20261107*` ficarão *anteriores* a migrations já aplicadas. `supabase db push`
recusa isso sem `--include-all`. Aplicar uma a uma, na ordem, como no ensaio de
restauração (`docs/RELEASE-REHEARSAL.md`), e registrar a decisão.

## 2. Validação local (2026-11-09)

| Verificação | Resultado |
| --- | --- |
| Banco descartável com as 85 migrations (CLI 2.116.0, projeto isolado `kapa-leadads-sbx`, portas 553xx) | aplicou sem erro |
| pgTAP oficial | **86 arquivos / 4725 asserções, PASS** |
| Integração Meta real (rotas, Auth, PostgREST, Postgres; Graph fake) | **9 arquivos / 92 testes, PASS** (inclui duas concessionárias fictícias, Página de outra empresa recusada, payload forjado, reentrega, visibilidade do Seller) |
| **Rollback de código:** testes do código de produção `9c11545` contra o schema novo | **7 arquivos / 41 testes, PASS** (fixtures adaptadas ao ajuste de grants, como no commit `2a2609a`) |
| Tipos do banco | regenerados do schema migrado: produção + 586 linhas do MVP, nenhuma remoção |
| **Ensaio de restauração** no backup de produção de 2026-11-06 (`scripts/db/rehearse-restore-migrations.ps1`, contêiner sem rede) | 6 migrations pendentes aplicadas (3 W2B já em produção + 3 desta branch); contagens iguais (4 empresas, 15 leads, 8 usuários, 2 eventos Meta, 79 históricos); **16/16 PASS**. Falhas pgTAP dependentes de dados: 33 arquivos, todos já presentes na linha de base sem migrations (48 arquivos) — nenhuma nova |
| `npx tsc --noEmit --incremental false` | exit 0 |
| Suíte completa (`npm run test:run -- --maxWorkers=2`) | **400 arquivos / 6881 testes PASS**, 8 arquivos opt-in pulados (rodados à parte acima), exit 0 |
| `npm run build` | compilou com sucesso |

O ajuste de grants não quebra código de produção: o servidor só lê `profiles` e
`invites` pelo cliente da sessão (colunas mantidas) e `invites.delivery_status`
pela service role (mantido).

## 3. Auditoria do fluxo

**Isolamento entre concessionárias.** A empresa do lead vem só da conexão da Página
no banco (`meta_connection_owner_for_ingestion`), nunca do payload. Uma Página
pertence a uma empresa por vez (índice único + lock por Página). O token da Página
é cifrado com AAD empresa+Página: mover o ciphertext para outra empresa impede a
decifragem. O Seller só vê lead atribuído a ele (RLS).

**Duplicidade.** Ledger único por (Página, lead da Meta): reentrega não cria outro
evento. Gravação do lead com lock por telefone dentro da empresa: mesmo telefone na
mesma empresa vira `linked_existing` (lead existente ganha a submissão e o
histórico "Novo formulário Meta recebido"); em empresas diferentes, um lead em
cada. Dois leads ativos com o mesmo telefone → `duplicate_phone_ambiguous`, visível
na fila.

**Perda.** Nenhum evento assinado some: sem conexão, empresa desligada ou dono
ambíguo → `meta_leadgen_unrouted_events` (90 dias, visível ao Super Admin); falha
de gravação → 503 e a Meta reentrega; falhas de processamento → fila com retry e
recuperação a cada 5 min (`vercel.json`, já em produção).

**Riscos que continuam (aceitáveis para o piloto, com acompanhamento):**

- Lead sem telefone brasileiro válido falha como `missing_phone` (fica na fila,
  não vira lead). Formulário da RCAR precisa ter o campo de telefone padrão.
- Cliente que volta com lead **ativo** em "Fechamento" recebe só uma entrada de
  histórico; ninguém é avisado. Lead perdido é arquivado e, nesse caso, nasce lead
  novo. Recomendação: acompanhar no piloto antes de mudar a regra.
- Revogação feita pelo cliente só é percebida no lead seguinte.
- Sem desconexão pelo CRM: para interromper, o Super Admin desliga a empresa e os
  eventos ficam retidos.
- Limite de 1.000 leads ativos na listagem (anterior ao MVP).
- `META_LEAD_INGESTION_ENABLED=false` descarta eventos antes do banco. Em produção
  está `true` desde 2026-11-06 (lido na época; reconferir).

## 4. Permissões da Meta para uma Página externa

Lido no painel em 2026-11-09: `pages_manage_metadata` avançado **Ativo**;
`pages_show_list`, `pages_read_engagement` e `leads_retrieval` avançado
**"Inativo — Verificação necessária"**, agrupadas pela Meta sob "só precisa de
acesso avançado se sua empresa fornecer serviços como Provedor de Tecnologia";
`pages_manage_ads` só padrão. A "Access Verification" foi aposentada pela Meta,
então a causa do aviso não está documentada. O cadastro de Independent Tech
Provider foi iniciado hoje; se ele destrava esse estado é **hipótese, não fato**.

Regra que decide o piloto: acesso padrão só vale para pessoas com função no app.

- **Caminho A (recomendado, prova real):** um gestor da RCAR **sem função no app**,
  com a tarefa ANUNCIAR na Página, faz "Conectar Meta". Se a Meta recusar
  permissão, o CRM mostra a falha e nada é gravado → abrir chamado na Meta com a
  evidência.
- **Caminho B (contingência):** a conexão é feita por uma conta com função no app
  e com a tarefa ANUNCIAR na Página da RCAR. Funciona mesmo com acesso padrão, mas
  o token fica preso a essa pessoa: se ela perder a função ou o acesso à Página,
  os leads param (a conexão vira "Reconexão necessária").

## 5. O que falta para liberar a RCAR

Dependem de você:

1. Enviar o App Review do WhatsApp (independente deste piloto).
2. Rodar `scripts/meta/rcar-pilot-readiness.sql` no SQL Editor de produção e conferir
   a linha da RCAR: `company_status = ativa`, ao menos 1 gestor e 1 vendedor ativos,
   `has_new_stage = true`, `remote_migrations = 82`, `mvp2_applied = false`.
3. Autorizar **backup novo** da produção com restauração comprovada. O backup de
   2026-11-06 é anterior às migrations W2B aplicadas no mesmo dia.
4. Escolher o caminho A ou B da seção 4 e quem da RCAR conecta a Página.
5. Confirmar que o formulário da RCAR tem nome e telefone padrão da Meta (e qual
   pergunta é o veículo, para mapear).
6. Aprovar a publicação (seção 6).

## 6. Publicação (cada passo com aprovação)

1. **Backup:** backup novo + ensaio de restauração com as 3 migrations
   (`scripts/db/rehearse-restore-migrations.ps1`, que existe só na branch integrada
   e hoje aplica a lista de migrations dela: ajustar para as 3 desta branch antes de
   usar). Critério: contagens iguais, nenhuma linha perdida.
2. **Leitura:** consulta da seção 5 item 2; histórico remoto termina em
   `20261105120000`.
3. **Migrations, uma por vez, na ordem da seção 1.** Depois de cada uma: contagem de
   leads/eventos igual, criação de lead pelo CRM funcionando. O código em produção
   continua funcionando sobre o schema novo (seção 2, rollback).
4. **Na mesma janela:** Super Admin habilita Lead Ads para a TEST COMPANY (sem isso,
   com o código novo, os eventos dela ficam retidos como `company_disabled`).
5. **Deploy** de `codex/leadads-rcar-release` (preview → conferência → produção).
   Conferir `META_CONNECTION_PERSISTENCE_ENABLED`, `META_LEAD_INGESTION_ENABLED` e
   `NEXT_PUBLIC_FF_META_INTEGRATIONS_REVIEW`.
6. **Smoke na TEST COMPANY:** lead de teste pela ferramenta da Meta chega,
   aparece em "Sem vendedor", é atribuído, some da fila, Seller vê.
7. **RCAR:** Super Admin habilita → gestor conecta a Página → lead de teste
   controlado → atribuição → Seller vê → "Eventos retidos" vazio.
8. **Levantamento** das Páginas inscritas no app × conexões (Graph, com autorização).

### Rollback

- **Código:** promover de volta o deployment `dpl_2kNxk4mGMrdLCGmmEEcRM4522yqp`
  (`9c11545`). Validado contra o schema novo. Efeito: volta a aceitar só a Página
  de teste. O código antigo **não retém** eventos de outras Páginas: responde 200 e
  a Meta não reenvia. Em rollback com a RCAR conectada, avisar a RCAR e recuperar os
  leads do período pela Central de Leads / exportação da Meta (a Meta guarda os
  leads por 90 dias). Preferir, quando o problema for só da RCAR, desligar a empresa
  (item abaixo) em vez de voltar o código.
- **Banco:** não reverter migrations. São aditivas, e o código antigo funciona sobre
  elas. Restaurar backup só em perda de dados, porque descarta tudo que entrou
  depois.
- **Interromper só a RCAR:** Super Admin desliga a empresa; eventos ficam retidos e
  podem ser liberados depois.

## 7. Atualização 2026-11-10

**"Inativo — Verificação necessária" (só leitura, de novo).** O app está ligado à
empresa Verificada e a Verificação de Uso de Dados está concluída. Pela documentação
da Meta, a verificação é o requisito que deixaria os recursos inativos para outras
empresas, e ela está atendida. As três permissões estão na renovação do envio em
análise (`1007256908334218`). Hipótese não comprovada: o estado muda quando esse
envio for concluído. O cadastro de Provedor de Tecnologia (09/11) não mudou nada. A
prova continua sendo o caminho A da seção 4: o retorno do OAuth recusa com
`missing_required_permission` sem gravar nada se a Meta não conceder.

**Messenger × piloto.** Esta branch não contém código de Messenger, e o webhook é o de
produção, inalterado. Na branch de mensagens (`codex/meta-messaging-review`) o ramo
do Messenger:
- não muda nada para entregas só de `leadgen`;
- nunca lança erro;
- não devolve 503 sem fim (o que poderia levar a Meta a desativar o webhook da
  Página);
- só deixa a TEST COMPANY ativar o Messenger.

A Página da RCAR não recebe campos de mensagem sem uma ativação explícita. Detalhes:
`docs/META-MESSAGING-APP-REVIEW.md` §7–8 daquela branch.

## 8. Preparação da implantação — 2026-11-10

Nada foi alterado em produção. Kit de operação fora do Git, em
`C:\Users\jaque\Documents\RCAR-Liberacao` (`LEIA-PRIMEIRO.md`, `CHECKLIST-RCAR.md`,
`SHA256SUMS.txt`).

**Leituras feitas sem conectar no banco:** projeto `ACTIVE_HEALTHY`, Postgres
17.11.0.003; sem backups gerenciados nem PITR; 1 IPv4 banido no projeto; último
deployment de Production = `9c11545`; host direto do banco alcançável por IPv6 também
de dentro de um contêiner com rede do host. O número de migrations em produção **não**
foi relido: esperado 82, hash `857bec8d6a90ec559e56567d51649785` (consulta
`sql/01-estado-banco.sql` do kit).

**CLI 2.116.0 (código da tag e binário instalado):** `db dump`/`db push` sem senha
fazem `POST /cli/login-role` com `read_only: false` (senha temporária da role
`cli_login_postgres`). No fallback para o pooler, depois de 3 falhas, a CLI chama
`deleteNetworkBans` com **todos** os IPs banidos do projeto. O script de backup do kit
mata a CLI no primeiro erro de conexão, antes disso. `db query --linked` usa a
Management API.

**Backup novo:** dump direto para a memória → zip → DPAPI; sem texto claro em disco;
sessões e refresh tokens do Auth fora; roles sem senha. **Defeito do backup de
2026-11-06 corrigido:** o suplemento de ACL fazia `REVOKE ALL ON TABLE` e não
reemitia grants por coluna, então aquela restauração perde os grants de coluna de
`profiles`, `invites`, `company_memberships` e `pipeline_stages`. O novo reemite os
grants por coluna. Parte das "falhas dependentes de dados" registradas no ensaio de
09/11 vinha disso.

**Ensaios locais (dados fictícios, 82 migrations como a produção):** backup → cifra →
restauração em contêiner sem rede → 3 migrations → pgTAP: PASS (contratos 8x PASS;
4694 asserções ok; 7 arquivos informativos dependentes do seed). Aplicador de uma
migration por vez: ordem errada recusada; 3 aplicadas → 85, hash
`ed499445649a9cd996b7cd6a431f8ff8`. Cópia externa OpenPGP: ida e volta PASS.

**Branch:** desde `a882392` mudou só este documento; tsc 0; suíte 400 arquivos /
6881 testes PASS. O fluxo de conexão inscreve o app (`leadgen`) na Página escolhida
por qualquer empresa habilitada; a trava de Página fixa vale só para o diagnóstico.

Próximo passo do dono: G1 (SQL Editor) e autorização da OP-1 (backup).
