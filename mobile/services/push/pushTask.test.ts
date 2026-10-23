import { createPushTaskHandler, type PushTaskDeps } from './pushTask';

const started = (evacuationId = 'e1') => ({
  notification: null,
  data: { dataString: JSON.stringify({ type: 'evacuation.started', evacuationId }) },
});
const ended = (evacuationId = 'e1') => ({
  notification: null,
  data: { dataString: JSON.stringify({ type: 'evacuation.ended', evacuationId }) },
});
const tap = (evacuationId = 'e1') => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { request: { content: { data: { type: 'evacuation.started', evacuationId } } } },
});

function setup(overrides: Partial<PushTaskDeps> = {}) {
  const deps: PushTaskDeps = {
    readSession: jest.fn(async () => ({ userId: 'u1' })),
    readEvacuation: jest.fn(async () => null),
    reportEnded: jest.fn(),
    tracking: {
      startEvacuation: jest.fn(async () => 'tracking' as const),
      endEvacuation: jest.fn(async () => undefined),
    },
    isForeground: () => false,
    ...overrides,
  };
  return { deps, handler: createPushTaskHandler(deps) };
}

describe('createPushTaskHandler', () => {
  it('início em segundo plano: grava a evacuação e liga o rastreio da pessoa da sessão', async () => {
    const { deps, handler } = setup();
    await expect(handler.handle(started('e7'))).resolves.toBe('started');
    expect(deps.tracking.startEvacuation).toHaveBeenCalledWith('u1', 'e7');
  });

  // Android com o app fechado: a notificação com título não chega à tarefa,
  // mas o toque nela chega. É o caminho garantido para ligar o rastreio.
  it('toque na notificação do início também liga', async () => {
    const { deps, handler } = setup();
    await expect(handler.handle(tap('e3'))).resolves.toBe('started');
    expect(deps.tracking.startEvacuation).toHaveBeenCalledWith('u1', 'e3');
  });

  // Sem a janela do serviço em primeiro plano, o sistema recusa ligar as
  // leituras: a evacuação fica gravada e a notificação visível segue lá.
  it('o sistema recusa ligar as leituras: responde sem derrubar a tarefa', async () => {
    const { handler } = setup({
      tracking: {
        startEvacuation: jest.fn(async () => 'failed' as const),
        endEvacuation: jest.fn(async () => undefined),
      },
    });
    await expect(handler.handle(started())).resolves.toBe('failed');
  });

  it('erro ao ligar também não derruba a tarefa', async () => {
    const { handler } = setup({
      tracking: {
        startEvacuation: jest.fn(async () => {
          throw new Error('ForegroundServiceStartNotAllowedException');
        }),
        endEvacuation: jest.fn(async () => undefined),
      },
    });
    await expect(handler.handle(started())).resolves.toBe('failed');
  });

  it('fim: apaga a evacuação gravada e desliga o que era só dela', async () => {
    const { deps, handler } = setup({
      readEvacuation: jest.fn(async () => ({ userId: 'u1', evacuationId: 'e1', startedAt: '2026-10-23T10:00:00.000Z' })),
    });
    await expect(handler.handle(ended('e1'))).resolves.toBe('ended');
    expect(deps.tracking.endEvacuation).toHaveBeenCalledTimes(1);
  });

  // As telas de evacuação leem o aviso de fim único (evacuationEnd), que só
  // encerra a evacuação que conhece.
  it('fim avisa as telas com o id da evacuação', async () => {
    const { deps, handler } = setup();
    await handler.handle(ended('e1'));
    expect(deps.reportEnded).toHaveBeenCalledWith('e1');
  });

  it('o aviso às telas sai mesmo quando a gravada é outra', async () => {
    const { deps, handler } = setup({
      readEvacuation: jest.fn(async () => ({ userId: 'u1', evacuationId: 'e2', startedAt: '2026-10-23T10:00:00.000Z' })),
    });
    await handler.handle(ended('e1'));
    expect(deps.reportEnded).toHaveBeenCalledWith('e1');
  });

  it('aviso às telas que falha não impede o encerramento', async () => {
    const { deps, handler } = setup({
      reportEnded: jest.fn(() => {
        throw new Error('ouvinte');
      }),
    });
    await expect(handler.handle(ended('e1'))).resolves.toBe('ended');
    expect(deps.tracking.endEvacuation).toHaveBeenCalledTimes(1);
  });

  it('fim sem evacuação gravada também chama o encerramento, que não faz nada', async () => {
    const { deps, handler } = setup();
    await expect(handler.handle(ended('e1'))).resolves.toBe('ended');
    expect(deps.tracking.endEvacuation).toHaveBeenCalledTimes(1);
  });

  // O fim de uma evacuação antiga que chega atrasado não pode desligar a
  // evacuação nova que já está gravada.
  it('fim de outra evacuação não mexe na gravada', async () => {
    const { deps, handler } = setup({
      readEvacuation: jest.fn(async () => ({ userId: 'u1', evacuationId: 'e2', startedAt: '2026-10-23T10:00:00.000Z' })),
    });
    await expect(handler.handle(ended('e1'))).resolves.toBe('ignored');
    expect(deps.tracking.endEvacuation).not.toHaveBeenCalled();
  });

  it('erro ao encerrar não derruba a tarefa', async () => {
    const { handler } = setup({
      tracking: {
        startEvacuation: jest.fn(async () => 'tracking' as const),
        endEvacuation: jest.fn(async () => {
          throw new Error('disco');
        }),
      },
    });
    await expect(handler.handle(ended())).resolves.toBe('failed');
  });

  it('sem sessão salva, nada liga nem desliga', async () => {
    const { deps, handler } = setup({ readSession: jest.fn(async () => null) });
    await expect(handler.handle(started())).resolves.toBe('ignored');
    await expect(handler.handle(ended())).resolves.toBe('ignored');
    expect(deps.tracking.startEvacuation).not.toHaveBeenCalled();
    expect(deps.tracking.endEvacuation).not.toHaveBeenCalled();
  });

  it('falha ao ler a sessão é o mesmo que não ter sessão', async () => {
    const { handler } = setup({
      readSession: jest.fn(async () => {
        throw new Error('keychain');
      }),
    });
    await expect(handler.handle(started())).resolves.toBe('ignored');
  });

  // Com o app na frente, quem cuida é a tela: consulta o servidor e pede a
  // permissão antes de ligar. A tarefa, que também roda nesse caso, não liga
  // sem perguntar.
  it('com o app na frente, a tarefa deixa para a tela', async () => {
    const { deps, handler } = setup({ isForeground: () => true });
    await expect(handler.handle(started())).resolves.toBe('ignored');
    await expect(handler.handle(ended())).resolves.toBe('ignored');
    expect(deps.readSession).not.toHaveBeenCalled();
  });

  it('push que não é da evacuação é ignorado', async () => {
    const { deps, handler } = setup();
    await expect(handler.handle({ data: { dataString: '{"type":"chat"}' } })).resolves.toBe('ignored');
    await expect(handler.handle(undefined)).resolves.toBe('ignored');
    expect(deps.readSession).not.toHaveBeenCalled();
  });
});
