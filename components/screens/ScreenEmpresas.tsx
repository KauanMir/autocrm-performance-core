'use client';
// components/screens/ScreenEmpresas.tsx — M1-F S3-B: interface mínima de
// empresas da KAPA. Global, sem empresa alvo (design §7.8) — lista as
// empresas visíveis via RLS (companies_select_accessible), cria novas
// exclusivamente via public.create_company() (S3-A) e ativa empresas em
// implantação via public.activate_company() (PLATFORM-COMPANY-ACTIVATION-A1).
// Sem seleção de empresa, sem convite, sem Manager/Seller, sem suspender/
// reativar/cancelar — fora de escopo deste lote (exigiriam RPCs próprias).
//
// Guarda de interface (conveniência/UX): App.tsx já impede este componente
// de renderizar para quem não é Super Admin com a flag ON (allowedNavIds +
// effectiveCurrent, guarda síncrona). O check abaixo é só defesa em
// profundidade — a autoridade real é sempre a RLS + is_platform_super_admin()
// no banco.
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { PageHead, LCard, LightScreen, LBtn, LBadge } from '@/components/ui/kit';
import { FField, FlowShell, FlowSuccess } from '@/components/flows/FlowsShared';
import { AuthService } from '@/lib/services';
import { isPlatformAdminEnabled } from '@/lib/flags';
import { canAccessPlatformAdmin } from '@/lib/capabilities';
import { useCompanies } from '@/lib/hooks/useCompanies';
import { useCreateCompany, getCreateCompanyErrorMessage } from '@/lib/hooks/useCreateCompany';
import { useActivateCompany, getActivateCompanyErrorMessage } from '@/lib/hooks/useActivateCompany';
import type { PlatformCompanyRow } from '@/lib/companies/repository';
import type { CreateCompanyInput } from '@/lib/companies/repository';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

// Estados exibidos: implantacao/ativa/suspensa — cancelada nunca aparece
// porque a RLS (can_access_company) já a omite, inclusive para Super Admin
// (design §7.4/§8). Nenhum filtro de canceladas é criado aqui: não há o que
// filtrar, o backend nunca devolve essa linha.
const STATUS_LABEL: Record<string, string> = {
  implantacao: 'Em implantação',
  ativa: 'Ativa',
  suspensa: 'Suspensa',
};
const STATUS_TONE: Record<string, string> = {
  implantacao: 'amber',
  ativa: 'green',
  suspensa: 'red',
};

function formatCreatedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Mecanismo NATIVO do navegador para listar timezones IANA — sem lista
// externa, sem rede. Intl.supportedValuesOf é suportado nos navegadores/
// Node atuais; navegadores antigos caem numa lista curta e conhecida (o
// campo continua sendo um <input> livre com sugestões — nunca bloqueia um
// valor fora da lista, o backend é quem valida de verdade, ver §8).
const FALLBACK_TIMEZONES = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Bahia', 'America/Fortaleza',
  'America/Belem', 'America/Recife', 'America/Cuiaba', 'America/Rio_Branco',
];
function listTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.('timeZone');
    if (Array.isArray(supported) && supported.length > 0) return supported;
  } catch {
    // Intl.supportedValuesOf ausente — cai no fallback abaixo.
  }
  return FALLBACK_TIMEZONES;
}

