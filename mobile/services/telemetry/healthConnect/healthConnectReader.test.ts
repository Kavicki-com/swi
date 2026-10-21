import { createHash } from 'crypto';
import {
  BAND_LABELS,
  HEALTH_CONNECT_STATE_FILE_NAME,
  HEALTH_CONNECT_SYNC_INTERVAL_MS,
  bandLabelOf,
  createFileHealthConnectStateStorage,
  createHealthConnectReader,
  detectBandPackage,
  type HealthConnectReaderDeps,
} from './healthConnectReader';
import {
  HEALTH_CONNECT_EVENT_NAMESPACE,
  HEALTH_CONNECT_RECORD_TYPES,
  HEALTH_CONNECT_WINDOW_MS,
  type HealthConnectRecord,
  type HealthConnectRecordType,
} from './healthConnectMapping';
import {
  HEALTH_CONNECT_MAX_PAGES,
  type HealthConnectChangesPage,
  type HealthConnectSource,
} from './healthConnectSource';
import { createTelemetryOutbox } from '../telemetryOutbox';

// Disco de mentira para o armazenamento real do estado: uri → texto.
const mockDisk = new Map<string, string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
        .join('/');
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    create() {
      mockDisk.set(this.uri, '');
    }
    write(text: string) {
      mockDisk.set(this.uri, text);
    }
    async text() {
      return mockDisk.get(this.uri) ?? '';
    }
  }
  return { File, Paths: { document: 'file:///doc' } };
});

// O relógio do teste: 20/10/2026 ao meio-dia UTC. Os instantes dos registros
// são escritos em segundos relativos a ele, negativos para o passado.
const AGORA = Date.parse('2026-10-20T12:00:00.000Z');
const em = (segundos: number) => new Date(AGORA + segundos * 1000).toISOString();

const SAL = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const OUTRO_SAL = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const PULSEIRA = 'com.huami.watch.hmwatchmanager';
const CELULAR = 'com.google.android.apps.fitness';
const TODAS = [...HEALTH_CONNECT_RECORD_TYPES, 'BackgroundAccessPermission'];
const QUINZE_MIN = HEALTH_CONNECT_SYNC_INTERVAL_MS;

