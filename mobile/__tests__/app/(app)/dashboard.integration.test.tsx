import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Dashboard from '../../../app/(app)/dashboard';
import {
  condition,
  metric,
  neverReported,
  reporting,
} from '../../../services/telemetry/myTelemetryFixtures';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';

// Caracterização do dashboard.
//
// Não afirma estrutura de arquivo nem hierarquia de componentes: só o que a
// tela mostra e para onde ela navega. É isso que precisa sobreviver quando o
// JSX mudar de arquivo. Cobre as DUAS telas que vivem aqui, a normal e o
// `?alert=active` (procedimento de evacuação), porque a segunda é tela de
// segurança e não pode regredir sem ninguém perceber.

// A leitura de me/current que a tela recebe. O padrão é o funcionário
// reportando agora (112 bpm, 310 kcal/h, desgaste 38,4, 95 min até a fadiga),
// com pressão medida, na origem real.
const lendo = (telemetry: MyTelemetryState['telemetry']): MyTelemetryState => ({
  telemetry,
  failed: false,
  loading: false,
});
const REPORTANDO = () =>
  lendo(reporting({ bloodPressure: metric({ systolic: 120, diastolic: 80 }) }));
const CARREGANDO: MyTelemetryState = { telemetry: null, failed: false, loading: true };
const FALHOU: MyTelemetryState = { telemetry: null, failed: true, loading: false };

// --- Fronteiras dubladas -----------------------------------------------------

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams: { alert?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockSearchParams,
}));

let mockTelemetryState: MyTelemetryState = REPORTANDO();
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetryState,
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

// Sem snapshot e sem alerta: a tela de segurança abre inteira, com as medições
// em '--' e sem texto de alerta, em vez de mostrar clima inventado.
let mockClima: { snapshot: unknown; activeAlert: unknown } = { snapshot: null, activeAlert: null };
jest.mock('../../../services/weather/WeatherProvider', () => ({
  useWeather: () => mockClima,
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

/**
 * Os selos de coração renderizados. O ícone não tem rótulo acessível; a
 * impressão digital é o `size` que o Figma cravou (26.093, único na tela),
 * mesmo seletor de dashboard.test.tsx.
 */
function selosDeCoracao(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.props?.size === 26.093);
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
  mockTelemetryState = REPORTANDO();
  mockUnreadCount = 0;
  mockReports = [];
  mockClima = { snapshot: null, activeAlert: null };
});

// --- Leitura da telemetria ---------------------------------------------------

/** A barra de fadiga, pelo rótulo acessível que a tela dá a ela. */
const barraDeFadiga = (tree: ReactTestRenderer) =>
  porRotulo(tree, 'Tempo até o alerta de fadiga');

/** A condição entregue ao gráfico da silhueta. */
const condicaoDoGrafico = (tree: ReactTestRenderer) =>
  porRotulo(tree, 'Status de saúde').props.condition;

describe('dashboard: leitura da telemetria', () => {
  // Carregando, sem leitura e falha NÃO trocam a tela: o dashboard inteiro
  // continua lá, com a ausência declarada, e a ajuda urgente ao alcance.
  it.each([
    ['carregando', CARREGANDO, 'Carregando leitura'],
    ['quem nunca reportou', lendo(neverReported()), 'Sem leitura do aparelho'],
    ['falha na leitura', FALHOU, 'Leitura indisponível no momento'],
  ])('%s: a tela fica inteira, com a ausência declarada', async (_caso, estado, frase) => {
    mockTelemetryState = estado;
    const tree = await render();
    const texto = textoDa(tree);
    expect(texto).toContain(frase);
    expect(texto).toContain('BPM');
    expect(texto).toContain('--');
    expect(texto).toContain('Sem medição');
    expect(texto).toContain('Tempo até o alerta de fadiga: sem estimativa');
    expect(porRotulo(tree, 'Ajuda urgente')).toBeDefined();
    expect(porRotulo(tree, 'Chat')).toBeDefined();
  });

  it('sem leitura não aparece número nenhum, nem zero', async () => {
    mockTelemetryState = lendo(neverReported());
    const texto = textoDa(await render());
    expect(texto).not.toMatch(/\d/);
  });

  it('sem leitura a barra de fadiga fica vazia e a silhueta neutra, sem selo no peito', async () => {
    mockTelemetryState = lendo(neverReported());
    const tree = await render();
    expect(barraDeFadiga(tree).props.value).toBe(0);
    expect(condicaoDoGrafico(tree)).toBe('neutral');
    expect(selosDeCoracao(tree)).toHaveLength(0);
  });

  it('reportando: os três números saem da leitura, não de literais', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('112'); // batimento
    expect(texto).toContain('120/80'); // pressão sistólica/diastólica
    expect(texto).toContain('310'); // kcal por hora arredondado
    expect(texto).toContain('Monitorando agora');
  });

  it('pressão é medição pontual: o rótulo traz o horário, nunca um juízo', async () => {
    const texto = textoDa(await render());
    expect(texto).toMatch(/Às \d{2}:\d{2}/);
    expect(texto).not.toContain('Boa');
  });

  it('a barra de fadiga é o desgaste e o texto traz o tempo até a fadiga', async () => {
    const tree = await render();
    expect(barraDeFadiga(tree).props.value).toBe(38);
    expect(textoDa(tree)).toContain('Tempo até o alerta de fadiga: 1h35m');
  });

  it('leitura velha mantém o valor, diz o horário e não afirma estado bom', async () => {
    mockTelemetryState = lendo(
      reporting({
        heartRate: metric(98, { quality: 'STALE', measuredAt: '2026-10-01T14:20:00.000Z' }),
      }),
    );
    const tree = await render();
    expect(textoDa(tree)).toContain('98');
    expect(textoDa(tree)).toMatch(/Última leitura às \d{2}:\d{2}/);
    expect(condicaoDoGrafico(tree)).toBe('neutral');
    expect(selosDeCoracao(tree)).toHaveLength(0);
  });

  it('reportando e sem condição aberta: silhueta boa e selo de coração', async () => {
    const tree = await render();
    expect(condicaoDoGrafico(tree)).toBe('good');
    expect(selosDeCoracao(tree).length).toBeGreaterThan(0);
  });

  it('condição só de aparelho não muda o estado de saúde', async () => {
    mockTelemetryState = lendo({ ...reporting(), conditions: [condition('DEVICE')] });
    expect(condicaoDoGrafico(await render())).toBe('good');
  });

  it('origem de demonstração é declarada na tela; a real não leva selo', async () => {
    mockTelemetryState = lendo(reporting({}, 'DEMO'));
    expect(textoDa(await render())).toContain('Dados de demonstração');

    mockTelemetryState = REPORTANDO();
    expect(textoDa(await render())).not.toContain('Dados de demonstração');
  });
});

