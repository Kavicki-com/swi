import {
  HEALTH_CONNECT_MAX_PAGES,
  createHealthConnectSource,
  healthConnectSource,
  type HealthConnectLib,
} from './healthConnectSource';
import { HEALTH_CONNECT_RECORD_TYPES } from './healthConnectMapping';

// A porta é a fronteira com a biblioteca: o que sobe da ponte nativa é JSON
// sem garantia de forma, e só passa adiante o que o leitor sabe usar. Aqui a
// biblioteca é um dublê com as mesmas funções; a de verdade só existe num
// Android compilado.

type Perm = { accessType: string; recordType: string };
type ReadPage = Awaited<ReturnType<HealthConnectLib['readRecords']>>;
type ChangesPage = Awaited<ReturnType<HealthConnectLib['getChanges']>>;

const SEM_MUDANCAS: ChangesPage = {
  upsertionChanges: [],
  nextChangesToken: 'token-1',
  changesTokenExpired: false,
  hasMore: false,
};

function libFalsa(over: Partial<HealthConnectLib> = {}) {
  return {
    getSdkStatus: jest.fn(async () => 3),
    initialize: jest.fn(async () => true),
    getGrantedPermissions: jest.fn(async (): Promise<Perm[]> => []),
    requestPermission: jest.fn(async (perms: readonly Perm[]): Promise<Perm[]> => [...perms]),
    readRecords: jest.fn(async (): Promise<ReadPage> => ({ records: [] })),
    getChanges: jest.fn(async (): Promise<ChangesPage> => SEM_MUDANCAS),
    openHealthConnectSettings: jest.fn(),
    ...over,
  };
}

describe('createHealthConnectSource: disponibilidade', () => {
  it('disponível inicializa a biblioteca uma vez só, por mais que se pergunte', async () => {
    const lib = libFalsa();
    const source = createHealthConnectSource(lib);

    expect(await source.availability()).toBe('available');
    expect(await source.availability()).toBe('available');
    expect(lib.initialize).toHaveBeenCalledTimes(1);
  });

  it('provedor desatualizado pede atualização, sem inicializar', async () => {
    const lib = libFalsa({ getSdkStatus: jest.fn(async () => 2) });
    expect(await createHealthConnectSource(lib).availability()).toBe('update_required');
    expect(lib.initialize).not.toHaveBeenCalled();
  });

  it('status 1, ou qualquer outro número, é indisponível', async () => {
    const status = (n: number) => libFalsa({ getSdkStatus: jest.fn(async () => n) });
    expect(await createHealthConnectSource(status(1)).availability()).toBe('unavailable');
    expect(await createHealthConnectSource(status(99)).availability()).toBe('unavailable');
  });

  it('exceção da biblioteca é indisponível, nunca rejeição', async () => {
    const lib = libFalsa({
      getSdkStatus: jest.fn(async () => {
        throw new Error('não linkado');
      }),
    });
    expect(await createHealthConnectSource(lib).availability()).toBe('unavailable');
  });

  it('inicialização recusada é indisponível e é tentada de novo na próxima pergunta', async () => {
    const initialize = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce(true);
    const source = createHealthConnectSource(libFalsa({ initialize }));

    expect(await source.availability()).toBe('unavailable');
    expect(await source.availability()).toBe('unavailable');
    expect(await source.availability()).toBe('available');
    expect(initialize).toHaveBeenCalledTimes(3);
  });
});

describe('createHealthConnectSource: permissões', () => {
  it('concedidas: só os tipos de leitura, sem repetição, inclusive a de segundo plano', async () => {
    const lib = libFalsa({
      getGrantedPermissions: jest.fn(async () => [
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'write', recordType: 'Steps' },
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'BackgroundAccessPermission' },
        { accessType: 'read', recordType: 42 } as unknown as Perm,
        null as unknown as Perm,
      ]),
    });
    const source = createHealthConnectSource(lib);

    expect(await source.grantedPermissions()).toEqual(['HeartRate', 'BackgroundAccessPermission']);
    // A biblioteca exige `initialize` antes de qualquer outra chamada.
    expect(lib.initialize).toHaveBeenCalledTimes(1);
  });

  it('resposta que não é lista vira nenhuma concedida', async () => {
    const lib = libFalsa({ getGrantedPermissions: jest.fn(async () => null as unknown as Perm[]) });
    expect(await createHealthConnectSource(lib).grantedPermissions()).toEqual([]);
  });

  it('pede leitura dos sete tipos e de segundo plano, e não pede o histórico', async () => {
    const lib = libFalsa({
      requestPermission: jest.fn(async () => [
        { accessType: 'read', recordType: 'HeartRate' },
        { accessType: 'read', recordType: 'Steps' },
      ]),
    });
    const source = createHealthConnectSource(lib);

    expect(await source.requestPermissions()).toEqual(['HeartRate', 'Steps']);
    expect(lib.requestPermission).toHaveBeenCalledWith([
      ...HEALTH_CONNECT_RECORD_TYPES.map((recordType) => ({ accessType: 'read', recordType })),
      { accessType: 'read', recordType: 'BackgroundAccessPermission' },
    ]);
  });

  it('inicialização recusada faz a chamada de dados rejeitar', async () => {
    const lib = libFalsa({ initialize: jest.fn(async () => false) });
    await expect(createHealthConnectSource(lib).grantedPermissions()).rejects.toThrow(
      'Health Connect não inicializou',
    );
    expect(lib.getGrantedPermissions).not.toHaveBeenCalled();
  });
});

