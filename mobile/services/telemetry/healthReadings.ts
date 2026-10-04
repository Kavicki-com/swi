import {
  healthReadingsSource,
  type HealthReading,
  type HealthReadingsSource,
} from '../../modules/swi-watch-control';
import type { OutboxEvent, TelemetryOutbox } from './telemetryOutbox';

// Pressão arterial e temperatura corporal lidas do app Saúde. O relógio não
// mede nenhuma das duas: quem as grava é um aparelho com app próprio ou o
// funcionário digitando, e o iPhone só lê o que já está lá.
//
// Cada medição vira UM evento na fila de envio, com o horário em que foi
// medida, e não o de quando foi lida. É o backend que decide, por esse horário,
// se ela é a última medição e se ainda é atual (24 h), histórica (72 h) ou já
// não conta. Mandar a hora da leitura faria uma pressão de ontem parecer de
// agora.

/**
 * Até onde olhar para trás. É o prazo depois do qual o backend trata a
 * medição como "sem medição recente" (FRESHNESS.BLOOD_PRESSURE.staleMs): mais
 * velha que isso ela não muda nada em tela nenhuma.
 */
export const HEALTH_READING_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Intervalo mínimo entre duas consultas ao app Saúde. O envio drena a cada
 * 15 s, e essas medições acontecem poucas vezes por dia: um minuto basta para
 * a medição feita com o app aberto aparecer logo.
 */
export const HEALTH_READ_INTERVAL_MS = 60_000;

/**
 * O evento de uma medição. Tudo nele sai da própria medição, e nada do
 * momento em que foi lida:
 *
 * - o identificador do evento é o da amostra no HealthKit, então reler a mesma
 *   amostra depois de um reinício do app produz o mesmo evento, e o backend
 *   responde repetição em vez de gravar de novo;
 * - a sessão é a própria medição. Ela não pertence à sessão do relógio, cuja
 *   sequência nasce no relógio, e uma sessão por medição dispensa contador
 *   guardado deste lado.
 */
export function healthReadingEvent(reading: HealthReading): OutboxEvent {
  const base = {
    eventId: reading.id,
    monitoringSessionId: reading.id,
    sequence: 0,
    eventTime: reading.measuredAt,
    origin: 'REAL',
  } as const;
  if (reading.kind === 'bloodPressure') {
    return {
      ...base,
      measurements: {
        bloodPressure: {
          // O HealthKit entrega número real; o backend só aceita mmHg inteiro.
          value: {
            systolic: Math.round(reading.systolic),
            diastolic: Math.round(reading.diastolic),
          },
          unit: 'mmHg',
          source: reading.userEntered ? 'MANUAL_HEALTHKIT' : 'EXTERNAL_CUFF',
        },
      },
    };
  }
  return {
    ...base,
    measurements: {
      bodyTemperature: {
        value: Math.round(reading.celsius * 10) / 10,
        unit: '°C',
        // A única origem que o backend aceita para temperatura: "veio do app
        // Saúde", seja digitada ou gravada por um termômetro.
        source: 'MANUAL_HEALTHKIT',
      },
    },
  };
}

/**
 * Quanto esperar pela resposta do app Saúde. O leitor roda dentro do ciclo que
 * envia a telemetria do relógio, e uma consulta que nunca responde seguraria
 * esse ciclo inteiro. A consulta normal volta em milissegundos.
 */
export const HEALTH_READ_TIMEOUT_MS = 10_000;

export interface HealthReadingsReaderDeps {
  outbox: TelemetryOutbox;
  source?: HealthReadingsSource;
  /** Relógio injetável, em milissegundos. */
  now?: () => number;
  /** Prazo da consulta; o padrão é HEALTH_READ_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** A promessa, ou uma rejeição se ela não resolver no prazo. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta em ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface HealthReadingsReader {
  /**
   * Lê o app Saúde e põe na fila o que ainda não pôs. Devolve quantas medições
   * entraram. Nunca rejeita: sem leitura, o envio do resto da fila segue.
   */
  run(): Promise<number>;
}

export function createHealthReadingsReader(deps: HealthReadingsReaderDeps): HealthReadingsReader {
  const {
    outbox,
    source = healthReadingsSource,
    now = Date.now,
    timeoutMs = HEALTH_READ_TIMEOUT_MS,
  } = deps;

  // O que este leitor já pôs na fila. Só em memória de propósito: depois de um
  // reinício as medições das últimas 72 h vão de novo, e o backend as
  // reconhece pelo identificador. Repetir é barato; guardar a lista em arquivo
  // criaria um estado a mais para corromper, e uma medição marcada como
  // enviada que a fila perdeu não teria volta.
  const enqueued = new Set<string>();
  let lastReadAt: number | null = null;

  return {
    async run() {
      if (!source.supported) return 0;
      const at = now();
      if (lastReadAt !== null && at - lastReadAt < HEALTH_READ_INTERVAL_MS) return 0;
      lastReadAt = at;

      try {
        const readings = await withTimeout(
          source.read(at - HEALTH_READING_WINDOW_MS),
          timeoutMs,
        );
        // O que outra montagem deste leitor deixou na fila e ainda não subiu.
        const pending = new Set((await outbox.pending()).map((event) => event.eventId));
        const fresh = readings.filter(
          (reading) => !enqueued.has(reading.id) && !pending.has(reading.id),
        );
        const added =
          fresh.length === 0 ? 0 : await outbox.appendMany(fresh.map(healthReadingEvent));
        // Só depois de a fila ter gravado. Marcar antes deixaria a medição
        // como enfileirada sem estar na fila, e ela só voltaria num reinício.
        // Entra a leitura inteira, inclusive a que a fila recusou por estar
        // fora do contrato: insistir nela a cada minuto não mudaria a resposta.
        for (const reading of readings) enqueued.add(reading.id);
        return added;
      } catch (error) {
        console.warn(
          `[healthReadings] medições do app Saúde não enfileiradas: ${String(
            (error as { message?: unknown })?.message ?? error,
          )}`,
        );
        return 0;
      }
    },
  };
}
