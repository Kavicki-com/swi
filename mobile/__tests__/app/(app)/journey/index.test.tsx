import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Journey from '../../../../app/(app)/journey/index';
import type { Task } from '../../../../services/journey/types';

// Lista da jornada (app/(app)/journey/index.tsx). Três layouts saem do mesmo
// componente conforme o state do provider (idle / ongoing / paused), e o que
// muda entre eles é justamente o que o worker usa pra se orientar: o donut
// central, a seção "Em andamento" e os CTAs de finalizar/pausar.
//
// Dois detalhes com histórico de bug estão travados aqui: a data de "Hoje"
// (era a string 27/04/2026 cravada do mockup) e o refresh ao focar a tela
// (socket calado com o túnel caído deixava a tela desatualizada).

const mockPush = jest.fn();
// useFocusEffect roda o callback na montagem, como no foco real da rota.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));

const mockJourney = {
  loadStatus: 'ready' as 'idle' | 'loading' | 'ready' | 'empty' | 'error',
  tasks: [] as Task[],
  state: 'idle' as 'idle' | 'ongoing' | 'paused',
  activeTaskId: null as string | null,
  startedAt: null as string | null,
  accumulatedSeconds: 0,
  pauseJourney: jest.fn(),
  resumeJourney: jest.fn(),
  endJourney: jest.fn(),
  load: jest.fn(),
  refresh: jest.fn(),
};
jest.mock('../../../../services/journey/JourneyProvider', () => ({
  useJourney: () => mockJourney,
}));

const mockProfile: {
  profile: { fullName?: string; jobTitle?: string; duty?: string; avatarUrl?: string } | null;
} = { profile: null };
jest.mock('../../../../services/profile/ProfileProvider', () => ({
  useProfile: () => mockProfile,
}));

jest.mock('../../../../components/NavFABs', () => ({ NavFABs: () => null }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const tarefa = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Inspeção da correia',
  description: 'Setor B, correia 4',
  objective: 'Verificar desgaste',
  estimatedMinutes: 120,
  status: 'pending',
  startedAt: null,
  accumulatedSeconds: 0,
  progressPct: 0,
  images: [],
  responsibleCount: 1,
  responsibleNames: ['Ana Souza'],
  responsibleAvatars: ['https://example.test/a1.png'],
  ...over,
});

const arvores: ReturnType<typeof create>[] = [];

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Journey />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  arvores.push(tree);
  return tree;
};

// A tela em andamento arma um interval de 1s. Árvore que sobrevive ao teste
// segue tickando com timers reais, e um tick que cai depois do teardown do
// Jest vira erro de execução da suíte inteira, mesmo com os testes verdes.
// Desmontar tudo aqui corta o interval na fonte (desmontar de novo uma árvore
// que o próprio teste já desmontou é inofensivo).
afterEach(async () => {
  while (arvores.length) {
    const tree = arvores.pop()!;
    await act(async () => { tree.unmount(); });
  }
});

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

const acao = (tree: ReturnType<typeof create>, label: string): ReactTestInstance =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
  )[0];

const tocar = async (tree: ReturnType<typeof create>, label: string) => {
  await act(async () => { acao(tree, label).props.onPress(); });
};

const desabilitado = (tree: ReturnType<typeof create>, label: string) =>
  tree.root
    .findAll((n) => n.props?.accessibilityLabel === label)
    .some((n) => n.props?.disabled === true);

// O DonutChart do DS recebe value/label; é onde o tempo da jornada aparece.
const donut = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => typeof n.props?.value === 'string' && typeof n.props?.label === 'string',
  )[0].props as { value: string; label: string };

// Marcador da seção "Em andamento": o radio PREENCHIDO (bolinha teal de 10) só
// existe no card destacado. Procurar o texto "Em andamento" não serve, é
// também o rótulo do donut em qualquer estado ativo.
const temCardDestacado = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => n.props?.style?.backgroundColor === '#8AD2E2' && n.props?.style?.width === 10,
  ).length > 0;

