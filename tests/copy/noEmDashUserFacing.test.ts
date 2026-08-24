// KAPA-CRM-COPY-CLEANUP-R1-EXEC — guarda de regressão simples (não um
// parser completo): escaneia os arquivos user-facing conhecidos e falha se
// encontrar o em dash (U+2014, "—") fora de comentários. Objetivo é reduzir
// a chance de "—" voltar por acidente em copy visível ao usuário — não
// substitui o audit manual feito no lote, só protege o resultado dele.
//
// stripComments é deliberadamente simples: remove linhas que são
// comentário puro (// ou * de bloco), corta blocos /* ... */ (inclusive
// {/* JSX */}, que por baixo também é /* */) e corta comentários // no
// final da linha. Não entende strings contendo "//" (ex.: uma URL) — se
// isso um dia colidir com um "—" real na mesma linha, o teste pode não
// detectar; aceitável para uma guarda simples (R1-EXEC §11: "não criar
// parser complexo").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const USER_FACING_FILES = [
  'components/screens/Home.tsx',
  'components/screens/ScreensBiz.tsx',
  'components/screens/ScreensOps.tsx',
  'components/screens/ScreenEmpresas.tsx',
  'components/flows/Flows2.tsx',
  'components/flows/FlowsShared.tsx',
  'components/flows/FlowLayer.tsx',
  'components/flows/Flows3.tsx',
  'components/App.tsx',
  'components/auth/AuthFlow.tsx',
  'components/invites/AcceptInviteFlow.tsx',
  'components/invites/InviteUserModal.tsx',
  'components/invites/PasswordStep.tsx',
  'components/invites/InviteList.tsx',
  'components/commercial/CommercialWorkspaceHeader.tsx',
  'components/commercial/PlatformCommercialClientsView.tsx',
  'components/commercial/PlatformCommercialPipelineView.tsx',
  'components/commercial/PlatformLeadCreateModal.tsx',
  'components/commercial/PlatformLeadEditModal.tsx',
  'components/commercial/PlatformLeadDetails.tsx',
  'components/users/ActiveUserList.tsx',
  'components/users/InactiveUserList.tsx',
  'components/users/OffboardManagerModal.tsx',
  'components/users/OffboardSellerModal.tsx',
  'components/users/SuspendMembershipModal.tsx',
  'components/users/TransferMembershipModal.tsx',
  'components/users/ReactivateMembershipModal.tsx',
  'components/users/ChangeUserEmailModal.tsx',
  'components/users/EditUserModal.tsx',
  'app/layout.tsx',
  'app/convite/aceitar/page.tsx',
  'lib/leads/adapter.ts',
  'lib/services.ts',
  'lib/commercial/leadEventRegistry.ts',
  'lib/data.ts',
] as const;

function stripComments(src: string): string {
  const lines = src.split('\n');
  const kept: string[] = [];
  let inBlockComment = false;

  for (const raw of lines) {
    let line = raw;

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }

    const blockStart = line.indexOf('/*');
    if (blockStart !== -1) {
      const blockEnd = line.indexOf('*/', blockStart + 2);
      if (blockEnd !== -1) {
        line = line.slice(0, blockStart) + line.slice(blockEnd + 2);
      } else {
        line = line.slice(0, blockStart);
        inBlockComment = true;
      }
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;

    const lineCommentIdx = line.indexOf('//');
    if (lineCommentIdx !== -1) line = line.slice(0, lineCommentIdx);

    kept.push(line);
  }

  return kept.join('\n');
}

describe('copy — nenhum em dash (—) em texto user-facing conhecido (KAPA-CRM-COPY-CLEANUP-R1-EXEC)', () => {
  it.each(USER_FACING_FILES)('%s não usa "—" fora de comentários', (relPath) => {
    const src = readFileSync(join(process.cwd(), relPath), 'utf-8');
    const code = stripComments(src);
    expect(code).not.toContain('—');
  });
});
