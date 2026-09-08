import { useEffect, useRef, useState } from 'react';
import { watchControl, type WatchControl } from '../../modules/swi-watch-control';
import { createMirroredSessionRecorder } from './mirroredSessionRecorder';
import {
  createFileOutboxStorage,
  createTelemetryOutbox,
  type TelemetryOutbox,
} from './telemetryOutbox';
import {
  createTelemetryUploader,
  type TelemetryUploader,
  type UploadOutcome,
} from './telemetryUploader';

// Fiação do envio: enquanto a tela de monitoramento está montada, o gravador
// (mirroredSessionRecorder) põe cada amostra na fila (telemetryOutbox) e este
// hook manda o uploader (telemetryUploader) drenar. Ao montar, drena o que
// ficou de uma execução anterior: a fila é arquivo, e sobrevive ao app.
//
// Só faz alguma coisa com módulo nativo E credencial do aparelho. Sem os dois
// não há como autenticar o envio, e tocar a rede seria um 401 por amostra.

/**
 * Teto de rodadas por drenagem. Cada rodada manda até MAX_BATCH_EVENTS, e um
 * `sent` com `remaining` maior que zero pede outra. O teto faz o laço ser
 * finito por construção mesmo com amostra entrando a cada rodada; o que
 * sobrar sai na próxima amostra ou na próxima montagem. Vinte rodadas são
 * 4.000 eventos, mais de 16 horas de amostras a cada 15 s: só um backlog
 * patológico chega aqui.
 */
export const MAX_DRAIN_ROUNDS = 20;

export interface TelemetryUploadDeps {
  outbox?: TelemetryOutbox;
  uploader?: TelemetryUploader;
}

export interface TelemetryUploadState {
  /** Módulo nativo presente e credencial guardada ao montar; cai com o 401. */
  paired: boolean;
  lastOutcome: UploadOutcome | null;
}

// Uma confirmação que não citou evento nenhum deixou a fila como estava;
// repetir seria martelar o backend com o mesmo lote.
const madeProgress = (outcome: UploadOutcome) =>
  outcome.outcome === 'sent' && outcome.accepted + outcome.duplicates + outcome.conflicts > 0;

export function useTelemetryUpload(
  control: WatchControl = watchControl,
  deps: TelemetryUploadDeps = {},
): TelemetryUploadState {
  // Lido uma vez por montagem, não a cada render: hasDeviceCredential consulta
  // o chaveiro. Inicialização preguiçosa de ref, o padrão que o React aceita.
  const pairedAtMount = useRef<boolean | null>(null);
  if (pairedAtMount.current === null) {
    pairedAtMount.current = control.supported && control.hasDeviceCredential();
  }
  const [state, setState] = useState<TelemetryUploadState>({
    paired: pairedAtMount.current,
    lastOutcome: null,
  });
  // As dependências injetadas valem para a montagem; trocá-las depois não
  // recria a fiação.
  const depsRef = useRef(deps);

  useEffect(() => {
    if (!pairedAtMount.current) return undefined;
    const outbox = depsRef.current.outbox ?? createTelemetryOutbox(createFileOutboxStorage());
    const uploader = depsRef.current.uploader ?? createTelemetryUploader({ outbox, control });

    let mounted = true;
    // Vira true com o 401 ou com o desmonte: nada mais sai até remontar.
    let halted = false;
    let stop: (() => void) | null = null;
    let draining = false;
    // Amostra que entrou durante uma drenagem: a fila pode ter sido contada
    // antes dela, e uma rodada a mais garante que nada fica para trás.
    let again = false;

    const halt = () => {
      halted = true;
      stop?.();
      stop = null;
    };

    async function drain(): Promise<void> {
      if (halted) return;
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
          const outcome = await uploader.uploadPending();
          if (!mounted || halted) return;
          setState({ paired: outcome.outcome !== 'unpaired', lastOutcome: outcome });
          if (outcome.outcome === 'unpaired') {
            halt();
            return;
          }
          if (outcome.outcome !== 'sent' || outcome.remaining === 0 || !madeProgress(outcome)) {
            break;
          }
        }
      } finally {
        draining = false;
      }
      if (again) {
        again = false;
        await drain();
      }
    }

    const recorder = createMirroredSessionRecorder({
      outbox,
      control,
      onEnqueued: () => {
        void drain();
      },
    });
    stop = recorder.start();
    void drain();

    return () => {
      mounted = false;
      halt();
    };
  }, [control]);

  return state;
}
