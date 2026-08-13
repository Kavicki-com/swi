import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { ActiveAlertModal } from './ActiveAlertModal';
import { useWeather } from '../../services/weather/WeatherProvider';

// Figma 385:29591. O procedimento de evacuação, apresentado como modal sobre a
// tela de notificações. É tela de SEGURANÇA: ela não pode quebrar nem ficar em
// branco, aconteça o que acontecer com o clima.
//
// Nada aqui dentro era exercitado. O componente em si contava como coberto
// porque as telas que o montam o fazem com `visible={false}`, e o Modal do RN
// não renderiza os filhos quando está fechado: a função roda, o conteúdo não.

jest.mock('../../services/weather/WeatherProvider', () => ({ useWeather: jest.fn() }));

const mockPush = jest.fn();
const mockRouter = { push: mockPush, back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockUseWeather = useWeather as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SNAPSHOT = {
  current: { tempC: 22.4, condition: 'storm', humidityPct: 88, windKmh: 47.6 },
  daily: { maxC: 27, minC: 15 },
  alerts: [],
};

const ALERTA = { description: 'Tempestade severa a caminho, procure abrigo.' };

let onClose: jest.Mock;

const render = async (visible = true) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ActiveAlertModal visible={visible} onClose={onClose} />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const texto = (tree: ReturnType<typeof create>) => JSON.stringify(tree.toJSON());

const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

const fundo = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) =>
      n.props?.accessibilityLabel === 'Fechar alerta atual' &&
      typeof n.props?.onPress === 'function',
  )[0];

// O cartão branco por dentro do backdrop. Ele se identifica pelo teto de
// largura, que é o único no arquivo.
const cartao = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => {
      const s = StyleSheet.flatten(n.props?.style) as { maxWidth?: number } | undefined;
      return typeof n.props?.onPress === 'function' && s?.maxWidth === 360;
    },
    { deep: false },
  )[0];

const tocar = async (no: ReactTestInstance) => {
  await act(async () => {
    no.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  onClose = jest.fn();
  mockUseWeather.mockReturnValue({ snapshot: SNAPSHOT, activeAlert: ALERTA });
});

describe('ActiveAlertModal, abrir e fechar', () => {
  it('fechado não desenha o procedimento', async () => {
    const tree = await render(false);

    expect(texto(tree)).not.toContain('Procedimento de evacuação');
  });

  it('aberto mostra o procedimento', async () => {
    const tree = await render();

    expect(texto(tree)).toContain('Procedimento de evacuação');
  });

  it('tocar fora fecha o alerta', async () => {
    const tree = await render();

    await tocar(fundo(tree));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // O Pressable de dentro existe só pra absorver o toque. Sem ele, ler o
  // procedimento fecharia o modal no primeiro encostar de dedo.
  it('tocar dentro do cartão não fecha nada', async () => {
    const tree = await render();

    await tocar(cartao(tree));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('o botão de confirmação fecha sem navegar pra lugar nenhum', async () => {
    const tree = await render();

    await tocar(botao(tree, 'Entendi, estou seguindo as instruções'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('ActiveAlertModal, o clima que ele mostra', () => {
  it('mostra o clima que veio do provider, arredondado', async () => {
    const tree = await render();

    const t = texto(tree);
    expect(t).toContain('22ºC');
    expect(t).toContain('Tempestade');
    expect(t).toContain('88%');
    expect(t).toContain('48km/h');
    expect(t).toContain('27ºC');
    expect(t).toContain('15ºC');
    expect(t).toContain('Tempestade severa a caminho, procure abrigo.');
  });

  // Tela de segurança não pode ficar em branco: sem snapshot e sem alerta ela
  // cai no texto estático em vez de mostrar buraco ou quebrar.
  it('sem clima nenhum, ainda abre inteiro com o texto padrão', async () => {
    mockUseWeather.mockReturnValue({ snapshot: null, activeAlert: null });

    const tree = await render();

    const t = texto(tree);
    expect(t).toContain('Procedimento de evacuação');
    expect(t).toContain('17ºC');
    expect(t).toContain('Chuva Intensa');
    expect(t).toContain('Risco de desabamentos');
  });
});

describe('ActiveAlertModal, as duas ações que levam pra outra tela', () => {
  // Fechar ANTES de navegar é o ponto: o modal ficaria por cima do destino se
  // a ordem se invertesse, e a pessoa chegaria na rota de evacuação com o
  // alerta cobrindo a tela.
  it('Traçar rota fecha o modal antes de abrir a evacuação', async () => {
    const tree = await render();

    await tocar(botao(tree, 'Traçar rota'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(app)/evacuation');
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0],
    );
  });

  it('Reportar acidente fecha o modal antes de abrir o novo relatório', async () => {
    const tree = await render();

    await tocar(botao(tree, 'Reportar acidente'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(app)/reports/new');
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0],
    );
  });
});
