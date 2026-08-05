import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import type { Vitals, VitalsPhase, WorkerStatus } from '../../../services/vitals/types';

// Caracterização do dashboard, escrita ANTES da decomposição da Task 5.
//
// Não afirma estrutura de arquivo nem hierarquia de componentes: só o que a
// tela mostra e para onde ela navega. É isso que precisa sobreviver quando o
// JSX mudar de arquivo. Cobre as DUAS telas que vivem aqui, a normal e o
// `?alert=active` (procedimento de evacuação), porque a segunda é tela de
// segurança e não pode regredir sem ninguém perceber.

const VITALS: Vitals = {
  heartRate: 82,
  bloodPressureSys: 120,
  bloodPressureDia: 80,
  oxygenation: 97,
  caloriesPerHour: 184.4,
  steps: 4200,
  distanceKm: 3.1,
  effortPct: 42,
  fatiguePct: 74.2,
  fatigueEtaMin: 95,
};

// --- Fronteiras dubladas -----------------------------------------------------

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: { alert?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockSearchParams,
}));

let mockVitalsState: { phase: VitalsPhase; vitals: Vitals | null; status: WorkerStatus } = {
  phase: 'ready',
  vitals: VITALS,
  status: 'good',
};
jest.mock('../../../services/vitals/VitalsProvider', () => ({
  useVitals: () => mockVitalsState,
}));

jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => ({ profile: { fullName: 'Trabalhador Teste', avatarUrl: '' } }),
}));

let mockUnreadCount = 0;
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  useNotifications: () => ({ unreadCount: mockUnreadCount }),
}));

const mockLoadReports = jest.fn(async () => {});
let mockReports: { status: string }[] = [];
jest.mock('../../../services/reports/ReportsProvider', () => ({
  useReports: () => ({ reports: mockReports, load: mockLoadReports }),
}));

// Sem snapshot: exercita o fallback estático do weatherDisplay, que é o
// comportamento que a tela de segurança precisa ter quando o clima não carrega.
jest.mock('../../../services/weather/WeatherProvider', () => ({
  useWeather: () => ({ snapshot: null, activeAlert: null }),
}));

jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));

// --- Helpers -----------------------------------------------------------------

// Mesmas métricas das outras suítes de tela (reports, chat): iPhone com notch.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Dashboard />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

/**
 * Todos os textos renderizados, achatados numa string única.
 *
 * Texto interpolado (`Total: {x}`) chega como ARRAY de children, não string, e
 * é justamente aí que moram os valores derivados dos vitais. Achatar os dois
 * casos é o que faz o teste ver o que o usuário vê.
 */
function textoDa(tree: ReactTestRenderer): string {
  const pedacos: string[] = [];
  tree.root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === 'string' || typeof c === 'number') {
      pedacos.push(String(c));
    } else if (Array.isArray(c) && c.every((p) => typeof p === 'string' || typeof p === 'number')) {
      pedacos.push(c.join(''));
    }
  });
  return pedacos.join('\n');
}

/**
 * O nó rotulado com o texto dado. Aceita `accessibilityLabel` ou o `label`
 * visível do Button do DS: os botões da tela usam ora um, ora outro.
 */
function porRotulo(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label || n.props?.label === label,
  )[0];
}

/** Dispara o onPress do elemento com o rótulo acessível dado. */
async function tocar(tree: ReactTestRenderer, label: string) {
  const alvo = tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  )[0];
  expect(alvo).toBeDefined();
  await act(async () => {
    alvo.props.onPress();
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockLoadReports.mockClear();
  mockSearchParams = {};
  mockVitalsState = { phase: 'ready', vitals: VITALS, status: 'good' };
  mockUnreadCount = 0;
  mockReports = [];
});

// --- Fases dos vitais --------------------------------------------------------

describe('dashboard — fases dos vitais', () => {
  it('carregando: mostra o aviso de carregamento e nenhum número de vital', async () => {
    mockVitalsState = { phase: 'loading', vitals: null, status: 'unknown' };
    const texto = textoDa(await render());
    expect(texto).toContain('Carregando seus dados');
    expect(texto).not.toContain('BPM');
  });

  it('vazio: pede a smartband em vez de mostrar zeros', async () => {
    mockVitalsState = { phase: 'empty', vitals: null, status: 'unknown' };
    const texto = textoDa(await render());
    expect(texto).toContain('Sem leituras ainda');
    expect(texto).not.toContain('BPM');
  });

  it('erro: admite a falha e oferece nova tentativa', async () => {
    mockVitalsState = { phase: 'error', vitals: null, status: 'unknown' };
    const tree = await render();
    expect(textoDa(tree)).toContain('Não foi possível carregar');
    expect(porRotulo(tree, 'Tentar de novo')).toBeDefined();
  });

  it('pronto: os três números saem dos vitais, não de literais', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('82'); // heartRate
    expect(texto).toContain('120/80'); // pressão sistólica/diastólica
    expect(texto).toContain('184'); // caloriesPerHour arredondado
  });

  it('pronto: mostra a estimativa de tempo até a fadiga total', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('Tempo até atingir fadiga total:');
  });

  it('stale: esconde o selo de coração em vez de fingir um estado bom', async () => {
    mockVitalsState = { phase: 'stale', vitals: VITALS, status: 'unknown' };
    const tree = await render();
    const selos = tree.root.findAll((n) => n.props?.size === 26.093);
    expect(selos).toHaveLength(0);
  });

  it('pronto e bom: o selo de coração aparece', async () => {
    const tree = await render();
    const selos = tree.root.findAll((n) => n.props?.size === 26.093);
    expect(selos.length).toBeGreaterThan(0);
  });
});

