import { act, create } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { fetchMyTelemetry, type WorkerTelemetry } from '../telemetry/myTelemetry';
import { condition, metric, neverReported, reporting } from '../telemetry/myTelemetryFixtures';
import { useAuth } from '../auth/AuthProvider';
import { liveValue, workerStatusOf } from './dashboardVitalsView';
import {
  MY_TELEMETRY_HOLD_MS,
  MY_TELEMETRY_REFRESH_MS,
  MyTelemetryProvider,
  useMyTelemetry,
  type MyTelemetryState,
} from './MyTelemetryProvider';

// Uma leitura só de me/current para o app inteiro. As fronteiras dubladas são
// o backend, a sessão e o AppState; o relógio é falso, porque é ele que
// dispara a releitura e o fim do prazo da última leitura.

jest.mock('../telemetry/myTelemetry', () => ({ fetchMyTelemetry: jest.fn() }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const fetchMock = fetchMyTelemetry as jest.MockedFunction<typeof fetchMyTelemetry>;
const mockUseAuth = useAuth as jest.Mock;

const AGORA = new Date('2026-10-01T15:00:00.000Z');

const withCondition = (category: 'URGENT' | 'HEALTH' | 'DEVICE'): WorkerTelemetry => ({
  ...reporting(),
  conditions: [condition(category)],
});

let seen: MyTelemetryState[];
const last = () => seen[seen.length - 1]!;

function Probe() {
  seen.push(useMyTelemetry());
  return null;
}

let aoMudarEstado: ((s: AppStateStatus) => void) | null;
let removerOuvinte: jest.Mock;

const arvore = (probes = 1) => (
  <MyTelemetryProvider>
    {Array.from({ length: probes }, (_, i) => (
      <Probe key={i} />
    ))}
  </MyTelemetryProvider>
);

const render = async (probes = 1) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(arvore(probes));
  });
  return tree;
};

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const mudarEstado = async (estado: AppStateStatus) => {
  await act(async () => {
    aoMudarEstado?.(estado);
  });
};

