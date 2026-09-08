import {
  createTelemetryOutbox,
  type OutboxEvent,
  type OutboxStorage,
} from './telemetryOutbox';

// Dublê do arquivo: um texto em memória, com os mesmos dois verbos do real.
// Injetado, não mockado por módulo: a fila só vê `read` e `write`, e o teste
// de reinício é criar outra fábrica sobre o MESMO dublê.
function memoryStorage(initial: string | null = null) {
  let text = initial;
  const read = jest.fn(async () => text);
  const write = jest.fn(async (next: string) => {
    text = next;
  });
  const storage: OutboxStorage = { read, write };
  return { storage, read, write, current: () => text };
}

const SESSAO_A = '11111111-1111-4111-8111-111111111111';
const SESSAO_B = '22222222-2222-4222-8222-222222222222';

// A fila só aceita UUID, e o teste quer falar em 'e1'. O rótulo vira os
// últimos bytes de um UUID v4 fixo, e volta pelo caminho inverso.
const uid = (label: string) =>
  `00000000-0000-4000-8000-${Buffer.from(label, 'ascii').toString('hex').padStart(12, '0')}`;
const label = (id: string) => Buffer.from(id.slice(-12).replace(/^(00)+/, ''), 'hex').toString('ascii');
const VAZIO = { events: [], sequences: {}, forgotten: [] };

function evento(id: string, sessionId = SESSAO_A, sequence = 0): OutboxEvent {
  return {
    eventId: uid(id),
    monitoringSessionId: sessionId,
    sequence,
    eventTime: '2026-09-07T12:00:00.000Z',
    origin: 'REAL',
    measurements: { heartRate: { value: 72, unit: 'bpm', source: 'APPLE_WATCH' } },
  };
}

const labels = (events: readonly OutboxEvent[]) => events.map((e) => label(e.eventId));

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('telemetryOutbox, estado inicial', () => {
  it('sem arquivo, o estado é vazio', async () => {
    const { storage } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await expect(outbox.load()).resolves.toEqual(VAZIO);
    await expect(outbox.pending()).resolves.toEqual([]);
  });

  it('arquivo vazio é estado vazio', async () => {
    const outbox = createTelemetryOutbox(memoryStorage('').storage);
    await expect(outbox.load()).resolves.toEqual(VAZIO);
  });

  it.each<[string, string]>([
    ['JSON ilegível', '{nem json'],
    ['array no lugar do objeto', '[]'],
    ['events que não é array', JSON.stringify({ events: {}, sequences: {} })],
    ['sequences que não é objeto', JSON.stringify({ events: [], sequences: 3 })],
    ['sequences que é array', JSON.stringify({ events: [], sequences: [] })],
    ['sequences nulo', JSON.stringify({ events: [], sequences: null })],
  ])('arquivo com %s lê como vazio, sem lançar', async (_nome, texto) => {
    const outbox = createTelemetryOutbox(memoryStorage(texto).storage);
    await expect(outbox.load()).resolves.toEqual(VAZIO);
  });

  // Arquivo gravado antes de `forgotten` existir: continua legível.
  it('arquivo sem forgotten lê com forgotten vazio', async () => {
    const texto = JSON.stringify({ events: [evento('e1')], sequences: { [SESSAO_A]: 0 } });
    const outbox = createTelemetryOutbox(memoryStorage(texto).storage);
    await expect(outbox.load()).resolves.toEqual({
      events: [evento('e1')],
      sequences: { [SESSAO_A]: 0 },
      forgotten: [],
    });
  });

  it('leitura que falha no aparelho é estado vazio, sem lançar', async () => {
    const { storage, read } = memoryStorage(null);
    read.mockRejectedValue(new Error('disco indisponível'));
    const outbox = createTelemetryOutbox(storage);
    await expect(outbox.load()).resolves.toEqual(VAZIO);
  });
});

