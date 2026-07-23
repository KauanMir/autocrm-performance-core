// lib/hooks/useCreateInvite.ts — mutation de criação de convite (M1-F
// S4-F2). Mesmo molde de useCreateCompany.ts: identidade vem por parâmetro
// (nada de AuthService aqui — nem para o profile, nem para o access
// token), invariantes locais lançam ANTES de qualquer rede, geração de
// cache capturada antes do fetch e reconferida depois (resultado tardio
// após troca de identidade é descartado).
//
// `actor` é a peça central de segurança do formulário: quando
// actor.kind é 'manager', role_kind/company_id do formulário são
// IGNORADOS — o payload real vem sempre de actor.companyId
// (activeMembership.companyId, resolvido pelo chamador a cada render, ver
// components/screens/ScreensBiz.tsx). Isso é o que impede um Manager de
// adulterar role/companyId por DOM/estado local: mesmo que o formulário
// carregasse um valor diferente por algum bug de UI, o valor que sai para a
// rede nunca vem do formulário nesse caso.
//
// `kind` (string), não um booleano isSuperAdmin — discriminant literal por
// STRING narrowa de forma confiável neste projeto (strict:false no
// tsconfig raiz desliga parte do narrowing de CFA para discriminantes
// booleanos; comprovado empiricamente, mesmo padrão já usado em
// AdminInviteScope, lib/invites/queryKeys.ts).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueryCacheGeneration } from '@/lib/query/cacheIdentity';
import {
  createInviteRequest,
  type CreateInviteResult,
  type CreateInviteRoleKind,
} from '@/lib/invites/createInviteRequest';

export type CreateInviteActor =
  | { kind: 'super_admin' }
  | { kind: 'manager'; companyId: string };

export type CreateInviteFormInput = {
  name: string;
  email: string;
  // Só usado quando actor.kind === 'super_admin'. Manager sempre envia
  // 'seller', role_kind aqui é ignorado nesse caso.
  roleKind: CreateInviteRoleKind;
  // Só usado quando actor.kind === 'super_admin' E roleKind !== 'super_admin'.
  companyId: string | null;
  // Opcional: abortado pelo chamador (modal desmontado/fechado) — repassado
  // direto ao fetch em createInviteRequest. useMutation do TanStack Query
  // não injeta signal automaticamente para mutations (só para queries).
  signal?: AbortSignal;
};

export type UseCreateInviteOptions = {
  userId?: string | null;
  authorized: boolean;
  actor: CreateInviteActor | null;
  // Resolvido pelo chamador (nunca lido aqui via AuthService) — token
  // FRESCO buscado no momento do submit, nunca cacheado de um render
  // anterior. null quando não há sessão válida.
  getAccessToken: () => Promise<string | null>;
};

export const CREATE_INVITE_LOCAL_ERRORS = {
  notAllowed: 'create-invite-not-allowed',
  missingUser: 'create-invite-missing-user',
  missingActor: 'create-invite-missing-actor',
  blankName: 'create-invite-blank-name',
  invalidEmail: 'create-invite-invalid-email',
  missingCompany: 'create-invite-missing-company',
  missingSession: 'create-invite-missing-session',
  staleIdentity: 'create-invite-stale-identity',
} as const;

// RFC 5322 completo é fora de escopo — mesmo padrão "razoável, não
// exaustivo" já aceito no backend (ver validação de e-mail em
// create_invite/route.ts, que só rejeita vazio; o formato real é
// responsabilidade da UI, o backend nunca confia cegamente nele de
// qualquer forma).
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UseCreateInviteResult = {
  createInvite: (input: CreateInviteFormInput) => Promise<CreateInviteResult>;
  isPending: boolean;
  reset: () => void;
};

