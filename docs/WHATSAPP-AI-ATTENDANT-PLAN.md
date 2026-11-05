# Plano técnico: primeiro atendimento automatizado com IA no WhatsApp

**Situação: somente planejamento.** Nada deste documento foi implementado. Envio
automático e chamadas a modelos de IA continuam proibidos até autorização própria.

**Objetivo:** cliente envia WhatsApp → CRM recebe → identifica ou cria o contexto do
atendimento → IA interpreta a intenção → qualifica o interesse → encaminha a
oportunidade ao vendedor.

Regra de desenho: **a IA propõe, o código decide.** O modelo nunca envia mensagem,
altera lead ou chama a Meta. Um motor de regras determinístico valida cada proposta
e só então autoriza o envio.

## Pré-requisitos

| Dependência | Situação | Por quê |
|---|---|---|
| Backup real e Liberação B | Congelada | Sem migrations em produção não há conversas |
| Liberação C e W2B-7 | Pendentes | Sem recebimento real não há gatilho |
| Política de retenção e exclusão | Não decidida | Já bloqueia a W2B-7; a IA amplia o volume de dados tratados |
| Matriz de permissões da inbox | Não aprovada | Vendedor precisa ver a conversa transferida |
| W2B-9 (vínculo com lead) | Não iniciada | Sem ela não há oportunidade para encaminhar |
| Resposta humana pelo CRM | Não planejada | Transferir para humano exige por onde o humano responder |
| App da Meta fora do modo Development e template aprovado | Pendente | Número de teste só alcança destinatários autorizados |

## Regras externas que moldam o desenho

Verificado em 2026-11-05. Revalidar antes de cada fase, porque essas regras mudam.

- **Janela de atendimento:** cada mensagem do cliente abre ou renova uma janela de 24
  horas. Dentro dela valem mensagens livres. Fora dela, só modelos pré-aprovados.
- **Automação:** a política da Meta (atualizada em 2026-09-23) permite automação na
  janela de 24 horas, desde que exista caminho claro de transferência para humano.
- **Opt-in:** a empresa é responsável por obter a adesão, conforme a lei aplicável, e
  deve atender a quem pedir para parar de receber mensagens.
- **Provedores de IA:** segundo a imprensa, os termos do WhatsApp Business vedam desde
  2026-01-15 o uso da API para distribuir assistentes de propósito geral, sem atingir
  empresas que usam IA no próprio atendimento. **O texto dos termos não foi lido
  diretamente.** Revisar antes da fase A2. Consequência de desenho: a IA atende só
  assuntos da concessionária e recusa uso geral.
- **LGPD:** o art. 20 trata da revisão de decisões exclusivamente automatizadas. A
  regulamentação da ANPD estava na agenda 2025-2026, e o estado atual precisa ser
  conferido. **Base legal, papéis e transferência internacional dependem de revisão
  jurídica.** Este plano não substitui essa revisão.

## Arquitetura

```text
Webhook (W2B-5)  → grava mensagem + job na MESMA transação → responde 200
Worker           → reivindica job → agrupa rajada → monta contexto mínimo
                 → modelo devolve proposta estruturada
Motor de regras  → valida janela, opt-out, limites, modo, kill switch
Outbox           → registra o envio ANTES de chamar a Meta → Cloud API
Status webhook   → atualiza entrega → falha vira transferência para humano
```

- **O modelo nunca roda dentro do webhook.** A rota precisa responder rápido para a
  Meta, e uma falha do modelo não pode fazer perder a captura.
- **Agendador:** o repositório não tem hoje. Avaliar Vercel Cron ou Vercel Queues na
  fase A1. Sem agendador confiável, a fase não avança.
- **Tudo atrás de RPC:** mesmo padrão da W2B-4, com RLS, zero policies e `service_role`.

### Dados novos (migrations futuras)

| Tabela | Conteúdo | Cuidados |
|---|---|---|
| `whatsapp_automation_settings` | Modo, limites e textos por empresa | Trava da TEST COMPANY, como `capture_enabled` |
| `whatsapp_ai_jobs` | Fila com lease, tentativas e `trigger_message_id` | Único por gatilho |
| `whatsapp_ai_turns` | Intenção, ação, modelo, tokens, latência, motivo de bloqueio | Texto cifrado ou ausente |
| `whatsapp_outbound_messages` | Outbox com conteúdo cifrado, wamid e estado | Único por `idempotency_key` |
| `whatsapp_consents` | Opt-in e opt-out, com origem e data | Sem texto livre |
| Estado em `whatsapp_conversations` | `automation_state`: `ai`, `human`, `blocked` | Mudança auditada |

## Automação por empresa

| Modo | Efeito |
|---|---|
| `off` | Padrão. Nada acontece |
| `shadow` | Gera a proposta e registra, sem enviar. Humano avalia |
| `test_numbers` | Envia só para telefones em lista, comparados por HMAC |
| `live` | Envia para clientes. Só com autorização específica por empresa |

