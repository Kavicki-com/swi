import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { Alert, Linking, Platform } from 'react-native';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import MyStats from '../../../app/(app)/my-stats';
import type { Exam } from '../../../services/api/exams';
import type { SeriesPeriod } from '../../../services/telemetry/mySeries';
import { emptySeries, series, SERIES_DAY_START } from '../../../services/telemetry/mySeriesFixtures';
import {
  condition,
  metric,
  neverReported,
  reporting,
} from '../../../services/telemetry/myTelemetryFixtures';
import type { MySeriesState } from '../../../services/vitals/useMySeries';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';
import type { WatchDiagnosticsState } from '../../../services/telemetry/watchDiagnostics';
import type { WorkerTelemetry } from '../../../services/telemetry/myTelemetry';
import type { HealthConnectState } from '../../../services/telemetry/healthConnect/healthConnectReader';

// Meus dados (app/(app)/my-stats.tsx). Tela de leitura clínica: o que ela mostra
// tem que ser o que foi MEDIDO. Os sinais saem de me/current e o gasto calórico
// de me/series; sem leitura a tela declara a ausência ("--", "Sem medição") e
// segue inteira, porque alergias e exames não dependem do relógio. Outras três
// invariantes de dado real estão travadas aqui:
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

const lendo = (telemetry: MyTelemetryState['telemetry']): MyTelemetryState => ({
  telemetry,
  failed: false,
  loading: false,
});
const CARREGANDO: MyTelemetryState = { telemetry: null, failed: false, loading: true };
const FALHOU: MyTelemetryState = { telemetry: null, failed: true, loading: false };


// A tela pergunta ao módulo do relógio se este aparelho faz monitoramento.
// Em Jest o módulo não existe; o dublê diz "pronto" por padrão para os casos
// antigos, e "sem suporte" só onde o teste pede.
let mockSuporte: WatchDiagnosticsState = { support: 'ready' } as WatchDiagnosticsState;
jest.mock('../../../services/telemetry/watchDiagnostics', () => ({
  useWatchDiagnostics: () => mockSuporte,
}));

// O caminho da pulseira (Android com Health Connect) depende do gate e da
// plataforma, como no pareamento. Por padrão o gate real; o caso Android liga.
jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;
const { isFeatureEnabled: gateReal } = jest.requireActual('../../../lib/featureFlags');
const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

let mockTelemetryState: MyTelemetryState = CARREGANDO;
const mockRefreshTelemetry = jest.fn();
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetryState,
  useRefreshMyTelemetry: () => mockRefreshTelemetry,
}));

// O envio da telemetria (o real puxa a tarefa de segundo plano, módulo
// nativo). O padrão é o iPhone, sem Health Connect; a faixa de sincronização
// liga onde o teste pede.
let mockHealthConnect: HealthConnectState | null = null;
const mockSyncNow = jest.fn<Promise<void>, []>();
jest.mock('../../../services/telemetry/TelemetryUploadProvider', () => ({
  useTelemetryUploadState: () => ({
    healthConnect: mockHealthConnect,
    paired: true,
    syncing: mockSyncing,
    syncNow: mockSyncNow,
  }),
}));
let mockSyncing = false;

const serie = (s: MySeriesState['series']): MySeriesState => ({
  series: s,
  failed: false,
  loading: false,
});
let mockSeriesState: MySeriesState = serie(null);
const mockUseMySeries = jest.fn((_period: SeriesPeriod) => mockSeriesState);
jest.mock('../../../services/vitals/useMySeries', () => ({
  useMySeries: (period: SeriesPeriod) => mockUseMySeries(period),
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

const HORA = 60 * 60 * 1000;
const rotuloDaHora = (horas: number) =>
  `${String(new Date(Date.parse(SERIES_DAY_START) + horas * HORA).getHours()).padStart(2, '0')}h`;

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
  tree.root.findAll((n) => n.props?.accessibilityLabel === 'Tempo até o alerta de fadiga')[0].props as {
    value: number;
  };

// O gráfico de calorias do DS, ou undefined quando a tela pôs uma frase no lugar.
const graficoDeCalorias = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => Array.isArray(n.props?.points))[0]?.props as
    | { points: { time: string; kcal: number | null }[]; unit: string }
    | undefined;

// O anel do DS que leva o rótulo dado.
const anel = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.progress === 'number')[0]
    .props as { value: string; progress: number };

const filtroDePeriodo = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) =>
      n.props?.accessibilityLabel === 'Filtrar período' &&
      typeof n.props?.onChange === 'function',
  )[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockImplementation(gateReal);
  mockSuporte = { support: 'ready' } as WatchDiagnosticsState;
  mockTelemetryState = lendo(reporting());
  mockSeriesState = serie(series('day', [120, 80, 200]));
  mockProfile.profile = null;
  mockListExams.mockResolvedValue([]);
  mockHealthConnect = null;
  mockSyncing = false;
  mockSyncNow.mockReset();
  mockSyncNow.mockResolvedValue(undefined);
});

