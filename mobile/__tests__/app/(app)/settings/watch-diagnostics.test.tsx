import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, TopBar } from '@kavicki/swi-design-system';
import WatchDiagnostics from '../../../../app/(app)/settings/watch-diagnostics';
import { useWatchDiagnostics, type WatchDiagnosticsState } from '../../../../services/telemetry/watchDiagnostics';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(),
}));

const mockedHook = useWatchDiagnostics as jest.MockedFunction<typeof useWatchDiagnostics>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async (state: WatchDiagnosticsState) => {
  mockedHook.mockReturnValue(state);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <WatchDiagnostics />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Coleta todo texto renderizado, em qualquer profundidade.
const textoDe = (tree: ReturnType<typeof create>): string => {
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
    const { children } = node as { children?: unknown };
    walk(children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

// Data LOCAL, para o horário esperado não depender do fuso da máquina.
const MEDIDO_EM = new Date(2026, 8, 2, 10, 15, 30).toISOString();

describe('Diagnóstico do Apple Watch', () => {
  it('usa a TopBar do DS com o título da tela', async () => {
    const tree = await render({ support: 'unsupported' });
    const topBar = tree.root.findAllByType(TopBar as React.ComponentType<{ title: string }>)[0];
    expect(topBar.props.title).toBe('Diagnóstico do Apple Watch');
  });

  it('sem suporte explica que a tela só funciona no iPhone com o app instalado', async () => {
    const tree = await render({ support: 'unsupported' });
    expect(textoDe(tree)).toContain('Disponível apenas no iPhone');
  });

  it('pronto sem sessão pede para iniciar o teste no relógio', async () => {
    const tree = await render({
      support: 'ready',
      session: 'none',
      sessionChangedAt: null,
      lastSample: null,
    });
    const texto = textoDe(tree);
    expect(texto).toContain('Aguardando sessão do relógio');
    expect(texto).toContain('Iniciar teste');
  });

  it('sessão ativa sem amostra não inventa BPM', async () => {
    const tree = await render({
      support: 'ready',
      session: 'running',
      sessionChangedAt: MEDIDO_EM,
      lastSample: null,
    });
    const texto = textoDe(tree);
    expect(texto).toContain('Sessão espelhada ativa');
    expect(texto).toContain('Sem amostra de BPM ainda');
    expect(texto).not.toMatch(/\b0\s*bpm/i);
  });

  it('sessão ativa com amostra mostra BPM real e o horário da medição', async () => {
    const tree = await render({
      support: 'ready',
      session: 'running',
      sessionChangedAt: MEDIDO_EM,
      lastSample: { bpm: 72, measuredAt: MEDIDO_EM },
    });
    const texto = textoDe(tree);
    expect(texto).toContain('72');
    expect(texto).toContain('bpm');
    expect(texto).toContain('10:15:30');
  });

  it('sessão encerrada mantém a última amostra identificada como tal', async () => {
    const tree = await render({
      support: 'ready',
      session: 'ended',
      sessionChangedAt: MEDIDO_EM,
      lastSample: { bpm: 65, measuredAt: MEDIDO_EM },
    });
    const texto = textoDe(tree);
    expect(texto).toContain('Sessão encerrada');
    expect(texto).toContain('65');
    expect(texto).toContain('10:15:30');
  });
});
