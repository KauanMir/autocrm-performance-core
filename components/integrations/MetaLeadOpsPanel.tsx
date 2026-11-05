'use client';
// components/integrations/MetaLeadOpsPanel.tsx — META-MVP1. Operação do Lead
// Ads em Ajustes > Integrações: saúde da conexão, fila de revisão (eventos
// técnicos, NÃO leads) e mapeamento de campos por formulário.
//
// Renderizado só onde o chamador já autorizou (hoje: aba Integrações, Super
// Admin + company de teste). O banco revalida cada chamada. Nada aqui mostra
// token, nome, telefone ou e-mail: o ledger não guarda PII.
import { useState } from 'react';
import { LBadge, LBtn, LCard } from '@/components/ui/kit';
import {
  useDeleteMetaFormMapping,
  useDismissMetaLeadEvent,
  useMetaConnectionHealth,
  useMetaFormMappings,
  useMetaLeadReview,
  useRequeueMetaLeadEvent,
  useSetMetaFormMapping,
} from '@/lib/hooks/useMetaLeadOps';
import {
  DISMISS_LABELS,
  describeLeadErrorCode,
  reviewStateLabel,
  summarizeConnection,
} from '@/lib/integrations/metaLeadOpsCopy';
import type { DismissResolution, MetaFormMapping, MetaLeadReviewItem } from '@/lib/integrations/metaLeadOps';

const TARGET_LABELS: Record<MetaFormMapping['target'], string> = {
  name: 'Nome',
  phone: 'Telefone',
  email: 'E-mail',
  vehicle: 'Veículo de interesse',
};

const REQUEUE_MESSAGES: Record<string, string> = {
  requeued: 'Reprocessamento agendado.',
  not_found: 'Evento não encontrado.',
  not_requeueable: 'Este evento não pode ser reprocessado agora.',
  requeue_limit: 'Limite de reprocessamentos atingido.',
  too_old: 'O lead tem mais de 90 dias e a Meta não o disponibiliza mais.',
};

const FORM_ID_PATTERN = /^\d{1,64}$/;

export const STUCK_ACTION = 'Sem processamento há mais de 15 minutos: verifique o agendador ou reprocesse agora.';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

const sectionTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, margin: '18px 0 8px' };
const muted: React.CSSProperties = { fontSize: 12.5, color: 'var(--t-500)' };
const alertStyle: React.CSSProperties = {
  marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--red-bg)',
  border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 12.5,
};