// Dublê do uuid v5: determinístico como o real (SHA-1 do nome, versão 5,
// variante 8), igual ao do teste do mapeamento.
const uuidV5 = (name: string, _namespace: string) => {
  const hex = createHash('sha1').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const registro = (shape: Record<string, unknown>) => shape as unknown as HealthConnectRecord;

const batimento = (id: string, segundos: number, bpm = 70, origem = PULSEIRA) =>
  registro({
    recordType: 'HeartRate',
    metadata: { id, dataOrigin: origem },
    startTime: em(segundos),
    endTime: em(segundos),
    samples: [{ time: em(segundos), beatsPerMinute: bpm }],
  });

const passos = (id: string, segundos: number, count: number, origem = PULSEIRA) =>
  registro({
    recordType: 'Steps',
    metadata: { id, dataOrigin: origem },
    startTime: em(segundos - 60),
    endTime: em(segundos),
    count,
  });

type Registros = Partial<Record<HealthConnectRecordType, HealthConnectRecord[]>>;

const pagina = (over: Partial<HealthConnectChangesPage> = {}): HealthConnectChangesPage => ({
  records: [],
  nextToken: 'token-2',
  hasMore: false,
  expired: false,
  ...over,
});

/** Porta falsa; `log` guarda a ordem das chamadas que importam. */
function portaFalsa(registros: Registros = {}) {
  const log: string[] = [];
  const source = {
    availability: jest.fn(
      async (): Promise<'available' | 'unavailable' | 'update_required'> => 'available',
    ),
    grantedPermissions: jest.fn(async (): Promise<string[]> => [...TODAS]),
    requestPermissions: jest.fn(async (): Promise<string[]> => [...TODAS]),
    readRecords: jest.fn(async (type: HealthConnectRecordType, _since: number) => {
      log.push(`read:${type}`);
      return registros[type] ?? [];
    }),
    changesToken: jest.fn(async (_types: readonly HealthConnectRecordType[]) => {
      log.push('token');
      return 'token-1';
    }),
    getChanges: jest.fn(async (_types: readonly HealthConnectRecordType[], token: string) => {
      log.push(`changes:${token}`);
      return pagina();
    }),
    openSettings: jest.fn(),
  } satisfies HealthConnectSource;
  return { source, log };
}

function memoria(inicial: string | null = null) {
  const store = {
    text: inicial,
    writes: 0,
    read: async (): Promise<string | null> => store.text,
    write: async (text: string) => {
      store.writes += 1;
      store.text = text;
    },
  };
  return store;
}

const lerEstado = (store: { text: string | null }) => JSON.parse(store.text ?? 'null');

function montar(registros: Registros = {}, over: Partial<HealthConnectReaderDeps> = {}) {
  const { source, log } = portaFalsa(registros);
  const outbox = createTelemetryOutbox(memoria());
  const storage = memoria();
  let agora = AGORA;
  const uuidV4 = jest.fn(() => SAL);
  const reader = createHealthConnectReader({
    outbox,
    source,
    storage,
    now: () => agora,
    uuidV4,
    uuidV5,
    ...over,
  });
  return {
    reader,
    source,
    log,
    outbox,
    storage,
    uuidV4,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('primeira rodada', () => {
  it('pega o token de mudanças ANTES de ler, e lê as 48 h dos sete tipos', async () => {
    const { reader, source, log } = montar();

    await reader.run();

    expect(log[0]).toBe('token');
    expect(log.slice(1)).toEqual(HEALTH_CONNECT_RECORD_TYPES.map((type) => `read:${type}`));
    for (const call of source.readRecords.mock.calls) {
      expect(call[1]).toBe(AGORA - HEALTH_CONNECT_WINDOW_MS);
    }
    expect(source.getChanges).not.toHaveBeenCalled();
  });

  it('detecta a pulseira, enfileira o que é dela, e só depois grava o estado', async () => {
    const { reader, outbox, storage } = montar({
      HeartRate: [
        batimento('h1', -600),
        batimento('h2', -300),
        batimento('h3', -100, 70, CELULAR),
      ],
      Steps: [passos('s1', -200, 50), passos('s2', -200, 999, CELULAR)],
    });

    const added = await reader.run();

    const pending = await outbox.pending();
    expect(added).toBe(4);
    expect(pending).toHaveLength(4);
    const steps = pending.flatMap((e) => (e.measurements.stepDelta ? [e.measurements.stepDelta.value] : []));
    expect(steps).toEqual([50]);
    expect(lerEstado(storage)).toEqual({
      sessionSalt: SAL,
      changesToken: 'token-1',
      tokenTypes: [...HEALTH_CONNECT_RECORD_TYPES],
      firstSyncDone: true,
      bandPackage: PULSEIRA,
      noBand: false,
      lastSyncAt: em(0),
    });
  });

  it('sessão e sequência saem do sal guardado e do registro, sem o contador da fila', async () => {
    const { reader, outbox, uuidV4 } = montar({ HeartRate: [batimento('h1', -600)] });
    const nextSequence = jest.spyOn(outbox, 'nextSequence');

    await reader.run();
    await reader.run({ force: true });

    const [evento] = await outbox.pending();
    expect(evento.monitoringSessionId).toBe(
      uuidV5(`${SAL}:2026-10-20`, HEALTH_CONNECT_EVENT_NAMESPACE),
    );
    expect(evento.eventId).toBe(uuidV5(`HeartRate:h1:${em(-600)}`, HEALTH_CONNECT_EVENT_NAMESPACE));
    expect(nextSequence).not.toHaveBeenCalled();
    // Um sal por instalação: gerado uma vez e lido do estado depois.
    expect(uuidV4).toHaveBeenCalledTimes(1);
  });

  it('com estado gravado, o sal é o de lá e não se gera outro', async () => {
    const storage = memoria(JSON.stringify({ sessionSalt: OUTRO_SAL, firstSyncDone: false }));
    const { reader, outbox, uuidV4 } = montar({ HeartRate: [batimento('h1', -600)] }, { storage });

    await reader.run();

    expect(uuidV4).not.toHaveBeenCalled();
    const [evento] = await outbox.pending();
    expect(evento.monitoringSessionId).toBe(
      uuidV5(`${OUTRO_SAL}:2026-10-20`, HEALTH_CONNECT_EVENT_NAMESPACE),
    );
    expect(lerEstado(storage).sessionSalt).toBe(OUTRO_SAL);
  });

  it('arquivo ilegível ou sem sal vira estado inicial, com sal novo gravado', async () => {
    for (const texto of ['{lixo', JSON.stringify([1]), JSON.stringify({ sessionSalt: 7 })]) {
      const storage = memoria(texto);
      const { reader, uuidV4 } = montar({}, { storage });
      await reader.run();
      expect(uuidV4).toHaveBeenCalledTimes(1);
      expect(lerEstado(storage)).toMatchObject({ sessionSalt: SAL, firstSyncDone: true });
    }
  });

  it('disco que lança na leitura NÃO é arquivo ausente: a rodada aborta sem sal novo nem escrita', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = memoria(JSON.stringify({ sessionSalt: OUTRO_SAL, firstSyncDone: false }));
    storage.read = async () => {
      throw new Error('disco travado');
    };
    const { reader, outbox, uuidV4, log } = montar({ HeartRate: [batimento('h1', -600)] }, { storage });

    expect(await reader.run()).toBe(0);

    expect(uuidV4).not.toHaveBeenCalled();
    expect(storage.writes).toBe(0);
    expect(log).toEqual([]);
    expect(await outbox.pending()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disco travado'));
    // A tela continua recebendo um estado, só sem o que está no arquivo.
    expect(await reader.state()).toMatchObject({ bandPackage: null, lastSyncAt: null });
  });

  it('falha ao enfileirar a leitura das 48 h não marca nada: a próxima rodada recomeça pelo token', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    jest.spyOn(m.outbox, 'appendMany').mockRejectedValueOnce(new Error('disco cheio'));

    expect(await m.reader.run()).toBe(0);

    expect(lerEstado(m.storage)).toMatchObject({ firstSyncDone: false, changesToken: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disco cheio'));

    m.log.length = 0;
    expect(await m.reader.run({ force: true })).toBe(1);
    expect(m.log[0]).toBe('token');
    expect(m.log.slice(1)).toEqual(HEALTH_CONNECT_RECORD_TYPES.map((type) => `read:${type}`));
  });
});

describe('rodadas seguintes', () => {
  async function depoisDaPrimeira() {
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    await m.reader.run();
    m.log.length = 0;
    m.source.readRecords.mockClear();
    m.source.changesToken.mockClear();
    m.avancar(QUINZE_MIN);
    return m;
  }

  it('lê só as mudanças, página a página até acabar, e guarda o último token', async () => {
    const m = await depoisDaPrimeira();
    m.source.getChanges
      .mockImplementationOnce(async (_t, token) => {
        m.log.push(`changes:${token}`);
        return pagina({ records: [batimento('h2', -60)], nextToken: 'token-2', hasMore: true });
      })
      .mockImplementationOnce(async (_t, token) => {
        m.log.push(`changes:${token}`);
        return pagina({ records: [batimento('h3', -30)], nextToken: 'token-3' });
      });

    expect(await m.reader.run()).toBe(2);

    expect(m.log).toEqual(['changes:token-1', 'changes:token-2']);
    expect(m.source.readRecords).not.toHaveBeenCalled();
    expect(await m.outbox.pending()).toHaveLength(3);
    expect(lerEstado(m.storage)).toMatchObject({
      changesToken: 'token-3',
      lastSyncAt: em(QUINZE_MIN / 1000),
    });
  });

  it('passos de fora da pulseira continuam de fora nas mudanças', async () => {
    const m = await depoisDaPrimeira();
    m.source.getChanges.mockResolvedValueOnce(
      pagina({ records: [passos('s1', -10, 20), passos('s2', -10, 500, CELULAR)] }),
    );
    expect(await m.reader.run()).toBe(1);
  });

  it('falha ao enfileirar não avança o token: a página volta na próxima rodada', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = await depoisDaPrimeira();
    m.source.getChanges
      .mockResolvedValueOnce(
        pagina({ records: [batimento('h2', -60)], nextToken: 'token-2', hasMore: true }),
      )
      .mockResolvedValueOnce(pagina({ records: [batimento('h3', -30)], nextToken: 'token-3' }));
    const real = m.outbox.appendMany.bind(m.outbox);
    let chamada = 0;
    jest.spyOn(m.outbox, 'appendMany').mockImplementation(async (events) => {
      chamada += 1;
      if (chamada === 2) throw new Error('disco cheio');
      return real(events);
    });

    expect(await m.reader.run()).toBe(0);

    // A primeira página entrou e o token dela foi gravado; a segunda, não.
    expect(lerEstado(m.storage).changesToken).toBe('token-2');
    expect(lerEstado(m.storage).lastSyncAt).toBe(em(0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disco cheio'));
  });

  it('token expirado volta à leitura das 48 h, com token novo pego antes', async () => {
    const m = await depoisDaPrimeira();
    m.source.getChanges.mockImplementationOnce(async (_t, token) => {
      m.log.push(`changes:${token}`);
      return pagina({ expired: true, nextToken: '' });
    });
    m.source.changesToken.mockImplementationOnce(async () => {
      m.log.push('token');
      return 'token-novo';
    });

    await m.reader.run();

    expect(m.log[0]).toBe('changes:token-1');
    expect(m.log[1]).toBe('token');
    expect(m.log.slice(2)).toEqual(HEALTH_CONNECT_RECORD_TYPES.map((type) => `read:${type}`));
    expect(lerEstado(m.storage)).toMatchObject({
      changesToken: 'token-novo',
      bandPackage: PULSEIRA,
    });
  });

  it('token expirado depois de páginas já gravadas: elas ficam, e a rodada cai nas 48 h', async () => {
    const m = await depoisDaPrimeira();
    m.source.getChanges
      .mockImplementationOnce(async (_t, token) => {
        m.log.push(`changes:${token}`);
        return pagina({ records: [batimento('h2', -60)], nextToken: 'token-2', hasMore: true });
      })
      .mockImplementationOnce(async (_t, token) => {
        m.log.push(`changes:${token}`);
        return pagina({ expired: true, nextToken: '' });
      });
    m.source.changesToken.mockImplementationOnce(async () => {
      m.log.push('token');
      return 'token-novo';
    });
    const gravados: (string | null)[] = [];
    const write = m.storage.write;
    m.storage.write = async (text) => {
      gravados.push(JSON.parse(text).changesToken);
      await write(text);
    };

    expect(await m.reader.run()).toBe(1);

    expect(m.log.slice(0, 3)).toEqual(['changes:token-1', 'changes:token-2', 'token']);
    expect(gravados).toEqual(['token-2', 'token-novo']);
    const ids = (await m.outbox.pending()).map((e) => e.eventId);
    expect(ids).toContain(uuidV5(`HeartRate:h2:${em(-60)}`, HEALTH_CONNECT_EVENT_NAMESPACE));
    expect(lerEstado(m.storage)).toMatchObject({ changesToken: 'token-novo', bandPackage: PULSEIRA });
  });

  it('página sem token seguinte não grava token vazio: a próxima rodada relê as 48 h', async () => {
    const m = await depoisDaPrimeira();
    m.source.getChanges.mockResolvedValueOnce(pagina({ records: [batimento('h2', -60)], nextToken: '' }));

    expect(await m.reader.run()).toBe(1);
    expect(lerEstado(m.storage).changesToken).toBeNull();

    m.log.length = 0;
    await m.reader.run({ force: true });
    expect(m.log[0]).toBe('token');
  });

  it('mudanças sem fim param no limite de páginas, com o token da última guardado', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = await depoisDaPrimeira();
    let n = 0;
    m.source.getChanges.mockImplementation(async () => {
      n += 1;
      return pagina({ nextToken: `token-p${n}`, hasMore: true });
    });

    expect(await m.reader.run()).toBe(0);

    expect(m.source.getChanges).toHaveBeenCalledTimes(HEALTH_CONNECT_MAX_PAGES);
    expect(lerEstado(m.storage)).toMatchObject({
      changesToken: `token-p${HEALTH_CONNECT_MAX_PAGES}`,
      // A rodada não terminou: o horário da última sincronização fica o anterior.
      lastSyncAt: em(0),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('limite de'));
  });

  it('permissão nova muda os tipos: relê as 48 h com um token que os cobre', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    m.source.grantedPermissions.mockResolvedValueOnce(['HeartRate']);
    await m.reader.run();
    expect(m.source.changesToken).toHaveBeenLastCalledWith(['HeartRate']);
    m.log.length = 0;

    await m.reader.run({ force: true });

    expect(m.source.getChanges).not.toHaveBeenCalled();
    expect(m.log[0]).toBe('token');
    expect(m.source.changesToken).toHaveBeenLastCalledWith([...HEALTH_CONNECT_RECORD_TYPES]);
  });

  it('só lê os tipos com permissão de leitura, na ordem do contrato', async () => {
    const m = montar();
    m.source.grantedPermissions.mockResolvedValueOnce([
      'Steps',
      'HeartRate',
      'BackgroundAccessPermission',
    ]);
    await m.reader.run();
    expect(m.log).toEqual(['token', 'read:HeartRate', 'read:Steps']);
  });
});

describe('sem pulseira', () => {
  it('sem batimento nas 48 h: sem pacote, noBand, e passos de fora', async () => {
    const { reader, outbox, storage } = montar({ Steps: [passos('s1', -200, 50)] });

    expect(await reader.run()).toBe(0);

    expect(await outbox.pending()).toHaveLength(0);
    expect(lerEstado(storage)).toMatchObject({
      bandPackage: null,
      noBand: true,
      firstSyncDone: true,
    });
    expect(await reader.state()).toMatchObject({ bandPackage: null, bandLabel: null, noBand: true });
  });

  it('cada rodada sem pulseira é leitura completa, e os passos das 48 h entram quando ela aparece', async () => {
    const registros: Registros = { Steps: [passos('s1', -200, 50)] };
    const m = montar(registros);
    await m.reader.run();
    m.log.length = 0;

    registros.HeartRate = [batimento('h1', -100)];
    m.avancar(QUINZE_MIN);
    const added = await m.reader.run();

    expect(m.source.getChanges).not.toHaveBeenCalled();
    expect(m.log[0]).toBe('token');
    expect(added).toBe(2);
    const pending = await m.outbox.pending();
    expect(pending.some((e) => e.measurements.stepDelta?.value === 50)).toBe(true);
    expect(lerEstado(m.storage)).toMatchObject({ bandPackage: PULSEIRA, noBand: false });
  });
});

describe('disponibilidade e permissão', () => {
  it('sem permissão de batimento não lê nada', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    m.source.grantedPermissions.mockResolvedValueOnce(['Steps']);

    expect(await m.reader.run()).toBe(0);

    expect(m.log).toEqual([]);
    expect(await m.reader.state()).toMatchObject({
      availability: 'available',
      permission: 'denied',
    });
  });

  it('com a permissão, granted', async () => {
    const m = montar();
    await m.reader.run();
    expect(await m.reader.state()).toMatchObject({
      availability: 'available',
      permission: 'granted',
    });
  });

  it.each(['unavailable', 'update_required'] as const)(
    'Health Connect %s não lê nada',
    async (status) => {
      const m = montar();
      m.source.availability.mockResolvedValueOnce(status);

      expect(await m.reader.run()).toBe(0);

      expect(m.source.grantedPermissions).not.toHaveBeenCalled();
      expect(m.log).toEqual([]);
      expect(await m.reader.state()).toMatchObject({ availability: status, permission: null });
    },
  );

  it('pedir permissão repassa à porta, atualiza a memória e libera a próxima rodada', async () => {
    const m = montar();
    m.source.grantedPermissions.mockResolvedValueOnce([]);
    await m.reader.run();
    expect((await m.reader.state()).permission).toBe('denied');

    expect(await m.reader.requestPermissions()).toBe('granted');
    expect((await m.reader.state()).permission).toBe('granted');
    // Sem esperar os 15 min: a concessão é o momento de ler.
    await m.reader.run();
    expect(m.source.readRecords).toHaveBeenCalled();
  });

  it('pedido negado fica denied e não libera o intervalo', async () => {
    const m = montar();
    await m.reader.run();
    m.source.availability.mockClear();
    m.source.requestPermissions.mockResolvedValueOnce(['Steps']);

    expect(await m.reader.requestPermissions()).toBe('denied');

    expect(await m.reader.run()).toBe(0);
    expect(m.source.availability).not.toHaveBeenCalled();
  });

  it('a rodada não desfaz a permissão de um pedido que terminou depois de ela começar', async () => {
    const m = montar();
    let responder: (granted: string[]) => void = () => undefined;
    m.source.grantedPermissions.mockImplementationOnce(
      () => new Promise<string[]>((resolve) => (responder = resolve)),
    );

    const rodada = m.reader.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await m.reader.requestPermissions()).toBe('granted');
    // A consulta da rodada, feita antes da concessão, volta sem batimento.
    responder(['Steps']);
    await rodada;

    expect((await m.reader.state()).permission).toBe('granted');
  });

  it('abre os ajustes pela porta', () => {
    const m = montar();
    m.reader.openSettings();
    expect(m.source.openSettings).toHaveBeenCalledTimes(1);
  });
});

describe('run: ritmo, falhas e concorrência', () => {
  it('no máximo uma rodada a cada 15 min, contados do início da tentativa', async () => {
    const m = montar();
    await m.reader.run();
    m.source.availability.mockClear();

    m.avancar(QUINZE_MIN - 1);
    expect(await m.reader.run()).toBe(0);
    expect(m.source.availability).not.toHaveBeenCalled();

    m.avancar(1);
    await m.reader.run();
    expect(m.source.availability).toHaveBeenCalledTimes(1);
  });

  it('force ignora o intervalo', async () => {
    const m = montar();
    await m.reader.run();
    await m.reader.run({ force: true });
    expect(m.source.availability).toHaveBeenCalledTimes(2);
  });

  it('nunca rejeita: porta que lança vira 0 e aviso, e nada é gravado', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = montar();
    m.source.changesToken.mockRejectedValueOnce(new Error('SecurityException'));

    expect(await m.reader.run()).toBe(0);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SecurityException'));
    expect(lerEstado(m.storage)).toMatchObject({ firstSyncDone: false, changesToken: null });
    // A tentativa que falhou também conta para o intervalo.
    m.source.availability.mockClear();
    expect(await m.reader.run()).toBe(0);
    expect(m.source.availability).not.toHaveBeenCalled();
  });

  it('duas chamadas ao mesmo tempo dividem a mesma rodada', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)] });

    const [a, b] = await Promise.all([m.reader.run(), m.reader.run({ force: true })]);

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(m.source.changesToken).toHaveBeenCalledTimes(1);
    expect(await m.outbox.pending()).toHaveLength(1);
  });

  it('o que já está pendente na fila não entra de novo', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)], Steps: [passos('s1', -200, 50)] });
    await m.reader.run();
    await m.reader.redetect();
    const append = jest.spyOn(m.outbox, 'appendMany');

    expect(await m.reader.run()).toBe(0);

    expect(append).not.toHaveBeenCalled();
    expect(await m.outbox.pending()).toHaveLength(2);
  });
});

