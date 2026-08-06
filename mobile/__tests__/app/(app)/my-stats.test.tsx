import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MyStats from '../../../app/(app)/my-stats';
import type { Vitals, WorkerStatus } from '../../../services/vitals/types';
import type { Exam } from '../../../services/api/exams';

// Meus dados (app/(app)/my-stats.tsx). Tela de leitura clínica: o que ela mostra
// tem que ser o que foi MEDIDO. Três correções de QA com histórico de dado
// inventado estão travadas aqui:
//   - alergias saem do cadastro real, não da lista fixa "Buscopan, Dipirona,
//     Chocolate, Camarão" que aparecia para qualquer pessoa;
//   - o histórico médico são os exames do backend, não 4 exames escritos na tela;
//   - o gráfico de status é tintado por `condition`, então trabalhador em alerta
//     não pode aparecer verde e saudável como acontecia com o PNG estático.
// Sem status conhecido o badge do peito não renderiza: melhor vazio que um
// check que ninguém mediu.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockListExams = jest.fn();
jest.mock('../../../services/api/exams', () => ({ listExams: () => mockListExams() }));

const mockVitals: {
  phase: 'loading' | 'ready' | 'empty' | 'stale' | 'error';
  vitals: Vitals | null;
  status: WorkerStatus;
  lastUpdated: number | null;
  history: { caloriesPerHour: number }[];
} = { phase: 'ready', vitals: null, status: 'good', lastUpdated: null, history: [] };
jest.mock('../../../services/vitals/VitalsProvider', () => ({
  useVitals: () => mockVitals,
}));

const mockProfile: {
  profile: { fullName?: string; avatarUrl?: string; allergies?: string } | null;
} = { profile: null };
jest.mock('../../../services/profile/ProfileProvider', () => ({
  useProfile: () => mockProfile,
}));

jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const sinais = (over: Partial<Vitals> = {}): Vitals => ({
  heartRate: 67,
  bloodPressureSys: 12,
  bloodPressureDia: 8,
  oxygenation: 97.5,
  caloriesPerHour: 145,
  steps: 4210,
  distanceKm: 3.4,
  effortPct: 62.5,
  fatiguePct: 74.4,
  fatigueEtaMin: 105,
  ...over,
});

const exame = (over: Partial<Exam> = {}): Exam => ({
  id: 'e1',
  name: 'Audiometria',
  date: '2027-03-05',
  fileUrl: 'https://example.test/e1.pdf',
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <MyStats />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string' || typeof n.props?.children === 'number')
    .map((n) => n.props.children as string | number);

const acao = (tree: ReturnType<typeof create>, label: string): ReactTestInstance =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  )[0];

const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  await act(async () => { acao(tree, label).props.onPress(); });
};

// O gráfico de status do DS recebe condition + renderHeartStatus.
const grafico = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === 'Status de saude')[0].props as {
    condition: string;
    renderHeartStatus: boolean;
  };

const barraDeFadiga = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.accessibilityLabel === 'Tempo até fadiga total')[0].props as {
    value: number;
  };

const pontosDoGrafico = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => Array.isArray(n.props?.points))[0].props.points as {
    time: string;
    kcal: number;
  }[];

const filtroDePeriodo = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) =>
      n.props?.accessibilityLabel === 'Filtrar período' &&
      typeof n.props?.onChange === 'function',
  )[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockVitals.phase = 'ready';
  mockVitals.vitals = sinais();
  mockVitals.status = 'good';
  mockVitals.lastUpdated = null;
  mockVitals.history = [];
  mockProfile.profile = null;
  mockListExams.mockResolvedValue([]);
});

