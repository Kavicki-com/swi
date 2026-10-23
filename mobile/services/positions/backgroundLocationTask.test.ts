import {
  createLocationHandler,
  DRAIN_MIN_INTERVAL_MS,
  EVACUATION_CHECK_INTERVAL_MS,
  type ActiveEvacuationCheck,
  type TaskLocation,
} from './backgroundLocationTask';
import { createEvacuationWindowStore, EVACUATION_TRACKING_MAX_MS } from './evacuationWindow';
import { createPositionOutbox } from './positionOutbox';
import { createTrackingWindowStore, TRACKING_MAX_MS } from './trackingWindow';
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

const T0 = Date.parse('2026-10-04T12:00:00.000Z');

// A forma que o expo-location entrega à tarefa: timestamp em ms, coords em graus.
const leitura = (segundos: number, latitude = -23.55): TaskLocation => ({
  timestamp: T0 + segundos * 1000,
  coords: { latitude, longitude: -46.63 },
});

type Estado = 'aberta' | 'vencida' | 'nenhuma';

async function setup(opts: { janela?: Estado; evacuacao?: Estado } = {}) {
  const outbox = createPositionOutbox(memoryStorage());
  const window = createTrackingWindowStore(memoryStorage());
  if (opts.janela !== 'nenhuma') {
    const inicio = opts.janela === 'vencida' ? T0 - TRACKING_MAX_MS : T0 - 60_000;
    await window.open('u1', new Date(inicio));
  }
  const evacuation = createEvacuationWindowStore(memoryStorage());
  if (opts.evacuacao && opts.evacuacao !== 'nenhuma') {
    const inicio = opts.evacuacao === 'vencida' ? T0 - EVACUATION_TRACKING_MAX_MS : T0 - 30_000;
    await evacuation.open('u1', 'e1', new Date(inicio));
  }
  let agora = T0;
  const drain = jest.fn(async (_owner: string) => ({ sent: 0, outcome: 'sent' as const }));
  const stopUpdates = jest.fn(async () => undefined);
  // O servidor concorda com o arquivo: com a evacuação gravada, ela segue
  // ativa; sem evacuação gravada, nenhuma começou.
  const emCurso: ActiveEvacuationCheck =
    opts.evacuacao && opts.evacuacao !== 'nenhuma' ? { evacuationId: 'e1' } : null;
  const activeEvacuation = jest.fn(async (): Promise<ActiveEvacuationCheck> => emCurso);
  const { handle, reset } = createLocationHandler({
    window,
    evacuation,
    outbox,
    drainer: { drain },
    stopUpdates,
    activeEvacuation,
    now: () => new Date(agora),
  });
  return {
    outbox,
    window,
    evacuation,
    drain,
    stopUpdates,
    activeEvacuation,
    handle,
    reset,
    avancar: (ms: number) => {
      agora += ms;
    },
  };
}

