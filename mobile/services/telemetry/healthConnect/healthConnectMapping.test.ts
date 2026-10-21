import { createHash } from 'crypto';
import {
  HEALTH_CONNECT_EVENT_NAMESPACE,
  HEALTH_CONNECT_RECORD_TYPES,
  HEALTH_CONNECT_WINDOW_MS,
  HEART_RATE_MIN_INTERVAL_MS,
  SEQUENCE_SLOTS_PER_SECOND,
  mapHealthConnectRecords,
  type HealthConnectMappingContext,
  type HealthConnectRecord,
} from './healthConnectMapping';
import { outboxEventProblem, type OutboxEvent } from '../telemetryOutbox';

// O relógio do teste: 20/10/2026 ao meio-dia UTC. Os instantes dos registros
// são escritos em segundos relativos a ele, negativos para o passado.
const AGORA = Date.parse('2026-10-20T12:00:00.000Z');
const em = (segundos: number) => new Date(AGORA + segundos * 1000).toISOString();

const SAL = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const PULSEIRA = 'com.zepp.app';
const CELULAR = 'com.google.android.apps.fitness';

// Dublê do uuid v5: determinístico como o real (SHA-1 do nome, versão 5,
// variante 8), e grava cada chamada para o teste conferir o nome passado.
function fakeUuidV5() {
  const calls: [string, string][] = [];
  const uuidV5 = (name: string, namespace: string) => {
    calls.push([name, namespace]);
    const hex = createHash('sha1').update(name).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  return { uuidV5, calls };
}

function contexto(over: Partial<HealthConnectMappingContext> = {}) {
  const { uuidV5, calls } = fakeUuidV5();
  const ctx: HealthConnectMappingContext = {
    sessionSalt: SAL,
    nowMs: AGORA,
    bandPackage: PULSEIRA,
    uuidV5,
    ...over,
  };
  return { ctx, calls };
}

// O esperado, calculado por um dublê independente do que está sob teste.
const { uuidV5: esperado } = fakeUuidV5();
const sessaoDoDia = (dia: string) => esperado(`${SAL}:${dia}`, HEALTH_CONNECT_EVENT_NAMESPACE);
const SESSAO_20 = sessaoDoDia('2026-10-20');

// A sequência que a fórmula deve dar para um instante do dia 20 (meio-dia
// menos `segundos`) e um tipo: segundos desde a meia-noite UTC vezes as
// vagas por segundo, mais a posição do tipo.
const MEIA_NOITE_20 = Date.parse('2026-10-20T00:00:00.000Z');
const sequenciaDe = (segundos: number, tipo: (typeof HEALTH_CONNECT_RECORD_TYPES)[number]) =>
  Math.floor((AGORA + segundos * 1000 - MEIA_NOITE_20) / 1000) * SEQUENCE_SLOTS_PER_SECOND +
  HEALTH_CONNECT_RECORD_TYPES.indexOf(tipo);

// Os registros como a ponte nativa os entrega: `recordType`, `metadata` e os
// campos de valor já convertidos (`inMeters`, `inKilocalories`, ...). O cast
// evita preencher campos que o mapeamento não lê (bodyPosition, zoneOffset).
const registro = (shape: Record<string, unknown>) => shape as unknown as HealthConnectRecord;

const metadata = (id: string | undefined, dataOrigin: string = PULSEIRA) => ({
  id,
  dataOrigin,
  lastModifiedTime: em(0),
});

const batimento = (id: string, amostras: [number, number][], origem = PULSEIRA) =>
  registro({
    recordType: 'HeartRate',
    metadata: metadata(id, origem),
    startTime: em(amostras[0]?.[0] ?? 0),
    endTime: em(amostras[amostras.length - 1]?.[0] ?? 0),
    samples: amostras.map(([segundos, bpm]) => ({ time: em(segundos), beatsPerMinute: bpm })),
  });

const passos = (id: string, count: number, inicio: number, fim: number, origem = PULSEIRA) =>
  registro({
    recordType: 'Steps',
    metadata: metadata(id, origem),
    startTime: em(inicio),
    endTime: em(fim),
    count,
  });

const distancia = (id: string, metros: number, inicio: number, fim: number, origem = PULSEIRA) =>
  registro({
    recordType: 'Distance',
    metadata: metadata(id, origem),
    startTime: em(inicio),
    endTime: em(fim),
    distance: { inMeters: metros, inKilometers: metros / 1000, inMiles: 0, inInches: 0, inFeet: 0 },
  });

const calorias = (id: string, kcal: number, inicio: number, fim: number, origem = PULSEIRA) =>
  registro({
    recordType: 'ActiveCaloriesBurned',
    metadata: metadata(id, origem),
    startTime: em(inicio),
    endTime: em(fim),
    energy: { inKilocalories: kcal, inCalories: kcal * 1000, inJoules: 0, inKilojoules: 0 },
  });

const oxigenacao = (id: string, percentage: number, quando: number, origem = PULSEIRA) =>
  registro({
    recordType: 'OxygenSaturation',
    metadata: metadata(id, origem),
    time: em(quando),
    percentage,
  });

const pressao = (id: string, sistolica: number, diastolica: number, quando: number) =>
  registro({
    recordType: 'BloodPressure',
    metadata: metadata(id, 'com.omron.connect'),
    time: em(quando),
    systolic: { inMillimetersOfMercury: sistolica },
    diastolic: { inMillimetersOfMercury: diastolica },
    bodyPosition: 0,
    measurementLocation: 0,
  });

const temperatura = (id: string, celsius: number, quando: number) =>
  registro({
    recordType: 'BodyTemperature',
    metadata: metadata(id, 'com.withings.wiscale2'),
    time: em(quando),
    temperature: { inCelsius: celsius, inFahrenheit: celsius * 1.8 + 32 },
  });

const horarios = (events: readonly OutboxEvent[]) => events.map((e) => e.eventTime);
const sequencias = (events: readonly OutboxEvent[]) => events.map((e) => e.sequence);
const identidade = (e: OutboxEvent) => [e.eventId, e.monitoringSessionId, e.sequence];

describe('batimento', () => {
  it('cada amostra vira um evento com o horário da amostra e a origem HEALTH_CONNECT', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        batimento('hr-1', [
          [-120, 71],
          [-100, 74],
        ]),
      ],
      ctx,
    );
    expect(discarded).toBe(0);
    expect(events).toEqual([
      expect.objectContaining({
        monitoringSessionId: SESSAO_20,
        sequence: sequenciaDe(-120, 'HeartRate'),
        eventTime: em(-120),
        origin: 'REAL',
        measurements: { heartRate: { value: 71, unit: 'bpm', source: 'HEALTH_CONNECT' } },
      }),
      expect.objectContaining({
        monitoringSessionId: SESSAO_20,
        sequence: sequenciaDe(-100, 'HeartRate'),
        eventTime: em(-100),
        measurements: { heartRate: { value: 74, unit: 'bpm', source: 'HEALTH_CONNECT' } },
      }),
    ]);
  });

  it('amostra a menos de 15 s da última aceita é descartada, e a contagem recomeça na aceita', () => {
    expect(HEART_RATE_MIN_INTERVAL_MS).toBe(15_000);
    const { ctx } = contexto();
    // 0 entra; 10 está a 10 s dela; 15 entra (exatos 15 s); 29 está a 14 s
    // da aceita em 15, e não da descartada em 10; 30 entra.
    const { events, discarded } = mapHealthConnectRecords(
      [
        batimento('hr-1', [
          [-300, 70],
          [-290, 71],
          [-285, 72],
          [-271, 73],
          [-270, 74],
        ]),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-300), em(-285), em(-270)]);
    expect(discarded).toBe(2);
  });

  it('a cadência vale entre registros, pela ordem do tempo e não da lista', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        batimento('hr-2', [
          [-280, 80],
          [-250, 81],
        ]),
        batimento('hr-1', [
          [-300, 70],
          [-275, 71],
        ]),
      ],
      ctx,
    );
    // -300 entra; -280 entra (20 s); -275 está a 5 s de -280; -250 entra.
    expect(horarios(events)).toEqual([em(-300), em(-280), em(-250)]);
    expect(discarded).toBe(1);
  });

  it('amostra sem bpm numérico é descartada sem contar como aceita para a cadência', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        registro({
          recordType: 'HeartRate',
          metadata: metadata('hr-1'),
          startTime: em(-300),
          endTime: em(-290),
          samples: [
            { time: em(-300), beatsPerMinute: 70 },
            { time: em(-295), beatsPerMinute: 'setenta' },
            { time: em(-290), beatsPerMinute: 72 },
            'não é amostra',
          ],
        }),
      ],
      ctx,
    );
    // -295 cai por valor e -290 cai por estar a 10 s de -300, a última aceita.
    expect(horarios(events)).toEqual([em(-300)]);
    expect(discarded).toBe(3);
  });
});

