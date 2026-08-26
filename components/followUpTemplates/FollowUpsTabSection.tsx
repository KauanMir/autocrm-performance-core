'use client';
// components/followUpTemplates/FollowUpsTabSection.tsx —
// FOLLOW-UP-TEMPLATES-A3-EXEC. Aba "Follow-ups" de Ajustes: Manager
// (própria empresa) e Super Admin contextual (empresa aberta explicitamente,
// via OperationalCompanyContext — resolvido pelo chamador, ScreenAjustes).
// Sem drag-and-drop (precheck A3-EXEC §16) — reorder via botões Subir/Descer
// simples, sempre via reorder_followup_templates atômico (nunca N updates).
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LBadge, LCard } from '@/components/ui/kit';
import { useManagementFollowUpTemplates } from '@/lib/hooks/useManagementFollowUpTemplates';
import { useSetFollowUpTemplateActive } from '@/lib/hooks/useSetFollowUpTemplateActive';
import { useReorderFollowUpTemplates } from '@/lib/hooks/useReorderFollowUpTemplates';
import { getFollowUpTemplateErrorMessage } from '@/lib/followupTemplates/errors';
import { formatFollowUpTemplateSubtitle } from '@/lib/followupTemplates/offsetLabel';
import { FOLLOWUP_PRIORITY_LABEL } from '@/lib/followupTemplates/labels';
import type { FollowUpTemplateModel } from '@/lib/followupTemplates/adapter';
import { FollowUpTemplateEditorModal } from '@/components/followUpTemplates/FollowUpTemplateEditorModal';

const ACTIVE_LIMIT = 12;

export type FollowUpsTabSectionProps = {
  userId: string;
  companyId: string | null;
  isSuperAdminContext: boolean;
  readAuthorized: boolean;
  writeAuthorized: boolean;
};

function FollowUpTemplateRow({
  template, index, total, writeAuthorized, onEdit, onToggleActive, onMove, toggleError, isTogglePending, isMovePending,
}: {
  template: FollowUpTemplateModel;
  index: number;
  total: number;
  writeAuthorized: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onMove: (direction: 'up' | 'down') => void;
  toggleError: string | null;
  isTogglePending: boolean;
  isMovePending: boolean;
}) {
  return (
    <div data-testid={`followup-template-row-${template.id}`}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 8, background: template.isActive ? 'transparent' : 'rgba(255,255,255,.02)' }}>
      {writeAuthorized && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button type="button" aria-label={`Mover ${template.name} para cima`} disabled={index === 0 || isMovePending}
            onClick={() => onMove('up')}
            style={{ border: 'none', background: 'transparent', color: index === 0 ? 'var(--t-300)' : 'var(--t-500)', cursor: index === 0 ? 'default' : 'pointer', padding: 2 }}>
            <Icon name="arrowUp" size={16} stroke={2.2} />
          </button>
          <button type="button" aria-label={`Mover ${template.name} para baixo`} disabled={index === total - 1 || isMovePending}
            onClick={() => onMove('down')}
            style={{ border: 'none', background: 'transparent', color: index === total - 1 ? 'var(--t-300)' : 'var(--t-500)', cursor: index === total - 1 ? 'default' : 'pointer', padding: 2 }}>
            <Icon name="arrowDown" size={16} stroke={2.2} />
          </button>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{template.name}</span>
          <LBadge tone={template.isActive ? 'green' : 'amber'}>{template.isActive ? 'Ativo' : 'Inativo'}</LBadge>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 3 }}>
          {template.taskTitle} · {formatFollowUpTemplateSubtitle(template)} · {FOLLOWUP_PRIORITY_LABEL[template.priority]}
        </div>
        {toggleError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{toggleError}</div>}
      </div>
      {writeAuthorized && (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <LBtn kind="ghost" size="sm" icon="edit" onClick={onEdit} aria-label={`Editar ${template.name}`}>Editar</LBtn>
          <LBtn kind="ghost" size="sm" icon={template.isActive ? 'eyeOff' : 'eye'} onClick={onToggleActive}
            aria-label={template.isActive ? `Desativar ${template.name}` : `Ativar ${template.name}`}>
            {isTogglePending ? 'Salvando…' : template.isActive ? 'Desativar' : 'Ativar'}
          </LBtn>
        </div>
      )}
    </div>
  );
}

