import { File } from 'expo-file-system';
import { watchControl, type WatchControl } from '../../modules/swi-watch-control';
import { outboxEventProblem, type OutboxEvent, type TelemetryOutbox } from './telemetryOutbox';

// Dreno do arquivo durável: leva ao JavaScript o que o Swift gravou enquanto o
// app estava em segundo plano, e daí para a fila de envio que já existe.
//
// Ele existe por causa de um fato do iOS: o JavaScript não roda com o app em
// segundo plano. Sem o arquivo, cada leitura que chegasse nesse período morria
// no invólucro nativo, que só guarda a última. O arquivo é onde a leitura para
// de depender de haver JavaScript vivo, e este módulo é a ponte de volta.
//
// QUEM ROTACIONA É O NATIVO. A ideia óbvia, de o JavaScript renomear e drenar o
// renomeado, tem uma corrida de microssegundos: o Swift pode escrever num
// arquivo que o JavaScript já leu e vai apagar, perdendo um evento QUE JÁ FOI
// CONFIRMADO ao relógio, ou seja, que o relógio já esqueceu. Aqui o JavaScript
// só toca em arquivo que `rotateInbox` fechou e ninguém mais escreve.

/** Acesso aos arquivos rotacionados, injetável. O teste usa texto em memória. */
export interface InboxFiles {
  read(uri: string): Promise<string>;
  remove(uri: string): Promise<void>;
}

export interface TelemetryInboxDrainDeps {
  control: WatchControl;
  outbox: TelemetryOutbox;
  files?: InboxFiles;
}

export interface DrainResult {
  /** Linhas que entraram na fila nesta rodada. */
  drained: number;
  /** Linhas descartadas: ilegíveis, fora do contrato, ou já na fila. */
  skipped: number;
}

export interface TelemetryInboxDrain {
  run(): Promise<DrainResult>;
}

/** Implementação real, sobre `expo-file-system`. */
export function createFileInboxFiles(): InboxFiles {
  return {
    async read(uri) {
      return new File(uri).text();
    },
    async remove(uri) {
      new File(uri).delete();
    },
  };
}

export function createTelemetryInboxDrain(deps: TelemetryInboxDrainDeps): TelemetryInboxDrain {
  const { control, outbox, files = createFileInboxFiles() } = deps;

  return {
    async run() {
      if (!control.supported) return { drained: 0, skipped: 0 };

      const uris = control.rotateInbox();
      if (uris.length === 0) return { drained: 0, skipped: 0 };

      // Lida uma vez por rodada: `pending` relê o arquivo a cada chamada, e
      // consultá-la por linha faria o dreno de um acúmulo grande reler a fila
      // inteira milhares de vezes.
      const known = new Set((await outbox.pending()).map((event) => event.eventId));

      let drained = 0;
      let skipped = 0;

      for (const uri of uris) {
        let text: string;
        try {
          text = await files.read(uri);
        } catch (error) {
          // Sem ler não dá para saber o que havia dentro, e apagar seria
          // destruir sem olhar. Fica para a próxima rodada.
          console.warn(`[telemetryInboxDrain] arquivo não lido, mantido: ${describe(error)}`);
          continue;
        }

        // Acumula por arquivo e grava de uma vez: um `append` por linha
        // reescreveria a fila inteira a cada linha, e um turno em segundo plano
        // traz milhares delas.
        const batch: OutboxEvent[] = [];
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed === '') continue;

          let event: OutboxEvent;
          try {
            event = JSON.parse(trimmed) as OutboxEvent;
          } catch {
            // Escrita interrompida emendada pela seguinte. Uma linha ruim não
            // pode levar junto as boas do mesmo arquivo.
            skipped += 1;
            continue;
          }

          // O relógio reenvia a remessa quando a confirmação se perde, então a
          // mesma linha pode aparecer duas vezes. Repetir é barato; duplicar no
          // backend, não.
          if (typeof event?.eventId !== 'string' || known.has(event.eventId)) {
            skipped += 1;
            continue;
          }
          if (outboxEventProblem(event) !== null) {
            skipped += 1;
            continue;
          }

          batch.push(event);
          known.add(event.eventId);
        }
        drained += await outbox.appendMany(batch);

        // Só depois de todas as linhas dele estarem na fila. Apagar antes
        // perderia o que a gravação não tivesse alcançado, e estas linhas já
        // foram confirmadas ao relógio: ninguém mais as tem.
        try {
          await files.remove(uri);
        } catch (error) {
          // Arquivo que sobra é relido na próxima rodada e cai todo na
          // deduplicação. Custa uma leitura, não custa evento.
          console.warn(`[telemetryInboxDrain] arquivo não apagado: ${describe(error)}`);
        }
      }

      return { drained, skipped };
    },
  };
}

function describe(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error);
}

/** O dreno do app, sobre o controle real e a fila real. */
export function createAppInboxDrain(outbox: TelemetryOutbox): TelemetryInboxDrain {
  return createTelemetryInboxDrain({ control: watchControl, outbox });
}