describe('registros de intervalo', () => {
  it('passos viram stepDelta inteiro arredondado, com eventTime = endTime', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords([passos('st-1', 40.4, -600, -300)], ctx);
    expect(events).toEqual([
      expect.objectContaining({
        eventTime: em(-300),
        measurements: { stepDelta: { value: 40, unit: 'steps', source: 'HEALTH_CONNECT' } },
      }),
    ]);
  });

  it('distância vira distanceDeltaM em metros, com eventTime = endTime', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords([distancia('di-1', 31.5, -600, -300)], ctx);
    expect(events).toEqual([
      expect.objectContaining({
        eventTime: em(-300),
        measurements: { distanceDeltaM: { value: 31.5, unit: 'm', source: 'HEALTH_CONNECT' } },
      }),
    ]);
  });

  it('calorias ativas viram activeEnergyKcal, com eventTime = endTime', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords([calorias('ca-1', 2.4, -600, -300)], ctx);
    expect(events).toEqual([
      expect.objectContaining({
        eventTime: em(-300),
        measurements: { activeEnergyKcal: { value: 2.4, unit: 'kcal', source: 'HEALTH_CONNECT' } },
      }),
    ]);
  });
});

describe('medições pontuais', () => {
  it('oxigenação vira oxygenSaturation com o horário da medição', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords([oxigenacao('ox-1', 97, -3600)], ctx);
    expect(events).toEqual([
      expect.objectContaining({
        eventTime: em(-3600),
        measurements: { oxygenSaturation: { value: 97, unit: '%', source: 'HEALTH_CONNECT' } },
      }),
    ]);
  });

  it('pressão vira o par em mmHg inteiro arredondado', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords([pressao('bp-1', 124.4, 79.6, -3600)], ctx);
    expect(events).toEqual([
      expect.objectContaining({
        eventTime: em(-3600),
        measurements: {
          bloodPressure: {
            value: { systolic: 124, diastolic: 80 },
            unit: 'mmHg',
            source: 'HEALTH_CONNECT',
          },
        },
      }),
    ]);
  });

  it('temperatura vira bodyTemperature em °C', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords([temperatura('bt-1', 36.6, -3600)], ctx);
    expect(events).toEqual([
      expect.objectContaining({
        eventTime: em(-3600),
        measurements: { bodyTemperature: { value: 36.6, unit: '°C', source: 'HEALTH_CONNECT' } },
      }),
    ]);
  });
});

