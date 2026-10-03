import { act, create } from 'react-test-renderer';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { WeatherProvider, useWeather } from './WeatherProvider';
import { getWeatherBackend } from './getWeatherBackend';
import { useAuth } from '../auth/AuthProvider';
import type { WeatherAlert, WeatherSnapshot } from './types';

// O clima precisa se atualizar com o app aberto. Antes o provider lia uma vez
// só, na montagem, e um alerta que nascesse (ou morresse) depois disso só
// aparecia quando a pessoa fechava e abria o app.
//
// As fronteiras dubladas são o backend, a sessão e o AppState. O relógio é
// falso: é ele que dispara a releitura periódica e a expiração do alerta.

jest.mock('./getWeatherBackend', () => ({ getWeatherBackend: jest.fn() }));
jest.mock('../auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const mockGetBackend = getWeatherBackend as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;

const AGORA = new Date('2026-06-23T12:00:00.000Z');
const CINCO_MINUTOS = 5 * 60 * 1000;

const alerta = (over: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'wx-1',
  kind: 'TEMPESTADE',
  severity: 'PERIGO',
  event: 'Tempestade',
  description: 'Procure abrigo.',
  startsAt: '2026-06-23T11:00:00.000Z',
  endsAt: '2026-06-23T18:00:00.000Z',
  ...over,
});

const snap = (tempC: number, alerts: WeatherAlert[] = []): WeatherSnapshot => ({
  current: { tempC, condition: 'rain', humidityPct: 65, windKmh: 20 },
  daily: { minC: 15, maxC: 27 },
  alerts,
  fetchedAt: AGORA.toISOString(),
});

function Probe() {
  const { loadStatus, snapshot, activeAlert } = useWeather();
  return (
    <Text>{`${loadStatus}|${snapshot ? snapshot.current.tempC : 'sem-clima'}|${activeAlert?.id ?? 'sem-alerta'}`}</Text>
  );
}

let getWeather: jest.Mock;
let aoMudarEstado: ((s: AppStateStatus) => void) | null;
let removerOuvinte: jest.Mock;

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <WeatherProvider>
        <Probe />
      </WeatherProvider>,
    );
  });
  return tree;
};

const visto = (tree: ReturnType<typeof create>) => {
  const json = tree.toJSON() as { children: string[] };
  return json.children.join('');
};

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(AGORA);
  getWeather = jest.fn().mockResolvedValue(snap(17));
  mockGetBackend.mockReturnValue({ getWeather });
  mockUseAuth.mockReturnValue({ user: { email: 'a@b.c' } });
  aoMudarEstado = null;
  removerOuvinte = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_tipo: string, cb: (s: AppStateStatus) => void) => {
    aoMudarEstado = cb;
    return { remove: removerOuvinte };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('WeatherProvider: primeira carga', () => {
  it('com sessão, busca o clima e fica pronto', async () => {
    const tree = await render();

    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(visto(tree)).toBe('ready|17|sem-alerta');
  });

  it('expõe o alerta vigente do snapshot', async () => {
    getWeather.mockResolvedValue(snap(17, [alerta()]));

    const tree = await render();

    expect(visto(tree)).toBe('ready|17|wx-1');
  });

  it('primeira carga que falha vira erro, e a releitura seguinte recupera', async () => {
    getWeather.mockRejectedValueOnce(new Error('rede caiu'));
    const tree = await render();
    expect(visto(tree)).toBe('error|sem-clima|sem-alerta');

    await avancar(CINCO_MINUTOS);

    expect(visto(tree)).toBe('ready|17|sem-alerta');
  });
});

describe('WeatherProvider: usuário deslogado', () => {
  // A rota do clima é autenticada. Sem sessão o provider não pergunta nada, e
  // também não fica perguntando de cinco em cinco minutos na tela de login.
  it('sem sessão não busca, nem na montagem nem no relógio nem no primeiro plano', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    const tree = await render();

    await avancar(CINCO_MINUTOS * 3);
    await act(async () => {
      aoMudarEstado?.('active');
    });

    expect(getWeather).not.toHaveBeenCalled();
    expect(visto(tree)).toBe('idle|sem-clima|sem-alerta');
  });

  it('entrar a sessão dispara a carga', async () => {
    mockUseAuth.mockReturnValue({ user: null });
    const tree = await render();

    mockUseAuth.mockReturnValue({ user: { email: 'a@b.c' } });
    await act(async () => {
      tree.update(
        <WeatherProvider>
          <Probe />
        </WeatherProvider>,
      );
    });

    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(visto(tree)).toBe('ready|17|sem-alerta');
  });

  it('sair da sessão apaga o clima e para a releitura', async () => {
    getWeather.mockResolvedValue(snap(17, [alerta()]));
    const tree = await render();
    expect(visto(tree)).toBe('ready|17|wx-1');

    mockUseAuth.mockReturnValue({ user: null });
    await act(async () => {
      tree.update(
        <WeatherProvider>
          <Probe />
        </WeatherProvider>,
      );
    });
    await avancar(CINCO_MINUTOS * 2);

    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(visto(tree)).toBe('idle|sem-clima|sem-alerta');
  });

  it('resposta que chega depois do logout não ressuscita o clima', async () => {
    let resolver!: (s: WeatherSnapshot) => void;
    getWeather.mockReturnValue(new Promise<WeatherSnapshot>((r) => { resolver = r; }));
    const tree = await render();

    mockUseAuth.mockReturnValue({ user: null });
    await act(async () => {
      tree.update(
        <WeatherProvider>
          <Probe />
        </WeatherProvider>,
      );
    });
    await act(async () => {
      resolver(snap(17, [alerta()]));
    });

    expect(visto(tree)).toBe('idle|sem-clima|sem-alerta');
  });
});

