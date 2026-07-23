'use client';
// components/invites/InviteList.tsx — listagem real de convites (M1-F
// S4-F3). Único consumidor de useInvites nesta etapa — substitui a lista
// mock que a aba Usuários mostrava desde o S4-F1/S4-F2. Reenvio/
// cancelamento passam exclusivamente pelos hooks já auditados
// (useResendInvite/useCancelInvite); este componente nunca decide
// autorização — só exibe o que a RLS já deixou passar e reage ao
// resultado real de cada mutation. Nenhuma edição de nome/e-mail/cargo/
// status (fora de escopo, ver profiles_update_admin — não tocado).
import React, { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LBadge, LCard } from '@/components/ui/kit';
import { useInvites } from '@/lib/hooks/useInvites';
import type { AdminInviteListItem } from '@/lib/invites/repository';
import type { AdminInviteScope } from '@/lib/invites/queryKeys';
import { useCompanies } from '@/lib/hooks/useCompanies';
import { useResendInvite, getResendInviteErrorMessage } from '@/lib/hooks/useResendInvite';
import { useCancelInvite, getCancelInviteErrorMessage } from '@/lib/hooks/useCancelInvite';
import { ROLE_KIND_LABELS } from '@/lib/invites/createInviteRequest';
import { InviteUserModal } from '@/components/invites/InviteUserModal';
import type { CreateInviteActor } from '@/lib/hooks/useCreateInvite';
import { AuthService } from '@/lib/services';

type InviteStatus = AdminInviteListItem['status'];

const STATUS_LABEL: Record<InviteStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceito',
  expired: 'Expirado',
  canceled: 'Cancelado',
  superseded: 'Substituído',
};

// LBadge só tem 3 tons reais (red/amber/green — ver components/ui/kit.tsx);
// canceled/superseded usam amber como base e um style neutro por cima
// (mesmo truque visual já usado para o pill "Vendedor" mais abaixo neste
// arquivo) — nunca dependem só da cor, o texto do rótulo já diferencia.
const STATUS_TONE: Record<InviteStatus, string> = {
  pending: 'amber',
  accepted: 'green',
  expired: 'red',
  canceled: 'amber',
  superseded: 'amber',
};

const NEUTRAL_BADGE_STYLE: React.CSSProperties = {
  color: 'var(--t-500)', background: 'rgba(255,255,255,.06)', borderColor: 'var(--border)',
};

// Status "real" para exibição/ações — nunca um 6º valor inventado, só a
// materialização preguiçosa que o próprio backend já faz (resend_invite/
// cancel_invite: `if v_old.status = 'pending' and v_old.expires_at <= now()`
// antes de qualquer outra decisão, ver m1f_s4a2a). Um convite pending cujo
// prazo já passou é tratado pelo backend como expirado — reenviável, MAS
// cancel_invite() só materializa a linha e devolve invite_not_actionable,
// nunca cancela de fato. Mostrar "Pendente" com um botão Cancelar que o
// backend recusaria seria enganoso — este cálculo só espelha o que o
// backend já faz, não inventa comportamento novo.
function effectiveStatus(invite: AdminInviteListItem): InviteStatus {
  if (invite.status === 'pending' && new Date(invite.expires_at).getTime() <= Date.now()) {
    return 'expired';
  }
  return invite.status;
}