describe('origem dos passos e da distância', () => {
  it('passos e distância só entram quando o dataOrigin é o pacote da pulseira', () => {
    const { ctx } = contexto({ bandPackage: PULSEIRA });
    const { events, discarded } = mapHealthConnectRecords(
      [
        passos('st-celular', 500, -600, -300, CELULAR),
        passos('st-pulseira', 40, -600, -299),
        distancia('di-celular', 400, -600, -298, CELULAR),
        distancia('di-pulseira', 30, -600, -297),
      ],
      ctx,
    );
    expect(events.map((e) => e.measurements)).toEqual([
      { stepDelta: { value: 40, unit: 'steps', source: 'HEALTH_CONNECT' } },
      { distanceDeltaM: { value: 30, unit: 'm', source: 'HEALTH_CONNECT' } },
    ]);
    expect(discarded).toBe(2);
  });

  it('sem pulseira detectada, passos e distância são todos descartados', () => {
    const { ctx } = contexto({ bandPackage: null });
    const { events, discarded } = mapHealthConnectRecords(
      [passos('st-1', 40, -600, -300), distancia('di-1', 30, -600, -299)],
      ctx,
    );
    expect(events).toEqual([]);
    expect(discarded).toBe(2);
  });

  it('as outras medições entram de qualquer origem, mesmo sem pulseira detectada', () => {
    const { ctx } = contexto({ bandPackage: null });
    const { events, discarded } = mapHealthConnectRecords(
      [
        batimento('hr-1', [[-500, 70]], CELULAR),
        calorias('ca-1', 2.4, -600, -400, CELULAR),
        oxigenacao('ox-1', 97, -300, CELULAR),
        pressao('bp-1', 120, 80, -200),
        temperatura('bt-1', 36.6, -100),
      ],
      ctx,
    );
    expect(discarded).toBe(0);
    expect(events.map((e) => Object.keys(e.measurements)[0])).toEqual([
      'heartRate',
      'activeEnergyKcal',
      'oxygenSaturation',
      'bloodPressure',
      'bodyTemperature',
    ]);
  });
});