beforeEach(() => {
  jest.clearAllMocks();
  mockJourney.loadStatus = 'ready';
  mockJourney.tasks = [];
  mockJourney.state = 'idle';
  mockJourney.activeTaskId = null;
  mockJourney.startedAt = null;
  mockJourney.accumulatedSeconds = 0;
  mockProfile.profile = null;
});

describe('Jornada: estados de carregamento', () => {
  it.each(['idle', 'loading'] as const)('%s mostra o carregando', async (s) => {
    mockJourney.loadStatus = s;
    const tree = await render();

    expect(textos(tree)).toContain('Carregando tarefas…');
  });

  it('sem tarefas mostra o vazio do dia', async () => {
    mockJourney.loadStatus = 'empty';
    const tree = await render();

    expect(textos(tree)).toContain('Nenhuma tarefa hoje');
  });

  it('erro oferece tentar de novo, ligado ao load do provider', async () => {
    mockJourney.loadStatus = 'error';
    const tree = await render();

    expect(textos(tree)).toContain('Não foi possível carregar');
    await tocar(tree, 'Tentar carregar as tarefas de novo');
    expect(mockJourney.load).toHaveBeenCalledTimes(1);
  });

  // Túnel caído deixa o socket calado; o foco da tela é a rede de segurança.
  it('ao focar a tela pede o estado de agora ao provider', async () => {
    await render();
    expect(mockJourney.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Jornada: cabeçalho', () => {
  it('mostra a data de hoje, não uma data cravada', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T09:00:00'));
    const tree = await render();

    expect(textos(tree)).toContain('06/08/2026');
    jest.useRealTimers();
  });

  it('junta cargo e função do perfil numa linha só', async () => {
    mockProfile.profile = {
      fullName: 'Ana Souza',
      jobTitle: 'Operadora de escavadeira',
      duty: 'Operação',
      avatarUrl: 'https://example.test/a1.png',
    };
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('Ana Souza');
    expect(t).toContain('Operadora de escavadeira · Operação');
  });

  // Melhor vazio do que o cargo de outra pessoa.
  it('perfil sem cargo nem função não mostra linha de cargo', async () => {
    mockProfile.profile = { fullName: 'Ana Souza' };
    const tree = await render();

    expect(textos(tree).some((s) => s.includes('·'))).toBe(false);
  });

  it('sem perfil nenhum a tela ainda renderiza', async () => {
    const tree = await render();
    expect(textos(tree)).toContain('Próximas tarefas');
  });
});

describe('Jornada: donut central', () => {
  it('parada, soma as horas estimadas só das tarefas pendentes', async () => {
    mockJourney.tasks = [
      tarefa({ id: 'a', estimatedMinutes: 120 }),
      tarefa({ id: 'b', estimatedMinutes: 120 }),
      tarefa({ id: 'c', estimatedMinutes: 120, status: 'done' }), // fora da conta
    ];
    const tree = await render();

    expect(donut(tree)).toMatchObject({ value: '4h', label: 'Não iniciadas' });
  });

  it('em andamento mostra o tempo real decorrido das âncoras da sessão', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T10:30:00.000Z'));
    mockJourney.state = 'ongoing';
    mockJourney.activeTaskId = 't1';
    mockJourney.tasks = [tarefa()];
    mockJourney.startedAt = '2026-08-06T10:00:00.000Z';

    const tree = await render();
    expect(donut(tree)).toMatchObject({ value: '0:30:00h', label: 'Em andamento' });

    // O tick do cliente avança o relógio na tela sem novo fetch. Os timers
    // falsos já movem o Date.now junto, então basta avançá-los.
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(donut(tree).value).toBe('0:30:05h');

    // Desmonta ANTES de voltar aos timers reais: o interval de 1s sobreviveria
    // ao teste e dispararia setState fora do act no meio da suíte seguinte.
    await act(async () => { tree.unmount(); });
    jest.useRealTimers();
  });

  // Pausado congela: startedAt volta a null e o rótulo avisa.
  it('pausado mostra o acumulado e o rótulo "Pausado"', async () => {
    mockJourney.state = 'paused';
    mockJourney.activeTaskId = 't1';
    mockJourney.tasks = [tarefa()];
    mockJourney.startedAt = null;
    mockJourney.accumulatedSeconds = 3725;

    const tree = await render();
    expect(donut(tree)).toMatchObject({ value: '1:02:05h', label: 'Pausado' });
  });
});

describe('Jornada: listas de tarefa', () => {
  it('parada, lista todas as tarefas e nenhuma seção "Em andamento"', async () => {
    mockJourney.tasks = [
      tarefa({ id: 'a', title: 'Tarefa A' }),
      tarefa({ id: 'b', title: 'Tarefa B' }),
    ];
    const tree = await render();

    expect(acao(tree, 'Tarefa A')).toBeDefined();
    expect(acao(tree, 'Tarefa B')).toBeDefined();
    expect(temCardDestacado(tree)).toBe(false);
  });

  it('em andamento destaca a ativa e a tira das próximas', async () => {
    mockJourney.state = 'ongoing';
    mockJourney.activeTaskId = 'a';
    mockJourney.tasks = [
      tarefa({ id: 'a', title: 'Tarefa A' }),
      tarefa({ id: 'b', title: 'Tarefa B' }),
    ];
    const tree = await render();

    expect(temCardDestacado(tree)).toBe(true);
    // A ativa aparece uma vez só (na seção de destaque), não duplicada.
    expect(
      tree.root.findAll(
        (n) =>
          n.props?.accessibilityLabel === 'Tarefa A' &&
          typeof n.props?.onPress === 'function',
      ),
    ).toHaveLength(1);
    expect(acao(tree, 'Tarefa B')).toBeDefined();
  });

  it('activeTaskId apontando para tarefa inexistente não quebra a tela', async () => {
    mockJourney.state = 'ongoing';
    mockJourney.activeTaskId = 'fantasma';
    mockJourney.tasks = [tarefa({ id: 'a', title: 'Tarefa A' })];
    const tree = await render();

    expect(temCardDestacado(tree)).toBe(false);
    expect(acao(tree, 'Tarefa A')).toBeDefined();
  });

  it('tocar numa tarefa abre o detalhe dela', async () => {
    mockJourney.tasks = [tarefa({ id: 'a', title: 'Tarefa A' })];
    const tree = await render();

    await tocar(tree, 'Tarefa A');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/journey/task/[id]',
      params: { id: 'a' },
    });
  });

  it('tocar na tarefa em destaque também abre o detalhe', async () => {
    mockJourney.state = 'ongoing';
    mockJourney.activeTaskId = 'a';
    mockJourney.tasks = [tarefa({ id: 'a', title: 'Tarefa A' })];
    const tree = await render();

    await tocar(tree, 'Tarefa A');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/journey/task/[id]',
      params: { id: 'a' },
    });
  });
});