// Matriz de ações derivada dos contratos reais (m1f_s4a2a):
// resend_invite aceita status IN ('pending','expired'); cancel_invite
// exige status = 'pending' estrito (nunca 'expired' — ver comentário
// acima). accepted/canceled/superseded: nenhuma ação em nenhum dos dois.
function canResend(status: InviteStatus): boolean {
  return status === 'pending' || status === 'expired';
}
function canCancel(status: InviteStatus): boolean {
  return status === 'pending';
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export type InviteListProps = {
  userId: string;
  // null: ator sem capability de gerenciar convites — o componente não
  // renderiza nada (defesa em profundidade; ScreenAjustes já não chega a
  // montar a aba/o componente nesse caso).
  actor: CreateInviteActor | null;
};

export function InviteList({ userId, actor }: InviteListProps) {
  const isSuperAdmin = actor?.kind === 'super_admin';
  // Escopo derivado do actor — nunca um segundo estado paralelo que
  // pudesse divergir dele. Super Admin: plataforma (nenhum seletor de
  // empresa nesta etapa, ver §12/S7). Manager: SEMPRE a própria membership
  // ativa, nunca profiles.company_id legado.
  const scope: AdminInviteScope | null = actor === null
    ? null
    : actor.kind === 'super_admin'
      ? { kind: 'platform' }
      : { kind: 'company', companyId: actor.companyId };

  const invitesQuery = useInvites({ userId, authorized: actor !== null, scope });
  // Só para mapear company_id → nome na coluna Empresa do Super Admin —
  // nunca para autorização (isso é sempre RLS/actor). Manager nunca busca
  // esta lista (authorized=false quando !isSuperAdmin), evitando uma
  // consulta que ele não precisa só para exibir o nome da própria empresa
  // (que ele já sabe — nem aparece coluna Empresa para Manager).
  const companiesQuery = useCompanies({ userId, authorized: isSuperAdmin });

  const companyNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of companiesQuery.companies) map.set(c.id, c.name);
    return map;
  }, [companiesQuery.companies]);

  const [modalOpen, setModalOpen] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  // Guarda SÍNCRONA contra clique duplo — pendingActionId (state) só reflete
  // no DOM no próximo render; um segundo clique disparado antes disso (ex.:
  // Enter+Enter, ou o teste chamando o handler duas vezes na mesma tick)
  // ainda seria aceito se a única defesa fosse esconder o botão. Este ref
  // muda de valor IMEDIATAMENTE, na mesma execução síncrona do primeiro
  // clique, então a segunda chamada nunca chega a invocar resendInvite/
  // cancelInvite.
  const actionInFlightRef = useRef(false);

  const getAccessToken = React.useCallback(async () => {
    const { data } = await AuthService.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const { resendInvite } = useResendInvite({ userId, authorized: actor !== null, getAccessToken });
  const { cancelInvite } = useCancelInvite({ userId, authorized: actor !== null });

  if (actor === null) return null;

  const performResend = async (inviteId: string) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingActionId(inviteId);
    setActionError(null);
    try {
      const result = await resendInvite(inviteId);
      if (result.outcome === 'ok') {
        invitesQuery.refetch();
        lastFocusedRef.current?.focus();
        return;
      }
      setActionError({ id: inviteId, message: getResendInviteErrorMessage(result) });
    } catch (err) {
      setActionError({ id: inviteId, message: getResendInviteErrorMessage(err) });
    } finally {
      actionInFlightRef.current = false;
      setPendingActionId(null);
    }
  };

  const performCancel = async (inviteId: string) => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setPendingActionId(inviteId);
    setActionError(null);
    try {
      const result = await cancelInvite(inviteId);
      if (result.outcome === 'ok') {
        invitesQuery.refetch();
        lastFocusedRef.current?.focus();
        return;
      }
      setActionError({ id: inviteId, message: getCancelInviteErrorMessage(result) });
    } catch (err) {
      setActionError({ id: inviteId, message: getCancelInviteErrorMessage(err) });
    } finally {
      actionInFlightRef.current = false;
      setPendingActionId(null);
    }
  };

  // trigger vem de document.activeElement no momento do clique (o próprio
  // botão, já focado pelo navegador antes do onClick disparar) — evita
  // precisar de ref forwarding em LBtn (função simples, sem forwardRef).
  const askResend = (invite: AdminInviteListItem, trigger: HTMLElement | null) => {
    lastFocusedRef.current = trigger;
    (window as any).__openFlow?.('confirmar', {
      title: 'Reenviar convite?',
      message: 'Um novo e-mail será enviado e o link anterior deixará de funcionar.',
      confirmLabel: 'Reenviar convite',
      tone: 'gold',
      icon: 'send',
      onConfirm: () => performResend(invite.id),
      onDismiss: () => lastFocusedRef.current?.focus(),
    });
  };

  const askCancel = (invite: AdminInviteListItem, trigger: HTMLElement | null) => {
    lastFocusedRef.current = trigger;
    (window as any).__openFlow?.('confirmar', {
      title: 'Cancelar convite?',
      message: 'Este convite deixará de poder ser utilizado. O histórico será preservado.',
      confirmLabel: 'Cancelar convite',
      cancelLabel: 'Voltar',
      tone: 'danger',
      icon: 'xCircle',
      onConfirm: () => performCancel(invite.id),
      onDismiss: () => lastFocusedRef.current?.focus(),
    });
  };

  return (
    <>
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Equipe</span>
          <LBtn size="sm" kind="primary" icon="plus" style={{ marginLeft: 'auto' }} onClick={() => setModalOpen(true)}>Convidar</LBtn>
        </div>

        {invitesQuery.isLoading && (
          <div aria-live="polite" style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--t-400)', fontSize: 13.5 }}>
            Carregando convites…
          </div>
        )}

        {!invitesQuery.isLoading && invitesQuery.isError && (
          <div style={{ padding: '32px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--t-500)' }}>
            <Icon name="wifiOff" size={24} stroke={2} />
            <span style={{ fontSize: 13.5 }}>Não foi possível carregar os convites.</span>
            <LBtn kind="ghost" size="sm" icon="refresh" onClick={() => invitesQuery.refetch()}>Tentar novamente</LBtn>
          </div>
        )}

        {!invitesQuery.isLoading && !invitesQuery.isError && invitesQuery.isEmpty && (
          <div style={{ padding: '32px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--t-500)' }}>
            <Icon name="inbox" size={24} stroke={2} />
            <span style={{ fontSize: 13.5 }}>Nenhum convite enviado ainda.</span>
            <LBtn kind="primary" size="sm" icon="plus" onClick={() => setModalOpen(true)}>Convidar usuário</LBtn>
          </div>
        )}

        {!invitesQuery.isLoading && !invitesQuery.isError && invitesQuery.hasData && (
          <div>
            {invitesQuery.invites.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                isSuperAdmin={isSuperAdmin}
                companyName={invite.company_id ? (companyNameById.get(invite.company_id) ?? 'Empresa não disponível') : 'Plataforma KAPA'}
                isPending={pendingActionId === invite.id}
                error={actionError?.id === invite.id ? actionError.message : null}
                onResend={(trigger) => askResend(invite, trigger)}
                onCancel={(trigger) => askCancel(invite, trigger)}
              />
            ))}
          </div>
        )}
      </LCard>

      {modalOpen && (
        <InviteUserModal
          userId={userId}
          actor={actor}
          onClose={() => setModalOpen(false)}
          onSent={() => invitesQuery.refetch()}
        />
      )}
    </>
  );
}

