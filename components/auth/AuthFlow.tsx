'use client';
import React, { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, LBtn, LBadge } from '@/components/ui/kit';
import { SELLERS, STAGES } from '@/lib/data';
import type { User } from '@/lib/data';
import { AuthService } from '@/lib/services';
import { FField, Segmented, StepRail } from '@/components/flows/FlowsShared';

function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', background: 'radial-gradient(120% 90% at 80% -10%, #1a1a1e, #060607 58%)', overflow: 'hidden', animation: 'flowIn .4s cubic-bezier(.2,.7,.2,1)' }}>
      <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .3, pointerEvents: 'none' }} />
      {children}
    </div>
  );
}

function AuthHero({ note }: { note?: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0, padding: '56px 60px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}>
      <div className="ambient" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(60% 50% at 30% 18%, rgba(212,175,55,.16), transparent 70%), radial-gradient(50% 45% at 80% 92%, rgba(193,18,31,.12), transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="sheen" style={{ width: 50, height: 50, borderRadius: 15, background: 'linear-gradient(150deg,#E8CE72,#C9A227)', display: 'grid', placeItems: 'center', boxShadow: '0 10px 26px -8px rgba(212,175,55,.6), inset 0 1px 0 rgba(255,255,255,.4)' }}>
          <Icon name="car" size={28} stroke={2.2} style={{ color: '#2a2104' }} />
        </div>
        <div>
          <div className="display" style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '.05em', lineHeight: 1 }}>AUTOCRM</div>
          <div style={{ fontSize: 10.5, color: 'var(--gold-ink)', letterSpacing: '.24em', marginTop: 4, fontWeight: 700, opacity: .85 }}>PERFORMANCE</div>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 14px', borderRadius: 999, background: 'rgba(212,175,55,.1)', border: '1px solid rgba(212,175,55,.3)', marginBottom: 22 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#27C75F', animation: 'livePulse 2s infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#E8CE72', letterSpacing: '.04em' }}>O CRM que transforma vendedores em campeões</span>
        </div>
        <h1 className="display" style={{ margin: 0, fontSize: 50, fontWeight: 900, color: '#fff', letterSpacing: '-.025em', lineHeight: 1.02 }}>
          Cada venda é<br />uma <span style={{ color: '#E8CE72' }}>posição no pódio.</span>
        </h1>
        <p style={{ margin: '20px 0 0', fontSize: 16.5, color: 'var(--txt-mid)', maxWidth: 460, lineHeight: 1.6 }}>
          Ranking ao vivo, metas claras e cada cliente na cor certa. Seu time sabe exatamente o que fazer — e quer vencer.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 36 }}>
          {[['2º', 54, '#C9CDD4'], ['1º', 78, '#E8CE72'], ['3º', 40, '#C1121F']].map(([t, h, c], i) => (
            <div key={i} style={{ width: 64, textAlign: 'center' }}>
              <div className="display" style={{ fontSize: 13, fontWeight: 800, color: c as string, marginBottom: 6 }}>{t}</div>
              <div style={{ height: h as number, borderRadius: '8px 8px 0 0', background: i === 1 ? 'linear-gradient(180deg,#3a2f10,#1a1407)' : 'linear-gradient(180deg,#1d1d20,#121214)', border: `1px solid ${i === 1 ? 'rgba(212,175,55,.4)' : 'var(--line-dark)'}`, boxShadow: i === 1 ? '0 14px 30px -14px rgba(212,175,55,.6)' : 'none' }} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 24, fontSize: 12.5, color: 'var(--txt-lo)' }}>
        {note || <>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="shield" size={15} stroke={2} style={{ color: 'var(--t-500)' }} /> Dados protegidos</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="bolt" size={15} stroke={2} style={{ color: 'var(--t-500)' }} /> Tempo real</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="car" size={15} stroke={2} style={{ color: 'var(--t-500)' }} /> Feito para concessionárias</span>
        </>}
      </div>
    </div>
  );
}

function AuthCard({ children, width = 440 }: { children: React.ReactNode; width?: number }) {
  return (
    <div style={{ position: 'relative', flex: `0 0 ${width + 120}px`, maxWidth: '100%', display: 'grid', placeItems: 'center', padding: '40px 28px', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: width, background: 'linear-gradient(180deg,#161618,#0f0f11)', border: '1px solid var(--border)', borderRadius: 22, padding: 34, boxShadow: 'var(--shadow-lg)' }}>
        {children}
      </div>
    </div>
  );
}