function CompanyRow({ company, onActivate, isActivating, justActivated }: {
  company: PlatformCompanyRow;
  onActivate: (company: PlatformCompanyRow) => void;
  isActivating: boolean;
  justActivated: boolean;
}) {
  // Ação só para 'implantacao' (§11 do EXEC): ativa não mostra (já ativa),
  // suspensa/cancelada não oferecem ativação neste lote (fora de escopo —
  // exigiriam uma RPC de reversão própria, nunca esta).
  const canActivate = company.status === 'implantacao';

  return (
    <LCard pad={16} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,.05)', display: 'grid', placeItems: 'center', flexShrink: 0, color: 'var(--t-500)' }}>
        <Icon name="building" size={19} stroke={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--t-900)' }}>{company.name}</span>
          {company.trade_name && (
            <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>({company.trade_name})</span>
          )}
          <LBadge tone={STATUS_TONE[company.status] || 'ink'}>{STATUS_LABEL[company.status] || company.status}</LBadge>
          {justActivated && (
            <span style={{ fontSize: 12.5, color: '#27C75F', fontWeight: 600 }}>Empresa ativada.</span>
          )}
        </div>
        <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--t-500)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {company.cnpj && <span>CNPJ: {company.cnpj}</span>}
          {company.phone && <span>{company.phone}</span>}
          <span>{company.timezone}</span>
          <span>Criada em {formatCreatedAt(company.created_at)}</span>
        </div>
      </div>
      {canActivate && (
        <LBtn
          kind="gold"
          icon={isActivating ? 'refresh' : 'checkCircle'}
          onClick={() => onActivate(company)}
          style={{ flexShrink: 0, opacity: isActivating ? 0.6 : 1, cursor: isActivating ? 'not-allowed' : 'pointer' }}
        >
          {isActivating ? 'Ativando…' : 'Ativar empresa'}
        </LBtn>
      )}
    </LCard>
  );
}

function CreateCompanyModal({ userId, onClose, onCreated }: {
  userId: string; onClose: () => void; onCreated: (company: PlatformCompanyRow) => void;
}) {
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [success, setSuccess] = useState<PlatformCompanyRow | null>(null);
  const timezones = React.useMemo(listTimezones, []);

  const { createCompany, isPending, error, reset } = useCreateCompany({ userId, authorized: true });

  // Trim só para VALIDAR (nome obrigatório/em branco) — o valor enviado é
  // exatamente o que o usuário digitou, sem normalização oculta.
  const nameIsBlank = name.trim() === '';

  const submit = async () => {
    if (isPending || nameIsBlank) return; // impede envio duplicado / nome em branco
    reset();
    const input: CreateCompanyInput = {
      name,
      tradeName: tradeName || undefined,
      cnpj: cnpj || undefined,
      phone: phone || undefined,
      timezone: timezone || undefined,
    };
    try {
      const created = await createCompany(input);
      setSuccess(created);
      onCreated(created);
    } catch {
      // erro mapeado abaixo via getCreateCompanyErrorMessage — campos
      // preenchidos permanecem intactos (nenhum reset em caso de erro).
    }
  };

  if (success) {
    return (
      <FlowShell eyebrow="EMPRESAS" title="Empresa criada" icon="building" accent="#27C75F" onClose={onClose}>
        <FlowSuccess
          icon="checkCircle"
          accent="#27C75F"
          title="Empresa criada com sucesso"
          sub={`"${success.name}" foi criada e já aparece na listagem, em implantação.`}
          actions={<LBtn kind="primary" onClick={onClose}>Fechar</LBtn>}
        />
      </FlowShell>
    );
  }

  return (
    <FlowShell
      eyebrow="EMPRESAS"
      title="Criar empresa"
      sub="Só o nome é obrigatório. A empresa nasce em implantação, com as 5 etapas padrão do funil já criadas."
      icon="building"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={isPending ? 'refresh' : 'plus'} onClick={submit} style={{ marginLeft: 'auto', opacity: isPending || nameIsBlank ? 0.6 : 1, cursor: isPending || nameIsBlank ? 'not-allowed' : 'pointer' }}>
            {isPending ? 'Criando…' : 'Criar empresa'}
          </LBtn>
        </>
      }
    >
      {error != null && (
        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          {getCreateCompanyErrorMessage(error)}
        </div>
      )}
      <FField label="Nome" icon="building" placeholder="Nome da empresa" value={name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
      {nameIsBlank && name.length > 0 && (
        <div style={{ marginTop: -8, marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>O nome não pode ficar em branco.</div>
      )}
      <FField label="Nome fantasia (opcional)" icon="star" placeholder="Nome comercial" value={tradeName}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTradeName(e.target.value)} />
      <FField label="CNPJ (opcional)" icon="doc" placeholder="00.000.000/0001-00" value={cnpj}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCnpj(e.target.value)} />
      <FField label="Telefone (opcional)" icon="phone" placeholder="(11) 3000-0000" value={phone}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)} />
      <FField label="Fuso horário" icon="clock" list="s3b-timezones" value={timezone}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimezone(e.target.value)}
        hint="Default: America/Sao_Paulo. Lista sugerida pelo próprio navegador." />
      <datalist id="s3b-timezones">
        {timezones.map((tz) => <option key={tz} value={tz} />)}
      </datalist>
    </FlowShell>
  );
}

