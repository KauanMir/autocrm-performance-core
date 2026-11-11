'use client';
// components/integrations/KapaLeadsSyncPanel.tsx — Ajustes > Integrações: leads dos simuladores e
// landing pages recebidos pelo KAPA Leads. Manager vê a saúde e a fila de revisão; só o Super
// Admin vincula a loja e liga/pausa. O banco revalida cada chamada. Nada aqui mostra dados do
// cliente: a fila técnica não expõe nome, telefone ou e-mail.
import { useState } from 'react';
import { LBadge, LBtn, LCard } from '@/components/ui/kit';
import {
  useDismissKapaLeadsEvent,
  useKapaLeadsReview,
  useKapaLeadsSyncHealth,
  useRequeueKapaLeadsEvent,
  useSetKapaLeadsLinkEnabled,
  useUpsertKapaLeadsLink,
} from '@/lib/hooks/useKapaLeadsSync';
import {
  describeKapaLeadsErrorCode,
  KapaLeadsSyncError,
  type KapaLeadsDismissResolution,
  type KapaLeadsReviewItem,
  type KapaLeadsSyncHealth,
} from '@/lib/integrations/kapaLeadsSync';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Sem consulta bem-sucedida há mais deste tempo com o vínculo ligado: alerta. */
export const STALE_MINUTES = 15;

const DISMISS_LABELS: Record<KapaLeadsDismissResolution, string> = {
  handled_manually: 'Tratado manualmente',
  duplicate: 'Duplicado',
  test_event: 'Teste',
  not_recoverable: 'Não recuperável',
};

const muted: React.CSSProperties = { fontSize: 12.5, color: 'var(--t-500)' };
const sectionTitle: React.CSSProperties = { fontWeight: 700, fontSize: 14, margin: '18px 0 8px' };
const input: React.CSSProperties = { fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 0 };

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

export function isStale(link: KapaLeadsSyncHealth, nowMs: number): boolean {
  if (!link.enabled) return false;
  const last = link.lastSuccessAt ?? link.activatedAt;
  if (!last) return true;
  return nowMs - new Date(last).getTime() > STALE_MINUTES * 60_000;
}

function errorMessage(error: unknown): string {
  if (error instanceof KapaLeadsSyncError) {
    if (error.code === 'company_not_active') return 'Só empresas ativas podem receber leads.';
    if (error.code === 'store_linked_to_other_company') return 'Esta loja do KAPA Leads já está vinculada a outra empresa.';
    if (error.code === 'invalid_input') return 'Dados inválidos.';
    if (error.code === 'forbidden') return 'Sem permissão.';
  }
  return 'Não foi possível concluir agora.';
}

function LinkStatus({ link, companyId, isSuperAdmin }: { link: KapaLeadsSyncHealth; companyId: string; isSuperAdmin: boolean }) {
  const setEnabled = useSetKapaLeadsLinkEnabled(companyId);
  const [message, setMessage] = useState<string | null>(null);
  const stale = isStale(link, Date.now());
  return (
    <div data-testid="kapa-leads-link" style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'grid', gap: 6, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13.5 }}>{link.storeLabel}</strong>
        <LBadge tone={link.enabled ? (stale || link.lastErrorCode ? 'red' : 'green') : 'amber'}>
          {link.enabled ? (stale ? 'Sem sincronizar' : link.lastErrorCode ? 'Com falha' : 'Sincronizando') : 'Pausada'}
        </LBadge>
      </div>
      <div style={muted}>
        Ativada em {formatDateTime(link.activatedAt)} · última consulta {formatDateTime(link.lastPolledAt)} · último sucesso {formatDateTime(link.lastSuccessAt)}
      </div>
      <div style={muted}>
        Recebidos (7 dias): {link.processed7d} · na fila: {link.pendingCount} · para revisar: {link.failedCount}
        {link.oldestPendingAt ? ` · pendente desde ${formatDateTime(link.oldestPendingAt)}` : ''}
      </div>
      {link.lastErrorCode && (
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>
          {describeKapaLeadsErrorCode(link.lastErrorCode)} ({link.consecutiveFailures} falha(s) seguida(s))
        </div>
      )}
      {stale && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>Nenhuma consulta bem-sucedida há mais de {STALE_MINUTES} minutos.</div>}
      {isSuperAdmin && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <LBtn kind={link.enabled ? 'ghost' : 'primary'} size="sm"
            onClick={() => {
              if (setEnabled.isPending) return;
              setMessage(null);
              setEnabled.mutate({ linkId: link.linkId, enabled: !link.enabled }, {
                onSuccess: (enabled) => setMessage(enabled
                  ? 'Ligada. Só leads criados a partir de agora entram no CRM.'
                  : 'Pausada. Os simuladores continuam funcionando; ao religar, os leads do período entram.'),
                onError: (error) => setMessage(errorMessage(error)),
              });
            }}>
            {link.enabled ? 'Pausar sincronização' : link.activatedAt ? 'Religar sincronização' : 'Ligar sincronização'}
          </LBtn>
          {message && <span style={muted}>{message}</span>}
        </div>
      )}
    </div>
  );
}

