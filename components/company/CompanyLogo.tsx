// components/company/CompanyLogo.tsx — COMPANY-IDENTITY-LOGO-R1-EXEC.
// Componente pequeno e reutilizável para identidade visual da empresa
// (Rail/shell + Ajustes > Empresa). Mesmo espírito visual de Avatar
// (components/ui/kit.tsx), mas com cantos arredondados (não circular) —
// distingue visualmente "logo de empresa" de "avatar de pessoa" — e com um
// contrato de fallback próprio (§27/§28/§29 do EXEC):
//   - logoPath válido + <img> carrega: mostra a imagem (object-fit: contain).
//   - sem logoPath, ou <img> falha ao carregar: iniciais reais (nunca uma
//     logo fake/placeholder). Falha de imagem nunca repete a mesma request
//     em loop — onError marca o estado uma única vez.
'use client';
import React, { useState } from 'react';
import { initials, ringFor } from '@/lib/data';
import { getCompanyLogoPublicUrl } from '@/lib/companies/logoStorage';

export function CompanyLogo({ name, logoPath, size = 40, radius }: {
  name: string;
  logoPath?: string | null;
  size?: number;
  radius?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // Reseta o estado de erro quando o logoPath muda de verdade (troca real
  // de logo) — nunca fica preso ao erro de uma logo antiga depois de uma
  // troca bem-sucedida. Ajuste de estado durante o render (padrão React
  // documentado), não um useEffect — evita um frame extra com o fallback
  // errado antes de recarregar.
  const [trackedLogoPath, setTrackedLogoPath] = useState(logoPath);
  if (logoPath !== trackedLogoPath) {
    setTrackedLogoPath(logoPath);
    setImgFailed(false);
  }

  const hasLogo = typeof logoPath === 'string' && logoPath.trim() !== '' && !imgFailed;
  const br = radius ?? Math.round(size * 0.28);

  if (hasLogo) {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: br, flexShrink: 0, overflow: 'hidden',
          background: '#fff', display: 'grid', placeItems: 'center',
          boxShadow: '0 0 0 1px rgba(255,255,255,.10), inset 0 1px 0 rgba(255,255,255,.08)',
        }}
      >
        <img
          src={getCompanyLogoPublicUrl(logoPath as string)}
          alt={name}
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    );
  }

  const r = ringFor(name);
  const fs = Math.round(size * 0.38);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: br, flexShrink: 0,
        display: 'grid', placeItems: 'center', position: 'relative',
        background: 'radial-gradient(circle at 32% 26%, #2c2c30, #161618)',
        color: '#fff', fontFamily: 'Archivo, sans-serif', fontWeight: 700, fontSize: fs,
        boxShadow: `0 0 0 ${Math.max(2, size * 0.05)}px ${r}cc, inset 0 1px 0 rgba(255,255,255,.08)`,
        letterSpacing: '.02em',
      }}
    >
      {initials(name)}
    </div>
  );
}