export function FollowUpsTabSection({ userId, companyId, isSuperAdminContext, readAuthorized, writeAuthorized }: FollowUpsTabSectionProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FollowUpTemplateModel | null>(null);
  const [rowErrorId, setRowErrorId] = useState<string | null>(null);
  const [rowErrorMessage, setRowErrorMessage] = useState<string | null>(null);

  const state = useManagementFollowUpTemplates({ userId, companyId, readAuthorized, isSuperAdminContext });
  const toggleHook = useSetFollowUpTemplateActive({ userId, companyId, writeAuthorized, isSuperAdminContext });
  const reorderHook = useReorderFollowUpTemplates({ userId, companyId, writeAuthorized, isSuperAdminContext });

  if (!readAuthorized) {
    return (
      <LCard style={{ maxWidth: 640 }}>
        <div data-testid="followups-denied" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>
          Você não tem acesso aos follow-ups desta empresa.
        </div>
      </LCard>
    );
  }

  const openCreate = () => { setEditingTemplate(null); setEditorOpen(true); };
  const openEdit = (template: FollowUpTemplateModel) => { setEditingTemplate(template); setEditorOpen(true); };

  const handleToggleActive = async (template: FollowUpTemplateModel) => {
    setRowErrorId(null);
    setRowErrorMessage(null);
    try {
      await toggleHook.setActive({ templateId: template.id, expectedVersion: template.version, isActive: !template.isActive });
    } catch (err) {
      setRowErrorId(template.id);
      setRowErrorMessage(getFollowUpTemplateErrorMessage(err));
    }
  };

  const handleMove = async (templates: readonly FollowUpTemplateModel[], index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= templates.length) return;
    const ids = templates.map((t) => t.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(targetIndex, 0, moved);
    setRowErrorId(null);
    setRowErrorMessage(null);
    try {
      await reorderHook.reorderTemplates(ids);
    } catch (err) {
      setRowErrorId(templates[index].id);
      setRowErrorMessage(getFollowUpTemplateErrorMessage(err));
    }
  };

  const templates = state.status === 'ready' ? state.templates : [];
  const activeCount = templates.filter((t) => t.isActive).length;

  return (
    <LCard style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Follow-ups</div>
        {writeAuthorized && templates.length > 0 && (
          <LBtn kind="gold" size="sm" icon="plus" onClick={openCreate}>Novo follow-up</LBtn>
        )}
      </div>
      <div style={{ fontSize: 13, color: 'var(--t-500)', marginBottom: 16 }}>
        Atalhos para o vendedor criar uma pendência de retorno com poucos cliques.
        {templates.length > 0 && ` ${activeCount} de ${ACTIVE_LIMIT} follow-ups ativos.`}
      </div>

      {state.status === 'loading' && (
        <div data-testid="followups-loading" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--t-500)' }}>Carregando follow-ups…</div>
      )}
      {state.status === 'error' && (
        <div data-testid="followups-error" style={{ padding: '18px 6px', fontSize: 13.5, color: 'var(--red)' }}>
          Não foi possível carregar os follow-ups.{' '}
          <button type="button" onClick={state.retry} style={{ background: 'none', border: 'none', color: 'var(--gold-ink)', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>Tentar novamente</button>
        </div>
      )}
      {state.status === 'ready' && templates.length === 0 && (
        <div data-testid="followups-empty" style={{ padding: '28px 12px', textAlign: 'center' }}>
          <div style={{ fontSize: 13.5, color: 'var(--t-500)', marginBottom: writeAuthorized ? 16 : 0 }}>Nenhum follow-up configurado ainda.</div>
          {writeAuthorized && <LBtn kind="gold" icon="plus" onClick={openCreate}>Criar follow-up</LBtn>}
        </div>
      )}
      {state.status === 'ready' && templates.map((template, index) => (
        <FollowUpTemplateRow
          key={template.id}
          template={template}
          index={index}
          total={templates.length}
          writeAuthorized={writeAuthorized}
          onEdit={() => openEdit(template)}
          onToggleActive={() => handleToggleActive(template)}
          onMove={(direction) => handleMove(templates, index, direction)}
          toggleError={rowErrorId === template.id ? rowErrorMessage : null}
          isTogglePending={toggleHook.isPending}
          isMovePending={reorderHook.isPending}
        />
      ))}

      {editorOpen && companyId && (
        <FollowUpTemplateEditorModal
          userId={userId}
          companyId={companyId}
          isSuperAdminContext={isSuperAdminContext}
          template={editingTemplate}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </LCard>
  );
}
