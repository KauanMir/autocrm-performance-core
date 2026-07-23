'use client';
// components/invites/InviteUserModal.tsx — modal real de convite (M1-F
// S4-F2). Único caminho de criação: POST /api/platform/invites via
// useCreateInvite (lib/hooks/useCreateInvite.ts) — nunca supabase.rpc
// direto, nunca Admin API no browser. A lista abaixo (ScreensBiz.tsx)
// continua mock nesta etapa — este modal NUNCA insere o convite criado
// nela; reenvio/cancelamento/listagem real ficam para o S4-F2 seguinte
// (fora de escopo aqui).
//
// `actor` chega pronto do chamador (ScreenAjustes) — resolvido a cada
// render a partir de currentUser.platformRole/activeMembership, nunca
// congelado na abertura do modal. Um Manager nunca vê seletor de
// função/empresa: o valor que sai é sempre actor.companyId (ver
// useCreateInvite — o hook ignora form.roleKind/companyId nesse caso,
// então mesmo um bug de UI aqui não conseguiria adulterar o payload real).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FField, FlowShell, FlowSuccess, Segmented } from '@/components/flows/FlowsShared';
import { useCompanies } from '@/lib/hooks/useCompanies';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import {
  useCreateInvite,
  getCreateInviteErrorMessage,
  EMAIL_PATTERN,
  type CreateInviteActor,
} from '@/lib/hooks/useCreateInvite';
import { ROLE_KIND_LABELS, type CreateInviteRoleKind } from '@/lib/invites/createInviteRequest';
import { AuthService } from '@/lib/services';

const ROLE_OPTIONS: [CreateInviteRoleKind, string][] = [
  ['seller', ROLE_KIND_LABELS.seller],
  ['manager', ROLE_KIND_LABELS.manager],
  ['super_admin', ROLE_KIND_LABELS.super_admin],
];

// Empresa "operacional" para convite — mesma regra de create_invite()
// (m1f_s4a2a): implantacao/ativa aceitas, suspensa/cancelada nunca (RLS já
// nem devolve cancelada). Filtro na UI é só conveniência/defesa em
// profundidade — quem decide de verdade é a RPC.
function isEligibleCompany(company: PlatformCompanyRow): boolean {
  return company.status === 'implantacao' || company.status === 'ativa';
}