// Pulseira lida pelo Health Connect: dados até 50 min atrás, enviados há 3 min
// pelo relógio real (a faixa conta com o relógio do aparelho).
const pulseira = (): { telemetry: WorkerTelemetry; measuredUntil: string } => {
  const agora = Date.now();
  const measuredUntil = new Date(agora - 50 * 60_000).toISOString();
  return {
    measuredUntil,
    telemetry: {
      ...reporting(),
      sync: { measuredUntil, syncedAt: new Date(agora - 3 * 60_000).toISOString() },
    },
  };
};

const LENDO_HEALTH_CONNECT: HealthConnectState = {
  availability: 'available',
  permission: 'granted',
  bandPackage: 'com.huami.watch.hmwatchmanager',
  bandLabel: 'Zepp',
  noBand: false,
  lastSyncAt: null,
};

const clockOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const renderTela = () => render();

const faixaDe = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.testID === 'sync-banner')[0];

// O nó pressável do Button do DS com o rótulo visível dado.
const botaoComRotulo = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityLabel === label,
  )[0];

describe('Meus dados: faixa de sincronização da pulseira', () => {
  // A faixa tem o relógio de 5 s (useNow): árvore que fica montada dispara
  // render depois de o arquivo terminar. Cada caso desmonta as suas.
  const montadas: ReturnType<typeof create>[] = [];
  const render = async () => {
    const tree = await renderTela();
    montadas.push(tree);
    return tree;
  };
  // Relógio fixo ao meio-dia local: com o relógio real, entre 00:00 e 00:50
  // os 50 min de atraso caem no dia anterior e a faixa passa a mostrar a data.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));
  });
  afterEach(async () => {
    await act(async () => {
      montadas.splice(0).forEach((tree) => tree.unmount());
    });
    jest.useRealTimers();
  });

  it('sem sincronização (iPhone) não há faixa', async () => {
    const tree = await render();
    expect(faixaDe(tree)).toBeUndefined();
    expect(textos(tree)).not.toContain('Sincronizar agora');
  });

  it('com sincronização a faixa diz até quando há dado e quando o celular enviou', async () => {
    const { telemetry, measuredUntil } = pulseira();
    mockTelemetryState = lendo(telemetry);
    const tree = await render();

    expect(faixaDe(tree)).toBeDefined();
    expect(textos(tree)).toContain(
      `Dados até ${clockOf(measuredUntil)} · sincronizado há 3 min`,
    );
    expect(textos(tree)).not.toContain('Monitorando agora');
  });

  it('o botão só existe quando este celular lê o Health Connect', async () => {
    mockTelemetryState = lendo(pulseira().telemetry);
    const semLeitor = await render();
    expect(botaoComRotulo(semLeitor, 'Sincronizar agora')).toBeUndefined();

    mockHealthConnect = LENDO_HEALTH_CONNECT;
    const comLeitor = await render();
    expect(botaoComRotulo(comLeitor, 'Sincronizar agora')).toBeDefined();
  });

  it('o toque sincroniza uma vez e relê a leitura no fim', async () => {
    mockTelemetryState = lendo(pulseira().telemetry);
    mockHealthConnect = LENDO_HEALTH_CONNECT;
    let terminar!: () => void;
    mockSyncNow.mockReturnValue(
      new Promise<void>((resolve) => {
        terminar = resolve;
      }),
    );
    const tree = await render();

    await act(async () => {
      botaoComRotulo(tree, 'Sincronizar agora').props.onPress();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockRefreshTelemetry).not.toHaveBeenCalled();

    await act(async () => {
      terminar();
    });
    expect(mockRefreshTelemetry).toHaveBeenCalledTimes(1);
  });

  // O progresso é o `syncing` do contexto do envio (o fluxo inteiro, com o
  // estado mudando, está em SyncBanner.test.tsx).
  it('com a sincronização em curso mostra o progresso, desabilitado', async () => {
    mockTelemetryState = lendo(pulseira().telemetry);
    mockHealthConnect = LENDO_HEALTH_CONNECT;
    mockSyncing = true;
    const tree = await render();

    expect(botaoComRotulo(tree, 'Sincronizar agora')).toBeUndefined();
    const emCurso = botaoComRotulo(tree, 'Sincronizando…');
    expect(emCurso.props.accessibilityState).toEqual({ disabled: true });
  });
});