describe('telemetryOutbox, append e remove', () => {
  it('append persiste o estado inteiro antes de resolver', async () => {
    const { storage, write } = memoryStorage(null);
    // O write só termina quando o teste soltar: enquanto isso, o append não
    // pode ter resolvido, senão quem chama acha que gravou e o app pode morrer
    // com a amostra só em memória.
    let solta!: () => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          solta = resolve;
        }),
    );
    const outbox = createTelemetryOutbox(storage);

    let resolvido = false;
    const pendente = outbox.append(evento('e1')).then(() => {
      resolvido = true;
    });
    // Alguns ciclos de microtarefa: o suficiente para ler o arquivo e chegar ao write.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(1);
    expect(resolvido).toBe(false);

    solta();
    await pendente;
    expect(resolvido).toBe(true);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ ...VAZIO, events: [evento('e1')] });
  });

  it('pending devolve os eventos na ordem em que entraram', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.append(evento('e1'));
    await outbox.append(evento('e2', SESSAO_B));
    await outbox.append(evento('e3'));
    expect(labels(await outbox.pending())).toEqual(['e1', 'e2', 'e3']);
  });

  it('remove tira só os ids citados e mantém a ordem dos demais', async () => {
    const { storage, current } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.append(evento('e1'));
    await outbox.append(evento('e2'));
    await outbox.append(evento('e3'));
    await outbox.remove([uid('e2'), uid('x')]);
    expect(labels(await outbox.pending())).toEqual(['e1', 'e3']);
    // E o que ficou no arquivo é o mesmo que a fila diz.
    expect(labels(JSON.parse(current() ?? '{}').events)).toEqual(['e1', 'e3']);
  });

  it('remove de id inexistente não escreve', async () => {
    const { storage, write } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.append(evento('e1'));
    write.mockClear();
    await outbox.remove([uid('x')]);
    await outbox.remove([]);
    expect(write).not.toHaveBeenCalled();
    expect(labels(await outbox.pending())).toEqual(['e1']);
  });

  it('duas append concorrentes ficam as duas no estado final', async () => {
    const { storage, current } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    // Sem await entre as duas: se cada uma lesse o arquivo antes de a outra
    // escrever, a segunda escrita apagaria a primeira.
    await Promise.all([outbox.append(evento('e1')), outbox.append(evento('e2'))]);
    expect(labels(await outbox.pending())).toEqual(['e1', 'e2']);
    expect(labels(JSON.parse(current() ?? '{}').events)).toEqual(['e1', 'e2']);
  });
});

describe('telemetryOutbox, append recusa evento fora do contrato', () => {
  // O único 4xx que um lote bem formado provoca é o 400 do validador por
  // evento fora do contrato, e um 400 descarta o lote inteiro. Melhor recusar
  // a amostra ruim na porta, com aviso, do que pagar com as boas.
  const valido = evento('e1');
  it.each<[string, Partial<Record<keyof OutboxEvent, unknown>>]>([
    ['eventId que não é UUID', { eventId: 'e1' }],
    ['monitoringSessionId que não é UUID', { monitoringSessionId: 'sessao' }],
    ['sequence negativa', { sequence: -1 }],
    ['sequence fracionária', { sequence: 1.5 }],
    ['eventTime que não é ISO-8601', { eventTime: 'ontem' }],
    ['eventTime ISO com data impossível', { eventTime: '2026-13-45T12:00:00.000Z' }],
    ['origin que não é REAL', { origin: 'DEMO' }],
    ['heartRate sem valor numérico', { measurements: { heartRate: { value: 'alto', unit: 'bpm', source: 'APPLE_WATCH' } } }],
    ['heartRate infinito', { measurements: { heartRate: { value: Infinity, unit: 'bpm', source: 'APPLE_WATCH' } } }],
    ['heartRate NaN', { measurements: { heartRate: { value: NaN, unit: 'bpm', source: 'APPLE_WATCH' } } }],
    ['unidade errada', { measurements: { heartRate: { value: 72, unit: 'Hz', source: 'APPLE_WATCH' } } }],
    ['fonte errada', { measurements: { heartRate: { value: 72, unit: 'bpm', source: 'GARMIN' } } }],
    ['sem measurements', { measurements: undefined }],
  ])('%s: não entra, não escreve, avisa e resolve', async (_nome, ruim) => {
    const { storage, write } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await expect(outbox.append({ ...valido, ...ruim } as OutboxEvent)).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(labels(await outbox.pending())).toEqual([]);
  });

  it('evento válido entra sem aviso', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.append(valido);
    expect(warn).not.toHaveBeenCalled();
    expect(labels(await outbox.pending())).toEqual(['e1']);
  });

  it('aceita UUID maiúsculo e fuso explícito no eventTime', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.append({
      ...valido,
      eventId: uid('e1').toUpperCase(),
      eventTime: '2026-09-07T09:00:00-03:00',
    });
    expect(warn).not.toHaveBeenCalled();
    expect(await outbox.pending()).toHaveLength(1);
  });
});

