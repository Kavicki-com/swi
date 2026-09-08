import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, SwiThemeProvider, TopBar } from '@kavicki/swi-design-system';
import WatchDiagnostics from '../../../../app/(app)/settings/watch-diagnostics';
import {
  activateMonitoring,
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../../services/telemetry/watchDiagnostics';
import { useTelemetryUpload } from '../../../../services/telemetry/useTelemetryUpload';

// Porta de reentrada: quem tocou "Configurar depois" no cadastro, ou negou na
// folha do sistema, volta por aqui. Mesmo vocabulario da tela final do
// primeiro uso (CONTEXT.md).

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('../../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: jest.fn(),
  activateMonitoring: jest.fn(async () => true),
}));

// A fiação do envio (Task 7) tem teste próprio; aqui só o que a tela mostra.
jest.mock('../../../../services/telemetry/useTelemetryUpload', () => ({
  useTelemetryUpload: jest.fn(),
}));

const mockEstado = useWatchDiagnostics as jest.MockedFunction<typeof useWatchDiagnostics>;
const mockAtivar = activateMonitoring as jest.MockedFunction<typeof activateMonitoring>;
const mockEnvio = useTelemetryUpload as jest.MockedFunction<typeof useTelemetryUpload>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const agoraMenos = (s: number) => new Date(Date.now() - s * 1000).toISOString();

// As telas mantem um relogio vivo (useNow) para a atualidade envelhecer sem
// evento novo. Arvore nao desmontada deixa esse intervalo rodando depois do
// teste, o que o Jest reporta como log fora de hora.
const montadas: ReturnType<typeof create>[] = [];

afterEach(() => {
  while (montadas.length) montadas.pop()!.unmount();
});

const render = async (state: WatchDiagnosticsState) => {
  mockEstado.mockReturnValue(state);
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
  montadas.push(tree);
  return tree;
};

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
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

const botaoAtivar = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAllByType(Button as React.ComponentType<{ label: string; onPress: () => void }>)
    .find((b) => b.props.label === 'Ativar monitoramento');

const SEM_SUPORTE: WatchDiagnosticsState = { support: 'unsupported' };
const SEM_NADA: WatchDiagnosticsState = {
  support: 'ready',
  session: 'none',
  watchProtocol: null,
  sessionChangedAt: null,
  lastSample: null,
};
const ATIVO = (): WatchDiagnosticsState => ({
  support: 'ready',
  session: 'running',
  watchProtocol: null,
  sessionChangedAt: agoraMenos(60),
  lastSample: { bpm: 72, measuredAt: agoraMenos(5) },
});
const ENCERRADO_COM_LEITURA = (): WatchDiagnosticsState => ({
  support: 'ready',
  session: 'ended',
  watchProtocol: null,
  sessionChangedAt: agoraMenos(30),
  lastSample: { bpm: 65, measuredAt: agoraMenos(10) },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAtivar.mockResolvedValue(true);
  mockEnvio.mockReturnValue({ paired: false, lastOutcome: null });
});

describe('Configurações, Monitoramento', () => {
  it('usa a TopBar do DS com o nome que a pessoa foi procurar', async () => {
    const tree = await render(SEM_SUPORTE);
    const topBar = tree.root.findAllByType(TopBar as React.ComponentType<{ title: string }>)[0];
    expect(topBar.props.title).toBe('Monitoramento');
  });

  it('sem suporte explica o motivo real e não oferece ativar', async () => {
    const tree = await render(SEM_SUPORTE);
    expect(textoDe(tree)).toContain('iPhone e Apple Watch');
    expect(botaoAtivar(tree)).toBeUndefined();
  });

  it('sem leitura oferece ativar e aponta o caminho do sistema', async () => {
    const tree = await render(SEM_NADA);
    const t = textoDe(tree);
    expect(t).toContain('Monitoramento indisponível');
    expect(t).toContain('Ajustes');
    expect(botaoAtivar(tree)).toBeDefined();
  });

  it('ativar dispara autorizar e ativar juntos', async () => {
    const tree = await render(SEM_NADA);
    await act(async () => {
      botaoAtivar(tree)!.props.onPress();
    });
    expect(mockAtivar).toHaveBeenCalledTimes(1);
  });

  // Com a sessao ja ativa, ativar de novo nao faria nada: o botao sai.
  it('com sessão ativa o botão some e o BPM real aparece com horário', async () => {
    const tree = await render(ATIVO());
    const t = textoDe(tree);
    expect(t).toContain('72');
    expect(t).toContain('bpm');
    expect(botaoAtivar(tree)).toBeUndefined();
  });

  it('sessão encerrada mantém a última leitura e volta a oferecer ativar', async () => {
    const tree = await render(ENCERRADO_COM_LEITURA());
    expect(textoDe(tree)).toContain('65');
    expect(botaoAtivar(tree)).toBeDefined();
  });

  // Decisao congelada do plano: sem sessao ativa, a ultima leitura permanece
  // visivel com horario. Some-la apagaria o unico dado real que chegou.
  it('leitura antiga demais para contar continua visível com horário', async () => {
    const tree = await render({
      support: 'ready',
      session: 'ended',
      watchProtocol: null,
      sessionChangedAt: agoraMenos(600),
      lastSample: { bpm: 58, measuredAt: agoraMenos(600) },
    });
    const t = textoDe(tree);
    expect(t).toContain('Monitoramento indisponível');
    expect(t).toContain('58');
    expect(t).toContain('medido às');
  });

  it('nunca acusa negação de permissão nem cita smartband', async () => {
    for (const estado of [SEM_SUPORTE, SEM_NADA, ATIVO(), ENCERRADO_COM_LEITURA()]) {
      const t = textoDe(await render(estado)).toLowerCase();
      expect(t).not.toContain('negad');
      expect(t).not.toContain('smartband');
    }
  });

  it('sem leitura não inventa zero', async () => {
    const t = textoDe(await render(SEM_NADA));
    expect(t).not.toMatch(/\b0\s*bpm/i);
  });

  // A linha de envio ao backend. A tela de produto é da Task 11; aqui só a
  // prova de que o caminho existe.
  it('pareado diz que está enviando ao servidor', async () => {
    mockEnvio.mockReturnValue({ paired: true, lastOutcome: null });
    expect(textoDe(await render(ATIVO()))).toContain('Enviando ao servidor');
  });

  it('sem pareamento diz que o aparelho não está pareado', async () => {
    expect(textoDe(await render(SEM_NADA))).toContain('Aparelho não pareado');
  });

  it('sem suporte não fala de envio', async () => {
    const t = textoDe(await render(SEM_SUPORTE));
    expect(t).not.toContain('Enviando ao servidor');
    expect(t).not.toContain('Aparelho não pareado');
  });
});
