import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { watchControl, type WatchControl } from '../../modules/swi-watch-control';
import { createHealthReadingsReader, type HealthReadingsReader } from './healthReadings';
import { createMirroredSessionRecorder } from './mirroredSessionRecorder';
import {
  createTelemetryInboxDrain,
  type TelemetryInboxDrain,
} from './telemetryInboxDrain';
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

// Fiação do envio: enquanto está ligado, o gravador (mirroredSessionRecorder)
// põe cada amostra na fila (telemetryOutbox) e este hook manda o uploader
// (telemetryUploader) drenar. Ao ligar, drena o que ficou de uma execução
// anterior: a fila é arquivo, e sobrevive ao app. Quem o monta é a raiz do
// app (TelemetryUploadProvider), para o envio não depender de tela aberta.
//
// Só faz alguma coisa com módulo nativo E credencial do aparelho. Sem os dois
// não há como autenticar o envio, e tocar a rede seria um 401 por amostra.
//
// Limite conhecido: sem credencial nada é drenado, e o arquivo durável do
// iPhone segue crescendo enquanto o relógio manda remessas. O módulo nativo
// não expõe limpeza desse arquivo; o teto dele é assunto do lado nativo.

/**
 * Teto de rodadas por drenagem. Cada rodada manda até MAX_BATCH_EVENTS, e um
 * `sent` com `remaining` maior que zero pede outra. O teto faz o laço ser
 * finito por construção mesmo com amostra entrando a cada rodada; o que
 * sobrar sai na próxima amostra ou na próxima montagem. Vinte rodadas são
 * 4.000 eventos, mais de 16 horas de amostras a cada 15 s: só um backlog
 * patológico chega aqui.
 */
export const MAX_DRAIN_ROUNDS = 20;

/**
 * De quanto em quanto tempo o arquivo durável é drenado enquanto a tela está
 * montada e o app em primeiro plano.
 *
 * Existe porque o formato novo NÃO acorda o JavaScript: o relógio manda a
 * remessa, o Swift grava e confirma, e nada disso passa por aqui. O invólucro
 * só anuncia mudança de sessão, não leitura. Sem este intervalo, o que chega
 * com a tela aberta só apareceria na próxima montagem.
 *
 * Quinze segundos porque é a janela em que o painel espera novidade; rotacionar
 * sem nada para drenar é uma listagem de diretório e mais nada.
 */
export const INBOX_DRAIN_INTERVAL_MS = 15_000;

export interface TelemetryUploadDeps {
  outbox?: TelemetryOutbox;
  uploader?: TelemetryUploader;
  inboxDrain?: TelemetryInboxDrain;
  healthReader?: HealthReadingsReader;
}

export interface TelemetryUploadOptions {
  /**
   * Liga o envio. A raiz passa falso sem sessão aberta ou fora do piloto;
   * desligado, nem o chaveiro é consultado. Padrão ligado.
   */
  enabled?: boolean;
  /**
   * Muda quando a credencial pode ter mudado (pareamento concluído). Cada
   * valor novo relê o chaveiro e religa o envio, sem remontar nada.
   */
  recheckKey?: number;
}

export interface TelemetryUploadState {
  /** Módulo nativo presente e credencial guardada na última leitura; cai com o 401. */
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
  options: TelemetryUploadOptions = {},
): TelemetryUploadState {
  const enabled = options.enabled ?? true;
  const recheckKey = options.recheckKey ?? 0;
  // Lido uma vez ao montar e depois só quando ligar ou a chave mudar, nunca a
  // cada render: hasDeviceCredential consulta o chaveiro. A leitura da
  // montagem fica guardada para o primeiro efeito não repetir a consulta.
  const readAtMount = useRef<boolean | null>(null);
  const mounted = useRef(false);
  if (!mounted.current && readAtMount.current === null) {
    readAtMount.current = enabled && control.supported && control.hasDeviceCredential();
  }
  const [state, setState] = useState<TelemetryUploadState>({
    paired: readAtMount.current ?? false,
    lastOutcome: null,
  });
  // As dependências injetadas valem para a montagem; trocá-las depois não
  // recria a fiação.
  const depsRef = useRef(deps);

  useEffect(() => {
    const paired =
      readAtMount.current ?? (enabled && control.supported && control.hasDeviceCredential());
    readAtMount.current = null;
    mounted.current = true;
    setState((prev) => (prev.paired === paired ? prev : { paired, lastOutcome: null }));
    if (!paired) return undefined;
    const outbox = depsRef.current.outbox ?? createTelemetryOutbox(createFileOutboxStorage());
    const uploader = depsRef.current.uploader ?? createTelemetryUploader({ outbox, control });
    const inboxDrain =
      depsRef.current.inboxDrain ?? createTelemetryInboxDrain({ control, outbox });
    const healthReader = depsRef.current.healthReader ?? createHealthReadingsReader({ outbox });

    let alive = true;
    // Vira true com o 401 ou com o desligamento: nada mais sai até a
    // credencial ser relida.
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
        // Antes de enviar, e não depois: o que o Swift gravou com o app em
        // segundo plano precisa entrar na fila para subir nesta mesma rodada.
        // Uma falha aqui não segura o envio, porque o que já está na fila é
        // durável e já foi confirmado ao relógio; perder o envio por causa do
        // dreno seria perder duas vezes pelo mesmo problema.
        try {
          await inboxDrain.run();
        } catch (error) {
          console.warn(
            `[useTelemetryUpload] dreno falhou: ${String(
              (error as { message?: unknown })?.message ?? error,
            )}`,
          );
        }
        if (!alive || halted) return;

        // Pressão e temperatura do app Saúde entram na fila aqui, para subir
        // nesta mesma rodada. O leitor se limita sozinho a uma consulta por
        // minuto, e uma falha dele não segura o envio, como a do dreno.
        try {
          await healthReader.run();
        } catch (error) {
          console.warn(
            `[useTelemetryUpload] leitura do app Saúde falhou: ${String(
              (error as { message?: unknown })?.message ?? error,
            )}`,
          );
        }
        if (!alive || halted) return;

        for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
          const outcome = await uploader.uploadPending();
          if (!alive || halted) return;
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

    // O formato novo não anuncia leitura ao JavaScript, então o gatilho é o
    // tempo, mais a volta ao primeiro plano, que é quando o acúmulo de segundo
    // plano costuma estar maior.
    const ticker = setInterval(() => {
      void drain();
    }, INBOX_DRAIN_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void drain();
    });

    return () => {
      alive = false;
      clearInterval(ticker);
      subscription.remove();
      halt();
    };
  }, [control, enabled, recheckKey]);

  return state;
}
