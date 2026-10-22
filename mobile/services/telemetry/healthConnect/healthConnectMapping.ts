import type { HealthConnectRecordResult } from 'react-native-health-connect';
import type { ConnectedInterval } from '../../../modules/swi-ble-heart-rate/src/SwiBleHeartRate.types';
import { outboxEventProblem, type OutboxEvent, type OutboxMeasurements } from '../telemetryOutbox';

// Registros do Health Connect virando eventos da fila de telemetria. Função
// pura: quem lê a biblioteca e quem grava na fila é o leitor
// (healthConnectReader.ts); aqui só se decide o que cada registro vira e o
// que não entra. É o equivalente Android de healthReadings.ts, com uma
// diferença: o Health Connect traz as sete medições do monitoramento, e não
// só pressão e temperatura.
//
// O módulo não executa nada da biblioteca nativa: o import é só de tipo, e o
// Jest roda esta regra sem Android por perto.
//
// O que é descartado aqui, e só isso: registro que não é objeto ou sem
// `recordType`, tipo de registro que o monitoramento não usa, registro sem
// identidade estável (`metadata.id`), batimento sem lista de amostras, amostra
// que não é objeto, horário ilegível, mais velho que a janela de 48 h, passos
// e distância que não vêm da pulseira, batimento mais frequente que a cadência
// do relógio, evento repetido na mesma chamada
// (mesmo `eventId`), e o que a própria fila recusaria (`outboxEventProblem`:
// valor não finito, passos negativos, par da pressão incompleto). A faixa
// plausível (20 a 300 bpm, 30 a 45 °C, pares de pressão) NÃO é conferida aqui,
// de propósito: é o backend que a recusa, por evento e dentro de um 2xx, e
// duplicar a tabela dele neste lado faria as duas divergirem com o tempo.

/**
 * Intervalo mínimo entre duas amostras de batimento aceitas. É a cadência em
 * que o relógio manda batimento no iPhone; uma pulseira que grava a cada
 * segundo em treino produziria 60 vezes mais eventos para a mesma curva.
 * A amostra é medida contra a última ACEITA, e não contra a anterior na lista.
 */
export const HEART_RATE_MIN_INTERVAL_MS = 15_000;

/**
 * Até onde olhar para trás. A primeira leitura do Health Connect é dos
 * últimos 48 h, e um evento mais velho que isso não muda nada em tela: o dia
 * já fechou e o ciclo de vida do backend o resumiu.
 */
export const HEALTH_CONNECT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Namespace do uuid v5 que identifica os eventos. Gerado uma vez e gravado
 * literal: mudar este valor mudaria o id de toda amostra já enviada, e a
 * próxima releitura das 48 h gravaria tudo de novo no backend em vez de ser
 * respondida como repetição.
 */
export const HEALTH_CONNECT_EVENT_NAMESPACE = '8c47a64e-3d24-4eb9-8c6b-a4d572915040';

/**
 * Os sete tipos de registro que o monitoramento usa, na ordem que define a
 * posição de cada um na sequência do evento. A ORDEM É CONTRATO: mudar a
 * posição de um tipo muda a sequência de toda amostra já enviada dele, e a
 * próxima releitura viraria conflito de sequência no backend em vez de
 * repetição. Tipo novo entra no fim; há 8 vagas por segundo, uma sobra.
 */
export const HEALTH_CONNECT_RECORD_TYPES = [
  'HeartRate',
  'Steps',
  'Distance',
  'ActiveCaloriesBurned',
  'OxygenSaturation',
  'BloodPressure',
  'BodyTemperature',
] as const;

export type HealthConnectRecordType = (typeof HEALTH_CONNECT_RECORD_TYPES)[number];

/**
 * Vagas de sequência por segundo do dia: uma por tipo de registro, com uma
 * sobrando. A sequência do evento é `segundos desde a meia-noite UTC * 8 +
 * posição do tipo`, o que dá no máximo 86.399 * 8 + 7 = 691.199, inteiro e
 * não negativo como a fila e o backend exigem.
 */
export const SEQUENCE_SLOTS_PER_SECOND = 8;

/**
 * Um registro como a ponte nativa o entrega, com `recordType`, `metadata` e
 * os valores já convertidos (`inMeters`, `inKilocalories`, ...). É o tipo da
 * biblioteca; `readRecords` o devolve sem `recordType` no tipo, mas com ele no
 * objeto, e o leitor o repõe quando precisa.
 */
