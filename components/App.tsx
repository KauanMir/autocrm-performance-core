'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { NAV, Avatar, PageHead, LCard, LBtn, LightScreen } from '@/components/ui/kit';
import { useViewport } from '@/lib/hooks/useViewport';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton } from '@/components/ui/TweaksPanel';
import { NAV_ROLES, TASK_STATE } from '@/lib/data';
import type { User } from '@/lib/data';
import { isRemoteStagesEnabled, isPlatformAdminEnabled, isSuperAdminCommercialReadEnabled } from '@/lib/flags';
import { canAccessStageSettings, canAccessPlatformAdmin, canManageInvites, canAccessCommercialWorkspace } from '@/lib/capabilities';
import { isLocalCommercialDataAllowed } from '@/lib/leads/localCommercialAccess';
import { useQueryCacheIdentity } from '@/lib/hooks/useQueryCacheIdentity';
import { useLeadsRemoteBridgeLifecycle } from '@/lib/hooks/useLeadsRemoteBridgeLifecycle';
import { useTasksRemoteBridgeLifecycle } from '@/lib/hooks/useTasksRemoteBridgeLifecycle';
import { useRemoteTasksScreenState } from '@/lib/hooks/useRemoteTasksScreenState';
import { CompanyLogo } from '@/components/company/CompanyLogo';
import { CommercialCompanyProvider } from '@/lib/commercial/CommercialCompanyContext';
import {
  OperationalCompanyProvider,
  useOperationalCompanyContext,
  type OperationalCompanyMode,
} from '@/lib/operational/OperationalCompanyContext';
import { subscribeStore } from '@/lib/store';
import { AuthService, SellerService, TaskService } from '@/lib/services';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { AuthenticatedShellErrorBoundary } from '@/components/errors/AuthenticatedShellErrorBoundary';
import { Home } from '@/components/screens/Home';
import { ScreenClientes, ScreenAndamento, ScreenPendencias } from '@/components/screens/ScreensOps';
import { ScreenVisitas, ScreenPropostas, ScreenVendas, ScreenResultados, ScreenAjustes } from '@/components/screens/ScreensBiz';
import { ScreenEmpresas } from '@/components/screens/ScreenEmpresas';
import { FlowLayer } from '@/components/flows/FlowLayer';

const TWEAK_DEFAULTS = {
  podium: 'D',
  anim: true,
};

// M1-D (commit 8): navegação efetiva. Base = lista de nav ids por ator; o
// manager ganha 'ajustes' SOMENTE com a flag remota ON (e dentro da tela vê
// apenas a aba Etapas — ver ScreenAjustes). Com a flag OFF a lista é
// idêntica ao legado. A combinação capability×flag mora aqui, nunca em
// lib/capabilities.
//
// M1-F S8-D1: a base NÃO é mais indexada por `user.role` legado
// (`NAV_ROLES[user.role]`, achado do S8-D-A0) — `platformRole`/
// `activeMembership.role` são agora a ÚNICA fonte da identidade que decide
// qual lista de `NAV_ROLES` usar. `NAV_ROLES` continua existindo como DADO
// puro (as três listas por papel), só a forma de ESCOLHER a lista mudou.
// Contrato preservado exatamente: Super Admin usa a lista de `admin` (sem
// os ids comerciais, que voltam só via capability+flag, como antes);
// Manager usa a lista de `manager`; Seller usa a lista de `seller`; um
// usuário autenticado sem `platformRole` e sem `activeMembership` (ex.:
// membership suspensa/desligada, cuja `profiles.role` legada nunca é
// limpa) não recebe mais nenhum id empresarial — apenas `'home'`, nunca
// inferido do cargo legado que já não descreve o estado real.
//
// M1-F S4-F1: canManageInvites (Super Admin OU Manager com membership
// ATIVA) também libera 'ajustes', SEM depender de nenhuma flag — diferente
// de canAccessStageSettings, a superfície de convites/Usuários não está
// atrás de NEXT_PUBLIC_FF_REMOTE_STAGES nem de NEXT_PUBLIC_FF_PLATFORM_ADMIN
// (essa é especificamente a área global da KAPA, ScreenEmpresas — convites
// são uma ação DE EMPRESA, não de plataforma). Dentro da tela, ScreenAjustes
// decide sozinha quais abas mostrar (Empresa/Etapas continuam exigindo seus
// próprios guards — ver allowedTabs em ScreensBiz.tsx).
//
// M1-F S3-B: 'empresas' segue o mesmo molde — só entra com
// NEXT_PUBLIC_FF_PLATFORM_ADMIN ON E platformRole === 'super_admin'
// (canAccessPlatformAdmin) — a entrada é adicionada normalmente, sem
// depender de `base`.
// M1-F S8-C2-B2: ids comerciais (Clientes/Andamento). Super Admin NUNCA os
// recebe da base (retirados explicitamente) — só voltam via
// canAccessCommercialWorkspace + a flag de leitura comercial. Manager/
// Seller continuam recebendo-os exatamente como sempre (fazem parte da
// própria lista de `NAV_ROLES.manager`/`NAV_ROLES.seller`, sem nenhuma
// capability nova envolvida — nenhuma mudança de comportamento).
const COMMERCIAL_NAV_IDS = ['clientes', 'andamento'];

