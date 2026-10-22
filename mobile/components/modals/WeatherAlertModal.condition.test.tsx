import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SwiThemeProvider, WeatherIcon } from '@kavicki/swi-design-system';
import { WeatherAlertModal } from './WeatherAlertModal';
import { useWeather } from '../../services/weather/WeatherProvider';

// Janela "Local em Alerta!": a imagem do cartão segue a condição lida (antes
// era sempre chuva), e o botão "Ver mapa do clima" leva ao radar.

jest.mock('../../services/weather/WeatherProvider', () => ({ useWeather: jest.fn() }));
const mockUseWeather = useWeather as jest.Mock;

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

const ALERTA = {
  id: 'wx-1',
  severity: 'PERIGO',
  event: 'Tempestade',
  description: 'Raios e rajadas fortes.',
  startsAt: '2026-06-23T11:00:00.000Z',
  endsAt: '2026-06-23T18:00:00.000Z',
};

const leitura = (condition: string, over: Record<string, unknown> = {}) => ({
  current: { tempC: 22, condition, humidityPct: 80, windKmh: 30 },
  daily: { maxC: 27, minC: 15 },
  alerts: [],
  fetchedAt: '2026-06-23T12:00:00.000Z',
  ...over,
});

let onClose: jest.Mock;

const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        <WeatherAlertModal onClose={onClose} onPrimaryAction={jest.fn()} />
      </SwiThemeProvider>,
    );
  });
  return tree;
};

const icones = (tree: ReactTestRenderer) => tree.root.findAllByType(WeatherIcon);

beforeEach(() => {
  jest.clearAllMocks();
  onClose = jest.fn();
});

describe('WeatherAlertModal: imagem da condição do clima', () => {
  // O mesmo agrupamento da tira de previsão do painel: o DS desenha sol,
  // nuvem, chuva e tempestade; névoa cai em nuvem e neve em chuva.
  it.each([
    ['clear', 'sunny'],
    ['clouds', 'partly-cloudy'],
    ['fog', 'partly-cloudy'],
    ['rain', 'rainy'],
    ['snow', 'rainy'],
    ['storm', 'storm'],
  ])('%s desenha %s', async (condicao, imagem) => {
    mockUseWeather.mockReturnValue({ snapshot: leitura(condicao), activeAlert: ALERTA });

    const [icone] = icones(await render());

    expect(icone.props.condition).toBe(imagem);
  });

  it('o rótulo de acessibilidade é a condição lida', async () => {
    mockUseWeather.mockReturnValue({ snapshot: leitura('clear'), activeAlert: ALERTA });

    expect(icones(await render())[0].props.accessibilityLabel).toBe('Céu limpo');
  });

  // Sem leitura não há condição para desenhar: nada de chuva de reserva.
  it.each([
    ['sem leitura', null],
    ['leitura indisponível', leitura('rain', { unavailable: true })],
  ])('%s não desenha imagem', async (_caso, snapshot) => {
    mockUseWeather.mockReturnValue({ snapshot, activeAlert: ALERTA });

    expect(icones(await render())).toHaveLength(0);
  });
});

describe('WeatherAlertModal: Ver mapa do clima', () => {
  const botao = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

  it('fica abaixo de "Instruções de segurança"', async () => {
    mockUseWeather.mockReturnValue({ snapshot: leitura('storm'), activeAlert: ALERTA });
    const tree = await render();

    const rotulos = tree.root
      .findAll((n) => typeof n.props?.label === 'string' && typeof n.props?.onPress === 'function')
      .map((n) => n.props.label as string);
    const unicos = rotulos.filter((r, i) => rotulos.indexOf(r) === i);

    expect(unicos).toEqual(['Instruções de segurança', 'Ver mapa do clima']);
  });

  it('fecha a janela e abre o mapa do clima', async () => {
    mockUseWeather.mockReturnValue({ snapshot: leitura('storm'), activeAlert: ALERTA });
    const tree = await render();

    await act(async () => { botao(tree, 'Ver mapa do clima').props.onPress(); });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(app)/map-weather');
  });
});
