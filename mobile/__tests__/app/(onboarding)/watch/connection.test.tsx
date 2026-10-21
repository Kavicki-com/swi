import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Button, SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchConnection from '../../../../app/(onboarding)/watch/connection';
import { isFeatureEnabled, type FeatureGate } from '../../../../lib/featureFlags';
import {
  activateMonitoring,
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../../services/telemetry/watchDiagnostics';
import { useTelemetryUploadState } from '../../../../services/telemetry/TelemetryUploadProvider';

// Primeira tela do primeiro uso: explica o que vai ser lido e oferece as duas
// acoes do ADR-0003 juntas, autorizar e ativar, num botao so.

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(),
  activateMonitoring: jest.fn(),
}));

jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
}));

const mockEnvio = useTelemetryUploadState as jest.Mock;
const envio = (paired: boolean) => mockEnvio.mockReturnValue({ paired });

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const comGates = (...ligados: FeatureGate[]) =>
  mockGate.mockImplementation((gate: FeatureGate) => ligados.includes(gate));

const mockGate = isFeatureEnabled as jest.Mock;
const mockEstado = useWatchDiagnostics as jest.MockedFunction<typeof useWatchDiagnostics>;
const mockAtivar = activateMonitoring as jest.MockedFunction<typeof activateMonitoring>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SEM_SUPORTE: WatchDiagnosticsState = { support: 'unsupported' };
const PRONTO: WatchDiagnosticsState = {
  support: 'ready',
  session: 'none',
  watchProtocol: null,
  sessionChangedAt: null,
  lastSample: null,
};

// As telas mantem um relogio vivo (useNow) para a atualidade envelhecer sem
// evento novo. Arvore nao desmontada deixa esse intervalo rodando depois do
// teste, o que o Jest reporta como log fora de hora.
const montadas: ReturnType<typeof create>[] = [];

afterEach(() => {
  while (montadas.length) montadas.pop()!.unmount();
  naPlataforma(originalOS);
});

const render = async (estado: WatchDiagnosticsState) => {
  mockEstado.mockReturnValue(estado);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchConnection />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  montadas.push(tree);
  return tree;
};

// So texto renderizado, em qualquer profundidade. Serializar a arvore inteira
// arrastaria caminhos de asset (o fundo ainda se chama smartband-bg-pattern) e
// faria a asserticao de copy falhar por um motivo que nao e copy.
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

const botoes = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Button as React.ComponentType<{ label: string; onPress: () => void }>);

const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  const alvo = botoes(tree).find((b) => b.props.label === label);
  if (!alvo) throw new Error(`Botao "${label}" nao existe. Ha: ${botoes(tree).map((b) => b.props.label).join(', ')}`);
  await act(async () => {
    alvo.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockReturnValue(true);
  mockAtivar.mockResolvedValue(true);
  envio(false);
});

const redirecionamentos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(Redirect as React.ComponentType<{ href: string }>)
    .map((r) => r.props.href);

describe('primeiro uso, tela de conexao', () => {
  it('atras do portao do primeiro uso, como o resto do fluxo', async () => {
    mockGate.mockReturnValue(false);
    const tree = await render(PRONTO);
    expect(mockGate).toHaveBeenCalledWith('watchOnboarding');
    expect(texto(tree)).toContain('Disponível na versão final');
  });

  it('diz quais leituras o SWI vai fazer, antes de qualquer folha do sistema', async () => {
    const tree = await render(PRONTO);
    const t = texto(tree);
    expect(t).toContain('Apple Watch');
    expect(t).toContain('batimentos');
    expect(t).toContain('passos');
    expect(t).toContain('energia ativa');
    expect(mockAtivar).not.toHaveBeenCalled();
  });

  it('instrui o que fazer antes de tocar o botao', async () => {
    const t = texto(await render(PRONTO));
    expect(t).toContain('pulso');
    expect(t).toContain('Saúde');
  });

  it('nunca chama o aparelho de smartband', async () => {
    const tree = await render(PRONTO);
    expect(texto(tree).toLowerCase()).not.toContain('smartband');
  });

  it('conceder e ativar autoriza, ativa e segue para a espera', async () => {
    const tree = await render(PRONTO);
    await tocar(tree, 'Conceder e ativar');
    expect(mockAtivar).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(onboarding)/watch/connection-start');
  });

  // O funcionario que ainda nao pareou o relogio nao pode ficar preso no
  // cadastro. Pular tambem preserva a unica pergunta que o sistema faz.
  it('configurar depois pula a folha e vai direto ao fim do primeiro uso', async () => {
    const tree = await render(PRONTO);
    await tocar(tree, 'Configurar depois');
    expect(mockAtivar).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });

  it('falha ao ativar nao trava a tela: segue para a espera do mesmo jeito', async () => {
    mockAtivar.mockResolvedValue(false);
    const tree = await render(PRONTO);
    await tocar(tree, 'Conceder e ativar');
    expect(mockPush).toHaveBeenCalledWith('/(onboarding)/watch/connection-start');
  });

  it('sem suporte explica o motivo real e oferece so continuar', async () => {
    const tree = await render(SEM_SUPORTE);
    const t = texto(tree);
    expect(t).toContain('iPhone e Apple Watch');
    // CONTEXT.md: "indisponivel" nomeia o estado COM suporte e sem leitura.
    expect(t).not.toMatch(/indisponível/i);
    expect(botoes(tree).map((b) => b.props.label)).toEqual(['Continuar']);
    await tocar(tree, 'Continuar');
    expect(mockAtivar).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/watch/complete');
  });
});

// No Android com o Health Connect o monitoramento vem da pulseira, nao do
// relogio: o controle do relogio responde "sem suporte" ali, e o primeiro uso
// dizia que o aparelho nao monitora. A entrada agora leva ao pareamento, que
// tem o passo do Health Connect e a saida "Parear depois".
describe('primeiro uso, tela de conexao: Android com o Health Connect', () => {
  beforeEach(() => {
    naPlataforma('android');
    comGates('watchOnboarding', 'healthConnect');
  });

  it('sem pareamento, vai ao pareamento em vez de dizer que o aparelho nao monitora', async () => {
    const tree = await render(SEM_SUPORTE);
    expect(redirecionamentos(tree)).toEqual(['/(onboarding)/watch/pairing']);
    expect(texto(tree)).not.toContain('não faz o monitoramento');
    expect(texto(tree)).not.toMatch(/iPhone|Apple Watch/);
    expect(mockAtivar).not.toHaveBeenCalled();
  });

  it('ja pareado, vai direto ao fim do primeiro uso', async () => {
    envio(true);
    const tree = await render(SEM_SUPORTE);
    expect(redirecionamentos(tree)).toEqual(['/(onboarding)/watch/complete']);
  });

  it('sem o gate do Health Connect, o Android segue como antes', async () => {
    comGates('watchOnboarding');
    const tree = await render(SEM_SUPORTE);
    expect(redirecionamentos(tree)).toEqual([]);
    expect(texto(tree)).toContain('não faz o monitoramento');
  });

  // O gate so existe no Android compilado, mas e a plataforma que decide: um
  // iPhone nunca troca o relogio pela pulseira.
  it('no iOS, mesmo com o gate ligado, a tela do relogio continua', async () => {
    naPlataforma('ios');
    const tree = await render(PRONTO);
    expect(redirecionamentos(tree)).toEqual([]);
    expect(texto(tree)).toContain('Apple Watch');
  });
});
