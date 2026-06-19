'use client';
import React, { useState, useEffect } from 'react';
import { Icon } from '@/components/ui/Icon';
import { NAV, Avatar, PageHead, LCard, LightScreen } from '@/components/ui/kit';
import { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton } from '@/components/ui/TweaksPanel';
import { SELLERS, ME_ID } from '@/lib/data';
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

function Rail({ current, go }: { current: string; go: (id: string) => void }) {
  const me = (SELLERS as any[]).find((s: any) => s.id === ME_ID);
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
        {(NAV as any[]).map((item: any) => {
          const on = current === item.id;
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
              {item.badge && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'linear-gradient(180deg,#FF4242,#D81F2C)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center', fontFamily: 'Archivo, sans-serif', boxShadow: '0 0 10px -1px rgba(255,46,46,.7)', animation: on ? 'none' : 'breatheSoft 2.6s ease-in-out infinite' }}>{item.badge}</span>}
            </button>
          );
        })}
      </nav>

      <div style={{ position: 'relative', padding: '12px 14px 16px' }}>
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.08), transparent)', marginBottom: 10 }} />
        <div className="lift" onClick={() => (window as any).__openFlow && (window as any).__openFlow('perfil-vendedor', { seller: me })} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 12, cursor: 'pointer', border: '1px solid transparent' }}>
          <Avatar name={me.name} size={36} ring="#3B82F6" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.name}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-lo)' }}>Vendedor · {me.team}</div>
          </div>
          <button onClick={(e: any) => { e.stopPropagation(); (window as any).__openFlow && (window as any).__openFlow('confirmar', { title: 'Sair do sistema?', message: 'Você precisará entrar novamente para acessar seu painel de performance.', confirmLabel: 'Sair', tone: 'danger', icon: 'logout', onConfirm: () => (window as any).__logout && (window as any).__logout() }); }} className="focus-ring" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--txt-lo)' }} title="Sair">
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
  const [authed, setAuthed] = useState(() => { try { return localStorage.getItem('acrm_session') === '1'; } catch { return false; } });
  const [authView, setAuthView] = useState('login');

  const go = (id: string) => {
    setCurrent(id);
    document.querySelector('#scroll-host')?.scrollTo(0, 0);
  };
  const openFlow = (id: string, payload: any = {}) => setFlow({ id, payload });
  const closeFlow = () => setFlow(null);
  const enter = () => { try { localStorage.setItem('acrm_session', '1'); } catch {} setAuthed(true); setFlow(null); };

  useEffect(() => {
    (window as any).__openFlow = openFlow;
    (window as any).__logout = () => {
      try { localStorage.removeItem('acrm_session'); } catch {}
      setFlow(null); setAuthView('login'); setAuthed(false);
    };
    (window as any).__reviewAuth = (v: string) => { setFlow(null); setAuthView(v); setAuthed(false); };
    return () => { if ((window as any).__openFlow === openFlow) delete (window as any).__openFlow; };
  }, []);

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

  const Cur = Screens[current];
  const navItem = (NAV as any[]).find((n: any) => n.id === current);

  if (!authed) {
    return <AuthFlow view={authView} setView={setAuthView} onAuthed={enter} onSignedUp={() => setAuthView('onboarding')} />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Rail current={current} go={go} />
      <main id="scroll-host" style={{ flex: 1, minWidth: 0, height: '100%' }}>
        {current === 'home'
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
        <TweakButton label="Ver Perfil do vendedor" onClick={() => openFlow('perfil-vendedor', { seller: (SELLERS as any[])[0] })} />
        <TweakButton label="Ver Central de notificações" onClick={() => openFlow('notificacoes')} />
        <TweakButton label="Ver Busca global" onClick={() => openFlow('busca')} />
        <TweakButton label="Ver Galeria de estados" onClick={() => openFlow('estados')} />
      </TweaksPanel>

      <FlowLayer flow={flow} close={closeFlow} openFlow={openFlow} go={go} />
    </div>
  );
}