describe('identidade do evento', () => {
  it('eventId sai do uuid v5 de tipo:id:instante, com o namespace fixo do arquivo', () => {
    expect(HEALTH_CONNECT_EVENT_NAMESPACE).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const { ctx, calls } = contexto();
    const { events } = mapHealthConnectRecords(
      [
        batimento('hr-1', [
          [-300, 70],
          [-270, 71],
        ]),
        passos('st-1', 40, -600, -200),
      ],
      ctx,
    );
    // As chamadas da sessão (nome que começa pelo sal) ficam de fora aqui.
    const doEvento = calls.filter(([name]) => !name.startsWith(SAL));
    expect(doEvento).toEqual([
      [`HeartRate:hr-1:${em(-300)}`, HEALTH_CONNECT_EVENT_NAMESPACE],
      [`HeartRate:hr-1:${em(-270)}`, HEALTH_CONNECT_EVENT_NAMESPACE],
      [`Steps:st-1:${em(-200)}`, HEALTH_CONNECT_EVENT_NAMESPACE],
    ]);
    expect(events.map((e) => e.eventId)).toEqual(
      doEvento.map(([name, namespace]) => esperado(name, namespace)),
    );
  });

  it('a sessão sai do uuid v5 de sal:dia UTC, com o mesmo namespace', () => {
    const { ctx, calls } = contexto();
    mapHealthConnectRecords([oxigenacao('ox-1', 97, -300)], ctx);
    expect(calls).toContainEqual([`${SAL}:2026-10-20`, HEALTH_CONNECT_EVENT_NAMESPACE]);
  });

  it('a mesma amostra relida em outra chamada, com outro agora, reproduz eventId, sessão e sequência', () => {
    const registros = [
      batimento('hr-1', [[-300, 70]]),
      oxigenacao('ox-1', 97, -200),
      passos('st-1', 40, -600, -100),
    ];
    const primeira = mapHealthConnectRecords(registros, contexto().ctx);
    const segunda = mapHealthConnectRecords(registros, contexto({ nowMs: AGORA + 3_600_000 }).ctx);
    expect(primeira.events).toHaveLength(3);
    expect(segunda.events.map(identidade)).toEqual(primeira.events.map(identidade));
    expect(new Set(primeira.events.map((e) => e.eventId)).size).toBe(3);
  });

  it('outro sal dá outra sessão para a mesma amostra, e o mesmo eventId', () => {
    const registros = [oxigenacao('ox-1', 97, -200)];
    const [a] = mapHealthConnectRecords(registros, contexto().ctx).events;
    const [b] = mapHealthConnectRecords(
      registros,
      contexto({ sessionSalt: 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2' }).ctx,
    ).events;
    expect(b.eventId).toBe(a.eventId);
    expect(b.sequence).toBe(a.sequence);
    expect(b.monitoringSessionId).not.toBe(a.monitoringSessionId);
  });

  it('o mesmo registro entregue duas vezes na mesma chamada vira um evento só', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        passos('st-1', 40, -600, -300),
        oxigenacao('ox-1', 97, -200),
        passos('st-1', 40, -600, -300),
        oxigenacao('ox-1', 97, -200),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-300), em(-200)]);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(2);
    expect(discarded).toBe(2);
  });

  it('registro sem metadata.id é descartado: não há identidade estável para repetir', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        oxigenacao('ox-ok', 97, -300),
        registro({
          recordType: 'OxygenSaturation',
          metadata: { dataOrigin: PULSEIRA },
          time: em(-200),
          percentage: 96,
        }),
        registro({ recordType: 'OxygenSaturation', time: em(-100), percentage: 95 }),
        batimento('', [[-50, 70]]),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-300)]);
    expect(discarded).toBe(3);
  });
});

