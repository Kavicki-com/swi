import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import TaskDetails from '../../../../app/(app)/journey/task/[id]';
import type { Task } from '../../../../services/journey/types';

// Detalhe da tarefa (app/(app)/journey/task/[id].tsx). É a tela onde o worker
// FINALIZA e CANCELA tarefa, e essas duas ações são auditadas no backend: se a
// mutação falha, a tela não pode navegar como se tivesse dado certo. Boa parte
// desta suíte cerca exatamente isso, junto com:
//   - a máquina de estados de carregamento (loading / não encontrada / erro)
//   - a cópia viva do provider ganhando do snapshot carregado uma vez
//   - o progresso que tick-a de segundo em segundo só quando está in_progress
//   - os 5 slots de foto e o guarda de slots cheios

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { id?: string } = { id: 't1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

const mockShowPicker = jest.fn();
jest.mock('../../../../lib/media/useMediaPicker', () => ({
  useMediaPicker: () => ({
    showPicker: mockShowPicker,
    takePhoto: jest.fn(),
    pickFromGallery: jest.fn(),
  }),
}));

const mockJourney = {
  getTask: jest.fn(),
  tasks: [] as Task[],
  startTask: jest.fn(),
  completeTask: jest.fn(),
  cancelTask: jest.fn(),
  pauseJourney: jest.fn(),
  resumeJourney: jest.fn(),
  addTaskPhoto: jest.fn(),
  state: 'idle' as 'idle' | 'ongoing' | 'paused',
  activeTaskId: null as string | null,
};
jest.mock('../../../../services/journey/JourneyProvider', () => ({
  useJourney: () => mockJourney,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const tarefa = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Inspeção da correia',
  description: 'Setor B, correia transportadora 4',
  objective: 'Verificar desgaste e alinhamento',
  estimatedMinutes: 120,
  status: 'pending',
  startedAt: null,
  accumulatedSeconds: 0,
  progressPct: 0,
  images: [],
  responsibleCount: 3,
  responsibleNames: ['Ana Souza', 'Bruno Lima', 'Carla Dias'],
  responsibleAvatars: [
    'https://example.test/a1.png',
    'https://example.test/a2.png',
    'https://example.test/a3.png',
  ],
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <TaskDetails />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

// Nó pressável de um rótulo de acessibilidade (o Button do DS repassa onPress).
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

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 't1' };
  mockJourney.tasks = [];
  mockJourney.state = 'idle';
  mockJourney.activeTaskId = null;
  mockJourney.getTask.mockResolvedValue(tarefa());
  mockJourney.completeTask.mockResolvedValue(undefined);
  mockJourney.cancelTask.mockResolvedValue(undefined);
  mockJourney.addTaskPhoto.mockResolvedValue(undefined);
  mockShowPicker.mockResolvedValue(null);
});

describe('Detalhe da tarefa — máquina de carregamento', () => {
  it('mostra o carregando enquanto a busca não resolve', async () => {
    mockJourney.getTask.mockReturnValue(new Promise(() => {}));
    const tree = await render();

    expect(textos(tree)).toContain('Carregando tarefa…');
  });

  it('tarefa inexistente vira "não encontrada", não erro', async () => {
    mockJourney.getTask.mockResolvedValue(null);
    const tree = await render();

    expect(textos(tree)).toContain('Tarefa não encontrada');
  });

  // Rota sem param: buscar getTask(undefined) só produziria um erro pior.
  it('sem id na rota nem chama o backend: já mostra "não encontrada"', async () => {
    mockParams = {};
    const tree = await render();

    expect(mockJourney.getTask).not.toHaveBeenCalled();
    expect(textos(tree)).toContain('Tarefa não encontrada');
  });

  it('falha na busca mostra o erro com botão de tentar de novo', async () => {
    mockJourney.getTask.mockRejectedValue(new Error('rede'));
    const tree = await render();

    expect(textos(tree)).toContain('Não foi possível carregar');
    expect(acao(tree, 'Tentar carregar a tarefa de novo')).toBeDefined();
  });

  it('o retry busca de novo e a tela chega ao conteúdo', async () => {
    mockJourney.getTask.mockRejectedValueOnce(new Error('rede'));
    const tree = await render();

    mockJourney.getTask.mockResolvedValue(tarefa());
    await tocar(tree, 'Tentar carregar a tarefa de novo');

    expect(mockJourney.getTask).toHaveBeenCalledTimes(2);
    expect(textos(tree)).toContain('Verificar desgaste e alinhamento');
  });

  it('o estado "não encontrada" não oferece retry', async () => {
    mockJourney.getTask.mockResolvedValue(null);
    const tree = await render();

    expect(acao(tree, 'Tentar carregar a tarefa de novo')).toBeUndefined();
  });
});

describe('Detalhe da tarefa — conteúdo', () => {
  it('mostra breadcrumb, resumo, objetivo e tempo estimado em horas', async () => {
    const tree = await render();
    const t = textos(tree);

    expect(t).toContain('Jornada');
    expect(t).toContain('Inspeção da correia');
    expect(t).toContain('Setor B, correia transportadora 4');
    expect(t).toContain('Verificar desgaste e alinhamento');
    expect(t).toContain('2h até a conclusão'); // 120 min
  });

  it('o breadcrumb volta para a jornada', async () => {
    const tree = await render();
    await tocar(tree, 'Voltar para Jornada');

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('a legenda de interessados usa o primeiro nome e o total menos um', async () => {
    const tree = await render();

    expect(textos(tree)).toContain(
      'Ana Souza e mais 2 pessoas estão acompanhando essa tarefa',
    );
  });

  it('sem nomes de responsável cai no nome padrão em vez de "undefined"', async () => {
    mockJourney.getTask.mockResolvedValue(
      tarefa({ responsibleNames: [], responsibleAvatars: [], responsibleCount: 1 }),
    );
    const tree = await render();

    expect(textos(tree)).toContain(
      'Joacir Alves e mais 0 pessoas estão acompanhando essa tarefa',
    );
  });

  // O snapshot local é carregado uma vez; quem manda depois é o provider, pra
  // que iniciar/pausar/finalizar nesta tela apareça na hora.
  it('a cópia viva do provider ganha do snapshot carregado', async () => {
    mockJourney.getTask.mockResolvedValue(tarefa({ title: 'Título velho' }));
    mockJourney.tasks = [tarefa({ title: 'Título atualizado' })];
    const tree = await render();

    const t = textos(tree);
    expect(t).toContain('Título atualizado');
    expect(t).not.toContain('Título velho');
  });

  it('se o provider ainda não tem a tarefa, usa o snapshot local', async () => {
    mockJourney.tasks = [tarefa({ id: 'outra', title: 'Outra tarefa' })];
    const tree = await render();

    expect(textos(tree)).toContain('Inspeção da correia');
  });
});

describe('Detalhe da tarefa — progresso', () => {
  it('parada, mostra o snapshot persistido arredondado', async () => {
    mockJourney.getTask.mockResolvedValue(tarefa({ progressPct: 42.7 }));
    const tree = await render();

    expect(tree.root.findAll((n) => typeof n.props?.value === 'number')[0].props.value).toBe(43);
  });

  // Em andamento o valor deriva das âncoras reais e avança de segundo em
  // segundo; sem o tick a barra ficaria congelada no valor do carregamento.
  it('em andamento deriva das âncoras e avança com o relógio', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T10:30:00.000Z'));
    // 30 min de 120 estimados = 25%.
    mockJourney.getTask.mockResolvedValue(
      tarefa({
        status: 'in_progress',
        startedAt: '2026-08-06T10:00:00.000Z',
        accumulatedSeconds: 0,
        progressPct: 0,
      }),
    );

    const tree = await render();
    const barra = () => tree.root.findAll((n) => typeof n.props?.value === 'number')[0].props.value;
    expect(barra()).toBe(25);

    // +36 min → 66 min de 120 = 55%.
    await act(async () => {
      jest.setSystemTime(new Date('2026-08-06T11:06:00.000Z'));
      jest.advanceTimersByTime(1000);
    });
    expect(barra()).toBe(55);

    // Desmonta ANTES de voltar aos timers reais: o interval de 1s sobreviveria
    // ao teste e dispararia setState fora do act no meio da suíte seguinte.
    await act(async () => { tree.unmount(); });
    jest.useRealTimers();
  });
});

describe('Detalhe da tarefa — fotos da solicitação', () => {
  it('rotula slot cheio como foto e slot vazio como adicionar', async () => {
    mockJourney.getTask.mockResolvedValue(
      tarefa({ images: ['https://example.test/f1.png', 'https://example.test/f2.png'] }),
    );
    const tree = await render();

    expect(acao(tree, 'Foto 1')).toBeDefined();
    expect(acao(tree, 'Foto 2')).toBeDefined();
    expect(acao(tree, 'Adicionar foto 3')).toBeDefined();
    expect(acao(tree, 'Adicionar foto 5')).toBeDefined();
  });

  it('escolher uma imagem manda a foto para o backend com o id da tarefa', async () => {
    mockShowPicker.mockResolvedValue('file:///nova.jpg');
    const tree = await render();

    await tocar(tree, 'Adicionar foto 1');

    expect(mockJourney.addTaskPhoto).toHaveBeenCalledWith('t1', 'file:///nova.jpg');
  });

  it('cancelar o seletor não manda nada', async () => {
    mockShowPicker.mockResolvedValue(null);
    const tree = await render();

    await tocar(tree, 'Adicionar foto 1');

    expect(mockJourney.addTaskPhoto).not.toHaveBeenCalled();
  });

  // Com os 5 slots cheios um append viraria images[5], que nunca renderiza.
  it('com os cinco slots cheios o seletor não abre', async () => {
    mockJourney.getTask.mockResolvedValue(
      tarefa({ images: Array.from({ length: 5 }, (_, i) => `https://example.test/f${i}.png`) }),
    );
    const tree = await render();

    await tocar(tree, 'Foto 1');

    expect(mockShowPicker).not.toHaveBeenCalled();
    expect(mockJourney.addTaskPhoto).not.toHaveBeenCalled();
  });
});

describe('Detalhe da tarefa — CTA quando a tarefa não é a ativa', () => {
  it('oferece iniciar a jornada e começar a tarefa', async () => {
    const tree = await render();
    await tocar(tree, 'Iniciar Jornada e começar tarefa');

    expect(mockJourney.startTask).toHaveBeenCalledWith('t1');
    expect(mockPush).not.toHaveBeenCalled();
  });

  // Outra tarefa em andamento não faz ESTA parecer ativa.
  it('outra tarefa ativa no journey mantém esta em idle', async () => {
    mockJourney.state = 'ongoing';
    mockJourney.activeTaskId = 'outra';
    const tree = await render();

    expect(acao(tree, 'Iniciar Jornada e começar tarefa')).toBeDefined();
    expect(acao(tree, 'Cancelar tarefa')).toBeUndefined();
  });
});

describe('Detalhe da tarefa — CTA da tarefa ativa', () => {
  beforeEach(() => {
    mockJourney.state = 'ongoing';
    mockJourney.activeTaskId = 't1';
  });

  it('em andamento oferece finalizar, pausar e cancelar', async () => {
    const tree = await render();

    expect(acao(tree, 'Finalizar tarefa')).toBeDefined();
    expect(acao(tree, 'Fazer pausa')).toBeDefined();
    expect(acao(tree, 'Cancelar tarefa')).toBeDefined();
  });

  it('pausar e retomar chamam o journey, não a tarefa', async () => {
    const tree = await render();
    await tocar(tree, 'Fazer pausa');
    expect(mockJourney.pauseJourney).toHaveBeenCalledTimes(1);

    mockJourney.state = 'paused';
    const pausada = await render();
    await tocar(pausada, 'Retomar tarefa');
    expect(mockJourney.resumeJourney).toHaveBeenCalledTimes(1);
  });

  // Pausado não finaliza: quem parou precisa retomar antes de concluir.
  it('pausado desabilita o finalizar e diz o motivo no rótulo', async () => {
    mockJourney.state = 'paused';
    const tree = await render();

    expect(
      desabilitado(tree, 'Finalizar tarefa (indisponível enquanto pausado)'),
    ).toBe(true);
  });

  it('finalizar espera o backend antes de voltar para a jornada', async () => {
    const tree = await render();
    await tocar(tree, 'Finalizar tarefa');

    expect(mockJourney.completeTask).toHaveBeenCalledWith('t1');
    expect(mockPush).toHaveBeenCalledWith('/(app)/journey');
  });

  it('cancelar devolve a tarefa e volta para a jornada', async () => {
    const tree = await render();
    await tocar(tree, 'Cancelar tarefa');

    expect(mockJourney.cancelTask).toHaveBeenCalledWith('t1');
    expect(mockPush).toHaveBeenCalledWith('/(app)/journey');
  });

  // O bug que o `submitting` fecha: a falha era engolida e o worker voltava
  // pra /journey achando que concluiu, sem a ação ter acontecido.
  it('falha ao finalizar fica na tela e mostra o erro', async () => {
    mockJourney.completeTask.mockRejectedValue(new Error('401'));
    const tree = await render();

    await tocar(tree, 'Finalizar tarefa');

    expect(mockPush).not.toHaveBeenCalled();
    expect(textos(tree)).toContain(
      'Não foi possível finalizar a tarefa. Tente novamente.',
    );
  });

  it('falha ao cancelar tem mensagem própria', async () => {
    mockJourney.cancelTask.mockRejectedValue(new Error('401'));
    const tree = await render();

    await tocar(tree, 'Cancelar tarefa');

    expect(mockPush).not.toHaveBeenCalled();
    expect(textos(tree)).toContain(
      'Não foi possível cancelar a tarefa. Tente novamente.',
    );
  });

  it('re-toque durante o voo não duplica a mutação', async () => {
    let liberar!: () => void;
    mockJourney.completeTask.mockImplementation(
      () => new Promise<void>((res) => { liberar = res; }),
    );
    const tree = await render();

    await act(async () => { acao(tree, 'Finalizar tarefa').props.onPress(); });
    expect(desabilitado(tree, 'Finalizar tarefa')).toBe(true);

    await act(async () => { acao(tree, 'Finalizar tarefa').props.onPress(); });
    expect(mockJourney.completeTask).toHaveBeenCalledTimes(1);

    await act(async () => { liberar(); });
    expect(mockPush).toHaveBeenCalledWith('/(app)/journey');
  });
});
