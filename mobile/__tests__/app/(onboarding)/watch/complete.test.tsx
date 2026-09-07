import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchComplete from '../../../../app/(onboarding)/watch/complete';
import { isFeatureEnabled } from '../../../../lib/featureFlags';
import {
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../../services/telemetry/watchDiagnostics';
import { markWatchOnboardingComplete } from '../../../../services/telemetry/watchOnboarding';

// Ultima tela do primeiro uso. Tres estados: leitura real, sessao ativa sem
// leitura ainda, e nada. Nenhum deles impede entrar no app (ADR-0004).

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(),
}));

jest.mock('../../../../services/telemetry/watchOnboarding', () => ({
  markWatchOnboardingComplete: jest.fn(async () => undefined),
}));

jest.mock('../../../../components/Smartwatch3D', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Smartwatch3D: (p: Record<string, unknown>) =>
      React.createElement(View, { testID: 'smartwatch-3d', ...p }),
  };
});

const mockGate = isFeatureEnabled as jest.Mock;
const mockEstado = useWatchDiagnostics as jest.MockedFunction<typeof useWatchDiagnostics>;
const mockMarcar = markWatchOnboardingComplete as jest.MockedFunction<
  typeof markWatchOnboardingComplete
>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Data LOCAL, para o horario esperado nao depender do fuso da maquina.
const MEDIDO_EM = new Date(2026, 8, 2, 10, 15, 30).toISOString();

// A leitura precisa ser recente de verdade: a tela deriva o estado do horario,
// e uma amostra de horas atras cairia em aguardando, com razao.
const agoraMenos = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const comLeitura = (): WatchDiagnosticsState => ({
  support: 'ready',
  session: 'running',
  sessionChangedAt: agoraMenos(30),
  lastSample: { bpm: 72, measuredAt: agoraMenos(5) },
});
const AGUARDANDO: WatchDiagnosticsState = {
  support: 'ready',
  session: 'running',
  sessionChangedAt: MEDIDO_EM,
  lastSample: null,
};
const SEM_NADA: WatchDiagnosticsState = {
  support: 'ready',
  session: 'none',
  sessionChangedAt: null,
  lastSample: null,
};

// As telas mantem um relogio vivo (useNow) para a atualidade envelhecer sem
// evento novo. Arvore nao desmontada deixa esse intervalo rodando depois do
// teste, o que o Jest reporta como log fora de hora.
const montadas: ReturnType<typeof create>[] = [];

afterEach(() => {
  while (montadas.length) montadas.pop()!.unmount();
});

const render = async (estado: WatchDiagnosticsState) => {
  mockEstado.mockReturnValue(estado);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchComplete />
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

const finalizar = async (tree: ReturnType<typeof create>) => {
  const botao = tree.root
    .findAllByType(Button as React.ComponentType<{ label: string; onPress: () => void }>)
    .find((b) => b.props.label === 'Finalizar');
  if (!botao) throw new Error('Botao Finalizar ausente');
  await act(async () => {
    botao.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockReturnValue(true);
});

describe('primeiro uso, tela final', () => {
  it('atras do portao do primeiro uso', async () => {
    mockGate.mockReturnValue(false);
    const tree = await render(SEM_NADA);
    expect(mockGate).toHaveBeenCalledWith('watchOnboarding');
    expect(texto(tree)).toContain('Disponível na versão final');
  });

  it('com leitura real mostra o BPM medido, e nao um numero de exemplo', async () => {
    const tree = await render(comLeitura());
    const t = texto(tree);
    expect(t).toContain('Monitoramento ativo');
    expect(t).toContain('72');
  });

  it('sessao ativa sem leitura manda ajustar o relogio, nao ir aos Ajustes', async () => {
    const tree = await render(AGUARDANDO);
    const t = texto(tree);
    expect(t).toContain('Quase lá');
    expect(t).toContain('pulso');
    expect(t).not.toContain('Ajustes');
  });

  it('sem leitura nenhuma aponta a reentrada e o caminho do sistema', async () => {
    const tree = await render(SEM_NADA);
    const t = texto(tree);
    expect(t).toContain('Monitoramento indisponível');
    expect(t).toContain('Configurações');
    expect(t).toContain('Ajustes');
  });

  // ADR-0004: o iOS nao conta negacao de leitura, entao o app nao pode afirmar
  // que houve uma.
  it('nenhum estado acusa o funcionario de ter negado permissao', async () => {
    for (const estado of [comLeitura(), AGUARDANDO, SEM_NADA]) {
      const t = texto(await render(estado)).toLowerCase();
      expect(t).not.toContain('negou');
      expect(t).not.toContain('negad');
      expect(t).not.toContain('smartband');
    }
  });

  // Uma leitura de dois minutos nao e "tudo certo": chamar assim apagaria o
  // estado desatualizado que o glossario criou para distingui-la.
  it('leitura desatualizada nao vira monitoramento ativo, e mantem o horario', async () => {
    const tree = await render({
      support: 'ready',
      session: 'ended',
      sessionChangedAt: agoraMenos(200),
      lastSample: { bpm: 68, measuredAt: agoraMenos(90) },
    });
    const t = texto(tree);
    expect(t).toContain('Última leitura desatualizada');
    expect(t).not.toContain('Tudo certo');
    expect(t).toContain('68');
  });

  it('nunca mostra zero no lugar de uma leitura ausente', async () => {
    const t = texto(await render(SEM_NADA));
    expect(t).not.toMatch(/\b0\s*bpm/i);
    expect(t).not.toContain('12/8');
  });

  it('Finalizar existe nos tres estados: telemetria ausente nao barra a entrada', async () => {
    for (const estado of [comLeitura(), AGUARDANDO, SEM_NADA]) {
      const tree = await render(estado);
      await finalizar(tree);
      expect(mockReplace).toHaveBeenLastCalledWith('/(app)/dashboard');
    }
  });

  it('Finalizar grava que o primeiro uso passou, para o cadastro nao repeti-lo', async () => {
    const tree = await render(SEM_NADA);
    await finalizar(tree);
    expect(mockMarcar).toHaveBeenCalledTimes(1);
    const [quando] = mockMarcar.mock.calls[0];
    expect(Number.isNaN(Date.parse(quando))).toBe(false);
  });

  it('falha ao gravar nao impede a entrada no app', async () => {
    mockMarcar.mockRejectedValueOnce(new Error('keychain indisponível'));
    const tree = await render(SEM_NADA);
    await finalizar(tree);
    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
  });
});