describe('createHealthConnectSource: leitura de registros', () => {
  it('percorre todas as páginas e repõe o tipo em cada registro', async () => {
    const readRecords = jest
      .fn<Promise<ReadPage>, unknown[]>()
      .mockResolvedValueOnce({ records: [{ metadata: { id: 'a' } }], pageToken: 'p2' })
      .mockResolvedValueOnce({
        records: [{ metadata: { id: 'b' }, recordType: 'Outro' }],
        pageToken: '',
      });
    const source = createHealthConnectSource(libFalsa({ readRecords }));

    const records = await source.readRecords('Steps', Date.parse('2026-10-18T12:00:00.000Z'));

    expect(records).toEqual([
      { metadata: { id: 'a' }, recordType: 'Steps' },
      { metadata: { id: 'b' }, recordType: 'Steps' },
    ]);
    const filtro = { operator: 'after', startTime: '2026-10-18T12:00:00.000Z' };
    expect(readRecords).toHaveBeenNthCalledWith(1, 'Steps', {
      timeRangeFilter: filtro,
      pageSize: expect.any(Number),
    });
    expect(readRecords).toHaveBeenNthCalledWith(2, 'Steps', {
      timeRangeFilter: filtro,
      pageSize: expect.any(Number),
      pageToken: 'p2',
    });
  });

  it('com fim, o filtro é entre os dois instantes', async () => {
    const lib = libFalsa();
    await createHealthConnectSource(lib).readRecords(
      'HeartRate',
      Date.parse('2026-10-18T12:00:00.000Z'),
      Date.parse('2026-10-20T12:00:00.000Z'),
    );
    expect(lib.readRecords).toHaveBeenCalledWith('HeartRate', {
      timeRangeFilter: {
        operator: 'between',
        startTime: '2026-10-18T12:00:00.000Z',
        endTime: '2026-10-20T12:00:00.000Z',
      },
      pageSize: expect.any(Number),
    });
  });

  it('página sem lista e registro que não é objeto não viram nada', async () => {
    const readRecords = jest
      .fn<Promise<ReadPage>, unknown[]>()
      .mockResolvedValueOnce({ records: [null, 7, { metadata: { id: 'a' } }], pageToken: 'p2' })
      .mockResolvedValueOnce({ records: 'lixo' as unknown as unknown[] });
    const source = createHealthConnectSource(libFalsa({ readRecords }));

    expect(await source.readRecords('Steps', 0)).toEqual([
      { metadata: { id: 'a' }, recordType: 'Steps' },
    ]);
  });

  it('no limite de páginas lança, em vez de devolver uma leitura pela metade', async () => {
    let page = 0;
    const readRecords = jest.fn(async (): Promise<ReadPage> => {
      page += 1;
      return { records: [{ metadata: { id: `r${page}` } }], pageToken: `p${page + 1}` };
    });
    const source = createHealthConnectSource(libFalsa({ readRecords }));

    await expect(source.readRecords('HeartRate', 0)).rejects.toThrow(
      `limite de ${HEALTH_CONNECT_MAX_PAGES} páginas`,
    );
    expect(readRecords).toHaveBeenCalledTimes(HEALTH_CONNECT_MAX_PAGES);
  });
});

