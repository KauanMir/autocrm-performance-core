'use client';
// components/followUpTemplates/FollowUpTemplateEditorModal.tsx —
// FOLLOW-UP-TEMPLATES-A3-EXEC. Modal único de criar/editar (mesmo molde de
// components/invites/InviteUserModal.tsx) — `template` presente decide o
// modo (editar) vs ausente (criar). Usuário NUNCA vê offset_value/
// offset_unit/HH:mm como termos técnicos (precheck A3-EXEC §10/§12):
// "Retornar em [N] [Hora(s)|Dia(s)]" + "Horário padrão" condicional.
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FField, FArea, FlowShell, Segmented } from '@/components/flows/FlowsShared';
import { useCreateFollowUpTemplate, type CreateFollowUpTemplateInput } from '@/lib/hooks/useCreateFollowUpTemplate';
import { useUpdateFollowUpTemplate } from '@/lib/hooks/useUpdateFollowUpTemplate';
import { getFollowUpTemplateErrorMessage } from '@/lib/followupTemplates/errors';
import { FOLLOWUP_PRIORITY_OPTIONS, formatOffsetUnitOptionLabel } from '@/lib/followupTemplates/labels';
import type { FollowUpTemplateModel, FollowUpTemplateOffsetUnit } from '@/lib/followupTemplates/adapter';
import type { Database } from '@/lib/supabase/database.types';

type TaskPriority = Database['public']['Enums']['task_priority'];

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export type FollowUpTemplateEditorModalProps = {
  userId: string;
  companyId: string;
  isSuperAdminContext: boolean;
  template: FollowUpTemplateModel | null;
  onClose: () => void;
  onSaved?: () => void;
};

export function FollowUpTemplateEditorModal({
  userId, companyId, isSuperAdminContext, template, onClose, onSaved,
}: FollowUpTemplateEditorModalProps) {
  const isEditing = template !== null;

  const [name, setName] = useState(template?.name ?? '');
  const [taskTitle, setTaskTitle] = useState(template?.taskTitle ?? '');
  const [taskNote, setTaskNote] = useState(template?.taskNote ?? '');
  const [priority, setPriority] = useState<TaskPriority>(template?.priority ?? 'media');
  const [offsetUnit, setOffsetUnit] = useState<FollowUpTemplateOffsetUnit>(template?.offsetUnit ?? 'day');
  const [offsetValueText, setOffsetValueText] = useState(String(template?.offsetValue ?? 1));
  const [useDefaultTime, setUseDefaultTime] = useState(Boolean(template?.defaultTime));
  const [defaultTime, setDefaultTime] = useState(template?.defaultTime ?? '');
  const [lastError, setLastError] = useState<unknown>(null);

  const createHook = useCreateFollowUpTemplate({ userId, companyId, writeAuthorized: true, isSuperAdminContext });
  const updateHook = useUpdateFollowUpTemplate({ userId, companyId, writeAuthorized: true, isSuperAdminContext });
  const isPending = createHook.isPending || updateHook.isPending;

  const handlePickUnit = (unit: FollowUpTemplateOffsetUnit) => {
    setOffsetUnit(unit);
    // Hora nunca combina com horário padrão (backend exige NULL — precheck
    // A3-EXEC §11) — limpa ao trocar para hora, nunca envia um valor stale.
    if (unit === 'hour') {
      setUseDefaultTime(false);
      setDefaultTime('');
    }
  };

  const nameTrimmed = name.trim();
  const taskTitleTrimmed = taskTitle.trim();
  const offsetValue = Number(offsetValueText);
  const offsetCeiling = offsetUnit === 'hour' ? 168 : 90;
  const offsetIsValid = Number.isInteger(offsetValue) && offsetValue > 0 && offsetValue <= offsetCeiling;
  const timeIsValid = !useDefaultTime || TIME_PATTERN.test(defaultTime);
  const canSubmit = !isPending && nameTrimmed !== '' && taskTitleTrimmed !== '' && offsetIsValid && timeIsValid;

  const submit = async () => {
    if (!canSubmit) return;
    setLastError(null);
    const resolvedDefaultTime = offsetUnit === 'day' && useDefaultTime ? defaultTime : null;
    try {
      if (isEditing) {
        await updateHook.updateTemplate({
          templateId: template.id,
          expectedVersion: template.version,
          name: nameTrimmed,
          taskTitle: taskTitleTrimmed,
          taskNote: taskNote.trim(),
          priority,
          offsetValue,
          offsetUnit,
          defaultTime: resolvedDefaultTime,
        });
      } else {
        const input: CreateFollowUpTemplateInput = {
          name: nameTrimmed,
          taskTitle: taskTitleTrimmed,
          taskNote: taskNote.trim(),
          priority,
          offsetValue,
          offsetUnit,
          defaultTime: resolvedDefaultTime,
        };
        await createHook.createTemplate(input);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setLastError(err);
    }
  };

  return (
    <FlowShell
      eyebrow="FOLLOW-UPS"
      title={isEditing ? 'Editar follow-up' : 'Novo follow-up'}
      sub="Um follow-up cria uma pendência normal com poucos cliques — nunca envia mensagem automática."
      icon="clock"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={isPending ? 'refresh' : 'check'} onClick={submit}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {isPending ? 'Salvando…' : 'Salvar follow-up'}
          </LBtn>
        </>
      }
    >
      {lastError != null && (
        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          {getFollowUpTemplateErrorMessage(lastError)}
        </div>
      )}

      <FField label="Nome do follow-up" icon="edit" placeholder="Ex.: Cliente pediu para pensar"
        value={name} autoFocus onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
      <FField label="Título da pendência" icon="clipboard" placeholder="Ex.: Retomar contato"
        value={taskTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTaskTitle(e.target.value)} />
      <FArea label="Observação (opcional)" placeholder="Observação que aparece na pendência criada"
        value={taskNote} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTaskNote(e.target.value)} />

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Prioridade</span>
        <Segmented options={FOLLOWUP_PRIORITY_OPTIONS} value={priority} onChange={setPriority} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Retornar em</span>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
          <input type="number" min={1} max={offsetCeiling} step={1} value={offsetValueText}
            onChange={(e) => setOffsetValueText(e.target.value)}
            style={{ width: '100%', padding: '13px 15px', borderRadius: 12, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 15, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)' }} />
          <Segmented
            options={[['hour', formatOffsetUnitOptionLabel('hour', offsetValue || 1)], ['day', formatOffsetUnitOptionLabel('day', offsetValue || 1)]]}
            value={offsetUnit}
            onChange={handlePickUnit}
          />
        </div>
        {!offsetIsValid && (
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>
            Informe um número entre 1 e {offsetCeiling}.
          </span>
        )}
      </div>

      {offsetUnit === 'day' && (
        <div style={{ marginBottom: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: useDefaultTime ? 10 : 0, cursor: 'pointer' }}>
            <input type="checkbox" checked={useDefaultTime} onChange={(e) => setUseDefaultTime(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 13.5, color: 'var(--t-700)' }}>Definir um horário padrão</span>
          </label>
          {useDefaultTime ? (
            <FField label="Horário padrão" icon="clock" type="time" value={defaultTime}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDefaultTime(e.target.value)} />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--t-400)', marginTop: 6 }}>
              Sem horário padrão. Se não definir um horário, o vendedor escolhe ao usar este follow-up.
            </div>
          )}
        </div>
      )}
    </FlowShell>
  );
}
