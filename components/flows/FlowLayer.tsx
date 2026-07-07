'use client';
import React from 'react';
import { FlowLigar, FlowVerCliente } from './FlowsShared';
import {
  FlowNovoCliente, FlowEditarCliente, FlowCriarVisita, FlowConfirmarVisita,
  FlowRegistrarResultado, FlowNovaProposta, FlowAprovarProposta,
  FlowRegistrarVenda, FlowNovaPendencia, FlowReagendarPendencia, FlowCriarAcompanhamento,
} from './Flows2';
import {
  FlowPerfilVendedor, FlowNotificacoes, FlowBusca,
  FlowEnviarMensagem, FlowConfirmar, FlowEstados,
} from './Flows3';

const FLOW_MAP: Record<string, React.ComponentType<any>> = {
  'ligar': FlowLigar,
  'ver-cliente': FlowVerCliente,
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

export function FlowLayer({ flow, close, openFlow, go }: {
  flow: { id: string; payload: any } | null;
  close: () => void;
  openFlow: (id: string, payload?: any) => void;
  go: (id: string) => void;
}) {
  if (!flow) return null;
  const Comp = FLOW_MAP[flow.id];
  if (!Comp) return null;
  return <Comp payload={flow.payload || {}} close={close} openFlow={openFlow} go={go} />;
}