describe('createHealthConnectSource: prazo por chamada', () => {
  const demora = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  describe('com relógio falso', () => {
    // Determinístico: o tempo só anda quando o teste manda, e uma máquina de
    // CI carregada não muda o resultado.
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('o prazo vale por página: páginas que somadas passam dele, mas cabem uma a uma, terminam', async () => {
      let page = 0;
      const readRecords = jest.fn((): Promise<ReadPage> => {
        page += 1;
        const pageToken = page < 4 ? `p${page + 1}` : undefined;
        return demora(40, { records: [{ metadata: { id: `r${page}` } }], pageToken });
      });
      const source = createHealthConnectSource(libFalsa({ readRecords }), { timeoutMs: 100 });

      const leitura = source.readRecords('HeartRate', 0);
      // Quatro páginas de 40 ms: 160 ms no total, acima dos 100 ms do prazo.
      await jest.advanceTimersByTimeAsync(160);

      expect(await leitura).toHaveLength(4);
      expect(readRecords).toHaveBeenCalledTimes(4);
    });

    it('initialize que estoura o prazo não fica guardado: a chamada seguinte inicializa', async () => {
      const initialize = jest
        .fn<Promise<boolean>, []>()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValueOnce(true);
      const source = createHealthConnectSource(libFalsa({ initialize }), { timeoutMs: 20 });

      const primeira = source.availability();
      await jest.advanceTimersByTimeAsync(20);
      expect(await primeira).toBe('unavailable');

      expect(await source.availability()).toBe('available');
      expect(initialize).toHaveBeenCalledTimes(2);
    });
  });

  it('página que não responde no prazo faz a leitura rejeitar', async () => {
    const readRecords = jest.fn((): Promise<ReadPage> => new Promise(() => undefined));
    const source = createHealthConnectSource(libFalsa({ readRecords }), { timeoutMs: 20 });

    await expect(source.readRecords('HeartRate', 0)).rejects.toThrow('sem resposta em 20 ms');
  });

  it('mudanças, permissões e inicialização também têm prazo', async () => {
    const nunca = () => new Promise<never>(() => undefined);
    const opts = { timeoutMs: 20 };

    await expect(
      createHealthConnectSource(libFalsa({ getChanges: jest.fn(nunca) }), opts).getChanges(
        ['HeartRate'],
        't',
      ),
    ).rejects.toThrow('sem resposta');
    await expect(
      createHealthConnectSource(libFalsa({ getGrantedPermissions: jest.fn(nunca) }), opts)
        .grantedPermissions(),
    ).rejects.toThrow('sem resposta');
    // Na disponibilidade, o prazo estourado é só mais um "indisponível".
    expect(
      await createHealthConnectSource(libFalsa({ initialize: jest.fn(nunca) }), opts).availability(),
    ).toBe('unavailable');
    expect(
      await createHealthConnectSource(libFalsa({ getSdkStatus: jest.fn(nunca) }), opts).availability(),
    ).toBe('unavailable');
  });

  it('o pedido de permissão não tem prazo: quem responde é a pessoa', async () => {
    const requestPermission = jest.fn(() => demora(40, [{ accessType: 'read', recordType: 'HeartRate' }]));
    const source = createHealthConnectSource(libFalsa({ requestPermission }), { timeoutMs: 10 });

    expect(await source.requestPermissions()).toEqual(['HeartRate']);
  });
});

describe('createHealthConnectSource: mudanças', () => {
  it('o token novo sai de getChanges sem token, com os tipos pedidos', async () => {
    const lib = libFalsa();
    const token = await createHealthConnectSource(lib).changesToken(['HeartRate', 'Steps']);
    expect(token).toBe('token-1');
    expect(lib.getChanges).toHaveBeenCalledWith({ recordTypes: ['HeartRate', 'Steps'] });
  });

  it('token que não é texto é falha, e não um token vazio guardado', async () => {
    const lib = libFalsa({
      getChanges: jest.fn(async () => ({
        ...SEM_MUDANCAS,
        nextChangesToken: undefined as unknown as string,
      })),
    });
    await expect(createHealthConnectSource(lib).changesToken(['HeartRate'])).rejects.toThrow(
      'sem token de mudanças',
    );
  });

  it('uma página: registros inseridos com o tipo que trazem, deleções de fora', async () => {
    const lib = libFalsa({
      getChanges: jest.fn(async () => ({
        upsertionChanges: [
          { record: { recordType: 'HeartRate', metadata: { id: 'a' } } },
          { record: null },
          null as unknown as { record: unknown },
        ],
        deletionChanges: [{ recordId: 'x' }],
        nextChangesToken: 'token-2',
        changesTokenExpired: false,
        hasMore: true,
      })),
    });
    const source = createHealthConnectSource(lib);

    expect(await source.getChanges(['HeartRate'], 'token-1')).toEqual({
      records: [{ recordType: 'HeartRate', metadata: { id: 'a' } }],
      nextToken: 'token-2',
      hasMore: true,
      expired: false,
    });
    expect(lib.getChanges).toHaveBeenCalledWith({
      changesToken: 'token-1',
      recordTypes: ['HeartRate'],
    });
  });

  it('token expirado chega como expirado, e lista ausente como vazia', async () => {
    const lib = libFalsa({
      getChanges: jest.fn(async () => ({
        upsertionChanges: undefined as unknown as [],
        nextChangesToken: '',
        changesTokenExpired: true,
        hasMore: false,
      })),
    });

    expect(await createHealthConnectSource(lib).getChanges(['HeartRate'], 'velho')).toEqual({
      records: [],
      nextToken: '',
      hasMore: false,
      expired: true,
    });
  });
});

describe('createHealthConnectSource: ajustes', () => {
  it('abre a tela do Health Connect', () => {
    const lib = libFalsa();
    createHealthConnectSource(lib).openSettings();
    expect(lib.openHealthConnectSettings).toHaveBeenCalledTimes(1);
  });
});

describe('healthConnectSource', () => {
  it('a instância real é montada sobre a biblioteca, com toda a porta', () => {
    expect(typeof healthConnectSource.availability).toBe('function');
    expect(typeof healthConnectSource.readRecords).toBe('function');
  });

  it('importar o módulo não chama nenhuma função da biblioteca', () => {
    const fake = libFalsa();
    jest.isolateModules(() => {
      jest.doMock('react-native-health-connect', () => fake);
      require('./healthConnectSource');
    });
    for (const fn of Object.values(fake)) expect(fn).not.toHaveBeenCalled();
    jest.dontMock('react-native-health-connect');
  });
});