// Mensagens amigáveis ESTÁVEIS — nunca o texto bruto do backend, nunca
// SQLSTATE, nunca stack. Aceita tanto o erro LOCAL (lançado antes da rede,
// via mutation.error) quanto o CreateInviteResult resolvido pela rede
// (outcome !== 'ok') — um único ponto de mapeamento para os dois casos,
// reaproveitando o catálogo real de lib/server/invites/errors.ts (os
// `code` abaixo são exatamente os InviteErrorCode possíveis nessa rota).
export function getCreateInviteErrorMessage(value: unknown): string {
  const localMessage = value instanceof Error ? value.message : undefined;

  switch (localMessage) {
    case CREATE_INVITE_LOCAL_ERRORS.notAllowed:
      return 'Você não tem permissão para convidar usuários.';
    case CREATE_INVITE_LOCAL_ERRORS.missingUser:
    case CREATE_INVITE_LOCAL_ERRORS.missingSession:
      return 'Sua sessão expirou. Faça login novamente.';
    case CREATE_INVITE_LOCAL_ERRORS.missingActor:
      return 'Não foi possível confirmar sua permissão. Recarregue a página.';
    case CREATE_INVITE_LOCAL_ERRORS.blankName:
      return 'Informe o nome da pessoa convidada.';
    case CREATE_INVITE_LOCAL_ERRORS.invalidEmail:
      return 'Informe um e-mail válido.';
    case CREATE_INVITE_LOCAL_ERRORS.missingCompany:
      return 'Selecione a empresa do convite.';
    case CREATE_INVITE_LOCAL_ERRORS.staleIdentity:
      return 'A sessão mudou antes da conclusão do envio. Tente novamente.';
    default:
      break;
  }

  const result = value as { outcome?: string; code?: string } | null | undefined;
  if (result?.outcome === 'rate_limited') {
    return 'Muitas tentativas em pouco tempo. Aguarde antes de tentar novamente.';
  }
  if (result?.outcome === 'domain_error') {
    switch (result.code) {
      case 'invalid_body':
      case 'invalid_input':
        return 'Não foi possível enviar o convite. Verifique os dados e tente novamente.';
      case 'unauthenticated':
        return 'Sua sessão expirou. Faça login novamente.';
      case 'forbidden':
      case 'invalid_origin':
        return 'Você não tem permissão para enviar este convite.';
      case 'duplicate_pending':
        return 'Já existe um convite pendente para este e-mail nesta empresa.';
      case 'already_member':
        return 'Esta pessoa já faz parte da empresa.';
      case 'not_eligible':
        return 'Esta pessoa já está vinculada a outra empresa e não pode ser convidada aqui.';
      case 'token_conflict':
        return 'Não foi possível gerar o convite. Tente novamente.';
      case 'invalid_role':
        return 'Função ou empresa inválida para este convite.';
      case 'invalid_company':
        return 'Selecione uma empresa válida.';
      case 'company_not_operational':
        return 'Esta empresa não está disponível para novos convites no momento.';
      case 'body_too_large':
        return 'Os dados enviados são grandes demais.';
      case 'invite_not_found':
      case 'invite_not_actionable':
        return 'Não foi possível processar este convite.';
      case 'delivery_failed':
        return 'O convite foi criado, mas o e-mail não pôde ser enviado agora.';
      case 'auth_unavailable':
        return 'Serviço de autenticação indisponível no momento. Tente novamente em instantes.';
      case 'delivery_finalize_failed':
        return 'O convite foi criado, mas houve uma falha ao confirmar o envio.';
      default:
        return 'Não foi possível enviar o convite. Tente novamente.';
    }
  }
  if (result?.outcome === 'error') {
    return 'Não foi possível enviar o convite. Verifique sua conexão e tente novamente.';
  }

  return 'Não foi possível enviar o convite. Tente novamente.';
}

function resolveInvitePayload(
  actor: CreateInviteActor,
  form: CreateInviteFormInput,
): { roleKind: CreateInviteRoleKind; companyId: string | null } {
  if (actor.kind === 'manager') {
    // Manager: NUNCA lê form.roleKind/form.companyId — sempre a própria
    // membership ativa, resolvida no render atual pelo chamador.
    return { roleKind: 'seller', companyId: actor.companyId };
  }
  if (form.roleKind === 'super_admin') {
    return { roleKind: 'super_admin', companyId: null };
  }
  if (!form.companyId) throw new Error(CREATE_INVITE_LOCAL_ERRORS.missingCompany);
  return { roleKind: form.roleKind, companyId: form.companyId };
}

export function useCreateInvite(options: UseCreateInviteOptions): UseCreateInviteResult {
  const { userId, authorized, actor, getAccessToken } = options;
  const queryClient = useQueryClient();

  const mutation = useMutation<CreateInviteResult, unknown, CreateInviteFormInput>({
    mutationFn: async (form) => {
      // Invariantes locais — falham ANTES de qualquer chamada de rede.
      if (!authorized) throw new Error(CREATE_INVITE_LOCAL_ERRORS.notAllowed);
      if (!userId) throw new Error(CREATE_INVITE_LOCAL_ERRORS.missingUser);
      if (!actor) throw new Error(CREATE_INVITE_LOCAL_ERRORS.missingActor);

      const name = form.name.trim();
      const email = form.email.trim();
      if (name === '') throw new Error(CREATE_INVITE_LOCAL_ERRORS.blankName);
      if (!EMAIL_PATTERN.test(email)) throw new Error(CREATE_INVITE_LOCAL_ERRORS.invalidEmail);

      const { roleKind, companyId } = resolveInvitePayload(actor, form);

      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(CREATE_INVITE_LOCAL_ERRORS.missingSession);

      // Geração capturada IMEDIATAMENTE antes do fetch: se a identidade
      // mudar enquanto ele voa, o resultado é descartado (mesmo padrão de
      // useCreateCompany/useReorderStages).
      const generationAtStart = getQueryCacheGeneration(queryClient);

      const result = await createInviteRequest({ companyId, email, name, roleKind }, accessToken, form.signal);

      if (getQueryCacheGeneration(queryClient) !== generationAtStart) {
        throw new Error(CREATE_INVITE_LOCAL_ERRORS.staleIdentity);
      }

      return result;
    },
  });

  return {
    createInvite: mutation.mutateAsync,
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