// COMMERCIAL-REMOTE-FINAL-AUDIT-A1-R1 — achado real da auditoria: o filtro
// acima só cobria Clientes/Andamento. 'pendencias'/'visitas'/'propostas'/
// 'vendas'/'resultados' vêm de NAV_ROLES.admin (mesmo array usado pelo
// legado local, onde AuthService.isManager() retorna true para Super
// Admin) e passavam direto para a base do Super Admin — diferente de
// Clientes/Andamento, esses cinco não têm NENHUM caminho de re-concessão
// (Tasks/Visits/Deals/Sales/Results negam Super Admin por construção no
// RLS, sem RPC equivalente — auditoria FINAL-AUDIT-A1, §2/§3). Union com
// COMMERCIAL_NAV_IDS porque a exclusão aqui é permanente (nunca reaparece
// via capability+flag, ao contrário de clientes/andamento) — nenhum re-add
// mais abaixo os devolve.
const SUPER_ADMIN_OPERATIONAL_NAV_IDS = [...COMMERCIAL_NAV_IDS, 'pendencias', 'visitas', 'propostas', 'vendas', 'resultados'];

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC / V2A-READ-B1-EXEC — dentro do
// contexto operacional explícito (/company/[id]), a lista de nav ids do
// Super Admin é COMPLETAMENTE diferente da lista genérica acima: só as
// superfícies com contrato real pronto — nunca 'empresas' (a ação
// "Voltar para Empresas" do Rail cobre essa navegação, nunca duplicada
// como item de nav). Cada superfície continua atrás da PRÓPRIA
// capability+flag — nunca um hardcode que ignore
// isSuperAdminCommercialReadEnabled/canManageInvites/etc.
//
// V2A-READ (SUPER-ADMIN-COMPANY-CONTEXT-V2A-READ-B1-EXEC §23): Pendências/
// Visitas/Negociações entram company-wide READ ONLY, atrás da MESMA flag
// de leitura comercial já usada por Clientes/Andamento (nenhuma flag nova
// — a autorização real é list_platform_tasks_for_company/
// list_platform_visits_for_company/list_platform_deals_for_company, todas
// SECURITY DEFINER).
// V2B-READ (SUPER-ADMIN-COMPANY-CONTEXT-V2B-READ-B1-EXEC §19): Vendas/
// Resultados entram na MESMA lista, atrás da MESMA flag (nenhuma flag
// nova) — autorização real é list_platform_sales_for_company (SECURITY
// DEFINER, reaproveita _resolve_commercial_read_company do V2A). Usuários/
// Convites continuam fora da operação da empresa (nunca entram nesta
// lista).
function operationalSuperAdminNavIds(user: User): string[] {
  const ids = ['home'];
  if (isSuperAdminCommercialReadEnabled() && canAccessCommercialWorkspace(user)) {
    ids.push('clientes', 'andamento', 'pendencias', 'visitas', 'propostas', 'vendas', 'resultados');
  }
  if (canManageInvites(user) || (isRemoteStagesEnabled() && canAccessStageSettings(user))) {
    ids.push('ajustes');
  }
  return ids;
}

function allowedNavIds(user: User | null, operationalMode: OperationalCompanyMode = 'none'): string[] {
  if (!user) return [];
  const isSuperAdmin = user.platformRole === 'super_admin';
  const membershipRole = user.activeMembership?.role ?? null;

  if (isSuperAdmin && operationalMode === 'super_admin') {
    return operationalSuperAdminNavIds(user);
  }

  const base = isSuperAdmin
    ? NAV_ROLES.admin.filter((id) => !SUPER_ADMIN_OPERATIONAL_NAV_IDS.includes(id))
    : membershipRole === 'manager'
      ? NAV_ROLES.manager
      : membershipRole === 'seller'
        ? NAV_ROLES.seller
        // Nem Super Admin, nem membership ativa (ex.: suspenso/desligado):
        // nenhum id empresarial — nunca inferido de `user.role` legado.
        : ['home'];

  let ids = [...base];
  if (
    isSuperAdmin &&
    isSuperAdminCommercialReadEnabled() &&
    canAccessCommercialWorkspace(user)
  ) {
    ids = [...ids, ...COMMERCIAL_NAV_IDS];
  }
  if (!ids.includes('ajustes') && (
    (isRemoteStagesEnabled() && canAccessStageSettings(user)) || canManageInvites(user)
  )) {
    ids = [...ids, 'ajustes'];
  }
  if (isPlatformAdminEnabled() && canAccessPlatformAdmin(user)) {
    ids = [...ids, 'empresas'];
  }
  return ids;
}

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: 28 }}>
      <PageHead title={title} sub="Tela em construção." />
      <LCard style={{ display: 'grid', placeItems: 'center', height: 320, color: 'var(--t-400)' }}>Em breve</LCard>
    </div>
  );
}

function PlaceholderScreen({ title }: { title: string }) {
  return <LightScreen><Placeholder title={title} /></LightScreen>;
}

// MOBILE-RESPONSIVENESS-V1-B1-EXEC §9 — modelo do Rail (dados + derivações)
// extraído para ser reaproveitado IDÊNTICO por dois hosts: o <aside> de
// 236px do desktop (>= lg) e o <MobileDrawer> off-canvas (< lg). Nenhuma
// regra de permissão nova: mesma allowedNavIds / mesmo operational context /
// mesmo useRemoteTasksScreenState de sempre. Só nunca roda os dois hosts ao
// mesmo tempo (App() monta um OU o outro por viewport).
interface RailModel {
  operational: ReturnType<typeof useOperationalCompanyContext>;
  allowedIds: string[];
  isOperationalSuperAdmin: boolean;
  seller: ReturnType<typeof SellerService.getById> | null;
  displayTeam: string;
  lateTasks: number | null;
}