function PwField({ label, value, onChange, placeholder = '••••••••', hint }: any) {
  const [show, setShow] = useState(false);
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>{label}</span>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span style={{ position: 'absolute', left: 14, color: 'var(--t-400)', display: 'grid' }}><Icon name="shield" size={17} stroke={2} /></span>
        <input type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder}
          style={{ width: '100%', padding: '13px 44px 13px 42px', borderRadius: 12, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 15, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)', outline: 'none' }}
          onFocus={(e: any) => { e.target.style.borderColor = 'rgba(212,175,55,.6)'; e.target.style.boxShadow = '0 0 0 3px rgba(212,175,55,.12)'; }}
          onBlur={(e: any) => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }} />
        <button onClick={() => setShow(s => !s)} type="button" style={{ position: 'absolute', right: 10, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--t-400)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={17} stroke={2} />
        </button>
      </div>
      {hint && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--t-400)', marginTop: 6 }}>{hint}</span>}
    </label>
  );
}

function GoogleBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="lift" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, padding: '13px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.05)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 600, color: 'var(--t-900)' }}>
      <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5Z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.6-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44Z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C39.6 35.7 44 30.5 44 24c0-1.3-.1-2.3-.4-3.5Z"/></svg>
      {label}
    </button>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '18px 0' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 12, color: 'var(--t-400)' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function LoginView({ go, onDone }: { go: (v: string) => void; onDone: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState('');

  const handleLogin = () => {
    const user = AuthService.login(email, pw);
    if (!user) { setErr('E-mail ou senha incorretos.'); return; }
    setErr('');
    onDone(user);
  };

  return (
    <AuthStage>
      <AuthHero />
      <AuthCard>
        <div className="display" style={{ fontSize: 12, fontWeight: 800, color: '#E8CE72', letterSpacing: '.18em' }}>BEM-VINDO DE VOLTA</div>
        <h2 className="display" style={{ margin: '8px 0 4px', fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>Entrar no sistema</h2>
        <p style={{ margin: '0 0 24px', color: 'var(--t-500)', fontSize: 14 }}>Acesse seu painel de performance.</p>
        <FField label="E-mail" icon="user" type="email" placeholder="voce@empresa.com.br" value={email} onChange={(e: any) => setEmail(e.target.value)} />
        <PwField label="Senha" value={pw} onChange={(e: any) => setPw(e.target.value)} />
        {err && <div style={{ fontSize: 13, color: '#FF4242', marginBottom: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,66,66,.1)', border: '1px solid rgba(255,66,66,.25)' }}>{err}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 22px' }}>
          <button onClick={() => setRemember(r => !r)} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${remember ? 'var(--gold)' : 'var(--border)'}`, background: remember ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'transparent', display: 'grid', placeItems: 'center', color: '#241c04' }}>{remember && <Icon name="check" size={12} stroke={3} />}</span>
            <span style={{ fontSize: 13.5, color: 'var(--t-700)' }}>Lembrar acesso</span>
          </button>
          <button onClick={() => go('recover')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: '#E8CE72' }}>Esqueci minha senha</button>
        </div>
        <LBtn kind="gold" size="lg" icon="arrowRight" onClick={handleLogin} style={{ width: '100%', justifyContent: 'center' }}>Entrar</LBtn>
        <Divider>ou</Divider>
        <GoogleBtn onClick={handleLogin} label="Entrar com Google" />
        <p style={{ textAlign: 'center', margin: '24px 0 0', fontSize: 13.5, color: 'var(--t-500)' }}>
          Não tem conta? <button onClick={() => go('signup')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, color: '#E8CE72' }}>Criar conta</button>
        </p>
      </AuthCard>
    </AuthStage>
  );
}

function SignupView({ go, onDone }: { go: (v: string) => void; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ empresa: '', segmento: 'Concessionária', vendedores: '4 a 10', nome: '', email: '', senha: '' });
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));
  const steps = ['Empresa', 'Administrador', 'Pronto'];
  const canNext = step === 0 ? f.empresa : step === 1 ? (f.nome && f.email && f.senha) : true;
  return (
    <AuthStage>
      <AuthHero note={<span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="sparkle" size={15} stroke={2} style={{ color: '#E8CE72' }} /> Configure em menos de 2 minutos</span>} />
      <AuthCard width={460}>
        <button onClick={() => step === 0 ? go('login') : setStep(step - 1)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--t-500)', marginBottom: 18, padding: 0 }}>
          <Icon name="arrowLeft" size={16} stroke={2.2} /> {step === 0 ? 'Voltar ao login' : 'Voltar'}
        </button>
        <StepRail steps={steps} current={step} />
        {step === 0 && <div>
          <h2 className="display" style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 800, color: '#fff' }}>Sua empresa</h2>
          <p style={{ margin: '0 0 22px', color: 'var(--t-500)', fontSize: 14 }}>Vamos começar pelo básico da sua loja.</p>
          <FField label="Nome da empresa" icon="building" placeholder="Ex.: Revenda Premium Veículos" value={f.empresa} onChange={(e: any) => set('empresa', e.target.value)} />
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', margin: '4px 0 9px' }}>Segmento</div>
          <div style={{ marginBottom: 18 }}><Segmented options={['Concessionária', 'Multimarcas', 'Seminovos']} value={f.segmento} onChange={(v: string) => set('segmento', v)} /></div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 9 }}>Quantos vendedores?</div>
          <Segmented options={['1 a 3', '4 a 10', '11 a 25', '25+']} value={f.vendedores} onChange={(v: string) => set('vendedores', v)} />
        </div>}
        {step === 1 && <div>
          <h2 className="display" style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 800, color: '#fff' }}>Conta de administrador</h2>
          <p style={{ margin: '0 0 22px', color: 'var(--t-500)', fontSize: 14 }}>Você será o gestor responsável pela loja.</p>
          <FField label="Seu nome" icon="user" placeholder="Nome completo" value={f.nome} onChange={(e: any) => set('nome', e.target.value)} />
          <FField label="E-mail" icon="message" type="email" placeholder="voce@empresa.com.br" value={f.email} onChange={(e: any) => set('email', e.target.value)} />
          <PwField label="Crie uma senha" value={f.senha} onChange={(e: any) => set('senha', e.target.value)} hint="Use ao menos 8 caracteres." />
        </div>}
        {step === 2 && <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <div style={{ position: 'relative', width: 92, height: 92, margin: '0 auto 20px' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.1s ease-out' }} />
            <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #E8CE72, #A9831F)', display: 'grid', placeItems: 'center', color: '#241c04', boxShadow: '0 18px 44px -14px rgba(212,175,55,.7)' }}><Icon name="check" size={42} stroke={2.4} /></div>
          </div>
          <h2 className="display" style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 800, color: '#fff' }}>Tudo pronto, {f.nome ? f.nome.split(' ')[0] : 'vamos lá'}!</h2>
          <p style={{ margin: '0 auto', color: 'var(--t-500)', fontSize: 14.5, maxWidth: 320 }}>Sua conta da <b style={{ color: 'var(--t-900)' }}>{f.empresa || 'sua empresa'}</b> está criada. Vamos configurar o sistema em poucos passos.</p>
        </div>}
        <div style={{ marginTop: 24 }}>
          <LBtn kind="gold" size="lg" icon={step === 2 ? 'rocket' : 'arrowRight'} onClick={() => canNext && (step === 2 ? onDone() : setStep(step + 1))} style={{ width: '100%', justifyContent: 'center', opacity: canNext ? 1 : .5 }}>
            {step === 2 ? 'Começar configuração' : 'Continuar'}
          </LBtn>
        </div>
      </AuthCard>
    </AuthStage>
  );
}

function RecoverView({ go }: { go: (v: string) => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <AuthStage>
      <AuthHero />
      <AuthCard>
        {!sent ? <>
          <button onClick={() => go('login')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--t-500)', marginBottom: 18, padding: 0 }}>
            <Icon name="arrowLeft" size={16} stroke={2.2} /> Voltar ao login
          </button>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--gold-bg)', border: '1px solid var(--gold-line)', display: 'grid', placeItems: 'center', color: '#E8CE72', marginBottom: 18 }}><Icon name="shield" size={28} stroke={2} /></div>
          <h2 className="display" style={{ margin: '0 0 6px', fontSize: 26, fontWeight: 800, color: '#fff' }}>Recuperar senha</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--t-500)', fontSize: 14 }}>Informe seu e-mail e enviaremos um link para você criar uma nova senha.</p>
          <FField label="E-mail da conta" icon="message" type="email" placeholder="voce@empresa.com.br" value={email} onChange={(e: any) => setEmail(e.target.value)} />
          <LBtn kind="gold" size="lg" icon="send" onClick={() => setSent(true)} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>Enviar recuperação</LBtn>
        </> : <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ position: 'relative', width: 92, height: 92, margin: '0 auto 20px' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #27C75F', animation: 'burstRing 1.1s ease-out' }} />
            <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #27C75F, #14803d)', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: '0 18px 44px -14px rgba(39,199,95,.6)' }}><Icon name="send" size={38} stroke={2.2} /></div>
          </div>
          <h2 className="display" style={{ margin: '0 0 8px', fontSize: 25, fontWeight: 800, color: '#fff' }}>E-mail enviado!</h2>
          <p style={{ margin: '0 auto 24px', color: 'var(--t-500)', fontSize: 14.5, maxWidth: 320 }}>Enviamos um link de recuperação para <b style={{ color: 'var(--t-900)' }}>{email || 'seu e-mail'}</b>. Verifique sua caixa de entrada.</p>
          <LBtn kind="ghost" size="lg" icon="arrowLeft" onClick={() => go('login')} style={{ width: '100%', justifyContent: 'center' }}>Voltar ao login</LBtn>
        </div>}
      </AuthCard>
    </AuthStage>
  );
}

function OnboardingView({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    { key: 'empresa', icon: 'building', title: 'Cadastre sua empresa', desc: 'Confirme os dados da loja que vão aparecer no sistema.' },
    { key: 'vendedores', icon: 'users', title: 'Adicione seus vendedores', desc: 'Quem entra na disputa pelo topo do ranking?' },
    { key: 'etapas', icon: 'flow', title: 'Defina as etapas de venda', desc: 'O caminho que cada cliente percorre até comprar.' },
    { key: 'clientes', icon: 'upload', title: 'Importe seus primeiros clientes', desc: 'Traga sua carteira atual ou comece do zero.' },
    { key: 'pronto', icon: 'rocket', title: 'Tudo pronto!', desc: '' },
  ];
  const cur = steps[step];
  const pct = Math.round(((step) / (steps.length - 1)) * 100);

  return (
    <AuthStage>
      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '26px 40px 0', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="sheen" style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(150deg,#E8CE72,#C9A227)', display: 'grid', placeItems: 'center' }}><Icon name="car" size={21} stroke={2.2} style={{ color: '#2a2104' }} /></div>
          <div style={{ flex: 1, maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-700)' }}>Configuração inicial</span>
              <span className="tnum" style={{ fontSize: 12, color: 'var(--t-500)' }}>{step + 1} de {steps.length}</span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div style={{ width: pct + '%', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#E8CE72,#C9A227)', boxShadow: '0 0 12px rgba(212,175,55,.6)', transition: 'width .4s cubic-bezier(.2,.7,.2,1)' }} />
            </div>
          </div>
          {step < steps.length - 1 && <button onClick={onDone} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--t-500)' }}>Pular configuração</button>}
        </div>

        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '20px 40px 40px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: 620 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <div style={{ width: 54, height: 54, borderRadius: 15, background: step === 4 ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : 'var(--gold-bg)', border: '1px solid var(--gold-line)', display: 'grid', placeItems: 'center', color: step === 4 ? '#241c04' : '#E8CE72' }}><Icon name={cur.icon} size={27} stroke={2.1} /></div>
              <div>
                <h2 className="display" style={{ margin: 0, fontSize: 27, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>{cur.title}</h2>
                {cur.desc && <p style={{ margin: '4px 0 0', color: 'var(--t-500)', fontSize: 14.5 }}>{cur.desc}</p>}
              </div>
            </div>

            <div style={{ background: 'linear-gradient(180deg,#1a1a1d,#131315)', border: '1px solid var(--border)', borderRadius: 18, padding: 24, boxShadow: 'var(--shadow-md)' }}>
              {step === 0 && <>
                <FField label="Nome da empresa" icon="building" defaultValue="Revenda Premium Veículos" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <FField label="Cidade" icon="mapPin" defaultValue="São Paulo, SP" />
                  <FField label="Telefone" icon="phone" defaultValue="(11) 3000-0000" />
                </div>
              </>}
              {step === 1 && <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {(SELLERS as any[]).slice(0, 4).map((s: any) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
                      <Avatar name={s.name} size={36} ring="#3B82F6" />
                      <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-900)' }}>{s.name}</div><div style={{ fontSize: 12, color: 'var(--t-500)' }}>Equipe {s.team}</div></div>
                      <LBadge tone="green">Adicionado</LBadge>
                    </div>
                  ))}
                </div>
                <button className="lift" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: '13px', borderRadius: 12, border: '1px dashed var(--line-dark-2)', background: 'rgba(255,255,255,.02)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: 'var(--gold-ink)' }}><Icon name="plus" size={17} stroke={2.2} /> Adicionar vendedor</button>
              </>}
              {step === 2 && <>
                <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--t-500)' }}>Sugerimos estas etapas. Você pode ajustar depois em Ajustes.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(STAGES as string[]).map((s: string, i: number) => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)' }}>
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--gold-bg)', color: '#E8CE72', display: 'grid', placeItems: 'center', fontFamily: 'Archivo, sans-serif', fontWeight: 800, fontSize: 13 }}>{i + 1}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t-900)' }}>{s}</span>
                      <Icon name="list" size={16} stroke={2} style={{ marginLeft: 'auto', color: 'var(--t-400)' }} />
                    </div>
                  ))}
                </div>
              </>}
              {step === 3 && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button className="lift" style={{ textAlign: 'left', padding: 20, borderRadius: 14, border: '1px solid var(--gold-line)', background: 'var(--gold-bg)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon name="upload" size={26} stroke={2} style={{ color: '#E8CE72' }} />
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--t-900)', marginTop: 12 }}>Importar planilha</div>
                  <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 3 }}>Traga sua carteira atual (CSV / Excel)</div>
                </button>
                <button className="lift" style={{ textAlign: 'left', padding: 20, borderRadius: 14, border: '1px solid var(--border)', background: 'rgba(255,255,255,.03)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon name="plus" size={26} stroke={2} style={{ color: 'var(--t-500)' }} />
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--t-900)', marginTop: 12 }}>Começar do zero</div>
                  <div style={{ fontSize: 12.5, color: 'var(--t-500)', marginTop: 3 }}>Cadastrar clientes manualmente depois</div>
                </button>
              </div>}
              {step === 4 && <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ position: 'relative', width: 110, height: 110, margin: '0 auto 22px' }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.2s ease-out' }} />
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid #E8CE72', animation: 'burstRing 1.2s ease-out .3s' }} />
                  <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', background: 'radial-gradient(circle at 38% 30%, #E8CE72, #A9831F)', display: 'grid', placeItems: 'center', color: '#241c04', boxShadow: '0 22px 54px -16px rgba(212,175,55,.7)', animation: 'goldPulse 3s ease-in-out infinite' }}><Icon name="trophy" size={52} stroke={1.9} /></div>
                </div>
                <h3 className="display" style={{ margin: '0 0 10px', fontSize: 30, fontWeight: 900, color: '#fff' }}>Sistema pronto! 🏁</h3>
                <p style={{ margin: '0 auto', color: 'var(--t-500)', fontSize: 15, maxWidth: 400 }}>Tudo configurado. Hora de colocar seu time para competir e vender mais.</p>
              </div>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
              {step > 0 && step < 4 && <LBtn kind="ghost" size="lg" icon="arrowLeft" onClick={() => setStep(step - 1)}>Voltar</LBtn>}
              <div style={{ flex: 1 }} />
              <LBtn kind="gold" size="lg" icon={step === 4 ? 'rocket' : 'arrowRight'} onClick={() => step === 4 ? onDone() : setStep(step + 1)}>
                {step === 4 ? 'Entrar no sistema' : 'Continuar'}
              </LBtn>
            </div>
          </div>
        </div>
      </div>
    </AuthStage>
  );
}

export function AuthFlow({ view, setView, onAuthed, onSignedUp }: {
  view: string;
  setView: (v: string) => void;
  onAuthed: (user: User) => void;
  onSignedUp: () => void;
}) {
  if (view === 'signup') return <SignupView go={setView} onDone={onSignedUp} />;
  if (view === 'recover') return <RecoverView go={setView} />;
  if (view === 'onboarding') return <OnboardingView onDone={() => setView('login')} />;
  return <LoginView go={setView} onDone={onAuthed} />;
}
