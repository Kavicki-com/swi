import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { WeatherAlertModal } from './WeatherAlertModal';
import { useWeather } from '../../services/weather/WeatherProvider';

// Janela "Local em Alerta!". Ela afirma que há alerta, então tudo o que mostra
// tem que sair do alerta e da leitura que o provider entrega: o nível, a
// descrição e as medições. Nada de texto ou número de reserva.

jest.mock('../../services/weather/WeatherProvider', () => ({ useWeather: jest.fn() }));

const mockUseWeather = useWeather as jest.Mock;

const SNAPSHOT = {
  current: { tempC: 22.4, condition: 'rain', humidityPct: 88, windKmh: 47.6 },
  daily: { maxC: 27, minC: 15 },
  alerts: [],
  fetchedAt: '2026-06-23T12:00:00.000Z',
};

const alerta = (over: Record<string, unknown> = {}) => ({
  id: 'wx-1',
  kind: 'TEMPESTADE',
  severity: 'PERIGO',
  event: 'Tempestade',
  description: 'Raios e rajadas fortes na próxima hora.',
  startsAt: '2026-06-23T11:00:00.000Z',
  endsAt: '2026-06-23T18:00:00.000Z',
  ...over,
});

let onPrimaryAction: jest.Mock;

const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        <WeatherAlertModal onClose={jest.fn()} onPrimaryAction={onPrimaryAction} />
      </SwiThemeProvider>,
    );
  });
  return tree;
};

// Só o que a pessoa lê: os filhos de texto, sem rótulo de acessibilidade nem
// prop de estilo no meio.
const textos = (tree: ReactTestRenderer): string[] => {
  const pedacos: string[] = [];
  tree.root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === 'string') pedacos.push(c);
  });
  return Array.from(new Set(pedacos));
};

beforeEach(() => {
  onPrimaryAction = jest.fn();
  mockUseWeather.mockReturnValue({ snapshot: SNAPSHOT, activeAlert: alerta() });
});

describe('WeatherAlertModal: nível do alerta', () => {
  it('mostra o nível logo abaixo do título', async () => {
    const lidos = textos(await render());

    expect(lidos).toContain('Local em Alerta!');
    expect(lidos).toContain('Tempestade: perigo');
    expect(lidos.indexOf('Tempestade: perigo')).toBe(lidos.indexOf('Local em Alerta!') + 1);
  });

  it('atenção sai por extenso, com acento', async () => {
    mockUseWeather.mockReturnValue({
      snapshot: SNAPSHOT,
      activeAlert: alerta({ kind: 'SOL_INTENSO', severity: 'ATENCAO', event: 'Sol intenso' }),
    });

    expect(textos(await render())).toContain('Sol intenso: atenção');
  });

  // Backend antigo e mock podem não mandar severity.
  it('sem severity, a linha traz só o evento', async () => {
    mockUseWeather.mockReturnValue({
      snapshot: SNAPSHOT,
      activeAlert: alerta({ severity: undefined, event: 'Sol intenso' }),
    });

    const lidos = textos(await render());

    expect(lidos).toContain('Sol intenso');
    expect(lidos.some((t) => t.includes(':'))).toBe(false);
  });
});

describe('WeatherAlertModal: o que vem do alerta e da leitura', () => {
  it('mostra a descrição do alerta e as medições arredondadas', async () => {
    const lidos = textos(await render());

    expect(lidos).toContain('Raios e rajadas fortes na próxima hora.');
    expect(lidos).toEqual(expect.arrayContaining(['22ºC', 'Chuva Intensa', '88%', '48km/h', '27ºC', '15ºC']));
  });

  it('leitura indisponível não vira medição, e o alerta continua na tela', async () => {
    mockUseWeather.mockReturnValue({
      snapshot: { ...SNAPSHOT, unavailable: true },
      activeAlert: alerta(),
    });

    const lidos = textos(await render());

    expect(lidos).toContain('--');
    expect(lidos).not.toContain('22ºC');
    expect(lidos).toContain('Tempestade: perigo');
  });

  // Quem monta a janela só o faz com alerta vigente. Se ainda assim ela for
  // desenhada sem alerta, não aparece nível nem parágrafo inventado.
  it('sem alerta, não desenha nível nem descrição', async () => {
    mockUseWeather.mockReturnValue({ snapshot: null, activeAlert: null });

    const lidos = textos(await render());

    expect(lidos).toEqual(['Local em Alerta!', '--', 'Instruções de segurança']);
  });
});

describe('WeatherAlertModal: ação', () => {
  it('o botão leva às instruções de segurança', async () => {
    const tree = await render();

    const botao = tree.root.findAll(
      (n) => n.props?.label === 'Instruções de segurança' && typeof n.props?.onPress === 'function',
    )[0];
    await act(async () => {
      botao.props.onPress();
    });

    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });
});