describe('Meus dados: leitura ausente', () => {
  // Carregando, sem leitura e falha não trocam a tela: alergias e exames são
  // dado real do cadastro e não podem sumir porque o relógio não respondeu.
  it.each([
    ['carregando', CARREGANDO, 'Carregando leitura'],
    ['quem nunca reportou', lendo(neverReported()), 'Sem leitura do aparelho'],
    ['falha na leitura', FALHOU, 'Leitura indisponível no momento'],
  ])('%s: a tela fica inteira, com a ausência declarada', async (_caso, estado, frase) => {
    mockTelemetryState = estado;
    mockSeriesState = serie(emptySeries('day', 3));
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain(frase);
    expect(t).toContain('--');
    expect(t).toContain('Sem medição');
    expect(t).toContain('Tempo até o alerta de fadiga: sem estimativa');
    expect(t).toContain('Bateria do aparelho: sem leitura');
    expect(t).toContain('Alergias');
    expect(t).toContain('Histórico Médico');
  });

  it('sem leitura nenhum anel finge progresso e a barra de fadiga fica vazia', async () => {
    mockTelemetryState = lendo(neverReported());
    const tree = await render();

    for (const rotulo of ['Esforço feito', 'Oxigenação', 'Sem medição', 'por hora']) {
      expect(anel(tree, rotulo)).toMatchObject({ value: '--', progress: 0 });
    }
    expect(barraDeFadiga(tree).value).toBe(0);
  });

  it('aparelho sem o módulo do relógio: a linha de estado diz que este aparelho não monitora', async () => {
    mockSuporte = { support: 'unsupported' };
    mockTelemetryState = lendo(neverReported());
    mockSeriesState = serie(emptySeries('day', 3));
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('Este aparelho não faz o monitoramento');
    expect(t).not.toContain('Sem leitura do aparelho');
    expect(t).toContain('Alergias');
    expect(t).toContain('Histórico Médico');
  });

  it('Android com a pulseira pelo Health Connect não é "sem suporte"', async () => {
    naPlataforma('android');
    mockGate.mockImplementation((gate) => gate === 'healthConnect');
    mockSuporte = { support: 'unsupported' };
    mockTelemetryState = lendo(neverReported());
    mockSeriesState = serie(emptySeries('day', 3));
    try {
      const t = textos(await render());
      expect(t).toContain('Sem leitura do aparelho');
      expect(t).not.toContain('Este aparelho não faz o monitoramento');
    } finally {
      naPlataforma(originalOS);
    }
  });
});