describe('redetect', () => {
  it('zera a pulseira gravada e a próxima rodada, sem force, relê as 48 h e detecta de novo', async () => {
    const registros: Registros = { HeartRate: [batimento('h1', -600)] };
    const m = montar(registros);
    await m.reader.run();
    m.log.length = 0;

    await m.reader.redetect();
    expect(lerEstado(m.storage)).toMatchObject({ bandPackage: null, noBand: false });
    expect((await m.reader.state()).bandPackage).toBeNull();

    registros.HeartRate = [batimento('h9', -60, 70, 'com.xiaomi.wearable')];
    await m.reader.run();

    expect(m.source.getChanges).not.toHaveBeenCalled();
    expect(m.log[0]).toBe('token');
    expect(await m.reader.state()).toMatchObject({
      bandPackage: 'com.xiaomi.wearable',
      bandLabel: 'Mi Fitness',
    });
  });

  it('rejeita quando o estado não pode ser gravado', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    await m.reader.run();
    m.storage.write = async () => {
      throw new Error('somente leitura');
    };

    await expect(m.reader.redetect()).rejects.toThrow('somente leitura');
  });

  it('com uma rodada em curso, espera ela terminar para não ser desfeito por ela', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    const rodada = m.reader.run();
    await m.reader.redetect();
    await rodada;
    expect(lerEstado(m.storage).bandPackage).toBeNull();
  });
});