Toda empresa nasce em `off`. Passar para `live` exige migration que remova a trava,
depois das decisões jurídicas e da avaliação. Testes e clientes reais nunca compartilham
modo: `shadow` e `test_numbers` não enviam a números fora da lista.

## Janela de 24 horas e templates

- A janela é calculada no servidor a partir da última mensagem recebida, nunca pelo
  modelo. Usa margem: nenhum envio automático com menos de 30 minutos restantes.
- A checagem roda de novo imediatamente antes do envio, não só ao gerar a proposta.
- Fora da janela, o motor bloqueia o envio livre e transfere para humano. A IA não
  envia template na primeira versão.
- Follow-up por template é fase posterior: template aprovado, categoria correta e
  opt-in registrado.
- Rejeição da Meta por janela encerrada nunca é repetida.

## Pipeline de IA

**Primeira versão sem tools de escrita e sem consulta a estoque.** O modelo não afirma
preço, disponibilidade ou condição de financiamento: encaminha a pergunta ao vendedor.

1. **Contexto mínimo:** últimas mensagens da janela, primeiro nome se existir, dados
   públicos da empresa e horário. Sem telefone, BSUID ou dados de outro cliente.
2. **Minimização:** padrões de CPF, cartão e similares são mascarados antes da chamada.
3. **Chamada única com saída estruturada** (`output_config.format`), validada no
   servidor. Campos: `intent`, `vehicle_interest`, `budget_range`, `payment_interest`,
   `trade_in`, `urgency`, `handoff_reason`, `confidence`, `reply_text`, `proposed_action`.
4. **Motor de regras:** valida o schema e aplica as regras abaixo. Proposta inválida
   nunca é enviada, e o atendimento vai para humano.

**Modelo:** começar por `claude-opus-5-5` com effort `low` (depois comparar `medium`) e
medir qualidade, latência e custo por atendimento concluído. Trocar de modelo é decisão
sua, baseada na avaliação.

Pontos da API a respeitar:

- thinking não pode ser desligado no Opus 5.5; a profundidade se controla por effort;
- `tool_choice` forçado retorna 400: usar saída estruturada;
- checar `stop_reason` antes de ler o conteúdo. `refusal`, `max_tokens` e erro viram
  transferência para humano, nunca uma resposta parcial ao cliente;
- ativar `fallbacks: "default"` para recusas, com o beta correspondente;
- `prompt caching`: instruções e dados estáveis da empresa primeiro, histórico depois,
  e nada volátil no prefixo. Conferir `cache_read_input_tokens`;
- usar o SDK oficial e erros tipados, com retry só para 429 e 5xx, e timeout curto.

**Custo de referência, a medir:** 3.000 tokens de entrada e 400 de saída, sem cache,
custam cerca de US$ 0,02 por resposta (US$ 4 e US$ 20 por milhão). Thinking conta como
saída, então o valor real pode ser maior. Os preços da Meta ficam fora desse cálculo.

### Prompt injection

O texto do cliente é dado não confiável. Ele vai delimitado e nunca na instrução do
sistema. A defesa principal é estrutural: o modelo não tem tools de escrita, a saída é
validada, e o motor de regras não obedece ao texto do modelo. Testes incluem mensagens
que tentam alterar preço, revelar instruções, pedir dados de outro cliente ou impedir a
transferência para humano. A resposta passa ainda por filtro de saída que bloqueia
valores, promessas, links e telefones fora de uma lista permitida.

## Prevenção de respostas duplicadas

A Cloud API não oferece garantia de idempotência documentada aqui, então o desenho é
**no máximo uma vez** para mensagem automática:

- `idempotency_key` derivada de empresa, conversa, mensagem gatilho e passo, com índice
  único na outbox;
- reentrega do webhook não cria segundo job;
- **agrupamento de rajada:** espera curta (15 a 30 segundos, a calibrar) e cancela o job
  se chegou mensagem mais nova, que passa a ser o gatilho;
- lock por conversa: um único worker por vez;
- estado `sending` gravado antes da chamada à Meta. Timeout com resultado desconhecido
  vira `unknown`, **sem reenvio**, e transfere para humano;
- antes de enviar, confere se um humano assumiu a conversa.

## Transferência para atendimento humano

Transfere quando: cliente pede atendente; opt-out; reclamação ou tom de conflito;
negociação de preço, financiamento, documento ou assunto jurídico; dúvida fora do
escopo; `confidence` baixa; limite de turnos; janela perto do fim; recusa ou falha do
modelo; envio com resultado desconhecido.

Depois de transferir, `automation_state = human` silencia a IA naquela conversa até um
humano devolver. O vendedor recebe a oportunidade com resumo curto. Se não houver
humano disponível, a IA avisa uma vez e para; nunca promete prazo que ninguém cumprirá.

