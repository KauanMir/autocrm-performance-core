import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'KAPA CRM | Ranking & Operação',
};

// MOBILE-RESPONSIVENESS-V1-B1-EXEC §17 — metadata de viewport para mobile.
// `viewportFit: 'cover'` habilita os env(safe-area-inset-*) usados pelo
// MobileHeader/Drawer (§18). `interactiveWidget: 'resizes-content'` faz o
// teclado virtual reduzir o layout em vez de sobrepor (evita CTA preso
// atrás do teclado).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'image-slot': any;
    }
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Script src="/image-slot.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