describe('Meus dados: gráfico de status', () => {
  it('reportando e sem condição aberta: gráfico bom, com o badge', async () => {
    const tree = await render();

    expect(grafico(tree)).toMatchObject({ condition: 'good', renderHeartStatus: true });
  });

  // O estado vem das condições abertas no backend.
  it.each([
    ['HEALTH', 'alert'],
    ['URGENT', 'low'],
  ] as const)('condição %s tinge o gráfico de %s e mostra o badge', async (categoria, cond) => {
    mockTelemetryState = lendo({ ...reporting(), conditions: [condition(categoria)] });
    const tree = await render();

    expect(grafico(tree)).toMatchObject({ condition: cond, renderHeartStatus: true });
  });

  // Sem medição a silhueta fica neutra e o peito vazio: nem cor nem badge
  // podem afirmar saúde que ninguém aferiu.
  it.each([
    ['nunca reportou', lendo(neverReported())],
    ['falha', FALHOU],
    [
      'leitura velha',
      lendo(reporting({ heartRate: metric(98, { quality: 'STALE' }) })),
    ],
  ])('%s: gráfico neutro, sem o badge do peito', async (_caso, estado) => {
    mockTelemetryState = estado;
    const tree = await render();

    expect(grafico(tree)).toMatchObject({ condition: 'neutral', renderHeartStatus: false });
  });
});

describe('Meus dados: sinais vitais e fadiga', () => {
  it('mostra batimento, pressão e calorias medidos', async () => {
    mockTelemetryState = lendo(
      reporting({
        heartRate: metric(118),
        bloodPressure: metric({ systolic: 130, diastolic: 90 }),
        energyRatePerHour: { ...metric(184.2), calculating: false },
      }),
    );
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('118');
    expect(t).toContain('130/90');
    expect(t).toContain('184');
    expect(t).toContain('Monitorando agora');
  });

  it('pressão é medição pontual: o rótulo traz o horário, nunca um juízo', async () => {
    mockTelemetryState = lendo(
      reporting({ bloodPressure: metric({ systolic: 130, diastolic: 90 }) }),
    );
    const t = textos(await render());

    expect(t.some((s) => /^Às \d{2}:\d{2}$/.test(String(s)))).toBe(true);
    expect(t).not.toContain('Boa');
  });

  it('a barra de fadiga usa inteiro, não float', async () => {
    mockTelemetryState = lendo(reporting({ wear: metric(74.4) }));
    const tree = await render();

    expect(barraDeFadiga(tree).value).toBe(74);
  });

  it('o tempo até a fadiga sai do valor real, não de texto fixo', async () => {
    mockTelemetryState = lendo(reporting({ fatigueEtaMin: metric(105) }));
    const tree = await render();

    expect(textos(tree)).toContain('Tempo até o alerta de fadiga: 1h45m');
  });

  it('esforço, oxigenação e distância saem da leitura, com vírgula decimal', async () => {
    mockTelemetryState = lendo(
      reporting({
        effort: metric(62.5),
        oxygenSaturation: metric(97.5),
        steps: metric(4210),
        distance: metric(3400),
      }),
    );
    const tree = await render();

    expect(anel(tree, 'Esforço feito')).toMatchObject({ value: '62,5%', progress: 62.5 });
    expect(anel(tree, 'Oxigenação')).toMatchObject({ value: '97,5%', progress: 97.5 });
    expect(anel(tree, '3,40km')).toMatchObject({ value: '4210', progress: 100 });
    expect(anel(tree, 'por hora')).toMatchObject({ value: '310 kcal', progress: 100 });
  });

  it('oxigenação é medição pontual: a tela diz de quando é', async () => {
    mockTelemetryState = lendo(reporting({ oxygenSaturation: metric(97.5) }));
    const t = textos(await render());

    expect(t.some((s) => /^Oxigenação: última medição às \d{2}:\d{2}$/.test(String(s)))).toBe(
      true,
    );
  });

  it('mostra a bateria do aparelho', async () => {
    mockTelemetryState = lendo(reporting({ battery: metric(82) }));

    expect(textos(await render())).toContain('Bateria do aparelho: 82%');
  });

  it('origem de demonstração é declarada; a real não leva selo', async () => {
    mockTelemetryState = lendo(reporting({}, 'DEMO'));
    expect(textos(await render())).toContain('Monitorando agora · Dados de demonstração');

    mockTelemetryState = lendo(reporting());
    expect(textos(await render()).join('\n')).not.toContain('Dados de demonstração');
  });
});