function ReviewItem({ item, companyId }: { item: MetaLeadReviewItem; companyId: string }) {
  const requeue = useRequeueMetaLeadEvent(companyId);
  const dismiss = useDismissMetaLeadEvent(companyId);
  const [resolution, setResolution] = useState<DismissResolution>('handled_manually');
  const [message, setMessage] = useState<string | null>(null);
  const base = describeLeadErrorCode(item.lastErrorCode);
  // Parado = ninguém processou há mais de 15 min: a "nova tentativa automática"
  // não está acontecendo, então o texto não pode prometer isso.
  const copy = item.reviewState === 'stuck'
    ? { title: base.title, action: STUCK_ACTION }
    : base;
  const busy = requeue.isPending || dismiss.isPending;
  const tone = item.reviewState === 'failed' ? 'red' : 'amber';

  return (
    <li data-testid="meta-review-item" style={{ listStyle: 'none', padding: '10px 0', borderTop: '1px solid var(--line, #eee)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <LBadge tone={tone}>{reviewStateLabel(item.reviewState)}</LBadge>
        <strong style={{ fontSize: 13 }}>{copy.title}</strong>
      </div>
      <div style={{ ...muted, marginTop: 4 }}>{copy.action}</div>
      <div style={{ ...muted, marginTop: 4 }}>
        Recebido em {formatDateTime(item.receivedAt)} · {item.attempts} tentativa(s)
        {item.requeueCount > 0 ? ` · reprocessado ${item.requeueCount}x` : ''}
        {item.reviewState === 'retrying' ? ` · próxima em ${formatDateTime(item.nextAttemptAt)}` : ''}
      </div>
      <div style={{ ...muted, marginTop: 2 }}>
        ID do lead na Meta: <code>{item.leadgenId}</code>
        {item.formId ? <> · formulário <code>{item.formId}</code></> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {item.canRequeue && (
          <LBtn kind="ghost" size="sm" icon="refresh"
            onClick={() => {
              if (busy) return;
              setMessage(null);
              requeue.mutate(item.eventId, {
                onSuccess: (result) => setMessage(REQUEUE_MESSAGES[result.outcome] ?? 'Feito.'),
                onError: () => setMessage('Não foi possível reprocessar agora.'),
              });
            }}>
            Reprocessar
          </LBtn>
        )}
        {item.canDismiss && (
          <>
            <select aria-label="Motivo do encerramento" value={resolution} disabled={busy}
              onChange={(event) => setResolution(event.target.value as DismissResolution)}
              style={{ fontSize: 12.5, padding: '4px 6px', borderRadius: 8 }}>
              {(Object.keys(DISMISS_LABELS) as DismissResolution[]).map((key) => (
                <option key={key} value={key}>{DISMISS_LABELS[key]}</option>
              ))}
            </select>
            <LBtn kind="ghost" size="sm"
              onClick={() => {
                if (busy) return;
                setMessage(null);
                dismiss.mutate({ eventId: item.eventId, resolution }, {
                  onSuccess: (outcome) => setMessage(outcome === 'dismissed' ? 'Encerrado.' : 'Este evento não pode ser encerrado.'),
                  onError: () => setMessage('Não foi possível encerrar agora.'),
                });
              }}>
              Encerrar
            </LBtn>
          </>
        )}
      </div>
      {message && <div role="status" style={{ ...muted, marginTop: 6 }}>{message}</div>}
    </li>
  );
}

function MappingForm({ companyId }: { companyId: string }) {
  const setMapping = useSetMetaFormMapping(companyId);
  const [formId, setFormId] = useState('');
  const [target, setTarget] = useState<MetaFormMapping['target']>('vehicle');
  const [fieldKey, setFieldKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmedForm = formId.trim();
    const trimmedKey = fieldKey.trim();
    if (!FORM_ID_PATTERN.test(trimmedForm) || trimmedKey === '' || trimmedKey.length > 100) {
      setError('Informe o ID numérico do formulário e o nome do campo (até 100 caracteres).');
      return;
    }
    setError(null);
    setMapping.mutate({ formId: trimmedForm, target, fieldKey: trimmedKey }, {
      onSuccess: () => setFieldKey(''),
      onError: () => setError('Não foi possível salvar o mapeamento.'),
    });
  };

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input aria-label="ID do formulário" placeholder="ID do formulário" value={formId}
          onChange={(event) => setFormId(event.target.value)} style={{ flex: '1 1 140px', fontSize: 13, padding: 6 }} />
        <select aria-label="Campo do CRM" value={target}
          onChange={(event) => setTarget(event.target.value as MetaFormMapping['target'])} style={{ fontSize: 13, padding: 6 }}>
          {(Object.keys(TARGET_LABELS) as MetaFormMapping['target'][]).map((key) => (
            <option key={key} value={key}>{TARGET_LABELS[key]}</option>
          ))}
        </select>
        <input aria-label="Nome do campo no formulário" placeholder="Nome do campo no formulário" value={fieldKey}
          onChange={(event) => setFieldKey(event.target.value)} style={{ flex: '1 1 160px', fontSize: 13, padding: 6 }} />
        <LBtn kind="ghost" size="sm" onClick={submit}>{setMapping.isPending ? 'Salvando…' : 'Salvar'}</LBtn>
      </div>
      {error && <div role="alert" style={alertStyle}>{error}</div>}
    </div>
  );
}

export function MetaLeadOpsPanel({ companyId, authorized = true }: { companyId: string; authorized?: boolean }) {
  const health = useMetaConnectionHealth(companyId, authorized);
  const review = useMetaLeadReview(companyId, authorized);
  const mappings = useMetaFormMappings(companyId, authorized);
  const deleteMapping = useDeleteMetaFormMapping(companyId);
  if (!authorized) return null;
  const now = new Date();

  return (
    <LCard style={{ maxWidth: 560, marginTop: 16 }}>
      <div data-testid="meta-lead-ops-panel" style={{ fontWeight: 700, fontSize: 15 }}>Operação Lead Ads</div>
      <div style={muted}>Saúde da conexão, eventos que precisam de atenção e mapeamento dos formulários.</div>

      <div style={sectionTitle}>Conexão</div>
      {health.isLoading && <div style={muted}>Carregando…</div>}
      {health.isError && <div role="alert" style={alertStyle}>Não foi possível ler a conexão.</div>}
      {health.data && health.data.length === 0 && <div style={muted}>Nenhuma Página conectada.</div>}
      {health.data?.map((row) => {
        const summary = summarizeConnection(row, now);
        return (
          <div key={row.integrationId} data-testid="meta-connection-health" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LBadge tone={summary.tone}>{summary.label}</LBadge>
              <span style={{ fontSize: 13 }}>{row.pageName ?? 'Página sem nome'}</span>
            </div>
            <div style={{ ...muted, marginTop: 4 }}>{summary.detail}</div>
            <div style={{ ...muted, marginTop: 2 }}>Verificada em {formatDateTime(row.tokenCheckedAt)}</div>
          </div>
        );
      })}

      <div style={sectionTitle}>Fila de revisão</div>
      <div style={muted}>Eventos técnicos de recebimento. Não são leads e não entram no funil.</div>
      {review.isLoading && <div style={muted}>Carregando…</div>}
      {review.isError && <div role="alert" style={alertStyle}>Não foi possível ler a fila.</div>}
      {review.data && (
        <>
          <div data-testid="meta-review-summary" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5, margin: '8px 0' }}>
            <span>Falhas abertas: <strong>{review.data.summary.failedOpen}</strong></span>
            <span>Em nova tentativa: <strong>{review.data.summary.retrying}</strong></span>
            <span>Parados: <strong>{review.data.summary.stuck}</strong></span>
            <span>Processados (7 dias): <strong>{review.data.summary.processedLast7d}</strong></span>
          </div>
          <div style={muted}>Último recebido: {formatDateTime(review.data.summary.lastReceivedAt)} · último processado: {formatDateTime(review.data.summary.lastProcessedAt)}</div>
          {review.data.items.length === 0
            ? <div style={{ ...muted, marginTop: 8 }} data-testid="meta-review-empty">Nenhum evento precisa de atenção.</div>
            : (
              <ul style={{ padding: 0, margin: '8px 0 0' }}>
                {review.data.items.map((item) => <ReviewItem key={item.eventId} item={item} companyId={companyId} />)}
              </ul>
            )}
          <div style={{ marginTop: 8 }}>
            <LBtn kind="ghost" size="sm" icon="refresh" onClick={() => void review.refetch()}>Atualizar</LBtn>
          </div>
        </>
      )}

      <div style={sectionTitle}>Mapeamento de campos por formulário</div>
      <div style={muted}>
        Sem mapeamento, nome, telefone e e-mail usam os campos padrão da Meta, e o veículo fica como “Não informado”.
        Todas as respostas continuam salvas no lead.
      </div>
      {mappings.isError && <div role="alert" style={alertStyle}>Não foi possível ler os mapeamentos.</div>}
      {mappings.data && mappings.data.length > 0 && (
        <ul style={{ padding: 0, margin: '8px 0 0' }}>
          {mappings.data.map((mapping) => (
            <li key={`${mapping.formId}:${mapping.target}`} data-testid="meta-form-mapping"
              style={{ listStyle: 'none', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
              <code>{mapping.formId}</code>
              <span>{TARGET_LABELS[mapping.target] ?? mapping.target} ← <code>{mapping.fieldKey}</code></span>
              <LBtn kind="ghost" size="sm" aria-label="Remover mapeamento"
                onClick={() => deleteMapping.mutate({ formId: mapping.formId, target: mapping.target })}>
                Remover
              </LBtn>
            </li>
          ))}
        </ul>
      )}
      <MappingForm companyId={companyId} />
    </LCard>
  );
}
