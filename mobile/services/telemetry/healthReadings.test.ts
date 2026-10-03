import type { HealthReading, HealthReadingsSource } from '../../modules/swi-watch-control';
import {
  HEALTH_READ_INTERVAL_MS,
  HEALTH_READING_WINDOW_MS,
  createHealthReadingsReader,
  healthReadingEvent,
} from './healthReadings';
import { createTelemetryOutbox, type OutboxStorage } from './telemetryOutbox';

// Dublê do arquivo da fila, o mesmo padrão do teste dela: um texto em memória.
function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const pressao = (n: number, over: Partial<HealthReading> = {}): HealthReading =>
  ({
    kind: 'bloodPressure',
    id: uid(n),
    measuredAt: '2026-09-08T07:00:00.000Z',
    systolic: 128,
    diastolic: 82,
    userEntered: false,
    ...over,
  }) as HealthReading;

const temperatura = (n: number, over: Partial<HealthReading> = {}): HealthReading =>
  ({
    kind: 'bodyTemperature',
    id: uid(n),
    measuredAt: '2026-09-08T07:05:00.000Z',
    celsius: 36.8,
    userEntered: true,
    ...over,
  }) as HealthReading;

function fonte(leituras: HealthReading[], supported = true) {
  const read = jest.fn(async (_sinceMs: number) => leituras);
  const source: HealthReadingsSource = { supported, read };
  return { source, read };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('healthReadingEvent', () => {
  it('pressão de aparelho vira evento com o horário da medição e origem EXTERNAL_CUFF', () => {
    expect(healthReadingEvent(pressao(1))).toEqual({
      eventId: uid(1),
      monitoringSessionId: uid(1),
      sequence: 0,
      eventTime: '2026-09-08T07:00:00.000Z',
      origin: 'REAL',
      measurements: {
        bloodPressure: {
          value: { systolic: 128, diastolic: 82 },
          unit: 'mmHg',
          source: 'EXTERNAL_CUFF',
        },
      },
    });
  });

  it('pressão digitada no app Saúde sai como MANUAL_HEALTHKIT', () => {
    const event = healthReadingEvent(pressao(1, { userEntered: true }));
    expect(event.measurements.bloodPressure?.source).toBe('MANUAL_HEALTHKIT');
  });

  it('arredonda a pressão para inteiro, que é o que o backend aceita em mmHg', () => {
    const event = healthReadingEvent(pressao(1, { systolic: 127.6, diastolic: 81.4 } as never));
    expect(event.measurements.bloodPressure?.value).toEqual({ systolic: 128, diastolic: 81 });
  });

  it('temperatura vira evento em graus Celsius com uma casa, sempre MANUAL_HEALTHKIT', () => {
    const event = healthReadingEvent(temperatura(2, { celsius: 36.84, userEntered: false } as never));
    expect(event).toEqual({
      eventId: uid(2),
      monitoringSessionId: uid(2),
      sequence: 0,
      eventTime: '2026-09-08T07:05:00.000Z',
      origin: 'REAL',
      measurements: { bodyTemperature: { value: 36.8, unit: '°C', source: 'MANUAL_HEALTHKIT' } },
    });
  });

});

describe('createHealthReadingsReader', () => {
  const AGORA = Date.parse('2026-09-08T12:00:00.000Z');

  function montar(leituras: HealthReading[], supported = true) {
    const f = fonte(leituras, supported);
    const outbox = createTelemetryOutbox(memoryStorage());
    let now = AGORA;
    const reader = createHealthReadingsReader({ source: f.source, outbox, now: () => now });
    return { ...f, outbox, reader, avancar: (ms: number) => (now += ms) };
  }

  it('lê as últimas 72 horas e põe cada medição na fila', async () => {
    const { reader, read, outbox } = montar([pressao(1), temperatura(2)]);

    expect(await reader.run()).toBe(2);

    expect(read).toHaveBeenCalledWith(AGORA - HEALTH_READING_WINDOW_MS);
    expect((await outbox.pending()).map((e) => e.eventId)).toEqual([uid(1), uid(2)]);
  });

  it('não enfileira de novo a medição que já enfileirou', async () => {
    const { reader, outbox, avancar } = montar([pressao(1)]);
    await reader.run();
    avancar(HEALTH_READ_INTERVAL_MS);

    expect(await reader.run()).toBe(0);
    expect(await outbox.pending()).toHaveLength(1);
  });

  // Depois de enviada, a medição sai da fila mas continua no app Saúde por
  // 72 horas. Sem a memória do que já foi enfileirado ela subiria de novo a
  // cada minuto.
  it('não reenfileira a medição que já subiu e saiu da fila', async () => {
    const { reader, read, outbox, avancar } = montar([pressao(1)]);
    await reader.run();
    await outbox.remove([uid(1)]);
    avancar(HEALTH_READ_INTERVAL_MS);

    expect(await reader.run()).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await outbox.pending()).toEqual([]);
  });

  it('não insiste na medição que a fila recusou por estar fora do contrato', async () => {
    const { reader, outbox, avancar } = montar([pressao(1, { id: 'nao-e-uuid' })]);
    const appendMany = jest.spyOn(outbox, 'appendMany');
    expect(await reader.run()).toBe(0);
    avancar(HEALTH_READ_INTERVAL_MS);

    expect(await reader.run()).toBe(0);
    expect(appendMany).toHaveBeenCalledTimes(1);
  });

  // O leitor roda dentro do ciclo que envia a telemetria do relógio. Uma
  // consulta ao app Saúde que nunca responde não pode segurar esse ciclo.
  it('desiste da leitura que não responde no prazo, e tenta de novo depois', async () => {
    const f = fonte([pressao(1)]);
    f.read.mockImplementationOnce(() => new Promise<HealthReading[]>(() => undefined));
    const outbox = createTelemetryOutbox(memoryStorage());
    let now = AGORA;
    const reader = createHealthReadingsReader({
      source: f.source,
      outbox,
      now: () => now,
      timeoutMs: 5,
    });

    expect(await reader.run()).toBe(0);
    expect(warn).toHaveBeenCalled();

    now += HEALTH_READ_INTERVAL_MS;
    expect(await reader.run()).toBe(1);
  });

  it('medição nova numa leitura seguinte entra sozinha', async () => {
    const leituras = [pressao(1)];
    const { reader, outbox, avancar } = montar(leituras);
    await reader.run();
    leituras.push(pressao(3, { measuredAt: '2026-09-08T11:59:00.000Z' }));
    avancar(HEALTH_READ_INTERVAL_MS);

    expect(await reader.run()).toBe(1);
    expect((await outbox.pending()).map((e) => e.eventId)).toEqual([uid(1), uid(3)]);
  });

  // O envio drena a cada 15 s. Consultar o HealthKit nesse ritmo seria ler o
  // banco de saúde para uma medição que acontece poucas vezes por dia.
  it('não consulta o app Saúde mais de uma vez por intervalo', async () => {
    const { reader, read, avancar } = montar([pressao(1)]);
    await reader.run();
    avancar(HEALTH_READ_INTERVAL_MS - 1);
    await reader.run();
    expect(read).toHaveBeenCalledTimes(1);

    avancar(1);
    await reader.run();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('não duplica o que outra instância já deixou na fila', async () => {
    const { reader, outbox } = montar([pressao(1)]);
    await outbox.append(healthReadingEvent(pressao(1)));

    expect(await reader.run()).toBe(0);
    expect(await outbox.pending()).toHaveLength(1);
  });

  // Marcar antes de gravar perderia a medição: ela ficaria como enfileirada sem
  // estar na fila, e só voltaria num reinício do app.
  it('se a fila não gravou, a medição volta na leitura seguinte', async () => {
    const { reader, outbox, avancar } = montar([pressao(1)]);
    const appendMany = jest.spyOn(outbox, 'appendMany');
    appendMany.mockRejectedValueOnce(new Error('disco cheio'));

    expect(await reader.run()).toBe(0);
    expect(warn).toHaveBeenCalled();

    avancar(HEALTH_READ_INTERVAL_MS);
    expect(await reader.run()).toBe(1);
    expect((await outbox.pending()).map((e) => e.eventId)).toEqual([uid(1)]);
  });

  it('sem módulo nativo não consulta nem enfileira', async () => {
    const { reader, read, outbox } = montar([pressao(1)], false);

    expect(await reader.run()).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(await outbox.pending()).toEqual([]);
  });

  it('falha na leitura não rejeita: avisa e tenta de novo no próximo intervalo', async () => {
    const { reader, read, avancar } = montar([pressao(1)]);
    read.mockRejectedValueOnce(new Error('banco de saúde trancado'));

    expect(await reader.run()).toBe(0);
    expect(warn).toHaveBeenCalled();

    avancar(HEALTH_READ_INTERVAL_MS);
    expect(await reader.run()).toBe(1);
  });
});