export type HealthConnectRecord = HealthConnectRecordResult;

export interface HealthConnectMappingContext {
  /**
   * Sal da sessão: um uuid v4 gerado uma vez por instalação e guardado no
   * estado do leitor. É a única entrada do evento que não sai do próprio
   * registro, e serve para duas instalações do mesmo funcionário (troca de
   * celular) não escreverem na mesma sessão com as mesmas sequências.
   */
  sessionSalt: string;
  /** O agora, em milissegundos: é dele que a janela de 48 h é contada. */
  nowMs: number;
  /**
   * Pacote Android do app da pulseira (`metadata.dataOrigin`), ou null quando
   * nenhuma foi detectada. Passos e distância só entram desse pacote: o
   * celular também conta passos, e somar os dois inflaria o total.
   */
  bandPackage: string | null;
  /** uuid v5 de `name` em `namespace`; em produção, `uuid.v5` do expo-modules-core. */
  uuidV5: (name: string, namespace: string) => string;
  /**
   * Trechos em que a pulseira esteve conectada pelo Bluetooth (`end` null =
   * segue conectada, vale até `nowMs`). O batimento desses trechos já subiu
   * ao vivo por lá; o do Health Connect sai, e as outras medições ficam.
   */
  bluetoothIntervals?: readonly ConnectedInterval[];
}

export interface HealthConnectMappingResult {
  /** Em ordem crescente de `eventTime`; a sequência cresce junto, com buracos. */
  events: OutboxEvent[];
  /**
   * Quantas unidades não entraram: um registro, ou uma amostra de batimento,
   * conta uma. Para o leitor registrar quanto da leitura ficou de fora.
   */
  discarded: number;
}

/** Um evento em formação, antes de ganhar identificador, sessão e sequência. */
interface Candidate {
  recordType: HealthConnectRecordType;
  recordId: string;
  atMs: number;
  measurements: OutboxMeasurements;
}

const isMonitoredType = (value: unknown): value is HealthConnectRecordType =>
  (HEALTH_CONNECT_RECORD_TYPES as readonly unknown[]).includes(value);

// A ponte nativa entrega JSON, e o tipo da biblioteca é uma promessa sobre
// ele, não uma garantia. Cada campo é lido sem confiar na forma: um registro
// torto vira descarte, nunca exceção, porque uma amostra ruim não pode
// derrubar a rodada inteira.
type Loose = Record<string, unknown>;

const obj = (value: unknown): Loose | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : null;

// Não número vira NaN, e NaN é recusado pela fila ("não é número finito").
// `Math.round(null)` daria 0, um passo a menos que ninguém notaria.
const num = (value: unknown): number => (typeof value === 'number' ? value : Number.NaN);

const SOURCE = 'HEALTH_CONNECT' as const;

// O Kotlin (`Instant.toString()`) escreve a fração de segundo com 6 ou 9
// dígitos quando ela não é redonda, e o ECMAScript só garante 3 no
// `Date.parse`. O Node aceita mais; o Hermes do aparelho não foi verificado.
// Fica com os 3 primeiros: milissegundo é tudo o que a fila carrega.
const EXTRA_FRACTION_DIGITS = /\.(\d{3})\d+/;

/**
 * O instante de um registro ou amostra em milissegundos, ou null se não é
 * uma data legível ou se está fora da janela. Instante no futuro não é
 * filtrado aqui: o backend já recusa relógio adiantado em relação ao servidor
 * (`assertEventTimeUsable`), por evento.
 */
function instantMs(value: unknown, nowMs: number): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value.replace(EXTRA_FRACTION_DIGITS, '.$1'));
  if (Number.isNaN(ms)) return null;
  if (nowMs - ms > HEALTH_CONNECT_WINDOW_MS) return null;
  return ms;
}

/**
 * Registro de intervalo: o horário é o fim dele, porque o valor é a variação
 * do intervalo inteiro e só existe quando ele fecha. Pontual: o da medição.
 */
const recordInstant = (r: Loose): unknown => ('endTime' in r ? r.endTime : r.time);

/** Os tipos de um valor só; batimento (amostras) e pressão (par) ficam fora. */
const SINGLE_VALUE: Record<
  Exclude<HealthConnectRecordType, 'HeartRate' | 'BloodPressure'>,
  { key: keyof OutboxMeasurements; unit: string; read: (record: Loose) => number }
