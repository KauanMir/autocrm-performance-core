// lib/hooks/useDayBoundaryKey.ts — chave reativa do dia civil LOCAL
// (COMMERCIAL-REMOTE-B1-B2-B3-A). Hook genérico, sem nenhuma menção a
// Tasks — reutiliza APENAS startOfLocalDay (lib/tasks/deriveTaskState.ts,
// já existente, nunca duplicado) para o conceito de "dia local".
//
// Agenda EXATAMENTE um setTimeout por vez, sempre para o próximo midnight
// LOCAL — nunca setInterval, nunca polling por minuto/segundo. Ao disparar,
// recalcula o próximo midnight a partir do relógio REAL naquele momento
// (nunca acumula "timeout anterior + 24h") — DST-SAFE POR RECÁLCULO LOCAL:
// um dia com transição de horário de verão naturalmente produz um delay de
// 23h ou 25h porque a aritmética de Date em hora local já contabiliza isso.
//
// `now` é injetável para testes determinísticos (fake timers) — nunca
// exigido de consumidores normais, que usam o relógio real por padrão.
// Segue o MESMO padrão de estabilidade via ref já usado para `notify` em
// useTasksRemoteBridgeLifecycle: uma nova função `now` recriada a cada
// render (o caso comum quando o parâmetro é omitido, já que o valor
// default também é uma nova arrow function por render) NUNCA reinicia o
// timer — o efeito de agendamento monta uma única vez e sempre lê o valor
// mais recente de `now` através do ref.
import { useEffect, useRef, useState } from 'react';
import { startOfLocalDay } from '@/lib/tasks/deriveTaskState';

export function useDayBoundaryKey(now: () => Date = () => new Date()): number {
  const nowRef = useRef(now);
  // Sem array de dependências de propósito — sincroniza a cada render,
  // custo de uma atribuição de ref, nunca dispara nada por si só.
  useEffect(() => {
    nowRef.current = now;
  });

  const [dayKey, setDayKey] = useState(() => startOfLocalDay(nowRef.current()).getTime());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNext = (): void => {
      const current = nowRef.current();
      const nextMidnight = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate() + 1,
        0, 0, 0, 0,
      );
      // Proteção mínima (§18): nunca um delay negativo — se o relógio
      // injetado/do sistema produzir nextMidnight <= current (não deveria
      // acontecer em uso normal: o próximo midnight é sempre estritamente
      // depois de "agora"), cai para 0 (setTimeout ainda cede ao event
      // loop, nunca é síncrono de verdade) em vez de propagar um valor
      // negativo. Nenhum scheduler complexo, nenhum retry/backoff.
      const delay = Math.max(0, nextMidnight.getTime() - current.getTime());

      timeoutId = setTimeout(() => {
        setDayKey(startOfLocalDay(nowRef.current()).getTime());
        scheduleNext(); // recalcula do zero a partir do relógio real — nunca acumula
      }, delay);
    };

    scheduleNext();

    return () => clearTimeout(timeoutId);
    // Monta uma única vez — nowRef sempre aponta para o `now` mais
    // recente, então recriar `now` a cada render nunca reinicia o timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return dayKey;
}
