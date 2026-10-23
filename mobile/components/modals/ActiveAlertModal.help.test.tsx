import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, Toast, WeatherIcon } from '@kavicki/swi-design-system';
import { ActiveAlertModal } from './ActiveAlertModal';
import { useWeather } from '../../services/weather/WeatherProvider';
import { useHelpRequest, type HelpRequestState } from '../../services/help/HelpRequestProvider';
import { HELP_COPY } from '../../services/help/helpCopy';
import type { HelpRequestView } from '../../services/help/types';

// O procedimento depois do pedido de ajuda: o tempo do passo "Espere pelo
// veículo de resgate" é o do socorrista despachado (sem ele, a linha some), a
// imagem segue o clima lido (antes era sempre chuva), e uma faixa diz em que
// pé o pedido está, com nova tentativa quando ele não saiu.

jest.mock('../../services/weather/WeatherProvider', () => ({ useWeather: jest.fn() }));
jest.mock('../../services/help/HelpRequestProvider', () => ({ useHelpRequest: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

const mockUseWeather = useWeather as jest.Mock;
const mockUseHelpRequest = useHelpRequest as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const leitura = (condition: string, over: Record<string, unknown> = {}) => ({
  current: { tempC: 22, condition, humidityPct: 80, windKmh: 30 },
  daily: { maxC: 27, minC: 15 },
  alerts: [],
  ...over,
});

const ABERTO: HelpRequestView = {
  id: 'h1',
  status: 'OPEN',
  createdAt: '2026-10-22T12:00:00.000Z',
  attendedAt: null,
  closedAt: null,
  rescue: null,
};

const requestHelp = jest.fn();
const ajuda = (over: Partial<HelpRequestState> = {}): HelpRequestState => ({
  helpRequest: null,
  sending: false,
  failed: false,
  rescuerEtaMin: null,
  requestHelp,
  ...over,
});

const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ActiveAlertModal visible onClose={jest.fn()} />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const texto = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const faixas = (tree: ReactTestRenderer) => tree.root.findAllByType(Toast);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWeather.mockReturnValue({ snapshot: leitura('storm'), activeAlert: null });
  mockUseHelpRequest.mockReturnValue(ajuda());
});

describe('ActiveAlertModal, tempo do socorrista', () => {
  it('socorrista despachado: o tempo estimado no passo de esperar o resgate', async () => {
    mockUseHelpRequest.mockReturnValue(ajuda({ helpRequest: ABERTO, rescuerEtaMin: 7 }));

    const t = texto(await render());

    expect(t).toContain('Espere pelo veículo de resgate');
    expect(t).toContain('Aprox. 7 minutos');
  });

  it('sem estimativa: o passo fica e a linha do tempo some, sem número fixo', async () => {
    const t = texto(await render());

    expect(t).toContain('Espere pelo veículo de resgate');
    expect(t).not.toContain('Aprox.');
  });
});

describe('ActiveAlertModal, imagem do clima', () => {
  it.each([
    ['clear', 'sunny'],
    ['rain', 'rainy'],
    ['storm', 'storm'],
  ])('%s desenha %s', async (condicao, imagem) => {
    mockUseWeather.mockReturnValue({ snapshot: leitura(condicao), activeAlert: null });

    const [icone] = (await render()).root.findAllByType(WeatherIcon);

    expect(icone.props.condition).toBe(imagem);
  });

  it('o rótulo de acessibilidade é a condição lida', async () => {
    mockUseWeather.mockReturnValue({ snapshot: leitura('clear'), activeAlert: null });

    const [icone] = (await render()).root.findAllByType(WeatherIcon);

    expect(icone.props.accessibilityLabel).toBe('Céu limpo');
  });

  it.each([
    ['sem leitura', null],
    ['leitura indisponível', leitura('rain', { unavailable: true })],
  ])('%s: nenhuma imagem, nem a chuva de antes', async (_caso, snapshot) => {
    mockUseWeather.mockReturnValue({ snapshot, activeAlert: null });

    const tree = await render();

    expect(tree.root.findAllByType(WeatherIcon)).toHaveLength(0);
    expect(texto(tree)).not.toContain('Chuva intensa');
  });
});

describe('ActiveAlertModal, estado do pedido de ajuda', () => {
  it('sem pedido: nenhuma faixa, e o fechamento do Figma fica', async () => {
    const tree = await render();

    expect(faixas(tree)).toHaveLength(0);
    expect(texto(tree)).toContain('Mantenha-se calmo. Estamos à caminho.');
  });

  it('enviando', async () => {
    mockUseHelpRequest.mockReturnValue(ajuda({ sending: true }));

    const [faixa] = faixas(await render());

    expect(faixa.props.variant).toBe('info');
    expect(faixa.props.title).toBe(HELP_COPY.sending);
    expect(faixa.props.action).toBeUndefined();
  });

  it('enviado', async () => {
    mockUseHelpRequest.mockReturnValue(ajuda({ helpRequest: ABERTO }));

    const [faixa] = faixas(await render());

    expect(faixa.props.variant).toBe('success');
    expect(faixa.props.title).toBe(HELP_COPY.sent);
  });

  // "Estamos à caminho" com o pedido parado no aparelho seria mentir para
  // quem está em perigo: a frase sai, e a faixa oferece a nova tentativa.
  it('não saiu: erro com nova tentativa, sem prometer que alguém está a caminho', async () => {
    mockUseHelpRequest.mockReturnValue(ajuda({ failed: true }));

    const tree = await render();
    const [faixa] = faixas(tree);

    expect(faixa.props.variant).toBe('error');
    expect(faixa.props.title).toBe(HELP_COPY.failed);
    expect(faixa.props.action.label).toBe(HELP_COPY.retry);
    expect(texto(tree)).not.toContain('Estamos à caminho');

    await act(async () => {
      faixa.props.action.onPress();
    });
    expect(requestHelp).toHaveBeenCalledTimes(1);
  });

  it('a faixa não tem fechar: o estado do pedido não some por engano', async () => {
    mockUseHelpRequest.mockReturnValue(ajuda({ failed: true }));

    const [faixa] = faixas(await render());

    expect(faixa.props.onClose).toBeUndefined();
  });
});
