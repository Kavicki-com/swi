import { getApiUrl } from '../auth/apiConfig';
import { nativeErrorCode, watchControl, type WatchControl } from '../../modules/swi-watch-control';
import type { OutboxEvent, TelemetryOutbox } from './telemetryOutbox';

// Envio da fila ao backend. Manda um lote, lê a confirmação e só então tira da
// fila o que ela citou: aceito, repetido ou recusado. Tudo que a confirmação
// não citou fica, porque reenviar é barato (o backend responde repetição) e
// perder não tem volta.
//
// A credencial do aparelho nunca passa por aqui: o pedido vai em modo
// `device`, e é o Swift que monta o cabeçalho a partir do chaveiro.

const BATCHES_PATH = '/telemetry/v1/batches';

/**
 * Teto do DTO do backend (telemetry-batch.dto.ts, MAX_BATCH_EVENTS). Acima
 * disso o validador responde 400, e um 400 esvazia o lote. Sem o corte, uma
 * fila acumulada num turno sem rede (uma amostra a cada 15 s passa de 200 em
 * 50 minutos) seria recusada inteira na primeira tentativa. O que sobra fica
 * para a próxima chamada.
 */
export const MAX_BATCH_EVENTS = 200;

export type UploadOutcome =
  /** Fila vazia; nada foi à rede. */
  | { outcome: 'idle' }
  | { outcome: 'sent'; accepted: number; duplicates: number; conflicts: number }
  /** 5xx, 429 ou rede: fila intacta, tenta depois. */
  | { outcome: 'deferred' }
  /** Outro 4xx: o lote enviado saiu da fila, porque reenviar não muda a resposta. */
  | { outcome: 'rejected'; status: number }
  /** 401, E_NO_CREDENTIAL ou E_UNSUPPORTED: não há como autenticar o aparelho. */
  | { outcome: 'unpaired' };

export interface TelemetryUploaderDeps {
  outbox: TelemetryOutbox;
  control?: WatchControl;
  apiUrl?: () => string;
}

export interface TelemetryUploader {
  /**
   * Nunca rejeita. Com um envio em curso, devolve a MESMA promessa: dois
   * envios simultâneos mandariam o mesmo evento duas vezes.
   */
  uploadPending(): Promise<UploadOutcome>;
}

/** Forma da confirmação (backend, telemetry-ingestion.service.ts, TelemetryBatchAck). */
interface BatchAck {
  acceptedEventIds: string[];
  duplicateEventIds: string[];
  conflicts: { eventId: string; reason: string; detail: string }[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Corpo 2xx que não é a confirmação esperada é null, e quem chama adia o lote
 * sem tocar a fila. `serverTime` não é conferido: nada aqui depende dele.
 */
function parseAck(body: string): BatchAck | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { acceptedEventIds, duplicateEventIds, conflicts } = parsed as Record<string, unknown>;
  if (!isStringArray(acceptedEventIds) || !isStringArray(duplicateEventIds)) return null;
  if (!Array.isArray(conflicts)) return null;
  const rejections: BatchAck['conflicts'] = [];
  for (const conflict of conflicts) {
    if (typeof conflict !== 'object' || conflict === null) return null;
    const { eventId, reason, detail } = conflict as Record<string, unknown>;
    if (typeof eventId !== 'string') return null;
    rejections.push({
      eventId,
      reason: typeof reason === 'string' ? reason : 'desconhecido',
      detail: typeof detail === 'string' ? detail : '',
    });
  }
  return { acceptedEventIds, duplicateEventIds, conflicts: rejections };
}

// Chaveiro que nem responde não muda o desfecho: o backend já disse que a
// credencial não vale, e a próxima tentativa vai ouvir o mesmo 401.
function clearCredential(control: WatchControl): void {
  try {
    control.clearDeviceCredential();
  } catch {
    // Nada a fazer aqui; o desfecho é unpaired de qualquer jeito.
  }
}

function outcomeForRejection(error: unknown): UploadOutcome {
  switch (nativeErrorCode(error)) {
    case 'E_NETWORK':
    case 'E_KEYCHAIN':
      return { outcome: 'deferred' };
    // Não há credencial para limpar: ou o chaveiro está vazio, ou não há
    // módulo compilado.
    case 'E_NO_CREDENTIAL':
    case 'E_UNSUPPORTED':
      return { outcome: 'unpaired' };
    // E_URL e E_CREDENTIAL_MISSING não são deste caminho (a URL é a da API e
    // `storeCredential` vai desligado), e rejeição sem código é defeito. A
    // fila não paga por defeito de configuração: adia, e o aviso fica no log.
    default:
      console.warn(
        `[telemetryUploader] rejeição fora do contrato, lote adiado: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
      );
      return { outcome: 'deferred' };
  }
}

export function createTelemetryUploader(deps: TelemetryUploaderDeps): TelemetryUploader {
  const { outbox, control = watchControl, apiUrl = getApiUrl } = deps;

  async function send(): Promise<UploadOutcome> {
    const queued = await outbox.pending();
    if (queued.length === 0) return { outcome: 'idle' };
    const events: readonly OutboxEvent[] = queued.slice(0, MAX_BATCH_EVENTS);

    let response;
    try {
      response = await control.request(
        `${apiUrl()}${BATCHES_PATH}`,
        'POST',
        JSON.stringify({ events }),
        { kind: 'device' },
        false,
      );
    } catch (error) {
      return outcomeForRejection(error);
    }
    const { status, body } = response;

    if (status >= 200 && status < 300) {
      const ack = parseAck(body);
      if (ack === null) {
        console.warn(
          `[telemetryUploader] 2xx sem a confirmação esperada, lote adiado: ${body.slice(0, 200)}`,
        );
        return { outcome: 'deferred' };
      }
      // Recusa do backend é permanente (mesmo evento, mesma resposta), por isso
      // o evento sai da fila como se tivesse sido aceito; o registro é o que
      // sobra dele.
      for (const { eventId, reason, detail } of ack.conflicts) {
        console.warn(`[telemetryUploader] evento ${eventId} recusado (${reason}): ${detail}`);
      }
      await outbox.remove([
        ...ack.acceptedEventIds,
        ...ack.duplicateEventIds,
        ...ack.conflicts.map((conflict) => conflict.eventId),
      ]);
      return {
        outcome: 'sent',
        accepted: ack.acceptedEventIds.length,
        duplicates: ack.duplicateEventIds.length,
        conflicts: ack.conflicts.length,
      };
    }

    // O painel revogou o aparelho, e este é o único lugar onde o iPhone
    // descobre. A fila fica: um pareamento novo ainda pode tentar entregá-la.
    if (status === 401) {
      clearCredential(control);
      return { outcome: 'unpaired' };
    }

    if (status === 429 || status >= 500) return { outcome: 'deferred' };

    // Reenviar não muda a resposta, e uma fila que nunca esvazia bloqueia todo
    // evento futuro atrás do primeiro ruim. Sai só o que foi enviado: o que
    // ficou atrás do teto o backend nunca viu.
    if (status >= 400) {
      console.warn(`[telemetryUploader] lote recusado com ${status}: ${body.slice(0, 200)}`);
      await outbox.remove(events.map((event) => event.eventId));
      return { outcome: 'rejected', status };
    }

    // 1xx e 3xx não fazem parte do contrato da rota; o lote não pode pagar.
    console.warn(`[telemetryUploader] status inesperado ${status}, lote adiado`);
    return { outcome: 'deferred' };
  }

  let inFlight: Promise<UploadOutcome> | null = null;

  return {
    uploadPending() {
      if (inFlight === null) {
        inFlight = send().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