describe('Meus dados — fases do provider', () => {
  it('carregando mostra só o estado de carregamento', async () => {
    mockVitals.phase = 'loading';
    const tree = await render();

    expect(textos(tree)).toContain('Carregando seus dados…');
    expect(textos(tree)).not.toContain('Histórico Médico');
  });

  it('sem leituras convida a conectar a smartband', async () => {
    mockVitals.phase = 'empty';
    mockVitals.vitals = null;
    const tree = await render();

    expect(textos(tree)).toContain('Sem leituras ainda');
  });

  it('erro mostra a falha com botão de tentar de novo', async () => {
    mockVitals.phase = 'error';
    const tree = await render();

    expect(textos(tree)).toContain('Não foi possível carregar');
    expect(acao(tree, 'Tentar carregar os dados de novo')).toBeDefined();
  });

  // Dado velho não pode passar por dado de agora: entra o selo de idade.
  it('dado velho ganha o selo "atualizado há…"', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T10:05:00.000Z'));
    mockVitals.phase = 'stale';
    mockVitals.lastUpdated = new Date('2026-08-06T10:03:00.000Z').getTime();

    const tree = await render();
    expect(textos(tree)).toContain('atualizado há 2min');

    jest.useRealTimers();
  });

  it('menos de um minuto de idade aparece em segundos', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T10:00:45.000Z'));
    mockVitals.phase = 'stale';
    mockVitals.lastUpdated = new Date('2026-08-06T10:00:15.000Z').getTime();

    const tree = await render();
    expect(textos(tree)).toContain('atualizado há 30s');

    jest.useRealTimers();
  });

  it('sem marca de tempo o selo diz "atualizado agora"', async () => {
    mockVitals.phase = 'stale';
    mockVitals.lastUpdated = null;
    const tree = await render();

    expect(textos(tree)).toContain('atualizado agora');
  });
});

describe('Meus dados — gráfico de status', () => {
  it.each([
    ['good', 'good'],
    ['alert', 'alert'],
    ['low', 'low'],
  ] as const)('status %s tinge o gráfico e mostra o badge', async (status, cond) => {
    mockVitals.status = status;
    const tree = await render();

    expect(grafico(tree)).toMatchObject({ condition: cond, renderHeartStatus: true });
  });

  // Sem medição: o gráfico precisa de UMA cor (cai em good), mas o badge do
  // peito não pode afirmar saúde que ninguém aferiu.
  it('status desconhecido pinta de good mas esconde o badge do peito', async () => {
    mockVitals.status = 'unknown';
    const tree = await render();

    expect(grafico(tree)).toMatchObject({ condition: 'good', renderHeartStatus: false });
  });
});

describe('Meus dados — sinais vitais e fadiga', () => {
  it('mostra batimento, pressão e calorias medidos', async () => {
    mockVitals.vitals = sinais({
      heartRate: 118,
      bloodPressureSys: 13,
      bloodPressureDia: 9,
      caloriesPerHour: 184,
    });
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain(118);
    expect(t).toContain('13/9');
    expect(t).toContain(184);
  });

  it('a barra de fadiga usa inteiro, não float', async () => {
    mockVitals.vitals = sinais({ fatiguePct: 74.4 });
    const tree = await render();

    expect(barraDeFadiga(tree).value).toBe(74);
  });

  it('o tempo até a fadiga sai do valor real, não de texto fixo', async () => {
    mockVitals.vitals = sinais({ fatigueEtaMin: 105 });
    const tree = await render();

    expect(textos(tree)).toContain('Tempo até atingir fadiga total: 1h45m');
  });

  it('percentuais aparecem com vírgula decimal', async () => {
    mockVitals.vitals = sinais({ effortPct: 62.5, oxygenation: 97.5, distanceKm: 3.4 });
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('62,5%');
    expect(t).toContain('97,5%');
    expect(t).toContain('3,40km');
  });
});

