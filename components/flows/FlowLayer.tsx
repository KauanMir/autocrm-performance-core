'use client';
import React from 'react';
import {
  FlowLigar, FlowVerCliente, FlowAtribuirVendedor, FlowArquivarLead,
  FlowVerClienteArquivado, FlowRestaurarLead, FlowShell,
} from './FlowsShared';
import {
  FlowNovoCliente, FlowEditarCliente, FlowCriarVisita, FlowReagendarVisita, FlowConfirmarVisita,
  FlowRegistrarResultado, FlowRegistrarResultadoRemoto, FlowNovaProposta, FlowAprovarProposta,
  FlowRegistrarVenda, FlowNovaPendencia, FlowReagendarPendencia, FlowCriarAcompanhamento,
  FlowVerNegociacao,
} from './Flows2';
import {
  FlowPerfilVendedor, FlowNotificacoes, FlowBusca,
  FlowEnviarMensagem, FlowConfirmar, FlowEstados,
} from './Flows3';
import { isLocalCommercialDataAllowed } from '@/lib/leads/localCommercialAccess';
import { resolveVisitRemoteMode } from '@/lib/visits/remoteVisitsMode';
import { resolveDealRemoteMode } from '@/lib/deals/remoteDealsMode';

const FLOW_MAP: Record<string, React.ComponentType<any>> = {
  'ligar': FlowLigar,
  'ver-cliente': FlowVerCliente,
  'atribuir-vendedor': FlowAtribuirVendedor,
  'arquivar-lead': FlowArquivarLead,
  'ver-cliente-arquivado': FlowVerClienteArquivado,
  'restaurar-lead': FlowRestaurarLead,
  'novo-cliente': FlowNovoCliente,
  'editar-cliente': FlowEditarCliente,
  'criar-visita': FlowCriarVisita,
  'reagendar-visita': FlowReagendarVisita,
  'confirmar-visita': FlowConfirmarVisita,
  'registrar-resultado': FlowRegistrarResultado,
  'registrar-resultado-remoto': FlowRegistrarResultadoRemoto,
  'nova-proposta': FlowNovaProposta,
  'ver-negociacao': FlowVerNegociacao,
  'aprovar-proposta': FlowAprovarProposta,
  'registrar-venda': FlowRegistrarVenda,
  'nova-pendencia': FlowNovaPendencia,
  'reagendar-pendencia': FlowReagendarPendencia,
  'criar-acompanhamento': FlowCriarAcompanhamento,
  'perfil-vendedor': FlowPerfilVendedor,
  'notificacoes': FlowNotificacoes,
  'busca': FlowBusca,
  'enviar-mensagem': FlowEnviarMensagem,
  'confirmar': FlowConfirmar,
  'estados': FlowEstados,
};