describe('Meus dados: gasto calórico', () => {
  it('os pontos saem da série do backend, em kcal por hora no dia', async () => {
    const tree = await render();

    expect(mockUseMySeries).toHaveBeenLastCalledWith('day');
    expect(graficoDeCalorias(tree)).toMatchObject({
      unit: 'kcal/h',
      points: [
        { time: rotuloDaHora(0), kcal: 120 },
        { time: rotuloDaHora(1), kcal: 80 },
        { time: rotuloDaHora(2), kcal: 200 },
      ],
    });
  });

  it.each([
    ['week', 'kcal/dia'],
    ['month', 'kcal/dia'],
  ] as const)('o filtro pede a série do período %s ao backend', async (periodo, unidade) => {
    const tree = await render();
    expect(filtroDePeriodo(tree).props.value).toBe('day');

    mockSeriesState = serie(series(periodo, [1500, 1700, 1900]));
    await act(async () => { filtroDePeriodo(tree).props.onChange(periodo); });

    expect(filtroDePeriodo(tree).props.value).toBe(periodo);
    expect(mockUseMySeries).toHaveBeenLastCalledWith(periodo);
    expect(graficoDeCalorias(tree)?.unit).toBe(unidade);
  });

  it.each([
    ['carregando', { series: null, failed: false, loading: true }, 'Carregando série'],
    ['falha', { series: null, failed: true, loading: false }, 'Série indisponível no momento'],
    ['sem medição', serie(emptySeries('day', 3)), 'Sem medição no período'],
  ])('%s: uma frase no lugar do gráfico, nunca um ponto inventado', async (_caso, estado, frase) => {
    mockSeriesState = estado;
    const tree = await render();

    expect(graficoDeCalorias(tree)).toBeUndefined();
    expect(textos(tree)).toContain(frase);
  });

  it('balde sem medição chega ao gráfico como buraco, não como zero', async () => {
    mockSeriesState = serie(series('day', [120, null, 200]));
    const tree = await render();

    expect(graficoDeCalorias(tree)?.points[1]).toEqual({ time: rotuloDaHora(1), kcal: null });
  });

  it('série de demonstração leva o selo mesmo com a leitura atual real', async () => {
    mockSeriesState = serie(series('day', [120, 80], 'DEMO'));

    expect(textos(await render())).toContain('Dados de demonstração');
  });
});

describe('Meus dados: alergias do cadastro', () => {
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

describe('Meus dados: histórico médico', () => {
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

  // A URL vem do JSON da API e ia direto pro navegador do aparelho. Agora passa
  // por resolveTrustedMediaUrl, que só libera origem autorizada: a da própria
  // API ou uma de EXPO_PUBLIC_MEDIA_ORIGINS. Sob a suíte a API é
  // http://localhost:3000, então é essa a origem que o exame precisa ter.
  const baixar = async (tree: ReturnType<typeof create>) => {
    await act(async () => {
      tree.root
        .findAll((n) => n.props?.accessibilityLabel === 'Baixar Audiometria')[0]
        .props.onActionPress();
    });
  };

  it('baixar o exame abre a url do arquivo', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const url = 'http://localhost:3000/media/e1.pdf';
    mockListExams.mockResolvedValue([exame({ fileUrl: url })]);
    const tree = await render();

    await baixar(tree);

    expect(abrir).toHaveBeenCalledWith(url);
    abrir.mockRestore();
  });

  // O que se perde se isto quebrar: um registro adulterado no banco, ou uma
  // resposta forjada, faz o app abrir o endereço de quem atacou. Recusar em
  // silêncio seria quase tão ruim, porque o usuário tocaria no card e nada
  // aconteceria sem explicação.
  it('exame de origem não autorizada não abre, e o usuário fica sabendo', async () => {
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockListExams.mockResolvedValue([exame({ fileUrl: 'https://invasor.test/e1.pdf' })]);
    const tree = await render();

    await baixar(tree);

    expect(abrir).not.toHaveBeenCalled();
    expect(alerta).toHaveBeenCalled();
    abrir.mockRestore();
    alerta.mockRestore();
  });

  // Enviar acontece no settings, onde estão os campos de nome e validade.
  it('enviar novo exame leva para os dados de saúde', async () => {
    const tree = await render();
    await tocar(tree, 'Enviar novo exame');

    expect(mockPush).toHaveBeenCalledWith('/(app)/settings/health-data');
  });
});