describe('Jornada: CTAs de sessão', () => {
  it('parada não oferece finalizar nem pausar', async () => {
    const tree = await render();

    expect(acao(tree, 'Finalizar Jornada')).toBeUndefined();
    expect(acao(tree, 'Fazer pausa')).toBeUndefined();
  });

  it('em andamento finaliza a jornada inteira', async () => {
    mockJourney.state = 'ongoing';
    const tree = await render();

    await tocar(tree, 'Finalizar Jornada');
    expect(mockJourney.endJourney).toHaveBeenCalledTimes(1);
  });

  it('em andamento pausa; pausado retoma', async () => {
    mockJourney.state = 'ongoing';
    const emAndamento = await render();
    await tocar(emAndamento, 'Fazer pausa');
    expect(mockJourney.pauseJourney).toHaveBeenCalledTimes(1);

    mockJourney.state = 'paused';
    const pausada = await render();
    await tocar(pausada, 'Retomar jornada');
    expect(mockJourney.resumeJourney).toHaveBeenCalledTimes(1);
  });

  // Pausado não finaliza: é preciso retomar antes de encerrar o turno.
  it('pausado desabilita o finalizar e diz o motivo no rótulo', async () => {
    mockJourney.state = 'paused';
    const tree = await render();

    expect(
      desabilitado(tree, 'Finalizar Jornada (indisponível enquanto pausado)'),
    ).toBe(true);
  });
});