describe('state', () => {
  it('antes da primeira rodada: tudo nulo, sem gravar nada', async () => {
    const m = montar();
    expect(await m.reader.state()).toEqual({
      availability: null,
      permission: null,
      bandPackage: null,
      bandLabel: null,
      noBand: false,
      lastSyncAt: null,
    });
    expect(m.storage.writes).toBe(0);
  });

  it('depois de uma rodada: pacote, nome legível e horário', async () => {
    const m = montar({ HeartRate: [batimento('h1', -600)] });
    await m.reader.run();
    expect(await m.reader.state()).toEqual({
      availability: 'available',
      permission: 'granted',
      bandPackage: PULSEIRA,
      bandLabel: 'Zepp',
      noBand: false,
      lastSyncAt: em(0),
    });
  });

  it('campos de forma errada no arquivo viram o valor inicial, sem perder o sal', async () => {
    const storage = memoria(
      JSON.stringify({
        sessionSalt: SAL,
        changesToken: 5,
        tokenTypes: 'x',
        firstSyncDone: 'sim',
        bandPackage: 3,
        noBand: 'não',
        lastSyncAt: 1,
      }),
    );
    const m = montar({}, { storage });
    expect(await m.reader.state()).toMatchObject({
      bandPackage: null,
      noBand: false,
      lastSyncAt: null,
    });
    await m.reader.run();
    expect(m.uuidV4).not.toHaveBeenCalled();
    expect(m.log[0]).toBe('token');
  });
});

