import { uuid as expoUuid } from 'expo-modules-core';
import type { SwiWatchControlStatus, WatchControl } from '../../modules/swi-watch-control';
import type { OutboxEvent, TelemetryOutbox } from './telemetryOutbox';

// Gravador da sessão espelhada: transforma cada amostra de BPM que o iPhone
// recebe do Apple Watch em evento na fila (telemetryOutbox). É a única ponta
// entre o invólucro nativo e a fila.
//
// DÍVIDA DECLARADA PARA A TASK 9. Hoje o iPhone gera o identificador da
// sessão, o identificador de cada evento e a sequência, porque o relógio ainda
// não os produz: o receptor expõe só o estado da sessão e a última amostra.
// Quando o relógio passar a gerar os três, este arquivo passa a REPASSAR em
// vez de gerar, e as duas builds (iPhone e relógio) sobem JUNTAS. Uma build
// antiga do iPhone com uma nova do relógio geraria identificador novo para
// amostra reentregue e duplicaria tudo no backend, porque o backend só
// reconhece repetição pelo identificador do evento.
//
// Consequência aceita: o identificador da sessão vive neste processo. Reiniciar
// o app no meio de uma sessão espelhada produz sessão nova no backend, e a
// cadeia de avaliação recomeça. Para o piloto serve; a Task 9, com sessão
// nascida no relógio, elimina.

export interface MirroredSessionRecorderDeps {
  outbox: TelemetryOutbox;
  control: WatchControl;
  /** Chamado depois de cada evento persistido na fila, nunca antes. */
  onEnqueued: () => void;
  /** Gerador de identificadores; o padrão é o UUID v4 do expo-modules-core. */
  uuid?: () => string;
}

export interface MirroredSessionRecorder {
  /** Assina o controle e devolve a função que cancela a assinatura. */
  start(): () => void;
}

export function createMirroredSessionRecorder(
  deps: MirroredSessionRecorderDeps,
): MirroredSessionRecorder {
  const { outbox, control, onEnqueued, uuid = () => expoUuid.v4() } = deps;

  // Sessão corrente, gerada aqui ao ver `running` e esquecida ao ver o resto.
  let sessionId: string | null = null;
  // `measuredAt` da última amostra vista. O invólucro entrega o estado inteiro
  // a cada mudança, então a mesma amostra chega de novo quando só a sessão
  // mudou; sem isto ela viraria dois eventos.
  let lastMeasuredAt: string | null = null;
  // Aviso de descarte, uma vez por sessão perdida e não a cada amostra: numa
  // sessão que nunca chega, uma amostra a cada segundos encheria o log.
  let warnedDiscard = false;
  let active = false;

  // Estados são processados em série, um depois do outro. Dois em paralelo
  // pediriam sequência à fila fora da ordem das amostras.
  let chain: Promise<void> = Promise.resolve();
  function enqueue(work: () => Promise<void>): void {
    chain = chain.then(work).catch((error: unknown) => {
      // Uma amostra que não entrou não pode travar as seguintes: a corrente
      // segue, e o registro é o que sobra dela.
      console.warn(
        `[mirroredSessionRecorder] amostra não gravada: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
      );
    });
  }

  async function handle(status: SwiWatchControlStatus): Promise<void> {
    if (status.session === 'running' && sessionId === null) {
      sessionId = uuid();
      warnedDiscard = false;
    } else if (status.session !== 'running' && sessionId !== null) {
      const ended = sessionId;
      sessionId = null;
      await outbox.forgetSession(ended);
    }

    const sample = status.lastSample;
    if (sample === null || sample.measuredAt === lastMeasuredAt) return;
    // Marcada como vista ANTES do append: uma reentrega durante o await não
    // pode virar segundo evento.
    lastMeasuredAt = sample.measuredAt;

    if (sessionId === null) {
      // Batimento fora de sessão não tem para onde ir.
      if (!warnedDiscard) {
        warnedDiscard = true;
        console.warn('[mirroredSessionRecorder] amostra descartada: sem sessão espelhada ativa');
      }
      return;
    }

    const event: OutboxEvent = {
      eventId: uuid(),
      monitoringSessionId: sessionId,
      sequence: await outbox.nextSequence(sessionId),
      eventTime: sample.measuredAt,
      origin: 'REAL',
      measurements: { heartRate: { value: sample.bpm, unit: 'bpm', source: 'APPLE_WATCH' } },
    };
    await outbox.append(event);
    onEnqueued();
  }

  return {
    start() {
      active = true;
      // A amostra que já estava no invólucro antes daqui pode ser de uma sessão
      // anterior; atribuí-la à sessão que nascer agora seria inventar dado.
      lastMeasuredAt = control.getStatus()?.lastSample?.measuredAt ?? null;
      const unsubscribe = control.subscribe((status) => {
        // O invólucro pode ainda entregar um estado depois do cancelamento.
        if (!active) return;
        enqueue(() => handle(status));
      });
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
        // O id da sessão morre com este gravador; o contador dela na fila não
        // pode ficar para sempre no arquivo. Passa pela corrente para não
        // atropelar um append em curso.
        enqueue(async () => {
          if (sessionId === null) return;
          const ended = sessionId;
          sessionId = null;
          await outbox.forgetSession(ended);
        });
      };
    },
  };
}
