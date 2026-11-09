// tests/integration/whatsapp/support/pglite-database.ts — banco Postgres em memória
// para validar as migrations e as RPCs do WhatsApp sem Docker. Sem rede e sem banco
// real. Limites: conexão única, sem concorrência real, e auth/storage simulados.
// A validação definitiva é em Supabase local, ver docs/WHATSAPP-CLOUD-API.md.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const ROOT = process.cwd();
const support = (file: string) => readFileSync(resolve(ROOT, 'tests/integration/whatsapp/support', file), 'utf8');

export interface PgTapResult {
  total: number;
  failures: Array<{ descr: string; detail: string | null }>;
}

export interface WhatsAppTestDatabase {
  db: PGlite;
  appliedMigrations: number;
  runPgTap(file: string): Promise<PgTapResult>;
  clearWhatsAppData(): Promise<void>;
}

export async function createWhatsAppTestDatabase(): Promise<WhatsAppTestDatabase> {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, uuid_ossp } });
  await db.exec(support('supabase-stub.sql'));
  await db.exec('set session authorization app_owner');

  const directory = resolve(ROOT, 'supabase/migrations');
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(resolve(directory, file), 'utf8'));
  }
  await db.exec(support('pgtap-shim.sql'));

  const clearWhatsAppData = async () => {
    await db.exec(`
      truncate public.whatsapp_messages, public.whatsapp_conversations, public.whatsapp_contacts,
        public.whatsapp_webhook_events, public.whatsapp_connections cascade;
      delete from public.audit_log where action like 'whatsapp%';
      delete from public.profiles where id::text like 'fa%';
      delete from auth.users where id::text like 'fa%';
      delete from public.companies where id::text like 'fa%' or id = '0dfc73ee-bca9-4fdf-aa50-b227940b2869';
    `);
  };

  const runPgTap = async (file: string): Promise<PgTapResult> => {
    // O rollback do arquivo sai para ler os resultados dentro da transação. Depois ele
    // é executado de verdade: um commit aqui tornaria permanente o que o teste faz,
    // como remover a trava da TEST COMPANY para simular duas empresas.
    const sql = readFileSync(resolve(ROOT, 'supabase/tests', file), 'utf8')
      .replace(/create extension if not exists pgtap;/, '')
      .replace(/\brollback;\s*$/, '');
    await db.exec('truncate tap.results restart identity');
    let rows: Array<{ pass: boolean; descr: string; detail: string | null }>;
    try {
      await db.exec(sql);
      ({ rows } = await db.query<{ pass: boolean; descr: string; detail: string | null }>(
        'select pass, descr, detail from tap.results order by n',
      ));
    } finally {
      await db.exec('rollback');
    }
    return {
      total: rows.length,
      failures: rows.filter((row) => !row.pass).map(({ descr, detail }) => ({ descr, detail })),
    };
  };

  return { db, appliedMigrations: files.length, runPgTap, clearWhatsAppData };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bearerClaims(headers: Headers): { role: string; sub: string | null } {
  const token = (headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const payload = token.split('.')[1];
  if (!payload) return { role: 'service_role', sub: null };
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: string; sub?: string };
  return { role: claims.role ?? 'anon', sub: claims.sub ?? null };
}

interface FunctionParameter {
  name: string;
  type: string;
  required: boolean;
}

async function loadFunction(
  db: PGlite,
  name: string,
): Promise<{ parameters: FunctionParameter[]; returnsSet: boolean } | null> {
  const { rows } = await db.query<{ args: string; returns_set: boolean }>(
    `select pg_get_function_arguments(p.oid) as args, p.proretset as returns_set from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [name],
  );
  if (rows.length !== 1) return null;
  const { args, returns_set: returnsSet } = rows[0];
  if (args === '') return { parameters: [], returnsSet };
  return {
    returnsSet,
    parameters: args.split(', ').map((argument) => {
      const [declaration] = argument.split(' DEFAULT ');
      const space = declaration.indexOf(' ');
      return {
        name: declaration.slice(0, space),
        type: declaration.slice(space + 1),
        required: !argument.includes(' DEFAULT '),
      };
    }),
  };
}

export interface PostgrestBridgeOptions {
  // RPC que deve responder erro, para simular falha transitória.
  failRpc?: () => string | null;
  onCall?: (name: string) => void;
}

// Imita o PostgREST: resolve a função pelo conjunto de parâmetros, recusa nomes
// divergentes (PGRST202) e executa com o papel do JWT, em transação. Conexão única:
// as requisições rodam em série, então isto não prova concorrência.
export function createPostgrestBridge(db: PGlite, options: PostgrestBridgeOptions = {}): typeof fetch {
  const withRole = async <T>(headers: Headers, run: (tx: Parameters<Parameters<PGlite['transaction']>[0]>[0]) => Promise<T>) => {
    const { role, sub } = bearerClaims(headers);
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role === 'service_role' || role === 'authenticated' ? role : 'anon'}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
      return run(tx);
    });
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);

    try {
      // Identifiers may contain digits (e.g. meta_leadgen_event_complete_v2).
      const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
      if (!rpc) {
        const table = /\/rest\/v1\/([a-z0-9_]+)$/.exec(url.pathname);
        if (!table) throw new Error(`rota inesperada: ${url.pathname}`);
        const rows = await withRole(headers, async (tx) => (await tx.query(`select * from public.${table[1]}`)).rows);
        return jsonResponse(200, rows);
      }

      const name = rpc[1];
      options.onCall?.(name);
      if (options.failRpc?.() === name) return jsonResponse(500, { code: 'XX000', message: 'falha simulada' });

      const target = await loadFunction(db, name);
      const parameters = target?.parameters ?? null;
      const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const names = Object.keys(args);
      const matches =
        parameters !== null &&
        names.every((key) => parameters.some((parameter) => parameter.name === key)) &&
        parameters.filter((parameter) => parameter.required).every((parameter) => names.includes(parameter.name));
      if (!matches) return jsonResponse(404, { code: 'PGRST202', message: 'function not found' });

      const list = names
        .map((key, index) => `${key} := $${index + 1}::text::${(parameters ?? []).find((p) => p.name === key)?.type}`)
        .join(', ');
      const values = names.map((key) => {
        const value = args[key];
        if (value === null) return null;
        // json/jsonb parameters receive the JSON text itself, as PostgREST does.
        const type = (parameters ?? []).find((p) => p.name === key)?.type ?? '';
        if (/^jsonb?$/.test(type)) return JSON.stringify(value);
        // PostgREST sends JSON arrays; PostgreSQL expects array-literal syntax
        // when this bridge casts the supplied value through text.
        if (Array.isArray(value)) return `{${value.map((item) => item === null ? 'NULL' : JSON.stringify(String(item))).join(',')}}`;
        return String(value);
      });
      const rows = await withRole(
        headers,
        async (tx) => (await tx.query<Record<string, unknown>>(`select * from public.${name}(${list})`, values)).rows,
      );
      // Como o PostgREST: função escalar devolve o valor, não uma linha.
      return jsonResponse(200, target?.returnsSet ? rows : Object.values(rows[0] ?? {})[0] ?? null);
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      return jsonResponse(code === '42501' ? 403 : 400, { code, message });
    }
  }) as typeof fetch;
}
