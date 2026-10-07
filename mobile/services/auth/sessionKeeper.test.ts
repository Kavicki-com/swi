import { CONFIRM_RETRY_MS, createSessionKeeper } from './sessionKeeper';
import type { SessionCheck } from './types';

const ana = { id: 'u1', email: 'ana@ex.com', name: 'Ana' };

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setup() {
  const answers: ((check: SessionCheck) => void)[] = [];
  const confirm = jest.fn(
    () => new Promise<SessionCheck>((resolve) => { answers.push(resolve); }),
  );
  const onValid = jest.fn();
  const onRevoked = jest.fn();
  const keeper = createSessionKeeper({ confirm, onValid, onRevoked });
  // Responde a confirmação mais antiga ainda no ar.
  const answer = async (check: SessionCheck) => {
    answers.shift()!(check);
    await flush();
  };
  return { keeper, confirm, onValid, onRevoked, answer };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('sessionKeeper', () => {
  it('sem confirmação, tenta a cada 30 s até o servidor confirmar', async () => {
    const { keeper, confirm, onValid, answer } = setup();
    keeper.start(false);

    jest.advanceTimersByTime(CONFIRM_RETRY_MS);
    expect(confirm).toHaveBeenCalledTimes(1);
    await answer({ status: 'unreachable' });

    jest.advanceTimersByTime(CONFIRM_RETRY_MS);
    expect(confirm).toHaveBeenCalledTimes(2);
    await answer({ status: 'valid', user: ana });
    expect(onValid).toHaveBeenCalledWith(ana);

    jest.advanceTimersByTime(CONFIRM_RETRY_MS * 4);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(CONFIRM_RETRY_MS).toBe(30_000);
  });

  it('já confirmada, não tenta sozinha', () => {
    const { keeper, confirm } = setup();
    keeper.start(true);

    jest.advanceTimersByTime(CONFIRM_RETRY_MS * 4);

    expect(confirm).not.toHaveBeenCalled();
  });

  it('gatilhos durante uma confirmação viram uma só, depois dela', async () => {
    const { keeper, confirm, answer } = setup();
    keeper.start(true);

    keeper.trigger();
    keeper.trigger();
    keeper.trigger();
    expect(confirm).toHaveBeenCalledTimes(1);

    await answer({ status: 'valid', user: ana });
    expect(confirm).toHaveBeenCalledTimes(2);

    await answer({ status: 'valid', user: ana });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('retry só pergunta enquanto a sessão não foi confirmada', async () => {
    const { keeper, confirm, answer } = setup();
    keeper.start(false);

    keeper.retry();
    expect(confirm).toHaveBeenCalledTimes(1);
    await answer({ status: 'valid', user: ana });

    keeper.retry();
    expect(confirm).toHaveBeenCalledTimes(1);
    keeper.trigger();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('retry não pergunta em sessão já confirmada', () => {
    const { keeper, confirm } = setup();
    keeper.start(true);

    keeper.retry();

    expect(confirm).not.toHaveBeenCalled();
  });

  it('adota a confirmação que já estava no ar', async () => {
    const { keeper, confirm, onValid } = setup();
    let resolve!: (check: SessionCheck) => void;
    const inFlight = new Promise<SessionCheck>((r) => { resolve = r; });

    keeper.start(false, inFlight);
    keeper.trigger();
    expect(confirm).not.toHaveBeenCalled();

    resolve({ status: 'valid', user: ana });
    await flush();

    expect(onValid).toHaveBeenCalledWith(ana);
  });

  it.each(['revoked', 'none'] as const)('com %s avisa e para tudo', async (status) => {
    const { keeper, confirm, onRevoked, answer } = setup();
    keeper.start(false);
    keeper.trigger();

    await answer({ status });

    expect(onRevoked).toHaveBeenCalledTimes(1);
    keeper.trigger();
    jest.advanceTimersByTime(CONFIRM_RETRY_MS * 2);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('parado, descarta a resposta que chega depois', async () => {
    const { keeper, confirm, onRevoked, answer } = setup();
    keeper.start(true);
    keeper.trigger();

    keeper.stop();
    await answer({ status: 'revoked' });

    expect(onRevoked).not.toHaveBeenCalled();
    keeper.trigger();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('sessão nova descarta a resposta da anterior', async () => {
    const { keeper, onRevoked, answer } = setup();
    keeper.start(true);
    keeper.trigger();

    keeper.start(true);
    await answer({ status: 'revoked' });

    expect(onRevoked).not.toHaveBeenCalled();
  });

  it('confirmação que rejeita conta como sem resposta', async () => {
    const confirm = jest
      .fn<Promise<SessionCheck>, []>()
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce({ status: 'valid', user: ana });
    const onValid = jest.fn();
    const keeper = createSessionKeeper({ confirm, onValid, onRevoked: jest.fn() });
    keeper.start(false);

    keeper.trigger();
    await flush();
    jest.advanceTimersByTime(CONFIRM_RETRY_MS);
    await flush();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onValid).toHaveBeenCalledWith(ana);
  });
});
