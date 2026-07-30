'use client';
import React from 'react';
import {
  FlowLigar, FlowVerCliente, FlowAtribuirVendedor, FlowArquivarLead,
  FlowVerClienteArquivado, FlowRestaurarLead, FlowShell,
} from './FlowsShared';
import {
  FlowNovoCliente, FlowEditarCliente, FlowCriarVisita, FlowConfirmarVisita,
  FlowRegistrarResultado, FlowNovaProposta, FlowAprovarProposta,
  FlowRegistrarVenda, FlowNovaPendencia, FlowReagendarPendencia, FlowCriarAcompanhamento,
} from './Flows2';
import {
  FlowPerfilVendedor, FlowNotificacoes, FlowBusca,
  FlowEnviarMensagem, FlowConfirmar, FlowEstados,
} from './Flows3';
import { isLocalCommercialDataAllowed } from '@/lib/leads/localCommercialAccess';

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
  'confirmar-visita': FlowConfirmarVisita,
  'registrar-resultado': FlowRegistrarResultado,
  'nova-proposta': FlowNovaProposta,
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
const LOCAL_COMMERCIAL_FLOW_IDS = new Set<string>([
  'criar-visita', 'confirmar-visita', 'registrar-resultado',
  'nova-proposta', 'aprovar-proposta', 'registrar-venda',
  'criar-acompanhamento', 'nova-pendencia', 'reagendar-pendencia',
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
  return <Comp payload={flow.payload || {}} close={close} openFlow={openFlow} go={go} />;
}