describe('createLocationHandler', () => {
  it('com a janela aberta, guarda a leitura com a hora da medição e drena', async () => {
    const { outbox, drain, handle, stopUpdates } = await setup();
    await handle([leitura(0)]);
    expect(await outbox.pending('u1')).toEqual([
      { lat: -23.55, lng: -46.63, recordedAt: new Date(T0).toISOString() },
    ]);
    expect(drain).toHaveBeenCalledWith('u1');
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('sem janela, desliga o rastreio e não guarda nada', async () => {
    const { outbox, drain, handle, stopUpdates } = await setup({ janela: 'nenhuma' });
    await handle([leitura(0)]);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(drain).not.toHaveBeenCalled();
    expect(await outbox.pending('u1')).toEqual([]);
  });

  it('passadas as 12 h, desliga o rastreio e não guarda nada', async () => {
    const { outbox, handle, stopUpdates } = await setup({ janela: 'vencida' });
    await handle([leitura(0)]);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(await outbox.pending('u1')).toEqual([]);
  });

  it('drena no máximo a cada 10 s, mas guarda toda leitura que vira amostra', async () => {
    const { outbox, drain, handle, avancar } = await setup();
    await handle([leitura(0)]);
    avancar(DRAIN_MIN_INTERVAL_MS - 1);
    await handle([leitura(60)]);
    expect(drain).toHaveBeenCalledTimes(1);
    avancar(1);
    await handle([leitura(120)]);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(await outbox.pending('u1')).toHaveLength(3);
  });

  it('leitura parada antes de 60 s não toca o disco nem a rede', async () => {
    const { outbox, drain, handle, avancar } = await setup();
    await handle([leitura(0)]);
    avancar(DRAIN_MIN_INTERVAL_MS);
    await handle([leitura(1), leitura(2)]);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('lote vazio ou leitura sem coordenada é ignorado sem quebrar', async () => {
    const { outbox, handle } = await setup();
    await handle([]);
    await handle([{ timestamp: T0 } as unknown as TaskLocation]);
    expect(await outbox.pending('u1')).toEqual([]);
  });

  // Ao ligar as leituras o sistema pode entregar primeiro uma posição guardada,
  // medida antes de a jornada começar. Ela não é da jornada e não entra.
  it('leitura medida antes do início da janela é descartada', async () => {
    const { outbox, handle } = await setup();
    // A janela do setup abre 60 s antes de T0.
    await handle([leitura(-3600), leitura(-61)]);
    expect(await outbox.pending('u1')).toEqual([]);
    await handle([leitura(0)]);
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('a posição antiga não segura a primeira leitura boa do mesmo lote', async () => {
    const { outbox, handle } = await setup();
    await handle([leitura(-3600), leitura(1)]);
    expect(await outbox.pending('u1')).toEqual([
      { lat: -23.55, lng: -46.63, recordedAt: new Date(T0 + 1000).toISOString() },
    ]);
  });

  // O filtro em memória é zerado quando o rastreio desliga (registerLocationTask):
  // quem começa a jornada em seguida não perde o primeiro ponto.
  it('depois de zerado, a próxima pessoa não herda o espaçamento da anterior', async () => {
    const { outbox, window, handle, reset } = await setup();
    await handle([leitura(0)]);
    reset();
    await window.close();
    await window.open('u2', new Date(T0));
    await handle([leitura(5)]);
    expect(await outbox.pending('u2')).toHaveLength(1);
  });

  it('falha no dreno não derruba a tarefa e a leitura fica guardada', async () => {
    const { outbox, drain, handle } = await setup();
    drain.mockRejectedValueOnce(new Error('rede'));
    await expect(handle([leitura(0)])).resolves.toBeUndefined();
    expect(await outbox.pending('u1')).toHaveLength(1);
  });
});

// Com evacuação em curso o painel segue a pessoa leitura a leitura, com ou
// sem jornada, até o gestor encerrar. A tarefa sabe da evacuação pelo arquivo
// e pergunta ao servidor, de tempos em tempos, se ela ainda está ativa: o
// encerramento pode acontecer com o app em segundo plano.
describe('createLocationHandler, evacuação', () => {
  const DEZ_S = 10_000;

  it('sem jornada, guarda e drena cada leitura de 10 s, parado', async () => {
    const { outbox, drain, handle, avancar, stopUpdates } = await setup({
      janela: 'nenhuma',
      evacuacao: 'aberta',
    });
    await handle([leitura(0)]);
    avancar(DEZ_S);
    await handle([leitura(10)]);
    avancar(DEZ_S);
    await handle([leitura(20)]);
    expect(await outbox.pending('u1')).toHaveLength(3);
    expect(drain).toHaveBeenCalledTimes(3);
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('com a jornada aberta, também sem o filtro de 60 s', async () => {
    const { outbox, handle, avancar } = await setup({ evacuacao: 'aberta' });
    await handle([leitura(0)]);
    avancar(DEZ_S);
    await handle([leitura(10)]);
    expect(await outbox.pending('u1')).toHaveLength(2);
  });

  it('com a jornada vencida, segue rastreando enquanto a evacuação durar', async () => {
    const { outbox, handle, stopUpdates } = await setup({ janela: 'vencida', evacuacao: 'aberta' });
    await handle([leitura(0)]);
    expect(stopUpdates).not.toHaveBeenCalled();
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('sem jornada, leitura medida antes do início da evacuação é descartada', async () => {
    const { outbox, handle } = await setup({ janela: 'nenhuma', evacuacao: 'aberta' });
    // A evacuação do setup abre 30 s antes de T0.
    await handle([leitura(-60)]);
    expect(await outbox.pending('u1')).toEqual([]);
  });

  it('passado o teto, sem jornada, desliga', async () => {
    const { handle, stopUpdates } = await setup({ janela: 'nenhuma', evacuacao: 'vencida' });
    await handle([leitura(0)]);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
  });

  it('pergunta ao servidor no máximo a cada 60 s', async () => {
    const { handle, avancar, activeEvacuation } = await setup({ evacuacao: 'aberta' });
    await handle([leitura(0)]);
    avancar(DEZ_S);
    await handle([leitura(10)]);
    expect(activeEvacuation).toHaveBeenCalledTimes(1);
    avancar(EVACUATION_CHECK_INTERVAL_MS - DEZ_S);
    await handle([leitura(60)]);
    expect(activeEvacuation).toHaveBeenCalledTimes(2);
  });

  it('encerrada no servidor, sem jornada: apaga a evacuação e desliga', async () => {
    const { handle, evacuation, activeEvacuation, stopUpdates, outbox } = await setup({
      janela: 'nenhuma',
      evacuacao: 'aberta',
    });
    activeEvacuation.mockResolvedValueOnce(null);
    await handle([leitura(0)]);
    expect(await evacuation.read()).toBeNull();
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    // A leitura medida durante a evacuação já estava guardada.
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('encerrada no servidor, com jornada: volta ao filtro da jornada', async () => {
    const { handle, evacuation, activeEvacuation, stopUpdates, outbox, avancar } = await setup({
      evacuacao: 'aberta',
    });
    activeEvacuation.mockResolvedValueOnce(null);
    await handle([leitura(0)]);
    expect(await evacuation.read()).toBeNull();
    expect(stopUpdates).not.toHaveBeenCalled();
    avancar(DEZ_S);
    await handle([leitura(10)]);
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('sem resposta do servidor, a evacuação continua', async () => {
    const { handle, evacuation, activeEvacuation, stopUpdates, avancar } = await setup({
      janela: 'nenhuma',
      evacuacao: 'aberta',
    });
    activeEvacuation.mockResolvedValueOnce('unknown');
    await handle([leitura(0)]);
    activeEvacuation.mockRejectedValueOnce(new Error('rede'));
    avancar(EVACUATION_CHECK_INTERVAL_MS);
    await handle([leitura(60)]);
    expect(activeEvacuation).toHaveBeenCalledTimes(2);
    expect(await evacuation.read()).not.toBeNull();
    expect(stopUpdates).not.toHaveBeenCalled();
  });
});

// Com a jornada aberta e o app em segundo plano não há tela que consulte: é a
// tarefa que pergunta ao servidor, de tempos em tempos, se começou uma
// evacuação. Começou, ela grava a evacuação para a pessoa da jornada e cada
// leitura de 10 s passa a entrar, sem esperar o app voltar para a frente.
describe('createLocationHandler, evacuação começada durante a jornada', () => {
  const DEZ_S = 10_000;

  it('com a jornada aberta e sem evacuação, pergunta ao servidor no máximo a cada 60 s', async () => {
    const { handle, avancar, activeEvacuation } = await setup();
    await handle([leitura(0)]);
    expect(activeEvacuation).toHaveBeenCalledTimes(1);
    avancar(DEZ_S);
    await handle([leitura(10, -23.56)]);
    expect(activeEvacuation).toHaveBeenCalledTimes(1);
    avancar(EVACUATION_CHECK_INTERVAL_MS - DEZ_S);
    await handle([leitura(60)]);
    expect(activeEvacuation).toHaveBeenCalledTimes(2);
  });

  it('a pergunta segue o relógio mesmo quando a leitura não vira ponto da jornada', async () => {
    const { handle, avancar, activeEvacuation, outbox } = await setup();
    await handle([leitura(0)]);
    // Parado: a cada 10 s uma leitura, nenhuma vira ponto pela régua de 60 s.
    for (let s = 10; s <= 50; s += 10) {
      avancar(DEZ_S);
      await handle([leitura(s)]);
    }
    // A leitura medida aos 59 s chega aos 60 s: não vira ponto, mas é hora.
    avancar(DEZ_S);
    await handle([leitura(59)]);
    expect(await outbox.pending('u1')).toHaveLength(1);
    expect(activeEvacuation).toHaveBeenCalledTimes(2);
  });

  it('começou: grava a evacuação para a pessoa da jornada e passa à régua da evacuação', async () => {
    const { handle, avancar, activeEvacuation, evacuation, outbox, drain, stopUpdates } =
      await setup();
    activeEvacuation.mockResolvedValueOnce({ evacuationId: 'e9' });
    await handle([leitura(0)]);
    expect(await evacuation.read()).toEqual({
      userId: 'u1',
      evacuationId: 'e9',
      startedAt: new Date(T0).toISOString(),
    });
    // Parado, a leitura de 10 s depois já entra e sai na hora.
    avancar(DEZ_S);
    await handle([leitura(10)]);
    avancar(DEZ_S);
    await handle([leitura(20)]);
    expect(await outbox.pending('u1')).toHaveLength(3);
    expect(drain).toHaveBeenCalledTimes(3);
    // As leituras do sistema seguem como estão: religar daqui o Android pode
    // recusar, com o app em segundo plano.
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('a partir dali vale a checagem do encerramento, que volta à jornada', async () => {
    const { handle, avancar, activeEvacuation, evacuation, outbox } = await setup();
    activeEvacuation.mockResolvedValueOnce({ evacuationId: 'e9' });
    await handle([leitura(0)]);
    avancar(EVACUATION_CHECK_INTERVAL_MS);
    activeEvacuation.mockResolvedValueOnce(null);
    await handle([leitura(60)]);
    expect(await evacuation.read()).toBeNull();
    avancar(DEZ_S);
    await handle([leitura(70)]);
    expect(await outbox.pending('u1')).toHaveLength(2);
  });

  it('a leitura entra na fila antes da pergunta: sem rede, ela fica e nada é gravado', async () => {
    const { handle, avancar, activeEvacuation, evacuation, outbox, stopUpdates } = await setup();
    activeEvacuation.mockRejectedValueOnce(new Error('rede'));
    await expect(handle([leitura(0)])).resolves.toBeUndefined();
    avancar(EVACUATION_CHECK_INTERVAL_MS);
    activeEvacuation.mockResolvedValueOnce('unknown');
    await handle([leitura(60)]);
    expect(await outbox.pending('u1')).toHaveLength(2);
    expect(await evacuation.read()).toBeNull();
    expect(stopUpdates).not.toHaveBeenCalled();
  });

  it('disco que falha ao gravar a evacuação não derruba a leitura', async () => {
    const { handle, activeEvacuation, evacuation, outbox } = await setup();
    activeEvacuation.mockResolvedValueOnce({ evacuationId: 'e9' });
    jest.spyOn(evacuation, 'open').mockRejectedValueOnce(new Error('disco'));
    await expect(handle([leitura(0)])).resolves.toBeUndefined();
    expect(await outbox.pending('u1')).toHaveLength(1);
  });

  it('sem jornada nem evacuação, desliga sem perguntar', async () => {
    const { handle, activeEvacuation, stopUpdates } = await setup({ janela: 'nenhuma' });
    await handle([leitura(0)]);
    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(activeEvacuation).not.toHaveBeenCalled();
  });
});