// M1-E E5-B2-A1 — gate central: TODO flow que lê/escreve Visit/Deal/Sale/
// Task (Visita/Proposta/Venda/Acompanhamento/Pendência) passa por aqui,
// não importa quem chamou openFlow (LeadCard, ScreensBiz, Flows3, estado
// antigo) — nunca depende do botão que originou a chamada.
//
// COMMERCIAL-REMOTE-B1-B3-D: 'nova-pendencia' SAIU deste set — Task tem
// backend remoto próprio desde o B1-B3-A, e FlowNovaPendencia agora decide
// local/remoto sozinho (resolveTaskRemoteMode(), mesmo contrato de
// resolveLeadFlowContext), nunca mais lançando em modo remoto.
//
// COMMERCIAL-REMOTE-B1-B3-E: 'reagendar-pendencia' SAIU pelo mesmo motivo —
// FlowReagendarPendencia agora decide local/remoto sozinho.
//
// COMMERCIAL-REMOTE-VISITS-B4: 'criar-visita' SAIU pelo mesmo motivo — Visit
// também ganhou backend remoto próprio (migration #52) e FlowCriarVisita
// agora decide local/remoto sozinho (resolveVisitRemoteMode()). Diferente
// de Tasks, porém, criar-visita ganha um gate DEDICADO logo abaixo (não
// apenas "sai do Set e vira responsabilidade só do submit") — decisão
// explícita do B4-PRECHECK-R1 §9: bloquear a ABERTURA do flow, não somente
// a mutation, quando Visits não puder operar (visit_blocked/
// visit_remote_misconfigured). Deal/Sale (Proposta/Venda) e
// 'criar-acompanhamento' permanecem aqui — nenhum dos dois foi migrado.
//
// COMMERCIAL-REMOTE-VISITS-B5: 'reagendar-visita' é um flow id NOVO
// (nunca esteve neste Set) — REMOTE-ONLY, gate dedicado próprio logo
// abaixo (isVisitRescheduleFlowAllowed). 'confirmar-visita'/
// 'registrar-resultado' permanecem aqui, inalterados — B5 não libera
// Confirmar/Cancelar/Registrar resultado remotamente.
//
// COMMERCIAL-REMOTE-VISITS-B6-A: Confirmar/Cancelar viraram ações INLINE
// da própria row (ScreensBiz.tsx) — nenhum flow id novo, nenhuma mudança
// neste arquivo.
//
// COMMERCIAL-REMOTE-VISITS-B6-B: 'registrar-resultado-remoto' é outro flow
// id NOVO REMOTE-ONLY, mesmo padrão de 'reagendar-visita' — gate dedicado
// logo abaixo (isVisitRegisterResultFlowAllowed). O id local
// 'registrar-resultado' permanece aqui, inalterado — continua abrindo
// FlowRegistrarResultado local (que ainda encaminha para registrar-venda/
// nova-proposta/criar-acompanhamento LOCAIS, nenhum dos três alterado).
//
// COMMERCIAL-REMOTE-DEALS-B4: 'nova-proposta' SAIU deste set pelo mesmo
// motivo de 'criar-visita' (B4 de Visits) — Deal ganhou create remoto
// próprio (migration #53) e FlowNovaProposta agora decide local/remoto
// sozinho (resolveDealRemoteMode()), com gate DEDICADO logo abaixo
// (isDealCreateFlowAllowed). 'aprovar-proposta'/'registrar-venda'/
// 'criar-acompanhamento' permanecem aqui — nenhum dos três foi migrado.
const LOCAL_COMMERCIAL_FLOW_IDS = new Set<string>([
  'confirmar-visita', 'registrar-resultado',
  'aprovar-proposta', 'registrar-venda',
  'criar-acompanhamento',
]);

function LocalCommercialFlowUnavailable({ close }: { close: () => void }) {
  return (
    <FlowShell eyebrow="INDISPONÍVEL" title="Módulo indisponível" icon="alert" accent="#8B8B93" onClose={close}>
      <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t-500)', fontSize: 14 }}>
        Visitas, propostas, vendas e acompanhamentos serão disponibilizados após a migração deste módulo.
      </div>
    </FlowShell>
  );
}

// COMMERCIAL-REMOTE-VISITS-B4 — gate DEDICADO de 'criar-visita', separado
// de LOCAL_COMMERCIAL_FLOW_IDS (que é orientado só por isLocalCommercial-
// DataAllowed()/modo de Leads, sem noção de visit_remote_ready).
// Caller-independent (B4-PRECHECK-R1 §11): decide só por flow.id +
// resolveVisitRemoteMode(), nunca por quem chamou openFlow — se um entry
// point hoje não-remote-reachable (LeadCard/FlowVerCliente, atrás de
// capabilities.canApplyEvents) se tornar remote-reachable no futuro, este
// gate continua protegendo do mesmo jeito.
//
// Identidade (visit_remote_unavailable_identity) é deliberadamente FORA do
// escopo deste gate — FlowLayer não tem currentUser (nunca teve, para
// nenhum flow, nem o gate antigo de isLocalCommercialDataAllowed) e não é
// o momento de introduzir isso só para Visits. A defesa real de identidade
// já existe em duas camadas mais profundas: (1) o botão de ScreenVisitas só
// é renderizado com identidade completa (visit_remote_unavailable_identity
// não mostra nenhuma ação de criar), e (2) useCreateVisit falha fechado com
// 'forbidden' antes de qualquer RPC se a identidade estiver incompleta.
function isVisitCreateFlowAllowed(): boolean {
  const mode = resolveVisitRemoteMode();
  return mode === 'visit_local' || mode === 'visit_remote_ready';
}

// COMMERCIAL-REMOTE-VISITS-B5 — gate DEDICADO de 'reagendar-visita', mesmo
// espírito de isVisitCreateFlowAllowed acima, mas mais estrito: este flow
// é REMOTE-ONLY (B5-PRECHECK §24/§25) — não existe implementação local
// (o reagendamento local continua inteiramente dentro do tile "Remarcar"
// de FlowConfirmarVisita, que abre 'criar-visita', nunca este id). Por
// isso 'visit_local' também bloqueia aqui — diferente de
// isVisitCreateFlowAllowed, que precisa permitir local porque
// FlowCriarVisita TEM um branch local real. Nenhuma row local jamais
// chama openFlow('reagendar-visita'), então isto é defesa-em-profundidade
// para um caminho já estruturalmente inalcançável em modo local, não uma
// restrição funcional nova.
function isVisitRescheduleFlowAllowed(): boolean {
  return resolveVisitRemoteMode() === 'visit_remote_ready';
}