describe('sessão e sequência', () => {
  it('a sessão agrupa pelo dia UTC do instante: dois dias, duas sessões', () => {
    const { ctx } = contexto();
    // 23:59:30 do dia 19 e 00:00:30 do dia 20, em UTC.
    const { events } = mapHealthConnectRecords(
      [oxigenacao('ox-19', 97, -12 * 3600 - 30), oxigenacao('ox-20', 96, -12 * 3600 + 30)],
      ctx,
    );
    expect(events.map((e) => e.monitoringSessionId)).toEqual([
      sessaoDoDia('2026-10-19'),
      SESSAO_20,
    ]);
    expect(events[0].monitoringSessionId).not.toBe(events[1].monitoringSessionId);
  });

  it('amostra à meia-noite UTC tem sequência igual à posição do tipo', () => {
    expect(HEALTH_CONNECT_RECORD_TYPES).toEqual([
      'HeartRate',
      'Steps',
      'Distance',
      'ActiveCaloriesBurned',
      'OxygenSaturation',
      'BloodPressure',
      'BodyTemperature',
    ]);
    expect(SEQUENCE_SLOTS_PER_SECOND).toBe(8);
    const meiaNoite = -12 * 3600;
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords(
      [
        batimento('hr', [[meiaNoite, 70]]),
        passos('st', 40, meiaNoite - 60, meiaNoite),
        distancia('di', 30, meiaNoite - 60, meiaNoite),
        calorias('ca', 2.4, meiaNoite - 60, meiaNoite),
        oxigenacao('ox', 97, meiaNoite),
        pressao('bp', 120, 80, meiaNoite),
        temperatura('bt', 36.6, meiaNoite),
      ],
      ctx,
    );
    expect(sequencias(events)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('a sequência é segundos desde a meia-noite UTC vezes 8 mais a posição do tipo', () => {
    const { ctx } = contexto();
    // 11:55:00.500 UTC: a fração de segundo não entra na conta.
    const instante = '2026-10-20T11:55:00.500Z';
    const { events } = mapHealthConnectRecords(
      [
        registro({
          recordType: 'BodyTemperature',
          metadata: metadata('bt'),
          time: instante,
          temperature: { inCelsius: 36.6 },
        }),
      ],
      ctx,
    );
    expect(events[0].sequence).toBe((11 * 3600 + 55 * 60) * 8 + 6);
  });

  it('dois tipos no mesmo segundo têm sequências diferentes', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords(
      [batimento('hr', [[-300, 70]]), oxigenacao('ox', 97, -300), passos('st', 40, -600, -300)],
      ctx,
    );
    expect(events).toHaveLength(3);
    expect(new Set(sequencias(events)).size).toBe(3);
    expect(sequencias(events)).toEqual([
      sequenciaDe(-300, 'HeartRate'),
      sequenciaDe(-300, 'Steps'),
      sequenciaDe(-300, 'OxygenSaturation'),
    ]);
  });

  it('o último segundo do dia ainda cabe: a sequência é inteira e não negativa', () => {
    const { ctx } = contexto();
    const { events } = mapHealthConnectRecords(
      [temperatura('bt', 36.6, -12 * 3600 - 1)],
      ctx,
    );
    expect(events[0].sequence).toBe(86_399 * 8 + 6);
    expect(outboxEventProblem(events[0])).toBeNull();
  });
});

describe('descarte', () => {
  it('registro ou amostra com mais de 48 h é descartado; com exatas 48 h, entra', () => {
    expect(HEALTH_CONNECT_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    const janela = HEALTH_CONNECT_WINDOW_MS / 1000;
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        batimento('hr-1', [
          [-janela - 1, 70],
          [-janela, 71],
        ]),
        passos('st-velho', 40, -janela - 600, -janela - 1),
        oxigenacao('ox-velha', 97, -janela - 1),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-janela)]);
    expect(discarded).toBe(3);
  });

  it('fração de segundo com 6 ou 9 dígitos, como o Kotlin escreve, é lida com milissegundos', () => {
    const { ctx, calls } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        registro({
          recordType: 'OxygenSaturation',
          metadata: metadata('ox-9'),
          time: '2026-10-20T11:59:00.123456789Z',
          percentage: 97,
        }),
        registro({
          recordType: 'OxygenSaturation',
          metadata: metadata('ox-6'),
          time: '2026-10-20T11:59:30.654321Z',
          percentage: 96,
        }),
      ],
      ctx,
    );
    expect(discarded).toBe(0);
    expect(horarios(events)).toEqual(['2026-10-20T11:59:00.123Z', '2026-10-20T11:59:30.654Z']);
    expect(calls.map(([name]) => name).filter((name) => !name.startsWith(SAL))).toEqual([
      'OxygenSaturation:ox-9:2026-10-20T11:59:00.123Z',
      'OxygenSaturation:ox-6:2026-10-20T11:59:30.654Z',
    ]);
  });

  it('horário ilegível descarta o registro ou a amostra, sem lançar', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        registro({
          recordType: 'HeartRate',
          metadata: metadata('hr-1'),
          startTime: em(-300),
          endTime: em(-200),
          samples: [
            { time: 'ontem', beatsPerMinute: 70 },
            { time: 12345, beatsPerMinute: 70 },
            { time: em(-200), beatsPerMinute: 72 },
          ],
        }),
        registro({ recordType: 'Steps', metadata: metadata('st-1'), startTime: em(-300), count: 10 }),
        registro({
          recordType: 'OxygenSaturation',
          metadata: metadata('ox-1'),
          time: null,
          percentage: 97,
        }),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-200)]);
    expect(discarded).toBe(4);
  });

  it('o que a fila recusa é descartado aqui: valor não finito, passos negativos, pressão sem par', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        passos('st-neg', -5, -600, -300),
        registro({
          recordType: 'Steps',
          metadata: metadata('st-nulo'),
          startTime: em(-600),
          endTime: em(-299),
          count: null,
        }),
        registro({
          recordType: 'Distance',
          metadata: metadata('di-sem'),
          startTime: em(-600),
          endTime: em(-298),
        }),
        registro({
          recordType: 'ActiveCaloriesBurned',
          metadata: metadata('ca-nan'),
          startTime: em(-600),
          endTime: em(-297),
          energy: { inKilocalories: Number.NaN },
        }),
        registro({
          recordType: 'OxygenSaturation',
          metadata: metadata('ox-str'),
          time: em(-296),
          percentage: '97',
        }),
        registro({
          recordType: 'BloodPressure',
          metadata: metadata('bp-meio'),
          time: em(-295),
          systolic: { inMillimetersOfMercury: 120 },
        }),
        registro({
          recordType: 'BodyTemperature',
          metadata: metadata('bt-inf'),
          time: em(-294),
          temperature: { inCelsius: Number.POSITIVE_INFINITY },
        }),
        temperatura('bt-ok', 36.6, -293),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-293)]);
    expect(discarded).toBe(7);
  });

  it('valor fora da faixa do backend NÃO é descartado aqui: ele recusa por evento, dentro de um 2xx', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [batimento('hr-1', [[-300, 350]]), temperatura('bt-1', 29, -200), pressao('bp-1', 400, 10, -100)],
      ctx,
    );
    expect(discarded).toBe(0);
    expect(events).toHaveLength(3);
  });

  it('registro malformado, de tipo desconhecido ou que não é objeto é descartado sem lançar', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(
      [
        registro({
          recordType: 'HeartRate',
          metadata: metadata('hr-sem'),
          startTime: em(-300),
          endTime: em(-200),
        }),
        registro({ recordType: 'HeartRate', metadata: metadata('hr-obj'), samples: { time: em(-200) } }),
        registro({
          recordType: 'Weight',
          metadata: metadata('w-1'),
          time: em(-200),
          weight: { inKilograms: 80 },
        }),
        registro({ metadata: metadata('sem-tipo'), time: em(-200) }),
        null as unknown as HealthConnectRecord,
        'texto' as unknown as HealthConnectRecord,
        registro({
          recordType: 'Steps',
          metadata: 'não é objeto',
          startTime: em(-300),
          endTime: em(-200),
          count: 3,
        }),
        oxigenacao('ox-ok', 97, -100),
      ],
      ctx,
    );
    expect(horarios(events)).toEqual([em(-100)]);
    expect(discarded).toBe(7);
  });

  it('lista vazia produz saída vazia', () => {
    expect(mapHealthConnectRecords([], contexto().ctx)).toEqual({ events: [], discarded: 0 });
  });
});