function useRailModel(currentUser: User): RailModel {
  // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — fonte ÚNICA de empresa
  // operacional/identidade. Manager/Seller: mode==='membership',
  // comportamento inalterado. Super Admin sem /company/[id]: mode==='none'.
  const operational = useOperationalCompanyContext();
  const allowedIds = allowedNavIds(currentUser, operational.mode);
  const isOperationalSuperAdmin = operational.mode === 'super_admin';
  // M1-E E7-A1: SellerService lê catálogo LOCAL — fora do modo local nunca
  // é consultado aqui.
  const remoteMode = !isLocalCommercialDataAllowed();
  const seller = !remoteMode && currentUser.activeMembership?.sellerId
    ? SellerService.getById(currentUser.activeMembership.sellerId)
    : null;
  const displayTeam = seller?.team
    ? `Vendedor · ${seller.team}`
    : currentUser.platformRole === 'super_admin'
      ? 'Administrador'
      : currentUser.activeMembership?.role === 'seller'
        ? 'Vendedor'
        : 'Gerente';
  // COMMERCIAL-REMOTE-B1-B3-B: badge de Pendências usa a fonte de verdade
  // PRÓPRIA de Tasks. Chamado INCONDICIONALMENTE (Rules of Hooks).
  const remoteTasksScreen = useRemoteTasksScreenState(currentUser);
  const tasksActiveReady =
    remoteTasksScreen.mode === 'task_remote_active'
    && !remoteTasksScreen.isLoading
    && !remoteTasksScreen.isError
    && remoteTasksScreen.configError === null;
  const lateTasks =
    remoteTasksScreen.mode === 'task_local'
      ? TaskService.getAll().filter((t: any) => t.state === TASK_STATE.LATE).length
      : tasksActiveReady
        ? remoteTasksScreen.tasks.filter((t) => t.state === TASK_STATE.LATE).length
        : null;

  return { operational, allowedIds, isOperationalSuperAdmin, seller, displayTeam, lateTasks };
}