describe('Meus dados — gasto calórico', () => {
  it('usa as três últimas amostras do histórico', async () => {
    mockVitals.history = [
      { caloriesPerHour: 100 },
      { caloriesPerHour: 120 },
      { caloriesPerHour: 140 },
      { caloriesPerHour: 160 },
    ];
    const tree = await render();

    expect(pontosDoGrafico(tree)).toEqual([
      { time: '-2', kcal: 120 },
      { time: '-1', kcal: 140 },
      { time: '-0', kcal: 160 },
    ]);
  });

  // Histórico ainda esquentando: melhor um ponto do que gráfico vazio.
  it('sem histórico cai no valor atual em vez de gráfico vazio', async () => {
    mockVitals.history = [];
    mockVitals.vitals = sinais({ caloriesPerHour: 145 });
    const tree = await render();

    expect(pontosDoGrafico(tree)).toEqual([{ time: '0', kcal: 145 }]);
  });

  it('o filtro de período troca de valor', async () => {
    const tree = await render();

    expect(filtroDePeriodo(tree).props.value).toBe('today');
    await act(async () => { filtroDePeriodo(tree).props.onChange('week'); });
    expect(filtroDePeriodo(tree).props.value).toBe('week');
  });
});

describe('Meus dados — alergias do cadastro', () => {
  it('quebra o texto do cadastro em chips por vírgula, ponto e vírgula e linha', async () => {
    mockProfile.profile = { allergies: 'Dipirona, Camarão; Látex\nPólen' };
    const tree = await render();

    for (const alergia of ['Dipirona', 'Camarão', 'Látex', 'Pólen']) {
      expect(
        tree.root.findAll((n) => n.props?.accessibilityLabel === alergia).length,
      ).toBeGreaterThan(0);
    }
  });

  // O que não foi informado não pode virar informação clínica inventada.
  it('sem alergias informadas diz isso, em vez de listar remédios', async () => {
    mockProfile.profile = { allergies: '' };
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('Nenhuma alergia informada.');
    expect(t).not.toContain('Dipirona');
  });

  it('separadores vazios não viram chips em branco', async () => {
    mockProfile.profile = { allergies: 'Dipirona,,  ;\n' };
    const tree = await render();

    expect(textos(tree)).not.toContain('Nenhuma alergia informada.');
    expect(tree.root.findAll((n) => n.props?.accessibilityLabel === '').length).toBe(0);
  });

  it('editar alergias leva para os dados de saúde', async () => {
    const tree = await render();
    await tocar(tree, 'Editar alergias');

    expect(mockPush).toHaveBeenCalledWith('/(app)/settings/health-data');
  });
});

describe('Meus dados — histórico médico', () => {
  it('lista os exames do backend com ano e dia/mês separados', async () => {
    mockListExams.mockResolvedValue([
      exame({ id: 'e1', name: 'Audiometria', date: '2027-03-05' }),
    ]);
    const tree = await render();

    const card = tree.root.findAll((n) => n.props?.accessibilityLabel === 'Baixar Audiometria')[0];
    expect(card.props).toMatchObject({ year: '2027', date: '05 Mar', examName: 'Audiometria' });
  });

  it('sem exames enviados diz isso, em vez de exames de exemplo', async () => {
    mockListExams.mockResolvedValue([]);
    const tree = await render();

    expect(textos(tree)).toContain('Nenhum exame enviado.');
  });

  it('falha ao listar exames não derruba a tela', async () => {
    mockListExams.mockRejectedValue(new Error('rede'));
    const tree = await render();

    expect(textos(tree)).toContain('Nenhum exame enviado.');
  });

  it('baixar o exame abre a url do arquivo', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockListExams.mockResolvedValue([exame({ fileUrl: 'https://example.test/e1.pdf' })]);
    const tree = await render();

    await act(async () => {
      tree.root
        .findAll((n) => n.props?.accessibilityLabel === 'Baixar Audiometria')[0]
        .props.onActionPress();
    });

    expect(abrir).toHaveBeenCalledWith('https://example.test/e1.pdf');
    abrir.mockRestore();
  });

  // Enviar acontece no settings, onde estão os campos de nome e validade.
  it('enviar novo exame leva para os dados de saúde', async () => {
    const tree = await render();
    await tocar(tree, 'Enviar novo exame');

    expect(mockPush).toHaveBeenCalledWith('/(app)/settings/health-data');
  });
});