function CompanyPicker({ companyId, onPick, companies, isLoading, isError }: {
  companyId: string | null;
  onPick: (id: string) => void;
  companies: readonly PlatformCompanyRow[];
  isLoading: boolean;
  isError: boolean;
}) {
  const [show, setShow] = useState(false);
  const selected = companies.find((c) => c.id === companyId) ?? null;
  return (
    <div style={{ position: 'relative', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Empresa</span>
      <button type="button" onClick={() => setShow((s) => !s)} disabled={isLoading}
        style={{
          width: '100%', padding: '13px 15px', borderRadius: 12, border: '1px solid var(--border)',
          fontFamily: 'inherit', fontSize: 15, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)',
          display: 'flex', alignItems: 'center', gap: 10, cursor: isLoading ? 'wait' : 'pointer', textAlign: 'left',
        }}>
        <Icon name="building" size={17} stroke={2} style={{ color: 'var(--t-400)' }} />
        <span style={{ flex: 1, color: selected ? 'var(--t-900)' : 'var(--t-400)' }}>
          {isLoading ? 'Carregando empresas…' : selected ? selected.name : 'Selecione a empresa…'}
        </span>
        <Icon name="arrowDown" size={16} stroke={2} style={{ color: 'var(--t-400)', transform: show ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {isError && !isLoading && (
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>Não foi possível carregar as empresas.</span>
      )}
      {!isLoading && !isError && companies.length === 0 && (
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--t-400)', marginTop: 6 }}>Nenhuma empresa disponível para convite no momento.</span>
      )}
      {show && !isLoading && companies.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 74, zIndex: 5, maxHeight: 240, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
          {companies.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c.id); setShow(false); }}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: '#fff', fontSize: 13.5 }}>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type InviteUserModalProps = {
  userId: string;
  actor: CreateInviteActor;
  onClose: () => void;
  onSent?: () => void;
};

export function InviteUserModal({ userId, actor, onClose, onSent }: InviteUserModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // 'seller' — default seguro (menor privilégio), nunca envia sozinho:
  // submit continua exigindo empresa selecionada para seller/manager.
  const [roleKind, setRoleKind] = useState<CreateInviteRoleKind>('seller');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ inviteId: string } | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const isSuperAdmin = actor.kind === 'super_admin';

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Super Admin só: Manager nunca precisa da lista de empresas (usa a
  // própria membership, ver §10 do design) — `authorized` aqui é
  // exclusivamente sobre buscar OU NÃO a listagem, nunca sobre permissão
  // de convidar (essa vem de `actor`, resolvido por quem abriu o modal).
  const companiesQuery = useCompanies({ userId, authorized: isSuperAdmin });
  const eligibleCompanies = React.useMemo(
    () => companiesQuery.companies.filter(isEligibleCompany),
    [companiesQuery.companies],
  );

  const getAccessToken = React.useCallback(async () => {
    const { data } = await AuthService.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const { createInvite, isPending } = useCreateInvite({
    userId,
    authorized: true,
    actor,
    getAccessToken,
  });

  // Contagem regressiva do rate limit — um único timer, limpo no cleanup;
  // só existe enquanto rateLimitedUntil não é null.
  useEffect(() => {
    if (rateLimitedUntil === null) return undefined;
    const id = setInterval(() => {
      if (Date.now() >= rateLimitedUntil) {
        setRateLimitedUntil(null);
      } else {
        forceTick((t) => t + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimitedUntil]);

  const nameIsBlank = name.trim() === '';
  const emailTrimmed = email.trim();
  const emailIsBlank = emailTrimmed === '';
  // Mesmo padrão (não exaustivo) usado em useCreateInvite — validação
  // client-side aqui é só UX (evita uma chamada óbvia fadada ao erro), a
  // validação que importa de verdade é a mesma regra dentro do hook.
  const emailIsInvalid = !emailIsBlank && !EMAIL_PATTERN.test(emailTrimmed);
  const companyRequired = isSuperAdmin && roleKind !== 'super_admin';
  const companyMissing = companyRequired && !companyId;
  const rateLimited = rateLimitedUntil !== null && Date.now() < rateLimitedUntil;
  const secondsLeft = rateLimited ? Math.max(1, Math.ceil((rateLimitedUntil! - Date.now()) / 1000)) : 0;
  const canSubmit = !isPending && !nameIsBlank && !emailIsBlank && !emailIsInvalid && !companyMissing && !rateLimited;

  const handlePickRole = (next: CreateInviteRoleKind) => {
    setRoleKind(next);
    if (next === 'super_admin') setCompanyId(null); // limpa a empresa — payload envia company_id=null
  };

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return; // guarda dupla contra clique duplo
    submittingRef.current = true;
    setLastError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await createInvite({ name, email, roleKind, companyId, signal: controller.signal });
      if (!isMountedRef.current) return;
      if (result.outcome === 'ok') {
        setSuccess({ inviteId: result.inviteId });
        onSent?.();
        return;
      }
      if (result.outcome === 'rate_limited') {
        setRateLimitedUntil(Date.now() + result.retryAfterSeconds * 1000);
      }
      setLastError(result);
    } catch (err) {
      if (isMountedRef.current) setLastError(err);
    } finally {
      submittingRef.current = false;
    }
  };

  if (success) {
    return (
      <FlowShell eyebrow="USUÁRIOS" title="Convite enviado" icon="users" accent="#27C75F" onClose={onClose}>
        <FlowSuccess
          icon="checkCircle"
          accent="#27C75F"
          title="Convite enviado"
          sub={`Um e-mail com as instruções de acesso foi enviado para ${email}.`}
          actions={<LBtn kind="primary" onClick={onClose}>Fechar</LBtn>}
        />
      </FlowShell>
    );
  }

  return (
    <FlowShell
      eyebrow="USUÁRIOS"
      title="Convidar usuário"
      sub="Envie um convite para uma pessoa acessar o AutoCRM."
      icon="users"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={isPending ? 'refresh' : 'send'} onClick={submit}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {isPending ? 'Enviando convite…' : rateLimited ? `Aguarde ${secondsLeft}s` : 'Enviar convite'}
          </LBtn>
        </>
      }
    >
      {lastError != null && (
        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          {getCreateInviteErrorMessage(lastError)}
        </div>
      )}

      <FField label="Nome" icon="user" placeholder="Nome completo" value={name} autoFocus
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
      <FField label="E-mail" icon="send" placeholder="pessoa@exemplo.com" type="email" value={email}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
      {emailIsInvalid && (
        <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>Informe um e-mail válido.</div>
      )}

      {isSuperAdmin ? (
        <>
          <div style={{ marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Função</span>
            <Segmented options={ROLE_OPTIONS} value={roleKind} onChange={handlePickRole} />
          </div>
          {companyRequired && (
            <CompanyPicker
              companyId={companyId}
              onPick={setCompanyId}
              companies={eligibleCompanies}
              isLoading={companiesQuery.isLoading}
              isError={companiesQuery.isError}
            />
          )}
        </>
      ) : (
        <>
          <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="user" size={14} stroke={2} /> Função: Vendedor
          </div>
          <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--t-500)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="building" size={14} stroke={2} /> Convite será enviado para a sua empresa atual.
          </div>
        </>
      )}
    </FlowShell>
  );
}
