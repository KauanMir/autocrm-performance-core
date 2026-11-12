# LGPD — pedido de eliminação de dados (KAPA Leads + KAPA CRM)

Status: procedimento **preparado**. A parte do CRM depende da migration `20261111130000_lgpd_subject_erasure.sql`
(local; validada em banco descartável — pgTAP `93_lgpd_subject_erasure.sql`). Nada foi aplicado em produção.

## 1. O que existia e o que faltava

| Sistema | Antes | Lacuna |
|---|---|---|
| KAPA Leads | `delete_lead` (Admin) apaga lead + notas + histórico; opção de liberar o bloqueio de CPF; página LGPD (Super Admin) para CPF sem lead; auditoria sem CPF | nenhuma no próprio sistema; mas a exclusão **não chega ao CRM** |
| KAPA CRM | nenhuma forma de eliminar um titular: leads nunca são apagados (tarefas, visitas, negociações e vendas os referenciam) e nome/telefone/e-mail também ficam em respostas de formulário, linha do tempo, tarefas, visitas e negociações | **corrigida** pela migration 87 |

Decisão: a exclusão no KAPA Leads **não** apaga automaticamente no CRM. Um lead pode ser excluído lá por
outros motivos (teste, spam), e no CRM o contato pode ter histórico comercial próprio (vendedor, visita,
venda, Meta Lead Ads). O pedido do titular é tratado de forma explícita nos dois sistemas, nesta ordem.

## 2. O que a eliminação no CRM faz (`lgpd_erase_subject`)

Anonimiza no lugar (não apaga o lead, para não quebrar vendas e relatórios), em todas as empresas:

- lead: nome → "Titular removido (LGPD)", telefone → "0", arquivado (sai do funil e nunca mais casa por telefone);
- respostas de formulário (Meta e simuladores): **apagadas**;
- linha do tempo do lead: **apagada** (textos livres podem conter dados); fica 1 registro técnico;
- tarefas, visitas, negociações: textos livres e nome do cliente substituídos;
- fila do KAPA Leads: dados apagados; a linha técnica (só IDs) fica para o mesmo lead nunca ser importado de novo;
- vendas, valores, contagens e ranking: mantidos (não identificam ninguém);
- auditoria: 1 registro por empresa com o **protocolo** e as contagens (sem nome, telefone, e-mail ou CPF).

Só o operador do banco executa (SQL Editor / service_role). A aplicação não tem acesso.

## 3. Procedimento (por pedido)

1. **Validar o pedido** (identidade do titular) e abrir um protocolo, ex.: `LGPD-2026-0001`. Nunca usar CPF,
   nome ou e-mail como protocolo (a função recusa).
2. **KAPA Leads primeiro** (Super Admin da KAPA): localizar os leads do titular e usar **Excluir lead** marcando
   a liberação do CPF e a identidade verificada; se houver bloqueio de CPF sem lead, usar Configurações → LGPD.
3. **Aguardar 5 minutos** (a sincronização tem até ~3 min de atraso; depois disso nada mais chega ao CRM).
4. **CRM — localizar** (somente leitura, sem dados pessoais na saída):
   ```sql
   select * from public.lgpd_subject_lookup('<telefone>', '<e-mail ou null>');
   ```
5. **CRM — simular** (nada é gravado): `select * from public.lgpd_erase_subject('<telefone>', '<e-mail>', 'LGPD-2026-0001');`
6. **CRM — executar**: `select * from public.lgpd_erase_subject('<telefone>', '<e-mail>', 'LGPD-2026-0001', true);`
7. Conferir: o passo 4 não retorna mais nada. Registrar no protocolo a data e as contagens.
8. **Meta Lead Ads**: se o titular veio de anúncio, o lead também existe na Central de Leads da Meta/Página do
   cliente — orientar a concessionária a excluí-lo lá.
9. **Backups**: backups antigos ainda contêm os dados até expirarem. Nunca restaurar um backup em produção sem
   reaplicar os pedidos de eliminação registrados depois da data dele (lista de protocolos).

## 4. Limites conhecidos

- WhatsApp (tabelas cifradas por telefone, hoje vazias e desligadas): fora desta função; requisito antes de ligar.
- A função não procura texto livre em outros leads (ex.: um vendedor que anotou o nome do titular no lead de
  outra pessoa).
- A identificação é por telefone e/ou e-mail; CPF não existe no CRM.