function InviteRow({ invite, isSuperAdmin, companyName, isPending, error, onResend, onCancel }: {
  invite: AdminInviteListItem;
  isSuperAdmin: boolean;
  companyName: string;
  isPending: boolean;
  error: string | null;
  onResend: (trigger: HTMLElement | null) => void;
  onCancel: (trigger: HTMLElement | null) => void;
}) {
  const status = effectiveStatus(invite);
  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invite.name}</div>
          <div style={{ fontSize: 12, color: 'var(--t-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invite.email}</div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--t-500)', background: 'rgba(255,255,255,.06)', padding: '3px 10px', borderRadius: 999, fontWeight: 600, flexShrink: 0 }}>
          {ROLE_KIND_LABELS[invite.role_kind]}
        </span>
        {isSuperAdmin && (
          <span style={{ fontSize: 12.5, color: 'var(--t-500)', flexShrink: 0, minWidth: 110, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {companyName}
          </span>
        )}
        <InviteStatusBadge status={status} />
        <span style={{ fontSize: 11.5, color: 'var(--t-400)', flexShrink: 0 }}>Enviado {formatDate(invite.created_at)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--t-400)', flexShrink: 0 }}>Válido até {formatDate(invite.expires_at)}</span>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          {isPending ? (
            <span aria-live="polite" style={{ fontSize: 12, color: 'var(--t-500)' }}>Processando…</span>
          ) : (
            <>
              {canResend(status) && (
                <LBtn size="sm" kind="ghost" icon="send" aria-label={`Reenviar convite de ${invite.name}`}
                  onClick={() => onResend(document.activeElement as HTMLElement | null)}>Reenviar</LBtn>
              )}
              {canCancel(status) && (
                <LBtn size="sm" kind="ghost" icon="xCircle" aria-label={`Cancelar convite de ${invite.name}`}
                  onClick={() => onCancel(document.activeElement as HTMLElement | null)}>Cancelar</LBtn>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="alert" size={13} stroke={2.2} /> {error}
        </div>
      )}
    </div>
  );
}

function InviteStatusBadge({ status }: { status: InviteStatus }) {
  const neutral = status === 'canceled' || status === 'superseded';
  return (
    <LBadge tone={STATUS_TONE[status]} style={{ flexShrink: 0, ...(neutral ? NEUTRAL_BADGE_STYLE : {}) }}>
      {STATUS_LABEL[status]}
    </LBadge>
  );
}
