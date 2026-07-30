// lib/hooks/useLeadDuplicateGuard.ts — orquestração de UX de duplicidade
// para os formulários remotos de Lead (M1-E, E4-B2). Envolve
// useCheckLeadPhoneDuplicate (E4-B1) — nunca o substitui, nunca decide
// "criar/salvar mesmo assim" sozinho (isso é sempre uma ação explícita do
// usuário, exposta por `needsConfirmation`/`confirm`).
//
// Contrato:
//   - debounce de 500ms após telefone válido e estável;
//   - nunca consulta com telefone vazio/inválido, fora do modo remoto ou
//     sem identidade (guardado por `enabled`, resolvido pelo chamador);
//   - resposta fora de ordem (sequence/phoneDigits do E4-B1) é descartada —
//     o resultado exibido é sempre do telefone ATUAL;
//   - confirmação fica vinculada ao phoneDigits atual: telefone muda ⇒
//     confirmação apagada, nova verificação exigida;
//   - submit SEMPRE dispara uma nova checagem (verifyBeforeSubmit) — nunca
//     confia só no resultado do debounce;
//   - erro no check é consultivo: com confirmação já dada para o mesmo
//     telefone, o submit prossegue mesmo se o recheck falhar de novo.
// Telefone nunca é persistido em query key, URL, localStorage ou log —
// tudo aqui é estado React efêmero.
import { useEffect, useRef, useState } from 'react';
import { normalizeLeadPhoneDigits } from '@/lib/leads/remoteMutationRepository';
import type { RemoteLeadDuplicateRow } from '@/lib/leads/remoteMutationRepository';
import type {
  CheckLeadPhoneDuplicateOutcome,
  UseCheckLeadPhoneDuplicateResult,
} from '@/lib/hooks/useCheckLeadPhoneDuplicate';

export type LeadDuplicateGuardStatus = 'idle' | 'checking' | 'checked' | 'error';

export type SubmitVerification = 'proceed' | 'needs_confirmation' | 'check_failed';

export type UseLeadDuplicateGuardOptions = {
  phone: string;
  isPhoneValid: boolean;
  excludeLeadId?: string;
  // Resolvido pelo chamador (dataSource==='remote' && capability aplicável
  // && identidade disponível) — nunca lido daqui.
  enabled: boolean;
  // Muda em logout/troca de empresa/membership — reseta status/confirmação.
  identityKey: string | null;
  duplicateCheck: UseCheckLeadPhoneDuplicateResult;
  debounceMs?: number;
};

export type UseLeadDuplicateGuardResult = {
  status: LeadDuplicateGuardStatus;
  rows: readonly RemoteLeadDuplicateRow[];
  error: unknown;
  needsConfirmation: boolean;
  confirmed: boolean;
  confirm: () => void;
  verifyBeforeSubmit: () => Promise<SubmitVerification>;
};

const EMPTY_ROWS: readonly RemoteLeadDuplicateRow[] = Object.freeze([]);

function hasDuplicateRows(rows: readonly RemoteLeadDuplicateRow[]): boolean {
  return rows.some((r) => r.status === 'accessible' || r.status === 'restricted');
}

export function useLeadDuplicateGuard(options: UseLeadDuplicateGuardOptions): UseLeadDuplicateGuardResult {
  const { phone, isPhoneValid, excludeLeadId, enabled, identityKey, duplicateCheck, debounceMs = 500 } = options;

  const [status, setStatus] = useState<LeadDuplicateGuardStatus>('idle');
  const [rows, setRows] = useState<readonly RemoteLeadDuplicateRow[]>(EMPTY_ROWS);
  const [error, setError] = useState<unknown>(null);
  const [confirmedPhoneDigits, setConfirmedPhoneDigits] = useState<string | null>(null);

  const phoneDigits = normalizeLeadPhoneDigits(phone);
  const lastKeyRef = useRef<{ phoneDigits: string; identityKey: string | null }>({ phoneDigits: '', identityKey: null });

  // Telefone mudou ou identidade mudou: apaga status/resultado/confirmação
  // — nunca reaproveita a confirmação de outro telefone ou de outra sessão.
  useEffect(() => {
    if (lastKeyRef.current.phoneDigits !== phoneDigits || lastKeyRef.current.identityKey !== identityKey) {
      lastKeyRef.current = { phoneDigits, identityKey };
      setStatus('idle');
      setRows(EMPTY_ROWS);
      setError(null);
      setConfirmedPhoneDigits(null);
    }
  }, [phoneDigits, identityKey]);

  // Debounce: 500ms depois de telefone válido e estável.
  useEffect(() => {
    if (!enabled || !isPhoneValid || phoneDigits === '') return undefined;

    const currentDigitsAtSchedule = phoneDigits;
    const timer = setTimeout(() => {
      setStatus('checking');
      duplicateCheck
        .checkDuplicate({ phone, excludeLeadId })
        .then((outcome) => applyOutcome(outcome))
        .catch((err) => applyError(err, currentDigitsAtSchedule));
    }, debounceMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isPhoneValid, phoneDigits, excludeLeadId, debounceMs]);

  function applyOutcome(outcome: CheckLeadPhoneDuplicateOutcome): void {
    // Descarta resposta fora de ordem: só aplica se ainda for a chamada
    // mais recente E o telefone que a originou ainda é o atual.
    if (outcome.sequence !== duplicateCheck.getLatestSequence()) return;
    if (outcome.phoneDigits !== normalizeLeadPhoneDigits(phone)) return;
    setStatus('checked');
    setRows(outcome.rows);
    setError(null);
  }

  function applyError(err: unknown, forPhoneDigits: string): void {
    if (forPhoneDigits !== normalizeLeadPhoneDigits(phone)) return;
    setStatus('error');
    setRows(EMPTY_ROWS);
    setError(err);
  }

  const needsConfirmation =
    (status === 'checked' && hasDuplicateRows(rows) && confirmedPhoneDigits !== phoneDigits) ||
    (status === 'error' && confirmedPhoneDigits !== phoneDigits);

  const confirmed = confirmedPhoneDigits !== null && confirmedPhoneDigits === phoneDigits;

  function confirm(): void {
    setConfirmedPhoneDigits(phoneDigits);
  }

  // Sempre dispara uma checagem NOVA — nunca confia só no resultado do
  // debounce (que pode estar desatualizado ou nunca ter rodado).
  async function verifyBeforeSubmit(): Promise<SubmitVerification> {
    const digitsAtSubmit = normalizeLeadPhoneDigits(phone);
    setStatus('checking');
    try {
      const outcome = await duplicateCheck.checkDuplicate({ phone, excludeLeadId });
      if (normalizeLeadPhoneDigits(phone) !== digitsAtSubmit) {
        // Telefone mudou durante o await — este resultado não decide nada
        // sobre o telefone atual; o chamador deve tentar de novo.
        return 'needs_confirmation';
      }
      setStatus('checked');
      setRows(outcome.rows);
      setError(null);
      if (!hasDuplicateRows(outcome.rows)) return 'proceed';
      if (confirmedPhoneDigits === digitsAtSubmit) return 'proceed';
      return 'needs_confirmation';
    } catch (err) {
      // Check é consultivo: confirmação já dada para este telefone permite
      // prosseguir mesmo que o recheck falhe de novo.
      if (confirmedPhoneDigits === digitsAtSubmit) return 'proceed';
      setStatus('error');
      setRows(EMPTY_ROWS);
      setError(err);
      return 'check_failed';
    }
  }

  return { status, rows, error, needsConfirmation, confirmed, confirm, verifyBeforeSubmit };
}
