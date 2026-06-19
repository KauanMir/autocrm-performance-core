'use client';
import React from 'react';
import { Icon } from '@/components/ui/Icon';
import { Avatar, CountUp, useCountUp } from '@/components/ui/kit';
import { initials } from '@/lib/data';

export const PLACE = [
  { tag: '1º', ring: '#D4AF37', glow: 'rgba(212,175,55,.55)', label: 'Líder' },
  { tag: '2º', ring: '#C9CDD4', glow: 'rgba(201,205,212,.4)',  label: '' },
  { tag: '3º', ring: '#C1121F', glow: 'rgba(193,18,31,.4)',    label: '' },
];

function GoldParticles({ count = 9 }: { count?: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const left = 8 + (i * 84 / count) + (i % 2 ? 4 : -3);
        return <span key={i} style={{
          position: 'absolute', left: left + '%', bottom: '14%',
          width: i % 3 === 0 ? 5 : 3, height: i % 3 === 0 ? 5 : 3, borderRadius: '50%',
          background: i % 4 === 0 ? '#fff' : '#E8CE72',
          boxShadow: '0 0 7px 1px rgba(212,175,55,.85)',
          animation: `particleRise ${2.6 + (i % 4) * 0.5}s ease-in ${(i * 0.32)}s infinite`,
        }} />;
      })}
    </div>
  );
}

function MiniStat({ label, value, active, accent, suf = '', fs = 19, lfs = 9.5 }: {
  label: string; value: number; active?: boolean; accent?: string; suf?: string; fs?: number; lfs?: number;
}) {
  const v = useCountUp(value, active);
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div className="display tnum" style={{ fontSize: fs, fontWeight: 800, color: accent || '#fff', lineHeight: 1 }}>{active ? v : value}{suf}</div>
      <div style={{ fontSize: lfs, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', marginTop: 5, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

function Spotlight({ anim }: { anim?: boolean }) {
  return (
    <div style={{
      position: 'absolute', top: -150, left: '50%', width: 300, height: 470, pointerEvents: 'none', zIndex: 1,
      background: 'linear-gradient(180deg, rgba(255,242,205,.20), rgba(255,224,160,.06) 46%, transparent 74%)',
      clipPath: 'polygon(43% 0, 57% 0, 100% 100%, 0% 100%)', filter: 'blur(7px)',
      transform: 'translateX(-50%)', transformOrigin: 'top center',
      animation: anim ? 'spotBreathe 5s ease-in-out infinite, spotSway 9s ease-in-out infinite' : 'none',
    }} />
  );
}

function Plinth({ place, first, h }: { place: number; first: boolean; h: number }) {
  const goldFace = first;
  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <div className="chrome" style={{
        height: 20, width: '100%',
        clipPath: 'polygon(7% 0, 93% 0, 100% 100%, 0 100%)',
        borderTop: `1px solid ${goldFace ? 'rgba(232,206,114,.65)' : 'rgba(255,255,255,.16)'}`,
        background: goldFace ? 'linear-gradient(180deg,#6a571f,#3a2f10)' : undefined,
      }} />
      <div style={{
        height: h, position: 'relative', overflow: 'hidden',
        background: goldFace ? 'linear-gradient(180deg,#221c0d,#0f0c05)' : 'linear-gradient(180deg,#19191c,#0c0c0d)',
        borderLeft: `1px solid ${goldFace ? 'rgba(212,175,55,.4)' : 'rgba(255,255,255,.07)'}`,
        borderRight: '1px solid rgba(0,0,0,.65)',
        boxShadow: 'inset 0 18px 32px -20px rgba(255,255,255,.16), inset 0 -34px 54px -30px rgba(0,0,0,.85)',
      }}>
        <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .55 }} />
        <div className="display" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: first ? 104 : 70, fontWeight: 900, color: goldFace ? '#D4AF37' : 'rgba(255,255,255,.11)', textShadow: goldFace ? '0 5px 26px rgba(212,175,55,.55)' : 'none', lineHeight: 1 }}>{place + 1}</div>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '12%', width: 1.5, background: 'linear-gradient(180deg, rgba(255,255,255,.18), transparent 60%)' }} />
        {goldFace && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,transparent,#E8CE72,transparent)' }} />}
      </div>
    </div>
  );
}