describe('saída', () => {
  const amostra = () => [
    oxigenacao('ox-1', 97, -100),
    batimento('hr-1', [
      [-500, 70],
      [-400, 71],
    ]),
    pressao('bp-1', 120, 80, -250),
    temperatura('bt-1', 36.6, -200),
    calorias('ca-1', 2.4, -600, -300),
    distancia('di-1', 30, -600, -350),
    passos('st-1', 40, -600, -450),
  ];

  it('eventos saem em ordem crescente de eventTime, com a sequência crescendo junto', () => {
    const { ctx } = contexto();
    const { events, discarded } = mapHealthConnectRecords(amostra(), ctx);
    expect(discarded).toBe(0);
    expect(horarios(events)).toEqual([
      em(-500),
      em(-450),
      em(-400),
      em(-350),
      em(-300),
      em(-250),
      em(-200),
      em(-100),
    ]);
    const seqs = sequencias(events);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('só HEALTH_CONNECT aparece como origem, e nunca bateria nem contagem de movimento', () => {
    const { events } = mapHealthConnectRecords(amostra(), contexto().ctx);
    const medicoes = events.flatMap((e) => Object.entries(e.measurements));
    expect(medicoes).toHaveLength(8);
    for (const [key, measurement] of medicoes) {
      expect(['battery', 'motionCount']).not.toContain(key);
      expect(measurement?.source).toBe('HEALTH_CONNECT');
    }
  });

  it('cada um dos sete tipos produz um evento que a fila aceita', () => {
    const { events } = mapHealthConnectRecords(amostra(), contexto().ctx);
    const tipos = new Set(events.map((e) => Object.keys(e.measurements)[0]));
    expect(tipos).toEqual(
      new Set([
        'heartRate',
        'stepDelta',
        'distanceDeltaM',
        'activeEnergyKcal',
        'oxygenSaturation',
        'bloodPressure',
        'bodyTemperature',
      ]),
    );
    for (const event of events) expect(outboxEventProblem(event)).toBeNull();
  });
});