function LinkForm({ companyId }: { companyId: string }) {
  const upsert = useUpsertKapaLeadsLink(companyId);
  const [storeId, setStoreId] = useState('');
  const [label, setLabel] = useState('');
  const [vehicleKey, setVehicleKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const id = storeId.trim().toLowerCase();
  const key = vehicleKey.trim();
  const valid = UUID.test(id) && label.trim().length > 0 && label.trim().length <= 150 && (!key || FORM_KEY.test(key));
  return (
    <div data-testid="kapa-leads-link-form" style={{ display: 'grid', gap: 8, marginTop: 6 }}>
      <div style={muted}>Vincular uma loja do KAPA Leads a esta empresa (fica pausada até ser ligada).</div>
      <input aria-label="ID da loja no KAPA Leads" placeholder="ID da loja no KAPA Leads (UUID)" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={input} />
      <input aria-label="Nome da loja" placeholder="Nome da loja (ex.: RCAR Seminovos)" value={label} onChange={(e) => setLabel(e.target.value)} style={input} />
      <input aria-label="Campo do veículo de interesse" placeholder="Campo do veículo de interesse (opcional)" value={vehicleKey} onChange={(e) => setVehicleKey(e.target.value)} style={input} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <LBtn kind="primary" size="sm"
          style={{ opacity: valid && !upsert.isPending ? 1 : 0.6, cursor: valid ? 'pointer' : 'not-allowed' }}
          onClick={() => {
            if (!valid || upsert.isPending) return;
            setMessage(null);
            upsert.mutate({ kapaStoreId: id, storeLabel: label.trim(), vehicleFormKey: key || null }, {
              onSuccess: () => setMessage('Vínculo salvo.'),
              onError: (error) => setMessage(errorMessage(error)),
            });
          }}>
          Salvar vínculo
        </LBtn>
        {message && <span style={muted}>{message}</span>}
      </div>
    </div>
  );
}

function ReviewRow({ item, companyId }: { item: KapaLeadsReviewItem; companyId: string }) {
  const requeue = useRequeueKapaLeadsEvent(companyId);
  const dismiss = useDismissKapaLeadsEvent(companyId);
  const [resolution, setResolution] = useState<KapaLeadsDismissResolution>('handled_manually');
  const [message, setMessage] = useState<string | null>(null);
  const busy = requeue.isPending || dismiss.isPending;
  return (
    <li data-testid="kapa-leads-review-item" style={{ listStyle: 'none', padding: '10px 0', borderTop: '1px solid var(--line, #eee)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <LBadge tone={item.status === 'failed' ? 'red' : 'amber'}>{item.status === 'failed' ? 'Revisar' : 'Nova tentativa'}</LBadge>
        <strong style={{ fontSize: 13 }}>{item.campaignName}</strong>
      </div>
      <div style={{ ...muted, marginTop: 4 }}>{describeKapaLeadsErrorCode(item.lastErrorCode)}</div>
      <div style={{ ...muted, marginTop: 4 }}>
        Simulação em {formatDateTime(item.sourceCreatedAt)} · {item.attempts} tentativa(s)
        {item.status === 'pending' ? ` · próxima em ${formatDateTime(item.nextAttemptAt)}` : ''}
      </div>
      {item.status === 'failed' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {item.lastErrorCode !== 'invalid_payload' && (
            <LBtn kind="ghost" size="sm" icon="refresh"
              onClick={() => {
                if (busy) return;
                setMessage(null);
                requeue.mutate(item.eventId, {
                  onSuccess: (outcome) => setMessage(outcome === 'requeued' ? 'Nova tentativa agendada.' : 'Este item não pode voltar para a fila.'),
                  onError: () => setMessage('Não foi possível agora.'),
                });
              }}>
              Tentar de novo
            </LBtn>
          )}
          <select aria-label="Motivo do encerramento" value={resolution} disabled={busy}
            onChange={(e) => setResolution(e.target.value as KapaLeadsDismissResolution)}
            style={{ fontSize: 12.5, padding: '4px 6px', borderRadius: 8 }}>
            {(Object.keys(DISMISS_LABELS) as KapaLeadsDismissResolution[]).map((k) => <option key={k} value={k}>{DISMISS_LABELS[k]}</option>)}
          </select>
          <LBtn kind="ghost" size="sm"
            onClick={() => {
              if (busy) return;
              setMessage(null);
              dismiss.mutate({ eventId: item.eventId, resolution }, {
                onSuccess: (outcome) => setMessage(outcome === 'dismissed' ? 'Encerrado.' : 'Não pode ser encerrado.'),
                onError: () => setMessage('Não foi possível agora.'),
              });
            }}>
            Encerrar
          </LBtn>
          {message && <span style={muted}>{message}</span>}
        </div>
      )}
    </li>
  );
}

export function KapaLeadsSyncPanel({ companyId, isSuperAdmin }: { companyId: string; isSuperAdmin: boolean }) {
  const health = useKapaLeadsSyncHealth(companyId, true);
  const review = useKapaLeadsReview(companyId, true);
  const links = health.data ?? [];
  if (!isSuperAdmin && !health.isLoading && links.length === 0 && !health.isError) return null;

  return (
    <div data-testid="kapa-leads-sync-panel" style={{ marginTop: 16 }}>
    <LCard>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Simuladores e landing pages (KAPA Leads)</div>
      <div style={{ ...muted, marginBottom: 12 }}>
        Leads dos simuladores continuam chegando ao KAPA Leads e também entram aqui em Clientes → Sem vendedor.
        Se esta sincronização falhar ou for pausada, os simuladores seguem funcionando e nada se perde.
      </div>
      {health.isError && <div role="alert" style={{ fontSize: 12.5, color: 'var(--red)' }}>Não foi possível carregar a sincronização.</div>}
      {links.map((link) => <LinkStatus key={link.linkId} link={link} companyId={companyId} isSuperAdmin={isSuperAdmin} />)}
      {isSuperAdmin && <LinkForm companyId={companyId} />}
      {(review.data?.length ?? 0) > 0 && (
        <>
          <div style={sectionTitle}>Itens para revisar</div>
          <ul style={{ margin: 0, padding: 0 }}>
            {review.data!.map((item) => <ReviewRow key={item.eventId} item={item} companyId={companyId} />)}
          </ul>
        </>
      )}
    </LCard>
    </div>
  );
}