> = {
  Steps: { key: 'stepDelta', unit: 'steps', read: (r) => Math.round(num(r.count)) },
  Distance: { key: 'distanceDeltaM', unit: 'm', read: (r) => num(obj(r.distance)?.inMeters) },
  ActiveCaloriesBurned: {
    key: 'activeEnergyKcal',
    unit: 'kcal',
    read: (r) => num(obj(r.energy)?.inKilocalories),
  },
  OxygenSaturation: { key: 'oxygenSaturation', unit: '%', read: (r) => num(r.percentage) },
  BodyTemperature: {
    key: 'bodyTemperature',
    unit: '°C',
    read: (r) => num(obj(r.temperature)?.inCelsius),
  },
};

/** Passos e distância vêm do pacote da pulseira ou não vêm. */
const ONLY_FROM_BAND = new Set(['Steps', 'Distance']);

/**
 * Os candidatos de um registro: um por amostra no batimento, um nos demais.
 * `null` é uma unidade descartada, para quem chama contar.
 */
function candidatesOf(
  record: unknown,
  ctx: Pick<HealthConnectMappingContext, 'nowMs' | 'bandPackage'>,
): (Candidate | null)[] {
  const r = obj(record);
  if (r === null) return [null];
  const recordType = r.recordType;
  if (!isMonitoredType(recordType)) return [null];
  // Sem id não há identidade estável: reler a mesma amostra viraria evento
  // novo, e o backend gravaria duas vezes.
  const metadata = obj(r.metadata);
  const recordId = metadata?.id;
  if (typeof recordId !== 'string' || recordId === '') return [null];

  if (recordType === 'HeartRate') {
    if (!Array.isArray(r.samples)) return [null];
    return r.samples.map((sample): Candidate | null => {
      const s = obj(sample);
      const atMs = s === null ? null : instantMs(s.time, ctx.nowMs);
      if (s === null || atMs === null) return null;
      return {
        recordType,
        recordId,
        atMs,
        measurements: { heartRate: { value: num(s.beatsPerMinute), unit: 'bpm', source: SOURCE } },
      };
    });
  }

  if (ONLY_FROM_BAND.has(recordType)) {
    if (ctx.bandPackage === null || metadata?.dataOrigin !== ctx.bandPackage) return [null];
  }

  const atMs = instantMs(recordInstant(r), ctx.nowMs);
  if (atMs === null) return [null];

  if (recordType === 'BloodPressure') {
    return [
      {
        recordType,
        recordId,
        atMs,
        measurements: {
          bloodPressure: {
            // A biblioteca entrega número real; o backend só aceita mmHg inteiro.
            value: {
              systolic: Math.round(num(obj(r.systolic)?.inMillimetersOfMercury)),
              diastolic: Math.round(num(obj(r.diastolic)?.inMillimetersOfMercury)),
            },
            unit: 'mmHg',
            source: SOURCE,
          },
        },
      },
    ];
  }

  const single = SINGLE_VALUE[recordType];
  return [
    {
      recordType,
      recordId,
      atMs,
      // A unidade é a da regra da fila para a mesma chave; `outboxEventProblem`
      // confere as duas juntas logo adiante.
      measurements: {
        [single.key]: { value: single.read(r), unit: single.unit, source: SOURCE },
      } as OutboxMeasurements,
    },
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Transforma registros do Health Connect nos eventos da fila. Nunca lança:
 * registro malformado é descartado e contado.
 *
 * Tudo que identifica o evento sai do próprio registro, para reler a mesma
 * amostra (reinício, token de mudanças expirado, releitura das 48 h)
 * reproduzir o evento INTEIRO e o backend responder repetição. Ele compara o
 * conteúdo canônico, que inclui sessão e sequência: um id igual com sessão ou
 * sequência diferente seria conflito de id, não repetição. Por isso:
 *
 * - `eventId` = uuid v5 de `tipo:id do registro:instante`;
 * - `monitoringSessionId` = uuid v5 de `sal:dia UTC do instante`. O dia UTC é
 *   só chave de agrupamento, determinística e sem fuso: não é o dia monitorado
 *   do backend, que ele mesmo calcula pelo horário do evento. O sal vem do
 *   estado do leitor e é a única entrada que não sai do registro;
 * - `sequence` = segundos desde a meia-noite UTC * 8 + posição do tipo. Dentro
 *   de uma sessão e um tipo, a cadência de 15 s torna a sequência do batimento
 *   única; dois registros do mesmo tipo no mesmo segundo colidem, raro e
 *   aceito: o backend responde conflito de sequência e o envio descarta o
 *   segundo.
 *
 * O instante entra normalizado (`toISOString`), para nada disso depender de
 * como a ponte formatou a data.
 *
 * A identidade vale enquanto o sal e a credencial do aparelho forem os mesmos.
 * O sal muda ao reinstalar (o estado do leitor some) e a cada pareamento novo:
 * o backend cria outro aparelho por pareamento e recusa evento de sessão do
 * anterior, e o leitor troca o sal, tira da fila os eventos do Health Connect
 * ainda não enviados e relê as 48 h (`resetForNewPairing`). Nessa releitura,
 * o que já tinha subido produz o mesmo `eventId` sob outra sessão e outro
 * aparelho, e o backend responde conflito de id, que o envio descarta: nenhuma
 * duplicação, só recusas no registro; o que não tinha subido entra na sessão
 * nova. O mesmo conflito vale para um registro reescrito no lugar, com o mesmo
 * `metadata.id` e instante: o valor revisado nunca chega ao backend.
 * Consequências aceitas do desenho.
 */
export function mapHealthConnectRecords(
  records: readonly HealthConnectRecord[],
  ctx: HealthConnectMappingContext,
): HealthConnectMappingResult {
  const events: OutboxEvent[] = [];
  let discarded = 0;
  const candidates: Candidate[] = [];
  for (const record of records) {
    for (const candidate of candidatesOf(record, ctx)) {
      if (candidate === null) discarded += 1;
      else candidates.push(candidate);
    }
  }

  // Ordem do tempo, e não da lista: a cadência do batimento depende dela. No
  // mesmo instante, pela posição do tipo, que é o desempate da sequência: a
  // saída fica na ordem da sequência. `sort` é estável, então amostras do
  // mesmo tipo no mesmo instante mantêm a ordem em que chegaram.
  const typeIndex = (c: Candidate) => HEALTH_CONNECT_RECORD_TYPES.indexOf(c.recordType);
  candidates.sort((a, b) => a.atMs - b.atMs || typeIndex(a) - typeIndex(b));

  const intervals = ctx.bluetoothIntervals ?? [];
  const viaBluetooth = (atMs: number) =>
    intervals.some(({ start, end }) => atMs >= start && atMs <= (end ?? ctx.nowMs));

  let lastHeartRateMs: number | null = null;
  // O mesmo registro pode chegar duas vezes numa leitura (duas páginas que se
  // sobrepõem, uma mudança repetida). O backend o reconheceria pelo id, mas
  // dentro de um lote só a repetição custaria uma recusa.
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const isHeartRate = candidate.measurements.heartRate !== undefined;
    // Antes da cadência: a amostra que sai não conta como aceita.
    if (isHeartRate && viaBluetooth(candidate.atMs)) {
      discarded += 1;
      continue;
    }
    if (
      isHeartRate &&
      lastHeartRateMs !== null &&
      candidate.atMs - lastHeartRateMs < HEART_RATE_MIN_INTERVAL_MS
    ) {
      discarded += 1;
      continue;
    }
    const eventTime = new Date(candidate.atMs).toISOString();
    const eventId = ctx.uuidV5(
      `${candidate.recordType}:${candidate.recordId}:${eventTime}`,
      HEALTH_CONNECT_EVENT_NAMESPACE,
    );
    if (seen.has(eventId)) {
      discarded += 1;
      continue;
    }
    const dayStartMs = Math.floor(candidate.atMs / DAY_MS) * DAY_MS;
    const secondsOfDay = Math.floor((candidate.atMs - dayStartMs) / 1000);
    const event: OutboxEvent = {
      eventId,
      monitoringSessionId: ctx.uuidV5(
        `${ctx.sessionSalt}:${eventTime.slice(0, 10)}`,
        HEALTH_CONNECT_EVENT_NAMESPACE,
      ),
      sequence: secondsOfDay * SEQUENCE_SLOTS_PER_SECOND + typeIndex(candidate),
      eventTime,
      origin: 'REAL',
      measurements: candidate.measurements,
    };
    // A mesma regra da fila, aqui: a amostra de batimento recusada não pode
    // contar como aceita para a cadência, e a conferência também vigia a
    // fórmula da sequência (inteiro não negativo) e o uuid injetado.
    if (outboxEventProblem(event) !== null) {
      discarded += 1;
      continue;
    }
    events.push(event);
    seen.add(eventId);
    if (isHeartRate) lastHeartRateMs = candidate.atMs;
  }

  return { events, discarded };
}