export function ScreenEmpresas() {
  const currentUser = AuthService.getCurrentUser();
  const authorized = isPlatformAdminEnabled() && canAccessPlatformAdmin(currentUser);
  const [modalOpen, setModalOpen] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [justActivatedId, setJustActivatedId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<unknown>(null);

  const { companies, isLoading, isError, error, isEmpty, hasData, refetch } = useCompanies({
    userId: currentUser?.id ?? null,
    authorized,
  });

  const { activateCompany } = useActivateCompany({
    userId: currentUser?.id ?? null,
    authorized,
  });

  // Defesa em profundidade — App.tsx já não renderiza este componente para
  // quem não é autorizado (guarda síncrona em allowedNavIds/effectiveCurrent).
  if (!authorized) return null;

  const performActivate = async (company: PlatformCompanyRow) => {
    setActivatingId(company.id);
    setJustActivatedId(null);
    setActivateError(null);
    try {
      await activateCompany(company.id);
      setJustActivatedId(company.id);
      refetch();
    } catch (err) {
      setActivateError(err);
    } finally {
      setActivatingId(null);
    }
  };

  const handleActivateClick = (company: PlatformCompanyRow) => {
    (window as { __openFlow?: (name: string, payload: unknown) => void }).__openFlow?.('confirmar', {
      title: 'Ativar esta empresa?',
      message: 'Após a ativação, os usuários da empresa poderão utilizar os módulos comerciais.',
      confirmLabel: 'Ativar empresa',
      cancelLabel: 'Cancelar',
      tone: 'gold',
      icon: 'checkCircle',
      onConfirm: () => { void performActivate(company); },
    });
  };

  return (
    <LightScreen>
      <PageHead
        title="Empresas"
        sub="Lista global das empresas da plataforma. Nenhuma seleção — apenas cadastro."
        actions={<LBtn kind="gold" icon="plus" onClick={() => setModalOpen(true)}>Criar empresa</LBtn>}
      />

      {activateError != null && (
        <div style={{ marginBottom: 10, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          {getActivateCompanyErrorMessage(activateError)}
        </div>
      )}

      {isLoading && (
        <LCard style={{ display: 'grid', placeItems: 'center', height: 200, color: 'var(--t-400)' }}>
          Carregando empresas…
        </LCard>
      )}

      {!isLoading && isError && (
        <LCard style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, height: 200, justifyContent: 'center', color: 'var(--t-500)' }}>
          <Icon name="wifiOff" size={26} stroke={2} />
          <span>Não foi possível carregar as empresas.</span>
          <LBtn kind="ghost" icon="refresh" onClick={() => refetch()}>Tentar novamente</LBtn>
        </LCard>
      )}

      {!isLoading && !isError && isEmpty && (
        <LCard style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, height: 200, justifyContent: 'center', color: 'var(--t-500)' }}>
          <Icon name="inbox" size={26} stroke={2} />
          <span>Nenhuma empresa cadastrada ainda.</span>
        </LCard>
      )}

      {!isLoading && !isError && hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {companies.map((c) => (
            <CompanyRow
              key={c.id}
              company={c}
              onActivate={handleActivateClick}
              isActivating={activatingId === c.id}
              justActivated={justActivatedId === c.id}
            />
          ))}
        </div>
      )}

      {modalOpen && currentUser && (
        <CreateCompanyModal
          userId={currentUser.id}
          onClose={() => setModalOpen(false)}
          onCreated={() => refetch()}
        />
      )}
    </LightScreen>
  );
}
