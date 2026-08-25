// lib/date/timezoneOptions.ts — lista de sugestão de timezones IANA para
// campos de fuso horário (originalmente em ScreenEmpresas.tsx, M1-F S3-B;
// extraída aqui em COMPANY-SETTINGS-R1-EXEC para ser reaproveitada também
// por ScreenAjustes > Empresa — mesma lista, uma única fonte).
//
// Mecanismo NATIVO do navegador para listar timezones IANA — sem lista
// externa, sem rede. Intl.supportedValuesOf é suportado nos navegadores/
// Node atuais; navegadores antigos caem numa lista curta e conhecida (o
// campo continua sendo um <input> livre com sugestões — nunca bloqueia um
// valor fora da lista, o backend (update_company_settings/create_company)
// é quem valida de verdade).
const FALLBACK_TIMEZONES = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Bahia', 'America/Fortaleza',
  'America/Belem', 'America/Recife', 'America/Cuiaba', 'America/Rio_Branco',
];

export function listTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.('timeZone');
    if (Array.isArray(supported) && supported.length > 0) return supported;
  } catch {
    // Intl.supportedValuesOf ausente — cai no fallback abaixo.
  }
  return FALLBACK_TIMEZONES;
}