// --- Badges de pendências ----------------------------------------------------

describe('dashboard: badges de relatórios e notificações', () => {
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

describe('dashboard: navegação', () => {
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

describe('dashboard: procedimento de evacuação (?alert=active)', () => {
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

  it('sem clima carregado, não inventa medição nem texto de alerta', async () => {
    const texto = textoDa(await render());
    expect(texto).toContain('--');
    expect(texto).not.toContain('17ºC');
    expect(texto).not.toContain('Chuva Intensa');
    expect(texto).not.toContain('Risco de desabamentos');
  });

  it('com alerta vigente, mostra a leitura e a descrição que vieram do backend', async () => {
    mockClima = {
      snapshot: {
        current: { tempC: 22.4, condition: 'storm', humidityPct: 88, windKmh: 47.6 },
        daily: { maxC: 27, minC: 15 },
        alerts: [],
        fetchedAt: '2026-06-23T12:00:00.000Z',
      },
      activeAlert: {
        id: 'wx-1',
        event: 'Tempestade',
        severity: 'PERIGO',
        description: 'Raios e rajadas fortes na próxima hora.',
        startsAt: '2026-06-23T11:00:00.000Z',
        endsAt: '2026-06-23T18:00:00.000Z',
      },
    };
    const texto = textoDa(await render());
    expect(texto).toContain('22ºC');
    expect(texto).toContain('Raios e rajadas fortes na próxima hora.');
  });

  it('ignora o estado da leitura: a tela de segurança sempre aparece', async () => {
    mockTelemetryState = FALHOU;
    const texto = textoDa(await render());
    expect(texto).toContain('Procedimento de evacuação');
    expect(texto).not.toContain('Leitura indisponível');
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
