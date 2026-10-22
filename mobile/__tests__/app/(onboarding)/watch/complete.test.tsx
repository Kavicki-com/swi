import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, SwiThemeProvider } from '@kavicki/swi-design-system';
import WatchComplete from '../../../../app/(onboarding)/watch/complete';
import { isFeatureEnabled, type FeatureGate } from '../../../../lib/featureFlags';
import type { HealthConnectState } from '../../../../services/telemetry/healthConnect/healthConnectReader';
import {
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../../services/telemetry/watchDiagnostics';
import { markWatchOnboardingComplete } from '../../../../services/telemetry/watchOnboarding';
import { useTelemetryUploadState } from '../../../../services/telemetry/TelemetryUploadProvider';

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

jest.mock('../../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: jest.fn(),
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
  watchProtocol: null,
  sessionChangedAt: agoraMenos(30),
  lastSample: { bpm: 72, measuredAt: agoraMenos(5) },
});
const AGUARDANDO: WatchDiagnosticsState = {
  support: 'ready',
  session: 'running',
  watchProtocol: null,
  sessionChangedAt: MEDIDO_EM,
  lastSample: null,
};
const SEM_NADA: WatchDiagnosticsState = {
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

const mockEnvio = useTelemetryUploadState as jest.Mock;
const envio = (paired: boolean, healthConnect: HealthConnectState | null = null) =>
  mockEnvio.mockReturnValue({ paired, healthConnect });

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const comGates = (...ligados: FeatureGate[]) =>
  mockGate.mockImplementation((gate: FeatureGate) => ligados.includes(gate));

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
  envio(false);
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
      watchProtocol: null,
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

// No Android com o Health Connect o controle do relogio responde "sem
// suporte", e a copy do relogio diria que o aparelho nao monitora. Aqui quem
// fala e o pareamento e a leitura da pulseira.
describe('primeiro uso, tela final: Android com o Health Connect', () => {
  const SEM_SUPORTE: WatchDiagnosticsState = { support: 'unsupported' };
  const estadoHC = (parcial: Partial<HealthConnectState> = {}): HealthConnectState => ({
    availability: 'available',
    permission: 'granted',
    bandPackage: null,
    bandLabel: null,
    noBand: false,
    lastSyncAt: null,
    ...parcial,
  });

  beforeEach(() => {
    naPlataforma('android');
    comGates('watchOnboarding', 'healthConnect');
  });

  it('pareado, com a leitura permitida e a pulseira detectada, diz que esta tudo pronto', async () => {
    envio(true, estadoHC({ bandPackage: 'com.mi.health', bandLabel: 'Mi Fitness' }));
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('Tudo pronto');
    expect(t).toContain('Health Connect');
    expect(t).not.toContain('não faz o monitoramento');
    expect(t).not.toMatch(/iPhone|Apple Watch/);
  });

  it('sem pareamento, aponta onde parear depois', async () => {
    envio(false, estadoHC());
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('Celular ainda não pareado');
    expect(t).toContain('Configurações, Monitoramento');
    expect(t).not.toMatch(/iPhone|Apple Watch/);
  });

  it('pareado sem a leitura permitida, aponta Configuracoes sem acusar negacao', async () => {
    envio(true, estadoHC({ permission: 'denied' }));
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('Falta liberar a leitura');
    expect(t.toLowerCase()).not.toMatch(/negou|negad/);
    expect(t).not.toMatch(/iPhone|Apple Watch/);
  });

  // O passo do pareamento acabou de dizer "Nenhuma pulseira encontrada": o
  // fim nao pode afirmar que o SWI le a pulseira.
  it('leitura permitida sem pulseira no Health Connect nao diz que esta tudo pronto', async () => {
    envio(true, estadoHC({ noBand: true }));
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('Nenhuma pulseira encontrada');
    expect(t).not.toContain('Tudo pronto');
    expect(t).not.toContain('lê as medições');
  });

  // O passo do pareamento mostrou "ainda não trouxe resultado": sem pulseira
  // detectada, o fim nao afirma leitura.
  it('leitura permitida sem resultado ainda nao diz que esta tudo pronto', async () => {
    envio(true, estadoHC());
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('ainda não trouxe resultado');
    expect(t).not.toContain('Tudo pronto');
    expect(t).not.toContain('lê as medições');
  });

  it('Health Connect ausente aponta a Play Store, nao a permissao', async () => {
    envio(true, estadoHC({ availability: 'unavailable', permission: null }));
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('Health Connect não instalado');
    expect(t).toContain('Play Store');
    expect(t).not.toContain('Falta liberar a leitura');
  });

  // ADR-0013: no Android passos e movimento so chegam pelo Health Connect.
  it('nenhum estado promete movimento ao vivo', async () => {
    const estados: [boolean, HealthConnectState][] = [
      [true, estadoHC({ bandPackage: 'com.mi.health', bandLabel: 'Mi Fitness' })],
      [false, estadoHC()],
      [true, estadoHC({ permission: 'denied' })],
      [true, estadoHC({ noBand: true })],
      [true, estadoHC({ availability: 'unavailable', permission: null })],
    ];
    for (const [pareado, estado] of estados) {
      envio(pareado, estado);
      const t = texto(await render(SEM_SUPORTE));
      expect(t).not.toMatch(/ao vivo|tempo real/i);
    }
  });

  it('Finalizar grava a marcacao e continua entrando no app', async () => {
    envio(false);
    const tree = await render(SEM_SUPORTE);
    await finalizar(tree);
    expect(mockMarcar).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
  });

  it('sem o gate do Health Connect, o Android segue como antes', async () => {
    comGates('watchOnboarding');
    const t = texto(await render(SEM_SUPORTE));
    expect(t).toContain('não faz o monitoramento');
  });

  it('no iOS, mesmo com o gate ligado, a copy do relogio continua', async () => {
    naPlataforma('ios');
    envio(true, estadoHC());
    const t = texto(await render(SEM_NADA));
    expect(t).toContain('Monitoramento indisponível');
    expect(t).not.toContain('Tudo pronto');
  });
});
