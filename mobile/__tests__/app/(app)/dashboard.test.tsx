import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import { condition, reporting } from '../../../services/telemetry/myTelemetryFixtures';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';

// Companheiro de dashboard.integration.test.tsx, que cobre a leitura da telemetria,
// badges, navegacao e a tela ?alert=active. Aqui ficam os dois caminhos de
// alerta que sobraram, e eles nao sao o mesmo caminho:
//
// - POR ROTA (?alert=modal): deep link externo, por exemplo uma notificacao
//   push. Pinta o fundo de vermelho e revela o modal 800ms depois do mount,
//   com dissolve. Os CTAs trocam de rota (replace), sem empilhar historico.
// - POR ESTADO ("Ajuda urgente"): o usuario pediu ajuda daqui. Abre overlay
//   sem mexer na rota, justamente para o dashboard atras NAO virar vermelho.
//
// Os dois modais sao dublados: a tela em teste e o dashboard, e o que importa
// e quem os abre, quem os fecha e por qual caminho.

const lendo = (telemetry: MyTelemetryState['telemetry']): MyTelemetryState => ({
  telemetry,
  failed: false,
  loading: false,
});

// --- Fronteiras dubladas -----------------------------------------------------


// A tela pergunta ao módulo do relógio se este aparelho faz monitoramento.
// Em Jest o módulo não existe; o dublê diz "pronto" por padrão para os casos
// antigos, e "sem suporte" só onde o teste pede.
let mockSuporte: WatchDiagnosticsState = { support: 'ready' } as WatchDiagnosticsState;
jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => mockSuporte,
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };
let mockSearchParams: { alert?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockSearchParams,
}));

let mockTelemetryState: MyTelemetryState = lendo(reporting());
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetryState,
}));

jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { fullName: 'Trabalhador Teste', avatarUrl: '' } }),
}));
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  useNotifications: () => ({ unreadCount: 0 }),
}));
jest.mock('../../../services/reports/ReportsProvider', () => ({
  useReports: () => ({ reports: [], load: jest.fn(async () => {}) }),
}));
// A janela do clima só existe com alerta vigente; cada teste liga ou desliga.
const ALERTA = { id: 'wx-1', event: 'Tempestade', severity: 'PERIGO', description: 'Procure abrigo.' };
let mockAlertaVigente: typeof ALERTA | null = ALERTA;
jest.mock('../../../services/weather/WeatherProvider', () => ({
  useWeather: () => ({ snapshot: null, activeAlert: mockAlertaVigente }),
}));
jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));

jest.mock('../../../components/modals/WeatherAlertModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WeatherAlertModal: (p: any) =>
      React.createElement(View, {
        testID: 'modal-clima',
        onClose: p.onClose,
        onPrimaryAction: p.onPrimaryAction,
      }),
  };
});
jest.mock('../../../components/modals/ActiveAlertModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ActiveAlertModal: (p: any) =>
      React.createElement(View, {
        testID: 'modal-alerta-ativo',
        visible: p.visible,
        onClose: p.onClose,
      }),
  };
});

// --- Helpers -----------------------------------------------------------------

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const arvore = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <SwiThemeProvider>
      <Dashboard />
    </SwiThemeProvider>
  </SafeAreaProvider>
);

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(arvore());
  });
  return tree;
};

const porTestID = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

const porRotulo = (tree: ReactTestRenderer, rotulo: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === rotulo && typeof n.props?.onPress === 'function',
  )[0];

const grafico = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === 'Status de saúde')[0];

// O selo do peito e identificado pelo tamanho que o Figma cravou.
const seloDoCoracao = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.size === 26.093)[0];

const primeiraParadaDoFundo = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.offset === '0' && typeof n.props?.stopColor === 'string')[0]
    .props.stopColor as string;

const tocar = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress();
  });
};

beforeEach(() => {
  mockSuporte = { support: 'ready' } as WatchDiagnosticsState;
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSearchParams = {};
  mockTelemetryState = lendo(reporting());
  mockAlertaVigente = ALERTA;
});

afterEach(() => {
  jest.useRealTimers();
});

// --- Alerta por rota ---------------------------------------------------------

