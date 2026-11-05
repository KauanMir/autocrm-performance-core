// scripts/whatsapp/local-validation/validate-capture-local-core.ts — verificações da
// W2B-4 contra Supabase LOCAL: papéis com JWT, PostgREST real e concorrência. Cada
// requisição paralela usa uma conexão do pool do PostgREST, então as transações
// disputam de verdade. Recusa qualquer host que não seja local. Dados fictícios.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

export const LOCAL_TEST_COMPANY_ID = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
export const LOCAL_CONNECTION_ID = 'fa7a0000-0000-4000-8000-00000000000a';
export const LOCAL_WABA_ID = '710000000000071';
export const LOCAL_PHONE_NUMBER_ID = '810000000000071';
export const LOCAL_SUPER_ADMIN_ID = 'fa700000-0000-4000-8000-000000000001';
export const LOCAL_COMMON_USER_ID = 'fa700000-0000-4000-8000-000000000002';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface LocalValidationConfig {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
  jwtSecret: string;
  parallelism: number;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export function assertLocalSupabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('local_url_invalid');
  }
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error('local_url_required');
  return url;
}

export function signLocalJwt(claims: { sub: string; role: string }, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    ...claims,
    aud: claims.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const randomHex = () => randomBytes(32).toString('hex');

export async function runLocalCaptureValidation(
  config: LocalValidationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult[]> {
  const base = assertLocalSupabaseUrl(config.url).origin;
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail = '') => results.push({ name, pass, detail });

  const call = async (path: string, token: string, body?: unknown) => {
    const response = await fetchImpl(`${base}/rest/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as unknown;
    return { status: response.status, data };
  };

  const capture = (over: { hash?: string; phoneHmac?: string | null; bsuidHmac?: string | null }, token = config.serviceRoleKey) =>
    call('rpc/whatsapp_inbound_message_capture', token, {
      p_connection_id: LOCAL_CONNECTION_ID,
      p_expected_company_id: LOCAL_TEST_COMPANY_ID,
      p_phone_number_id: LOCAL_PHONE_NUMBER_ID,
      p_waba_id: LOCAL_WABA_ID,
      p_message_id_hash: over.hash ?? randomHex(),
      p_message_type: 'text',
      p_occurred_at: new Date().toISOString(),
      p_received_at: new Date().toISOString(),
      p_request_id: randomUUID(),
      p_bsuid_hmac: over.bsuidHmac ?? null,
      p_phone_hmac: over.phoneHmac ?? null,
      p_hmac_key_version: 1,
      p_pii_ciphertext: 'v1.local.fixture.pii',
      p_pii_ref: randomUUID(),
      p_pii_key_version: 1,
      p_pii_has_phone: Boolean(over.phoneHmac),
      p_content_ciphertext: 'v1.local.fixture.content',
      p_content_key_version: 1,
    });

  const summary = async () => {
    const { data } = await call('rpc/whatsapp_diagnostics_summary', config.serviceRoleKey, {
      p_company_id: LOCAL_TEST_COMPANY_ID,
    });
    return (Array.isArray(data) ? data[0] : {}) as Record<string, number>;
  };

  const outcomes = (responses: Array<{ data: unknown }>) =>
    responses.map(({ data }) => (Array.isArray(data) ? (data[0] as { out_outcome?: string })?.out_outcome : undefined));

  const superToken = signLocalJwt({ sub: LOCAL_SUPER_ADMIN_ID, role: 'authenticated' }, config.jwtSecret);
  const commonToken = signLocalJwt({ sub: LOCAL_COMMON_USER_ID, role: 'authenticated' }, config.jwtSecret);

  // Papéis
  const denied = (status: number) => status === 401 || status === 403;
  check('anon não executa a captura', denied((await capture({ phoneHmac: randomHex() }, config.anonKey)).status));
  check('authenticated não executa a captura', denied((await capture({ phoneHmac: randomHex() }, commonToken)).status));
  check('authenticated não lê mensagens', denied((await call('whatsapp_messages', commonToken)).status));
  check('service_role não lê mensagens diretamente', denied((await call('whatsapp_messages', config.serviceRoleKey)).status));

  const superCheck = await call('rpc/is_platform_super_admin', superToken, {});
  check('Super Admin é reconhecido pelo JWT', superCheck.data === true, JSON.stringify(superCheck.data));
  const commonCheck = await call('rpc/is_platform_super_admin', commonToken, {});
  check('usuário comum não é Super Admin', commonCheck.data === false, JSON.stringify(commonCheck.data));

  // Mesma mensagem em paralelo: uma captura, o resto duplicado, nenhum erro.
  const samePhone = randomHex();
  const sameHash = randomHex();
  const same = await Promise.all(
    Array.from({ length: config.parallelism }, () => capture({ hash: sameHash, phoneHmac: samePhone })),
  );
  const sameOutcomes = outcomes(same);
  check(
    'mesma mensagem em paralelo gera uma única captura',
    same.every(({ status }) => status === 200) &&
      sameOutcomes.filter((outcome) => outcome === 'captured').length === 1 &&
      sameOutcomes.filter((outcome) => outcome === 'duplicate').length === config.parallelism - 1,
    sameOutcomes.join(','),
  );

  // Contato novo em paralelo: um contato e uma conversa.
  const before = await summary();
  const newPhone = randomHex();
  const distinct = await Promise.all(
    Array.from({ length: config.parallelism }, () => capture({ phoneHmac: newPhone })),
  );
  const afterDistinct = await summary();
  check(
    'mensagens paralelas de contato novo criam um contato',
    distinct.every(({ status }) => status === 200) &&
      afterDistinct.out_contacts_total - before.out_contacts_total === 1 &&
      afterDistinct.out_conversations_total - before.out_conversations_total === 1,
    `contatos +${afterDistinct.out_contacts_total - before.out_contacts_total}`,
  );

  // Telefone e BSUID cruzados: sem erro, sem deadlock aparente e sem contato duplicado.
  const crossPhone = randomHex();
  const crossBsuid = randomHex();
  const crossed = await Promise.all(
    Array.from({ length: config.parallelism }, (_, index) =>
      capture(index % 2 === 0 ? { phoneHmac: crossPhone, bsuidHmac: crossBsuid } : { bsuidHmac: crossBsuid, phoneHmac: crossPhone }),
    ),
  );
  const afterCrossed = await summary();
  check(
    'telefone e BSUID em paralelo não duplicam contato',
    crossed.every(({ status }) => status === 200) && afterCrossed.out_contacts_total - afterDistinct.out_contacts_total === 1,
    `contatos +${afterCrossed.out_contacts_total - afterDistinct.out_contacts_total}`,
  );

  return results;
}
