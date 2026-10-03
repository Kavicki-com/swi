import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Input, SwiThemeProvider, TopBar } from '@kavicki/swi-design-system';
import WatchPairing from '../../../../app/(onboarding)/watch/pairing';
import { isFeatureEnabled } from '../../../../lib/featureFlags';
import { completeEnrollment } from '../../../../services/telemetry/deviceEnrollment';
import { useTelemetryUploadState } from '../../../../services/telemetry/TelemetryUploadProvider';

// Tela de pareamento: o funcionário digita os seis dígitos que o administrador
// gerou no painel. Uma tela, dois caminhos: primeiro uso (pulável) e
// Configurações, Monitoramento.

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: { origem?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

jest.mock('../../../../services/telemetry/deviceEnrollment', () => ({
  completeEnrollment: jest.fn(),
}));

jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
}));

const mockGate = isFeatureEnabled as jest.Mock;
const mockConcluir = completeEnrollment as jest.MockedFunction<typeof completeEnrollment>;
const mockEnvio = useTelemetryUploadState as jest.MockedFunction<typeof useTelemetryUploadState>;
const mockRefresh = jest.fn();

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const montadas: ReturnType<typeof create>[] = [];
afterEach(() => {
  while (montadas.length) montadas.pop()!.unmount();
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchPairing />
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

type BotaoProps = { label: string; onPress: () => void; disabled?: boolean };
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

type CampoProps = {
  value: string;
  onChangeText: (t: string) => void;
  description?: string;
  descriptionVariant?: string;
  disabled?: boolean;
};
const campo = (tree: ReturnType<typeof create>) =>
  tree.root.findByType(Input as React.ComponentType<CampoProps>);

const digitar = async (tree: ReturnType<typeof create>, valor: string) => {
  await act(async () => {
    campo(tree).props.onChangeText(valor);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockGate.mockReturnValue(true);
  mockEnvio.mockReturnValue({ paired: false, lastOutcome: null, refreshPairing: mockRefresh });
  mockConcluir.mockResolvedValue({ paired: true });
});

describe('pareamento: digitar o código', () => {
  it('só aceita dígitos e no máximo seis', async () => {
    const tree = await render();
    await digitar(tree, '48a2-91077');
    expect(campo(tree).props.value).toBe('482910');
  });

  it('Parear fica desligado até haver seis dígitos', async () => {
    const tree = await render();
    expect(botao(tree, 'Parear')!.props.disabled).toBe(true);
    await digitar(tree, '48291');
    expect(botao(tree, 'Parear')!.props.disabled).toBe(true);
    await digitar(tree, '482910');
    expect(botao(tree, 'Parear')!.props.disabled).toBe(false);
  });

  it('envia os seis dígitos ao serviço de pareamento', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(mockConcluir).toHaveBeenCalledTimes(1);
    expect(mockConcluir).toHaveBeenCalledWith('482910');
  });

  it('enquanto o servidor responde, o botão e o campo ficam desligados', async () => {
    let resolver!: (r: { paired: true }) => void;
    mockConcluir.mockReturnValue(new Promise((r) => (resolver = r)));
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(botao(tree, 'Pareando…')!.props.disabled).toBe(true);
    expect(campo(tree).props.disabled).toBe(true);
    await act(async () => {
      resolver({ paired: true });
    });
  });
});

// O teclado numérico do iOS não tem tecla de confirmar: se o botão Parear
// ficasse embaixo dele, o funcionário digitaria o código sem ter onde tocar.
// Os dublês do teclado são View e ScrollView, então o que se confere são as
// props que só os componentes de teclado recebem.
describe('pareamento: teclado', () => {
  it('o conteúdo rola acima do teclado', async () => {
    const tree = await render();
    const rolagem = tree.root.findAll((n) => n.props.bottomOffset !== undefined);
    expect(rolagem.length).toBeGreaterThan(0);
    expect(rolagem[0]!.findAllByType(Input)).toHaveLength(1);
  });

  it('o botão Parear acompanha o teclado', async () => {
    const tree = await render();
    const fixo = tree.root.findAll((n) => n.props.offset !== undefined);
    expect(fixo.length).toBeGreaterThan(0);
    const labels = fixo[0]!
      .findAllByType(Button as React.ComponentType<BotaoProps>)
      .map((b) => b.props.label);
    expect(labels).toContain('Parear');
  });
});

describe('pareamento: recusas', () => {
  it.each([
    ['expired', 'Este código expirou. Peça um novo ao administrador.'],
    [
      'already_used',
      'Este código já foi usado. Se este aparelho já está pareado, não é preciso repetir.',
    ],
    ['invalid_code', 'Código não confere. Confira os seis dígitos com o administrador.'],
    ['unsupported_device', 'Este aparelho não pode ser pareado.'],
  ] as const)('%s mostra a frase certa no campo, como erro', async (reason, frase) => {
    mockConcluir.mockResolvedValue({ paired: false, reason });
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(campo(tree).props.description).toBe(frase);
    expect(campo(tree).props.descriptionVariant).toBe('error');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('corrigir o código limpa a recusa anterior', async () => {
    mockConcluir.mockResolvedValue({ paired: false, reason: 'invalid_code' });
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    await digitar(tree, '48291');
    expect(campo(tree).props.description).toBeUndefined();
  });
});

describe('pareamento: concluído', () => {
  it('avisa o envio, mostra o aparelho pareado e some com o campo', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(texto(tree)).toContain('Aparelho pareado');
    expect(tree.root.findAllByType(Input)).toHaveLength(0);
  });

  it('quem já chega pareado vê o estado pareado, sem campo', async () => {
    mockEnvio.mockReturnValue({ paired: true, lastOutcome: null, refreshPairing: mockRefresh });
    const tree = await render();
    expect(texto(tree)).toContain('Aparelho pareado');
    expect(tree.root.findAllByType(Input)).toHaveLength(0);
  });
});

describe('pareamento: primeiro uso', () => {
  it('Parear depois segue para o fim do primeiro uso, sem parear', async () => {
    const tree = await render();
    await tocar(tree, 'Parear depois');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
    expect(mockConcluir).not.toHaveBeenCalled();
  });

  it('depois de parear, Continuar segue para o fim do primeiro uso', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    await tocar(tree, 'Continuar');
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });

  it('não tem barra de voltar', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(TopBar)).toHaveLength(0);
  });
});

describe('pareamento: vindo de Configurações', () => {
  beforeEach(() => {
    mockParams = { origem: 'configuracoes' };
  });

  it('tem voltar e não oferece Parear depois', async () => {
    const tree = await render();
    expect(tree.root.findAllByType(TopBar)).toHaveLength(1);
    expect(botao(tree, 'Parear depois')).toBeUndefined();
  });

  it('depois de parear, Continuar volta para o Monitoramento', async () => {
    const tree = await render();
    await digitar(tree, '482910');
    await tocar(tree, 'Parear');
    await tocar(tree, 'Continuar');
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('pareamento: fora do piloto', () => {
  // Android e builds sem o módulo nativo não têm como guardar a credencial.
  it('não mostra a tela de código', async () => {
    mockGate.mockReturnValue(false);
    const tree = await render();
    expect(mockGate).toHaveBeenCalledWith('appleWatchPilot');
    expect(tree.root.findAllByType(Input)).toHaveLength(0);
  });
});