describe('dashboard: alerta que chega pela rota (?alert=modal)', () => {
  it('segura o modal por 800ms antes de revelar, como o Figma pede', async () => {
    mockSearchParams = { alert: 'modal' };
    const tree = await montar();

    // O overlay existe desde o inicio, invisivel e sem receber toque: e ele que
    // faz o dissolve. Revelar no mount seria um pulo na tela.
    const overlay = () =>
      tree.root.findAll((n) => n.props?.style?.zIndex === 10 && n.props?.pointerEvents)[0];
    expect(overlay().props.style.opacity).toBe(0);
    expect(overlay().props.pointerEvents).toBe('none');

    await act(async () => {
      jest.advanceTimersByTime(799);
    });
    expect(overlay().props.style.opacity).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(overlay().props.style.opacity).toBe(1);
    expect(overlay().props.pointerEvents).toBe('auto');
  });

  it('pinta o fundo com a rampa de alerta, diferente da rampa normal', async () => {
    const normal = primeiraParadaDoFundo(await montar());

    mockSearchParams = { alert: 'modal' };
    const emAlerta = primeiraParadaDoFundo(await montar());

    expect(emAlerta).not.toBe(normal);
  });

  it('sair do parametro antes dos 800ms cancela a revelacao', async () => {
    mockSearchParams = { alert: 'modal' };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(arvore());
    });

    mockSearchParams = {};
    await act(async () => {
      tree.update(arvore());
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // Sem o clearTimeout, o timer sobreviveria a saida e abriria um modal
    // sobre um dashboard que ja nao esta em alerta.
    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('fechar devolve o dashboard limpo, sem empilhar rota', async () => {
    mockSearchParams = { alert: 'modal' };
    const tree = await montar();

    await act(async () => {
      porTestID(tree, 'modal-clima').props.onClose();
    });

    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('o CTA leva ao procedimento de evacuacao, tambem sem empilhar', async () => {
    mockSearchParams = { alert: 'modal' };
    const tree = await montar();

    await act(async () => {
      porTestID(tree, 'modal-clima').props.onPrimaryAction();
    });

    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard?alert=active');
    expect(mockPush).not.toHaveBeenCalled();
  });

  // O link pode chegar velho: a notificacao foi tocada depois que o alerta
  // acabou. Sem alerta vigente nao ha janela nem fundo vermelho.
  it('sem alerta vigente, o link nao mostra a janela nem pinta o fundo', async () => {
    const normal = primeiraParadaDoFundo(await montar());

    mockAlertaVigente = null;
    mockSearchParams = { alert: 'modal' };
    const tree = await montar();
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
    expect(primeiraParadaDoFundo(tree)).toBe(normal);
  });

  it('alerta que expira com a janela aberta leva a janela e o vermelho embora', async () => {
    const normal = primeiraParadaDoFundo(await montar());
    mockSearchParams = { alert: 'modal' };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(arvore());
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    expect(porTestID(tree, 'modal-clima')).toBeDefined();

    mockAlertaVigente = null;
    await act(async () => {
      tree.update(arvore());
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
    expect(primeiraParadaDoFundo(tree)).toBe(normal);
  });
});

// --- Alerta pedido pelo usuario ----------------------------------------------

describe('dashboard: alerta pedido pelo botao de ajuda urgente', () => {
  const pedirAjuda = async (tree: ReactTestRenderer) => {
    await tocar(porRotulo(tree, 'Ajuda urgente'));
  };

  it('abre como overlay e deixa o dashboard atras na cor normal', async () => {
    const tree = await montar();
    const antes = primeiraParadaDoFundo(tree);

    await pedirAjuda(tree);

    expect(porTestID(tree, 'modal-clima')).toBeDefined();
    // A diferenca para o caminho por rota: aqui o fundo NAO fica vermelho.
    expect(primeiraParadaDoFundo(tree)).toBe(antes);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('tocar no fundo fecha', async () => {
    const tree = await montar();
    await pedirAjuda(tree);

    const fundo = tree.root.findAll(
      (n) =>
        n.props?.style?.backgroundColor === 'rgba(245, 102, 122, 0.18)' &&
        typeof n.props?.onPress === 'function',
    )[0];
    await tocar(fundo);

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('tocar dentro do cartao nao fecha', async () => {
    const tree = await montar();
    await pedirAjuda(tree);

    const dentro = tree.root.findAll(
      (n) => n.props?.style?.maxWidth === 320 && typeof n.props?.onPress === 'function',
    )[0];
    await tocar(dentro);

    expect(porTestID(tree, 'modal-clima')).toBeDefined();
  });

  it('o voltar do Android fecha', async () => {
    const tree = await montar();
    await pedirAjuda(tree);

    const modal = tree.root.findAll((n) => typeof n.props?.onRequestClose === 'function')[0];
    await act(async () => {
      modal.props.onRequestClose();
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('a ligacao de fechar entregue ao modal realmente fecha', async () => {
    const tree = await montar();
    await pedirAjuda(tree);

    await act(async () => {
      porTestID(tree, 'modal-clima').props.onClose();
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('o CTA troca o modal do clima pelo de alerta ativo, e o fechar devolve o dashboard', async () => {
    const tree = await montar();
    await pedirAjuda(tree);

    await act(async () => {
      porTestID(tree, 'modal-clima').props.onPrimaryAction();
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      porTestID(tree, 'modal-alerta-ativo').props.onClose();
    });

    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(false);
  });

  // Pedir ajuda nao depende do clima. Sem alerta vigente, a janela "Local em
  // Alerta!" nao tem o que afirmar: o botao vai direto ao procedimento.
  it('sem alerta vigente, pula a janela do clima e abre direto o procedimento', async () => {
    mockAlertaVigente = null;
    const tree = await montar();

    await pedirAjuda(tree);

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('alerta que expira com a janela aberta fecha a janela', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(arvore());
    });
    await pedirAjuda(tree);
    expect(porTestID(tree, 'modal-clima')).toBeDefined();

    mockAlertaVigente = null;
    await act(async () => {
      tree.update(arvore());
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });
});

// --- Estado de saude ruim ----------------------------------------------------

describe('dashboard: status fora do bom', () => {
  // O estado vem das condicoes abertas no backend: urgencia e o pior (low),
  // alerta de saude sem urgencia e alert.
  it.each([
    ['HEALTH', 'alert'],
    ['URGENT', 'low'],
  ] as const)(
    'condicao %s pinta o anel e o selo de %s, sem cair no verde',
    async (categoria, status) => {
      mockTelemetryState = lendo({ ...reporting(), conditions: [condition(categoria)] });

      const tree = await montar();

      expect(grafico(tree).props.condition).toBe(status);
      expect(seloDoCoracao(tree).props.condition).toBe(status);
    },
  );

  it('bom vira check no selo, que e o unico nome que difere do status', async () => {
    const tree = await montar();

    expect(grafico(tree).props.condition).toBe('good');
    expect(seloDoCoracao(tree).props.condition).toBe('check');
  });
});

// --- Atalhos do grafico ------------------------------------------------------

describe('dashboard: atalhos dentro do grafico', () => {
  it('o batimento abre a tela de estatisticas', async () => {
    const tree = await montar();

    await act(async () => {
      grafico(tree).props.onPressHeartRate();
    });

    expect(mockPush).toHaveBeenCalledWith('/(app)/my-stats');
  });

  it('a engrenagem do grafico abre as configuracoes', async () => {
    const tree = await montar();

    await act(async () => {
      grafico(tree).props.onPressSettings();
    });

    expect(mockPush).toHaveBeenCalledWith('/(app)/settings');
  });
});

// --- Leitura ausente ---------------------------------------------------------

describe('dashboard: ajuda urgente sem leitura', () => {
  // A tela nao troca mais de cara quando a leitura falha, carrega ou nao
  // existe. Era essa troca que escondia o botao de ajuda urgente justamente de
  // quem estava sem monitoramento.
  it.each([
    ['falha', { telemetry: null, failed: true, loading: false }],
    ['carregando', { telemetry: null, failed: false, loading: true }],
    ['sem leitura', { telemetry: null, failed: false, loading: false }],
  ] as const)('%s: o botao existe e abre o procedimento', async (_caso, estado) => {
    mockTelemetryState = estado;
    mockAlertaVigente = null;
    const tree = await montar();

    await tocar(porRotulo(tree, 'Ajuda urgente'));

    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('dashboard: aparelho sem o módulo do relógio', () => {
  const SEM_RELOGIO = 'Monitoramento só com iPhone e Apple Watch';
  const frases = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children as string);

  it('a linha de estado diz onde o monitoramento funciona, e a tela fica inteira', async () => {
    mockSuporte = { support: 'unsupported' };
    mockTelemetryState = { telemetry: null, failed: false, loading: false };
    const tree = await montar();

    expect(frases(tree)).toContain(SEM_RELOGIO);
    expect(frases(tree)).not.toContain('Sem leitura do aparelho');
    expect(porRotulo(tree, 'Ajuda urgente')).toBeTruthy();
  });

  it('com o módulo presente a frase não aparece', async () => {
    mockTelemetryState = { telemetry: null, failed: false, loading: false };
    const tree = await montar();

    expect(frases(tree)).toContain('Sem leitura do aparelho');
    expect(frases(tree)).not.toContain(SEM_RELOGIO);
  });
});
