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

function evento(eventId: string, sessionId = SESSAO_A, sequence = 0): OutboxEvent {
  return {
    eventId,
    monitoringSessionId: sessionId,
    sequence,
    eventTime: '2026-09-07T12:00:00.000Z',
    origin: 'REAL',
    measurements: { heartRate: { value: 72, unit: 'bpm', source: 'APPLE_WATCH' } },
  };
}

const ids = (events: readonly OutboxEvent[]) => events.map((e) => e.eventId);

describe('telemetryOutbox, estado inicial', () => {
  it('sem arquivo, o estado é vazio', async () => {
    const { storage } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await expect(outbox.load()).resolves.toEqual({ events: [], sequences: {} });
    await expect(outbox.pending()).resolves.toEqual([]);
  });

  it('arquivo vazio é estado vazio', async () => {
    const outbox = createTelemetryOutbox(memoryStorage('').storage);
    await expect(outbox.load()).resolves.toEqual({ events: [], sequences: {} });
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
    await expect(outbox.load()).resolves.toEqual({ events: [], sequences: {} });
  });

  it('leitura que falha no aparelho é estado vazio, sem lançar', async () => {
    const { storage, read } = memoryStorage(null);
    read.mockRejectedValue(new Error('disco indisponível'));
    const outbox = createTelemetryOutbox(storage);
    await expect(outbox.load()).resolves.toEqual({ events: [], sequences: {} });
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
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ events: [evento('e1')], sequences: {} });
  });

  it('pending devolve os eventos na ordem em que entraram', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.append(evento('e1'));
    await outbox.append(evento('e2', SESSAO_B));
    await outbox.append(evento('e3'));
    expect(ids(await outbox.pending())).toEqual(['e1', 'e2', 'e3']);
  });

  it('remove tira só os ids citados e mantém a ordem dos demais', async () => {
    const { storage, current } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.append(evento('e1'));
    await outbox.append(evento('e2'));
    await outbox.append(evento('e3'));
    await outbox.remove(['e2', 'nao-existe']);
    expect(ids(await outbox.pending())).toEqual(['e1', 'e3']);
    // E o que ficou no arquivo é o mesmo que a fila diz.
    expect(ids(JSON.parse(current() ?? '{}').events)).toEqual(['e1', 'e3']);
  });

  it('remove de id inexistente não escreve', async () => {
    const { storage, write } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.append(evento('e1'));
    write.mockClear();
    await outbox.remove(['nao-existe']);
    await outbox.remove([]);
    expect(write).not.toHaveBeenCalled();
    expect(ids(await outbox.pending())).toEqual(['e1']);
  });

  it('duas append concorrentes ficam as duas no estado final', async () => {
    const { storage, current } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    // Sem await entre as duas: se cada uma lesse o arquivo antes de a outra
    // escrever, a segunda escrita apagaria a primeira.
    await Promise.all([outbox.append(evento('e1')), outbox.append(evento('e2'))]);
    expect(ids(await outbox.pending())).toEqual(['e1', 'e2']);
    expect(ids(JSON.parse(current() ?? '{}').events)).toEqual(['e1', 'e2']);
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
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ events: [], sequences: { [SESSAO_A]: 0 } });
  });

  it('contador corrompido no arquivo recomeça do 0 sem lançar', async () => {
    const texto = JSON.stringify({ events: [], sequences: { [SESSAO_A]: 'sete' } });
    const outbox = createTelemetryOutbox(memoryStorage(texto).storage);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(0);
  });

  it('forgetSession zera só o contador daquela sessão e mantém os eventos dela', async () => {
    const outbox = createTelemetryOutbox(memoryStorage(null).storage);
    await outbox.nextSequence(SESSAO_A);
    await outbox.nextSequence(SESSAO_A);
    await outbox.nextSequence(SESSAO_B);
    await outbox.append(evento('a1', SESSAO_A, 1));
    await outbox.append(evento('b0', SESSAO_B, 0));

    await outbox.forgetSession(SESSAO_A);

    // Os eventos de A ainda não foram enviados; esquecer a sessão não é motivo
    // para perdê-los.
    expect(ids(await outbox.pending())).toEqual(['a1', 'b0']);
    expect(await outbox.nextSequence(SESSAO_A)).toBe(0);
    expect(await outbox.nextSequence(SESSAO_B)).toBe(1);
    const estado = await outbox.load();
    expect(estado.sequences).toEqual({ [SESSAO_A]: 0, [SESSAO_B]: 1 });
  });

  it('forgetSession de sessão desconhecida não escreve', async () => {
    const { storage, write } = memoryStorage(null);
    const outbox = createTelemetryOutbox(storage);
    await outbox.forgetSession(SESSAO_A);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('telemetryOutbox, arquivo corrompido', () => {
  it('lê vazio e a próxima escrita o conserta', async () => {
    const { storage, write } = memoryStorage('{nem json');
    const outbox = createTelemetryOutbox(storage);
    expect(await outbox.pending()).toEqual([]);
    await outbox.append(evento('e1'));
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      events: [evento('e1')],
      sequences: {},
    });
    // Fábrica nova lê o arquivo consertado.
    expect(ids(await createTelemetryOutbox(storage).pending())).toEqual(['e1']);
  });
});