// --- Badges de pendências ----------------------------------------------------

describe('dashboard — badges de relatórios e notificações', () => {
  it('dispara o carregamento dos relatórios no mount', async () => {
    await render();
    expect(mockLoadReports).toHaveBeenCalled();
  });

  it('sem pendências, o rótulo não anuncia contagem', async () => {
    const tree = await render();
    expect(porRotulo(tree, 'Relatórios')).toBeDefined();
    expect(porRotulo(tree, 'Notificações')).toBeDefined();
  });

  it('conta só os relatórios pendentes, e concorda em número', async () => {
    mockReports = [{ status: 'pending' }, { status: 'done' }, { status: 'pending' }];
    const tree = await render();
    expect(porRotulo(tree, 'Relatórios, 2 pendentes')).toBeDefined();

    mockReports = [{ status: 'pending' }, { status: 'done' }];
    const um = await render();
    expect(porRotulo(um, 'Relatórios, 1 pendente')).toBeDefined();
  });

  it('anuncia as notificações não lidas, e concorda em número', async () => {
    mockUnreadCount = 3;
    const tree = await render();
    expect(porRotulo(tree, 'Notificações, 3 não lidas')).toBeDefined();

    mockUnreadCount = 1;
    const uma = await render();
    expect(porRotulo(uma, 'Notificações, 1 não lida')).toBeDefined();
  });
});

// --- Navegação ---------------------------------------------------------------

describe('dashboard — navegação', () => {
  it.each([
    ['Localização', '/(app)/map'],
    ['Trabalho', '/(app)/journey'],
    ['Relatórios', '/(app)/reports'],
    ['Notificações', '/(app)/notifications'],
    ['Chat', '/(app)/chat/inbox'],
    ['Abrir configurações', '/(app)/settings'],
  ])('%s leva a %s', async (rotulo, rota) => {
    const tree = await render();
    await tocar(tree, rotulo);
    expect(mockPush).toHaveBeenCalledWith(rota);
  });

  it('a câmera alterna o próprio estado sem navegar', async () => {
    const tree = await render();
    expect(porRotulo(tree, 'Câmera ativa')).toBeDefined();
    await tocar(tree, 'Câmera ativa');
    expect(porRotulo(tree, 'Câmera inativa')).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('ajuda urgente abre o modal sem trocar de rota', async () => {
    const tree = await render();
    await tocar(tree, 'Ajuda urgente');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// --- Tela de evacuação (?alert=active) ---------------------------------------

describe('dashboard — procedimento de evacuação (?alert=active)', () => {
  beforeEach(() => {
    mockSearchParams = { alert: 'active' };
  });

  it('substitui o dashboard inteiro, mesmo com os vitais prontos', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('Procedimento de evacuação');
    expect(texto).not.toContain('Kcal/hora');
  });

  it('mostra os quatro passos do procedimento', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('Desloque-se para o local de resgate');
    expect(texto).toContain('Mantenha se em um abrigo protegido do vento');
    expect(texto).toContain('Espere pelo veículo de resgate');
    expect(texto).toContain('reporte imediatamente à central');
  });

  it('sem clima carregado, cai no texto estático em vez de quebrar', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('Risco de desabamentos');
  });

  it('ignora a fase dos vitais: a tela de segurança sempre aparece', async () => {
    mockVitalsState = { phase: 'error', vitals: null, status: 'unknown' };
    const texto = textoDa(await render());
    expect(texto).toContain('Procedimento de evacuação');
    expect(texto).not.toContain('Não foi possível carregar');
  });

  it.each([
    ['Traçar rota de evacuação', '/(app)/evacuation'],
    ['Reportar acidente', '/(app)/reports/new'],
  ])('%s leva a %s', async (rotulo, rota) => {
    const tree = await render();
    await tocar(tree, rotulo);
    expect(mockPush).toHaveBeenCalledWith(rota);
  });

  it('confirmar as instruções volta ao dashboard sem empilhar rota', async () => {
    const tree = await render();
    await tocar(tree, 'Confirmar instruções recebidas');
    expect(mockReplace).toHaveBeenCalledWith('/(app)/dashboard');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