describe('detectBandPackage', () => {
  it('o pacote mais frequente nos registros de batimento', () => {
    expect(
      detectBandPackage([
        batimento('a', -1, 70, CELULAR),
        batimento('b', -2),
        batimento('c', -3),
        passos('d', -4, 1, CELULAR),
        passos('e', -5, 1, CELULAR),
      ]),
    ).toBe(PULSEIRA);
  });

  it('empate fica com o menor nome em ordem de código, para dar sempre o mesmo', () => {
    expect(
      detectBandPackage([batimento('a', -1, 70, 'com.z'), batimento('b', -2, 70, 'com.a')]),
    ).toBe('com.a');
    expect(
      detectBandPackage([batimento('b', -2, 70, 'com.a'), batimento('a', -1, 70, 'com.z')]),
    ).toBe('com.a');
  });

  it('sem batimento, ou sem origem legível, nenhum', () => {
    expect(detectBandPackage([])).toBeNull();
    expect(
      detectBandPackage([
        registro({ recordType: 'HeartRate', metadata: { id: 'x', dataOrigin: '' } }),
        registro({ recordType: 'HeartRate' }),
        null as unknown as HealthConnectRecord,
      ]),
    ).toBeNull();
  });
});

describe('bandLabelOf', () => {
  it('os pacotes conhecidos têm nome legível', () => {
    expect(BAND_LABELS).toEqual({
      'com.huami.watch.hmwatchmanager': 'Zepp',
      'com.xiaomi.hm.health': 'Zepp Life',
      'com.xiaomi.wearable': 'Mi Fitness',
      'com.sec.android.app.shealth': 'Samsung Health',
      'com.fitbit.FitbitMobile': 'Fitbit',
      'com.garmin.android.apps.connectmobile': 'Garmin Connect',
      'com.huawei.health': 'Huawei Health',
    });
    expect(bandLabelOf('com.fitbit.FitbitMobile')).toBe('Fitbit');
  });

  it('pacote desconhecido é o próprio pacote; sem pacote, nulo', () => {
    expect(bandLabelOf('com.exemplo.pulseira')).toBe('com.exemplo.pulseira');
    expect(bandLabelOf(null)).toBeNull();
    // Chave herdada de todo objeto não é pulseira conhecida.
    expect(bandLabelOf('toString')).toBe('toString');
  });
});

describe('createFileHealthConnectStateStorage', () => {
  it('sem arquivo lê nulo; grava criando o arquivo e relê o texto', async () => {
    mockDisk.clear();
    const storage = createFileHealthConnectStateStorage();

    expect(await storage.read()).toBeNull();
    await storage.write('{"a":1}');
    await storage.write('{"a":2}');

    expect(await storage.read()).toBe('{"a":2}');
    expect([...mockDisk.keys()]).toEqual([`file:///doc/${HEALTH_CONNECT_STATE_FILE_NAME}`]);
  });
});

describe('dependências padrão', () => {
  it('sem uuid nem relógio injetados, usa os do expo e o Date.now', async () => {
    const { source } = portaFalsa({ HeartRate: [batimento('h1', -60)] });
    const outbox = createTelemetryOutbox(memoria());
    const storage = memoria();
    jest.spyOn(Date, 'now').mockReturnValue(AGORA);
    const reader = createHealthConnectReader({ outbox, source, storage });

    expect(await reader.run()).toBe(1);

    expect(lerEstado(storage).sessionSalt).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
