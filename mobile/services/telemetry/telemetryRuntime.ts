import {
  createHealthConnectReader,
  type HealthConnectReader,
} from './healthConnect/healthConnectReader';
import {
  createFileOutboxStorage,
  createTelemetryOutbox,
  type TelemetryOutbox,
} from './telemetryOutbox';

// As instâncias da telemetria que precisam ser ÚNICAS por runtime JS. A
// serialização da fila (telemetryOutbox.ts) e a do leitor do Health Connect
// (healthConnectReader.ts) só ordenam operações dentro da mesma instância:
// duas filas sobre o mesmo arquivo leriam o mesmo estado e a segunda escrita
// apagaria os eventos que a primeira pôs. O leitor do Health Connect avança o
// token DEPOIS de enfileirar, então um evento apagado assim não volta mais.
//
// Quem roda no mesmo runtime pega daqui: o envio em primeiro plano
// (useTelemetryUpload, montado pelo TelemetryUploadProvider) e a tarefa de
// segundo plano (M6). Uma remontagem do provider, ou um efeito que religa,
// também reaproveita as mesmas instâncias em vez de criar outra fila.
//
// Criadas na primeira chamada, e não no topo do módulo: `createFileOutboxStorage`
// instancia `File`, e a suíte importa a fiação sem `expo-file-system` real.

let outbox: TelemetryOutbox | null = null;
let healthConnectReader: HealthConnectReader | null = null;

/** A fila de envio do processo, sobre `telemetry-outbox.v1.json`. */
export function sharedTelemetryOutbox(): TelemetryOutbox {
  if (outbox === null) outbox = createTelemetryOutbox(createFileOutboxStorage());
  return outbox;
}

/**
 * O leitor do Health Connect do processo, escrevendo na fila compartilhada.
 * Só o Android com o gate `healthConnect` chama: fora dele, nem o arquivo de
 * estado do leitor é tocado.
 */
export function sharedHealthConnectReader(): HealthConnectReader {
  if (healthConnectReader === null) {
    healthConnectReader = createHealthConnectReader({ outbox: sharedTelemetryOutbox() });
  }
  return healthConnectReader;
}
