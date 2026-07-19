'use client';
import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { NAV, Avatar, PageHead, LCard, LightScreen } from '@/components/ui/kit';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton } from '@/components/ui/TweaksPanel';
import { NAV_ROLES, TASK_STATE } from '@/lib/data';
import type { User } from '@/lib/data';
import { isRemoteStagesEnabled } from '@/lib/flags';
import { canAccessStageSettings } from '@/lib/capabilities';
import { subscribeStore } from '@/lib/store';
import { AuthService, SellerService, TaskService } from '@/lib/services';
import { AuthFlow } from '@/components/auth/AuthFlow';
import { Home } from '@/components/screens/Home';
import { ScreenClientes, ScreenAndamento, ScreenPendencias } from '@/components/screens/ScreensOps';
import { ScreenVisitas, ScreenPropostas, ScreenVendas, ScreenResultados, ScreenAjustes } from '@/components/screens/ScreensBiz';
import { FlowLayer } from '@/components/flows/FlowLayer';

const TWEAK_DEFAULTS = {
  podium: 'D',
  anim: true,
  showRevenue: false,
};

// M1-D (commit 8): navegação efetiva. Base = NAV_ROLES legado; o manager
// ganha 'ajustes' SOMENTE com a flag remota ON (e dentro da tela vê apenas a
// aba Etapas — ver ScreenAjustes). Com a flag OFF a lista é idêntica ao
// legado. A combinação capability×flag mora aqui, nunca em lib/capabilities.
function allowedNavIds(user: User | null): string[] {
  if (!user) return [];
  const base = NAV_ROLES[user.role] || [];
  if (!base.includes('ajustes') && isRemoteStagesEnabled() && canAccessStageSettings(user)) {
    return [...base, 'ajustes'];
  }
  return base;
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

function Rail({ current, go, currentUser }: { current: string; go: (id: string) => void; currentUser: User }) {
  const allowedIds = allowedNavIds(currentUser);
  const seller = currentUser.sellerId ? SellerService.getById(currentUser.sellerId) : null;
  const displayTeam = seller?.team
    ? `Vendedor · ${seller.team}`
    : currentUser.role === 'admin' ? 'Administrador' : 'Gerente';
  // Live count (RBAC-filtered by TaskService.getAll itself) — replaces the
  // hardcoded badge:3 that never moved regardless of real pendências (M0-K2).
  const lateTasks = TaskService.getAll().filter((t: any) => t.state === TASK_STATE.LATE).length;

  return (
    <aside style={{ width: 236, flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: 'linear-gradient(180deg,#0b0b0c,#070708)', borderRight: '1px solid rgba(255,255,255,.06)' }}>
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .35, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 1, background: 'linear-gradient(180deg, transparent, rgba(212,175,55,.18), transparent)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 220, background: 'radial-gradient(120% 70% at 30% 100%, rgba(193,18,31,.10), transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '22px 22px 20px' }}>
        <div className="sheen" style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(150deg,#E8CE72,#C9A227)', display: 'grid', placeItems: 'center', boxShadow: '0 8px 20px -6px rgba(212,175,55,.6), inset 0 1px 0 rgba(255,255,255,.4)' }}>
          <Icon name="car" size={23} stroke={2.2} style={{ color: '#2a2104' }} />
        </div>
        <div>
          <div className="display" style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '.05em', lineHeight: 1 }}>AUTOCRM</div>
          <div style={{ fontSize: 9.5, color: 'var(--gold-ink)', letterSpacing: '.22em', marginTop: 4, fontWeight: 700, opacity: .8 }}>PERFORMANCE</div>
        </div>
      </div>

      <nav style={{ position: 'relative', flex: 1, overflowY: 'auto', padding: '6px 14px' }}>
        {(NAV as any[]).filter((item: any) => allowedIds.includes(item.id)).map((item: any) => {
          const on = current === item.id;
          const badge = item.id === 'pendencias' ? lateTasks : 0;
          return (
            <button key={item.id} onClick={() => go(item.id)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 13, padding: '11px 13px', marginBottom: 4,
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
              {badge > 0 && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'linear-gradient(180deg,#FF4242,#D81F2C)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center', fontFamily: 'Archivo, sans-serif', boxShadow: '0 0 10px -1px rgba(255,46,46,.7)', animation: on ? 'none' : 'breatheSoft 2.6s ease-in-out infinite' }}>{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ position: 'relative', padding: '12px 14px 16px' }}>
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent)', marginBottom: 10 }} />
        <div className="lift" onClick={() => seller && (window as any).__openFlow && (window as any).__openFlow('perfil-vendedor', { seller })} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 12, cursor: 'pointer', border: '1px solid transparent' }}>
          <Avatar name={currentUser.name} size={36} ring="#3B82F6" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser.name}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>{displayTeam}</div>
          </div>
          <button onClick={(e: any) => { e.stopPropagation(); (window as any).__openFlow && (window as any).__openFlow('confirmar', { title: 'Sair do sistema?', message: 'Você precisará entrar novamente para acessar seu painel de performance.', confirmLabel: 'Sair', tone: 'danger', icon: 'logout', onConfirm: () => AuthService.logout() }); }} className="focus-ring" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--txt-lo)' }} title="Sair">
            <Icon name="logout" size={17} stroke={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [current, setCurrent] = useState('home');
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

  const go = (id: string) => {
    if (!currentUser) return;
    const allowed = allowedNavIds(currentUser);
    if (!allowed.includes(id)) return;
    setCurrent(id);
    document.querySelector('#scroll-host')?.scrollTo(0, 0);
  };
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

  useEffect(() => {
    if (!currentUser) return;
    const allowed = allowedNavIds(currentUser);
    if (!allowed.includes(current)) setCurrent('home');
  }, [currentUser, current]);

  useEffect(() => { if (current === 'home') setAnimKey(k => k + 1); }, [current, t.podium]);

  const Screens: Record<string, React.ComponentType<any>> = {
    home: () => <Home key={animKey} t={t} setTweak={setTweak} go={go} active={true} />,
    clientes: ScreenClientes,
    andamento: ScreenAndamento,
    pendencias: ScreenPendencias,
    visitas: ScreenVisitas,
    propostas: ScreenPropostas,
    vendas: ScreenVendas,
    resultados: ScreenResultados,
    ajustes: ScreenAjustes,
  };

  // Guarda SÍNCRONA de render: uma tela proibida nunca é renderizada, nem por
  // um frame — o useEffect acima só sincroniza o estado depois. Cobre troca de
  // usuário com estado antigo de navegação apontando para tela agora proibida.
  const effectiveCurrent = currentUser && allowedNavIds(currentUser).includes(current) ? current : 'home';
  const Cur = Screens[effectiveCurrent];
  const navItem = (NAV as any[]).find((n: any) => n.id === effectiveCurrent);

  if (authLoading) {
    // Minimal, unstyled-on-purpose gate — just long enough to avoid flashing
    // the login screen while restoreSession() is still resolving. No new
    // visual system introduced for this (M1-B scope: auth only).
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: '#0a0a0b', color: 'var(--t-500, #8b8b93)', fontSize: 14 }}>
        Carregando…
      </div>
    );
  }

  if (!currentUser) {
    return <AuthFlow view={authView} setView={setAuthView} onAuthed={enter} onSignedUp={() => setAuthView('onboarding')} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Rail current={effectiveCurrent} go={go} currentUser={currentUser} />
      <main id="scroll-host" style={{ flex: 1, minWidth: 0, height: '100%' }}>
        {effectiveCurrent === 'home'
          ? <Home key={animKey} t={t} setTweak={setTweak} go={go} active={true} />
          : (Cur ? <Cur go={go} t={t} /> : <PlaceholderScreen title={navItem?.label} />)}
      </main>

      <TweaksPanel>
        <TweakSection label="Pódio (tela inicial)" />
        <TweakRadio label="Estilo do pódio" value={t.podium} options={['A', 'B', 'C', 'D']} onChange={(v: string) => setTweak('podium', v)} />
        <div style={{ fontSize: 11.5, color: '#9aa1ac', padding: '0 2px 8px', lineHeight: 1.5 }}>A · Pódio — B · Líder — C · Galeria — D · Campeão (fotos reais)</div>
        <TweakToggle label="Animações (coroa, partículas, brilho)" value={t.anim} onChange={(v: boolean) => setTweak('anim', v)} />
        <TweakSection label="Métricas" />
        <TweakToggle label="Mostrar receita (discreto)" value={t.showRevenue} onChange={(v: boolean) => setTweak('showRevenue', v)} />
        <TweakButton label="Reproduzir animação de entrada" onClick={() => setAnimKey(k => k + 1)} />
        <TweakSection label="Telas novas (revisão)" />
        <TweakButton label="Ver Login" onClick={() => (window as any).__reviewAuth('login')} />
        <TweakButton label="Ver Cadastro" onClick={() => (window as any).__reviewAuth('signup')} />
        <TweakButton label="Ver Recuperação de senha" onClick={() => (window as any).__reviewAuth('recover')} />
        <TweakButton label="Ver Onboarding" onClick={() => (window as any).__reviewAuth('onboarding')} />
        <TweakButton label="Ver Perfil do vendedor" onClick={() => openFlow('perfil-vendedor', { seller: SellerService.getAll()[0] })} />
        <TweakButton label="Ver Central de notificações" onClick={() => openFlow('notificacoes')} />
        <TweakButton label="Ver Busca global" onClick={() => openFlow('busca')} />
        <TweakButton label="Ver Galeria de estados" onClick={() => openFlow('estados')} />
      </TweaksPanel>

      <FlowLayer flow={flow} close={closeFlow} openFlow={openFlow} go={go} />
    </div>
  );
}
