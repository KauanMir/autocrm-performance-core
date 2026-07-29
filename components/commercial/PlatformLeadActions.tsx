'use client';
// components/commercial/PlatformLeadActions.tsx — widgets de mutation do
// detalhe do Lead na superfície platform do Super Admin (M1-F S8-C2-D2).
// Todos PUROS/apresentacionais: recebem dados e callbacks já resolvidos
// pelo chamador (PlatformLeadDetails) — nenhum acessa hooks de rede,
// contexto comercial ou capability diretamente. Nenhum reutiliza
// PipeCard/DnD/StoreAdapter/formulário mock.
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import type { PlatformPipelineStageRow, PlatformSellerRow } from '@/lib/commercial/repository';
import {
  LEAD_EVENT_GROUP_LABELS,
  LEAD_EVENT_GROUP_ORDER,
  groupLeadEventRegistry,
  type LeadEventType,
} from '@/lib/commercial/leadEventRegistry';

const menuPanelStyle: React.CSSProperties = {
  position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 6, zIndex: 5,
  maxHeight: 280, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)',
  borderRadius: 12, boxShadow: 'var(--shadow-lg)',
};

const menuItemStyle: React.CSSProperties = {
  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
  fontFamily: 'inherit', color: '#fff', fontSize: 13.5,
};

const triggerButtonStyle = (disabled: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', fontFamily: 'inherit',
  fontSize: 13, color: 'var(--t-900)', cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
});

// ── Etapa ─────────────────────────────────────────────────────────────────
export type PlatformLeadStageMenuProps = {
  stages: readonly PlatformPipelineStageRow[];
  currentStageId: string;
  disabled: boolean;
  onSelect: (stageId: string) => void;
};