describe('telemetryOutbox, sequência por sessão', () => {
  it('a primeira da sessão é 0 e as seguintes crescem de um em um', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(0);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(1);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(2);
  });

  it('o contador sobrevive a uma fábrica nova sobre o mesmo arquivo', async () => {
    const { storage } = memoryStorage(null);
    const antes = createTelemetryOutbox(storage);
    await antes.nextSequence(SESSAO_A);
    await antes.nextSequence(SESSAO_A);
    // Reinício do app: outra instância, mesmo arquivo. Em memória o contador
    // voltaria a 0 e o backend veria a sequência 0 repetida na mesma sessão.
    const depois = createTelemetryOutbox(storage);
    expect(await depois.nextSequence(SESSAO_A)).toBe(2);
  });

  it('sessões diferentes contam independentes', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(0);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(1);
    expect(await outbox.nextSequence(SESSAO_B)).toBe(0);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(2);
    expect(await outbox.nextSequence(SESSAO_B)).toBe(1);
  });

  it('nextSequence persiste antes de devolver', async () => {
    const { storage, write } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.nextSequence(SESSAO_A);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ ...VAZIO, sequences: { [SESSAO_A]: 0 } });
  });

  it('contador corrompido no arquivo recomeça do 0 sem lançar', async () => {
    const texto = JSON.stringify({ events: [], sequences: { [SESSAO_A]: 'sete' } });
    const outbox = createTelemetryOutbox(memoryStorage(texto).storage);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(0);
  });
});

describe('telemetryOutbox, forgetSession', () => {
  it('sem evento pendente, apaga só o contador daquela sessão', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.nextSequence(SESSAO_A);
    await outbox.nextSequence(SESSAO_A);
    await outbox.nextSequence(SESSAO_B);

    await outbox.forgetSession(SESSAO_A);

    expect(await outbox.nextSequence(SESSAO_A)).toBe(0);
    expect(await outbox.nextSequence(SESSAO_B)).toBe(1);
  });

  it('de sessão desconhecida não escreve', async () => {
    const { storage, write } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.forgetSession(SESSAO_A);
    expect(write).not.toHaveBeenCalled();
  });

  // Se a mesma sessão voltar a gerar amostra (o relógio reconecta a sessão
  // espelhada com o mesmo id) enquanto os eventos dela ainda esperam envio,
  // um contador zerado repetiria uma sequência já gravada e o backend
  // recusaria a amostra nova. O contador só sai com o último evento dela.
  it('com evento pendente, mantém o contador e os eventos', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.nextSequence(SESSAO_A);
    await outbox.nextSequence(SESSAO_A);
    await outbox.append(evento('a1', SESSAO_A, 1));
    await outbox.append(evento('b0', SESSAO_B, 0));

    await outbox.forgetSession(SESSAO_A);

    expect(labels(await outbox.pending())).toEqual(['a1', 'b0']);
    expect((await outbox.load()).sequences[SESSAO_A]).toBe(1);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(2);
  });

  it('remove do último evento da sessão esquecida apaga o contador', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.nextSequence(SESSAO_A);
    await outbox.nextSequence(SESSAO_A);
    await outbox.append(evento('a0', SESSAO_A, 0));
    await outbox.append(evento('a1', SESSAO_A, 1));
    await outbox.forgetSession(SESSAO_A);

    await outbox.remove([uid('a0')]);
    expect((await outbox.load()).sequences[SESSAO_A]).toBe(1);

    await outbox.remove([uid('a1')]);
    expect(await outbox.load()).toEqual(VAZIO);
  });

  it('remove de evento de sessão ainda viva não apaga o contador', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.nextSequence(SESSAO_A);
    await outbox.append(evento('a0', SESSAO_A, 0));

    await outbox.remove([uid('a0')]);

    expect((await outbox.load()).sequences[SESSAO_A]).toBe(0);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(1);
  });

  // A sessão voltou a gerar amostra depois de esquecida: está viva, e o
  // contador não pode mais sair pelo remove.
  it('nextSequence depois de forgetSession reanima a sessão', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.nextSequence(SESSAO_A);
    await outbox.append(evento('a0', SESSAO_A, 0));
    await outbox.forgetSession(SESSAO_A);

    expect(await outbox.nextSequence(SESSAO_A)).toBe(1);
    await outbox.remove([uid('a0')]);

    expect((await outbox.load()).sequences[SESSAO_A]).toBe(1);
    expect((await outbox.load()).forgotten).toEqual([]);
  });

  it('a marca de esquecida sobrevive a uma fábrica nova', async () => {
    const { storage } = memoryStorage(null);
    const antes = createTelemetryOutbox(storage);
    await antes.nextSequence(SESSAO_A);
    await antes.append(evento('a0', SESSAO_A, 0));
    await antes.forgetSession(SESSAO_A);

    const depois = createTelemetryOutbox(storage);
    await depois.remove([uid('a0')]);
    expect(await depois.load()).toEqual(VAZIO);
  });
});

describe('telemetryOutbox, arquivo corrompido', () => {
  it('lê vazio e a próxima escrita o conserta', async () => {
    const { storage, write } = memoryStorage('{nem json');
    const outbox = createTelemetryOutbox(storage);
    expect(await outbox.pending()).toEqual([]);
    await outbox.append(evento('e1'));
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ ...VAZIO, events: [evento('e1')] });
    // Fábrica nova lê o arquivo consertado.
    expect(labels(await createTelemetryOutbox(storage).pending())).toEqual(['e1']);
  });
});