describe('WeatherProvider: releitura com o app aberto', () => {
  it('relê a cada cinco minutos', async () => {
    const tree = await render();

    getWeather.mockResolvedValue(snap(21));
    await avancar(CINCO_MINUTOS - 1);
    expect(getWeather).toHaveBeenCalledTimes(1);

    await avancar(1);
    expect(getWeather).toHaveBeenCalledTimes(2);
    expect(visto(tree)).toBe('ready|21|sem-alerta');

    await avancar(CINCO_MINUTOS);
    expect(getWeather).toHaveBeenCalledTimes(3);
  });

  it('relê ao voltar para o primeiro plano, e só nessa transição', async () => {
    const tree = await render();
    getWeather.mockResolvedValue(snap(23, [alerta()]));

    await act(async () => {
      aoMudarEstado?.('background');
    });
    expect(getWeather).toHaveBeenCalledTimes(1);

    await act(async () => {
      aoMudarEstado?.('active');
    });
    expect(getWeather).toHaveBeenCalledTimes(2);
    expect(visto(tree)).toBe('ready|23|wx-1');
  });

  // Piscar 'loading' a cada cinco minutos faria as telas trocarem o conteúdo
  // por esqueleto sem motivo: a leitura anterior continua valendo até a nova
  // chegar.
  it('releitura não volta para loading enquanto a resposta não chega', async () => {
    const tree = await render();

    getWeather.mockReturnValue(new Promise<WeatherSnapshot>(() => {}));
    await avancar(CINCO_MINUTOS);

    expect(getWeather).toHaveBeenCalledTimes(2);
    expect(visto(tree)).toBe('ready|17|sem-alerta');
  });

  it('releitura que falha mantém o último clima na tela', async () => {
    getWeather.mockResolvedValue(snap(17, [alerta()]));
    const tree = await render();

    getWeather.mockRejectedValue(new Error('rede caiu'));
    await avancar(CINCO_MINUTOS);

    expect(getWeather).toHaveBeenCalledTimes(2);
    expect(visto(tree)).toBe('ready|17|wx-1');
  });

  it('desmontar para o relógio e solta o ouvinte do AppState', async () => {
    const tree = await render();

    await act(async () => {
      tree.unmount();
    });
    await avancar(CINCO_MINUTOS * 2);

    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(removerOuvinte).toHaveBeenCalledTimes(1);
  });
});

describe('WeatherProvider: alerta que expira', () => {
  // O alerta tem hora para acabar. Passada a hora, ele deixa de valer mesmo
  // que nenhuma leitura nova tenha chegado: senão a janela "Local em Alerta!"
  // ficaria aberta até a próxima releitura dar certo.
  it('deixa de valer na hora do fim, sem snapshot novo', async () => {
    // Acaba em dois minutos, antes da primeira releitura periódica.
    getWeather.mockResolvedValue(snap(17, [alerta({ endsAt: '2026-06-23T12:02:00.000Z' })]));
    const tree = await render();
    expect(visto(tree)).toBe('ready|17|wx-1');

    await avancar(2 * 60 * 1000);
    expect(visto(tree)).toBe('ready|17|wx-1'); // endsAt ainda conta como vigente

    await avancar(1);
    expect(visto(tree)).toBe('ready|17|sem-alerta');
    expect(getWeather).toHaveBeenCalledTimes(1);
  });

  it('quando o de perigo expira, o de atenção que continua vigente assume', async () => {
    getWeather.mockResolvedValue(
      snap(17, [
        alerta({ id: 'sol', kind: 'SOL_INTENSO', severity: 'ATENCAO', event: 'Sol intenso' }),
        alerta({ id: 'tempestade', endsAt: '2026-06-23T12:01:00.000Z' }),
      ]),
    );
    const tree = await render();
    expect(visto(tree)).toBe('ready|17|tempestade');

    await avancar(60 * 1000 + 1);

    expect(visto(tree)).toBe('ready|17|sol');
  });

  it('com a releitura falhando, o alerta velho ainda assim expira', async () => {
    getWeather.mockResolvedValue(snap(17, [alerta({ endsAt: '2026-06-23T12:07:00.000Z' })]));
    const tree = await render();

    getWeather.mockRejectedValue(new Error('rede caiu'));
    await avancar(CINCO_MINUTOS);
    expect(visto(tree)).toBe('ready|17|wx-1');

    await avancar(2 * 60 * 1000 + 1);
    expect(visto(tree)).toBe('ready|17|sem-alerta');
  });
});

describe('useWeather', () => {
  it('fora do provider, avisa em vez de devolver vazio', () => {
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      act(() => {
        create(<Probe />);
      });
    }).toThrow('useWeather must be used inside WeatherProvider');

    erro.mockRestore();
  });
});