// Conteúdo interno compartilhado do Rail. `layout` só ajusta o alvo de
// toque dos itens de nav (>= 48px no drawer, §12) e mostra o botão fechar
// (drawer). Todo o resto é pixel-idêntico ao Rail original.
function RailInner({ layout, model, currentUser, current, onNavigate, onClose }: {
  layout: 'rail' | 'drawer';
  model: RailModel;
  currentUser: User;
  current: string;
  onNavigate: (id: string) => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const { operational, allowedIds, isOperationalSuperAdmin, seller, displayTeam, lateTasks } = model;
  const navPad = layout === 'drawer' ? '14px 13px' : '11px 13px';
  return (
    <>
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .35, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 1, background: 'linear-gradient(180deg, transparent, rgba(212,175,55,.18), transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 220, background: 'radial-gradient(120% 70% at 30% 100%, rgba(193,18,31,.10), transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '22px 22px 20px' }}>
        <div className="sheen" style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(150deg,#E8CE72,#C9A227)', display: 'grid', placeItems: 'center', boxShadow: '0 8px 20px -6px rgba(212,175,55,.6), inset 0 1px 0 rgba(255,255,255,.4)' }}>
          <Icon name="car" size={23} stroke={2.2} style={{ color: '#2a2104' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="display" style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '.05em', lineHeight: 1 }}>KAPA CRM</div>
          <div style={{ fontSize: 9.5, color: 'var(--gold-ink)', letterSpacing: '.22em', marginTop: 4, fontWeight: 700, opacity: .8 }}>PERFORMANCE</div>
        </div>
        {layout === 'drawer' && onClose && (
          <button onClick={onClose} aria-label="Fechar navegação" className="focus-ring" style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--txt-mid)', flexShrink: 0 }}>
            <Icon name="x" size={19} stroke={2.2} />
          </button>
        )}
      </div>

      {operational.identity.status === 'ready' && (
        <div style={{ position: 'relative', padding: '0 22px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CompanyLogo name={operational.identity.company.name} logoPath={operational.identity.company.logoPath} size={30} />
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--txt-mid)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {operational.identity.company.name}
            </div>
          </div>
          {/* SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC §16 — badge próprio, nunca
              reaproveita "Gerente"/"Administrador" (identidade falsa). */}
          {isOperationalSuperAdmin && (
            <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: '#5B9BFF', background: 'rgba(59,130,246,.14)', border: '1px solid rgba(59,130,246,.4)', padding: '3px 9px', borderRadius: 999 }}>
              <Icon name="eye" size={11} stroke={2.4} /> VISUALIZANDO COMO SUPER ADMIN
            </div>
          )}
          {isOperationalSuperAdmin && operational.isReadOnly && (
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: '#E8CE72', background: 'rgba(212,175,55,.12)', border: '1px solid rgba(212,175,55,.35)', padding: '3px 9px', borderRadius: 999, marginLeft: 8 }}>
              <Icon name="lock" size={11} stroke={2.4} /> EMPRESA SUSPENSA · SOMENTE LEITURA
            </div>
          )}
          {isOperationalSuperAdmin && (
            <button
              onClick={() => { router.push('/'); onClose?.(); }}
              className="focus-ring"
              style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 9, border: '1px solid var(--line-dark, rgba(255,255,255,.08))', background: 'transparent', color: 'var(--txt-mid)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <Icon name="arrowLeft" size={13} stroke={2.2} /> Voltar para Empresas
            </button>
          )}
        </div>
      )}

      <nav style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '6px 14px' }}>
        {(NAV as any[]).filter((item: any) => allowedIds.includes(item.id)).map((item: any) => {
          const on = current === item.id;
          const badge = item.id === 'pendencias' ? lateTasks : 0;
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: navPad, marginBottom: 4,
              borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', border: '1px solid transparent', transition: 'all .2s cubic-bezier(.2,.7,.2,1)',
              background: on ? 'linear-gradient(90deg,rgba(212,175,55,.18),rgba(212,175,55,.02))' : 'transparent',
              color: on ? '#fff' : 'var(--txt-mid)',
              borderColor: on ? 'rgba(212,175,55,.28)' : 'transparent',
              boxShadow: on ? 'inset 0 1px 0 rgba(255,255,255,.05), 0 8px 22px -12px rgba(212,175,55,.5)' : 'none', position: 'relative',
            }}
              onMouseEnter={(e: any) => { if (!on) { e.currentTarget.style.background = 'rgba(255,255,255,.04)'; e.currentTarget.style.color = '#fff'; } }}
              onMouseLeave={(e: any) => { if (!on) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--txt-mid)'; } }}>
              {on && <span style={{ position: 'absolute', left: -1, top: '50%', transform: 'translateY(-50%)', width: 3, height: 22, borderRadius: 3, background: 'linear-gradient(180deg,#E8CE72,#C9A227)', boxShadow: '0 0 12px 1px rgba(212,175,55,.7)' }} />}
              <Icon name={item.icon} size={19} stroke={on ? 2.2 : 2} style={{ color: on ? '#E8CE72' : 'var(--txt-lo)', filter: on ? 'drop-shadow(0 0 6px rgba(212,175,55,.5))' : 'none' }} />
              <span style={{ fontSize: 14, fontWeight: on ? 700 : 500, flex: 1, letterSpacing: '.01em' }}>{item.label}</span>
              {typeof badge === 'number' && badge > 0 && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'linear-gradient(180deg,#FF4242,#D81F2C)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center', fontFamily: 'Archivo, sans-serif', boxShadow: '0 0 10px -1px rgba(255,46,46,.7)', animation: on ? 'none' : 'breatheSoft 2.6s ease-in-out infinite' }}>{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ position: 'relative', padding: '12px 14px 16px' }}>
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent)', marginBottom: 10 }} />
        <div className="lift" onClick={() => { if (seller && (window as any).__openFlow) { (window as any).__openFlow('perfil-vendedor', { seller }); onClose?.(); } }} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 12, cursor: 'pointer', border: '1px solid transparent' }}>
          <Avatar name={currentUser.name} size={36} ring="#3B82F6" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.name}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{displayTeam}</div>
          </div>
          <button onClick={(e: any) => { e.stopPropagation(); (window as any).__openFlow && (window as any).__openFlow('confirmar', { title: 'Sair do sistema?', message: 'Você precisará entrar novamente para acessar seu painel de performance.', confirmLabel: 'Sair', tone: 'danger', icon: 'logout', onConfirm: () => AuthService.logout() }); onClose?.(); }} className="focus-ring" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--txt-lo)' }} title="Sair">
            <Icon name="logout" size={17} stroke={2} />
          </button>
        </div>
      </div>
    </>
  );
}

// Desktop (>= lg) — casca <aside> de 236px, inalterada.
function Rail({ current, go, currentUser }: { current: string; go: (id: string) => void; currentUser: User }) {
  const model = useRailModel(currentUser);
  return (
    <aside style={{ width: 236, flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: 'linear-gradient(180deg,#0b0b0c,#070708)', borderRight: '1px solid rgba(255,255,255,.06)' }}>
      <RailInner layout="rail" model={model} currentUser={currentUser} current={current} onNavigate={go} />
    </aside>
  );
}

// MOBILE-RESPONSIVENESS-V1-B1-EXEC §6/§7/§11 — cabeçalho mobile (< lg).
// Hambúrguer + título da área atual (vindo de NAV, §7 — sem mapa novo, sem
// id técnico) + contexto Super Admin COMPACTO (§11 — nunca os blocos
// grandes empilhados do Rail).
function MobileHeader({ title, onOpenNav }: { title: string; onOpenNav: () => void }) {
  const operational = useOperationalCompanyContext();
  const ctx =
    operational.mode === 'super_admin' && operational.identity.status === 'ready'
      ? { name: operational.identity.company.name, readOnly: operational.isReadOnly }
      : null;
  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
        paddingBottom: 10,
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(10,10,11,.92)', backdropFilter: 'blur(10px)',
        position: 'sticky', top: 0, zIndex: 20,
      }}
    >
      <button
        onClick={onOpenNav}
        aria-label="Abrir navegação"
        aria-haspopup="dialog"
        className="focus-ring"
        style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)', flexShrink: 0 }}
      >
        <Icon name="list" size={20} stroke={2.2} />
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="display" style={{ fontSize: 16, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {ctx && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: '.02em', color: '#5B9BFF', overflow: 'hidden' }}>
            <Icon name="eye" size={10} stroke={2.4} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              SUPER ADMIN · {ctx.name}
            </span>
            {ctx.readOnly && <Icon name="lock" size={10} stroke={2.4} style={{ flexShrink: 0, color: '#E8CE72' }} />}
          </div>
        )}
      </div>
      {/* MOBILE-RESPONSIVENESS-V1-B2-EXEC §26/§27 — acesso à busca global
          (o TopBar/⌘K some < lg no B1). Reusa o MESMO FlowBusca via o
          handler existente __openFlow; nenhuma segunda busca. */}
      <button
        onClick={() => (window as any).__openFlow && (window as any).__openFlow('busca')}
        aria-label="Buscar"
        className="focus-ring"
        style={{ width: 40, height: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.04)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--t-700)', flexShrink: 0 }}
      >
        <Icon name="search" size={18} stroke={2.2} />
      </button>
    </header>
  );
}