## Consentimento e dados pessoais

- **Transparência:** a primeira resposta identifica o atendimento automatizado e diz
  como falar com uma pessoa.
- **Opt-out:** palavras como "parar" ou "atendente" são detectadas por regra, antes do
  modelo. Opt-out grava `whatsapp_consents` e bloqueia automação.
- **Papéis:** definir com jurídico quem é controlador e quem é operador. Concessionária,
  KAPA, Meta e provedor de IA precisam de contratos compatíveis.
- **Transferência internacional:** o processamento pelo provedor de IA pode ocorrer
  fora do Brasil, e isso precisa ser tratado antes de `live`.
- **Retenção no provedor:** confirmar contrato, retenção e uso de dados antes de enviar
  qualquer dado real.
- **Decisão automatizada:** a qualificação é apoio ao vendedor, nunca recusa de crédito
  ou de atendimento. Manter revisão humana.
- **Exclusão:** pedido do titular remove ou anonimiza também turnos e outbox, conforme
  a política de retenção a aprovar.

## Logs, falhas e limites

**Logs sanitizados:** `requestId`, fase, resultado, modelo, tokens, latência, tentativa e
códigos fechados. Nunca texto, nome, telefone, BSUID, wamid, prompt ou resposta bruta.

| Situação | Comportamento |
|---|---|
| Modelo indisponível | Retry curto; depois humano |
| Saída inválida | Sem envio; humano |
| Rejeição da Meta | Classifica; sem retry se definitiva; humano |
| Token da Meta inválido | Para a empresa inteira e alerta |
| Job travado | Lease expira; só retoma se não houve tentativa de envio |

**Limites sugeridos, a calibrar:** até 5 respostas automáticas por conversa na fase de
testes; limite por hora e por dia por empresa; teto mensal de custo por empresa; pausa
por qualidade do número reportada pela Meta.

## Desligamento de emergência

Três níveis, checados imediatamente antes de cada envio:

1. **Global:** variável `WHATSAPP_AI_ENABLED`, ausente por padrão.
2. **Por empresa:** modo volta a `off` por RPC auditada.
3. **Por conversa:** `automation_state = human`.

Variável na Vercel exige novo deployment, então o desligamento rápido por empresa fica
no banco. **Disjuntor automático:** taxa de erro, rejeição ou transferência acima do
limite muda a empresa para `off` e alerta. Mensagens continuam sendo capturadas; só a
automação para. Religar é sempre manual.

## Testes e avaliação

- **Conjunto de avaliação fictício**, com casos por intenção, ambiguidade, tentativa de
  injection, opt-out, grosseria e assunto fora do escopo. Nunca dados de clientes.
- **Critérios mínimos:** zero preço inventado, zero dado de outro cliente, 100% de
  opt-out respeitado, 100% de transferência quando pedida.
- **Cliente da Cloud API simulado** nos testes automatizados. Toda execução com modelo
  real tem custo e pede aprovação prévia.
- **Modo `shadow` antes de qualquer envio**, com revisão humana das propostas.

## Fases

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **A0** Decisões | Jurídico, termos da Meta, contrato do provedor, retenção, matriz | Decisões registradas |
| **A1** Infra | Fila, agendador, outbox, cliente da Cloud API simulado, kill switch | Testes de reentrega, rajada e lock, sem envio real |
| **A2** IA offline | Prompt, schema, motor de regras, avaliação fictícia | Critérios mínimos atingidos |
| **A3** Shadow | Propostas em dados da TEST COMPANY, sem envio | Revisão humana aprovada |
| **A4** Resposta humana | Envio pelo CRM dentro da janela, com permissões | Atendente assume e responde |
| **A5** Números de teste | Envio real só para lista autorizada | Um número, uma conversa, rollback testado |
| **A6** Piloto | Uma concessionária, com autorização específica | Métricas e reversão comprovadas |

## Decisões em aberto

1. Quem responde pela revisão jurídica e pela base legal.
2. Horário de atendimento automático: 24h ou só fora do expediente.
3. Fonte de estoque e preços, se um dia a IA puder citá-los.
4. Regra de distribuição da oportunidade entre vendedores.
5. Quem paga o custo de modelo e de mensagens por empresa.

## Fontes

- [Política de Mensagens do WhatsApp Business](https://whatsappbusiness.com/pt-br/policy/)
- [Cloud API: envio de mensagens](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [TechCrunch: mudança nos termos para chatbots de propósito geral](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)
- [Convergência Digital: ANPD e decisões automatizadas](https://convergenciadigital.com.br/governo/anpd-avanca-na-regulacao-de-decisoes-automatizadas-por-ia/)
- [Confidata: LGPD, art. 20 e decisões automatizadas](https://confidata.com.br/blog/decisoes-automatizadas-lgpd-direitos-obrigacoes)