const sair = async (tree: ReturnType<typeof create>) => {
  mockUseAuth.mockReturnValue({ user: null });
  await act(async () => {
    tree.update(arvore());
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(AGORA);
  seen = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(reporting());
  mockUseAuth.mockReturnValue({ user: { id: 'w1' } });
  aoMudarEstado = null;
  removerOuvinte = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _tipo: string,
    cb: (s: AppStateStatus) => void,
  ) => {
    aoMudarEstado = cb;
    return { remove: removerOuvinte };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('MyTelemetryProvider: leitura compartilhada', () => {
  it('começa carregando e entrega a leitura do backend', async () => {
    await render();

    expect(seen[0]).toEqual({ telemetry: null, failed: false, loading: true });
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
    expect(last()).toMatchObject({ failed: false, loading: false });
  });

  // Antes cada tela relia me/current por conta própria.
  it('várias telas leem a mesma leitura, com um pedido só', async () => {
    await render(3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await avancar(MY_TELEMETRY_REFRESH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('relê sozinha no intervalo', async () => {
    await render();

    await avancar(MY_TELEMETRY_REFRESH_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await avancar(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('desmontar para o relógio e solta o ouvinte do AppState', async () => {
    const tree = await render();

    await act(async () => {
      tree.unmount();
    });
    await avancar(MY_TELEMETRY_REFRESH_MS * 3);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(removerOuvinte).toHaveBeenCalledTimes(1);
  });
});

describe('MyTelemetryProvider: sessão', () => {
  // A rota é autenticada e o provider mora acima do login.
  it('sem sessão não busca, nem no relógio nem no primeiro plano', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    await render();

    await avancar(MY_TELEMETRY_REFRESH_MS * 3);
    await mudarEstado('active');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(last()).toEqual({ telemetry: null, failed: false, loading: true });
  });

  it('sair da sessão apaga a leitura e para a releitura', async () => {
    fetchMock.mockResolvedValue(withCondition('URGENT'));
    const tree = await render();
    expect(last().telemetry).not.toBeNull();

    await sair(tree);
    await avancar(MY_TELEMETRY_HOLD_MS * 2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(last()).toEqual({ telemetry: null, failed: false, loading: true });
  });

  it('entrar de novo depois de sair volta a ler, sem herdar a leitura anterior', async () => {
    const tree = await render();
    await sair(tree);

    mockUseAuth.mockReturnValue({ user: { id: 'w2' } });
    fetchMock.mockResolvedValue(reporting({ heartRate: metric(98) }));
    await act(async () => {
      tree.update(arvore());
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(last().telemetry?.metrics.heartRate.value).toBe(98);
  });

  it('resposta que chega depois do logout não ressuscita a leitura', async () => {
    let responder!: (t: WorkerTelemetry) => void;
    fetchMock.mockReturnValue(new Promise<WorkerTelemetry>((r) => { responder = r; }));
    const tree = await render();

    await sair(tree);
    await act(async () => {
      responder(reporting());
    });

    expect(last().telemetry).toBeNull();
  });
});

describe('MyTelemetryProvider: falha de rede', () => {
  it('primeira leitura que falha marca a falha, sem leitura nenhuma', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await render();

    expect(last()).toEqual({ telemetry: null, failed: true, loading: false });
  });

  // Uma falha solta não diz nada sobre o funcionário: a leitura de segundos
  // atrás ainda está dentro da janela em que o backend a chama de atual.
  it('uma falha única mantém a última leitura na tela', async () => {
    await render();

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_REFRESH_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
    expect(last().failed).toBe(false);
  });

  it('sem resposta nova dentro do prazo, a leitura some e a falha aparece', async () => {
    await render();

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS - 1);
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await avancar(1);
    expect(last()).toEqual({ telemetry: null, failed: true, loading: false });
  });

  it('o prazo conta da última resposta boa, não da primeira', async () => {
    await render();
    await avancar(MY_TELEMETRY_REFRESH_MS * 2);

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS - 1);
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await avancar(1);
    expect(last().telemetry).toBeNull();
  });

  it('leitura nova depois do prazo repõe tudo', async () => {
    await render();
    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS);
    expect(last().failed).toBe(true);

    fetchMock.mockResolvedValue(reporting());
    await avancar(MY_TELEMETRY_REFRESH_MS);

    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
    expect(last().failed).toBe(false);
  });

  // O prazo de um pedido (20 s) é maior que o intervalo de releitura (15 s):
  // um pedido travado pode falhar DEPOIS de o seguinte já ter respondido.
  it('falha atrasada de um pedido antigo não apaga a leitura mais nova', async () => {
    let falharPrimeiro!: (e: Error) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise((_, reject) => { falharPrimeiro = reject; }))
      .mockResolvedValue(reporting());
    await render();
    await avancar(MY_TELEMETRY_REFRESH_MS);
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await act(async () => {
      falharPrimeiro(new Error('timeout'));
    });

    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
    expect(last().failed).toBe(false);
  });
});

describe('MyTelemetryProvider: pedidos fora de ordem e prazo', () => {
  // A falha de um pedido não diz nada sobre o anterior, que ainda pode trazer
  // uma leitura mais nova que a da tela.
  it('falha de um pedido mais novo não descarta a resposta boa de um mais antigo', async () => {
    await render();
    let responder!: (t: WorkerTelemetry) => void;
    fetchMock
      .mockImplementationOnce(() => new Promise<WorkerTelemetry>((r) => { responder = r; }))
      .mockRejectedValueOnce(new Error('offline'));
    await avancar(MY_TELEMETRY_REFRESH_MS);
    await avancar(MY_TELEMETRY_REFRESH_MS);
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await act(async () => {
      responder(reporting({ heartRate: metric(98) }));
    });

    expect(last().telemetry?.metrics.heartRate.value).toBe(98);
  });

  // O backend decide o que é atual quando atende o pedido. Contar da chegada
  // esticaria o prazo pelo tempo que a resposta levou no caminho.
  it('o prazo conta do envio do pedido, não da chegada da resposta', async () => {
    let responder!: (t: WorkerTelemetry) => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<WorkerTelemetry>((r) => { responder = r; }),
    );
    await render();
    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(10_000);
    await act(async () => {
      responder(reporting());
    });
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await avancar(MY_TELEMETRY_HOLD_MS - 10_000 - 1);
    expect(last().telemetry?.metrics.heartRate.value).toBe(112);

    await avancar(1);
    expect(last().telemetry).toBeNull();
  });
});

describe('MyTelemetryProvider: condição aberta sobrevive ao prazo', () => {
  // Esconder uma urgência porque a rede caiu seria pior que mostrá-la
  // atrasada: ela fica até uma leitura nova dizer o contrário.
  it('urgência continua na tela, sem nenhum valor medido', async () => {
    fetchMock.mockResolvedValue(withCondition('URGENT'));
    await render();

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS);

    const { telemetry, failed } = last();
    expect(failed).toBe(true);
    expect(workerStatusOf(telemetry)).toBe('low');
    expect(liveValue(telemetry!.metrics.heartRate)).toBeNull();
    expect(Object.values(telemetry!.metrics).every((m) => m.value === null)).toBe(true);
  });

  it('alerta de saúde também continua', async () => {
    fetchMock.mockResolvedValue(withCondition('HEALTH'));
    await render();

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS);

    expect(workerStatusOf(last().telemetry)).toBe('alert');
  });

  // Relógio descarregado não é funcionário em risco.
  it('condição só de aparelho não segura a leitura', async () => {
    fetchMock.mockResolvedValue(withCondition('DEVICE'));
    await render();

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS);

    expect(last().telemetry).toBeNull();
  });

  it('a condição segue aberta enquanto as falhas continuam', async () => {
    fetchMock.mockResolvedValue(withCondition('URGENT'));
    await render();

    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS + MY_TELEMETRY_REFRESH_MS * 4);

    expect(workerStatusOf(last().telemetry)).toBe('low');
    expect(last().failed).toBe(true);
  });

  it('leitura nova sem a condição a encerra', async () => {
    fetchMock.mockResolvedValue(withCondition('URGENT'));
    await render();
    fetchMock.mockRejectedValue(new Error('offline'));
    await avancar(MY_TELEMETRY_HOLD_MS);

    fetchMock.mockResolvedValue(reporting());
    await avancar(MY_TELEMETRY_REFRESH_MS);

    expect(workerStatusOf(last().telemetry)).toBe('good');
  });
});

describe('MyTelemetryProvider: primeiro e segundo plano', () => {
  it('relê ao voltar para o primeiro plano', async () => {
    await render();

    fetchMock.mockResolvedValue(neverReported());
    await mudarEstado('background');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await mudarEstado('active');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(last().telemetry?.origin).toBeNull();
  });

  // O rastreio de posição mantém o app vivo com a tela apagada. Sem a pausa,
  // a leitura seguiria sendo pedida a jornada inteira sem ninguém olhando.
  it('em segundo plano para de reler, e retoma o intervalo na volta', async () => {
    await render();

    await mudarEstado('background');
    await avancar(MY_TELEMETRY_REFRESH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await mudarEstado('active');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await avancar(MY_TELEMETRY_REFRESH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Com o app parado os timers ficam suspensos: quem decide na volta é o
  // relógio, não o timer que não chegou a disparar.
  it('leitura que venceu com o app parado some na volta, antes da resposta nova', async () => {
    fetchMock.mockResolvedValue(withCondition('HEALTH'));
    await render();

    await mudarEstado('background');
    jest.setSystemTime(new Date(AGORA.getTime() + 10 * 60 * 1000));
    fetchMock.mockReturnValue(new Promise<WorkerTelemetry>(() => {}));
    await mudarEstado('active');

    const { telemetry } = last();
    expect(workerStatusOf(telemetry)).toBe('alert');
    expect(liveValue(telemetry!.metrics.heartRate)).toBeNull();
  });

  // Na volta ninguém falhou ainda: a tela espera a resposta, e só fala em
  // leitura indisponível se a releitura não der certo.
  it('na volta com a leitura vencida fica carregando, e só a releitura que falha marca a falha', async () => {
    let falhar!: (e: Error) => void;
    await render();

    await mudarEstado('background');
    jest.setSystemTime(new Date(AGORA.getTime() + 10 * 60 * 1000));
    fetchMock.mockReturnValue(new Promise<WorkerTelemetry>((_, reject) => { falhar = reject; }));
    await mudarEstado('active');
    expect(last()).toEqual({ telemetry: null, failed: false, loading: true });

    await act(async () => {
      falhar(new Error('offline'));
    });
    expect(last()).toEqual({ telemetry: null, failed: true, loading: false });
  });

  // Com o rastreio ligado os timers seguem vivos com a tela apagada. Ali
  // ninguém tentou ler: prazo que vence em segundo plano é espera, não falha.
  it('prazo que vence em segundo plano não vira falha', async () => {
    fetchMock.mockResolvedValue(withCondition('URGENT'));
    await render();

    await mudarEstado('background');
    await avancar(MY_TELEMETRY_HOLD_MS);

    expect(last()).toMatchObject({ failed: false, loading: true });
    expect(workerStatusOf(last().telemetry)).toBe('low');
    expect(liveValue(last().telemetry!.metrics.heartRate)).toBeNull();
  });

  // Central de controle e chamada recebida deixam o app inativo, não parado.
  it('app inativo no iPhone segue relendo', async () => {
    await render();

    await mudarEstado('inactive');
    await avancar(MY_TELEMETRY_REFRESH_MS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('volta rápida ao primeiro plano mantém a leitura enquanto a nova não chega', async () => {
    await render();

    await mudarEstado('background');
    jest.setSystemTime(new Date(AGORA.getTime() + 10_000));
    fetchMock.mockReturnValue(new Promise<WorkerTelemetry>(() => {}));
    await mudarEstado('active');

    expect(last().telemetry?.metrics.heartRate.value).toBe(112);
  });
});

describe('useMyTelemetry', () => {
  it('fora do provider, avisa em vez de devolver vazio', () => {
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      act(() => {
        create(<Probe />);
      });
    }).toThrow('useMyTelemetry must be used inside MyTelemetryProvider');

    erro.mockRestore();
  });
});
