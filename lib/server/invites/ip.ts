// lib/server/invites/ip.ts — extração, normalização e hash de IP para o
// rate limit por IP do endpoint público de validação de convite (M1-F
// S4-C2A). O IP normalizado NUNCA é logado, persistido ou devolvido em
// resposta — só o hash HMAC (hashIp) chega a
// reserve_invite_validation_rate_limit(p_ip_hash, ...).
import { isIP } from 'node:net';
import { createHmac } from 'node:crypto';

export class UntrustedIpSourceError extends Error {
  constructor() {
    super('invite_ip_source_untrusted');
    this.name = 'UntrustedIpSourceError';
  }
}

// Nunca um IP real — nenhum destes valores pode colidir com uma
// normalização válida de node:net.isIP (que só aceita dígitos/`:`/`.`).
const LOCAL_FALLBACK_SENTINEL = 'unknown-local-sentinel';

const HEADER_PRIORITY = ['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip'] as const;

// Limite defensivo antes de qualquer split/regex — um header com milhares
// de vírgulas/caracteres nunca deve custar processamento proporcional ao
// seu tamanho. Generoso o bastante para qualquer IPv4/IPv6 real com porta
// (o maior caso legítimo tem bem menos de 60 caracteres); qualquer coisa
// além disso é tratada como não reconhecida sem nunca ser totalmente
// inspecionada.
const MAX_HEADER_INSPECT_LENGTH = 512;

// Prefixo IPv4-mapped IPv6 (RFC 4291, ::ffff:0:0/96) — um mesmo endereço
// IPv4 real pode ser escrito tanto puro ("203.0.113.10") quanto embutido
// nesta forma ("::ffff:203.0.113.10"/"::ffff:cb00:710a"). Sem rejeitar
// esta forma, as duas notações produziriam hashes DIFERENTES para o MESMO
// IP físico — um atacante alternando entre elas dobraria (ou mais,
// combinando com outras representações) sua cota efetiva no rate limit
// por IP. Rejeitada aqui (nunca aceita como IPv6 válido para fins de
// hash) — cai no próximo header da prioridade ou no sentinela.
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i;

// Canonicaliza IPv6 via o parser de host da WHATWG URL (nativo do Node) —
// minúsculas e compressão do maior bloco de zeros consecutivos em `::`,
// garantindo que formas textuais equivalentes (expandida/comprimida)
// produzam sempre a mesma string antes do hash.
function canonicalizeIpv6(candidate: string): string | null {
  try {
    const url = new URL(`http://[${candidate}]`);
    const hostname = url.hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) {
      return null;
    }
    const inner = hostname.slice(1, -1);
    if (isIP(inner) !== 6) {
      return null;
    }
    if (IPV4_MAPPED_IPV6_PATTERN.test(inner)) {
      return null;
    }
    return inner;
  } catch {
    return null;
  }
}

// Recebe um único candidato já isolado (primeiro item de uma lista
// forwarded, ou o valor completo de um header de item único) e devolve o
// IP normalizado, ou null se não for um IPv4/IPv6 válido reconhecível.
// Formato malformado NUNCA é refletido de volta — só null.
function normalizeSingleIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  // IPv6 entre colchetes, com ou sem porta: "[::1]" / "[::1]:8080".
  const bracketMatch = /^\[(.+)\](?::\d+)?$/.exec(trimmed);
  if (bracketMatch) {
    return canonicalizeIpv6(bracketMatch[1]);
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;

  // Exatamente um `:` — só pode ser inequivocamente "IPv4:porta" (IPv6 sem
  // colchetes com um único `:` não existe). Qualquer outra contagem de
  // `:` sem colchetes é tratada como candidato IPv6 puro, nunca como porta.
  if (colonCount === 1) {
    const [host, port] = trimmed.split(':');
    if (isIP(host) === 4 && /^\d{1,5}$/.test(port) && Number(port) <= 65535) {
      return host;
    }
    return null;
  }

  if (colonCount > 1) {
    return canonicalizeIpv6(trimmed);
  }

  return isIP(trimmed) === 4 ? trimmed : null;
}

function firstForwardedItem(headerValue: string): string {
  // Corta ANTES do split: um header hostil com milhares de itens nunca é
  // materializado inteiro em memória só para descartar tudo além do
  // índice 0 — o primeiro item real (IPv4/IPv6 com porta) nunca chega
  // perto deste limite.
  const bounded = headerValue.length > MAX_HEADER_INSPECT_LENGTH
    ? headerValue.slice(0, MAX_HEADER_INSPECT_LENGTH)
    : headerValue;
  const commaIndex = bounded.indexOf(',');
  const first = commaIndex === -1 ? bounded : bounded.slice(0, commaIndex);
  return first.trim();
}

function extractFromHeaders(request: Request): string | null {
  for (const headerName of HEADER_PRIORITY) {
    const value = request.headers.get(headerName);
    if (!value) {
      continue;
    }
    const candidate = firstForwardedItem(value);
    const normalized = normalizeSingleIp(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

// Prioridade e confiança condicionadas ao ambiente real de execução:
//   - Vercel (VERCEL === '1'): os headers acima são injetados/sobrescritos
//     pela plataforma — confiáveis, nessa ordem de prioridade.
//   - development/test fora da Vercel: mesmos headers aceitos para testes
//     determinísticos (não há proxy real, mas os testes precisam de um
//     valor previsível); ausência de qualquer header cai no sentinela fixo
//     (nunca string vazia, nunca o header bruto).
//   - production fora da Vercel: NENHUM header é confiável (não há proxy
//     conhecido cujo header não seja trivialmente forjável pelo próprio
//     cliente) — falha fechado, nunca finge ter um IP real.
export function getClientIp(request: Request): string {
  const isVercel = process.env.VERCEL === '1';
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isVercel && isProduction) {
    throw new UntrustedIpSourceError();
  }

  const fromHeaders = extractFromHeaders(request);
  if (fromHeaders) {
    return fromHeaders;
  }

  return LOCAL_FALLBACK_SENTINEL;
}

// HMAC-SHA256(pepper, ipNormalizado) → hex minúsculo, 64 caracteres.
// Nunca createHash puro (sem pepper o hash seria reversível por força
// bruta sobre o espaço de IPv4).
export function hashIp(ip: string, pepper: Buffer): string {
  return createHmac('sha256', pepper).update(ip, 'utf8').digest('hex');
}