function Standee({ s, pl, first, active, anim }: { s: any; pl: any; first: boolean; active?: boolean; anim?: boolean }) {
  return (
    <div style={{ position: 'relative', width: '100%', marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {first && <div style={{ marginBottom: 4, color: '#E8CE72', filter: 'drop-shadow(0 6px 14px rgba(212,175,55,.85))', animation: anim ? 'floatY 3s ease-in-out infinite' : 'none', zIndex: 3 }}>
        <Icon name="crown" size={54} stroke={1.5} />
      </div>}
      {first && anim && <GoldParticles count={14} />}
      <div className="sheen" style={{
        position: 'relative', width: '100%', borderRadius: '18px 18px 4px 4px',
        background: 'linear-gradient(180deg, rgba(40,40,45,.94), rgba(17,17,19,.96))',
        border: `1px solid ${first ? 'rgba(212,175,55,.5)' : 'var(--line-dark)'}`,
        boxShadow: first ? 'inset 0 1px 0 rgba(255,255,255,.09), 0 0 0 1px rgba(212,175,55,.18), 0 26px 64px -22px rgba(212,175,55,.5)' : 'inset 0 1px 0 rgba(255,255,255,.05), 0 22px 50px -26px rgba(0,0,0,.85)',
        animation: first && anim ? 'breathe 4s ease-in-out infinite' : 'none', zIndex: 2,
      }}>
        <div style={{ height: 4, borderRadius: '18px 18px 0 0', background: first ? 'linear-gradient(90deg,#A9831F,#E8CE72,#fff7d6,#E8CE72,#A9831F)' : pl.ring }} />
        <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .35, pointerEvents: 'none', borderRadius: 18 }} />
        {first && anim && <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 18 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '38%', height: '100%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.13),transparent)', animation: 'sweep 5s ease-in-out infinite' }} />
        </div>}
        <div style={{ position: 'relative', padding: first ? '20px 18px 18px' : '15px 14px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Avatar name={s.name} size={first ? 110 : 82} ring={pl.ring} gold={first} />
            {first && anim && <div style={{ position: 'absolute', inset: -7, borderRadius: '50%', boxShadow: '0 0 30px 2px rgba(212,175,55,.5)', animation: 'spotBreathe 3.4s ease-in-out infinite', pointerEvents: 'none' }} />}
          </div>
          <div className="display" style={{ marginTop: 15, width: '100%', textAlign: 'center', fontSize: first ? 24 : 19, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>{s.name}</div>
          <div style={{ fontSize: 12, color: 'var(--txt-lo)', marginTop: 4 }}>{s.team}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: first ? 14 : 11 }}>
            <span className="display tnum" style={{ fontSize: first ? 80 : 56, fontWeight: 900, color: first ? '#E8CE72' : '#fff', lineHeight: .82, letterSpacing: '-.04em', textShadow: first ? '0 6px 32px rgba(212,175,55,.55)' : 'none' }}>
              {active ? <CountUp value={s.sales} active={active} /> : s.sales}
            </span>
            <span style={{ fontSize: 13, color: 'var(--txt-mid)', fontWeight: 600 }}>vendas</span>
          </div>
          <div style={{ marginTop: first ? 16 : 12, width: '100%', display: 'flex', gap: 6, paddingTop: first ? 14 : 11, borderTop: '1px solid var(--line-dark)' }}>
            <MiniStat label="Leads" value={s.leads} active={active} fs={first ? 24 : 20} lfs={10} />
            <MiniStat label="Visitas" value={s.visits} active={active} fs={first ? 24 : 20} lfs={10} />
            <MiniStat label="Conv." value={s.conv} suf="%" active={active} accent={first ? '#E8CE72' : undefined} fs={first ? 24 : 20} lfs={10} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PodiumA({ top3, anim, active }: { top3: any[]; anim?: boolean; active?: boolean }) {
  const order = [top3[1], top3[0], top3[2]];
  const idx = [1, 0, 2];
  const plinthH: Record<number, number> = { 0: 232, 1: 150, 2: 100 };
  const colW: Record<number, number> = { 0: 312, 1: 250, 2: 250 };
  return (
    <div style={{ position: 'relative', padding: '54px 0 30px' }}>
      <div style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', width: '116%', height: 230, background: 'radial-gradient(ellipse at 50% 12%, rgba(212,175,55,.13), transparent 60%)', pointerEvents: 'none', animation: anim ? 'floorShine 6s ease-in-out infinite' : 'none' }} />
      <div style={{ position: 'absolute', left: '4%', right: '4%', bottom: 28, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent)' }} />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 18, position: 'relative', zIndex: 2 }}>
        {order.map((s, i) => {
          const place = idx[i]; const pl = PLACE[place]; const first = place === 0;
          return (
            <div key={s.id} style={{ width: colW[place], display: 'flex', flexDirection: 'column', alignItems: 'center', animation: anim ? `riseUp .7s ${0.12 * i}s both` : 'none', position: 'relative' }}>
              {first && <Spotlight anim={anim} />}
              <Standee s={s} pl={pl} first={first} active={active} anim={anim} />
              <Plinth place={place} first={first} h={plinthH[place]} />
              <div style={{ width: '78%', height: 30, marginTop: 1, background: `radial-gradient(ellipse at 50% 0%, ${pl.glow}, transparent 72%)`, filter: 'blur(4px)', opacity: first ? .8 : .5 }} />
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: '50%', bottom: 12, width: '92%', height: 64, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 100%, rgba(190,190,205,.10), transparent 70%)', filter: 'blur(9px)', animation: anim ? 'hazeDrift 10s ease-in-out infinite' : 'none' }} />
    </div>
  );
}

function PodiumB({ top3, anim, active }: { top3: any[]; anim?: boolean; active?: boolean }) {
  const leader = top3[0];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18, padding: '6px' }}>
      <div style={{
        position: 'relative', borderRadius: 20, overflow: 'hidden', padding: 32,
        background: 'radial-gradient(120% 120% at 0% 0%, #2a2109 0%, #161616 42%, #111113 100%)',
        border: '1px solid rgba(212,175,55,.45)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 0 0 1px rgba(212,175,55,.18), 0 30px 80px -30px rgba(212,175,55,.5)',
        animation: anim ? 'riseUp .7s both' : 'none',
        display: 'flex', flexDirection: 'column',
      }}>
        {anim && <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '36%', height: '100%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.1),transparent)', animation: 'sweep 5.5s ease-in-out infinite' }} />
        </div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'linear-gradient(180deg,#E8CE72,#C9A227)', color: '#2a2104', fontWeight: 800, fontSize: 13, padding: '7px 14px', borderRadius: 999, fontFamily: 'Archivo, sans-serif', letterSpacing: '.04em' }}>
            <Icon name="crown" size={16} stroke={2} /> PRIMEIRO LUGAR
          </span>
          <span className="display" style={{ fontSize: 92, fontWeight: 900, color: 'rgba(212,175,55,.12)', lineHeight: .8 }}>01</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 18 }}>
          <div style={{ position: 'relative' }}>
            <Avatar name={leader.name} size={104} gold />
            {anim && <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', boxShadow: '0 0 34px 3px rgba(212,175,55,.5)', animation: 'goldPulse 3s ease-in-out infinite', pointerEvents: 'none' }} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="display" style={{ fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leader.name}</div>
            <div style={{ fontSize: 14, color: 'var(--txt-mid)', marginTop: 3 }}>Equipe {leader.team}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, color: '#27C75F', fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              <Icon name="trend" size={15} stroke={2.4} /> +{leader.growth}% na semana
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 24 }}>
          <span className="display tnum" style={{ fontSize: 104, fontWeight: 900, color: '#E8CE72', lineHeight: .82, letterSpacing: '-.04em', textShadow: '0 8px 40px rgba(212,175,55,.45)' }}>
            {active ? <CountUp value={leader.sales} active={active} /> : leader.sales}
          </span>
          <span style={{ fontSize: 17, color: 'var(--txt-mid)', fontWeight: 600 }}>vendas no período</span>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 24, borderTop: '1px solid var(--line-dark)' }}>
          <MiniStat label="Leads" value={leader.leads} active={active} fs={28} lfs={11} />
          <MiniStat label="Agendadas" value={leader.scheduled} active={active} fs={28} lfs={11} />
          <MiniStat label="Visitas" value={leader.visits} active={active} fs={28} lfs={11} />
          <MiniStat label="Conversão" value={leader.conv} suf="%" active={active} accent="#E8CE72" fs={28} lfs={11} />
        </div>
        {anim && <GoldParticles count={9} />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {[top3[1], top3[2]].map((s, i) => {
          const place = i + 1; const pl = PLACE[place];
          return (
            <div key={s.id} style={{
              flex: 1, borderRadius: 18, padding: 24, background: 'linear-gradient(180deg,#1a1a1d,#131315)',
              border: '1px solid var(--line-dark)', display: 'flex', alignItems: 'center', gap: 18,
              borderLeft: `4px solid ${pl.ring}`, boxShadow: 'var(--shadow-md)', animation: anim ? `riseUp .6s ${0.15 + i * 0.1}s both` : 'none',
            }}>
              <div className="display" style={{ fontSize: 42, fontWeight: 900, color: pl.ring, width: 48, textAlign: 'center' }}>{pl.tag}</div>
              <Avatar name={s.name} size={68} ring={pl.ring} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="display" style={{ fontSize: 21, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--txt-lo)' }}><b className="tnum" style={{ color: 'var(--txt-mid)' }}>{s.leads}</b> leads</span>
                  <span style={{ fontSize: 12.5, color: 'var(--txt-lo)' }}><b className="tnum" style={{ color: 'var(--txt-mid)' }}>{s.visits}</b> visitas</span>
                  <span style={{ fontSize: 12.5, color: 'var(--txt-lo)' }}><b className="tnum" style={{ color: 'var(--txt-mid)' }}>{s.conv}%</b> conv.</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="display tnum" style={{ fontSize: 48, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{active ? <CountUp value={s.sales} active={active} /> : s.sales}</div>
                <div style={{ fontSize: 11, color: 'var(--txt-lo)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600 }}>vendas</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PodiumC({ top3, anim, active }: { top3: any[]; anim?: boolean; active?: boolean }) {
  const order = [top3[1], top3[0], top3[2]];
  const idx = [1, 0, 2];
  return (
    <div style={{ position: 'relative', padding: '52px 8px 28px' }}>
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 620, height: 620, background: 'radial-gradient(circle, rgba(212,175,55,.16), transparent 62%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 34, position: 'relative' }}>
        {order.map((s, i) => {
          const place = idx[i]; const pl = PLACE[place]; const first = place === 0;
          const sz = first ? 184 : 134;
          return (
            <div key={s.id} style={{ width: first ? 300 : 232, textAlign: 'center', marginBottom: first ? 0 : 26, animation: anim ? `riseUp .7s ${0.12 * i}s both` : 'none' }}>
              <div style={{ position: 'relative', width: sz, height: sz, margin: '0 auto' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', padding: first ? 7 : 5, background: first ? 'conic-gradient(from 180deg,#A9831F,#E8CE72,#fff7d6,#E8CE72,#A9831F)' : pl.ring, boxShadow: `0 0 ${first ? 52 : 24}px ${first ? 3 : 0}px ${pl.glow}`, animation: first && anim ? 'goldPulse 3.4s ease-in-out infinite' : 'none' }}>
                  <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'radial-gradient(circle at 32% 26%, #232327, #141416)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                    <span className="display" style={{ fontSize: first ? 66 : 48, fontWeight: 800, color: first ? '#E8CE72' : '#e6e6e6' }}>{initials(s.name)}</span>
                  </div>
                </div>
                {first && <div style={{ position: 'absolute', top: -42, left: '50%', transform: 'translateX(-50%)', color: '#E8CE72', filter: 'drop-shadow(0 5px 12px rgba(212,175,55,.7))', animation: anim ? 'floatY 3s ease-in-out infinite' : 'none' }}>
                  <Icon name="crown" size={52} stroke={1.5} />
                </div>}
                <div style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', width: first ? 52 : 42, height: first ? 52 : 42, borderRadius: '50%', background: first ? 'linear-gradient(180deg,#E8CE72,#C9A227)' : '#1c1c1f', border: `2px solid ${pl.ring}`, display: 'grid', placeItems: 'center', color: first ? '#2a2104' : pl.ring, fontFamily: 'Archivo, sans-serif', fontWeight: 900, fontSize: first ? 20 : 16 }}>{place + 1}</div>
                {first && anim && <GoldParticles count={10} />}
              </div>
              <div className="display" style={{ marginTop: 24, width: '100%', textAlign: 'center', fontSize: first ? 27 : 21, fontWeight: 800, color: '#fff' }}>{s.name}</div>
              <div style={{ fontSize: 13, color: 'var(--txt-lo)', marginTop: 4 }}>{s.team}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 7, marginTop: 14 }}>
                <span className="display tnum" style={{ fontSize: first ? 64 : 46, fontWeight: 900, color: first ? '#E8CE72' : '#fff', lineHeight: 1, letterSpacing: '-.03em' }}>{active ? <CountUp value={s.sales} active={active} /> : s.sales}</span>
                <span style={{ fontSize: 14, color: 'var(--txt-mid)' }}>vendas</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-dark)' }}>
                <span style={{ fontSize: 12.5, color: 'var(--txt-lo)' }}><b className="tnum" style={{ color: 'var(--txt-mid)' }}>{s.visits}</b> visitas</span>
                <span style={{ fontSize: 12.5, color: 'var(--txt-lo)' }}><b className="tnum" style={{ color: first ? '#E8CE72' : 'var(--txt-mid)' }}>{s.conv}%</b> conv.</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PhotoSlot({ s, w, h, radius, gold, ring }: { s: any; w: number; h: number; radius: number; gold: boolean; ring: string }) {
  return (
    <div style={{
      position: 'relative', width: w, height: h, borderRadius: radius + 5, padding: 5,
      background: gold ? 'conic-gradient(from 140deg,#A9831F,#E8CE72,#fff7d6,#E8CE72,#A9831F)' : `linear-gradient(160deg, ${ring}, ${ring}55)`,
      boxShadow: gold ? '0 0 0 1px rgba(212,175,55,.35), 0 22px 60px -20px rgba(212,175,55,.6)' : '0 16px 40px -22px rgba(0,0,0,.85)',
      animation: gold ? 'goldPulse 3.6s ease-in-out infinite' : undefined,
    }}>
      <image-slot id={`podium-foto-${s.id}`} shape="rounded" radius={String(radius)} fit="cover"
        placeholder="Arraste a foto" style={{ display: 'block', width: '100%', height: '100%', borderRadius: radius + 'px', overflow: 'hidden' }}></image-slot>
      <div style={{ position: 'absolute', inset: 5, borderRadius: radius, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 0 }}>
        <span className="display" style={{ fontSize: gold ? 92 : 64, fontWeight: 900, color: 'rgba(255,255,255,.05)' }}>{initials(s.name)}</span>
      </div>
      <div style={{ position: 'absolute', left: 5, right: 5, bottom: 5, borderRadius: `0 0 ${radius}px ${radius}px`, padding: gold ? '34px 16px 14px' : '26px 13px 12px', background: 'linear-gradient(180deg, transparent, rgba(6,6,7,.62) 42%, rgba(6,6,7,.92))', pointerEvents: 'none', zIndex: 1 }}>
        <div className="display" style={{ fontSize: gold ? 23 : 18, fontWeight: 800, color: '#fff', letterSpacing: '-.01em', lineHeight: 1.05, textShadow: '0 2px 12px rgba(0,0,0,.7)' }}>{s.name}</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.7)', marginTop: 3 }}>Equipe {s.team}</div>
      </div>
    </div>
  );
}

function PodiumD({ top3, anim, active }: { top3: any[]; anim?: boolean; active?: boolean }) {
  const order = [top3[1], top3[0], top3[2]];
  const idx = [1, 0, 2];
  const photoW: Record<number, number> = { 0: 300, 1: 234, 2: 234 };
  const photoH: Record<number, number> = { 0: 360, 1: 282, 2: 282 };
  const pedH: Record<number, number> = { 0: 150, 1: 94, 2: 62 };
  return (
    <div style={{ position: 'relative', padding: '74px 0 28px' }}>
      <div style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', width: '120%', height: 250, background: 'radial-gradient(ellipse at 50% 14%, rgba(212,175,55,.16), transparent 62%)', pointerEvents: 'none', animation: anim ? 'floorShine 6s ease-in-out infinite' : 'none' }} />
      <div style={{ position: 'absolute', left: '3%', right: '3%', bottom: 26, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)' }} />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 26, position: 'relative', zIndex: 2 }}>
        {order.map((s, i) => {
          const place = idx[i]; const pl = PLACE[place]; const first = place === 0;
          return (
            <div key={s.id} style={{ width: photoW[place] + 4, display: 'flex', flexDirection: 'column', alignItems: 'center', animation: anim ? `riseUp .8s ${0.12 * i}s both` : 'none', position: 'relative' }}>
              {first && <Spotlight anim={anim} />}
              {first && <div style={{ marginBottom: 8, color: '#E8CE72', filter: 'drop-shadow(0 6px 16px rgba(212,175,55,.85))', animation: anim ? 'floatY 3s ease-in-out infinite' : 'none', zIndex: 3 }}>
                <Icon name="crown" size={58} stroke={1.5} />
              </div>}
              <div style={{ position: 'relative' }}>
                <PhotoSlot s={s} w={photoW[place]} h={photoH[place]} radius={first ? 22 : 18} gold={first} ring={pl.ring} />
                {first && anim && <GoldParticles count={14} />}
              </div>

              <div className="carbon" style={{ position: 'relative', width: '100%', marginTop: 14, borderRadius: 16, overflow: 'hidden', background: 'linear-gradient(180deg, rgba(30,30,34,.95), rgba(15,15,17,.96))', border: `1px solid ${first ? 'rgba(212,175,55,.45)' : 'var(--line-dark)'}`, boxShadow: first ? 'inset 0 1px 0 rgba(255,255,255,.08), 0 0 0 1px rgba(212,175,55,.15)' : 'inset 0 1px 0 rgba(255,255,255,.05)', animation: first && anim ? 'breathe 4s ease-in-out infinite' : 'none' }}>
                <div style={{ height: 3, background: first ? 'linear-gradient(90deg,#A9831F,#E8CE72,#A9831F)' : pl.ring }} />
                <div style={{ padding: first ? '16px 16px 14px' : '13px 13px 12px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 7 }}>
                    <span className="display tnum" style={{ fontSize: first ? 72 : 50, fontWeight: 900, color: first ? '#E8CE72' : '#fff', lineHeight: .82, letterSpacing: '-.04em', textShadow: first ? '0 6px 30px rgba(212,175,55,.5)' : 'none' }}>
                      {active ? <CountUp value={s.sales} active={active} /> : s.sales}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--txt-mid)', fontWeight: 600 }}>vendas</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: first ? 14 : 11, paddingTop: first ? 12 : 10, borderTop: '1px solid var(--line-dark)' }}>
                    <MiniStat label="Leads" value={s.leads} active={active} fs={first ? 22 : 18} lfs={9.5} />
                    <MiniStat label="Visitas" value={s.visits} active={active} fs={first ? 22 : 18} lfs={9.5} />
                    <MiniStat label="Conv." value={s.conv} suf="%" active={active} accent={first ? '#E8CE72' : undefined} fs={first ? 22 : 18} lfs={9.5} />
                  </div>
                </div>
              </div>

              <div style={{ width: '86%', position: 'relative', marginTop: 12 }}>
                <div className="chrome" style={{ height: 16, clipPath: 'polygon(6% 0, 94% 0, 100% 100%, 0 100%)', borderTop: `1px solid ${first ? 'rgba(232,206,114,.6)' : 'rgba(255,255,255,.16)'}`, background: first ? 'linear-gradient(180deg,#6a571f,#3a2f10)' : undefined }} />
                <div style={{ height: pedH[place], position: 'relative', overflow: 'hidden', background: first ? 'linear-gradient(180deg,#221c0d,#0f0c05)' : 'linear-gradient(180deg,#19191c,#0c0c0d)', borderLeft: `1px solid ${first ? 'rgba(212,175,55,.4)' : 'rgba(255,255,255,.07)'}`, borderRight: '1px solid rgba(0,0,0,.65)', boxShadow: 'inset 0 16px 30px -20px rgba(255,255,255,.16), inset 0 -30px 50px -28px rgba(0,0,0,.85)' }}>
                  <div className="carbon" style={{ position: 'absolute', inset: 0, opacity: .5 }} />
                  <div className="display" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: first ? 52 : 36, fontWeight: 900, color: first ? '#D4AF37' : pl.ring, textShadow: first ? '0 4px 22px rgba(212,175,55,.55)' : 'none' }}>{pl.tag}</div>
                  {first && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,transparent,#E8CE72,transparent)' }} />}
                </div>
                <div style={{ height: 26, background: `linear-gradient(180deg, ${pl.glow}, transparent 80%)`, opacity: first ? .7 : .4, filter: 'blur(3px)', transform: 'scaleY(-1)' }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: '50%', bottom: 10, width: '92%', height: 60, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 100%, rgba(190,190,205,.1), transparent 70%)', filter: 'blur(9px)', animation: anim ? 'hazeDrift 10s ease-in-out infinite' : 'none' }} />
    </div>
  );
}

export function Podium({ variant, top3, anim, active }: { variant: string; top3: any[]; anim?: boolean; active?: boolean }) {
  if (variant === 'B') return <PodiumB top3={top3} anim={anim} active={active} />;
  if (variant === 'C') return <PodiumC top3={top3} anim={anim} active={active} />;
  if (variant === 'D') return <PodiumD top3={top3} anim={anim} active={active} />;
  return <PodiumA top3={top3} anim={anim} active={active} />;
}