// COMMERCIAL-REMOTE-VISITS-B6-B — gate DEDICADO de
// 'registrar-resultado-remoto', mesmo contrato exato de
// isVisitRescheduleFlowAllowed (B5): REMOTE-ONLY, 'visit_local' também
// bloqueia (nenhuma row local jamais abre este id — o registro local
// continua inteiramente atrás de 'registrar-resultado', em
// LOCAL_COMMERCIAL_FLOW_IDS, intocado).
function isVisitRegisterResultFlowAllowed(): boolean {
  return resolveVisitRemoteMode() === 'visit_remote_ready';
}

// COMMERCIAL-REMOTE-DEALS-B4 — gate DEDICADO de 'nova-proposta', mesmo
// padrão exato de isVisitCreateFlowAllowed (B4 de Visits): decide só por
// flow.id + resolveDealRemoteMode(), nunca por quem chamou openFlow — se
// um entry point hoje não-remote-reachable se tornar remote-reachable no
// futuro, este gate continua protegendo do mesmo jeito. Identidade
// (deal_remote_unavailable_identity) fica deliberadamente FORA deste gate,
// mesmo raciocínio já registrado para Visits: a defesa real já existe em
// duas camadas mais profundas — (1) o CTA de ScreenPropostas só é
// renderizado em deal_remote_active, e (2) useCreateDeal falha fechado com
// 'forbidden' antes de qualquer RPC se a identidade estiver incompleta.
function isDealCreateFlowAllowed(): boolean {
  const mode = resolveDealRemoteMode();
  return mode === 'deal_local' || mode === 'deal_remote_ready';
}

// COMMERCIAL-REMOTE-DEALS-B5 — gate DEDICADO de 'ver-negociacao', mesmo
// espírito de isVisitRescheduleFlowAllowed/isVisitRegisterResultFlowAllowed
// (B5/B6-B de Visits): flow id NOVO, REMOTE-ONLY — não existe equivalente
// local (o "Ver" local abre 'ver-cliente', nunca este id), então
// 'deal_local' também bloqueia aqui, diferente de isDealCreateFlowAllowed.
// Nenhuma row local jamais chama openFlow('ver-negociacao') — defesa em
// profundidade para um caminho já estruturalmente inalcançável em modo
// local.
function isDealDetailFlowAllowed(): boolean {
  return resolveDealRemoteMode() === 'deal_remote_ready';
}

export function FlowLayer({ flow, close, openFlow, go }: {
  flow: { id: string; payload: any } | null;
  close: () => void;
  openFlow: (id: string, payload?: any) => void;
  go: (id: string) => void;
}) {
  if (!flow) return null;
  const Comp = FLOW_MAP[flow.id];
  if (!Comp) return null;
  // Recusa mesmo para um flow.id de estado antigo/residual — nenhum dado
  // local é lido antes desta checagem (a decisão vem só do resolver de
  // flags, nunca do payload do flow).
  if (LOCAL_COMMERCIAL_FLOW_IDS.has(flow.id) && !isLocalCommercialDataAllowed()) {
    return <LocalCommercialFlowUnavailable close={close} />;
  }
  if (flow.id === 'criar-visita' && !isVisitCreateFlowAllowed()) {
    return <LocalCommercialFlowUnavailable close={close} />;
  }
  if (flow.id === 'reagendar-visita' && !isVisitRescheduleFlowAllowed()) {
    return <LocalCommercialFlowUnavailable close={close} />;
  }
  if (flow.id === 'registrar-resultado-remoto' && !isVisitRegisterResultFlowAllowed()) {
    return <LocalCommercialFlowUnavailable close={close} />;
  }
  if (flow.id === 'nova-proposta' && !isDealCreateFlowAllowed()) {
    return <LocalCommercialFlowUnavailable close={close} />;
  }
  if (flow.id === 'ver-negociacao' && !isDealDetailFlowAllowed()) {
    return <LocalCommercialFlowUnavailable close={close} />;
  }
  return <Comp payload={flow.payload || {}} close={close} openFlow={openFlow} go={go} />;
}
