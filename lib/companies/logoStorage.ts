// lib/companies/logoStorage.ts — COMPANY-IDENTITY-LOGO-R1-EXEC. Único ponto
// de acesso a supabase.storage.from('company-logos') no app: gera o object
// path versionado, faz upload/remoção do objeto e resolve a URL pública.
// Nunca grava companies.logo_path (isso é exclusivo de update_company_logo,
// via lib/companies/repository.ts) — este módulo só fala com o Storage.
import { supabase } from '@/lib/supabase/client';
import { PlatformCompanyError } from '@/lib/companies/errors';

export const COMPANY_LOGO_BUCKET = 'company-logos';
export const COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — mesmo limite do bucket (server-side é a autoridade real)
export const COMPANY_LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type CompanyLogoMimeType = typeof COMPANY_LOGO_ALLOWED_MIME_TYPES[number];

function isAllowedMimeType(mime: string): mime is CompanyLogoMimeType {
  return (COMPANY_LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

function extensionForMime(mime: CompanyLogoMimeType): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg'; // image/jpeg
}

export type CompanyLogoValidationError = 'invalid_type' | 'too_large';

// Validação client-side (§34 do EXEC): só para feedback rápido — o backend
// (contrato do bucket, aplicado pelo Storage API) continua sendo a
// autoridade real, nunca confiado apenas por este check.
export function validateCompanyLogoFile(file: File): CompanyLogoValidationError | null {
  if (!isAllowedMimeType(file.type)) return 'invalid_type';
  if (file.size > COMPANY_LOGO_MAX_BYTES) return 'too_large';
  return null;
}

// Path versionado (§6/§15 do EXEC): cada upload recebe um object path NOVO
// — nunca reaproveita o path antigo, nunca aceita nome vindo do usuário.
// crypto.randomUUID() é o "mecanismo seguro já disponível no browser"
// citado no EXEC.
export function buildCompanyLogoObjectPath(companyId: string, mimeType: CompanyLogoMimeType): string {
  return `${companyId}/logos/${crypto.randomUUID()}.${extensionForMime(mimeType)}`;
}

export async function uploadCompanyLogoObject(objectPath: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(COMPANY_LOGO_BUCKET).upload(objectPath, file, {
    contentType: file.type,
    // path sempre novo (§6 do EXEC) — upsert nunca é o mecanismo de troca,
    // um path colidindo aqui seria anômalo (UUID), nunca esperado.
    upsert: false,
  });

  if (error) {
    throw new PlatformCompanyError('platform_companies_logo_upload_failed', {
      message: typeof error.message === 'string' ? error.message : undefined,
    });
  }
}

// Nunca lança (§19/§20/§21 do EXEC): falha ao remover um objeto (novo, em
// compensação de erro da RPC, ou antigo, após troca/remoção confirmada)
// nunca pode derrubar um fluxo já decidido — o chamador decide o que fazer
// com o booleano de sucesso.
export async function deleteCompanyLogoObject(objectPath: string): Promise<boolean> {
  const { error } = await supabase.storage.from(COMPANY_LOGO_BUCKET).remove([objectPath]);
  return !error;
}

// URL pública resolvida em runtime (§26 do EXEC) — nunca persistida. Como
// paths são versionados, trocar a logo naturalmente gera uma URL diferente
// (sem necessidade de cache-bust no mesmo path).
export function getCompanyLogoPublicUrl(objectPath: string): string {
  return supabase.storage.from(COMPANY_LOGO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}
