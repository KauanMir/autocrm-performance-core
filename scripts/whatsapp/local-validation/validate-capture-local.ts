// scripts/whatsapp/local-validation/validate-capture-local.ts — entrada do validador.
// Só para Supabase LOCAL: o core recusa qualquer host que não seja local. Não carrega
// arquivos .env. Procedimento em docs/WHATSAPP-CLOUD-API.md.
import { runLocalCaptureValidation } from './validate-capture-local-core';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name}`);
  return value;
};

async function main(): Promise<number> {
  const results = await runLocalCaptureValidation({
    url: required('WA_LOCAL_SUPABASE_URL'),
    serviceRoleKey: required('WA_LOCAL_SERVICE_ROLE_KEY'),
    anonKey: required('WA_LOCAL_ANON_KEY'),
    jwtSecret: required('WA_LOCAL_JWT_SECRET'),
    parallelism: Number(process.env.WA_LOCAL_PARALLELISM ?? 20),
  });
  for (const { name, pass, detail } of results) {
    // eslint-disable-next-line no-console
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  }
  return results.every(({ pass }) => pass) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: Error) => {
    // eslint-disable-next-line no-console
    console.error(`FAIL ${error.message}`);
    process.exit(2);
  },
);