// MOBILE-RESPONSIVENESS-V1-B1-EXEC §8-§15 — Drawer off-canvas pela esquerda.
// Só montado quando < lg. Scrim + painel translúcido; não empurra a página.
// Foco preso enquanto aberto, ESC/scrim/clique-em-nav/botão fecham, foco
// restaurado ao elemento que abriu. Fundo não fica navegável (§14).
function MobileDrawer({ currentUser, current, go, open, onClose }: {
  currentUser: User;
  current: string;
  go: (id: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const model = useRailModel(currentUser);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    // O painel só está montado-e-visível quando `open` (guard acima), então
    // não é preciso filtrar por visibilidade aqui — só por elementos que
    // realmente aceitam foco.
    const focusables = (): HTMLElement[] => {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
      );
    };
    // Foco inicial: primeiro focável do painel (botão fechar).
    const initial = focusables()[0];
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) return;
      const idx = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && idx <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && idx === f.length - 1) { e.preventDefault(); f[0].focus(); }
      else if (idx === -1) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const r = restoreRef.current;
      if (r && typeof r.focus === 'function') r.focus();
    };
  }, [open, onClose]);

  return (
    <>
      <div
        data-testid="mobile-drawer-scrim"
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,.55)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity .22s ease',
        }}
      />
      <div
        ref={panelRef}
        data-testid="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navegação"
        style={{
          position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 41,
          width: 'min(86vw, 320px)',
          display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg,#0b0b0c,#070708)',
          borderRight: '1px solid rgba(255,255,255,.08)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          transform: open ? 'translateX(0)' : 'translateX(-104%)',
          transition: 'transform .26s cubic-bezier(.2,.7,.2,1)',
          visibility: open ? 'visible' : 'hidden',
          overscrollBehavior: 'contain',
          boxShadow: open ? '0 0 60px -10px rgba(0,0,0,.8)' : 'none',
        }}
      >
        <RailInner
          layout="drawer"
          model={model}
          currentUser={currentUser}
          current={current}
          onNavigate={(id: string) => { go(id); onClose(); }}
          onClose={onClose}
        />
      </div>
    </>
  );
}

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC §39/§40 — telas do "gate" operacional:
// nunca um frame da empresa anterior, nunca um fallback silencioso para
// outra empresa. Mostradas SOMENTE quando hasOperationalCompanyId (Super
// Admin chegou via /company/[id]) — Manager/Seller/Super Admin genérico
// nunca passam por aqui.
function OperationalLoadingScreen() {
  return (
    <div style={{ height: 'var(--app-vh)', display: 'grid', placeItems: 'center', background: '#0a0a0b', color: 'var(--t-500, #8b8b93)', fontSize: 14 }}>
      Carregando empresa…
    </div>
  );
}

