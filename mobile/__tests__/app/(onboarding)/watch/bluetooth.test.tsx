import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Button, StatusTag, StepBar, SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchBluetooth from '../../../../app/(onboarding)/watch/bluetooth';
import { isFeatureEnabled, type FeatureGate } from '../../../../lib/featureFlags';
import {
  useBandChoice,
  type BandChoice,
} from '../../../../services/telemetry/bluetooth/bluetoothBandChoice';

// Última etapa do primeiro uso no Android (ADR-0013): a pulseira por
// Bluetooth, o acréscimo do batimento ao vivo, marcada como opcional. Aqui
// moram os avisos da ADR-0010: transmitir gasta bateria e, em algumas
// marcas, disputa a conexão com o app do fabricante.

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

// A seção da pulseira tem teste próprio (BluetoothHeartRateMonitoring.test.tsx);
// aqui, só se ela aparece.
const mockSecaoBluetooth = jest.fn((_props: object) => null);
jest.mock('../../../../components/telemetry/BluetoothHeartRateMonitoring', () => ({
  BluetoothHeartRateMonitoring: (props: object) => mockSecaoBluetooth(props),
}));

jest.mock('../../../../services/telemetry/bluetooth/bluetoothBandChoice', () => ({
  ...jest.requireActual('../../../../services/telemetry/bluetooth/bluetoothBandChoice'),
  useBandChoice: jest.fn(),
}));

const mockGate = isFeatureEnabled as jest.Mock;
const mockEscolha = useBandChoice as jest.MockedFunction<typeof useBandChoice>;
const mockRedirect = Redirect as unknown as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const comGates = (...ligados: FeatureGate[]) =>
  mockGate.mockImplementation((gate: FeatureGate) => ligados.includes(gate));

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const montadas: ReturnType<typeof create>[] = [];
afterEach(async () => {
  await act(async () => {
    while (montadas.length) montadas.pop()!.unmount();
  });
  naPlataforma(originalOS);
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchBluetooth />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  montadas.push(tree);
  return tree;
};

const texto = (tree: ReturnType<typeof create>): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

type BotaoProps = { label: string; onPress: () => void };
const botoes = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoProps>);
const botao = (tree: ReturnType<typeof create>, label: string) =>
  botoes(tree).find((b) => b.props.label === label);
const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  const alvo = botao(tree, label);
  if (!alvo) {
    throw new Error(
      `Botão "${label}" não existe. Há: ${botoes(tree)
        .map((b) => b.props.label)
        .join(', ')}`,
    );
  }
  await act(async () => {
    alvo.props.onPress();
  });
};

type TagProps = { label?: string; status?: string };
const tags = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(StatusTag as React.ComponentType<TagProps>)
    .map((t) => ({ label: t.props.label, status: t.props.status }));

const ESCOLHIDA: BandChoice = { deviceId: 'AA:BB:CC:DD:EE:FF', name: 'Polar H10' };

beforeEach(() => {
  jest.clearAllMocks();
  naPlataforma('android');
  comGates('watchOnboarding', 'healthConnect', 'bluetoothHeartRate');
  mockEscolha.mockReturnValue(null);
});

describe('primeiro uso, pulseira por Bluetooth', () => {
  it('é a terceira e última etapa, depois do Health Connect', async () => {
    const tree = await render();
    expect(tree.root.findByType(StepBar).props).toMatchObject({ total: 3, current: 3 });
  });

  it('é marcada como opcional', async () => {
    const tree = await render();
    expect(tags(tree)).toContainEqual({ label: 'Opcional', status: 'info' });
  });

  it('diz que depende de o modelo permitir', async () => {
    const tree = await render();
    expect(texto(tree)).toContain('só se o modelo permitir');
  });

  // A consequência da ADR-0010 que ficou com o primeiro uso.
  it('avisa da bateria e da disputa com o app do fabricante', async () => {
    const tree = await render();
    expect(texto(tree)).toContain('gasta mais a bateria da pulseira');
    expect(texto(tree)).toContain('disputa a conexão da pulseira com o app do fabricante');
  });

  it('mostra a escolha da pulseira', async () => {
    await render();
    expect(mockSecaoBluetooth).toHaveBeenCalled();
  });

  it('só o batimento chega por aqui: passos e movimento vêm do Health Connect', async () => {
    const tree = await render();
    expect(texto(tree)).toContain('Passos e movimento continuam vindo do Health Connect');
    expect(texto(tree)).not.toMatch(/(movimento|passos)[^.]*ao vivo/i);
  });

  it('sem pulseira escolhida, Configurar depois vai ao fim sem escolher nada', async () => {
    const tree = await render();
    expect(botao(tree, 'Continuar')).toBeUndefined();
    await tocar(tree, 'Configurar depois');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });

  it('com a pulseira escolhida, Continuar vai ao fim', async () => {
    mockEscolha.mockReturnValue(ESCOLHIDA);
    const tree = await render();
    expect(botao(tree, 'Configurar depois')).toBeUndefined();
    await tocar(tree, 'Continuar');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });
});

describe('primeiro uso, pulseira por Bluetooth: fora do caminho', () => {
  it('sem o gate do Bluetooth, vai ao fim sem mostrar a escolha', async () => {
    comGates('watchOnboarding', 'healthConnect');
    await render();
    expect(mockRedirect.mock.calls[0]![0]).toEqual({ href: '/(onboarding)/watch/complete' });
    expect(mockSecaoBluetooth).not.toHaveBeenCalled();
  });

  it('no iPhone, vai ao fim sem mostrar a escolha', async () => {
    naPlataforma('ios');
    comGates('watchOnboarding', 'appleWatchPilot', 'bluetoothHeartRate');
    await render();
    expect(mockRedirect.mock.calls[0]![0]).toEqual({ href: '/(onboarding)/watch/complete' });
    expect(mockSecaoBluetooth).not.toHaveBeenCalled();
  });

  it('atrás do portão do primeiro uso', async () => {
    comGates('bluetoothHeartRate');
    await render();
    expect(mockGate).toHaveBeenCalledWith('watchOnboarding');
    expect(mockSecaoBluetooth).not.toHaveBeenCalled();
  });
});