export function PlatformLeadStageMenu({ stages, currentStageId, disabled, onSelect }: PlatformLeadStageMenuProps) {
  const [open, setOpen] = useState(false);
  const current = stages.find((s) => s.id === currentStageId) ?? null;
  const others = stages.filter((s) => s.id !== currentStageId);

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" data-testid="platform-lead-stage-trigger" disabled={disabled}
        onClick={() => setOpen((o) => !o)} style={triggerButtonStyle(disabled)}>
        <Icon name="flow" size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
        {current?.name ?? 'Etapa indisponível'}
        <Icon name="arrowDown" size={14} stroke={2} style={{ color: 'var(--t-400)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={menuPanelStyle} data-testid="platform-lead-stage-menu">
          {others.length === 0 ? (
            <div style={{ padding: '10px 14px', color: 'var(--t-500)', fontSize: 12.5 }}>Nenhuma outra etapa disponível.</div>
          ) : others.map((s) => (
            <button key={s.id} type="button" style={menuItemStyle}
              onClick={() => { setOpen(false); onSelect(s.id); }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Vendedor ──────────────────────────────────────────────────────────────
export type PlatformLeadSellerMenuProps = {
  sellers: readonly PlatformSellerRow[];
  sellersLoading: boolean;
  sellersError: boolean;
  currentSellerId: string | null;
  disabled: boolean;
  onSelect: (sellerId: string | null) => void;
};

export function PlatformLeadSellerMenu({
  sellers, sellersLoading, sellersError, currentSellerId, disabled, onSelect,
}: PlatformLeadSellerMenuProps) {
  const [open, setOpen] = useState(false);
  const current = currentSellerId ? sellers.find((s) => s.seller_id === currentSellerId) ?? null : null;
  // Estado honesto: um seller_id atribuído que não aparece mais na lista
  // recarregada (transferido, desativado, outra empresa) nunca vira um
  // nome inventado.
  const currentLabel = !currentSellerId
    ? 'Sem vendedor'
    : current
      ? current.name
      : 'Vendedor anterior ou indisponível';

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" data-testid="platform-lead-seller-trigger" disabled={disabled || sellersLoading}
        onClick={() => setOpen((o) => !o)} style={triggerButtonStyle(disabled || sellersLoading)}>
        <Icon name="users" size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
        {sellersLoading ? 'Carregando vendedores…' : currentLabel}
        <Icon name="arrowDown" size={14} stroke={2} style={{ color: 'var(--t-400)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {sellersError && (
        <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>Não foi possível carregar os vendedores.</div>
      )}
      {open && !sellersLoading && (
        <div style={menuPanelStyle} data-testid="platform-lead-seller-menu">
          <button type="button" style={{ ...menuItemStyle, color: 'var(--t-500)' }}
            onClick={() => { setOpen(false); onSelect(null); }}>
            Sem vendedor
          </button>
          {sellers.map((s) => (
            <button key={s.seller_id} type="button" style={menuItemStyle}
              onClick={() => { setOpen(false); onSelect(s.seller_id); }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Arquivamento ────────────────────────────────────────────────────────
export type PlatformLeadArchiveControlProps = {
  archived: boolean;
  disabled: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
};

export function PlatformLeadArchiveControl({ archived, disabled, onArchive, onUnarchive }: PlatformLeadArchiveControlProps) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div data-testid="platform-lead-archive-confirm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
          {archived ? 'Desarquivar este Lead?' : 'Arquivar este Lead?'}
        </span>
        <LBtn kind="ghost" onClick={() => setConfirming(false)}>Cancelar</LBtn>
        <LBtn kind="gold" onClick={() => { setConfirming(false); archived ? onUnarchive() : onArchive(); }}>
          Confirmar
        </LBtn>
      </div>
    );
  }

  return (
    <button type="button" data-testid="platform-lead-archive-trigger" disabled={disabled}
      onClick={() => setConfirming(true)} style={triggerButtonStyle(disabled)}>
      <Icon name={archived ? 'upload' : 'inbox'} size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
      {archived ? 'Desarquivar' : 'Arquivar'}
    </button>
  );
}

// ── Evento comercial ──────────────────────────────────────────────────────
export type PlatformLeadEventMenuProps = {
  disabled: boolean;
  onSelect: (eventType: LeadEventType) => void;
};

export function PlatformLeadEventMenu({ disabled, onSelect }: PlatformLeadEventMenuProps) {
  const [open, setOpen] = useState(false);
  const grouped = groupLeadEventRegistry();

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" data-testid="platform-lead-event-trigger" disabled={disabled}
        onClick={() => setOpen((o) => !o)} style={triggerButtonStyle(disabled)}>
        <Icon name="zap" size={15} stroke={2} style={{ color: 'var(--t-400)' }} />
        Registrar evento
        <Icon name="arrowDown" size={14} stroke={2} style={{ color: 'var(--t-400)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{ ...menuPanelStyle, maxHeight: 340 }} data-testid="platform-lead-event-menu">
          {LEAD_EVENT_GROUP_ORDER.map((group) => (
            <div key={group}>
              <div style={{ padding: '8px 14px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t-500)' }}>
                {LEAD_EVENT_GROUP_LABELS[group]}
              </div>
              {(grouped.get(group) ?? []).map((entry) => (
                <button key={entry.eventType} type="button" style={menuItemStyle}
                  onClick={() => { setOpen(false); onSelect(entry.eventType); }}>
                  <span style={{ flex: 1 }}>{entry.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Timeline manual ─────────────────────────────────────────────────────
// icon/color reais aceitos pela RPC, fixados para uma entrada manual do
// Super Admin (decisão de produto — nunca expõe o campo técnico bruto ao
// usuário): mesmo tom já usado para o ícone de histórico no detalhe.
export const PLATFORM_MANUAL_TIMELINE_ICON = 'message';
export const PLATFORM_MANUAL_TIMELINE_COLOR = '#3B82F6';

export type PlatformLeadTimelineFormProps = {
  disabled: boolean;
  onSubmit: (input: { label: string; detail?: string }) => Promise<unknown>;
};

export function PlatformLeadTimelineForm({ disabled, onSubmit }: PlatformLeadTimelineFormProps) {
  const [label, setLabel] = useState('');
  const [detail, setDetail] = useState('');
  const labelBlank = label.trim() === '';
  const canSubmit = !disabled && !labelBlank;

  const submit = async () => {
    if (!canSubmit) return;
    await onSubmit({ label: label.trim(), detail: detail.trim() || undefined });
    setLabel('');
    setDetail('');
  };

  return (
    <div data-testid="platform-lead-timeline-form" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Título da anotação"
        aria-label="Título da anotação"
        disabled={disabled}
        style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', color: '#fff', fontFamily: 'inherit', fontSize: 13.5, outline: 'none' }}
      />
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="Detalhes (opcional)"
        aria-label="Detalhes da anotação"
        disabled={disabled}
        rows={2}
        style={{ width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', color: '#fff', fontFamily: 'inherit', fontSize: 13.5, outline: 'none', resize: 'vertical' }}
      />
      <LBtn kind="ghost" onClick={submit} style={{ alignSelf: 'flex-end', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
        Adicionar à timeline
      </LBtn>
    </div>
  );
}
