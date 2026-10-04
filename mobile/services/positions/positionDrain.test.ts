import { BATCH_PAGE_SIZE, createPositionDrainer } from './positionDrain';
import { createPositionOutbox, type QueuedPoint } from './positionOutbox';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

function memoryStorage(): OutboxStorage {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
}

const BASE = Date.parse('2026-10-04T12:00:00.000Z');
// Um ponto por minuto: todos passam pela regra de espaçamento da fila.
const ponto = (minuto: number): QueuedPoint => ({
  lat: -23.55,
  lng: -46.63,
  recordedAt: new Date(BASE + minuto * 60_000).toISOString(),
});
const pontos = (n: number) => Array.from({ length: n }, (_, i) => ponto(i));

const httpError = (status: number) => Object.assign(new Error(`http ${status}`), { status });

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

async function setup(n: number) {
  const outbox = createPositionOutbox(memoryStorage());
  await outbox.append('u1', pontos(n));
  const send = jest.fn(async (_points: readonly QueuedPoint[]) => ({ recorded: 0, ignored: 0 }));
  return { outbox, send, drainer: createPositionDrainer({ outbox, send }) };
}

describe('createPositionDrainer', () => {
  it('fila vazia não chama a rede', async () => {
    const { send, drainer } = await setup(0);
    await expect(drainer.drain('u1')).resolves.toEqual({ sent: 0, outcome: 'empty' });
    expect(send).not.toHaveBeenCalled();
  });

  it('manda em páginas de no máximo 200, na ordem, e esvazia a fila', async () => {
    const { outbox, send, drainer } = await setup(BATCH_PAGE_SIZE + 5);
    await expect(drainer.drain('u1')).resolves.toEqual({
      sent: BATCH_PAGE_SIZE + 5,
      outcome: 'sent',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toHaveLength(BATCH_PAGE_SIZE);
    expect(send.mock.calls[0][0][0]).toEqual(ponto(0));
    expect(send.mock.calls[1][0]).toEqual(pontos(BATCH_PAGE_SIZE + 5).slice(BATCH_PAGE_SIZE));
    expect(await outbox.pending('u1')).toEqual([]);
  });

  it('falha de rede para o envio e guarda a página e as seguintes', async () => {
    const { outbox, send, drainer } = await setup(BATCH_PAGE_SIZE + 5);
    send.mockResolvedValueOnce({ recorded: 0, ignored: 0 });
    send.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(drainer.drain('u1')).resolves.toEqual({ sent: BATCH_PAGE_SIZE, outcome: 'failed' });
    expect(await outbox.pending('u1')).toEqual(pontos(BATCH_PAGE_SIZE + 5).slice(BATCH_PAGE_SIZE));
  });

  it('sessão recusada (401) guarda tudo para quando o login voltar', async () => {
    const { outbox, send, drainer } = await setup(3);
    send.mockRejectedValueOnce(httpError(401));
    await expect(drainer.drain('u1')).resolves.toEqual({ sent: 0, outcome: 'failed' });
    expect(await outbox.pending('u1')).toHaveLength(3);
  });

  it('página recusada pelo contrato (400) sai com aviso e o resto segue', async () => {
    const { outbox, send, drainer } = await setup(BATCH_PAGE_SIZE + 5);
    send.mockRejectedValueOnce(httpError(400));
    await expect(drainer.drain('u1')).resolves.toEqual({ sent: 5, outcome: 'sent' });
    expect(await outbox.pending('u1')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('um dreno em andamento é reaproveitado, e a página não sai duas vezes', async () => {
    const { send, drainer } = await setup(3);
    let release!: () => void;
    send.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ recorded: 3, ignored: 0 });
      }),
    );
    const primeiro = drainer.drain('u1');
    const segundo = drainer.drain('u1');
    await new Promise((r) => setImmediate(r));
    release();
    await expect(primeiro).resolves.toEqual({ sent: 3, outcome: 'sent' });
    await expect(segundo).resolves.toEqual({ sent: 3, outcome: 'sent' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('depois de terminar, um dreno novo volta a ler a fila', async () => {
    const { outbox, send, drainer } = await setup(1);
    await drainer.drain('u1');
    await outbox.append('u1', [ponto(10)]);
    await expect(drainer.drain('u1')).resolves.toEqual({ sent: 1, outcome: 'sent' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('pontos de outro dono não saem com a sessão de quem drena', async () => {
    const { send, drainer } = await setup(3);
    await expect(drainer.drain('u2')).resolves.toEqual({ sent: 0, outcome: 'empty' });
    expect(send).not.toHaveBeenCalled();
  });
});