function OperationalAccessDeniedScreen({ isError, onRetry }: { isError: boolean; onRetry?: () => void }) {
  const router = useRouter();
  return (
    <div style={{ height: 'var(--app-vh)', display: 'grid', placeItems: 'center', background: '#0a0a0b' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.05)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--t-500, #8b8b93)' }}>
          <Icon name="building" size={22} stroke={2} />
        </div>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
          Empresa não encontrada ou sem acesso
        </div>
        <div style={{ color: 'var(--t-500, #8b8b93)', fontSize: 13.5, marginBottom: 22, lineHeight: 1.5 }}>
          {isError
            ? 'Não foi possível carregar esta empresa agora.'
            : 'Verifique o link ou volte para a lista de empresas.'}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          {isError && onRetry && <LBtn kind="ghost" icon="refresh" onClick={onRetry}>Tentar novamente</LBtn>}
          <LBtn kind="gold" icon="arrowLeft" onClick={() => router.push('/')}>Voltar para Empresas</LBtn>
        </div>
      </div>
    </div>
  );
}

// SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — corpo autenticado real, montado
// DENTRO de OperationalCompanyProvider (precisa consumir
// useOperationalCompanyContext, impossível no mesmo componente que monta o
// Provider). Recebe todo o estado de App() por prop/setter — nenhum estado
// próprio novo além do que já existia, só passou a viver um nível abaixo.
function AuthenticatedApp({
  currentUser, current, setCurrent, navParams, setNavParams, t, setTweak,
  animKey, setAnimKey, flow, openFlow, closeFlow, isDevPreview, hasOperationalCompanyId,
}: {
  currentUser: User;
  current: string;
  setCurrent: (v: string) => void;
  navParams: any;
  setNavParams: (v: any) => void;
  t: any;
  setTweak: (k: string, v: any) => void;
  animKey: number;
  setAnimKey: React.Dispatch<React.SetStateAction<number>>;
  flow: { id: string; payload: any } | null;
  openFlow: (id: string, payload?: any) => void;
  closeFlow: () => void;
  isDevPreview: boolean;
  hasOperationalCompanyId: boolean;
}) {
  const operational = useOperationalCompanyContext();
  // MOBILE-RESPONSIVENESS-V1-B1-EXEC §5/§8 — abaixo de `lg` o Rail vira
  // Drawer. `isDesktop` (>= 1024) é a única chave que troca shell desktop x
  // shell mobile.
  const { isDesktop } = useViewport();
  const [navOpen, setNavOpen] = useState(false);
  // Drawer nunca sobrevive a uma troca de viewport para desktop.
  useEffect(() => { if (isDesktop) setNavOpen(false); }, [isDesktop]);

  const go = (id: string, params: any = null) => {
    const allowed = allowedNavIds(currentUser, operational.mode);
    if (!allowed.includes(id)) return;
    setCurrent(id);
    setNavParams(params);
    setNavOpen(false); // §13 — navegar fecha o Drawer
    document.querySelector('#scroll-host')?.scrollTo(0, 0);
  };

  useEffect(() => {
    const allowed = allowedNavIds(currentUser, operational.mode);
    if (!allowed.includes(current)) setCurrent('home');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, current, operational.mode]);

  // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC §11 — Super Admin SEM contexto de
  // empresa (mode==='none') nunca deve pousar numa Home comercial vazia:
  // Empresas é a superfície inicial preferida. Guard `current === 'home'`
  // evita disparar de novo depois que o próprio redirecionamento já rodou
  // (ou se o usuário navegou manualmente de volta para Home).
  useEffect(() => {
    if (currentUser.platformRole !== 'super_admin' || operational.mode !== 'none') return;
    if (current !== 'home') return;
    const allowed = allowedNavIds(currentUser, operational.mode);
    if (allowed.includes('empresas')) setCurrent('empresas');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, operational.mode]);

  useEffect(() => { if (current === 'home') setAnimKey((k) => k + 1); }, [current, t.podium, setAnimKey]);

  // §39/§40 do EXEC — enquanto a empresa da URL ainda está carregando/
  // indisponível, NENHUM shell/Rail/nav é montado (nunca um frame da
  // empresa anterior, nunca um item de nav clicável antes da autorização
  // real ser confirmada).
  if (hasOperationalCompanyId) {
    if (operational.identity.status === 'loading' || operational.identity.status === 'local') {
      return <OperationalLoadingScreen />;
    }
    if (operational.identity.status === 'error') {
      return <OperationalAccessDeniedScreen isError onRetry={operational.identity.retry} />;
    }
    if (operational.identity.status !== 'ready') {
      return <OperationalAccessDeniedScreen isError={false} />;
    }
  }

  const Screens: Record<string, React.ComponentType<any>> = {
    home: () => <Home key={animKey} t={t} setTweak={setTweak} go={go} active={true} currentUser={currentUser} />,
    clientes: ScreenClientes,
    andamento: ScreenAndamento,
    pendencias: ScreenPendencias,
    visitas: ScreenVisitas,
    propostas: ScreenPropostas,
    vendas: ScreenVendas,
    resultados: ScreenResultados,
    ajustes: ScreenAjustes,
    empresas: ScreenEmpresas,
  };

  const effectiveCurrent = allowedNavIds(currentUser, operational.mode).includes(current) ? current : 'home';
  const Cur = Screens[effectiveCurrent];
  const navItem = (NAV as any[]).find((n: any) => n.id === effectiveCurrent);

  const shellErrorResetKey = [
    currentUser.id,
    currentUser.platformRole ?? '',
    currentUser.activeMembership?.companyId ?? '',
    currentUser.activeMembership?.role ?? '',
    operational.companyId ?? '',
  ].join(':');

  const screenNode = effectiveCurrent === 'home'
    ? <Home key={animKey} t={t} setTweak={setTweak} go={go} active={true} currentUser={currentUser} />
    : (Cur ? <Cur go={go} t={t} initialFilter={navParams?.filter ?? null} /> : <PlaceholderScreen title={navItem?.label} />);

  return (
    // M1-F S8-C2-B2: CommercialCompanyProvider montado UMA vez aqui, acima da
    // troca de tela — assim a seleção do Super Admin sobrevive à navegação
    // entre Clientes/Andamento (Provider compartilhado), e é limpa sozinha
    // quando currentUser.id muda (login/logout/troca de usuário).
    <CommercialCompanyProvider identityKey={currentUser.id}>
      <AuthenticatedShellErrorBoundary key={shellErrorResetKey}>
        {/* MOBILE-RESPONSIVENESS-V1-B1-EXEC §5/§16 — shell principal em
            --app-vh (100dvh c/ fallback 100vh). >= lg: Rail inline de 236px,
            estrutura idêntica ao original. < lg: sem Rail inline, o
            conteúdo usa a largura real da viewport; MobileHeader no topo e
            MobileDrawer off-canvas. */}
        <div style={{ display: 'flex', height: 'var(--app-vh)', overflow: 'hidden' }}>
          {isDesktop && <Rail current={effectiveCurrent} go={go} currentUser={currentUser} />}
          {isDesktop ? (
            <main id="scroll-host" style={{ flex: 1, minWidth: 0, height: '100%' }}>
              {screenNode}
            </main>
          ) : (
            <main id="scroll-host" style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <MobileHeader title={navItem?.label ?? ''} onOpenNav={() => setNavOpen(true)} />
              <div
                style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', pointerEvents: navOpen ? 'none' : undefined }}
                aria-hidden={navOpen || undefined}
              >
                {screenNode}
              </div>
            </main>
          )}
          {!isDesktop && (
            <MobileDrawer
              currentUser={currentUser}
              current={effectiveCurrent}
              go={go}
              open={navOpen}
              onClose={() => setNavOpen(false)}
            />
          )}

          {isDevPreview && (
            <TweaksPanel>
              <TweakSection label="Pódio (tela inicial)" />
              <TweakRadio label="Estilo do pódio" value={t.podium} options={['A', 'B', 'C', 'D']} onChange={(v: string) => setTweak('podium', v)} />
              <div style={{ fontSize: 11.5, color: '#9aa1ac', padding: '0 2px 8px', lineHeight: 1.5 }}>A · Pódio, B · Líder, C · Galeria, D · Campeão (fotos reais)</div>
              <TweakToggle label="Animações (coroa, partículas, brilho)" value={t.anim} onChange={(v: boolean) => setTweak('anim', v)} />
              <TweakButton label="Reproduzir animação de entrada" onClick={() => setAnimKey((k) => k + 1)} />
              <TweakSection label="Telas novas (revisão)" />
              <TweakButton label="Ver Login" onClick={() => (window as any).__reviewAuth('login')} />
              <TweakButton label="Ver Cadastro" onClick={() => (window as any).__reviewAuth('signup')} />
              <TweakButton label="Ver Recuperação de senha" onClick={() => (window as any).__reviewAuth('recover')} />
              <TweakButton label="Ver Onboarding" onClick={() => (window as any).__reviewAuth('onboarding')} />
              {isLocalCommercialDataAllowed() && (
                <TweakButton label="Ver Perfil do vendedor" onClick={() => openFlow('perfil-vendedor', { seller: SellerService.getAll()[0] })} />
              )}
              <TweakButton label="Ver Central de notificações" onClick={() => openFlow('notificacoes')} />
              <TweakButton label="Ver Busca global" onClick={() => openFlow('busca')} />
              <TweakButton label="Ver Galeria de estados" onClick={() => openFlow('estados')} />
            </TweaksPanel>
          )}

          <FlowLayer flow={flow} close={closeFlow} openFlow={openFlow} go={go} />
        </div>
      </AuthenticatedShellErrorBoundary>
    </CommercialCompanyProvider>
  );
}

export function App({ operationalCompanyId = null }: { operationalCompanyId?: string | null } = {}) {
  // PILOT-UI-TRUTH-FIXES-R1-EXEC — TweaksPanel é uma ferramenta de dev/QA
  // (edit-mode via postMessage, revisão de telas de Auth, fixtures locais),
  // nunca deve alcançar um usuário real (Manager/Seller/Super Admin) em
  // produção/preview — achado BLOCKER do PILOT-UI-TRUTH-AUDIT-A1 §6/§7.
  // NODE_ENV === 'development' é o mesmo contrato já usado por
  // lib/flags.ts (resolveFlag) para distinguir dev de "produção" — nunca
  // role de negócio, que não é autorização de dev tool. Lida DENTRO da
  // função (não em constante de módulo) pelo mesmo motivo documentado em
  // resolveFlag: permite testes isolados com vi.stubEnv — uma constante de
  // módulo capturaria o valor de NODE_ENV no import, antes de qualquer stub
  // de teste rodar.
  const isDevPreview = process.env.NODE_ENV === 'development';
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [current, setCurrent] = useState('home');
  // PILOT-UI-TRUTH-FIXES-R1-EXEC §11 — parâmetros opcionais de navegação
  // (ex.: filtro inicial de Clientes), mesmo padrão de payload já usado por
  // openFlow. Nunca persiste entre navegações: cada chamada de go()
  // substitui o valor anterior (null quando nenhum parâmetro é passado).
  const [navParams, setNavParams] = useState<any>(null);
  const [animKey, setAnimKey] = useState(0);
  const [flow, setFlow] = useState<{ id: string; payload: any } | null>(null);
  // M1-B: Supabase session recovery is async (there's no synchronous way to
  // know if a session exists), so currentUser starts null and authLoading
  // gates the first render until restoreSession() resolves — see the effect
  // below. Everything downstream (Rail, RBAC, screens) is unchanged from M0.
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authView, setAuthView] = useState('login');
  const [, _setTick] = useState(0);

  // M1-D (commit 9): identidade comercial → limpeza do cache de queries.
  // Boolean(currentUser) = "profile ativo resolvido" (AuthService não mantém
  // User com profile inativo). Chamado incondicionalmente, independe da flag.
  //
  // CORREÇÃO (M1-F S6-E): companyId agora vem de activeMembership.companyId
  // (nunca do profiles.company_id legado) — suspensão/desligamento zera
  // activeMembership sem mexer no profile, e transferência muda o
  // companyId da membership sem trocar de usuário; nenhum dos dois mudava
  // qualquer campo observado aqui antes desta correção. membershipRole
  // cobre troca de papel (seller↔manager); hasActiveMembership cobre
  // ganho/perda da membership em si, sem depender de companyId (que já é
  // null tanto "sem membership" quanto "Super Admin", casos distintos).
  useQueryCacheIdentity({
    userId: currentUser?.id ?? null,
    platformRole: currentUser?.platformRole ?? null,
    companyId: currentUser?.activeMembership?.companyId ?? null,
    membershipRole: currentUser?.activeMembership?.role ?? null,
    hasActiveMembership: Boolean(currentUser?.activeMembership),
    isActive: Boolean(currentUser),
  });

  // M1-E E3-B1: único ponto de montagem da bridge de Leads remotos —
  // próximo ao ciclo de identidade acima, nunca dentro de ScreenClientes/
  // ScreenAndamento. Nunca monta para Super Admin (sem activeMembership,
  // por design); desmonta e limpa o snapshot sozinho em qualquer troca de
  // identidade (logout, troca de usuário/empresa/membership, desativação da
  // flag) — ver lib/hooks/useLeadsRemoteBridgeLifecycle.ts.
  useLeadsRemoteBridgeLifecycle(currentUser);

  // COMMERCIAL-REMOTE-B1-B3-B: único ponto de montagem da bridge de Tasks
  // remotas — mesmo molde de useLeadsRemoteBridgeLifecycle acima (nunca
  // dentro de ScreenPendencias/Home/Rail). O bridge é passivo (nunca faz
  // fetch por conta própria, lib/tasks/taskBridge.ts) — a query ativa vem
  // de quem monta useRemoteTasksScreenState (Rail, a partir deste lote).
  // notify reusa o MESMO _setTick já usado por subscribeStore (linha
  // abaixo): Home e ScreenPendencias ainda leem TaskService.getAll() em
  // render (não migraram nesta etapa) — precisam rerenderizar quando o
  // snapshot mudar, mesmo depois de Rail deixar de depender dele.
  useTasksRemoteBridgeLifecycle(currentUser, () => _setTick(n => n + 1));

  const openFlow = (id: string, payload: any = {}) => setFlow({ id, payload });
  const closeFlow = () => setFlow(null);
  const enter = (user: User) => { setCurrentUser(user); setFlow(null); };

  useEffect(() => subscribeStore(() => _setTick(n => n + 1)), []);

  // M1-B: recover an existing Supabase session on boot (e.g. after F5) before
  // deciding whether to show the login screen or the app — mirrors what the
  // old synchronous `AuthService.getCurrentUser()` lazy-init used to do, just
  // necessarily async now that there's a real network/session check involved.
  useEffect(() => {
    let alive = true;
    AuthService.restoreSession().then((user) => {
      if (!alive) return;
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    (window as any).__openFlow = openFlow;
    (window as any).__logout = () => {
      setFlow(null); setAuthView('login'); setCurrentUser(null);
    };
    (window as any).__reviewAuth = (v: string) => { setFlow(null); setAuthView(v); setCurrentUser(null); };
    return () => { if ((window as any).__openFlow === openFlow) delete (window as any).__openFlow; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { (window as any).__currentUser = currentUser; }, [currentUser]);

  if (authLoading) {
    // Minimal, unstyled-on-purpose gate — just long enough to avoid flashing
    // the login screen while restoreSession() is still resolving. No new
    // visual system introduced for this (M1-B scope: auth only).
    return (
      <div style={{ height: 'var(--app-vh)', display: 'grid', placeItems: 'center', background: '#0a0a0b', color: 'var(--t-500, #8b8b93)', fontSize: 14 }}>
        Carregando…
      </div>
    );
  }

  if (!currentUser) {
    return <AuthFlow view={authView} setView={setAuthView} onAuthed={enter} onSignedUp={() => setAuthView('onboarding')} />;
  }

  const isSuperAdminUser = currentUser.platformRole === 'super_admin';
  const hasOperationalCompanyId = isSuperAdminUser
    && typeof operationalCompanyId === 'string' && operationalCompanyId.trim() !== '';

  return (
    // SUPER-ADMIN-COMPANY-CONTEXT-B1-EXEC — montado SEMPRE (Manager/Seller
    // incluídos), generalizando a fonte de "empresa operacional" sem exigir
    // que cada tela decida sozinha entre activeMembership e a URL (§2 do
    // EXEC). Para Manager/Seller mode fica 'membership' e o comportamento é
    // idêntico ao anterior — só passou a vir de um Provider único.
    <OperationalCompanyProvider
      userId={currentUser.id}
      userIsActive={true}
      membershipCompanyId={currentUser.activeMembership?.companyId ?? null}
      membershipRole={currentUser.activeMembership?.role ?? null}
      isSuperAdmin={isSuperAdminUser}
      superAdminCompanyIdFromUrl={hasOperationalCompanyId ? operationalCompanyId : null}
    >
      <AuthenticatedApp
        currentUser={currentUser}
        current={current}
        setCurrent={setCurrent}
        navParams={navParams}
        setNavParams={setNavParams}
        t={t}
        setTweak={setTweak}
        animKey={animKey}
        setAnimKey={setAnimKey}
        flow={flow}
        openFlow={openFlow}
        closeFlow={closeFlow}
        isDevPreview={isDevPreview}
        hasOperationalCompanyId={hasOperationalCompanyId}
      />
    </OperationalCompanyProvider>
  );
}
