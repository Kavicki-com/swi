import { createTelemetryInboxDrain, type InboxFiles } from './telemetryInboxDrain';
import { createTelemetryOutbox, type OutboxEvent, type OutboxStorage } from './telemetryOutbox';
import type { WatchControl } from '../../modules/swi-watch-control';

// Dublê do arquivo da fila, o mesmo padrão do teste dela: um texto em memória.
function memoryStorage(initial: string | null = null): OutboxStorage {
  let text = initial;
  return {
    async read() {
      return text;
    },
    async write(next: string) {
      text = next;
    },
  };
}

const SESSAO = '11111111-1111-4111-8111-111111111111';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function evento(n: number, sequence = n): OutboxEvent {
  return {
    eventId: uid(n),
    monitoringSessionId: SESSAO,
    sequence,
    eventTime: '2026-09-08T12:00:00.000Z',
    origin: 'REAL',
    measurements: { heartRate: { value: 70 + n, unit: 'bpm', source: 'APPLE_WATCH' } },
  };
}

const linha = (e: OutboxEvent) => JSON.stringify(e);

/**
 * Dublê dos arquivos rotacionados. Como o nativo real, o que `rotate` devolve
 * é imutável daqui em diante: o Swift já não escreve mais neles.
 */
function memoryFiles(conteudo: Record<string, string>) {
  const apagados: string[] = [];
  const files: InboxFiles = {
    async read(uri) {
      const text = conteudo[uri];
      if (text === undefined) throw new Error(`arquivo inexistente: ${uri}`);
      return text;
    },
    async remove(uri) {
      apagados.push(uri);
      delete conteudo[uri];
    },
  };
  return { files, apagados, restantes: () => Object.keys(conteudo) };
}

function controle(rotacionados: string[]): WatchControl {
  return {
    supported: true,
    getStatus: () => null,
    requestAuthorization: async () => true,
    startMonitoring: async () => true,
    subscribe: () => () => undefined,
    request: async () => ({ status: 200, body: '{}' }),
    rotateInbox: () => rotacionados,
    hasDeviceCredential: () => true,
    clearDeviceCredential: () => undefined,
  };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('dreno do arquivo durável', () => {
  it('leva as linhas de dois arquivos para a fila, na ordem', async () => {
    const outbox = createTelemetryOutbox(memoryStorage());
    const { files } = memoryFiles({
      'file:///inbox.0.ndjson': [linha(evento(0)), linha(evento(1))].join('\n') + '\n',
      'file:///inbox.1.ndjson': linha(evento(2)) + '\n',
    });
    const drain = createTelemetryInboxDrain({
      control: controle(['file:///inbox.0.ndjson', 'file:///inbox.1.ndjson']),
      outbox,
      files,
    });

    expect(await drain.run()).toEqual({ drained: 3, skipped: 0 });
    expect((await outbox.pending()).map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it('apaga o arquivo só depois de as linhas dele entrarem na fila', async () => {
    // Apagar antes perderia tudo se a gravação falhasse no meio, e estas
    // linhas já foram confirmadas ao relógio: ninguém mais as tem.
    const outbox = createTelemetryOutbox(memoryStorage());
    const ordem: string[] = [];
    const original = outbox.appendMany.bind(outbox);
    jest.spyOn(outbox, 'appendMany').mockImplementation(async (events) => {
      ordem.push(`appendMany:${events.map((e) => e.sequence).join(',')}`);
      return original(events);
    });
    const { files, apagados } = memoryFiles({
      'file:///inbox.0.ndjson': [linha(evento(0)), linha(evento(1))].join('\n') + '\n',
    });
    const comRegistro: InboxFiles = {
      read: files.read,
      async remove(uri) {
        ordem.push(`remove:${uri}`);
        return files.remove(uri);
      },
    };
    const drain = createTelemetryInboxDrain({
      control: controle(['file:///inbox.0.ndjson']),
      outbox,
      files: comRegistro,
    });

    await drain.run();
    expect(ordem).toEqual(['appendMany:0,1', 'remove:file:///inbox.0.ndjson']);
    expect(apagados).toEqual(['file:///inbox.0.ndjson']);
  });

  it('pula linha ilegível e segue com as boas do mesmo arquivo', async () => {
    const outbox = createTelemetryOutbox(memoryStorage());
    const { files } = memoryFiles({
      'file:///inbox.0.ndjson': [linha(evento(0)), '{quebrado', linha(evento(1))].join('\n') + '\n',
    });
    const drain = createTelemetryInboxDrain({
      control: controle(['file:///inbox.0.ndjson']),
      outbox,
      files,
    });

    expect(await drain.run()).toEqual({ drained: 2, skipped: 1 });
    expect((await outbox.pending()).map((e) => e.sequence)).toEqual([0, 1]);
  });

  it('ignora evento cujo identificador já está na fila', async () => {
    // O iPhone pode ter morrido entre gravar e confirmar; o relógio reenvia a
    // mesma remessa e as linhas repetem. Repetir é barato, duplicar não.
    const outbox = createTelemetryOutbox(memoryStorage());
    await outbox.append(evento(0));
    const { files } = memoryFiles({
      'file:///inbox.0.ndjson': [linha(evento(0)), linha(evento(1))].join('\n') + '\n',
    });
    const drain = createTelemetryInboxDrain({
      control: controle(['file:///inbox.0.ndjson']),
      outbox,
      files,
    });

    expect(await drain.run()).toEqual({ drained: 1, skipped: 1 });
    expect((await outbox.pending()).map((e) => e.sequence)).toEqual([0, 1]);
  });

  it('não apaga o arquivo quando a leitura dele falha', async () => {
    // Sem ler não dá para saber o que havia lá dentro; apagar seria destruir
    // sem olhar. Fica para a próxima rodada.
    const outbox = createTelemetryOutbox(memoryStorage());
    const { files, restantes } = memoryFiles({ 'file:///inbox.0.ndjson': linha(evento(0)) });
    const drain = createTelemetryInboxDrain({
      control: controle(['file:///inbox.0.ndjson', 'file:///sumiu.ndjson']),
      outbox,
      files,
    });

    expect(await drain.run()).toEqual({ drained: 1, skipped: 0 });
    expect(restantes()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('é inerte sem módulo nativo', async () => {
    const outbox = createTelemetryOutbox(memoryStorage());
    const semSuporte = { ...controle([]), supported: false, rotateInbox: () => [] };
    const { files } = memoryFiles({});
    const drain = createTelemetryInboxDrain({ control: semSuporte, outbox, files });

    expect(await drain.run()).toEqual({ drained: 0, skipped: 0 });
    expect(await outbox.pending()).toEqual([]);
  });

  it('recusa linha fora do contrato sem derrubar o dreno', async () => {
    const outbox = createTelemetryOutbox(memoryStorage());
    const foraDoContrato = { ...evento(1), origin: 'DEMO' };
    const { files } = memoryFiles({
      'file:///inbox.0.ndjson':
        [linha(evento(0)), JSON.stringify(foraDoContrato)].join('\n') + '\n',
    });
    const drain = createTelemetryInboxDrain({
      control: controle(['file:///inbox.0.ndjson']),
      outbox,
      files,
    });

    expect(await drain.run()).toEqual({ drained: 1, skipped: 1 });
    expect((await outbox.pending()).map((e) => e.sequence)).toEqual([0]);
  });
});
