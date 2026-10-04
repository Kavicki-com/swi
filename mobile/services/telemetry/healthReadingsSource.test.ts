import { createHealthReadingsSource } from '../../modules/swi-watch-control';

// A fonte é a fronteira com o Swift: o que sobe do nativo é dicionário sem
// tipo, e só passa adiante o que tem a forma do contrato. Ausência nunca vira
// número, como no batimento.

const ID = '0a1b2c3d-0000-4000-8000-000000000001';

const pressao = (over: Record<string, unknown> = {}) => ({
  kind: 'bloodPressure',
  id: ID,
  measuredAt: '2026-09-08T07:00:00.000Z',
  systolic: 128,
  diastolic: 82,
  userEntered: false,
  ...over,
});

const temperatura = (over: Record<string, unknown> = {}) => ({
  kind: 'bodyTemperature',
  id: ID,
  measuredAt: '2026-09-08T07:05:00.000Z',
  celsius: 36.8,
  userEntered: true,
  ...over,
});

const nativo = (resposta: unknown) => ({
  readHealthReadings: jest.fn(async (_sinceMs: number) => resposta),
});

describe('createHealthReadingsSource', () => {
  it('sem módulo nativo não é suportada e lê vazio', async () => {
    const source = createHealthReadingsSource(null);
    expect(source.supported).toBe(false);
    expect(await source.read(0)).toEqual([]);
  });

  it('binário sem a função de leitura também não é suportado', async () => {
    const source = createHealthReadingsSource({});
    expect(source.supported).toBe(false);
    expect(await source.read(0)).toEqual([]);
  });

  it('repassa o instante inicial e devolve as medições bem formadas', async () => {
    const native = nativo([pressao(), temperatura()]);
    const source = createHealthReadingsSource(native);

    expect(source.supported).toBe(true);
    expect(await source.read(1_725_000_000_000)).toEqual([pressao(), temperatura()]);
    expect(native.readHealthReadings).toHaveBeenCalledWith(1_725_000_000_000);
  });

  it('identificador sai em minúsculas, a caixa única do sistema', async () => {
    const source = createHealthReadingsSource(nativo([pressao({ id: ID.toUpperCase() })]));
    expect((await source.read(0))[0].id).toBe(ID);
  });

  it('descarta o que não tem a forma do contrato, sem levar as boas junto', async () => {
    const source = createHealthReadingsSource(
      nativo([
        pressao({ systolic: Number.NaN }),
        pressao({ diastolic: undefined }),
        pressao({ id: 'nao-e-uuid' }),
        pressao({ measuredAt: 'ontem' }),
        temperatura({ celsius: '36.8' }),
        { kind: 'glicemia', id: ID, measuredAt: '2026-09-08T07:00:00.000Z', value: 90 },
        null,
        temperatura(),
      ]),
    );
    expect(await source.read(0)).toEqual([temperatura()]);
  });

  it('medição sem a marca de digitada conta como não digitada', async () => {
    const source = createHealthReadingsSource(nativo([pressao({ userEntered: undefined })]));
    expect((await source.read(0))[0].userEntered).toBe(false);
  });

  it('resposta que não é lista é vazio', async () => {
    expect(await createHealthReadingsSource(nativo({ erro: true })).read(0)).toEqual([]);
  });

  // Leitura negada, banco de saúde trancado com o iPhone bloqueado, iOS sem
  // HealthKit: nada disso pode derrubar o envio do que já está na fila.
  it('rejeição do nativo vira vazio', async () => {
    const native = { readHealthReadings: jest.fn(async () => Promise.reject(new Error('trancado'))) };
    expect(await createHealthReadingsSource(native).read(0)).toEqual([]);
  });
});
